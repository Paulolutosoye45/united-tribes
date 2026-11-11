import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The sign-in prompt. What these prove:
//   * it ships Off: nothing is returned, nothing is remembered and nothing is logged; Rehearsal counts who would see what and returns no tasks; the Master pause stops it;
//     it can be On for one person only
//   * a visit is a new sign-in or four hours away; the visit is remembered, so a reload keeps the screen and a new sign-in starts again; at most three tasks a visit
//   * "Not now" closes a task for the visit only, comes back at the next, is refused for a placement in the last hours before its seat is released, and five in a row
//     put the person on the office's "worth a call" count
//   * the placement task reads the same state as everything else: an answer given by email, by the office, or in the prompt ends it everywhere, and the second answer is
//     told it is already recorded
//   * a number is never asked of a young person; a recorded "No" to WhatsApp ends that task for good; the WhatsApp yes is never ticked for anyone
//   * the leaders' tasks (interview times, the Tribe Card, the application) and a person who wears two hats
//   * the owner's settings need a reason and a sensible number; the office reads counts only; the log holds no number, no address and no words

let c: Cast;
let n = 0;
let token: string;
const REASON = "Trying the sign-in prompt";

type Task = { kind: string; rung: number; can_skip?: boolean; [k: string]: unknown };
type Queue = { state: string; tasks: Task[]; total: number };

const real = () => `+23480${String(30000000 + ++n * 7919).slice(0, 8)}`;
const on = () => c.set("sign_in_prompt", "on", { reason: REASON });
const rehearse = () => c.set("sign_in_prompt", "rehearsal", { reason: REASON });
const sql = (text: string, params: unknown[] = []) => c.sql(text, params);
async function replica(text: string, params: unknown[] = []) {
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query(text, params);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
}
// A sign-in is a session id (a UUID in the token); "s1", "s2" ... stand for different sign-ins
const sid = (s: string) => `00000000-0000-4000-8000-${Buffer.from(s).toString("hex").padStart(12, "0").slice(-12)}`;
const asUser = (id: string, text: string, params: unknown[] = [], session = "s1") => c.db.asUser!(id, (q) => q(text, params), { session: sid(session) });
const queue = async (id: string, session = "s1") => (await asUser(id, "select public.my_prompt_queue() as r", [], session)).rows[0].r as Queue;
const kinds = (q: Queue) => q.tasks.map((t) => t.kind);
const setLog = async (id: string, kind: string, outcome: string, session = "s1") =>
  (await asUser(id, "select public.prompt_log_set($1, $2) as r", [kind, outcome], session)).rows[0].r as { ok: boolean; reason?: string };
const logOf = (id: string) => sql("select kind, outcome from public.prompt_log where person_id = $1 order by id", [id]);

/** A member the church placed, who has not answered, with a number on file and WhatsApp agreed (so only the placement is owed) unless told otherwise. */
async function placed(name: string, o: { number?: boolean; whatsapp?: boolean; teen?: boolean } = {}) {
  const t = await c.k.tribe(c.season, { name: `Prompt tribe ${++n}`, capacity: 12 });
  const u = await c.k.seat(t.tribe, c.season, `${name}${++n}`);
  await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where person_id = $1", [u.id]);
  const tm = (await c.one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [u.id, t.tribe])).id as string;
  if (o.number !== false) await withNumber(u.id, o.whatsapp !== false);
  if (o.teen) await makeTeen(u.id);
  return { id: u.id, tm, tribe: t.tribe, leader: t.leader.id as string };
}
async function withNumber(id: string, yes = true) {
  await sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email') on conflict (person_id) do update set phone = excluded.phone", [id, real()]);
  if (yes) await sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 't')", [id]);
}
const makeTeen = (id: string) => replica("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
/** An adult with a finished form and nothing else: no seat, no number. */
async function plain(name: string) {
  const u = await c.k.person(`${name}${++n}`);
  await c.k.profile(u.id, c.season, {});
  return u;
}
async function clockFor(p: { id: string; tm: string; tribe: string }, hoursLeft: number) {
  await sql(
    `insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, started_at, deadline_at, remind_at, last_call_at)
     values ($1, $2, $3, $4, now() - interval '40 hours', now() + make_interval(hours => $5), now() - interval '20 hours', now() - interval '5 hours')`,
    [p.tm, p.id, p.tribe, c.season, hoursLeft],
  );
}

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('prompt-test') as t")).t as string;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await sql("delete from public.prompt_visits");
  await sql("delete from public.prompt_log");
  await sql("delete from public.prompt_streaks");
  await sql("update public.prompt_settings set visit_hours = 4, max_tasks = 3, last_hours = 6, worth_call_after = 5, kinds_off = '{}'");
  await sql("delete from public.erasure_requests");
  await sql("delete from public.seat_clocks");
});

