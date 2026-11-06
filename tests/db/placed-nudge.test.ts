import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The placed-member nudge (Package 6a of "seats and contacts"). What these prove:
//   * it ships Off; Off hides the choice, Rehearsal shows the counts and the test email and refuses to send, the Master pause holds a scheduled send, and it
//     can be On for one tribe only
//   * who is waiting is one test (church-placed, in the seat, not yet said yes, season open), and the count equals it; every left-out reason fires
//   * checked three times: at the count, at release and at the moment of sending; the spacing and the most per seat hold; the weekly limit counts
//   * the links are made when each email is sent (a retry gets new ones), work for the right seat only, are kept only as fingerprints, and never reach the
//     message row or any log
//   * the private page: opening saves nothing, email only writes no WhatsApp yes, "message me" writes one (placed-v1) with the number in one all-or-nothing
//     press, a bad number blocks the whole press, the sign-in number is confirmed on the spot, a changed number is no longer confirmed
//   * the page can tell a link that ran out from a seat that is gone, and a fresh link is sent (three a day); a retried placement email gets a new link
//   * the office: the home card, the leader's line, Contact gaps, the owner's three numbers, the permission lists, and no number anywhere

let c: Cast;
let n = 0;
let token: string;
let champion: string;

const REASON = "Trying the placed nudge";
const clock = (hour = 10) =>
  c.db.admin.query(
    `create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$;
     create or replace function public.lagos_dow() returns integer language sql as $$ select 3 $$;`,
  );
const unclock = () =>
  c.db.admin.query(
    `create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$;
     create or replace function public.lagos_dow() returns integer language sql stable set search_path = '' as $$ select extract(dow from (now() at time zone 'Africa/Lagos'))::integer $$;`,
  );
const on = () => c.set("placed_nudge", "on", { reason: REASON });
const rehearse = () => c.set("placed_nudge", "rehearsal", { reason: REASON });
const real = () => `+23480${String(30000000 + ++n * 7919).slice(0, 8)}`;
const fresh = (name: string) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity: 12 });
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
/** A member the church placed in a tribe and who has not answered. Their placement email went `sentHoursAgo` hours ago (or has not gone yet when null). */
async function placed(name: string, tribe: string, over: { sentHoursAgo?: number | null; withheld?: boolean } = {}) {
  const id = (await c.k.seat(tribe, c.season, `${name}${++n}`)).id;
  await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null, contact_withheld = $2 where person_id = $1", [id, over.withheld ?? false]);
  const tm = (await c.one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [id, tribe])).id as string;
  const hours = over.sentHoursAgo === undefined ? 30 : over.sentHoursAgo;
  if (hours === null) {
    await c.sql("insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for) values ($1, 'placement_your_tribe', '{}', 'queued', $2, now() + interval '1 hour')", [id, `placement:${tm}`]);
  } else {
    await c.sql("insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', '{}', 'sent', $2, now(), now() - $3::interval)", [
      id,
      `placement:${tm}`,
      `${hours} hours`,
    ]);
  }
  return { id, tm, tribe };
}
const makeTeen = (id: string) => replica("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
const preview = (spec: Record<string, unknown> = {}, who = c.admin) => c.as(who, "audience_preview", { kind: "placed_waiting", ...spec });
const fields = (over: Record<string, unknown> = {}) => ({
  title: "Nudge the placed",
  audience: { kind: "placed_waiting" },
  audience_label: "Placed by the church, waiting for a reply",
  subject: "One tap keeps your place in {tribe}",
  paragraphs: ["Your place in {tribe} is being held for you.", "One tap tells us you are in."],
  ...over,
});
const draft = (over: Record<string, unknown> = {}, who = c.director) => c.as(who, "broadcast_save", null, JSON.stringify(fields(over))) as Promise<string>;
const release = (id: string) =>
  c.sql("update public.broadcasts set scheduled_for = now() - interval '1 minute' where id = $1", [id]).then(() => c.sql("select public.broadcasts_release()"));
const rec = async (id: string) => Object.fromEntries((await c.sql("select person_id, status, reason, message_id from public.broadcast_recipients where broadcast_id = $1", [id])).map((r) => [r.person_id as string, r]));
const claim = async (max = 25) => (await c.anon("worker_claim", token, max)) as Array<{ id: string; template: string; params: { placed: { secret: string; tribe?: string; sample?: boolean }; copy: { subject?: string }; [k: string]: unknown }; to: { email: string }; channel: string }>;
const nudges = (tm: string) => c.sql("select * from public.placed_nudges where tm_id = $1 order by id", [tm]);
const seatRow = async (tm: string) => c.one("select status, confirmed_at, contact_withheld from public.tribe_members where id = $1", [tm]);
const consent = (id: string) => c.sql("select version, granted from public.consents where person_id = $1 and purpose = 'whatsapp' order by id", [id]);
const phoneOf = async (id: string) => (await c.sql("select phone, preferred from public.contact_preferences where person_id = $1", [id]))[0];
const setSignin = (id: string, phone: string) => c.sql("update auth.users set phone = $2 where id = $1", [id, phone.replace("+", "")]);
const info = (link: string) => c.anon("worker_placed_nudge_info", token, link);
const choose = (link: string, mode: string, phone: string | null = null, signin = false) => c.anon("worker_placed_choose", token, link, mode, phone, signin, "v1");
/** One nudge from release to claim, for one member: the private link the email carried. */
async function nudge(person: string, tribe: string) {
  const id = await draft({ audience: { kind: "placed_waiting", tribe } });
  await c.as(c.director, "broadcast_submit", id, null);
  await release(id);
  const mine = new Set((await c.sql("select id from public.messages where person_id = $1 and template = 'office_message'", [person])).map((r) => r.id as string));
  const sent = (await claim()).find((m) => mine.has(m.id) && m.params?.placed && m.params.placed.secret);
  return { id, sent };
}
const linkFor = async (tm: string, person: string) => (await c.sql("select public.placement_token_mint($1, $2, 60) as t", [tm, person]))[0].t as string;

beforeAll(async () => {
  c = await makeCast();
  token = (await c.one("select public.bootstrap_worker_token('placed-nudge-test') as t")).t as string;
  champion = (await c.k.staff("Champion", "community_champion")).id;
}, 120_000);

afterAll(async () => {
  await unclock();
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await unclock();
  await c.sql("delete from public.placed_nudges");
  await c.sql("delete from public.placed_links");
  await c.sql("delete from public.number_confirmations");
  await c.sql("delete from public.broadcasts");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.contact_preferences");
  await c.sql("delete from public.consents where purpose in ('whatsapp', 'sms', 'email', 'announcements')");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.email_signals");
  await c.sql("update public.placed_nudge_settings set first_after_hours = 24, spacing_days = 3, max_per_seat = 2, reason = null");
  await c.sql("update public.tribe_members set contact_withheld = false, placement_source = 'self', placed_by_run = null, status = 'active'");
  await c.sql("update auth.users set phone = null");
});

describe("it ships Off", () => {
  it("is on the Switchboard, starts Off, offers Off, Rehearsal and On, and can be limited to a place", async () => {
    const a = await c.one("select * from public.feature_registry where key = 'placed_nudge'");
    expect(a).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 30 });
    expect(a.modes).toEqual(["off", "rehearsal", "on"]);
    expect(a.depends).toEqual([]);
    expect(await c.one("select * from public.placed_nudge_settings")).toMatchObject({ first_after_hours: 24, spacing_days: 3, max_per_seat: 2 });
  });

  it("does nothing while Off: the choice is hidden, the page offers nothing and no nudge is written", async () => {
    const t = await fresh("Quiet");
    const p = await placed("Quiet", t.tribe);
    expect(await c.as(c.admin, "placed_nudge_state")).toBe("off");
    await expectCode(preview(), "22023");
    await expectCode(c.as(c.director, "broadcast_save", null, JSON.stringify(fields())), "22023");
    expect(await info(await linkFor(p.tm, p.id))).toEqual({ on: false });
    expect(await c.sql("select 1 from public.placed_nudges")).toHaveLength(0);
    expect(await c.as(c.admin, "placed_nudge_overview")).toEqual({ state: "off" });
  });

  it("in Rehearsal shows the choice, the counts and the reasons, sends a test, and refuses to send", async () => {
    const t = await fresh("Rehearsal");
    await placed("Counted", t.tribe);
    await placed("Early", t.tribe, { sentHoursAgo: 3 });
    await rehearse();
    expect(await c.as(c.admin, "placed_nudge_state")).toBe("rehearsal");
    const count = await preview();
    expect(count).toMatchObject({ total: 2, will_send: 1, skipped: { placed_recent: 1 } });
    const id = await draft();
    await expectCode(c.as(c.director, "broadcast_submit", id, null), "22023");
    expect((await c.one("select status from public.broadcasts where id = $1", [id])).status).toBe("draft");
    await c.as(c.director, "broadcast_test_send", id);
    const test = await c.sql("select * from public.messages where template = 'office_message' and person_id = $1 and params ? 'test'", [c.director]);
    expect(test).toHaveLength(1);
    expect(await c.sql("select 1 from public.placed_nudges")).toHaveLength(0);
    // the page is as it is today
    const p = await placed("Page", t.tribe);
    expect(await info(await linkFor(p.tm, p.id))).toEqual({ on: false });
  });

  it("is for the office only: a community champion, a leader and a member cannot use it", async () => {
    await on();
    const t = await fresh("Office");
    for (const who of [c.member, t.leader.id, c.seasoned.id]) {
      expect(await c.as(who, "placed_nudge_state")).toBe("off");
      await expectCode(c.as(who, "placed_nudge_overview"), "42501");
    }
    expect(await c.as(champion, "placed_nudge_state")).toBe("off");
    await expectCode(c.as(champion, "audience_preview", { kind: "placed_waiting" }), "42501");
    await expectCode(c.anon("placed_nudge_state"), "42501");
    for (const who of [c.admin, c.director, c.pastor]) expect(await c.as(who, "placed_nudge_state")).toBe("on");
  });

  it("is held by the Master pause: nothing is skipped, and the send goes when it is lifted", async () => {
    await on();
    await clock();
    const t = await fresh("Paused");
    const p = await placed("Paused", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await c.as(c.director, "broadcast_submit", id, null);
    await c.o.call("god_feature_master", true, REASON);
    expect(await c.as(c.admin, "placed_nudge_state")).toBe("off");
    await release(id);
    expect((await c.one("select status from public.broadcasts where id = $1", [id])).status).toBe("scheduled");
    expect((await rec(id))[p.id]).toMatchObject({ status: "pending" });
    await c.o.call("god_feature_master", false, null);
    await release(id);
    expect((await rec(id))[p.id]).toMatchObject({ status: "queued" });
  });

  it("can be On for one tribe only: the others are counted as not switched on for them yet", async () => {
    const a = await fresh("Chosen");
    const b = await fresh("Left out");
    await placed("Chosen", a.tribe);
    await placed("Other", b.tribe);
    await c.set("placed_nudge", "on", { scope: "tribe", id: a.tribe, reason: REASON });
    expect(await preview()).toMatchObject({ total: 2, will_send: 1, skipped: { not_on: 1 } });
  });
});

