import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The contact series and the tribe note (Package 5 of "seats and contacts"). What these prove:
//   * both functions ship Off, Off does nothing at all, and the Master pause freezes a running series and gives it back the days it had left
//   * who enters: an adult with a seat and a gap a person can put right, and nobody else (not a teenager, not a deletion, not "Don't share", not a
//     person who cannot be emailed, not a care follow-up, not someone still on the placement clock)
//   * the schedule: email 1 after the leader's 24 hours or at their word, then days 2, 4 and 5, only between 9 am and 7 pm, never twice, never late (the
//     whole series moves on instead), and the end at day 6 writes down what happened and moves no seat
//   * the ending: fixed (by whichever email), chose email, seen but not done, silent, not reached
//   * the private page: it needs the sending service's token and a link we made, opening it changes nothing, it saves only for the person the link
//     was made for, it never withdraws a yes, and an expired link can ask for a new one
//   * the leader: Ask my members (their line, once in three days, never a link), "I'll follow this up myself" (three days, once), and the tribe note
//     (600 characters, two a week, no links, only to people who may be written to)
//   * the office: the stage of each person, the filters, the counts that equal the rows, the pause for everyone, a stop for one person, no numbers
//   * the permission lists

let c: Cast;
let n = 0;
let token: string;

const REASON = "Trying the contact series";
const clock = (hour: number) => c.db.admin.query(`create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$`);
const unclock = () =>
  c.db.admin.query(
    "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$",
  );
const on = async () => {
  await c.set("contact_gaps", "on", { reason: REASON });
  await c.set("reach_series", "on", { reason: REASON });
};
const rehearse = async () => {
  await c.set("contact_gaps", "on", { reason: REASON });
  await c.set("reach_series", "rehearsal", { reason: REASON });
};
const noteOn = (position = "on") => c.set("tribe_note", position, { reason: REASON });
const tick = () => c.anon("worker_reach_tick", token);
const real = () => `+23480${String(30000000 + ++n * 7919).slice(0, 8)}`;
const fresh = (name: string) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity: 12 });
async function member(name: string, tribe: string) {
  return (await c.k.seat(tribe, c.season, `${name}${++n}`)).id;
}
const enrolment = async (id: string) => (await c.sql("select * from public.reach_enrolments where person_id = $1 order by started_at desc limit 1", [id]))[0];
const mailOf = (id: string, template = "reach_series") =>
  c.sql("select * from public.messages where person_id = $1 and template = $2 order by created_at, id", [id, template]);
const goFirst = (id: string) => c.sql("update public.reach_enrolments set first_go_until = now() - interval '1 minute' where person_id = $1 and status = 'active'", [id]);
/** Moves the whole series back in time: the days the test wants to have passed. */
const back = (id: string, by: string) =>
  c.sql("update public.reach_enrolments set day0_at = day0_at - $2::interval, first_go_until = first_go_until - $2::interval where person_id = $1 and status = 'active'", [id, by]);
const delivered = (id: string) =>
  c.sql("update public.messages set status = 'sent', sent_at = now() where person_id = $1 and template = 'reach_series' and status = 'queued'", [id]);
const save = (who: string, phone: string | null, wa = false) => c.as(who, "save_contact", phone, wa ? "whatsapp" : "email", wa, false, true, "contact-v1");
const yes = (id: string) => c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'contact-v1')", [id]);
const phoneOf = (id: string, phone: string) => c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [id, phone]);
const seatsActive = async (tribe: string) => (await c.one("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [tribe])).n as number;
async function replica(sql: string, params: unknown[]) {
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query(sql, params);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
}
const makeTeen = (id: string) =>
  replica("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
const link = async (id: string, template = "reach_series") => {
  const rows = await mailOf(id, template);
  const raw = rows[rows.length - 1]?.reply_token as string | undefined;
  expect(raw).toMatch(/^[a-f0-9]{64}$/);
  return raw as string;
};
const info = (l: string) => c.anon("worker_reach_info", token, l);

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('reach-test') as t")).t as string;
}, 120_000);

afterAll(async () => {
  await unclock();
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await unclock();
  await c.sql("delete from public.reach_enrolments");
  await c.sql("delete from public.reach_links");
  await c.sql("delete from public.reach_leader_asks");
  await c.sql("delete from public.tribe_notes");
  await c.sql("delete from public.messages where template in ('reach_series', 'reach_new_link', 'tribe_note', 'contact_ask_leader')");
  await c.sql("delete from public.contact_asks");
  await c.sql("delete from public.broadcasts");
  await c.sql("update public.reach_settings set first_go_hours = 24, release_after_days = 6, end_mode = 'silent', note_per_week = 2, paused = false, paused_reason = null, swept_at = null");
  await c.sql("delete from public.contact_preferences");
  await c.sql("delete from public.consents where purpose in ('whatsapp', 'sms', 'email', 'announcements')");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.care_flags");
  await c.sql("delete from public.email_signals");
  await c.sql("update public.tribe_members set contact_withheld = false, placement_source = 'self', placed_by_run = null, status = 'active'");
  await c.sql("update auth.users set phone = null");
});

describe("it ships Off", () => {
  it("is on the Switchboard, starts Off, offers Off, Rehearsal and On, can be limited to a place, and needs Contact gaps", async () => {
    const a = await c.one("select * from public.feature_registry where key = 'reach_series'");
    expect(a).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 28 });
    expect(a.modes).toEqual(["off", "rehearsal", "on"]);
    expect(a.depends).toEqual(["contact_gaps"]);
    const b = await c.one("select * from public.feature_registry where key = 'tribe_note'");
    expect(b).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 29 });
    expect(b.depends).toEqual([]);
  });

  it("does nothing at all while Off: no one is put in, nothing is sent, the buttons are refused and the strip says Off", async () => {
    const t = await fresh("Quiet");
    const m = await member("Quiet", t.tribe);
    expect(await tick()).toEqual({ ran: false });
    expect(await c.sql("select 1 from public.reach_enrolments")).toHaveLength(0);
    expect(await mailOf(m)).toHaveLength(0);
    expect(await c.as(t.leader.id, "tribe_reach", t.tribe)).toMatchObject({ on: false, note: { state: "off" } });
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, null), "22023");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello"), "22023");
  });

  it("needs Contact gaps On: the series cannot be switched on without it", async () => {
    await expect(c.set("reach_series", "on", { reason: REASON })).rejects.toThrow();
    await c.set("contact_gaps", "on", { reason: REASON });
    await c.set("reach_series", "on", { reason: REASON });
  });

  it("can be switched on for one tribe only", async () => {
    await c.set("contact_gaps", "on", { reason: REASON });
    const a = await fresh("Chosen");
    const b = await fresh("Left out");
    await c.set("reach_series", "on", { scope: "tribe", id: a.tribe, reason: REASON });
    const ma = await member("Chosen", a.tribe);
    const mb = await member("Left", b.tribe);
    await tick();
    expect(await enrolment(ma)).toMatchObject({ status: "active" });
    expect(await enrolment(mb)).toBeUndefined();
  });
});