describe("who may call what", () => {
  it("turns a visitor away from every function the site calls", async () => {
    const calls: [string, unknown[]][] = [
      ["my_prompt_queue", []],
      ["prompt_log_set", ["placement", "not_now"]],
      ["prompt_placement_answer", ["call", null, null]],
      ["prompt_save_number", [null, true, false]],
      ["prompt_whatsapp_answer", [true]],
      ["prompt_overview", [7]],
      ["god_prompt_settings", []],
      ["god_prompt_settings_set", [4, 3, 6, 5, [], "Because"]],
    ];
    for (const [fn, args] of calls) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps the nine helpers closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["prompt_kinds", []],
      ["prompt_rung", ["placement"]],
      ["prompt_never", [NOBODY]],
      ["prompt_rostered", [NOBODY]],
      ["prompt_seat_deadline", [NOBODY]],
      ["prompt_can_skip", [NOBODY]],
      ["prompt_mask", ["+2348031234567"]],
      ["prompt_task", [NOBODY, "placement"]],
      ["prompt_tasks_owed", [NOBODY]],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.as(c.member, fn, ...args), "42501");
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
    }
  });

  it("lets only admin, director and pastor read the office counts, and only the owner read or change the settings", async () => {
    for (const who of [c.admin, c.director, c.pastor]) expect(await c.as(who, "prompt_overview", 7)).toMatchObject({ days: 7 });
    for (const who of [c.member, c.seasoned.id, c.appointed.id]) await expectCode(c.as(who, "prompt_overview", 7), "42501");
    expect(await c.o.call("god_prompt_settings")).toMatchObject({ visit_hours: 4, max_tasks: 3, last_hours: 6, worth_call_after: 5 });
    for (const who of [c.admin, c.director, c.pastor, c.member]) {
      await expectCode(c.as(who, "god_prompt_settings"), "42501");
      await expectCode(c.as(who, "god_prompt_settings_set", 4, 3, 6, 5, [], "Because I can"), "42501");
    }
  });
});

describe("the switch", () => {
  it("is Off to begin with: nothing is returned, remembered or logged", async () => {
    const p = await placed("Off");
    expect(await queue(p.id)).toEqual({ state: "off", tasks: [], total: 0 });
    expect(await sql("select 1 from public.prompt_visits")).toHaveLength(0);
    expect(await sql("select 1 from public.prompt_log")).toHaveLength(0);
  });

  it("in Rehearsal returns no tasks, counts who would see what once per visit, and logs nothing as shown", async () => {
    await rehearse();
    const p = await placed("Reh");
    const first = await queue(p.id);
    expect(first).toMatchObject({ state: "rehearsal", tasks: [], total: 1 });
    await queue(p.id); // a reload in the same visit
    expect(await logOf(p.id)).toEqual([{ kind: "placement", outcome: "would_show" }]);
    // a new sign-in is a new visit
    await queue(p.id, "s2");
    expect((await logOf(p.id)).filter((r) => r.outcome === "would_show")).toHaveLength(2);
    expect((await logOf(p.id)).filter((r) => r.outcome === "shown")).toHaveLength(0);
  });

  it("is stopped by the Master pause", async () => {
    await on();
    const p = await placed("Pause");
    expect(kinds(await queue(p.id))).toEqual(["placement"]);
    await sql("update public.feature_master set paused = true");
    expect(await queue(p.id, "s2")).toEqual({ state: "off", tasks: [], total: 0 });
  });

  it("can be On for one person only", async () => {
    const a = await placed("Mine");
    const b = await placed("Theirs");
    await c.set("sign_in_prompt", "on", { scope: "person", id: a.id, reason: REASON });
    expect(kinds(await queue(a.id))).toEqual(["placement"]);
    expect((await queue(b.id)).state).toBe("off");
  });
});

