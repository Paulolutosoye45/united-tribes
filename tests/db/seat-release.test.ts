import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// Package 7: the end of the series lets the seat go, the leader's note at 5 pm, the office's email at 7 am, and "I need to leave this tribe". What these prove:
//   * the new switch ships Off, needs Reach series and Seat window, and cannot be put On while a seat-window check is red
//   * at the end of the six days a member who did nothing is released kindly, through the seat window's own door (a log, seven days to take it back, a replacement
//     from the bench, the safety limits), and nobody else is: not a member who looked at the page, unless "everyone" is chosen; never when the list-only setting is on
//   * Off does nothing and Rehearsal only writes down who would be released; the people on the never-release list are never released; a breaker holds a release
//   * a member can leave in the first 14 days of the season, with or without a reason, and after that is told to ask; only for themselves
//   * the leader gets one note a day at 5 pm and only on a day something changed; the office gets one email at 7 am; neither goes outside its hour

let c: Cast;
let n = 0;
let token: string;
let other: string;

const REASON = "Trying the series release";
const SLOT = "weeknight-evening";
const hour = (h: number) => c.db.admin.query(`create or replace function public.lagos_hour() returns integer language sql as $$ select ${h} $$`);
const unhour = () =>
  c.db.admin.query(
    "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$",
  );
const beat = () => c.sql("update public.seat_window_settings set last_tick_at = now()");
const allOn = async (release: "on" | "rehearsal" | "off" = "on") => {
  await c.set("contact_gaps", "on", { reason: REASON });
  await c.set("reach_series", "on", { reason: REASON });
  await beat();
  await c.set("seat_window", "on", { reason: REASON });
  if (release !== "off") await c.set("reach_release", release, { reason: REASON });
};
const tick = () => c.anon("worker_reach_tick", token);
const seatTick = () => c.anon("worker_seat_window_tick", token);
const fresh = (name: string) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity: 12, slot: SLOT });
const member = async (name: string, tribe: string) => (await c.k.seat(tribe, c.season, `${name}${++n}`)).id;
const tmOf = async (person: string) => (await c.one("select id from public.tribe_members where person_id = $1 order by id desc limit 1", [person])).id as string;
const seat = async (person: string) => (await c.one("select status, release_reason from public.tribe_members where person_id = $1 order by id limit 1", [person])) as { status: string; release_reason: string | null };
const enrolment = async (id: string) => (await c.sql("select * from public.reach_enrolments where person_id = $1 order by started_at desc limit 1", [id]))[0];
const back = (id: string, by: string) =>
  c.sql("update public.reach_enrolments set day0_at = day0_at - $2::interval, first_go_until = first_go_until - $2::interval where person_id = $1 and status = 'active'", [id, by]);
const goFirst = (id: string) => c.sql("update public.reach_enrolments set first_go_until = now() - interval '1 minute' where person_id = $1 and status = 'active'", [id]);
const delivered = (id: string) => c.sql("update public.messages set status = 'sent', sent_at = now() where person_id = $1 and template = 'reach_series' and status = 'queued'", [id]);
const mailOf = (person: string, template: string) => c.sql("select * from public.messages where person_id = $1 and template = $2 order by created_at", [person, template]);
const clockOf = async (tm: string) => (await c.sql("select * from public.seat_clocks where tm_id = $1 order by created_at desc, id limit 1", [tm]))[0];
const candidate = (name: string) => readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 20, times: [SLOT] });
const events = (action: string, person: string) => c.sql("select * from public.event_log where action = $1 and entity_id = $2", [action, person]);
/** A member whose series is running and whose six days are done: the next tick reaches the end. Opens the page for someone who "looked". */
async function toTheEnd(person: string, opts: { looked?: boolean } = {}) {
  await hour(12);
  await c.sql("update public.reach_settings set swept_at = null");
  await tick();
  await goFirst(person);
  await tick();
  if (opts.looked) await c.sql("insert into public.event_log (actor_id, action, entity, entity_id) values ($1::uuid, 'page.viewed', 'person', $1::text)", [person]);
  for (const by of ["2 days", "2 days", "1 day"]) {
    await back(person, by);
    await tick();
  }
  await delivered(person);
  if (!opts.looked) await c.sql("delete from public.event_log where actor_id = $1", [person]);
  await back(person, "1 day");
}

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  token = (await c.one("select public.bootstrap_worker_token('seat-release-test') as t")).t as string;
  await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  other = await c.k.season("Elsewhere", -400);
}, 240_000);