describe("who is put in the series", () => {
  it("is every adult in a seat with a gap a person can put right: no number, a number but no yes, a number that looks made up", async () => {
    await on();
    const t = await fresh("Gaps");
    const none = await member("None", t.tribe);
    const noYes = await member("NoYes", t.tribe);
    await phoneOf(noYes, real());
    const made = await member("Made", t.tribe);
    await phoneOf(made, "+2348111111111");
    await yes(made);
    const fine = await member("Fine", t.tribe);
    await save(fine, real(), true);
    await tick();
    expect(await enrolment(none)).toMatchObject({ kind: "no_number", status: "active", rehearsal: false, sends: 0 });
    expect(await enrolment(noYes)).toMatchObject({ kind: "no_yes" });
    expect(await enrolment(made)).toMatchObject({ kind: "no_number" });
    expect(await enrolment(fine)).toBeUndefined();
  });

  it("is nobody else: a teenager, a deletion, a person who said Don't share, a person who cannot be emailed, a bounced address, a care follow-up", async () => {
    await on();
    const t = await fresh("Never");
    const teen = await member("Teen", t.tribe);
    await makeTeen(teen);
    const gone = await member("Gone", t.tribe);
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [gone]);
    const hidden = await member("Hidden", t.tribe);
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    const nowhere = await member("Nowhere", t.tribe);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'contact-v1')", [nowhere]);
    const bounced = await member("Bounced", t.tribe);
    await c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [bounced]);
    const care = await member("Care", t.tribe);
    await c.sql("insert into public.care_flags (tribe_id, person_id, kind, week) values ($1, $2, 'missed_twice', 1)", [t.tribe, care]);
    const waiting = await member("Waiting", t.tribe);
    await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid() where person_id = $1", [waiting]);
    await tick();
    for (const id of [teen, gone, hidden, nowhere, bounced, care, waiting]) expect(await enrolment(id)).toBeUndefined();
  });

  it("is once for a person in a season: after it has ended they are not put in again, and a tribe that has closed puts nobody in", async () => {
    await on();
    const t = await fresh("Once");
    const m = await member("Once", t.tribe);
    await tick();
    await c.as(c.admin, "reach_series_stop", m, "Stopped for the test");
    await c.sql("update public.reach_settings set swept_at = null");
    await tick();
    expect(await c.sql("select 1 from public.reach_enrolments where person_id = $1", [m])).toHaveLength(1);
    const closed = await fresh("Closed");
    const x = await member("Shut", closed.tribe);
    await c.sql("update public.tribes set status = 'closed' where id = $1", [closed.tribe]);
    await c.sql("update public.reach_settings set swept_at = null");
    await tick();
    expect(await enrolment(x)).toBeUndefined();
  });

  it("writes a Rehearsal that sends nothing, and starts clean when the switch moves to On", async () => {
    await rehearse();
    await clock(12);
    const t = await fresh("Rehearse");
    const m = await member("Rehearse", t.tribe);
    await tick();
    expect(await enrolment(m)).toMatchObject({ rehearsal: true, status: "active" });
    await goFirst(m);
    await tick();
    expect(await enrolment(m)).toMatchObject({ sends: 1 });
    expect((await c.sql("select status from public.reach_sends"))[0].status).toBe("would_send");
    expect(await mailOf(m)).toHaveLength(0);
    // The real thing starts: the Rehearsal is over and a live series begins from the start
    await c.set("reach_series", "on", { reason: REASON });
    await c.sql("update public.reach_settings set swept_at = null");
    await tick();
    const rows = await c.sql("select rehearsal, status, outcome, sends from public.reach_enrolments where person_id = $1 order by rehearsal", [m]);
    expect(rows).toEqual([
      { rehearsal: false, status: "active", outcome: null, sends: 0 },
      { rehearsal: true, status: "ended", outcome: "rehearsal_over", sends: 1 },
    ]);
    expect(await mailOf(m)).toHaveLength(0);
  });
});