describe("a visit", () => {
  it("keeps the screen across a reload, starts again at a new sign-in, and starts again after four hours away", async () => {
    await on();
    const p = await placed("Visit");
    expect(kinds(await queue(p.id))).toEqual(["placement"]);
    expect(kinds(await queue(p.id))).toEqual(["placement"]);
    expect((await logOf(p.id)).filter((r) => r.outcome === "shown")).toHaveLength(1);
    // closed with Not now: gone for the rest of this visit, back with the next sign-in
    expect(await setLog(p.id, "placement", "not_now")).toEqual({ ok: true });
    expect(kinds(await queue(p.id))).toEqual([]);
    expect(kinds(await queue(p.id, "s2"))).toEqual(["placement"]);
    // the same sign-in, away for five hours
    await setLog(p.id, "placement", "not_now", "s2");
    expect(kinds(await queue(p.id, "s2"))).toEqual([]);
    await sql("update public.prompt_visits set seen_at = now() - interval '5 hours' where person_id = $1", [p.id]);
    expect(kinds(await queue(p.id, "s2"))).toEqual(["placement"]);
  });

  it("shows at most the owner's number of tasks, most important first, and leaves the rest for the next visit", async () => {
    await on();
    const p = await placed("Cap", { number: false });
    // owed: the placement (rung 1) and a number (rung 3)
    expect(kinds(await queue(p.id))).toEqual(["placement", "number"]);
    await sql("update public.prompt_settings set max_tasks = 1");
    expect(kinds(await queue(p.id, "s2"))).toEqual(["placement"]);
    // answering the first does not pull the second into this visit
    await c.as(p.id, "placement_my_confirm", "v1");
    expect(kinds(await queue(p.id, "s2"))).toEqual([]);
    expect(kinds(await queue(p.id, "s3"))).toEqual(["number"]);
  });

  it("shows nothing to someone who owes nothing", async () => {
    await on();
    const u = await plain("Nothing");
    await withNumber(u.id, true);
    expect(await queue(u.id)).toEqual({ state: "on", tasks: [], total: 0 });
  });

  it("never prompts the platform owner, a hidden account, or someone with a deletion request open", async () => {
    await on();
    expect((await queue(c.o.owner.id)).tasks).toEqual([]);
    const p = await placed("Erase");
    expect(kinds(await queue(p.id))).toEqual(["placement"]);
    await sql("insert into public.erasure_requests (person_id, centre_id) select id, centre_id from public.people where id = $1", [p.id]);
    expect((await queue(p.id, "s2")).tasks).toEqual([]);
    const h = await placed("Hidden");
    await sql("update public.people set hidden = true where id = $1", [h.id]);
    expect((await queue(h.id)).tasks).toEqual([]);
  });
});

describe("Not now", () => {
  it("counts in a row, resets when the real answer is given, and puts a person on the office's worth-a-call count at the fifth", async () => {
    await on();
    const p = await placed("Streak");
    for (let i = 1; i <= 5; i++) {
      await queue(p.id, `s${i}`);
      expect(await setLog(p.id, "placement", "not_now", `s${i}`)).toEqual({ ok: true });
    }
    expect((await sql("select not_nows from public.prompt_streaks where person_id = $1", [p.id]))[0].not_nows).toBe(5);
    expect(await c.as(c.director, "prompt_overview", 7)).toMatchObject({ worth_a_call: 1 });
    await queue(p.id, "s6");
    await c.as(p.id, "placement_my_confirm", "v1");
    await setLog(p.id, "placement", "answered", "s6");
    expect(await sql("select 1 from public.prompt_streaks where person_id = $1", [p.id])).toHaveLength(0);
    expect(await c.as(c.director, "prompt_overview", 7)).toMatchObject({ worth_a_call: 0 });
  });

  it("is refused for a placement in the last hours before its seat is released, and nowhere else", async () => {
    await on();
    const p = await placed("Late", { number: false });
    await clockFor(p, 3);
    const q = await queue(p.id);
    expect(q.tasks.find((t) => t.kind === "placement")?.can_skip).toBe(false);
    expect(await setLog(p.id, "placement", "not_now")).toEqual({ ok: false, reason: "no_skip" });
    expect(kinds(await queue(p.id))).toContain("placement");
    // the other tasks stay free to close
    expect(await setLog(p.id, "number", "not_now")).toEqual({ ok: true });
    // with plenty of time left, or the owner's hours set to nothing, it is free again
    await sql("update public.seat_clocks set deadline_at = now() + interval '20 hours'");
    expect(await setLog(p.id, "placement", "not_now")).toEqual({ ok: true });
  });

  it("is not blocked by a clock that is only a Rehearsal", async () => {
    await on();
    const p = await placed("Practice");
    await clockFor(p, 2);
    await sql("update public.seat_clocks set rehearsal = true");
    expect((await queue(p.id)).tasks[0].can_skip).toBe(true);
  });

  it("ignores a kind it was not asked about, and a kind that was not in this visit", async () => {
    await on();
    const p = await placed("Odd");
    await queue(p.id);
    await expectCode(asUser(p.id, "select public.prompt_log_set('bogus', 'not_now')"), "22023");
    await expectCode(asUser(p.id, "select public.prompt_log_set('placement', 'maybe')"), "22023");
    expect(await setLog(p.id, "care", "not_now")).toEqual({ ok: false, reason: "no_visit" });
  });
});