afterAll(async () => {
  await unhour();
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await unhour();
  await c.sql("delete from public.reach_enrolments");
  await c.sql("delete from public.reach_links");
  await c.sql("delete from public.seat_clock_log");
  await c.sql("delete from public.seat_clocks");
  await c.sql("delete from public.seat_chain");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.placed_holds");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.email_signals");
  await c.sql("delete from public.care_flags");
  await c.sql("delete from public.contact_preferences");
  await c.sql("delete from public.consents where purpose in ('whatsapp', 'sms', 'email', 'announcements')");
  await c.sql("update public.reach_settings set first_go_hours = 24, release_after_days = 6, end_mode = 'silent', note_per_week = 2, paused = false, paused_reason = null, swept_at = null");
  await c.sql("update public.seat_window_settings set window_hours = 48, remind_hours = 24, last_call_hours = 40, take_back_days = 7, offers_in_row = 3, day_cap = 30, bar = 70, counted_from = now() - interval '30 days', paused = false, paused_reason = null, last_tick_at = null, swept_at = null");
  await c.sql("update auth.users set phone = null");
  await c.sql("update public.member_profiles set season_id = $1 where season_id = $2 and person_id not in (select person_id from public.tribe_members where status = 'active')", [other, c.season]);
});

describe("it ships Off", () => {
  it("is on the Switchboard, starts Off, needs Reach series and Seat window", async () => {
    const a = await c.one("select * from public.feature_registry where key = 'reach_release'");
    expect(a).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 34 });
    expect(a.modes).toEqual(["off", "rehearsal", "on"]);
    expect(a.depends).toEqual(["reach_series", "seat_window"]);
  });

  it("cannot be put On before the seat window is open, nor while one of its checks is red, and says which; Rehearsal is never refused", async () => {
    await c.set("contact_gaps", "on", { reason: REASON });
    await c.set("reach_series", "on", { reason: REASON });
    await expect(c.set("reach_release", "on", { reason: REASON })).rejects.toThrow(/Open Seat window first/);
    await beat();
    await c.set("seat_window", "on", { reason: REASON });
    await c.sql("update public.seat_window_settings set last_tick_at = null");
    await expect(c.set("reach_release", "on", { reason: REASON })).rejects.toThrow(/cannot be put On yet/);
    await c.set("reach_release", "rehearsal", { reason: REASON });
  });

  it("releases nothing while Off, however the series ends", async () => {
    await allOn("off");
    const t = await fresh("Off");
    const m = await member("Off", t.tribe);
    await toTheEnd(m);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "silent" });
    expect((await seat(m)).status).toBe("active");
    expect(await mailOf(m, "reach_released")).toHaveLength(0);
  });
});