describe("the schedule", () => {
  it("sends emails 1 to 4 on days 0, 2, 4 and 5 in the leader's name and the church's, then ends at day 6 and moves no seat", async () => {
    await on();
    await clock(12);
    const t = await fresh("Schedule");
    const m = await member("Walker", t.tribe);
    const seats = await seatsActive(t.tribe);
    await tick();
    // The leader has 24 hours: nothing goes yet
    await tick();
    expect(await mailOf(m)).toHaveLength(0);
    await goFirst(m);
    await tick();
    expect(await enrolment(m)).toMatchObject({ sends: 1 });
    await tick();
    expect(await mailOf(m)).toHaveLength(1);
    const one = (await mailOf(m))[0];
    expect(one).toMatchObject({ force_channel: "email", status: "queued" });
    expect(one.params).toMatchObject({ n: 1, kind: "no_number", has_group: false, release_on: false });
    expect(one.params.line).toBeUndefined();
    await back(m, "2 days");
    await tick();
    await back(m, "2 days");
    await tick();
    await back(m, "1 day");
    await tick();
    const rows = await mailOf(m);
    expect(rows.map((r) => r.params.n)).toEqual([1, 2, 3, 4]);
    expect(new Set(rows.map((r) => r.reply_token)).size).toBe(4);
    // Each link is a 64-character secret and only its fingerprint is kept
    expect(await c.sql("select 1 from public.reach_links")).toHaveLength(4);
    expect(JSON.stringify(await c.sql("select token_hash from public.reach_links"))).not.toContain(rows[0].reply_token);
    // Day 5 is not the end: day 6 is
    await delivered(m);
    await c.sql("delete from public.event_log where actor_id = $1", [m]);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "active", sends: 4 });
    await back(m, "1 day");
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "silent", sends: 4 });
    // Nothing was released
    expect(await seatsActive(t.tribe)).toBe(seats);
    expect(await mailOf(m)).toHaveLength(4);
  });

  it("sends only between 9 am and 7 pm Lagos time", async () => {
    await on();
    const t = await fresh("Window");
    const m = await member("Window", t.tribe);
    await clock(12);
    await tick();
    await goFirst(m);
    for (const hour of [3, 8, 19, 22]) {
      await clock(hour);
      await tick();
      expect(await mailOf(m)).toHaveLength(0);
    }
    await clock(9);
    await tick();
    expect(await mailOf(m)).toHaveLength(1);
  });

  it("does not send an email that is more than two days late: the series moves on by the days lost, and nothing goes twice", async () => {
    await on();
    await clock(12);
    const t = await fresh("Late");
    const m = await member("Late", t.tribe);
    await tick();
    await goFirst(m);
    await tick();
    await back(m, "5 days");
    const r = await tick();
    expect(r.steps).toMatchObject({ shifted: 1 });
    // Three days and a few seconds late is four whole days: the next email is then due ahead of us, not behind
    expect(await enrolment(m)).toMatchObject({ sends: 1, shift_days: 4 });
    await tick();
    expect(await mailOf(m)).toHaveLength(1);
    // An email only a little late still goes
    await c.sql("update public.reach_enrolments set shift_days = 0, day0_at = now() - interval '3 days' where person_id = $1", [m]);
    await tick();
    expect(await mailOf(m)).toHaveLength(2);
    // The same beat twice cannot send twice
    await tick();
    expect(await mailOf(m)).toHaveLength(2);
  });

  it("freezes under the Master pause and the office's pause and gives the series back exactly the days it had left", async () => {
    await on();
    await clock(12);
    const t = await fresh("Frozen");
    const m = await member("Frozen", t.tribe);
    await tick();
    await goFirst(m);
    await tick();
    const before = (await enrolment(m)).day0_at as Date;
    await c.sql("update public.feature_master set paused = true, reason = 'Pause test'");
    await tick();
    expect(await enrolment(m)).toMatchObject({ frozen_at: expect.anything(), frozen_why: "switch" });
    await back(m, "0 days");
    await c.sql("update public.reach_enrolments set frozen_at = frozen_at - interval '3 days' where person_id = $1", [m]);
    await c.sql("update public.feature_master set paused = false");
    await tick();
    const after = await enrolment(m);
    expect(after.frozen_at).toBeNull();
    expect(Math.round((new Date(after.day0_at).getTime() - new Date(before).getTime()) / 86_400_000)).toBe(3);
    // The office's pause does the same, and says why
    await expectCode(c.as(c.admin, "reach_series_pause", true, "no"), "22023");
    await c.as(c.admin, "reach_series_pause", true, "Checking the wording first");
    await tick();
    expect(await enrolment(m)).toMatchObject({ frozen_why: "paused" });
    await c.as(c.admin, "reach_series_pause", false, null);
    await tick();
    expect((await enrolment(m)).frozen_at).toBeNull();
  });

  it("keeps the days it was set up with when a setting changes later", async () => {
    await on();
    const t = await fresh("Settings");
    const m = await member("Settings", t.tribe);
    await tick();
    await c.sql("update public.reach_settings set release_after_days = 9, first_go_hours = 5");
    const e = await enrolment(m);
    expect(e.email_days).toEqual([0, 2, 4, 5]);
    expect(e.release_days).toBe(6);
  });
});

describe("how it ends", () => {
  async function toTheEnd(id: string) {
    await clock(12);
    await tick();
    await goFirst(id);
    await tick();
    for (const by of ["2 days", "2 days", "1 day"]) {
      await back(id, by);
      await tick();
    }
    await delivered(id);
    await c.sql("delete from public.event_log where actor_id = $1", [id]);
    await back(id, "1 day");
  }

  it("ends 'fixed' as soon as the gap is closed, and remembers which email did it", async () => {
    await on();
    const t = await fresh("Fix");
    const m = await member("Fixer", t.tribe);
    await clock(12);
    await tick();
    await goFirst(m);
    await tick();
    await back(m, "2 days");
    await tick();
    await save(m, real(), true);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "fixed", fixed_by_email: 2 });
    await back(m, "5 days").catch(() => undefined);
    await tick();
    expect(await mailOf(m)).toHaveLength(2);
  });

  it("ends 'silent' for a person who did nothing, and 'seen, not done' for one who opened the page", async () => {
    await on();
    const t = await fresh("Ends");
    const quiet = await member("Quiet", t.tribe);
    const looked = await member("Looked", t.tribe);
    await clock(12);
    await tick();
    await goFirst(quiet);
    await goFirst(looked);
    await tick();
    await c.anon("worker_reach_info", token, await link(looked));
    for (const by of ["2 days", "2 days", "1 day"]) {
      await back(quiet, by);
      await back(looked, by);
      await tick();
    }
    for (const id of [quiet, looked]) {
      await delivered(id);
      await c.sql("delete from public.event_log where actor_id = $1", [id]);
      await back(id, "1 day");
    }
    await tick();
    expect(await enrolment(quiet)).toMatchObject({ status: "ended", outcome: "silent" });
    expect(await enrolment(looked)).toMatchObject({ status: "ended", outcome: "seen_not_done" });
  });

  it("ends 'not reached' when an email failed, and never calls that silence", async () => {
    await on();
    const t = await fresh("Failed");
    const m = await member("Failed", t.tribe);
    await toTheEnd(m);
    await c.sql("update public.messages set status = 'failed', error = 'Mailbox full' where person_id = $1 and template = 'reach_series' and (params ->> 'n')::int = 2", [m]);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "not_reached" });
  });

  it("waits while an email is still on its way", async () => {
    await on();
    const t = await fresh("Slow");
    const m = await member("Slow", t.tribe);
    await toTheEnd(m);
    await c.sql("update public.messages set status = 'queued' where person_id = $1 and template = 'reach_series' and (params ->> 'n')::int = 4", [m]);
    await tick();
    expect(await enrolment(m)).toMatchObject({ status: "active" });
  });

  it("ends 'not reached' when the address starts to bounce, 'left' when the person leaves, and 'not eligible' when a deletion opens", async () => {
    await on();
    await clock(12);
    const t = await fresh("Gone");
    const bounce = await member("Bounce", t.tribe);
    const leave = await member("Leave", t.tribe);
    const del = await member("Delete", t.tribe);
    await tick();
    await c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [bounce]);
    await c.sql("update public.tribe_members set status = 'released' where person_id = $1", [leave]);
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [del]);
    await tick();
    expect(await enrolment(bounce)).toMatchObject({ outcome: "not_reached" });
    expect(await enrolment(leave)).toMatchObject({ outcome: "left" });
    expect(await enrolment(del)).toMatchObject({ outcome: "not_eligible" });
  });

  it("changes what the next email says when the gap changes: a number added, the yes still missing", async () => {
    await on();
    await clock(12);
    const t = await fresh("Changes");
    const m = await member("Changes", t.tribe);
    await tick();
    await goFirst(m);
    await tick();
    await save(m, real(), false);
    await back(m, "2 days");
    await tick();
    expect(await enrolment(m)).toMatchObject({ kind: "no_yes", sends: 2 });
    expect((await mailOf(m))[1].params.kind).toBe("no_yes");
  });
});