describe("who is waiting, and who is left out", () => {
  it("counts a church-placed adult who has not said yes, and nobody else", async () => {
    await on();
    const t = await fresh("Waiting");
    const waiting = await placed("Waiting", t.tribe);
    const said = await placed("Said", t.tribe);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [said.tm]);
    const own = await c.k.seat(t.tribe, c.season, `Own${++n}`);
    const gone = await placed("Gone", t.tribe);
    await c.sql("update public.tribe_members set status = 'released' where id = $1", [gone.tm]);
    expect(await preview()).toMatchObject({ total: 1, will_send: 1, skipped: {} });
    const rows = await c.sql("select person_id from public.placed_waiting_rows((select centre_id from public.people where id = $1))", [waiting.id]);
    expect(rows.map((r) => r.person_id)).toContain(waiting.id);
    expect(rows.map((r) => r.person_id)).not.toContain(said.id);
    expect(rows.map((r) => r.person_id)).not.toContain(own.id);
    expect(rows.map((r) => r.person_id)).not.toContain(gone.id);
  });

  it("leaves out a season that is closed", async () => {
    await on();
    const t = await fresh("Closed");
    await placed("Closed", t.tribe);
    await c.sql("update public.seasons set status = 'closed' where id = $1", [c.season]);
    try {
      expect(await preview()).toMatchObject({ total: 0, will_send: 0 });
    } finally {
      await c.sql("update public.seasons set status = 'running' where id = $1", [c.season]);
    }
  });

  it("gives each reason its own count", async () => {
    await on();
    const t = await fresh("Reasons");
    const ok = await placed("Ok", t.tribe);
    const early = await placed("Early", t.tribe, { sentHoursAgo: 5 });
    const unsent = await placed("Unsent", t.tribe, { sentHoursAgo: null });
    const held = await placed("Held", t.tribe, { withheld: true });
    const stopped = await placed("Stopped", t.tribe);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'announcements', false, 'v1')", [stopped.id]);
    const teen = await placed("Teen", t.tribe);
    await makeTeen(teen.id);
    const gone = await placed("Deleting", t.tribe);
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [gone.id]);
    const bounced = await placed("Bounced", t.tribe);
    await c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [bounced.id]);
    const recent = await placed("Recent", t.tribe);
    await c.sql("insert into public.placed_nudges (tm_id, person_id, status, queued_at, sent_at) values ($1, $2, 'sent', now() - interval '1 day', now() - interval '1 day')", [recent.tm, recent.id]);
    const enough = await placed("Enough", t.tribe);
    await c.sql("insert into public.placed_nudges (tm_id, person_id, status, queued_at, sent_at) select $1, $2, 'sent', now() - interval '10 days', now() - interval '10 days' from generate_series(1, 2)", [enough.tm, enough.id]);
    void ok;
    void early;
    void unsent;
    void held;
    expect(await preview()).toMatchObject({
      total: 10,
      will_send: 1,
      skipped: { placed_recent: 2, withheld: 1, announcements_off: 1, under18: 1, deletion: 1, bounced: 1, nudged_recently: 1, nudged_enough: 1 },
    });
  });

  it("can be narrowed to those with no number or no WhatsApp yes, to one tribe, and to one community", async () => {
    await on();
    const a = await fresh("Narrow A");
    const b = await fresh("Narrow B");
    const none = await placed("None", a.tribe);
    const noYes = await placed("NoYes", a.tribe);
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [noYes.id, real()]);
    const fine = await placed("Fine", a.tribe);
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp')", [fine.id, real()]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'v1')", [fine.id]);
    await placed("Elsewhere", b.tribe);
    expect(await preview({ need: "all", tribe: a.tribe })).toMatchObject({ total: 3 });
    const gap = await preview({ need: "gap", tribe: a.tribe });
    expect(gap).toMatchObject({ total: 2, spec: { kind: "placed_waiting", need: "gap" } });
    expect(await preview({ tribe: b.tribe })).toMatchObject({ total: 1 });
    const comm = (await c.one("select id from public.communities limit 1")).id as string;
    await c.sql("update public.member_profiles set community_id = $2, season_goal_id = null, goal_other = 'My own goal' where person_id = $1", [none.id, comm]);
    const only = await preview({ community: comm });
    expect(only.total).toBe(1);
    await expectCode(preview({ need: "some" }), "22023");
    await expectCode(preview({ tribe: "not-a-tribe" }), "22023");
    await expectCode(preview({ waited_hours: 9000 }), "22023");
  });

  it("waits the placement email's age: 24 hours by default, longer if the writer asks, never shorter", async () => {
    await on();
    const t = await fresh("Wait");
    await placed("Day", t.tribe, { sentHoursAgo: 25 });
    await placed("Two days", t.tribe, { sentHoursAgo: 50 });
    expect(await preview()).toMatchObject({ total: 2, will_send: 2 });
    expect(await preview({ waited_hours: 48 })).toMatchObject({ total: 2, will_send: 1, skipped: { placed_recent: 1 } });
    expect(await preview({ waited_hours: 1 })).toMatchObject({ will_send: 2 });
    await c.sql("update public.placed_nudge_settings set first_after_hours = 60");
    expect(await preview({ waited_hours: 1 })).toMatchObject({ will_send: 0, skipped: { placed_recent: 2 } });
  });

  it("falls back to the day they joined the seat when the placement email has no record", async () => {
    await on();
    const t = await fresh("Fallback");
    const p = await placed("Fallback", t.tribe);
    await c.sql("delete from public.messages where person_id = $1", [p.id]);
    await c.sql("update public.tribe_members set joined_at = now() - interval '2 hours' where id = $1", [p.tm]);
    expect(await preview()).toMatchObject({ skipped: { placed_recent: 1 } });
    await c.sql("update public.tribe_members set joined_at = now() - interval '3 days' where id = $1", [p.tm]);
    expect(await preview()).toMatchObject({ will_send: 1 });
  });
});