describe("the end of the series", () => {
  it("releases a member who did nothing, kindly, with a way back, and offers the seat to the bench", async () => {
    await allOn();
    const t = await fresh("Quiet");
    const m = await member("Quiet", t.tribe);
    const bench = await candidate("Bench");
    await toTheEnd(m);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "silent" });
    expect(await seat(m)).toEqual({ status: "released", release_reason: "No contact in time" });
    const k = await clockOf(await tmOf(m));
    expect(k).toMatchObject({ state: "released", outcome: "series" });
    expect(new Date(k.retake_until).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const mail = await mailOf(m, "reach_released");
    expect(mail).toHaveLength(1);
    expect(mail[0].reply_token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mail[0].params)).not.toMatch(/\+?234\d{8,}/);
    expect((await c.one("select kind, reason, via from public.seat_ledger where tm_id = $1 and kind = 'released'", [await tmOf(m)]))).toMatchObject({ reason: "No contact in time", via: "series" });
    // the next in line was offered the seat
    expect((await c.sql("select 1 from public.tribe_members where person_id = $1 and tribe_id = $2 and status = 'active'", [bench.id, t.tribe])).length).toBe(1);
    expect((await c.sql("select kind from public.seat_clock_log where clock_id = $1", [k.id])).map((r) => r.kind)).toEqual(expect.arrayContaining(["release", "replace"]));
  });

  it("lets the member take the seat back by the link in the email, once, if it is still free", async () => {
    await allOn();
    const t = await fresh("Back");
    const m = await member("Back", t.tribe);
    await toTheEnd(m);
    await tick();
    const mail = (await mailOf(m, "reach_released"))[0];
    const r = await c.anon("worker_seat_take_back", token, mail.reply_token);
    expect(r).toMatchObject({ ok: true });
    expect((await seat(m)).status).toBe("active");
    expect(await c.anon("worker_seat_take_back", token, mail.reply_token)).toMatchObject({ ok: false });
  });

  it("keeps a member who opened the page, unless the setting says everyone; and never releases when the setting is list only", async () => {
    await allOn();
    const t = await fresh("Looked");
    const looked = await member("Looked", t.tribe);
    await toTheEnd(looked, { looked: true });
    await tick();
    expect(await enrolment(looked)).toMatchObject({ outcome: "seen_not_done" });
    expect((await seat(looked)).status).toBe("active");

    await c.sql("update public.reach_settings set end_mode = 'everyone'");
    const t2 = await fresh("Everyone");
    const m2 = await member("Everyone", t2.tribe);
    await toTheEnd(m2, { looked: true });
    await tick();
    expect(await enrolment(m2)).toMatchObject({ outcome: "seen_not_done" });
    expect((await seat(m2)).status).toBe("released");

    await c.sql("update public.reach_settings set end_mode = 'list'");
    const t3 = await fresh("List");
    const m3 = await member("List", t3.tribe);
    await toTheEnd(m3);
    await tick();
    expect(await enrolment(m3)).toMatchObject({ outcome: "silent" });
    expect((await seat(m3)).status).toBe("active");
  });

  it("only writes down who would be released while the switch is on Rehearsal", async () => {
    await allOn("rehearsal");
    const t = await fresh("Rehearse");
    const m = await member("Rehearse", t.tribe);
    await toTheEnd(m);
    await tick();
    expect((await seat(m)).status).toBe("active");
    expect(await mailOf(m, "reach_released")).toHaveLength(0);
    expect((await events("reach.would_release", m)).length).toBe(1);
  });

  it("never releases anyone on the never-release list, and says why", async () => {
    await allOn();
    const t = await fresh("Never");
    const m = await member("Never", t.tribe);
    await hour(12);
    await tick();
    const e = await enrolment(m);
    expect(e).toBeTruthy();
    const call = async () => (await c.one("select public.reach_release_seat($1, 'silent') as r", [e.id])).r as string;
    await c.sql("insert into public.care_flags (tribe_id, person_id, kind) values ($1, $2, 'leader_concern')", [t.tribe, m]);
    expect(await call()).toBe("never:care");
    await c.sql("delete from public.care_flags");
    // one bounce is not "bounced"; two are
    await c.sql("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [m]);
    expect(await call()).toBe("never:bounced");
    await c.sql("delete from public.email_signals");
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [m]);
    expect(await call()).toBe("never:deletion");
    expect((await seat(m)).status).toBe("active");
    expect(await mailOf(m, "reach_released")).toHaveLength(0);
  });

  it("holds the release when a safety limit has been reached, and writes that down", async () => {
    await allOn();
    await c.sql("update public.seat_window_settings set day_cap = 5");
    const t = await fresh("Cap");
    const m = await member("Cap", t.tribe);
    await hour(12);
    await tick();
    const e = await enrolment(m);
    const filler = await member("Filler", (await fresh("Filler")).tribe);
    const fillerTm = await tmOf(filler);
    const clock = (await c.one("insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, state, outcome, started_at, deadline_at, remind_at, last_call_at, released_at) select $1, $2, tribe_id, season_id, 'released', 'x', now(), now(), now(), now(), now() from public.tribe_members where id = $1 returning id", [fillerTm, filler])).id as string;
    for (let i = 0; i < 5; i++) await c.sql("insert into public.seat_clock_log (clock_id, kind) values ($1, 'release')", [clock]);
    expect((await c.one("select public.reach_release_seat($1, 'silent') as r", [e.id])).r).toBe("held:day_cap");
    expect((await seat(m)).status).toBe("active");
    expect((await events("reach.release_held", m)).length).toBe(1);
  });
});