describe("the private page", () => {
  async function started(name = "Page") {
    await on();
    await clock(12);
    const t = await fresh(name);
    const m = await member(name, t.tribe);
    await tick();
    await goFirst(m);
    await tick();
    return { t, m, l: await link(m) };
  }

  it("needs the sending service's token, and a link we made", async () => {
    const { l } = await started();
    await expectCode(c.anon("worker_reach_info", "not-a-token-not-a-token-not-a-token-0000", l), "42501");
    await expectCode(c.as(c.admin, "worker_reach_info", token, l), "42501");
    expect(await info("x".repeat(64))).toEqual({ found: false });
    expect(await info("short")).toEqual({ found: false });
    expect(await info("a".repeat(64))).toEqual({ found: false });
  });

  it("shows who it is for, hides the number's middle, and changes nothing but a counter when opened", async () => {
    const { m, l } = await started();
    const before = await c.one("select count(*)::int n from public.consents where person_id = $1", [m]);
    const r = await info(l);
    expect(r).toMatchObject({ found: true, state: "form", kind: "no_number", tribe: expect.any(String) });
    expect(r.number).toBeNull();
    expect(r.leader_first).toBeTruthy();
    expect(await c.one("select count(*)::int n from public.consents where person_id = $1", [m])).toEqual(before);
    expect((await c.one("select clicks from public.reach_links where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')", [l])).clicks).toBe(1);
    expect(await enrolment(m)).toMatchObject({ status: "active" });
    // A number already saved is shown with its middle hidden
    await phoneOf(m, "+2348031234567");
    expect((await info(l)).number).toBe("+234••••••••67");
    expect(JSON.stringify(await info(l))).not.toContain("8031234567");
  });

  it("offers the number they sign in with, masked, and uses it on the server only when they press the button", async () => {
    const { m, l } = await started();
    await c.sql("update auth.users set phone = '2348077766655' where id = $1", [m]);
    const r = await info(l);
    expect(r.signin).toBe("+234••••••••55");
    expect(JSON.stringify(r)).not.toContain("8077766655");
    expect(await enrolment(m)).toMatchObject({ status: "active" });
    const saved = await c.anon("worker_reach_save", token, l, "", true, true);
    expect(saved).toMatchObject({ ok: true, done: true });
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [m])).phone).toBe("+2348077766655");
  });

  it("saves a number and the yes for the person the link was made for, ends their series as fixed, and tells the page it is done", async () => {
    const { m, l } = await started();
    const r = await c.anon("worker_reach_save", token, l, "+234 803 123 4567", true, false);
    expect(r).toMatchObject({ ok: true, done: true, kind: null });
    expect(await c.one("select phone from public.contact_preferences where person_id = $1", [m])).toEqual({ phone: "+2348031234567" });
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [m])).g).toBe(true);
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "fixed", fixed_by_email: 1 });
    expect((await info(l)).state).toBe("done");
    // A leader can now see the number, because the member said yes
    const seen = ((await c.as((await c.one("select leader_id from public.tribes where id = (select tribe_id from public.tribe_members where person_id = $1 limit 1)", [m])).leader_id as string, "tribe_roster", (await c.one("select tribe_id from public.tribe_members where person_id = $1 limit 1", [m])).tribe_id)).members as { person_id: string; whatsapp: string | null }[]).find((x) => x.person_id === m);
    expect(seen?.whatsapp).toBe("+2348031234567");
  });

  it("saves a number without the yes if that is what they chose, and the gap becomes 'no yes'", async () => {
    const { m, l } = await started();
    const r = await c.anon("worker_reach_save", token, l, "+2348031234567", false, false);
    expect(r).toMatchObject({ ok: true, done: false, kind: "no_yes" });
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [m])).g).toBe(false);
    expect(await enrolment(m)).toMatchObject({ status: "active" });
  });

  it("never withdraws a yes, and never writes for anyone else", async () => {
    const { m, l, t } = await started();
    const other = await member("Other", t.tribe);
    await save(m, real(), true);
    await c.anon("worker_reach_save", token, l, "+2348031234567", false, false);
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [m])).g).toBe(true);
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [other])).g).toBe(false);
    expect(await c.sql("select 1 from public.contact_preferences where person_id = $1", [other])).toHaveLength(0);
  });

  it("refuses a made-up number, a number without its country code, and no number at all", async () => {
    const { l } = await started();
    await expectCode(c.anon("worker_reach_save", token, l, "+2348111111111", true, false), "22023");
    await expectCode(c.anon("worker_reach_save", token, l, "08031234567", true, false), "22023");
    await expectCode(c.anon("worker_reach_save", token, l, "", true, false), "22023");
    await expectCode(c.anon("worker_reach_save", token, l, "", true, true), "22023");
  });

  it("'Email me instead' ends the series, is remembered for the season, and the leader sees it", async () => {
    const { m, l, t } = await started();
    expect(await c.anon("worker_reach_email_instead", token, l)).toEqual({ ok: true });
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "email_only" });
    expect((await info(l)).state).toBe("email_only");
    await c.sql("update public.reach_settings set swept_at = null");
    await tick();
    expect(await c.sql("select 1 from public.reach_enrolments where person_id = $1", [m])).toHaveLength(1);
    const strip = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip.people.find((p: { person_id: string }) => p.person_id === m)).toMatchObject({ status: "email_only" });
  });

  it("'Email me instead' from a tribe note, before any series, is remembered too", async () => {
    await on();
    await noteOn();
    const t = await fresh("Note first");
    const m = await member("NoteFirst", t.tribe);
    await c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello, tribe");
    const l = await link(m, "tribe_note");
    expect(await c.anon("worker_reach_email_instead", token, l)).toEqual({ ok: true });
    expect(await enrolment(m)).toMatchObject({ status: "ended", outcome: "email_only" });
    await tick();
    expect(await c.sql("select 1 from public.reach_enrolments where person_id = $1", [m])).toHaveLength(1);
  });

  it("offers a new link when the old one has expired, not more than three a day, and only to someone who still has something to do", async () => {
    const { m, l } = await started();
    await c.sql("update public.reach_links set expires_at = now() - interval '1 day'");
    expect(await info(l)).toMatchObject({ found: true, state: "expired" });
    await expectCode(c.anon("worker_reach_save", token, l, "+2348031234567", true, false).then((r) => { if (!r.ok) throw Object.assign(new Error("expired"), { code: "42501" }); return r; }), "42501");
    expect(await c.anon("worker_reach_new_link", token, l)).toEqual({ ok: true });
    const fresh1 = await link(m, "reach_new_link");
    expect((await info(fresh1)).state).toBe("form");
    for (let i = 0; i < 4; i++) await c.anon("worker_reach_new_link", token, l);
    expect(await mailOf(m, "reach_new_link")).toHaveLength(3);
    // Someone who has put it right is sent nothing
    await save(m, real(), true);
    await c.sql("delete from public.messages where template = 'reach_new_link'");
    await c.anon("worker_reach_new_link", token, l);
    expect(await mailOf(m, "reach_new_link")).toHaveLength(0);
  });

  it("is not available to a teenager or a person whose deletion is open", async () => {
    const { m, l } = await started();
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [m]);
    expect(await info(l)).toEqual({ found: false });
    await expectCode(c.anon("worker_reach_save", token, l, "+2348031234567", true, false), "42501");
  });

  it("keeps working while the function is switched Off: a member can always put it right", async () => {
    const { m, l } = await started();
    await c.reset();
    expect((await info(l)).state).toBe("form");
    expect(await c.anon("worker_reach_save", token, l, "+2348031234567", true, false)).toMatchObject({ ok: true, done: true });
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [m])).g).toBe(true);
  });
});