describe("the placement task", () => {
  it("shows the tribe, the leader's first name, the meeting and the clock, and what it may offer", async () => {
    await on();
    const p = await placed("Show");
    await clockFor(p, 20);
    const t = (await queue(p.id)).tasks[0];
    expect(t).toMatchObject({ kind: "placement", rung: 1, can_skip: true, has_number: true });
    expect(t.tribe).toMatch(/Prompt tribe/);
    expect(typeof t.leader_first).toBe("string");
    expect(t.deadline_at).toBeTruthy();
    // the extra answers belong to the placed-answers switch
    expect(t.more_answers).toBe(false);
    await c.set("placed_answers", "on", { reason: REASON });
    expect((await queue(p.id, "s2")).tasks[0].more_answers).toBe(true);
  });

  it("ends the moment the real answer is recorded, however it was given", async () => {
    await on();
    const viaPrompt = await placed("Yes");
    const viaOffice = await placed("Office");
    const viaLink = await placed("Link");
    for (const p of [viaPrompt, viaOffice, viaLink]) expect(kinds(await queue(p.id))).toEqual(["placement"]);
    // "Yes, I'm in" is the function the tribe page uses
    expect(await c.as(viaPrompt.id, "placement_my_confirm", "v1")).toMatchObject({ ok: true });
    expect(kinds(await queue(viaPrompt.id))).toEqual([]);
    // the office moves the seat
    await sql("update public.tribe_members set status = 'released', released_at = now() where id = $1", [viaOffice.tm]);
    expect(kinds(await queue(viaOffice.id))).toEqual([]);
    // the private link page says not this season
    await c.set("placed_answers", "on", { reason: REASON });
    const link = (await sql("select public.placement_token_mint($1, $2, 60) as t", [viaLink.tm, viaLink.id]))[0].t as string;
    expect(await c.anon("worker_placed_answer", token, link, "not_this_season", null, null, null, null)).toMatchObject({ ok: true });
    expect(kinds(await queue(viaLink.id, "s2"))).toEqual([]);
  });

  it("tells a second answer that it is already recorded", async () => {
    await on();
    await c.set("placed_answers", "on", { reason: REASON });
    const p = await placed("Twice");
    await queue(p.id);
    expect(await c.as(p.id, "placement_my_confirm", "v1")).toMatchObject({ ok: true });
    const again = (await asUser(p.id, "select public.prompt_placement_answer('not_season') as r")).rows[0].r;
    expect(again).toMatchObject({ ok: false, reason: "not_active" });
    // and the seat is still theirs
    expect((await c.one("select status, confirmed_at is not null as yes from public.tribe_members where id = $1", [p.tm]))).toMatchObject({ status: "active", yes: true });
  });

  it("records Not this season and Call me with the very steps of the private page", async () => {
    await on();
    const a = await placed("Season");
    // placed answers Off: the same refusal the page gives
    expect((await asUser(a.id, "select public.prompt_placement_answer('not_season') as r")).rows[0].r).toMatchObject({ ok: false, reason: "off" });
    await c.set("placed_answers", "on", { reason: REASON });
    expect((await asUser(a.id, "select public.prompt_placement_answer('not_season') as r")).rows[0].r).toMatchObject({ ok: true, kind: "not_season" });
    expect(await c.one("select status, release_reason from public.tribe_members where id = $1", [a.tm])).toMatchObject({ status: "released", release_reason: "Not this season" });
    expect(await sql("select kind from public.placed_answers where tm_id = $1", [a.tm])).toEqual([{ kind: "not_this_season" }]);
    expect(await sql("select source from public.placement_holds where person_id = $1", [a.id])).toEqual([{ source: "not_season" }]);
    expect(kinds(await queue(a.id))).toEqual([]);

    const b = await placed("Call");
    const call = (window: string | null, phone: string | null = null) => asUser(b.id, "select public.prompt_placement_answer('call', $1, $2) as r", [window, phone]);
    expect((await call("evening")).rows[0].r).toMatchObject({ ok: true, kind: "call", window: "evening" });
    expect(await sql("select kind, window_pref from public.placed_answers where tm_id = $1", [b.tm])).toEqual([{ kind: "call_me", window_pref: "evening" }]);
    // pressed twice: still one request
    expect((await call("evening")).rows[0].r).toMatchObject({ ok: true, again: true });
    expect(await sql("select 1 from public.placed_answers where tm_id = $1", [b.tm])).toHaveLength(1);
    expect(kinds(await queue(b.id))).toEqual(["placement"]);
  });

  it("needs a number for the call, saves a typed one, and refuses one that does not look right", async () => {
    await on();
    await c.set("placed_answers", "on", { reason: REASON });
    const p = await placed("NoNumber", { number: false });
    const call = (phone: string | null) => asUser(p.id, "select public.prompt_placement_answer('call', null, $1) as r", [phone]);
    await expectCode(call(null), "22023");
    await expectCode(call("0803"), "22023");
    expect(await sql("select 1 from public.placed_answers where tm_id = $1", [p.tm])).toHaveLength(0);
    const number = real();
    expect((await call(number)).rows[0].r).toMatchObject({ ok: true, kind: "call" });
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [p.id])).phone).toBe(number);
    // saving a number for a call does not tick WhatsApp
    expect(await sql("select 1 from public.consents where person_id = $1 and purpose = 'whatsapp'", [p.id])).toHaveLength(0);
  });

  it("offers a young person the yes only, and gives them neither of the other two", async () => {
    await on();
    await c.set("placed_answers", "on", { reason: REASON });
    const t = await placed("Teen", { teen: true });
    const task = (await queue(t.id)).tasks.find((x) => x.kind === "placement");
    expect(task?.more_answers).toBe(false);
    for (const kind of ["not_season", "call"]) {
      expect((await asUser(t.id, "select public.prompt_placement_answer($1, null, null) as r", [kind])).rows[0].r).toMatchObject({ ok: false, reason: "not_available" });
    }
  });
});

