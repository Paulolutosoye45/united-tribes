import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Contact gaps (fix 13): find the members a leader cannot reach on WhatsApp, say why, ask them, and let a member put it right. What these prove:
//   * it ships Off, and Off means the page says so, nothing is asked, the prompt is quiet and announcements cannot pick the new audience
//   * the cause is exactly why a leader sees nothing: no number, a made-up number, a number but no WhatsApp yes, no way to be reached at all,
//     "Don't share", or contact not open yet; a teenager and a person whose deletion is open are never listed
//   * the list is for the office (admin, director, data lead act; pastor and care lead look); a leader, coach and member are refused; it never
//     carries a number; the download is for those who act and is logged; a daily count is kept for the trend
//   * the announcement audience counts the same people as the list, leaves out the usual people, never asks anyone twice in 14 days or more than
//     three times, is for the office only, and skips a person who has put it right before the email is released
//   * a leader can ask one person of their own tribe, once in 14 days, not more than 20 a day, and is never told why a number is missing
//   * a member sees the prompt, can put it away for a week, and is offered their sign-in number; nobody's yes is ever ticked for them

let c: Cast;
let n = 0;
/** The people a test seated in a tribe. They are taken out again before the next test, because a tribe never holds a 13th active member. */
const made: string[] = [];
let other: { leader: { id: string }; tribe: string };

beforeAll(async () => {
  c = await makeCast();
  other = await c.k.tribe(c.season, { name: "Other Tribe", capacity: 12 });
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  if (made.length > 0) await c.db.admin.query("delete from public.tribe_members where person_id = any($1::uuid[])", [made.splice(0)]);
  await c.sql("delete from public.broadcasts");
  await c.sql("delete from public.contact_asks");
  await c.sql("delete from public.reach_prompts");
  await c.sql("delete from public.contact_gap_days");
  await c.sql("delete from public.contact_preferences");
  await c.sql("delete from public.consents where purpose in ('whatsapp', 'sms', 'email', 'announcements')");
  await c.sql("delete from public.erasure_requests");
  await c.sql("update public.tribe_members set contact_withheld = false, placement_source = 'self', placed_by_run = null");
  await c.sql("update auth.users set phone = null");
});

const REASON = "Trying contact gaps with everyone";
const on = () => c.set("contact_gaps", "on", { reason: REASON });
const rehearse = () => c.set("contact_gaps", "rehearsal", { reason: REASON });
const real = () => `+23480${String(30000000 + ++n * 7919).slice(0, 8)}`;
const save = (who: string, phone: string | null, over: { wa?: boolean; sms?: boolean; email?: boolean } = {}) =>
  c.as(who, "save_contact", phone, over.wa ? "whatsapp" : "email", over.wa ?? false, over.sms ?? false, over.email ?? true, "contact-v1");
const report = (who: string, ...a: unknown[]) => c.as(who, "contact_gaps_report", ...a);
/** A tribe nobody has been seated in, so a list can be read without earlier tests' people in it. */
const fresh = (name: string) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity: 12 });

/** An adult member with a profile and a seat in the seasoned tribe (or another). Nothing else is set: no number, no yes. */
async function member(name: string, tribe = c.seasoned.tribe) {
  const p = await c.k.seat(tribe, c.season, `${name}${++n}`);
  made.push(p.id);
  return p.id;
}
/** Their cause, as the database says it. */
const causeOf = async (id: string) =>
  (await c.one(
    "select public.contact_gap_cause_of($1, (select cm.id from public.tribe_members cm where cm.person_id = $1 and cm.status = 'active' limit 1)) as c",
    [id],
  )).c as string | null;
const phoneOf = (id: string, phone: string) => c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [id, phone]);
const emailOff = (id: string) => c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'contact-v1')", [id]);
async function makeTeen(id: string) {
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
  return id;
}
/** Church-placed and not yet answered: the contact is not open to the leader. */
async function holdIt(id: string) {
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid() where person_id = $1", [id]);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
}