describe("I need to leave this tribe", () => {
  it("frees the seat at once in the first 14 days, with a reason or none, and offers it on", async () => {
    await allOn();
    const t = await fresh("Leave");
    const m = await member("Leave", t.tribe);
    const bench = await candidate("Next");
    expect(await c.as(m, "my_tribe_leave_state")).toMatchObject({ can: true });
    const r = await c.as(m, "my_tribe_leave", "time");
    expect(r).toMatchObject({ ok: true });
    expect(await seat(m)).toEqual({ status: "released", release_reason: "Left by the member" });
    expect(await clockOf(await tmOf(m))).toMatchObject({ state: "released", outcome: "left", retake_until: null });
    expect((await c.one("select kind from public.seat_ledger where tm_id = $1 and kind = 'left'", [await tmOf(m)]))).toMatchObject({ kind: "left" });
    expect((await c.sql("select 1 from public.tribe_members where person_id = $1 and tribe_id = $2 and status = 'active'", [bench.id, t.tribe])).length).toBe(1);
    expect(await mailOf(m, "reach_released")).toHaveLength(0);
  });

  it("takes no reason at all, and refuses one that is not on the list", async () => {
    await allOn();
    const t = await fresh("Reason");
    const a = await member("A", t.tribe);
    const b = await member("B", t.tribe);
    await expectCode(c.as(a, "my_tribe_leave", "I just do not like the leader"), "22023");
    expect(await c.as(b, "my_tribe_leave")).toMatchObject({ ok: true });
    expect((await seat(b)).status).toBe("released");
    expect((await seat(a)).status).toBe("active");
  });

  it("after the first 14 days says to ask instead, and changes nothing", async () => {
    await allOn();
    const t = await fresh("Late");
    const m = await member("Late", t.tribe);
    await c.sql("update public.seasons set starts_on = current_date - 20 where id = $1", [c.season]);
    expect(await c.as(m, "my_tribe_leave_state")).toMatchObject({ can: false });
    expect(await c.as(m, "my_tribe_leave", "time")).toMatchObject({ ok: false, reason: "later" });
    expect((await seat(m)).status).toBe("active");
    await c.sql("update public.seasons set starts_on = current_date - 3 where id = $1", [c.season]);
  });

  it("does nothing while the seat window is Off: no card, and the call changes nothing", async () => {
    await allOn("off");
    const t = await fresh("Off");
    const m = await member("Off", t.tribe);
    await c.set("seat_window", "off", { reason: REASON });
    expect(await c.as(m, "my_tribe_leave_state")).toMatchObject({ can: false });
    expect(await c.as(m, "my_tribe_leave", "time")).toMatchObject({ ok: false, reason: "off" });
    expect((await seat(m)).status).toBe("active");
    await c.set("seat_window", "rehearsal", { reason: REASON });
    expect(await c.as(m, "my_tribe_leave_state")).toMatchObject({ can: true });
    await allOn();
  });

  it("is only for the person who asks, and only for a seat they hold", async () => {
    const t = await fresh("Own");
    await member("Own", t.tribe);
    const nobody = (await c.k.person("Nobody")).id;
    await expectCode(c.as(nobody, "my_tribe_leave", null), "22023");
    await expectCode(c.anon("my_tribe_leave", null), "42501");
  });
});