describe("the nudge goes out, checked three times", () => {
  it("is released to the outbox as an ordinary announcement email, with a record of the nudge and no link or number in the message", async () => {
    await on();
    await clock();
    const t = await fresh("Release");
    const p = await placed("Release", t.tribe);
    const { id } = await nudge(p.id, t.tribe);
    const msg = (await c.sql("select * from public.messages where person_id = $1 and template = 'office_message'", [p.id]))[0];
    expect(msg).toMatchObject({ force_channel: "email", dedupe_key: `bc:${id}:${p.id}` });
    expect(JSON.stringify(msg.params)).toBe(JSON.stringify({ broadcast_id: id }));
    expect(msg.reply_token).toBeNull();
    const row = (await nudges(p.tm))[0];
    expect(row).toMatchObject({ status: "sent", broadcast_id: id, person_id: p.id });
    expect(row.sent_at).not.toBeNull();
    expect((await c.sql("select count(*)::int n from public.messages where template like 'placement%' and person_id = $1", [p.id]))[0].n).toBe(1);
  });

  it("makes the private links when each email is sent: the right seat, 64 characters, kept only as a fingerprint, not in the message row", async () => {
    await on();
    await clock();
    const t = await fresh("Links");
    const p = await placed("Links", t.tribe);
    const other = await placed("Other", t.tribe);
    const { sent } = await nudge(p.id, t.tribe);
    expect(sent).toBeTruthy();
    const secret = sent!.params.placed.secret as string;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(sent!.params.placed).toMatchObject({ tribe: expect.any(String), leader_first: expect.any(String), mode: expect.any(String) });
    const state = await c.anon("worker_placed_info", token, secret);
    expect(state).toMatchObject({ found: true, active: true });
    const hash = (await c.one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [secret])).h as string;
    expect(await c.sql("select 1 from public.placement_tokens where token_hash = $1 and placement_id = $2", [hash, p.tm])).toHaveLength(1);
    expect(await c.sql("select 1 from public.placed_links where token_hash = $1 and source = 'nudge' and person_id = $2", [hash, p.id])).toHaveLength(1);
    expect(JSON.stringify(await c.sql("select params, reply_token from public.messages where person_id in ($1, $2)", [p.id, other.id]))).not.toContain(secret);
    expect(JSON.stringify(await c.sql("select * from public.event_log order by id desc limit 50"))).not.toContain(secret);
  });

  it("makes new links on a retry", async () => {
    await on();
    await clock();
    const t = await fresh("Retry");
    const p = await placed("Retry", t.tribe);
    const { sent } = await nudge(p.id, t.tribe);
    const first = sent!.params.placed.secret as string;
    await c.sql("update public.messages set status = 'queued', scheduled_for = now() where id = $1", [sent!.id]);
    const again = (await claim()).find((m) => m.id === sent!.id);
    expect(again).toBeTruthy();
    expect(again!.params.placed.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(again!.params.placed.secret).not.toBe(first);
    expect(await nudges(p.tm)).toHaveLength(1);
  });

  it("drops a member who said yes between the count and the release", async () => {
    await on();
    await clock();
    const t = await fresh("Release check");
    const a = await placed("Stays", t.tribe);
    const b = await placed("Answers", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    expect((await c.as(c.director, "broadcast_submit", id, null)).count).toBe(2);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [b.tm]);
    await release(id);
    const by = await rec(id);
    expect(by[a.id]).toMatchObject({ status: "queued" });
    expect(by[b.id]).toMatchObject({ status: "skipped", reason: "answered_since" });
    expect(await nudges(b.tm)).toHaveLength(0);
  });

  it("drops a member who gave up the seat or held back their details before the release", async () => {
    await on();
    await clock();
    const t = await fresh("Release more");
    const gone = await placed("Gone", t.tribe);
    const held = await placed("Held", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await c.as(c.director, "broadcast_submit", id, null);
    await c.sql("update public.tribe_members set status = 'released' where id = $1", [gone.tm]);
    await c.sql("update public.tribe_members set contact_withheld = true where id = $1", [held.tm]);
    await release(id);
    const by = await rec(id);
    expect(by[gone.id]).toMatchObject({ status: "skipped", reason: "answered_since" });
    expect(by[held.id]).toMatchObject({ status: "skipped", reason: "withheld" });
  });

  it("drops a member who answered between the release and the moment their email is sent, and leaves a record of why", async () => {
    await on();
    await clock();
    const t = await fresh("Send check");
    const a = await placed("Stays", t.tribe);
    const b = await placed("Answers", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await c.as(c.director, "broadcast_submit", id, null);
    await release(id);
    expect(await nudges(b.tm)).toHaveLength(1);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [b.tm]);
    const sent = (await claim()).filter((m) => m.template === "office_message");
    expect(sent).toHaveLength(1);
    const msgB = (await c.sql("select status, error from public.messages where person_id = $1 and template = 'office_message'", [b.id]))[0];
    expect(msgB).toMatchObject({ status: "skipped", error: "answered_since" });
    expect((await nudges(b.tm))[0]).toMatchObject({ status: "skipped", reason: "answered_since" });
    expect((await rec(id))[b.id]).toMatchObject({ status: "skipped", reason: "answered_since" });
    expect((await nudges(a.tm))[0]).toMatchObject({ status: "sent" });
  });

  it("keeps three days between nudges and at most two for one seat, and the owner can change both", async () => {
    await on();
    await clock();
    const t = await fresh("Spacing");
    const p = await placed("Spacing", t.tribe);
    await nudge(p.id, t.tribe);
    expect(await preview({ tribe: t.tribe })).toMatchObject({ will_send: 0, skipped: { nudged_recently: 1 } });
    await c.sql("update public.placed_nudges set queued_at = now() - interval '4 days', sent_at = now() - interval '4 days' where tm_id = $1", [p.tm]);
    expect(await preview({ tribe: t.tribe })).toMatchObject({ will_send: 1 });
    await nudge(p.id, t.tribe);
    await c.sql("update public.placed_nudges set queued_at = now() - interval '4 days', sent_at = now() - interval '4 days' where tm_id = $1", [p.tm]);
    expect(await nudges(p.tm)).toHaveLength(2);
    expect(await preview({ tribe: t.tribe })).toMatchObject({ will_send: 0, skipped: { nudged_enough: 1 } });
    await c.o.call("god_placed_nudge_settings_set", 24, 1, 3, "Trying a third nudge");
    expect(await preview({ tribe: t.tribe })).toMatchObject({ will_send: 1 });
  });

  it("counts toward the weekly limit of announcements and reminders", async () => {
    await on();
    await clock();
    const t = await fresh("Weekly");
    const p = await placed("Weekly", t.tribe);
    await c.sql("insert into public.messages (person_id, template, params, status) select $1, 'office_message', '{}', 'sent' from generate_series(1, 3)", [p.id]);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await c.as(c.director, "broadcast_submit", id, null);
    await release(id);
    expect((await rec(id))[p.id]).toMatchObject({ status: "skipped", reason: "weekly_cap" });
  });

  it("holds a scheduled send when the function is switched Off, and sends it when it is On again", async () => {
    await on();
    await clock();
    const t = await fresh("Switch");
    const p = await placed("Switch", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await c.as(c.director, "broadcast_submit", id, null);
    await c.set("placed_nudge", "off", { reason: REASON });
    await release(id);
    expect((await rec(id))[p.id]).toMatchObject({ status: "pending" });
    expect((await c.one("select status from public.broadcasts where id = $1", [id])).status).toBe("scheduled");
    await on();
    await release(id);
    expect((await rec(id))[p.id]).toMatchObject({ status: "queued" });
  });

  it("refuses to be scheduled or approved in Rehearsal or Off, even if it was written while On", async () => {
    await on();
    const t = await fresh("Late");
    await placed("Late", t.tribe);
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    await rehearse();
    await expectCode(c.as(c.director, "broadcast_submit", id, null), "22023");
    await c.set("placed_nudge", "off", { reason: REASON });
    await expectCode(c.as(c.director, "broadcast_submit", id, null), "22023");
  });

  it("fixes the buttons: a writer cannot add one to a nudge", async () => {
    await on();
    const id = await draft({ button_label: "Open my page", button_target: "/home" });
    const b = await c.one("select button_label, button_target from public.broadcasts where id = $1", [id]);
    expect(b).toEqual({ button_label: null, button_target: null });
    const other = await c.as(c.director, "broadcast_save", null, JSON.stringify(fields({ audience: { kind: "everyone" }, button_label: "Open my page", button_target: "/home" })));
    expect(await c.one("select button_label from public.broadcasts where id = $1", [other])).toEqual({ button_label: "Open my page" });
  });

  it("sends the office a test with a made-up tribe and links that go nowhere, and records no nudge", async () => {
    await on();
    await clock();
    const t = await fresh("Test");
    await placed("Test", t.tribe);
    const id = await draft();
    await c.as(c.director, "broadcast_test_send", id);
    const sent = await claim();
    const mine = sent.find((m) => m.template === "office_message");
    expect(mine).toBeTruthy();
    expect(mine!.params.placed).toMatchObject({ sample: true, tribe: "Builders Tribe", secret: "0".repeat(64) });
    expect(mine!.params.copy.subject).toMatch(/^\[Test\]/);
    expect(await c.anon("worker_placed_info", token, "0".repeat(64))).toMatchObject({ found: false });
    expect(await c.sql("select 1 from public.placed_nudges")).toHaveLength(0);
  });

  it("pauses itself after 50 have gone if more than 1 in 100 stop announcements, and tells the director", async () => {
    await on();
    await clock();
    const t = await fresh("Selfcheck");
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    const p = await placed("One", t.tribe);
    await c.as(c.director, "broadcast_submit", id, null);
    await c.sql("update public.broadcasts set status = 'sending', started_at = now() - interval '1 hour' where id = $1", [id]);
    // fifty-odd who have been sent it, and two who then stopped announcements
    const fake = await c.sql("select id from public.people where centre_id = (select centre_id from public.people where id = $1) limit 60", [p.id]);
    for (const [i, r] of fake.entries()) {
      const m = (await c.sql("insert into public.messages (person_id, template, params, status, sent_at) values ($1, 'office_message', '{}', 'sent', now()) returning id", [r.id]))[0].id;
      await c.sql("insert into public.broadcast_recipients (broadcast_id, person_id, status, message_id) values ($1, $2, 'queued', $3) on conflict do nothing", [id, r.id, m]);
      if (i < 2) await c.sql("insert into public.email_signals (person_id, kind, broadcast_id) values ($1, 'unsubscribe', $2)", [r.id, id]);
    }
    const sentCount = (await c.one("select count(*)::int n from public.broadcast_recipients r join public.messages m on m.id = r.message_id where r.broadcast_id = $1 and m.status = 'sent'", [id])).n as number;
    expect(sentCount).toBeGreaterThanOrEqual(50);
    await c.sql("select public.broadcasts_release()");
    expect((await c.one("select status from public.broadcasts where id = $1", [id])).status).toBe("paused");
    expect(await c.sql("select 1 from public.messages where template = 'reminder_paused'")).not.toHaveLength(0);
    expect(await c.sql("select 1 from public.event_log where action = 'placed_nudge.self_paused'")).toHaveLength(1);
  });

  it("does not pause itself when fewer than 50 have gone", async () => {
    await on();
    await clock();
    const t = await fresh("Small");
    const id = await draft({ audience: { kind: "placed_waiting", tribe: t.tribe } });
    const p = await placed("Small", t.tribe);
    await c.as(c.director, "broadcast_submit", id, null);
    await c.sql("update public.broadcasts set status = 'sending' where id = $1", [id]);
    await c.sql("insert into public.email_signals (person_id, kind, broadcast_id) values ($1, 'unsubscribe', $2)", [p.id, id]);
    expect(await c.one("select public.placed_nudge_selfcheck($1) as paused", [id])).toEqual({ paused: false });
  });

  it("gives the results two more rows: said yes since, and agreed to WhatsApp since", async () => {
    await on();
    await clock();
    const t = await fresh("Results");
    const a = await placed("Yes", t.tribe);
    const b = await placed("Both", t.tribe);
    const d = await placed("Silent", t.tribe);
    const { id } = await nudge(a.id, t.tribe);
    await c.sql("update public.placed_nudges set sent_at = now() - interval '1 hour' where broadcast_id = $1", [id]);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = any($1)", [[a.tm, b.tm]]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'placed-v1')", [b.id]);
    void d;
    const r = await c.as(c.director, "broadcast_results", id);
    expect(r.placed).toEqual({ asked: 3, said_yes: 2, agreed: 1 });
    const plain = await c.as(c.director, "broadcast_save", null, JSON.stringify(fields({ audience: { kind: "everyone" } })));
    expect((await c.as(c.director, "broadcast_results", plain)).placed).toBeUndefined();
  });
});

describe("the private page", () => {
  const ready = async (over: { phone?: string | null; signin?: string | null; yes?: boolean } = {}) => {
    await on();
    const t = await fresh("Page");
    const p = await placed("Page", t.tribe);
    if (over.phone) await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [p.id, over.phone]);
    if (over.signin) await setSignin(p.id, over.signin);
    if (over.yes) await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'v1')", [p.id]);
    return { ...p, link: await linkFor(p.tm, p.id), t };
  };

  it("tells a link that is good, one that ran out, a seat that is gone and one we never made", async () => {
    const p = await ready();
    expect(await c.anon("worker_placed_link_state", token, p.link)).toEqual({ state: "ok" });
    const hash = (await c.one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [p.link])).h as string;
    await c.sql("update public.placement_tokens set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    await c.sql("update public.placed_links set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    expect(await c.anon("worker_placed_link_state", token, p.link)).toEqual({ state: "expired" });
    expect(await c.anon("worker_placed_info", token, p.link)).toEqual({ found: false });
    await c.sql("update public.tribe_members set status = 'released' where id = $1", [p.tm]);
    expect(await c.anon("worker_placed_link_state", token, p.link)).toEqual({ state: "gone" });
    expect(await c.anon("worker_placed_link_state", token, "a".repeat(64))).toEqual({ state: "unknown" });
    expect(await c.anon("worker_placed_link_state", token, "not a link")).toEqual({ state: "unknown" });
    await expectCode(c.anon("worker_placed_link_state", "nope", p.link), "42501");
  });

  it("saves nothing when it is opened", async () => {
    const p = await ready({ phone: real(), signin: real() });
    const before = JSON.stringify([await seatRow(p.tm), await consent(p.id), await phoneOf(p.id), await c.sql("select * from public.number_confirmations")]);
    await c.anon("worker_placed_info", token, p.link);
    await c.anon("worker_placed_nudge_info", token, p.link);
    await c.anon("worker_placed_link_state", token, p.link);
    expect(JSON.stringify([await seatRow(p.tm), await consent(p.id), await phoneOf(p.id), await c.sql("select * from public.number_confirmations")])).toBe(before);
  });

  it("shows the number only with its middle hidden, and the one they sign in with", async () => {
    const number = real();
    const signin = real();
    const p = await ready({ phone: number, signin });
    const i = await info(p.link);
    expect(i).toMatchObject({ on: true, yes: false });
    expect(i.number).toMatch(/^\+234•+\d\d$/);
    expect(i.signin).toMatch(/^\+234•+\d\d$/);
    expect(JSON.stringify(i)).not.toContain(number.slice(4, 10));
    const none = await ready();
    expect(await info(none.link)).toEqual({ on: true, number: null, signin: null, yes: false });
  });

  it("offers nothing to a member who held back their details, a teenager, a deletion, or one who already said yes", async () => {
    const held = await ready();
    await c.sql("update public.tribe_members set contact_withheld = true where id = $1", [held.tm]);
    expect(await info(held.link)).toEqual({ on: false });
    const teen = await ready();
    await makeTeen(teen.id);
    expect(await info(teen.link)).toEqual({ on: false });
    const gone = await ready();
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [gone.id]);
    expect(await info(gone.link)).toEqual({ on: false });
    const said = await ready();
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [said.tm]);
    expect(await info(said.link)).toEqual({ on: false });
    expect(await info("a".repeat(64))).toEqual({ on: false });
  });

  it("says yes by email only: the seat is confirmed, no WhatsApp yes is written and no number is saved", async () => {
    const p = await ready({ signin: real() });
    expect(await choose(p.link, "email", real())).toEqual({ ok: true, mode: "email" });
    expect((await seatRow(p.tm)).confirmed_at).not.toBeNull();
    expect(await consent(p.id)).toHaveLength(0);
    expect(await phoneOf(p.id)).toBeUndefined();
    expect(await c.sql("select 1 from public.number_confirmations")).toHaveLength(0);
  });

  it("says yes and agrees to WhatsApp in one press: the seat, the number, the yes (placed-v1) and the preference all land together", async () => {
    const p = await ready();
    const number = real();
    expect(await choose(p.link, "whatsapp", number)).toEqual({ ok: true, mode: "whatsapp", confirmed: false });
    expect((await seatRow(p.tm)).confirmed_at).not.toBeNull();
    expect(await consent(p.id)).toEqual([{ version: "placed-v1", granted: true }]);
    expect(await phoneOf(p.id)).toEqual({ phone: number, preferred: "whatsapp" });
    expect((await c.one("select whatsapp from public.member_profiles where person_id = $1", [p.id])).whatsapp).toBe(number);
    expect(await c.sql("select 1 from public.number_confirmations")).toHaveLength(0);
    const events = await c.sql("select action from public.event_log where actor_id = $1 and action like 'placed.%'", [p.id]);
    expect(events.map((e) => e.action)).toContain("placed.whatsapp_agreed");
    expect(JSON.stringify(await c.sql("select * from public.event_log order by id desc limit 20"))).not.toContain(number);
  });

  it("uses the number we already hold when none is typed", async () => {
    const held = real();
    const p = await ready({ phone: held });
    await choose(p.link, "whatsapp");
    expect(await phoneOf(p.id)).toEqual({ phone: held, preferred: "whatsapp" });
    expect(await consent(p.id)).toHaveLength(1);
  });

  it("uses the number they sign in with, and confirms it on the spot", async () => {
    const signin = real();
    const p = await ready({ signin });
    expect(await choose(p.link, "whatsapp", null, true)).toEqual({ ok: true, mode: "whatsapp", confirmed: true });
    expect((await phoneOf(p.id)).phone).toBe(signin);
    const rows = await c.sql("select method, fingerprint from public.number_confirmations where person_id = $1", [p.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe("signin");
    expect(JSON.stringify(rows)).not.toContain(signin.slice(4));
    expect(await c.one("select public.number_confirmed($1) as how", [p.id])).toEqual({ how: "signin" });
  });

  it("confirms a typed number that is the sign-in number, and does not confirm a different one", async () => {
    const signin = real();
    const a = await ready({ signin });
    expect(await choose(a.link, "whatsapp", signin)).toMatchObject({ confirmed: true });
    const b = await ready({ signin: real() });
    expect(await choose(b.link, "whatsapp", real())).toMatchObject({ confirmed: false });
    expect(await c.one("select public.number_confirmed($1) as how", [b.id])).toEqual({ how: null });
  });

  it("blocks the whole press when the number does not look right: the seat stays unconfirmed and nothing is saved", async () => {
    const p = await ready();
    for (const bad of ["12345", "+2340000000000", "not a number", "+2348012"]) {
      await expectCode(choose(p.link, "whatsapp", bad), "22023");
    }
    expect((await seatRow(p.tm)).confirmed_at).toBeNull();
    expect(await consent(p.id)).toHaveLength(0);
    expect(await phoneOf(p.id)).toBeUndefined();
    // no number at all
    await expectCode(choose(p.link, "whatsapp"), "22023");
    expect((await seatRow(p.tm)).confirmed_at).toBeNull();
    // and the same link still works once the number is right
    expect(await choose(p.link, "whatsapp", real())).toMatchObject({ ok: true });
  });

  it("does not write a second yes to a member who already agreed", async () => {
    const p = await ready({ phone: real(), yes: true });
    await choose(p.link, "whatsapp");
    expect(await consent(p.id)).toEqual([{ version: "v1", granted: true }]);
  });

  it("is no longer confirmed once the number changes", async () => {
    const signin = real();
    const p = await ready({ signin });
    await choose(p.link, "whatsapp", null, true);
    expect(await c.one("select public.number_confirmed($1) as how", [p.id])).toEqual({ how: "signin" });
    const other = real();
    await c.sql("update public.contact_preferences set phone = $2 where person_id = $1", [p.id, other]);
    expect(await c.one("select public.number_confirmed($1) as how", [p.id])).toEqual({ how: null });
    await c.sql("update public.contact_preferences set phone = $2 where person_id = $1", [p.id, signin]);
    expect(await c.one("select public.number_confirmed($1) as how", [p.id])).toEqual({ how: "signin" });
  });

  it("refuses WhatsApp to a member who held back their details, but lets them say yes by email", async () => {
    const p = await ready();
    await c.sql("update public.tribe_members set contact_withheld = true where id = $1", [p.tm]);
    expect(await choose(p.link, "whatsapp", real())).toEqual({ ok: false, reason: "not_available" });
    expect(await consent(p.id)).toHaveLength(0);
    expect(await choose(p.link, "email")).toEqual({ ok: true, mode: "email" });
  });

  it("answers a seat that is gone or a link we do not know with the same plain answer, and a wrong mode with an error", async () => {
    const p = await ready();
    await c.sql("update public.tribe_members set status = 'released' where id = $1", [p.tm]);
    expect(await choose(p.link, "email")).toMatchObject({ ok: false });
    expect(await choose("a".repeat(64), "email")).toEqual({ ok: false, reason: "invalid" });
    await expectCode(choose(p.link, "sms"), "22023");
    await expectCode(c.anon("worker_placed_choose", "nope", p.link, "email", null, false, "v1"), "42501");
  });

  it("sends a fresh link for one that ran out: three a day, to a seat still waiting, quietly otherwise", async () => {
    const p = await ready();
    const params = { tribe: "Page Tribe", leader_first: "Ngozi" };
    await c.sql("update public.messages set params = $2 where dedupe_key = $1", [`placement:${p.tm}`, JSON.stringify(params)]);
    const hash = (await c.one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [p.link])).h as string;
    await c.sql("update public.placed_links set expires_at = now() - interval '1 day' where token_hash = $1", [hash]);
    for (let i = 0; i < 5; i++) expect(await c.anon("worker_placed_new_link", token, p.link)).toEqual({ ok: true });
    const mails = await c.sql("select reply_token, params, force_channel from public.messages where person_id = $1 and template = 'placement_reminder' order by created_at", [p.id]);
    expect(mails).toHaveLength(3);
    for (const m of mails) {
      expect(m.reply_token).toMatch(/^[a-f0-9]{64}$/);
      expect(m.params).toMatchObject(params);
      expect(m.force_channel).toBe("email");
      expect(await c.anon("worker_placed_info", token, m.reply_token)).toMatchObject({ found: true });
    }
    expect(new Set(mails.map((m) => m.reply_token)).size).toBe(3);
    // unknown link, confirmed seat, a person who cannot be written to: the same answer, nothing sent
    expect(await c.anon("worker_placed_new_link", token, "b".repeat(64))).toEqual({ ok: true });
    const q = await ready();
    await c.sql("update public.messages set params = '{\"tribe\":\"x\"}' where dedupe_key = $1", [`placement:${q.tm}`]);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [q.tm]);
    expect(await c.anon("worker_placed_new_link", token, q.link)).toEqual({ ok: true });
    const r = await ready();
    await c.sql("update public.messages set params = '{\"tribe\":\"x\"}' where dedupe_key = $1", [`placement:${r.tm}`]);
    await c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [r.id]);
    expect(await c.anon("worker_placed_new_link", token, r.link)).toEqual({ ok: true });
    expect((await c.sql("select 1 from public.messages where template = 'placement_reminder' and person_id = any($1)", [[q.id, r.id]]))).toHaveLength(0);
  });
});