describe("the number and WhatsApp", () => {
  it("asks an adult with no number for one, shows the sign-in number only masked, and saves it in place without ticking WhatsApp", async () => {
    await on();
    const u = await plain("Num");
    await sql("update auth.users set phone = '2348031234567' where id = $1", [u.id]);
    const t = (await queue(u.id)).tasks[0];
    expect(t).toMatchObject({ kind: "number", rung: 3 });
    expect(t.signin_mask).toBe("+234 ••• 567");
    expect(JSON.stringify(t)).not.toContain("8031234567");
    // typed
    const number = real();
    expect((await asUser(u.id, "select public.prompt_save_number($1, false, false) as r", [number])).rows[0].r).toMatchObject({ ok: true });
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [u.id])).phone).toBe(number);
    expect(await sql("select 1 from public.consents where person_id = $1 and purpose = 'whatsapp'", [u.id])).toHaveLength(0);
    // the number is in; WhatsApp is the next question, and it is a different task
    expect(kinds(await queue(u.id, "s2"))).toEqual(["whatsapp"]);
    // pressed again with the task gone: already recorded, nothing changes
    expect((await asUser(u.id, "select public.prompt_save_number($1, false, false) as r", [real()])).rows[0].r).toMatchObject({ ok: true, again: true });
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [u.id])).phone).toBe(number);
  });

  it("can use the number a person signs in with, and ticks WhatsApp only when asked to", async () => {
    await on();
    const u = await plain("Signin");
    await sql("update auth.users set phone = '2348051234568' where id = $1", [u.id]);
    expect((await asUser(u.id, "select public.prompt_save_number(null, true, true) as r")).rows[0].r).toMatchObject({ ok: true });
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [u.id])).phone).toBe("+2348051234568");
    expect(await sql("select granted, version from public.consents where person_id = $1 and purpose = 'whatsapp'", [u.id])).toEqual([{ granted: true, version: "reach-v1" }]);
    expect(kinds(await queue(u.id, "s2"))).toEqual([]);
  });

  it("refuses a number that looks made up or that is not written with its country code", async () => {
    const u = await plain("Bad");
    await expectCode(asUser(u.id, "select public.prompt_save_number('08031234567', false, false)"), "22023");
    await expectCode(asUser(u.id, "select public.prompt_save_number('+2348888888888', false, false)"), "22023");
    await expectCode(asUser(u.id, "select public.prompt_save_number(null, false, false)"), "22023");
  });

  it("asks a person with a number and no answer about WhatsApp, records a yes or a final no, and never ticks it for them", async () => {
    await on();
    const yes = await plain("Yes");
    const no = await plain("No");
    await withNumber(yes.id, false);
    await withNumber(no.id, false);
    for (const u of [yes, no]) {
      const t = (await queue(u.id)).tasks[0];
      expect(t).toMatchObject({ kind: "whatsapp", rung: 3 });
      expect(await sql("select 1 from public.consents where person_id = $1 and purpose = 'whatsapp'", [u.id])).toHaveLength(0);
    }
    expect((await asUser(yes.id, "select public.prompt_whatsapp_answer(true) as r")).rows[0].r).toMatchObject({ ok: true, yes: true });
    expect(await sql("select granted from public.consents where person_id = $1 and purpose = 'whatsapp'", [yes.id])).toEqual([{ granted: true }]);
    expect((await asUser(no.id, "select public.prompt_whatsapp_answer(false) as r")).rows[0].r).toMatchObject({ ok: true, yes: false });
    expect(await sql("select granted, version from public.consents where person_id = $1 and purpose = 'whatsapp'", [no.id])).toEqual([{ granted: false, version: "prompt-v1" }]);
    // a recorded No ends the question for good, at every later visit
    for (let i = 2; i < 5; i++) expect(kinds(await queue(no.id, `s${i}`))).toEqual([]);
    // and a second press does nothing
    expect((await asUser(no.id, "select public.prompt_whatsapp_answer(true) as r")).rows[0].r).toMatchObject({ ok: true, again: true });
    expect(await sql("select granted from public.consents where person_id = $1 and purpose = 'whatsapp'", [no.id])).toEqual([{ granted: false }]);
  });

  it("does not ask someone who answered No on the profile either, and does not ask someone who already said yes", async () => {
    await on();
    const was = await plain("Was");
    await withNumber(was.id, false);
    await sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 't'), ($1, 'whatsapp', false, 't')", [was.id]);
    expect((await queue(was.id)).tasks).toEqual([]);
    const yes = await plain("Said");
    await withNumber(yes.id, true);
    expect((await queue(yes.id)).tasks).toEqual([]);
  });

  it("never asks a young person for a number or WhatsApp, and asks them for the guardian's yes instead", async () => {
    await on();
    const t = await plain("Teen");
    await makeTeen(t.id);
    const q = await queue(t.id);
    expect(kinds(q)).toEqual(["guardian"]);
    expect(q.tasks[0]).toMatchObject({ rung: 2, href: "/tribe" });
    expect((await asUser(t.id, "select public.prompt_save_number('+2348031234500', false, false) as r")).rows[0].r).toMatchObject({ ok: false, reason: "not_available" });
    expect((await asUser(t.id, "select public.prompt_whatsapp_answer(true) as r")).rows[0].r).toMatchObject({ ok: false, reason: "not_available" });
    expect(await sql("select 1 from public.contact_preferences where person_id = $1", [t.id])).toHaveLength(0);
  });

  it("does not ask someone with no joining form, no seat and no leader's role for a number", async () => {
    await on();
    const u = await c.k.person(`Fresh${++n}`);
    expect((await queue(u.id)).tasks).toEqual([]);
  });

  it("lets the email series end at the same moment: a fixed number closes the reach series", async () => {
    await on();
    const u = await plain("Series");
    const before = await sql("select count(*)::int as n from public.reach_enrolments where person_id = $1 and status = 'active'", [u.id]);
    expect(before[0].n).toBe(0);
    await asUser(u.id, "select public.prompt_save_number($1, false, true)", [real()]);
    expect(await sql("select count(*)::int as n from public.reach_enrolments where person_id = $1 and status = 'active'", [u.id])).toEqual([{ n: 0 }]);
  });
});