describe("the leader: Ask my members", () => {
  it("sends email 1 now, with the leader's own line, to everyone who is in or about to be in the series, and tells the strip", async () => {
    await on();
    await clock(12);
    const t = await fresh("Ask");
    const a = await member("Ada", t.tribe);
    const b = await member("Bola", t.tribe);
    const ok = await member("Chi", t.tribe);
    await save(ok, real(), true);
    await tick();
    const strip0 = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip0).toMatchObject({ on: true, adults: 3, reachable: 1, ask: { count: 2, can: true } });
    expect(strip0.ask.names).toHaveLength(2);
    const r = await c.as(t.leader.id, "reach_ask_tribe", t.tribe, "  Please do it   today, it helps me. ");
    expect(r).toEqual({ ok: true, sent: 2 });
    for (const id of [a, b]) {
      const mail = await mailOf(id);
      expect(mail).toHaveLength(1);
      expect(mail[0].params).toMatchObject({ n: 1, line: "Please do it today, it helps me." });
      expect(await enrolment(id)).toMatchObject({ sends: 1, leader_line: "Please do it today, it helps me.", leader_asked_by: t.leader.id });
    }
    expect(await mailOf(ok)).toHaveLength(0);
    const strip1 = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip1).toMatchObject({ reachable: 1, ask: { count: 0, can: false } });
    expect(strip1.ask.next_at).not.toBeNull();
    expect(strip1.people.map((p: { status: string }) => p.status)).toEqual(["asked", "asked"]);
    // The auto start does not send email 1 a second time
    await goFirst(a);
    await tick();
    expect(await mailOf(a)).toHaveLength(1);
  });

  it("puts a member with a gap in the series even before the beat has found them", async () => {
    await on();
    const t = await fresh("Early");
    const a = await member("Early", t.tribe);
    expect(await enrolment(a)).toBeUndefined();
    expect(await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null)).toEqual({ ok: true, sent: 1 });
    expect((await mailOf(a))[0].params.line).toBeUndefined();
  });

  it("is once for a tribe in three days, and says when", async () => {
    await on();
    const t = await fresh("Once");
    await member("Once", t.tribe);
    await member("Twice", t.tribe);
    await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null);
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, null), "22023");
    await c.sql("update public.reach_leader_asks set at = now() - interval '4 days'");
    await member("Late", t.tribe);
    expect(await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null)).toEqual({ ok: true, sent: 1 });
  });

  it("keeps the line short and free of links and addresses, and says when there is nobody to ask", async () => {
    await on();
    const t = await fresh("Rules");
    await member("Rules", t.tribe);
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, "x".repeat(201)), "22023");
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, "Go to https://example.com"), "22023");
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, "Write to me at a@b.co"), "22023");
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, "see www.example.com"), "22023");
    const empty = await fresh("Empty");
    const ok = await member("Fine", empty.tribe);
    await save(ok, real(), true);
    await expectCode(c.as(empty.leader.id, "reach_ask_tribe", empty.tribe, null), "22023");
  });

  it("is for the people who run the tribe only, and never for another leader's tribe", async () => {
    await on();
    const t = await fresh("Mine");
    const other = await fresh("Theirs");
    await member("Mine", t.tribe);
    await expectCode(c.as(other.leader.id, "reach_ask_tribe", t.tribe, null), "42501");
    await expectCode(c.as(c.member, "reach_ask_tribe", t.tribe, null), "42501");
    await expectCode(c.anon("reach_ask_tribe", t.tribe, null), "42501");
    await expectCode(c.as(other.leader.id, "tribe_reach", t.tribe), "42501");
  });

  it("is refused in Rehearsal and does not wait for the window when the leader presses it", async () => {
    await rehearse();
    const t = await fresh("Reh");
    await member("Reh", t.tribe);
    await expectCode(c.as(t.leader.id, "reach_ask_tribe", t.tribe, null), "22023");
    expect(await c.as(t.leader.id, "tribe_reach", t.tribe)).toMatchObject({ on: false });
    await c.set("reach_series", "on", { reason: REASON });
    await clock(23);
    expect(await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null)).toEqual({ ok: true, sent: 1 });
  });

  it("does not ask a person who cannot be asked, and the strip never says why", async () => {
    await on();
    const t = await fresh("Safe");
    const teen = await member("Teen", t.tribe);
    await makeTeen(teen);
    const hidden = await member("Hidden", t.tribe);
    await c.sql("update public.tribe_members set contact_withheld = true where person_id = $1", [hidden]);
    const bounced = await member("Bounced", t.tribe);
    await c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [bounced]);
    const ok = await member("Ok", t.tribe);
    const strip = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip.ask.count).toBe(1);
    expect(strip.people.map((p: { person_id: string }) => p.person_id)).toEqual([ok]);
    expect(JSON.stringify(strip)).not.toMatch(/withheld|bounce|care|teen|\+234|@/i);
    expect(await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null)).toEqual({ ok: true, sent: 1 });
    for (const id of [teen, hidden, bounced]) expect(await mailOf(id)).toHaveLength(0);
  });

  it("makes the one-person Ask (fix 13) wait for a person the series is already asking, and counts the series as an ask", async () => {
    await on();
    await clock(12);
    const t = await fresh("Single");
    const a = await member("Single", t.tribe);
    await tick();
    await expectCode(c.as(t.leader.id, "contact_ask_send", a), "22023");
    await goFirst(a);
    await tick();
    expect((await c.one("select n from public.contact_ask_history($1)", [a])).n).toBe(1);
    await c.as(c.admin, "reach_series_stop", a, "Stopped for the test");
    await expectCode(c.as(t.leader.id, "contact_ask_send", a), "22023");
  });
});