describe("the original placement email's retry", () => {
  it("keeps a fingerprint of every private link the placement makes", async () => {
    const t = await fresh("Mint");
    const p = await placed("Mint", t.tribe);
    const link = await linkFor(p.tm, p.id);
    const hash = (await c.one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [link])).h as string;
    expect(await c.sql("select source, person_id, placement_id from public.placed_links where token_hash = $1", [hash])).toEqual([{ source: "placement", person_id: p.id, placement_id: p.tm }]);
    expect(await c.sql("select 1 from public.placement_tokens where token_hash = $1", [hash])).toHaveLength(1);
  });

  it("gives a retried placement email a new private link instead of the signed-in fallback", async () => {
    const t = await fresh("Retried");
    const p = await placed("Retried", t.tribe);
    const m = (await c.sql("select id from public.messages where dedupe_key = $1", [`placement:${p.tm}`]))[0].id as string;
    await c.sql("update public.messages set status = 'failed', reply_token = null where id = $1", [m]);
    await c.as(c.admin, "retry_message", m);
    const row = (await c.sql("select status, reply_token from public.messages where id = $1", [m]))[0];
    expect(row.status).toBe("queued");
    expect(row.reply_token).toMatch(/^[a-f0-9]{64}$/);
    expect(await c.anon("worker_placed_info", token, row.reply_token)).toMatchObject({ found: true, active: true });
    // the reminder too
    await c.sql("insert into public.messages (person_id, template, params, status, dedupe_key) values ($1, 'placement_reminder', '{}', 'failed', $2)", [p.id, `placement-reminder:${p.tm}`]);
    const r = (await c.sql("select id from public.messages where dedupe_key = $1", [`placement-reminder:${p.tm}`]))[0].id as string;
    await c.as(c.director, "retry_message", r);
    expect((await c.one("select reply_token from public.messages where id = $1", [r])).reply_token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("makes no link for a seat that has since answered, keeps every other retry as it was, and is for admins and directors only", async () => {
    const t = await fresh("Retry other");
    const p = await placed("Said", t.tribe);
    const m = (await c.sql("select id from public.messages where dedupe_key = $1", [`placement:${p.tm}`]))[0].id as string;
    await c.sql("update public.messages set status = 'failed', reply_token = null where id = $1", [m]);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [p.tm]);
    await c.as(c.admin, "retry_message", m);
    expect((await c.one("select reply_token from public.messages where id = $1", [m])).reply_token).toBeNull();
    const plain = (await c.sql("insert into public.messages (person_id, template, params, status) values ($1, 'welcome', '{}', 'failed') returning id", [p.id]))[0].id as string;
    await c.as(c.admin, "retry_message", plain);
    expect((await c.one("select status, reply_token from public.messages where id = $1", [plain]))).toEqual({ status: "queued", reply_token: null });
    await expectCode(c.as(c.pastor, "retry_message", plain), "42501");
    await expectCode(c.as(c.member, "retry_message", plain), "42501");
  });
});

describe("what the office and the leader see", () => {
  it("shows the home card how many placed members wait and how many have waited more than two days, never a name", async () => {
    await on();
    const t = await fresh("Card");
    await placed("New", t.tribe, { sentHoursAgo: 5 });
    await placed("Old", t.tribe, { sentHoursAgo: 80 });
    const teen = await placed("Teen", t.tribe, { sentHoursAgo: 80 });
    await makeTeen(teen.id);
    const card = await c.as(c.admin, "placed_nudge_overview");
    expect(card).toEqual({ state: "on", waiting: 2, waited_two_days: 1 });
    await rehearse();
    expect((await c.as(c.director, "placed_nudge_overview")).state).toBe("rehearsal");
    await expectCode(c.as(champion, "placed_nudge_overview"), "42501");
  });

  it("tells a tribe's leader, assistant, coach, pastor and director when a waiting member was reminded, and no one else", async () => {
    await on();
    await clock();
    const t = await fresh("Marks");
    const p = await placed("Marks", t.tribe);
    const q = await placed("Quiet", t.tribe, { sentHoursAgo: 3 });
    await nudge(p.id, t.tribe);
    for (const who of [t.leader.id, c.pastor, c.director]) {
      const marks = (await c.as(who, "tribe_nudge_marks", t.tribe)) as Array<{ person_id: string; reminded_at: string | null; number_confirmed: boolean }>;
      const by = Object.fromEntries(marks.map((m) => [m.person_id, m]));
      expect(by[p.id].reminded_at).not.toBeNull();
      expect(by[q.id].reminded_at).toBeNull();
      expect(by[p.id].number_confirmed).toBe(false);
    }
    await expectCode(c.as(c.member, "tribe_nudge_marks", t.tribe), "42501");
    await expectCode(c.as(c.admin, "tribe_nudge_marks", t.tribe), "42501");
    await expectCode(c.anon("tribe_nudge_marks", t.tribe), "42501");
    await expectCode(c.as(t.leader.id, "tribe_nudge_marks", NOBODY), "P0002");
  });

  it("marks a number confirmed for the leader only after yes, WhatsApp and proof, and shows no number", async () => {
    await on();
    const t = await fresh("Proof");
    const signin = real();
    const p = await placed("Proof", t.tribe);
    await setSignin(p.id, signin);
    await choose(await linkFor(p.tm, p.id), "whatsapp", null, true);
    const marks = (await c.as(t.leader.id, "tribe_nudge_marks", t.tribe)) as Array<{ person_id: string; reminded_at: string | null; number_confirmed: boolean }>;
    expect(marks.find((m) => m.person_id === p.id)).toMatchObject({ number_confirmed: true, reminded_at: null });
    expect(JSON.stringify(marks)).not.toContain(signin.slice(4));
  });

  it("gives Contact gaps who has a confirmed number and a count of those who agreed, to its own roles", async () => {
    await on();
    const t = await fresh("Gaps");
    const a = await placed("Confirmed", t.tribe);
    await setSignin(a.id, real());
    await choose(await linkFor(a.tm, a.id), "whatsapp", null, true);
    const b = await placed("Agreed", t.tribe);
    await choose(await linkFor(b.tm, b.id), "whatsapp", real());
    const d = await placed("Email", t.tribe);
    await choose(await linkFor(d.tm, d.id), "email");
    const how = await c.as(c.admin, "number_confirmed_for", [a.id, b.id, d.id]);
    expect(how).toEqual({ [a.id]: "signin" });
    expect(await c.as(c.admin, "whatsapp_confirmed_counts")).toMatchObject({ agreed: expect.any(Number), confirmed: expect.any(Number) });
    const counts = await c.as(c.director, "whatsapp_confirmed_counts");
    expect(counts.agreed).toBeGreaterThanOrEqual(2);
    expect(counts.confirmed).toBeGreaterThanOrEqual(1);
    expect(counts.confirmed).toBeLessThanOrEqual(counts.agreed);
    await expectCode(c.as(c.member, "number_confirmed_for", [a.id]), "42501");
    await expectCode(c.as(c.member, "whatsapp_confirmed_counts"), "42501");
    await expectCode(c.anon("number_confirmed_for", [a.id]), "42501");
    await expectCode(c.as(c.admin, "number_confirmed_for", Array.from({ length: 501 }, () => a.id)), "22023");
  });

  it("adds a Number confirmed column to the Contact gaps download and still holds no phone number", async () => {
    await c.set("contact_gaps", "on", { reason: REASON });
    await on();
    const t = await fresh("Export");
    const signin = real();
    const a = await placed("Export", t.tribe);
    await setSignin(a.id, signin);
    await choose(await linkFor(a.tm, a.id), "whatsapp", null, true);
    await placed("Other", t.tribe);
    const rows = (await c.as(c.admin, "contact_gaps_export")) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.number_confirmed).toBe("boolean");
    expect(JSON.stringify(rows)).not.toMatch(/\+?\d{9,}/);
  });
});