describe("the leaders", () => {
  it("asks a prospective leader invited to interview to pick a time, and ends it when one is booked", async () => {
    await on();
    const u = await plain("Applicant");
    await withNumber(u.id, true);
    const app = (await c.one("insert into public.leader_applications (person_id, status, consent_version) values ($1, 'interview_invited', 'v1') returning id", [u.id])).id as string;
    // no times yet: nothing to pick, so nothing to ask
    expect((await queue(u.id)).tasks).toEqual([]);
    const slot = (await c.one("insert into public.interview_slots (starts_at, minutes, mode, place) values (now() + interval '3 days', 20, 'online', 'Zoom') returning id", [])).id as string;
    await sql("insert into public.interview_slots (starts_at, minutes, mode, place) values (now() + interval '1 hour', 20, 'online', 'Too soon')");
    const t = (await queue(u.id, "s2")).tasks[0] as Task & { options: { id: string }[] };
    expect(t).toMatchObject({ kind: "interview", rung: 1 });
    expect(t.options.map((o) => o.id)).toEqual([slot]);
    await asUser(u.id, "select public.book_interview_slot($1)", [slot]);
    expect(await sql("select status from public.leader_applications where id = $1", [app])).toEqual([{ status: "interview_booked" }]);
    expect((await queue(u.id, "s3")).tasks).toEqual([]);
  });

  it("asks a leader whose Tribe Card is not sent, and a prospective leader with a draft application, to open them", async () => {
    await on();
    await withNumber(c.appointed.id, true);
    const q = await queue(c.appointed.id);
    expect(q.tasks.find((t) => t.kind === "tribe_card")).toMatchObject({ rung: 4, href: "/lead/tribe", changes_asked: false });
    await sql("update public.tribes set status = 'changes_requested' where id = $1", [c.appointed.tribe]);
    expect((await queue(c.appointed.id, "s2")).tasks.find((t) => t.kind === "tribe_card")).toMatchObject({ changes_asked: true });
    // a card that is in (an approved tribe) is nothing to ask for
    await withNumber(c.seasoned.id, true);
    expect(kinds(await queue(c.seasoned.id))).not.toContain("tribe_card");
    await sql("update public.tribes set status = 'closed' where id = $1", [c.appointed.tribe]);
    expect(kinds(await queue(c.appointed.id, "s3"))).not.toContain("tribe_card");

    const a = await plain("Draft");
    await withNumber(a.id, true);
    await sql("insert into public.leader_applications (person_id, status, consent_version) values ($1, 'draft', 'v1')", [a.id]);
    expect((await queue(a.id)).tasks[0]).toMatchObject({ kind: "application", rung: 4, href: "/lead" });
  });

  it("asks a leader with care tasks due, and not one whose tasks are in the future", async () => {
    await on();
    await withNumber(c.seasoned.id, true);
    expect(kinds(await queue(c.seasoned.id))).not.toContain("care");
    await sql("insert into public.care_tasks (tribe_id, kind, assignee_role, assigned_to, due_on) values ($1, 'practical', 'leader', $2, current_date + 5)", [c.seasoned.tribe, c.seasoned.id]);
    expect(kinds(await queue(c.seasoned.id, "s2"))).not.toContain("care");
    await sql("update public.care_tasks set due_on = current_date - 1");
    expect((await queue(c.seasoned.id, "s3")).tasks.find((t) => t.kind === "care")).toMatchObject({ rung: 5, count: 1, href: "/care" });
  });

  it("gives a person who wears two hats both lists, ranked together", async () => {
    await on();
    const p = await placed("Hats", { number: false });
    await sql("insert into public.leader_applications (person_id, status, consent_version) values ($1, 'draft', 'v1')", [p.id]);
    expect(kinds(await queue(p.id))).toEqual(["placement", "number", "application"]);
  });

  it("lets the owner turn one kind off on its own", async () => {
    await on();
    const p = await placed("Off", { number: false });
    expect(kinds(await queue(p.id))).toEqual(["placement", "number"]);
    expect(await c.o.call("god_prompt_settings_set", 4, 3, 6, 5, ["number"], REASON)).toEqual({ ok: true });
    expect(kinds(await queue(p.id, "s2"))).toEqual(["placement"]);
  });
});