describe("the leader: I'll follow this up myself", () => {
  it("holds the emails to that person for three days, once, then carries on with the days it had left", async () => {
    await on();
    await clock(12);
    const t = await fresh("Follow");
    const a = await member("Follow", t.tribe);
    await tick();
    await goFirst(a);
    await tick();
    expect(await c.as(t.leader.id, "reach_follow_up", a)).toMatchObject({ ok: true });
    await expectCode(c.as(t.leader.id, "reach_follow_up", a), "22023");
    // Email 2 would be due now, but the leader has asked for three days
    await back(a, "2 days");
    const held = (await enrolment(a)).day0_at as Date;
    const r = await tick();
    expect(r.steps).toMatchObject({ following_up: 1 });
    expect(await mailOf(a)).toHaveLength(1);
    const strip = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip.people[0]).toMatchObject({ status: "follow_up" });
    // The three days pass
    await c.sql("update public.reach_enrolments set paused_at = paused_at - interval '3 days', paused_until = paused_until - interval '3 days' where person_id = $1", [a]);
    await tick();
    const e = await enrolment(a);
    expect(e.paused_until).toBeNull();
    // The series is three days later than it was, so it keeps every day it had left
    expect(Math.round((new Date(e.day0_at).getTime() - new Date(held).getTime()) / 3_600_000)).toBe(72);
    expect(await mailOf(a)).toHaveLength(1);
    await back(a, "3 days");
    await tick();
    expect(await mailOf(a)).toHaveLength(2);
  });

  it("is for the person's leader or assistant only, and only while a series is running", async () => {
    await on();
    const t = await fresh("Rules");
    const other = await fresh("Other");
    const a = await member("Rules", t.tribe);
    await expectCode(c.as(t.leader.id, "reach_follow_up", a), "22023");
    await c.as(t.leader.id, "reach_ask_tribe", t.tribe, null);
    await expectCode(c.as(other.leader.id, "reach_follow_up", a), "42501");
    await expectCode(c.as(c.member, "reach_follow_up", a), "42501");
    await expectCode(c.anon("reach_follow_up", a), "42501");
  });
});

describe("the tribe note", () => {
  it("is refused Off, sends one email to everyone who may be written to in Rehearsal or On, and counts the week", async () => {
    await on();
    const t = await fresh("Note");
    const a = await member("Ada", t.tribe);
    const b = await member("Bola", t.tribe);
    const teen = await member("Teen", t.tribe);
    await makeTeen(teen);
    const off = await member("Off", t.tribe);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'contact-v1')", [off]);
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello"), "22023");
    await noteOn("rehearsal");
    expect(await c.as(t.leader.id, "tribe_note_send", t.tribe, "Rehearsing")).toEqual({ ok: true, sent: 2, rehearsal: true });
    expect(await mailOf(a, "tribe_note")).toHaveLength(0);
    await noteOn("on");
    expect(await c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello, tribe. We meet as usual on Wednesday.")).toEqual({ ok: true, sent: 2, rehearsal: false });
    for (const id of [a, b]) {
      const mail = await mailOf(id, "tribe_note");
      expect(mail).toHaveLength(1);
      expect(mail[0].params).toMatchObject({ body: "Hello, tribe. We meet as usual on Wednesday.", tribe: expect.any(String) });
      expect(mail[0].force_channel).toBe("email");
    }
    for (const id of [teen, off]) expect(await mailOf(id, "tribe_note")).toHaveLength(0);
    const strip = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip.note).toMatchObject({ state: "on", limit: 2, used: 1, can: true });
  });

  it("puts the Add my number link under it for a member who still has a gap, and only for them", async () => {
    await on();
    await noteOn();
    const t = await fresh("Gap");
    const gap = await member("Gap", t.tribe);
    const fine = await member("Fine", t.tribe);
    await save(fine, real(), true);
    await c.as(t.leader.id, "tribe_note_send", t.tribe, "A word for all of us");
    expect((await mailOf(gap, "tribe_note"))[0].params.gap).toBe("no_number");
    expect((await mailOf(gap, "tribe_note"))[0].reply_token).toMatch(/^[a-f0-9]{64}$/);
    expect((await mailOf(fine, "tribe_note"))[0].params.gap).toBeNull();
    expect((await mailOf(fine, "tribe_note"))[0].reply_token).toBeNull();
    // The link works and belongs to that person
    const l = await link(gap, "tribe_note");
    expect(await info(l)).toMatchObject({ found: true, state: "form" });
    expect(await c.anon("worker_reach_save", token, l, "+2348031234567", true, false)).toMatchObject({ ok: true, done: true });
  });

  it("is two a week for a tribe, and says when the next can go", async () => {
    await on();
    await noteOn();
    const t = await fresh("Limit");
    await member("One", t.tribe);
    await c.as(t.leader.id, "tribe_note_send", t.tribe, "First note");
    await c.as(t.leader.id, "tribe_note_send", t.tribe, "Second note");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Third note"), "22023");
    const strip = await c.as(t.leader.id, "tribe_reach", t.tribe);
    expect(strip.note).toMatchObject({ used: 2, can: false });
    expect(strip.note.next_at).not.toBeNull();
    await c.sql("update public.tribe_notes set at = at - interval '8 days'");
    expect(await c.as(t.leader.id, "tribe_note_send", t.tribe, "Third note")).toMatchObject({ ok: true });
    // The owner can allow more
    await c.sql("update public.reach_settings set note_per_week = 4");
    expect(await c.as(t.leader.id, "tribe_note_send", t.tribe, "Fourth note")).toMatchObject({ ok: true });
  });

  it("keeps to 600 characters, no links, something to say, and never the same note twice in ten minutes", async () => {
    await on();
    await noteOn();
    const t = await fresh("Words");
    await member("Words", t.tribe);
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "x".repeat(601)), "22023");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "   "), "22023");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Join us at https://zoom.example/abc"), "22023");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "See www.example.com"), "22023");
    await c.as(t.leader.id, "tribe_note_send", t.tribe, "x".repeat(600));
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "x".repeat(600)), "22023");
  });

  it("is for the leader or assistant of the tribe only, and not for a tribe that has finished", async () => {
    await on();
    await noteOn();
    const t = await fresh("Who");
    const other = await fresh("Else");
    await member("Who", t.tribe);
    await expectCode(c.as(other.leader.id, "tribe_note_send", t.tribe, "Hello"), "42501");
    await expectCode(c.as(c.member, "tribe_note_send", t.tribe, "Hello"), "42501");
    await expectCode(c.anon("tribe_note_send", t.tribe, "Hello"), "42501");
    await c.sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello"), "22023");
  });

  it("is stopped by the Master pause", async () => {
    await on();
    await noteOn();
    const t = await fresh("Paused");
    await member("Paused", t.tribe);
    await c.sql("update public.feature_master set paused = true, reason = 'Pause test'");
    await expectCode(c.as(t.leader.id, "tribe_note_send", t.tribe, "Hello"), "22023");
  });
});