describe("it ships Off", () => {
  it("is on the Switchboard for the whole church, starts Off, and offers Off, Rehearsal and On", async () => {
    const r = await c.one("select * from public.feature_registry where key = 'contact_gaps'");
    expect(r).toMatchObject({ default_mode: "off", available: true, platform_only: true, stage: 8, sort: 27 });
    expect(r.modes).toEqual(["off", "rehearsal", "on"]);
    expect(await c.as(c.admin, "contact_gaps_state")).toBe("off");
  });

  it("changes nothing: the page says Off, nothing can be asked, the prompt is quiet, and announcements cannot pick the audience", async () => {
    const m = await member("Quiet");
    expect(await report(c.admin)).toEqual({ state: "off", role: "act" });
    expect(await c.as(m, "my_reach")).toEqual({ on: false, cause: null, prompt: false, signin: null });
    expect(await c.as(m, "reach_prompt_dismiss")).toEqual({ ok: true, changed: false });
    expect(await c.sql("select 1 from public.reach_prompts")).toHaveLength(0);
    expect(await c.as(c.seasoned.id, "tribe_reach_gaps", c.seasoned.tribe)).toEqual({ on: false, people: [] });
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", m), "22023");
    await expectCode(c.as(c.admin, "audience_preview", { kind: "cannot_reach" }), "22023");
    await expectCode(c.as(c.admin, "contact_gaps_export"), "22023");
    // the existing number-rule answers are untouched
    expect(await c.as(c.seasoned.id, "tribe_number_gaps", c.seasoned.tribe)).toEqual({ on: false, count: 0, names: [] });
  });

  it("is switched off again by pausing the church's switchboard", async () => {
    await on();
    expect(await c.as(c.admin, "contact_gaps_state")).toBe("on");
    await c.sql("update public.feature_master set paused = true, reason = 'Pause test'");
    expect(await c.as(c.admin, "contact_gaps_state")).toBe("off");
    expect(await report(c.admin)).toMatchObject({ state: "off" });
  });
});