describe("the owner's three numbers", () => {
  it("are read and changed by the owner only, with a reason, inside their ranges, and every change is logged", async () => {
    expect(await c.o.call("god_placed_nudge_settings")).toMatchObject({ first_after_hours: 24, spacing_days: 3, max_per_seat: 2 });
    for (const who of [c.admin, c.director, c.pastor, c.member]) {
      await expectCode(c.as(who, "god_placed_nudge_settings"), "42501");
      await expectCode(c.as(who, "god_placed_nudge_settings_set", 24, 3, 2, REASON), "42501");
    }
    await expectCode(c.anon("god_placed_nudge_settings"), "42501");
    for (const bad of [
      [24, 3, 2, ""],
      [24, 3, 2, "no"],
      [-1, 3, 2, REASON],
      [241, 3, 2, REASON],
      [24, 0, 2, REASON],
      [24, 15, 2, REASON],
      [24, 3, 0, REASON],
      [24, 3, 5, REASON],
    ]) {
      await expectCode(c.o.call("god_placed_nudge_settings_set", ...bad), "22023");
    }
    const out = await c.o.call("god_placed_nudge_settings_set", 48, 2, 3, "Giving them two days first");
    expect(out).toMatchObject({ first_after_hours: 48, spacing_days: 2, max_per_seat: 3, reason: "Giving them two days first" });
    const ev = await c.sql("select meta from public.event_log where action = 'placed_nudge.settings' order by id desc limit 1");
    expect(ev[0].meta).toMatchObject({ reason: "Giving them two days first", from: { first_after: 24, spacing: 3, max: 2 }, to: { first_after: 48, spacing: 2, max: 3 } });
  });

  it("change what the rules do", async () => {
    await on();
    const t = await fresh("Numbers");
    await placed("Numbers", t.tribe, { sentHoursAgo: 30 });
    expect(await preview()).toMatchObject({ will_send: 1 });
    await c.o.call("god_placed_nudge_settings_set", 48, 3, 2, "Giving them two days first");
    expect(await preview()).toMatchObject({ will_send: 0, skipped: { placed_recent: 1 } });
  });
});