describe("the office", () => {
  it("shows where each person stands, filters by stage, keeps the counts equal to the rows, and never shows a number", async () => {
    await on();
    await clock(12);
    const t = await fresh("Office");
    const a = await member("Ada", t.tribe);
    const b = await member("Bola", t.tribe);
    const x = await member("Chi", t.tribe);
    await phoneOf(b, "+2348031234567");
    await tick();
    await goFirst(a);
    await tick();
    await c.anon("worker_reach_email_instead", token, await link(a));
    const r = await c.as(c.admin, "contact_gaps_report", null, t.tribe, null, 100, 0, null);
    const byId = (id: string) => r.rows.find((y: { person_id: string }) => y.person_id === id);
    expect(byId(a).series).toMatchObject({ state: "email_only", sends: 1 });
    expect(byId(b).series).toMatchObject({ state: "in_series", sends: 0 });
    expect(byId(x).series).toMatchObject({ state: "in_series" });
    // The counts are the whole church's, like the cause counts, so they equal the rows of the unfiltered list
    const all = await c.as(c.admin, "contact_gaps_report", null, null, null, 500, 0, null);
    expect(Object.values(all.series_counts as Record<string, number>).reduce((x, y) => x + y, 0)).toBe(all.total);
    expect(r.series_counts.email_only).toBe(1);
    expect(r.series_counts.in_series).toBeGreaterThanOrEqual(2);
    expect(r.series_switch).toBe("on");
    expect(r.series_paused).toBe(false);
    const f = await c.as(c.admin, "contact_gaps_report", null, t.tribe, null, 100, 0, "in_series");
    expect(f.total).toBe(2);
    expect(f.rows).toHaveLength(2);
    const g = await c.as(c.admin, "contact_gaps_report", null, t.tribe, null, 100, 0, "email_only");
    expect(g.total).toBe(1);
    await expectCode(c.as(c.admin, "contact_gaps_report", null, null, null, 100, 0, "nonsense"), "22023");
    expect(JSON.stringify(r)).not.toMatch(/\+234\d|8031234567/);
    const real = await c.one("select count(*)::int n, count(*) filter (where status = 'active')::int running from public.reach_enrolments where not rehearsal and outcome is distinct from 'rehearsal_over'");
    expect(r.series_stats).toMatchObject({ started: real.n, running: real.running, email_only: 1 });
  });

  it("lists a person it cannot email as 'not reached', and counts what the series has done so far", async () => {
    await on();
    const t = await fresh("Reached");
    const a = await member("Ada", t.tribe);
    await c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [a]);
    await tick();
    const r = await c.as(c.admin, "contact_gaps_report", null, t.tribe, null, 100, 0, null);
    expect(r.rows.find((y: { person_id: string }) => y.person_id === a).series.state).toBe("not_reached");
  });

  it("pauses the series for everyone with a reason, and stops it for one person with a reason, for those who act only", async () => {
    await on();
    const t = await fresh("Stop");
    const a = await member("Stop", t.tribe);
    await tick();
    for (const who of [c.member, t.leader.id, c.pastor]) {
      await expectCode(c.as(who, "reach_series_pause", true, "A good reason"), "42501");
      await expectCode(c.as(who, "reach_series_stop", a, "A good reason"), "42501");
    }
    await expectCode(c.as(c.admin, "reach_series_stop", a, "no"), "22023");
    await c.as(c.director, "reach_series_stop", a, "They asked us to leave them be");
    expect(await enrolment(a)).toMatchObject({ status: "ended", outcome: "stopped", stop_reason: "They asked us to leave them be" });
    await expectCode(c.as(c.admin, "reach_series_stop", a, "Once more please"), "22023");
    expect(await c.sql("select 1 from public.event_log where action = 'reach.stopped' and entity_id = $1", [a])).toHaveLength(1);
  });

  it("downloads names, tribes, causes and stages with no number, for those who act", async () => {
    await on();
    await clock(12);
    const t = await fresh("File");
    const a = await member("File", t.tribe);
    await phoneOf(a, "+2348031234567");
    await tick();
    await goFirst(a);
    await tick();
    const file = await c.as(c.admin, "contact_gaps_export");
    const row = file.find((y: { name: string }) => y.name.includes("File"));
    expect(row).toMatchObject({ series: "in_series", emails: 1, cause: "no_yes" });
    expect(JSON.stringify(file)).not.toMatch(/\+234\d|8031234567|@/);
    await expectCode(c.as(c.pastor, "contact_gaps_export"), "42501");
  });

  it("lets the owner change the settings with a reason, logs it, and refuses everyone else", async () => {
    expect(await c.o.call("god_reach_settings")).toMatchObject({ first_go_hours: 24, release_after_days: 6, end_mode: "silent", note_per_week: 2, email_days: [0, 2, 4, 5] });
    await expectCode(c.o.call("god_reach_settings_set", 24, 6, "silent", 2, "no"), "22023");
    await expectCode(c.o.call("god_reach_settings_set", 80, 6, "silent", 2, "A good reason"), "22023");
    await expectCode(c.o.call("god_reach_settings_set", 24, 3, "silent", 2, "A good reason"), "22023");
    await expectCode(c.o.call("god_reach_settings_set", 24, 11, "silent", 2, "A good reason"), "22023");
    await expectCode(c.o.call("god_reach_settings_set", 24, 6, "everybody", 2, "A good reason"), "22023");
    await expectCode(c.o.call("god_reach_settings_set", 24, 6, "silent", 5, "A good reason"), "22023");
    const r = await c.o.call("god_reach_settings_set", 12, 8, "list", 3, "Trying a longer series");
    expect(r).toMatchObject({ first_go_hours: 12, release_after_days: 8, end_mode: "list", note_per_week: 3, email_days: [0, 2, 6, 7] });
    expect(await c.sql("select 1 from public.event_log where action = 'reach.settings'")).toHaveLength(1);
    await expectCode(c.as(c.admin, "god_reach_settings"), "42501");
    await expectCode(c.as(c.admin, "god_reach_settings_set", 24, 6, "silent", 2, "A good reason"), "42501");
  });

  it("works out four different days for every length it allows", async () => {
    for (let d = 4; d <= 10; d++) {
      const days = (await c.one("select public.reach_email_days($1) as d", [d])).d as number[];
      expect(new Set(days).size).toBe(4);
      expect(days[0]).toBe(0);
      expect(days[3]).toBe(d - 1);
      expect([...days].sort((x, y) => x - y)).toEqual(days);
    }
    expect((await c.one("select public.reach_email_days(6) as d")).d).toEqual([0, 2, 4, 5]);
  });
});