describe("the cause", () => {
  it("says why a leader sees nothing, one cause at a time", async () => {
    await on();
    const none = await member("None");
    expect(await causeOf(none)).toBe("no_number");

    const noYes = await member("NoYes");
    await phoneOf(noYes, real());
    expect(await causeOf(noYes)).toBe("no_yes");

    const made = await member("Made");
    await phoneOf(made, "+2348111111111");
    expect(await causeOf(made)).toBe("made_up");

    const fine = await member("Fine");
    await save(fine, real(), { wa: true });
    expect(await causeOf(fine)).toBeNull();

    const hidden = await member("Hidden");
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    expect(await causeOf(hidden)).toBe("withheld");

    const waiting = await member("Waiting");
    await holdIt(waiting);
    expect(await causeOf(waiting)).toBe("not_open");

    const nowhere = await member("Nowhere");
    await emailOff(nowhere);
    expect(await causeOf(nowhere)).toBe("unreachable");
  });

  it("agrees with what a leader is actually shown: a person with no cause is one the leader can open", async () => {
    await on();
    const fine = await member("Visible");
    await save(fine, real(), { wa: true });
    expect(await causeOf(fine)).toBeNull();
    const shown = async (id: string) =>
      ((await c.as(c.seasoned.id, "tribe_roster", c.seasoned.tribe)).members as { person_id: string; whatsapp: string | null }[]).find((x) => x.person_id === id)?.whatsapp ?? null;
    expect(await shown(fine)).toMatch(/^\+/);
    const noYes = await member("Hidden2");
    await phoneOf(noYes, real());
    expect(await causeOf(noYes)).toBe("no_yes");
    expect(await shown(noYes)).toBeNull();
    const none = await member("Empty");
    expect(await shown(none)).toBeNull();
  });

  it("moves with the person: a yes ends the gap, withdrawing it brings the gap back, a number added moves it on", async () => {
    await on();
    const m = await member("Moves");
    expect(await causeOf(m)).toBe("no_number");
    await save(m, real());
    expect(await causeOf(m)).toBe("no_yes");
    await save(m, real(), { wa: true });
    expect(await causeOf(m)).toBeNull();
    await save(m, real(), { wa: false });
    expect(await causeOf(m)).toBe("no_yes");
  });

  it("never lists a teenager or a person whose deletion is open, and ignores a tribe or season that has closed", async () => {
    await on();
    const teen = await makeTeen(await member("Teen"));
    expect(await causeOf(teen)).toBeNull();
    const gone = await member("Gone");
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [gone]);
    expect(await causeOf(gone)).toBeNull();
    const rows = (await report(c.admin)).rows as { person_id: string }[];
    expect(rows.map((r) => r.person_id)).not.toContain(teen);
    expect(rows.map((r) => r.person_id)).not.toContain(gone);
    const left = await member("Left");
    await c.sql("update public.tribe_members set status = 'released' where person_id = $1", [left]);
    expect((await report(c.admin)).rows.map((r: { person_id: string }) => r.person_id)).not.toContain(left);
  });

  it("counts a person in two tribes once", async () => {
    await on();
    const m = await member("Twice");
    const before = (await report(c.admin)).counts.no_number as number;
    await c.sql(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 2, 80, 'test', '{}'::jsonb, current_date + 14) on conflict do nothing`,
      [other.tribe, m, c.season],
    );
    expect((await report(c.admin)).counts.no_number).toBe(before);
  });
});

describe("the office list", () => {
  it("is for the office: admin, director and data lead act; pastor and care lead look; a leader, coach and member are refused", async () => {
    await rehearse();
    const dl = (await c.k.staff("Data", "data_lead")).id;
    const care = (await c.k.staff("Care", "care_lead")).id;
    expect(await report(c.admin)).toMatchObject({ state: "rehearsal", role: "act" });
    expect(await report(c.director)).toMatchObject({ role: "act" });
    expect(await report(dl)).toMatchObject({ role: "act" });
    expect(await report(c.pastor)).toMatchObject({ role: "look" });
    expect(await report(care)).toMatchObject({ role: "look" });
    await expectCode(report(c.seasoned.id), "42501");
    await expectCode(report(c.member), "42501");
    await expectCode(c.anon("contact_gaps_report"), "42501");
  });

  it("counts by cause for the whole church, lists the people with their tribe and leader, and never carries a number", async () => {
    await rehearse();
    const a = await member("Alpha");
    const b = await member("Bravo");
    const num = real();
    await phoneOf(b, num);
    const out = await report(c.admin);
    expect(out.counts.no_number).toBeGreaterThanOrEqual(1);
    expect(out.counts.no_yes).toBeGreaterThanOrEqual(1);
    expect(out.adults).toBeGreaterThanOrEqual(out.total);
    const row = out.rows.find((r: { person_id: string }) => r.person_id === a);
    expect(row).toMatchObject({ cause: "no_number", tribe_id: c.seasoned.tribe, asks: 0, last_asked: null });
    expect(row.leader).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain(num);
    expect(JSON.stringify(out)).not.toContain(num.slice(-8));
  });

  it("puts the people who cannot be reached at all first, then no number, then no yes", async () => {
    await rehearse();
    const nowhere = await member("Nowhere");
    await emailOff(nowhere);
    const noYes = await member("Noyes");
    await phoneOf(noYes, real());
    const causes = (await report(c.admin)).rows.map((r: { cause: string }) => r.cause) as string[];
    const rank = (x: string) => ["unreachable", "no_number", "no_yes", "made_up", "not_open", "withheld"].indexOf(x);
    expect(causes.map(rank)).toEqual([...causes.map(rank)].sort((p, q) => p - q));
    expect(causes[0]).toBe("unreachable");
  });

  it("filters by cause and tribe, pages, and refuses a cause it does not know", async () => {
    await rehearse();
    const mine = await fresh("FilterT");
    const a = await member("InOther", mine.tribe);
    const noYes = await member("Filter");
    await phoneOf(noYes, real());
    const byTribe = await report(c.admin, null, mine.tribe);
    expect(byTribe.rows.map((r: { person_id: string }) => r.person_id)).toEqual([a]);
    expect(byTribe.total).toBe(1);
    const byCause = await report(c.admin, "no_yes");
    expect(byCause.rows.every((r: { cause: string }) => r.cause === "no_yes")).toBe(true);
    expect(byCause.rows.map((r: { person_id: string }) => r.person_id)).toContain(noYes);
    const page = await report(c.admin, null, null, null, 1, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    await expectCode(report(c.admin, "nonsense"), "22023");
  });

  it("keeps one count a day for the trend, replaced when the list is opened again", async () => {
    await rehearse();
    await member("Trend");
    await report(c.admin);
    expect(await c.sql("select 1 from public.contact_gap_days")).toHaveLength(1);
    await member("Trend2");
    const second = await report(c.admin);
    expect(await c.sql("select 1 from public.contact_gap_days")).toHaveLength(1);
    expect(second.trend).toHaveLength(1);
    expect(second.trend[0].counts.no_number).toBe(second.counts.no_number);
  });

  it("logs that it was opened and that it was downloaded", async () => {
    await on();
    await member("Logged");
    const seen = async (a: string) => (await c.one("select count(*)::int n from public.event_log where action = $1 and actor_id = $2", [a, c.admin])).n as number;
    const v0 = await seen("contact_gaps.viewed");
    await report(c.admin);
    expect(await seen("contact_gaps.viewed")).toBe(v0 + 1);
    // a filtered look is not logged again
    await report(c.admin, "no_number");
    expect(await seen("contact_gaps.viewed")).toBe(v0 + 1);
    const x0 = await seen("contact_gaps.exported");
    const file = await c.as(c.admin, "contact_gaps_export");
    expect(file.length).toBeGreaterThan(0);
    expect(Object.keys(file[0]).sort()).toEqual(["asks", "cause", "emails", "last_asked", "leader", "name", "number_confirmed", "series", "tribe"]);
    expect(await seen("contact_gaps.exported")).toBe(x0 + 1);
  });

  it("lets only those who act download it", async () => {
    await on();
    await expectCode(c.as(c.pastor, "contact_gaps_export"), "42501");
    await expectCode(c.as(c.seasoned.id, "contact_gaps_export"), "42501");
    expect(await c.as(c.director, "contact_gaps_export")).toBeInstanceOf(Array);
  });
});

describe("the announcement audience", () => {
  const count = async (spec: Record<string, unknown>, who = c.admin) => c.as(who, "audience_preview", spec);

  it("counts the same people as the list, for each group and for both", async () => {
    await on();
    const none = await member("A");
    const noYes = await member("B");
    await phoneOf(noYes, real());
    const made = await member("C");
    await phoneOf(made, "+2348111111111");
    const list = await report(c.admin);
    const either = await count({ kind: "cannot_reach" });
    expect(either.spec).toEqual({ kind: "cannot_reach", cause: "either" });
    expect(either.total).toBe((list.counts.no_number ?? 0) + (list.counts.made_up ?? 0) + (list.counts.no_yes ?? 0));
    const noNumber = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(noNumber.total).toBe((list.counts.no_number ?? 0) + (list.counts.made_up ?? 0));
    const justYes = await count({ kind: "cannot_reach", cause: "no_yes" });
    expect(justYes.total).toBe(list.counts.no_yes ?? 0);
    expect(none && made).toBeTruthy();
  });

  it("narrows by tribe and by community, and refuses a tribe or a cause it does not know", async () => {
    await on();
    const mine = await fresh("Narrow");
    const a = await member("InOther", mine.tribe);
    await member("InSeasoned");
    const one = await count({ kind: "cannot_reach", tribe: mine.tribe });
    expect(one.total).toBe(1);
    const sample = await c.as(c.admin, "audience_sample", { kind: "cannot_reach", tribe: mine.tribe }, 0);
    expect(sample.found).toBe(true);
    expect(a).toBeTruthy();
    await expectCode(count({ kind: "cannot_reach", tribe: "00000000-0000-0000-0000-000000000000" }), "22023");
    await expectCode(count({ kind: "cannot_reach", tribe: "not-a-tribe" }), "22023");
    await expectCode(count({ kind: "cannot_reach", cause: "everything" }), "22023");
    const inCommunity = await count({ kind: "cannot_reach", community: (await c.one("select id from public.communities where slug = 'professionals'")).id });
    expect(inCommunity.total).toBeGreaterThan(0);
  });

  it("leaves out the usual people, and says why", async () => {
    await on();
    const stopped = await member("Stopped");
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'announcements', false, 'x')", [stopped]);
    const hardBounce = await member("Bounced");
    await c.sql("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [hardBounce]);
    const out = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(out.skipped).toMatchObject({ announcements_off: 1 });
    // a bounced address with no number is "unreachable", so it is not in this audience at all
    expect(await causeOf(hardBounce)).toBe("unreachable");
  });

  it("is for the office only: a champion is refused, and so is anyone who is not office", async () => {
    await on();
    const champ = (await c.k.staff("Champ", "community_champion")).id;
    await expectCode(count({ kind: "cannot_reach" }, champ), "42501");
    await expectCode(count({ kind: "cannot_reach" }, c.seasoned.id), "42501");
    expect((await count({ kind: "cannot_reach" }, c.director)).total).toBeGreaterThanOrEqual(0);
  });

  it("never asks the same person twice in 14 days, or more than three times", async () => {
    await on();
    const m = await member("Asked");
    const before = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(before.skipped.asked_recently ?? 0).toBe(0);
    await c.as(c.seasoned.id, "contact_ask_send", m);
    const after = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(after.skipped.asked_recently).toBe(1);
    expect(after.will_send).toBe(before.will_send - 1);
    // asked three times
    await c.sql("update public.contact_asks set created_at = now() - interval '30 days'");
    await c.sql("insert into public.contact_asks (person_id, kind, by_person, created_at) select $1, 'no_number', $2, now() - interval '40 days' from generate_series(1, 2)", [m, c.seasoned.id]);
    const three = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(three.skipped.asked_enough).toBe(1);
    expect(three.skipped.asked_recently ?? 0).toBe(0);
  });

  it("counts an announcement's own asks too, from the day it is approved", async () => {
    await on();
    await member("Announced");
    await clock();
    const id = await c.as(c.director, "broadcast_save", null, JSON.stringify(fields({ audience: { kind: "cannot_reach", cause: "no_number" } })));
    const sent = await c.as(c.director, "broadcast_submit", id, null);
    expect(sent.count).toBeGreaterThan(0);
    const again = await count({ kind: "cannot_reach", cause: "no_number" });
    expect(again.will_send).toBe(0);
    expect(again.skipped.asked_recently).toBe(sent.count);
  });

  const fields = (over: Record<string, unknown> = {}) => ({
    title: "Add your number",
    audience: { kind: "cannot_reach", cause: "no_number" },
    audience_label: "Cannot be reached on WhatsApp",
    subject: "Your leader would like to reach you, {first_name}",
    paragraphs: ["We do not have a phone number for you yet.", "Add one if you are happy to."],
    button_label: "Choose how you are reached",
    button_target: "/profile",
    ...over,
  });
  const clock = () =>
    c.db.admin.query(
      `create or replace function public.lagos_hour() returns integer language sql as $$ select 10 $$;
       create or replace function public.lagos_dow() returns integer language sql as $$ select 3 $$;`,
    );

  it("skips a person who has put it right before the email is released, and sends the rest", async () => {
    await on();
    await clock();
    const fixed = await member("Fixed");
    const stays = await member("Stays");
    const id = await c.as(c.director, "broadcast_save", null, JSON.stringify(fields()));
    const out = await c.as(c.director, "broadcast_submit", id, null);
    expect(out.status).toBe("scheduled");
    expect((await c.sql("select 1 from public.broadcast_recipients where broadcast_id = $1 and person_id = $2", [id, fixed])).length).toBe(1);
    await save(fixed, real(), { wa: true });
    await c.sql("update public.broadcasts set scheduled_for = now() - interval '1 minute' where id = $1", [id]);
    await c.sql("select public.broadcasts_release()");
    const rec = await c.sql("select person_id, status, reason from public.broadcast_recipients where broadcast_id = $1", [id]);
    const by = Object.fromEntries(rec.map((r) => [r.person_id, r]));
    expect(by[fixed]).toMatchObject({ status: "skipped", reason: "gap_closed" });
    expect(by[stays]).toMatchObject({ status: "queued", reason: null });
  });

  it("keeps the old audiences exactly as they were", async () => {
    await on();
    for (const kind of ["everyone", "started", "finished_no_tribe", "in_tribe", "leaders"]) {
      expect((await count({ kind })).spec).toEqual({ kind });
    }
    await expectCode(count({ kind: "somebody_else" }), "22023");
  });
});

describe("a leader asks one person", () => {
  it("lists the people of the tribe whose number cannot be shown, by first name, and never says why", async () => {
    await on();
    const mine = await fresh("Listing");
    const none = await member("Nope", mine.tribe);
    const noYes = await member("Maybe", mine.tribe);
    await phoneOf(noYes, real());
    const fine = await member("Okay", mine.tribe);
    await save(fine, real(), { wa: true });
    const hidden = await member("Private", mine.tribe);
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    const waiting = await member("Hold", mine.tribe);
    await holdIt(waiting);
    const out = await c.as(mine.leader.id, "tribe_reach_gaps", mine.tribe);
    const ids = out.people.map((p: { person_id: string }) => p.person_id);
    expect(ids).toContain(none);
    expect(ids).toContain(noYes);
    expect(ids).not.toContain(fine);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(waiting);
    for (const p of out.people) {
      expect(Object.keys(p).sort()).toEqual(["asked_at", "first_name", "person_id", "state"]);
      expect(p.state).toBe("ask");
    }
    expect(JSON.stringify(out)).not.toMatch(/no_yes|no_number|made_up|consent|whatsapp/i);
  });

  it("refuses a person who does not run the tribe", async () => {
    await on();
    await expectCode(c.as(c.member, "tribe_reach_gaps", c.seasoned.tribe), "42501");
    await expectCode(c.as(other.leader.id, "tribe_reach_gaps", c.seasoned.tribe), "42501");
  });

  it("sends one polite email, signed with the leader's first name, and never changes the person's choices", async () => {
    await on();
    const m = await member("Ask");
    await phoneOf(m, real());
    const consentsBefore = await c.sql("select purpose, granted from public.consents where person_id = $1 order by id", [m]);
    const prefBefore = await c.one("select phone, preferred from public.contact_preferences where person_id = $1", [m]);
    expect(await c.as(c.seasoned.id, "contact_ask_send", m)).toEqual({ ok: true, kind: "no_yes" });
    const msg = await c.one("select template, force_channel, params, person_id from public.messages where template = 'contact_ask_leader' and person_id = $1", [m]);
    expect(msg).toMatchObject({ template: "contact_ask_leader", force_channel: "email", person_id: m });
    expect(msg.params).toMatchObject({ kind: "no_yes" });
    expect(String(msg.params.leader_first).length).toBeGreaterThan(0);
    expect(await c.sql("select purpose, granted from public.consents where person_id = $1 order by id", [m])).toEqual(consentsBefore);
    expect(await c.one("select phone, preferred from public.contact_preferences where person_id = $1", [m])).toEqual(prefBefore);
    expect((await c.one("select kind, by_person from public.contact_asks where person_id = $1", [m]))).toMatchObject({ kind: "no_yes", by_person: c.seasoned.id });
    expect((await c.one("select count(*)::int n from public.event_log where action = 'contact.ask' and entity_id = $1", [m])).n).toBe(1);
  });

  it("asks for a number when there is none, and for the yes when there is a number", async () => {
    await on();
    const none = await member("NoNum");
    expect(await c.as(c.seasoned.id, "contact_ask_send", none)).toMatchObject({ kind: "no_number" });
    const made = await member("Fake");
    await phoneOf(made, "+2348111111111");
    expect(await c.as(c.seasoned.id, "contact_ask_send", made)).toMatchObject({ kind: "no_number" });
  });

  it("waits 14 days, says so, and shows the leader who was asked", async () => {
    await on();
    const m = await member("Wait");
    await c.as(c.seasoned.id, "contact_ask_send", m);
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", m), "22023");
    await expect(c.as(c.seasoned.id, "contact_ask_send", m)).rejects.toThrow(/last two weeks/);
    const out = await c.as(c.seasoned.id, "tribe_reach_gaps", c.seasoned.tribe);
    const row = out.people.find((p: { person_id: string }) => p.person_id === m);
    expect(row.state).toBe("asked");
    expect(row.asked_at).toBeTruthy();
    await c.sql("update public.contact_asks set created_at = now() - interval '15 days'");
    expect(await c.as(c.seasoned.id, "contact_ask_send", m)).toMatchObject({ ok: true });
    await c.sql("update public.contact_asks set created_at = now() - interval '15 days'");
    expect(await c.as(c.seasoned.id, "contact_ask_send", m)).toMatchObject({ ok: true });
    await c.sql("update public.contact_asks set created_at = now() - interval '15 days'");
    // three asks is enough: after that it is for a person to do in person
    await expect(c.as(c.seasoned.id, "contact_ask_send", m)).rejects.toThrow(/three times/);
    const again = await c.as(c.seasoned.id, "tribe_reach_gaps", c.seasoned.tribe);
    expect(again.people.find((p: { person_id: string }) => p.person_id === m).state).toBe("in_person");
  });

  it("will not email someone who cannot be emailed: it says to ask in person", async () => {
    await on();
    const nowhere = await member("Nowhere");
    await emailOff(nowhere);
    await expect(c.as(c.seasoned.id, "contact_ask_send", nowhere)).rejects.toThrow(/in person/);
    const out = await c.as(c.seasoned.id, "tribe_reach_gaps", c.seasoned.tribe);
    expect(out.people.find((p: { person_id: string }) => p.person_id === nowhere).state).toBe("in_person");
    expect(await c.sql("select 1 from public.messages where template = 'contact_ask_leader' and person_id = $1", [nowhere])).toHaveLength(0);
  });

  it("refuses when there is nothing to ask, for someone else's member, for a stranger, and for a signed-out caller", async () => {
    await on();
    const fine = await member("Fine");
    await save(fine, real(), { wa: true });
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", fine), "22023");
    const hidden = await member("Hide");
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", hidden), "22023");
    const waiting = await member("Hold");
    await holdIt(waiting);
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", waiting), "22023");
    const mine = await member("Mine");
    await expectCode(c.as(other.leader.id, "contact_ask_send", mine), "42501");
    await expectCode(c.as(c.member, "contact_ask_send", mine), "42501");
    await expectCode(c.anon("contact_ask_send", mine), "42501");
    const teen = await makeTeen(await member("Teen"));
    await expectCode(c.as(c.seasoned.id, "contact_ask_send", teen), "22023");
  });

  it("stops at 20 a day from one leader", async () => {
    await on();
    // A tribe holds 12 at most, so the twenty earlier requests today are written down directly; the twenty-first is the one asked for
    const first = await member("Many0");
    await c.sql("insert into public.contact_asks (person_id, kind, by_person, created_at) select $1, 'no_number', $2, now() - interval '1 hour' from generate_series(1, 20)", [first, c.seasoned.id]);
    const next = await member("Many1");
    await expect(c.as(c.seasoned.id, "contact_ask_send", next)).rejects.toThrow(/20 requests/);
  });

  it("also lets an assistant and a coach ask", async () => {
    await on();
    const coach = (await c.k.staff("Coachy", "coach")).id;
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [c.seasoned.tribe, coach]);
    const m = await member("ByCoach");
    expect(await c.as(coach, "contact_ask_send", m)).toMatchObject({ ok: true });
  });
});

describe("what the member sees", () => {
  it("shows the prompt to an adult in a tribe with a gap, and nothing to one without", async () => {
    await on();
    const none = await member("Prompt");
    expect(await c.as(none, "my_reach")).toMatchObject({ on: true, cause: "no_number", prompt: true });
    const noYes = await member("Prompt2");
    await phoneOf(noYes, real());
    expect(await c.as(noYes, "my_reach")).toMatchObject({ cause: "no_yes", prompt: true, signin: null });
    const fine = await member("Prompt3");
    await save(fine, real(), { wa: true });
    expect(await c.as(fine, "my_reach")).toEqual({ on: true, cause: null, prompt: false, signin: null });
    // not in a tribe, a leader and a teenager are not asked
    expect(await c.as(c.member, "my_reach")).toMatchObject({ cause: null, prompt: false });
    expect(await c.as(c.seasoned.id, "my_reach")).toMatchObject({ cause: null, prompt: false });
    const teen = await makeTeen(await member("Prompt4"));
    expect(await c.as(teen, "my_reach")).toMatchObject({ cause: null, prompt: false });
    // the office's own reasons are not shown to the member
    const hidden = await member("Prompt5");
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    expect(await c.as(hidden, "my_reach")).toMatchObject({ cause: null, prompt: false });
  });

  it("puts the prompt away for a week with Not now", async () => {
    await on();
    const m = await member("Later");
    expect(await c.as(m, "reach_prompt_dismiss")).toEqual({ ok: true, changed: true });
    expect(await c.as(m, "my_reach")).toMatchObject({ cause: "no_number", prompt: false });
    await c.sql("update public.reach_prompts set dismissed_at = now() - interval '8 days' where person_id = $1", [m]);
    expect(await c.as(m, "my_reach")).toMatchObject({ prompt: true });
    await c.as(m, "reach_prompt_dismiss");
    expect((await c.one("select times from public.reach_prompts where person_id = $1", [m])).times).toBe(2);
  });

  it("offers the number they sign in with, to them alone, only when they have no usable number", async () => {
    await on();
    const m = await member("Signin");
    await c.sql("update auth.users set phone = '2348031234567' where id = $1", [m]);
    expect(await c.as(m, "my_reach")).toMatchObject({ cause: "no_number", signin: "+2348031234567" });
    // a made-up sign-in number is not offered
    await c.sql("update auth.users set phone = '2348111111111' where id = $1", [m]);
    expect((await c.as(m, "my_reach")).signin).toBeNull();
    // someone who already has a good number is not offered another
    const has = await member("Signin2");
    await phoneOf(has, real());
    await c.sql("update auth.users set phone = '2348031234567' where id = $1", [has]);
    expect((await c.as(has, "my_reach")).signin).toBeNull();
    // nobody else can read it
    expect(JSON.stringify(await report(c.admin))).not.toContain("2348031234567");
  });

  it("never ticks a yes for anyone: nothing in here writes a consent", async () => {
    await on();
    const m = await member("NoTick");
    await phoneOf(m, real());
    const before = (await c.one("select count(*)::int n from public.consents")).n;
    await c.as(m, "my_reach");
    await c.as(m, "reach_prompt_dismiss");
    await c.as(c.seasoned.id, "contact_ask_send", m);
    await report(c.admin);
    await c.as(c.admin, "audience_preview", { kind: "cannot_reach" });
    expect((await c.one("select count(*)::int n from public.consents")).n).toBe(before);
    expect(await causeOf(m)).toBe("no_yes");
  });
});

describe("who may call what", () => {
  it("keeps the helpers out of reach and the screens' functions for signed-in people only", async () => {
    const internal = [
      ["contact_gap_cause_of", "uuid, uuid"],
      ["contact_gap_rows", "uuid"],
      ["contact_gap_causes", "text"],
      ["contact_gap_still", "uuid, text"],
      ["contact_ask_history", "uuid"],
      ["contact_ask_blocker", "uuid"],
      ["contact_gaps_role", ""],
    ];
    for (const [fn, args] of internal) {
      const r = await c.one(
        `select has_function_privilege('authenticated', 'public.${fn}(${args})', 'execute') as a, has_function_privilege('anon', 'public.${fn}(${args})', 'execute') as n`,
      );
      expect(r, fn).toEqual({ a: false, n: false });
    }
    const screens = [
      ["contact_gaps_state", ""],
      ["contact_gaps_report", "text, uuid, uuid, integer, integer, text"],
      ["contact_gaps_export", ""],
      ["tribe_reach_gaps", "uuid"],
      ["contact_ask_send", "uuid"],
      ["my_reach", ""],
      ["reach_prompt_dismiss", ""],
    ];
    for (const [fn, args] of screens) {
      const r = await c.one(
        `select has_function_privilege('authenticated', 'public.${fn}(${args})', 'execute') as a, has_function_privilege('anon', 'public.${fn}(${args})', 'execute') as n`,
      );
      expect(r, fn).toEqual({ a: true, n: false });
    }
  });

  it("gives the three new tables no access to anyone", async () => {
    for (const t of ["contact_asks", "reach_prompts", "contact_gap_days"]) {
      const r = await c.one(`select has_table_privilege('authenticated', 'public.${t}', 'select') as a, has_table_privilege('anon', 'public.${t}', 'select') as n`);
      expect(r, t).toEqual({ a: false, n: false });
    }
  });
});