describe("who may call what", () => {
  it("keeps the helpers and the member functions out of reach of a signed-in person, and the office functions out of reach of the public", async () => {
    const internal = [
      ["placed_is_waiting", [NOBODY]],
      ["placed_nudge_any", []],
      ["placed_nudge_blocker", [NOBODY, {}, false, null]],
      ["placed_waiting_rows", [NOBODY]],
      ["number_confirmed", [NOBODY]],
      ["placed_nudge_selfcheck", [NOBODY]],
      ["placed_held_number", [NOBODY]],
    ] as const;
    for (const [fn, args] of internal) {
      await expectCode(c.as(c.admin, fn, ...args), "42501");
      await expectCode(c.anon(fn, ...args), "42501");
    }
    const worker = ["worker_placed_link_state", "worker_placed_nudge_info", "worker_placed_new_link"];
    for (const fn of worker) {
      await expectCode(c.as(c.admin, fn, token, "a".repeat(64)), "42501");
      await expectCode(c.anon(fn, "wrong-token", "a".repeat(64)), "42501");
    }
    await expectCode(c.as(c.admin, "worker_placed_choose", token, "a".repeat(64), "email", null, false, "v1"), "42501");
  });
});

describe("privacy", () => {
  it("puts no phone number in any email the nudge makes, in the message rows, or in the answers the office functions give", async () => {
    await on();
    await clock();
    const t = await fresh("Private");
    const number = real();
    const signin = real();
    const p = await placed("Private", t.tribe);
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'email')", [p.id, number]);
    await setSignin(p.id, signin);
    const { sent } = await nudge(p.id, t.tribe);
    const everything = JSON.stringify([
      { params: sent!.params, template: sent!.template, channel: sent!.channel },
      await c.sql("select params, reply_token from public.messages"),
      await c.as(c.admin, "placed_nudge_overview"),
      await c.as(t.leader.id, "tribe_nudge_marks", t.tribe),
      await c.as(c.admin, "audience_preview", { kind: "placed_waiting" }),
    ]);
    for (const secretNumber of [number, signin]) {
      expect(everything).not.toContain(secretNumber);
      expect(everything).not.toContain(secretNumber.slice(1));
      expect(everything).not.toContain(secretNumber.slice(4));
    }
  });

  it("lets a leader see no number before a yes, whatever the nudge did", async () => {
    await on();
    await clock();
    const t = await fresh("Leader sees");
    const number = real();
    const p = await placed("Leader sees", t.tribe);
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp')", [p.id, number]);
    await c.sql("update public.member_profiles set whatsapp = $2 where person_id = $1", [p.id, number]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'v1')", [p.id]);
    await nudge(p.id, t.tribe);
    const roster = await c.as(t.leader.id, "tribe_roster_marked", t.tribe);
    expect(JSON.stringify(roster)).not.toContain(number);
  });

  it("writes nothing about WhatsApp for a member who only opens the email's link", async () => {
    await on();
    await clock();
    const t = await fresh("Opens");
    const p = await placed("Opens", t.tribe);
    const { sent } = await nudge(p.id, t.tribe);
    const secret = sent!.params.placed.secret as string;
    const before = JSON.stringify([await consent(p.id), await phoneOf(p.id), await seatRow(p.tm)]);
    await c.anon("worker_placed_info", token, secret);
    await c.anon("worker_placed_nudge_info", token, secret);
    expect(JSON.stringify([await consent(p.id), await phoneOf(p.id), await seatRow(p.tm)])).toBe(before);
  });
});