describe("the placed page's two boxes", () => {
  async function placedLink(person: string, tribe: string) {
    const tm = (await c.one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [person, tribe])).id as string;
    await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where id = $1", [tm]);
    return (await c.one("select public.placement_token_mint($1, $2, 60) as t", [tm, person])).t as string;
  }

  it("shows the boxes only when there is a number or a yes to put right, and saves them for that member only", async () => {
    await on();
    const t = await fresh("Placed");
    const m = await member("Placed", t.tribe);
    const l = await placedLink(m, t.tribe);
    expect(await c.anon("worker_placed_reach", token, l)).toMatchObject({ gap: "no_number", number: null });
    const saved = await c.anon("worker_placed_reach_save", token, l, "+2348031234567", true, false);
    expect(saved).toMatchObject({ ok: true });
    expect(await c.anon("worker_placed_reach", token, l)).toEqual({ gap: null });
    expect((await c.one("select public.consent_granted($1, 'whatsapp') g", [m])).g).toBe(true);
    await expectCode(c.anon("worker_placed_reach", "not-a-token-not-a-token-not-a-token-0000", l), "42501");
    expect(await c.anon("worker_placed_reach", token, "b".repeat(64))).toEqual({ gap: null });
    expect(await c.anon("worker_placed_reach_save", token, "b".repeat(64), "+2348031234567", true, false)).toMatchObject({ ok: false });
  });

  it("shows nothing while the series is Off", async () => {
    const t = await fresh("Placed off");
    const m = await member("PlacedOff", t.tribe);
    const l = await placedLink(m, t.tribe);
    expect(await c.anon("worker_placed_reach", token, l)).toEqual({ gap: null });
  });
});

describe("who may call what", () => {
  it("keeps the helpers out of reach, the screens' functions for signed-in people only, and the page's functions for the sending service only", async () => {
    const internal = [
      "reach_email_days(integer)", "reach_mask(text)", "reach_signin_number(uuid)", "reach_number_kind(uuid)", "reach_gap_kind(uuid, uuid)",
      "reach_block_of(uuid, uuid)", "reach_state_of(uuid)", "reach_window_ok()", "reach_link_mint(uuid, uuid, uuid, text, integer)", "reach_link_open(text)",
      "reach_end(uuid, text, uuid, text, integer)", "reach_enrol(uuid, boolean)", "reach_had_series(uuid, uuid, boolean)", "reach_enrol_sweep(integer)",
      "reach_send(uuid, integer, text, uuid)", "reach_step(uuid, boolean, text, uuid)", "reach_series_tick()", "reach_apply_number(uuid, text, boolean, boolean)",
      "reach_close_if_fixed(uuid, integer)", "reach_person_status(uuid, uuid, uuid)", "reach_series_of(uuid, uuid)",
    ];
    for (const f of internal) {
      const r = await c.one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as e, has_function_privilege('anon', 'public.${f}', 'execute') as a`);
      expect({ f, ...r }).toEqual({ f, e: false, a: false });
    }
    const screens = [
      "tribe_reach(uuid)", "reach_ask_tribe(uuid, text)", "reach_follow_up(uuid)", "tribe_note_send(uuid, text)",
      "contact_gaps_report(text, uuid, uuid, integer, integer, text)", "reach_series_pause(boolean, text)", "reach_series_stop(uuid, text)",
      "god_reach_settings()", "god_reach_settings_set(integer, integer, text, integer, text)",
    ];
    for (const f of screens) {
      const r = await c.one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as e, has_function_privilege('anon', 'public.${f}', 'execute') as a`);
      expect({ f, ...r }).toEqual({ f, e: true, a: false });
    }
    const workers = [
      "worker_reach_tick(text)", "worker_reach_info(text, text)", "worker_reach_save(text, text, text, boolean, boolean)", "worker_reach_email_instead(text, text)",
      "worker_reach_new_link(text, text)", "worker_placed_reach(text, text)", "worker_placed_reach_save(text, text, text, boolean, boolean)",
    ];
    for (const f of workers) {
      const r = await c.one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') as e, has_function_privilege('anon', 'public.${f}', 'execute') as a`);
      expect({ f, ...r }).toEqual({ f, e: false, a: true });
    }
  });

  it("keeps the tables out of reach", async () => {
    for (const t of ["reach_settings", "reach_enrolments", "reach_sends", "reach_links", "reach_leader_asks", "tribe_notes"]) {
      const r = await c.one(`select has_table_privilege('authenticated', 'public.${t}', 'select') as s, has_table_privilege('anon', 'public.${t}', 'select') as a`);
      expect({ t, ...r }).toEqual({ t, s: false, a: false });
    }
  });
});