describe("the office and the owner", () => {
  it("counts what happened, by kind, with no names", async () => {
    await on();
    const p = await placed("Count", { number: false });
    const q = await placed("Count", { number: false });
    await queue(p.id);
    await queue(q.id);
    await setLog(p.id, "number", "not_now");
    await c.as(q.id, "placement_my_confirm", "v1");
    await setLog(q.id, "placement", "answered");
    const o = await c.as(c.admin, "prompt_overview", 7);
    expect(o).toMatchObject({ state: "on", people_seen: 2, worth_a_call: 0, days: 7 });
    const by = Object.fromEntries((o.kinds as { kind: string }[]).map((k) => [k.kind, k]));
    expect(by.placement).toMatchObject({ shown: 2, answered: 1, not_now: 0, people: 2 });
    expect(by.number).toMatchObject({ shown: 2, not_now: 1 });
    expect(JSON.stringify(o)).not.toMatch(/@|\+234|Count/);
    // listed by what is lost if it waits: the three that run a clock come first
    expect(o.kinds.map((k: { kind: string }) => k.kind).slice(0, 3)).toEqual(["interview", "leader_offer", "placement"]);
  });

  it("reads the state as the Switchboard has it", async () => {
    expect(await c.as(c.admin, "prompt_overview", 7)).toMatchObject({ state: "off" });
    await rehearse();
    expect(await c.as(c.admin, "prompt_overview", 7)).toMatchObject({ state: "rehearsal" });
    await on();
    expect(await c.as(c.admin, "prompt_overview", 7)).toMatchObject({ state: "on" });
  });

  it("needs a reason and numbers in range for the settings, and refuses a kind it does not know", async () => {
    const set = (...a: unknown[]) => c.o.call("god_prompt_settings_set", ...a);
    await expectCode(set(4, 3, 6, 5, [], null), "22023");
    await expectCode(set(4, 3, 6, 5, [], "abc"), "22023");
    await expectCode(set(0, 3, 6, 5, [], REASON), "22023");
    await expectCode(set(4, 9, 6, 5, [], REASON), "22023");
    await expectCode(set(4, 3, 99, 5, [], REASON), "22023");
    await expectCode(set(4, 3, 6, 1, [], REASON), "22023");
    await expectCode(set(4, 3, 6, 5, ["nonsense"], REASON), "22023");
    expect(await set(8, 2, 12, 7, ["care", "care", "joining_form"], REASON)).toEqual({ ok: true });
    expect(await c.o.call("god_prompt_settings")).toMatchObject({ visit_hours: 8, max_tasks: 2, last_hours: 12, worth_call_after: 7, kinds_off: ["care", "joining_form"] });
    // the change and its reason are kept in the log
    expect((await sql("select meta from public.event_log where action = 'sign_in_prompt.settings' order by id desc limit 1"))[0].meta).toMatchObject({ reason: REASON });
  });

  it("keeps ninety days of log, and no number, address or words in it", async () => {
    await on();
    const p = await placed("Log", { number: false });
    await queue(p.id);
    await setLog(p.id, "number", "not_now");
    expect(await sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'prompt_log' order by ordinal_position")).toEqual([
      { column_name: "id" },
      { column_name: "person_id" },
      { column_name: "kind" },
      { column_name: "outcome" },
      { column_name: "at" },
    ]);
    await sql("insert into public.prompt_log (person_id, kind, outcome, at) values ($1, 'care', 'shown', now() - interval '100 days')", [p.id]);
    await setLog(p.id, "placement", "not_now").catch(() => null);
    expect(await sql("select 1 from public.prompt_log where at < now() - interval '90 days'")).toHaveLength(0);
  });

  it("is closed to every table for a signed-in person", async () => {
    const p = await placed("Tables", { number: false });
    for (const t of ["prompt_settings", "prompt_visits", "prompt_log", "prompt_streaks"]) {
      await expectCode(asUser(p.id, `select * from public.${t}`), "42501");
    }
  });
});