describe("the leader's note at 5 pm", () => {
  it("is sent once, at 5 pm, on a day something changed in the tribe, and never outside its hour", async () => {
    await allOn("off");
    const t = await fresh("Note");
    const m = await member("Note", t.tribe);
    await hour(12);
    expect((await seatTick()).notes).toBe(0);
    await hour(17);
    const r = await seatTick();
    expect(r.notes).toBeGreaterThanOrEqual(1);
    const leader = (t as { leader: { id: string } }).leader.id;
    const mail = await mailOf(leader, "leader_seat_note");
    expect(mail).toHaveLength(1);
    expect(mail[0].params).toMatchObject({ yes_n: 1, tribe: expect.any(String) });
    expect(JSON.stringify(mail[0].params)).not.toMatch(/\+?234\d{8,}|@/);
    expect(mail[0].params.yes_names).toHaveLength(1);
    await seatTick();
    expect(await mailOf(leader, "leader_seat_note")).toHaveLength(1);
    void m;
  });

  it("sends nothing when the seat window is Off, and nothing to a tribe where nothing changed today", async () => {
    const t = await fresh("Quiet note");
    await member("Q", t.tribe);
    await hour(17);
    expect((await seatTick()).notes).toBe(0);
    await allOn("off");
    await c.sql("delete from public.messages");
    const t2 = await fresh("Untouched");
    await c.sql("update public.seat_window_settings set paused = false");
    await seatTick();
    expect(await mailOf((t2 as { leader: { id: string } }).leader.id, "leader_seat_note")).toHaveLength(0);
  });
});

describe("the office's email at 7 am", () => {
  it("goes once a day, at 7 am, to admins and directors, with yesterday's numbers and what needs a person", async () => {
    await c.noticesOn();
    await allOn("off");
    await hour(12);
    expect((await seatTick()).morning).toBe(0);
    await hour(7);
    const before = (await c.one("select count(*)::int n from public.messages where template = 'admin_seat_morning'")).n as number;
    const r = await seatTick();
    expect(r.morning).toBeGreaterThanOrEqual(1);
    const after = (await c.one("select count(*)::int n from public.messages where template = 'admin_seat_morning'")).n as number;
    expect(after).toBeGreaterThan(before);
    await seatTick();
    expect((await c.one("select count(*)::int n from public.messages where template = 'admin_seat_morning'")).n).toBe(after);
    const nums = (await c.one("select public.seat_morning_numbers() as r")).r as Record<string, number>;
    // Package 8 adds auto_placed and lapsed to the same numbers
    expect(Object.keys(nums).sort()).toEqual(["auto_placed", "hard", "in_series", "lapsed", "left", "not_reached", "over", "refilled", "released", "small", "stopped", "taken", "yes"]);
    expect(nums.over).toBe(0);
  });

  it("does nothing while the seat window is Off", async () => {
    await hour(7);
    expect((await seatTick()).morning).toBe(0);
  });
});

describe("the grants", () => {
  it("keeps the helpers away from every signed-in user and the public", async () => {
    for (const f of ["reach_release_seat(uuid, text)", "seat_notes_tick()", "seat_morning_tick()", "seat_morning_numbers()", "reach_release_gate()"]) {
      const row = await c.one("select has_function_privilege('authenticated', $1::regprocedure, 'execute') as a, has_function_privilege('anon', $1::regprocedure, 'execute') as b", [`public.${f}`]);
      expect(row, f).toMatchObject({ a: false, b: false });
    }
    const row = await c.one("select has_function_privilege('anon', 'public.my_tribe_leave(text)'::regprocedure, 'execute') as a, has_function_privilege('authenticated', 'public.my_tribe_leave(text)'::regprocedure, 'execute') as b");
    expect(row).toMatchObject({ a: false, b: true });
  });
});
