import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The seat window (Package 6, the 48-hour clock). What these prove:
//   * it ships Off; Off does nothing, Rehearsal keeps a clock and writes down what it would do without sending or moving anyone, and it cannot be put On while a check is red
//   * only a seat the church placed, whose "Your tribe" email went after the day the owner sets, and who has not answered, gets a clock
//   * a reminder at hour 24 and a last call at hour 40, each once, only inside 9 am to 7 pm in Lagos; the deadline never lands at night
//   * at the deadline, and never less than 6 hours after the last call, the seat is released kindly and offered at once to the best fit at the bar or above
//   * nobody in the never-release list is ever released, a seat whose emails failed is "Not reached", and a site that missed its beats gives a fresh 12 hours once
//   * the breakers hold every release; the Master pause stops every clock and gives back the time it had left
//   * the member can take the seat back by their private link, the office can keep, extend, release now and give back, and the leader can ask for more time
//   * the table itself refuses a 13th active member, and the ledger of seats only ever grows

let c: Cast;
let n = 0;
let token: string;
let other: string;
let leaderOnly: string;

const REASON = "Trying the seat window";
const SLOT = "weeknight-evening";
const inWindow = (open: boolean) => c.db.admin.query(`create or replace function public.seat_in_window() returns boolean language sql stable set search_path = '' as $$ select ${open} $$`);
const realWindow = () =>
  c.db.admin.query(`create or replace function public.seat_in_window() returns boolean language sql stable set search_path = '' as $$ select public.seat_open_at(now()) = now() $$`);
// The moments the clock is built from are moved to the next 9 am in Lagos. These tests must not depend on the hour they happen to run in, so the move is switched off
// for all of them except the one that tests it (which puts the real function back).
const noMove = () => c.db.admin.query("create or replace function public.seat_open_at(p_at timestamptz) returns timestamptz language sql stable set search_path = '' as $$ select p_at $$");
const realMove = () =>
  c.db.admin.query(`create or replace function public.seat_open_at(p_at timestamptz) returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  l timestamp := p_at at time zone 'Africa/Lagos';
begin
  if l::time >= time '09:00' and l::time < time '19:00' then
    return p_at;
  elsif l::time < time '09:00' then
    return (l::date + time '09:00') at time zone 'Africa/Lagos';
  end if;
  return ((l::date + 1) + time '09:00') at time zone 'Africa/Lagos';
end;
$$`);
const tick = async () => (await c.one("select public.seat_clock_tick() as r")).r as { ran: boolean; enrolled?: number; steps?: Record<string, number> };
const beat = () => c.sql("update public.seat_window_settings set last_tick_at = now()");
const on = async () => {
  await beat();
  await c.set("seat_window", "on", { reason: REASON });
};
const rehearse = () => c.set("seat_window", "rehearsal", { reason: REASON });
async function replica(sql: string, params: unknown[] = []) {
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
const fresh = (name: string, over: { capacity?: number } = {}) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity: over.capacity ?? 12, slot: SLOT });
/** A member the church placed in a tribe who has not answered. Their "Your tribe" email went `sentHoursAgo` hours ago (not yet when null). */
async function placed(name: string, tribe: string, over: { sentHoursAgo?: number | null; withProfile?: boolean } = {}) {
  const id = (await c.k.seat(tribe, c.season, `${name}${++n}`, over.withProfile ? {} : { profile: false })).id;
  await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where person_id = $1", [id]);
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
const clockOf = async (tm: string) => (await c.sql("select * from public.seat_clocks where tm_id = $1 order by created_at desc, id limit 1", [tm]))[0];
const logOf = async (clock: string) => (await c.sql("select kind from public.seat_clock_log where clock_id = $1 order by id", [clock])).map((r) => r.kind as string);
const seatOf = async (tm: string) => (await c.one("select status, confirmed_at, release_reason from public.tribe_members where id = $1", [tm])) as { status: string; confirmed_at: Date | null; release_reason: string | null };
const mailOf = (person: string, template: string) => c.sql("select * from public.messages where person_id = $1 and template = $2 order by created_at", [person, template]);
/** Pretends an email of ours has gone. */
const sentAll = () => c.sql("update public.messages set status = 'sent', sent_at = coalesce(sent_at, now()) where template in ('seat_reminder', 'seat_last_call', 'seat_released') and status in ('queued', 'sending')");
/** Moves a clock's times so that the next beat finds it at the point being tried. */
const setClock = (id: string, hoursIn: number, over: Record<string, unknown> = {}) =>
  c.sql(
    `update public.seat_clocks set started_at = now() - make_interval(hours => $2), remind_at = now() - make_interval(hours => $2 - 24), last_call_at = now() - make_interval(hours => $2 - 40),
            deadline_at = now() - make_interval(hours => $2 - 48) where id = $1`,
    [id, hoursIn],
  ).then(async () => {
    for (const [k, v] of Object.entries(over)) await c.sql(`update public.seat_clocks set ${k} = $2 where id = $1`, [id, v]);
  });
/** One seat with a running clock, on, in the window, ready for the point being tried. */
async function running(name: string, hoursIn: number, over: { tribe?: { tribe: string }; withProfile?: boolean } = {}) {
  const t = over.tribe ?? (await fresh(name));
  const p = await placed(name, t.tribe, { sentHoursAgo: 30, withProfile: over.withProfile });
  await c.sql("update public.seat_window_settings set swept_at = null");
  await tick();
  const clock = await clockOf(p.tm);
  expect(clock, "the seat should have been put on the clock").toBeTruthy();
  await setClock(clock.id, hoursIn);
  return { ...p, clock: clock.id as string, leader: (t as { leader?: { id: string } }).leader?.id as string };
}
/** A member who fits the tribe well enough to be offered a seat, and no other. */
const candidate = (name: string) => readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 20, times: [SLOT] });
/** No phone number in a piece of json: ids and times are taken out first, because a long run of digits in one of them is not a number. */
const noNumber = (v: unknown) =>
  JSON.stringify(v)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?/g, "")
    .replace(/[0-9a-f]{64}/g, "");
const link = async (tm: string, person: string) => (await c.sql("select public.placement_token_mint($1, $2, 14) as t", [tm, person]))[0].t as string;

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  token = (await c.one("select public.bootstrap_worker_token('seat-window-test') as t")).t as string;
  await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  other = await c.k.season("Elsewhere", -400);
  leaderOnly = (await c.k.staff("Plain staff", "leader")).id;
}, 240_000);

afterAll(async () => {
  await realWindow();
  await realMove();
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await inWindow(true);
  await noMove();
  await c.sql("delete from public.seat_clock_log");
  await c.sql("delete from public.seat_clocks");
  await c.sql("delete from public.seat_chain");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.placed_holds");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.email_signals");
  await c.sql("delete from public.care_flags");
  await c.sql("update public.seat_window_settings set window_hours = 48, remind_hours = 24, last_call_hours = 40, take_back_days = 7, offers_in_row = 3, day_cap = 30, bar = 70, counted_from = now() - interval '30 days', paused = false, paused_reason = null, last_tick_at = null, swept_at = null");
  // members left over from an earlier test must not be offered a seat in this one
  await c.sql("update public.member_profiles set season_id = $1 where season_id = $2 and person_id not in (select person_id from public.tribe_members where status = 'active')", [other, c.season]);
});

describe("it ships Off", () => {
  it("is on the Switchboard, starts Off, offers Off, Rehearsal and On, and keeps the numbers the blueprint gives", async () => {
    const a = await c.one("select * from public.feature_registry where key = 'seat_window'");
    expect(a).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 33 });
    expect(a.modes).toEqual(["off", "rehearsal", "on"]);
    expect(await c.one("select * from public.seat_window_settings")).toMatchObject({ window_hours: 48, remind_hours: 24, last_call_hours: 40, take_back_days: 7, offers_in_row: 3, day_cap: 30, bar: 70 });
  });

  it("does nothing while Off: no clock, no email, and the beat only says it was not needed", async () => {
    const t = await fresh("Quiet");
    await placed("Quiet", t.tribe);
    expect(await tick()).toEqual({ ran: false });
    expect(await c.sql("select 1 from public.seat_clocks")).toHaveLength(0);
    expect((await c.sql("select 1 from public.messages where template like 'seat_%'")).length).toBe(0);
    expect(await c.one("select public.seat_window_any() as m")).toMatchObject({ m: "off" });
  });

  it("cannot be put On while the heartbeat is late or placement is not On, and says which; Rehearsal and Off are never refused", async () => {
    await expectCode(c.set("seat_window", "on", { reason: REASON }), "22023"); // no beat has ever been recorded
    await beat();
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "rehearsal", min_tribe: 4 }));
    await expectCode(c.set("seat_window", "on", { reason: REASON }), "22023");
    await rehearse();
    await c.set("seat_window", "off", { reason: REASON });
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    await c.set("seat_window", "on", { reason: REASON });
    expect((await c.one("select public.seat_window_any() as m")).m).toBe("on");
  });
});

describe("who is put on the clock", () => {
  it("every seat the church placed whose first email went, once, from the day it was sent; Rehearsal's clocks are marked", async () => {
    await on();
    const t = await fresh("Enrol");
    const a = await placed("Ada", t.tribe, { sentHoursAgo: 30 });
    const early = await placed("Early", t.tribe, { sentHoursAgo: 40 * 24 }); // before the day the owner counts from
    const notYet = await placed("NotYet", t.tribe, { sentHoursAgo: null });
    const selfPlaced = await placed("Chose", t.tribe);
    await replica("update public.tribe_members set placement_source = 'self' where id = $1", [selfPlaced.tm]);
    const said = await placed("Said", t.tribe);
    await replica("update public.tribe_members set confirmed_at = now() where id = $1", [said.tm]);
    const r = await tick();
    expect(r).toMatchObject({ ran: true, enrolled: 1 });
    const clock = await clockOf(a.tm);
    expect(clock).toMatchObject({ state: "running", rehearsal: false, person_id: a.id, tribe_id: t.tribe, extended: false, chain: 1 });
    // the clock counts from the day the email went, not from the day the beat found it
    expect(Math.abs((clock.started_at as Date).getTime() - Date.now() + 30 * 3600 * 1000)).toBeLessThan(60_000);
    for (const p of [early, notYet, selfPlaced, said]) expect(await clockOf(p.tm)).toBeUndefined();
    // once only
    expect(await tick()).toMatchObject({ enrolled: 0 });
    expect(await c.sql("select 1 from public.seat_clocks")).toHaveLength(1);
    // the reminder is already due for a seat whose email went 30 hours ago, and goes at the first beat after it was put on the clock
    expect(await logOf(clock.id)).toEqual(["start", "remind"]);
  });

  it("the deadline is 48 hours after the email, moved to 9 am when it would fall at night, and the reminder and last call likewise", async () => {
    await realMove();
    const at = async (iso: string) => (await c.one("select public.seat_open_at($1::timestamptz) as t", [iso])).t as Date;
    expect((await at("2026-11-10T10:00:00+01:00")).toISOString()).toBe("2026-11-10T09:00:00.000Z"); // inside the window: unchanged
    expect((await at("2026-11-10T20:30:00+01:00")).toISOString()).toBe("2026-11-11T08:00:00.000Z"); // 9 am the next morning, Lagos
    expect((await at("2026-11-10T05:00:00+01:00")).toISOString()).toBe("2026-11-10T08:00:00.000Z"); // 9 am the same morning
    expect((await at("2026-11-10T19:00:00+01:00")).toISOString()).toBe("2026-11-11T08:00:00.000Z"); // 7 pm is outside
    expect((await at("2026-11-10T18:59:00+01:00")).toISOString()).toBe("2026-11-10T17:59:00.000Z");
    await on();
    const t = await fresh("Night");
    const p = await placed("Night", t.tribe, { sentHoursAgo: 30 });
    await tick();
    const k = await clockOf(p.tm);
    for (const col of ["deadline_at", "remind_at", "last_call_at"]) {
      const lagos = (await c.one("select (($1::timestamptz) at time zone 'Africa/Lagos')::time as t", [k[col]])).t as string;
      expect(lagos >= "09:00:00" && lagos < "19:00:00", `${col} ${lagos}`).toBe(true);
    }
    expect((k.deadline_at as Date).getTime()).toBeGreaterThanOrEqual((k.started_at as Date).getTime() + 48 * 3600 * 1000);
  });

  it("a seat timed by the clock is left alone by the answer sequence and the day-5 reminder, and one the clock has not timed is not", async () => {
    await on();
    const t = await fresh("Seq");
    const p = await placed("Seq", t.tribe);
    await c.sql("insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for) values ($1, 'placement_reminder', '{}', 'queued', $2, now() + interval '1 day')", [p.id, `placement-reminder:${p.tm}`]);
    expect((await c.one("select public.placed_seq_block($1, $2) as b", [p.id, p.tm])).b).toBeNull();
    await tick();
    expect((await c.one("select public.placed_seq_block($1, $2) as b", [p.id, p.tm])).b).toBe("seat_clock");
    expect((await c.one("select status, error from public.messages where dedupe_key = $1", [`placement-reminder:${p.tm}`]))).toMatchObject({ status: "skipped", error: "seat_window" });
  });
});

const makeTeen = (id: string) => replica("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [id]);
/** Brings a running clock to its deadline with both emails sent long enough ago. */
async function dueNow(s: { clock: string }) {
  await setClock(s.clock, 49);
  await c.sql("update public.seat_clocks set remind_sent_at = now() - interval '24 hours', last_call_sent_at = now() - interval '8 hours' where id = $1", [s.clock]);
  // an email still waiting to go holds the release back, so the ones the clock queued while it was being set up have gone
  await sentAll();
}
/** The seat the member lost, from the private link in the email they were sent. */
const releasedLink = async (person: string) => (await mailOf(person, "seat_released"))[0]?.reply_token as string;

describe("the reminder, the last call and the release", () => {
  it("sends the reminder once at hour 24 and the last call once at hour 40, each with its own private link, and waits for 9 am to 7 pm", async () => {
    await on();
    await inWindow(false);
    const s = await running("Mail", 26);
    expect((await tick()).steps).toMatchObject({ waiting: 1 });
    expect(await mailOf(s.id, "seat_reminder")).toHaveLength(0);
    await inWindow(true);
    expect((await tick()).steps).toMatchObject({ remind: 1 });
    await tick();
    const rem = await mailOf(s.id, "seat_reminder");
    expect(rem).toHaveLength(1);
    expect(rem[0]).toMatchObject({ force_channel: "email", status: "queued", dedupe_key: expect.stringMatching(/^seat-remind:/) });
    expect(rem[0].reply_token).toMatch(/^[a-f0-9]{64}$/);
    expect(noNumber(rem[0].params)).not.toMatch(/\+?\d{9,}/); // no phone number anywhere in what is sent
    // the last call is not due yet
    expect(await mailOf(s.id, "seat_last_call")).toHaveLength(0);
    await setClock(s.clock, 41);
    await tick();
    await tick();
    expect(await mailOf(s.id, "seat_last_call")).toHaveLength(1);
    expect(await logOf(s.clock)).toEqual(["start", "remind", "last_call"]);
    expect((await clockOf(s.tm)).state).toBe("running");
    expect((await seatOf(s.tm)).status).toBe("active");
  });

  it("does not release before the deadline, nor less than 6 hours after the last call, and then lets the seat go kindly", async () => {
    await on();
    const s = await running("Late", 30);
    await setClock(s.clock, 47);
    await c.sql("update public.seat_clocks set remind_sent_at = now() - interval '22 hours', last_call_sent_at = now() - interval '6 hours' where id = $1", [s.clock]);
    await tick();
    expect((await seatOf(s.tm)).status).toBe("active");
    // the deadline has passed but the last call went only an hour ago
    await setClock(s.clock, 49);
    await c.sql("update public.seat_clocks set last_call_sent_at = now() - interval '1 hour' where id = $1", [s.clock]);
    expect((await tick()).steps).toMatchObject({ waiting: 1 });
    expect((await seatOf(s.tm)).status).toBe("active");
    // and now it is both
    await c.sql("update public.seat_clocks set last_call_sent_at = now() - interval '7 hours' where id = $1", [s.clock]);
    await sentAll();
    expect((await tick()).steps).toMatchObject({ released: 1 });
    expect(await seatOf(s.tm)).toMatchObject({ status: "released", release_reason: "No reply in time" });
    const k = await clockOf(s.tm);
    expect(k).toMatchObject({ state: "released", outcome: "no_reply" });
    expect(Math.abs((k.retake_until as Date).getTime() - Date.now() - 7 * 86400 * 1000)).toBeLessThan(60_000);
    const mail = await mailOf(s.id, "seat_released");
    expect(mail).toHaveLength(1);
    expect(mail[0].reply_token).toMatch(/^[a-f0-9]{64}$/);
    expect(await logOf(s.clock)).toEqual(["start", "remind", "release", "no_bench"]);
    const ledger = await c.sql("select kind, reason, via from public.seat_ledger where tm_id = $1 order by id", [s.tm]);
    expect(ledger[0]).toMatchObject({ kind: "taken" });
    expect(ledger[ledger.length - 1]).toEqual({ kind: "released", reason: "No reply in time", via: "seat-window" });
    expect((await c.sql("select 1 from public.event_log where action = 'seat_window.release'")).length).toBe(1);
    // nothing more happens to a seat that has gone
    expect((await tick()).steps ?? {}).toEqual({});
    expect(await mailOf(s.id, "seat_released")).toHaveLength(1);
  });

  it("gives a seat that could not be reached no release, shows it as Not reached, and a late site gets a fresh 12 hours once", async () => {
    await on();
    const a = await running("Failed", 30);
    await c.sql("update public.messages set status = 'failed' where dedupe_key = $1", [`placement:${a.tm}`]);
    await dueNow(a);
    expect((await tick()).steps).toMatchObject({ not_reached: 1 });
    expect((await seatOf(a.tm)).status).toBe("active");
    expect((await clockOf(a.tm)).blocked_by).toBe("not_reached");
    // a seat whose first email never went at all, which no clock was ever started for, is on the board as Not reached too
    const t = await fresh("NeverSent");
    const none = await placed("NeverSent", t.tribe, { sentHoursAgo: 30 });
    await c.sql("update public.messages set status = 'failed' where dedupe_key = $1", [`placement:${none.tm}`]);
    const board = await c.as(c.admin, "seat_board", null, 50, 0);
    expect(board.tiles.not_reached).toBe(2);
    // the late site: the deadline is more than 2 hours overdue, so the member gets 12 hours and a new last call, once
    const b = await running("Late site", 30);
    await dueNow(b);
    await c.sql("update public.seat_clocks set deadline_at = now() - interval '5 hours', last_call_sent_at = now() - interval '9 hours' where id = $1", [b.clock]);
    expect((await tick()).steps).toMatchObject({ fresh_hours: 1 });
    const k = await clockOf(b.tm);
    expect(k).toMatchObject({ fresh_given: true, last_call_sent_at: null });
    expect((k.deadline_at as Date).getTime()).toBeGreaterThan(Date.now() + 11 * 3600 * 1000);
    expect((await seatOf(b.tm)).status).toBe("active");
    expect(await logOf(b.clock)).toContain("fresh_hours");
    // the new last call goes under a key of its own
    await tick();
    expect(await mailOf(b.id, "seat_last_call")).toHaveLength(1);
    expect((await c.one("select dedupe_key from public.messages where person_id = $1 and template = 'seat_last_call'", [b.id])).dedupe_key).toMatch(/:f$/);
    // and the second time there is no more
    await setClock(b.clock, 49);
    await c.sql("update public.seat_clocks set remind_sent_at = now() - interval '30 hours', last_call_sent_at = now() - interval '9 hours', deadline_at = now() - interval '5 hours' where id = $1", [b.clock]);
    await sentAll();
    await tick();
    expect((await seatOf(b.tm)).status).toBe("released");
  });

  it("keeps Rehearsal to the log: a clock is kept, what it would do is written down, and no email goes and no seat moves", async () => {
    await rehearse();
    const t = await fresh("Rehearsal");
    const p = await placed("Rehearsal", t.tribe, { sentHoursAgo: 30 });
    await candidate("Bench");
    await tick();
    const k = await clockOf(p.tm);
    expect(k).toMatchObject({ rehearsal: true, state: "running" });
    await setClock(k.id, 26);
    await tick();
    await setClock(k.id, 41);
    await tick();
    await c.sql("update public.seat_clocks set remind_sent_at = now() - interval '24 hours', last_call_sent_at = now() - interval '8 hours' where id = $1", [k.id]);
    await setClock(k.id, 49);
    await c.sql("update public.seat_clocks set last_call_sent_at = now() - interval '8 hours' where id = $1", [k.id]);
    await tick();
    expect(await logOf(k.id)).toEqual(["start", "would_remind", "would_last_call", "would_release", expect.stringMatching(/^(would_replace|no_bench)$/)]);
    expect((await seatOf(p.tm)).status).toBe("active");
    expect((await c.sql("select 1 from public.messages where template like 'seat_%'")).length).toBe(0);
    expect((await clockOf(p.tm)).state).toBe("ended");
    // the board shows the practice clocks, not real ones
    const board = await c.as(c.admin, "seat_board", null, 50, 0);
    expect(board.rehearsal).toBe(true);
    // and moving to On puts the seat on a real clock, with nothing carried over from the practice one
    await on();
    await c.sql("update public.seat_window_settings set swept_at = null");
    await tick();
    const real = (await c.sql("select * from public.seat_clocks where tm_id = $1 and not rehearsal", [p.tm]))[0];
    expect(real).toMatchObject({ state: "running", rehearsal: false });
  });
});

describe("the bench and the chain", () => {
  it("offers the released seat at once to the best fit at the bar or above, never to the one who lost it, and the new seat takes a clock of its own after its email", async () => {
    await on();
    const s = await running("Lose", 30, { withProfile: true });
    const best = await candidate("Best");
    const chk = await c.as(c.admin, "placement_one_check", best.id, (await c.one("select tribe_id from public.seat_clocks where id = $1", [s.clock])).tribe_id);
    expect(chk.degree, JSON.stringify(chk)).toBeGreaterThanOrEqual(70);
    await dueNow(s);
    expect((await tick()).steps).toMatchObject({ released: 1 });
    const k = await clockOf(s.tm);
    const taken = await c.one("select * from public.tribe_members where id = $1", [k.replaced_by]);
    expect(taken).toMatchObject({ person_id: best.id, status: "active", placement_source: "auto" });
    expect(await logOf(s.clock)).toEqual(["start", "remind", "release", "replace"]);
    expect((await mailOf(best.id, "placement_your_tribe")).length).toBe(1);
    expect((await c.one("select chain from public.seat_chain where tm_id = $1", [taken.id])).chain).toBe(2);
    expect((await c.sql("select 1 from public.tribe_members where person_id = $1 and status = 'active'", [s.id])).length).toBe(0);
    // the new member's first email goes out, the beat finds the seat, and its clock carries the chain on
    await c.sql("update public.messages set status = 'sent', sent_at = now() where template = 'placement_your_tribe' and person_id = $1", [best.id]);
    await c.sql("update public.seat_window_settings set swept_at = null");
    await tick();
    expect(await clockOf(taken.id)).toMatchObject({ state: "running", chain: 2, person_id: best.id });
    // the ledger has the line for both
    expect((await c.sql("select kind from public.seat_ledger where tribe_id = $1 and person_id in ($2, $3) order by id", [k.tribe_id, s.id, best.id])).map((r) => r.kind)).toEqual(
      expect.arrayContaining(["released", "taken"]),
    );
  });

  it("does not offer a seat to someone below the bar, or already seated, or on a clock of their own, and says so in the log", async () => {
    await on();
    await c.sql("update public.seat_window_settings set bar = 95");
    const s = await running("Picky", 30, { withProfile: true });
    await candidate("NotQuite");
    await dueNow(s);
    await tick();
    expect(await logOf(s.clock)).toEqual(["start", "remind", "release", "no_bench"]);
    expect((await c.one("select count(*)::int n from public.tribe_members where tribe_id = (select tribe_id from public.seat_clocks where id = $1) and status = 'active'", [s.clock])).n).toBe(0);
  });

  it("stops offering the same place after three seats in a row and calls it Hard to fill, which the board shows", async () => {
    await on();
    const s = await running("Hard", 30);
    await candidate("Waits");
    await c.sql("update public.seat_clocks set chain = 3 where id = $1", [s.clock]);
    await dueNow(s);
    await tick();
    expect(await logOf(s.clock)).toEqual(["start", "remind", "release", "hard_to_fill"]);
    expect(await clockOf(s.tm)).toMatchObject({ hard_to_fill: true, replaced_by: null });
    const board = await c.as(c.admin, "seat_board", "hard", 50, 0);
    expect(board.tiles.hard).toBe(1);
    expect(board.rows).toHaveLength(1);
  });

  it("does not release when a tribe is no longer approved: the seat is let go but nobody is offered it", async () => {
    await on();
    const s = await running("Closed", 30);
    await c.sql("update public.tribes set status = 'closed' where id = (select tribe_id from public.seat_clocks where id = $1)", [s.clock]);
    await dueNow(s);
    await tick();
    expect(await logOf(s.clock)).toEqual(["start", "remind", "release", "no_bench"]);
  });
});

describe("who is never released", () => {
  const cases: [string, string, (p: { id: string; tm: string }) => Promise<unknown>][] = [
    ["under18", "under18", (p) => makeTeen(p.id)],
    ["deletion", "deletion", (p) => c.sql("insert into public.erasure_requests (person_id, centre_id, status) select id, centre_id, 'open' from public.people where id = $1", [p.id])],
    ["announcements_off", "announcements_off", (p) => c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'announcements', false, 'v1')", [p.id])],
    ["bounced", "bounced", (p) => c.sql("insert into public.email_signals (person_id, kind) select $1, 'hard_bounce' from generate_series(1, 2)", [p.id])],
    ["care", "care", async (p) => c.sql("insert into public.care_flags (tribe_id, person_id, kind, status) select tribe_id, person_id, 'leader_concern', 'open' from public.tribe_members where id = $1", [p.tm])],
    ["stopped", "stopped", (p) => c.sql("insert into public.placed_answers (tm_id, person_id, kind) values ($1, $2, 'stop_reminders')", [p.tm, p.id])],
    ["held", "held", (p) => c.sql("insert into public.placed_holds (tm_id, held_until, reason) values ($1, now() + interval '3 days', 'The office is speaking to them')", [p.tm])],
    ["call_pending", "call_pending", (p) => c.sql("insert into public.placed_answers (tm_id, person_id, kind) values ($1, $2, 'call_me')", [p.tm, p.id])],
  ];
  for (const [label, why, make] of cases) {
    it(`never releases someone ${label.replace("_", " ")}: the seat is left as it is, the reason is written down, and it is released once it clears`, async () => {
      await on();
      const s = await running(`Never ${label}`, 30, { withProfile: true });
      await dueNow(s);
      await make(s);
      expect((await tick()).steps).toMatchObject({ blocked: 1 });
      expect((await seatOf(s.tm)).status).toBe("active");
      expect((await clockOf(s.tm)).blocked_by).toBe(why);
      expect(await logOf(s.clock)).toContain("blocked");
      // nothing is written to them either
      expect((await c.sql("select 1 from public.messages where person_id = $1 and template = 'seat_released'", [s.id])).length).toBe(0);
      // the office cannot release it by hand either
      await expectCode(c.as(c.admin, "seat_release_now", s.clock, "Trying to release them"), "22023");
      await tick();
      expect((await seatOf(s.tm)).status).toBe("active");
    });
  }

  it("a hold that ends, or a care follow-up that closes, lets the clock go on", async () => {
    await on();
    const s = await running("Clears", 30, { withProfile: true });
    await dueNow(s);
    await c.sql("insert into public.placed_holds (tm_id, held_until, reason) values ($1, now() + interval '3 days', 'The office is speaking to them')", [s.tm]);
    await tick();
    expect((await seatOf(s.tm)).status).toBe("active");
    await c.sql("update public.placed_holds set held_until = now() - interval '1 minute' where tm_id = $1", [s.tm]);
    await tick();
    expect((await clockOf(s.tm)).blocked_by).toBeNull();
    expect((await seatOf(s.tm)).status).toBe("released");
  });

  it("a member who says yes ends the clock: the seat is theirs and never released", async () => {
    await on();
    const s = await running("Says yes", 30);
    await dueNow(s);
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [s.tm]);
    expect(await clockOf(s.tm)).toMatchObject({ state: "answered", outcome: "yes" });
    await tick();
    expect((await seatOf(s.tm)).status).toBe("active");
    expect((await c.sql("select kind from public.seat_ledger where tm_id = $1 order by id", [s.tm])).map((r) => r.kind)).toContain("confirmed");
  });

  it("a member who leaves ends it too", async () => {
    await on();
    const s = await running("Leaves", 30);
    await c.sql("update public.tribe_members set status = 'released', release_reason = 'Not this season' where id = $1", [s.tm]);
    expect(await clockOf(s.tm)).toMatchObject({ state: "ended", outcome: "left" });
    expect((await c.sql("select kind, reason from public.seat_ledger where tm_id = $1 order by id desc limit 1", [s.tm]))[0]).toMatchObject({ kind: "left", reason: "Not this season" });
  });
});

describe("the breakers and the pause", () => {
  it("holds every release when more than a quarter of a tribe's seats have gone in a day, and tells the office once", async () => {
    await on();
    await c.noticesOn();
    const t = await fresh("Quarter");
    const seats = [];
    for (let i = 0; i < 5; i++) seats.push(await running(`Quarter${i}`, 30, { tribe: t }));
    for (const s of seats) await dueNow(s);
    const r = await tick();
    // 12 seats: three go (a quarter), the others are held
    expect(r.steps).toMatchObject({ released: 3, breaker: 2 });
    expect((await c.one("select count(*)::int n from public.seat_clocks where blocked_by = 'tribe_quarter'")).n).toBe(2);
    expect((await c.sql("select 1 from public.messages where template = 'admin_seat_stopped'")).length).toBeGreaterThan(0);
    const before = (await c.one("select count(*)::int n from public.messages where template = 'admin_seat_stopped'")).n;
    await tick();
    expect((await c.one("select count(*)::int n from public.messages where template = 'admin_seat_stopped'")).n).toBe(before);
  });

  it("holds every release after the day's limit, and when more than a quarter of the last 20 emails failed", async () => {
    await on();
    await c.sql("update public.seat_window_settings set day_cap = 5");
    const seats = [];
    for (let i = 0; i < 7; i++) seats.push(await running(`Cap${i}`, 30));
    for (const s of seats) await dueNow(s);
    const r = await tick();
    expect(r.steps).toMatchObject({ released: 5, breaker: 2 });
    expect((await c.one("select count(*)::int n from public.seat_clocks where blocked_by = 'day_cap'")).n).toBe(2);
    // an extra step raises the limit and the held seats go
    await c.sql("update public.seat_window_settings set day_cap = 30");
    await tick();
    expect((await c.one("select count(*)::int n from public.seat_clocks where state = 'released'")).n).toBe(7);
    // email: eight finished emails of which three failed is more than a quarter
    await c.sql("delete from public.seat_clock_log");
    await c.sql("delete from public.seat_clocks");
    await c.sql("delete from public.messages");
    const p = await running("Mail breaker", 30);
    await dueNow(p);
    const t = await fresh("Mail breaker mates");
    for (let i = 0; i < 8; i++) {
      const q = await placed(`Mate${i}`, t.tribe, { sentHoursAgo: 3 });
      await c.sql("update public.messages set status = $2 where dedupe_key = $1", [`placement:${q.tm}`, i < 3 ? "failed" : "sent"]);
    }
    expect((await c.one("select public.seat_email_breaker() as b")).b).toBe(true);
    expect((await tick()).steps).toMatchObject({ breaker: 1 });
    expect((await clockOf(p.tm)).blocked_by).toBe("email");
    expect((await seatOf(p.tm)).status).toBe("active");
  });

  it("is stopped by the Master pause and the office's pause, and each clock keeps the time it had left", async () => {
    await on();
    const s = await running("Paused", 30);
    const before = await clockOf(s.tm);
    await c.o.call("god_feature_master", true, REASON);
    expect((await tick()).steps).toMatchObject({ frozen: 1 });
    expect((await clockOf(s.tm)).frozen_at).not.toBeNull();
    await c.sql("update public.seat_clocks set frozen_at = now() - interval '5 hours' where id = $1", [s.clock]);
    await c.o.call("god_feature_master", false, null);
    await tick();
    const after = await clockOf(s.tm);
    expect(after.frozen_at).toBeNull();
    // every time the clock keeps moved on by what was lost, and none of them lands at night
    expect((after.deadline_at as Date).getTime()).toBeGreaterThanOrEqual((before.deadline_at as Date).getTime() + 5 * 3600 * 1000 - 60_000);
    // the office's own pause does the same, needs a reason, and is for the people who may act
    await expectCode(c.as(c.admin, "seat_pause_set", true, null), "22023");
    await expectCode(c.as(c.member, "seat_pause_set", true, "Because I said so"), "42501");
    await c.as(c.admin, "seat_pause_set", true, "Looking at the emails first");
    expect((await tick()).steps).toMatchObject({ frozen: 1 });
    await c.as(c.admin, "seat_pause_set", false, null);
    await tick();
    expect((await clockOf(s.tm)).frozen_at).toBeNull();
  });

  it("goes quiet when it is switched Off while clocks are running: they stop and keep their time", async () => {
    await on();
    const s = await running("Off", 30);
    await c.set("seat_window", "off", { reason: REASON });
    expect((await tick()).steps).toMatchObject({ frozen: 1 });
    expect((await clockOf(s.tm)).state).toBe("running");
  });
});

describe("taking the seat back", () => {
  async function lost(name: string) {
    await on();
    const s = await running(name, 30, { withProfile: true });
    await dueNow(s);
    await tick();
    expect((await seatOf(s.tm)).status).toBe("released");
    return { ...s, link: await releasedLink(s.id) };
  }

  it("the member's private page says whether the seat is free, and taking it back gives it to them on a clock of their own, once", async () => {
    const s = await lost("Back");
    expect(s.link).toMatch(/^[a-f0-9]{64}$/);
    expect(await c.anon("worker_seat_info", token, s.link)).toMatchObject({ found: true, state: "free" });
    expect(await c.anon("worker_seat_info", token, "x".repeat(64))).toEqual({ found: false });
    const r = await c.anon("worker_seat_take_back", token, s.link);
    expect(r).toMatchObject({ ok: true });
    expect(r.link).toMatch(/^[a-f0-9]{64}$/);
    expect(await seatOf(s.tm)).toMatchObject({ status: "active", release_reason: null });
    const clocks = await c.sql("select state, outcome from public.seat_clocks where tm_id = $1 order by created_at", [s.tm]);
    expect(clocks).toEqual([expect.objectContaining({ state: "released", outcome: "taken_back" }), expect.objectContaining({ state: "running" })]);
    expect((await c.sql("select reason from public.seat_ledger where tm_id = $1 and kind = 'taken' order by id desc limit 1", [s.tm]))[0].reason).toBe("Taken back");
    expect(await c.anon("worker_seat_info", token, s.link)).toMatchObject({ found: true, state: "back" });
    expect(await c.anon("worker_seat_take_back", token, s.link)).toMatchObject({ ok: false });
  });

  it("when the seat has gone to someone else, the member is told so and goes to the front of the line", async () => {
    const s = await lost("Gone");
    const tribeId = (await clockOf(s.tm)).tribe_id as string;
    await c.sql("update public.tribe_members set status = 'released' where tribe_id = $1 and person_id <> $2 and status = 'active'", [tribeId, s.id]);
    await c.sql(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       select $1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14`,
      [(await fresh("Elsewhere tribe")).tribe, s.id, c.season],
    );
    expect(await c.anon("worker_seat_info", token, s.link)).toMatchObject({ found: true, state: "gone" });
    expect(await c.anon("worker_seat_take_back", token, s.link)).toMatchObject({ ok: false, reason: "gone" });
    expect((await clockOf(s.tm)).front_of_line).toBe(true);
  });

  it("after the days given have gone, the way back is closed", async () => {
    const s = await lost("Closed");
    await c.sql("update public.seat_clocks set retake_until = now() - interval '1 minute' where id = $1", [s.clock]);
    expect(await c.anon("worker_seat_info", token, s.link)).toMatchObject({ found: true, state: "closed" });
    expect(await c.anon("worker_seat_take_back", token, s.link)).toMatchObject({ ok: false, reason: "closed" });
  });

  it("the link is for the right seat only, and only the worker with the right token can use it", async () => {
    const a = await lost("Mine");
    await expectCode(c.anon("worker_seat_info", "not-a-token", a.link), "42501");
    await expectCode(c.anon("worker_seat_take_back", "not-a-token", a.link), "42501");
    expect(await c.anon("worker_seat_take_back", token, "0".repeat(64))).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("the office", () => {
  it("keeps a seat out of the clock with a reason, and the clock never releases it", async () => {
    await on();
    const s = await running("Kept", 30);
    await dueNow(s);
    await expectCode(c.as(c.admin, "seat_keep", s.clock, "no"), "22023");
    expect(await c.as(c.admin, "seat_keep", s.clock, "Speaking to the family this week")).toEqual({ ok: true });
    await tick();
    expect((await seatOf(s.tm)).status).toBe("active");
    expect(await clockOf(s.tm)).toMatchObject({ state: "kept", kept_reason: "Speaking to the family this week", kept_by: c.admin });
    expect((await c.as(c.admin, "seat_board", "kept", 50, 0)).tiles.kept).toBe(1);
    await expectCode(c.as(c.admin, "seat_keep", s.clock, "Again and again please"), "22023");
  });

  it("gives 48 hours more once, with a new last call, and refuses a second time", async () => {
    await on();
    const s = await running("More time", 44);
    await c.sql("update public.seat_clocks set remind_sent_at = now() - interval '20 hours', last_call_sent_at = now() - interval '3 hours' where id = $1", [s.clock]);
    const before = await clockOf(s.tm);
    const r = await c.as(c.director, "seat_extend", s.clock);
    expect(r).toMatchObject({ ok: true });
    const after = await clockOf(s.tm);
    expect(after).toMatchObject({ extended: true, extended_by: "office", last_call_sent_at: null });
    expect((after.deadline_at as Date).getTime()).toBeGreaterThanOrEqual((before.deadline_at as Date).getTime() + 47 * 3600 * 1000);
    await expectCode(c.as(c.director, "seat_extend", s.clock), "22023");
    // the last call goes again, under a key of its own
    await c.sql("update public.seat_clocks set last_call_at = now() - interval '1 minute' where id = $1", [s.clock]);
    await tick();
    expect((await c.one("select dedupe_key from public.messages where person_id = $1 and template = 'seat_last_call'", [s.id])).dedupe_key).toMatch(/:x$/);
  });

  it("releases a seat now, for a reason, only while it is On, and gives it back while the seat is free", async () => {
    const s0 = await (async () => {
      await on();
      return running("Now", 10, { withProfile: true });
    })();
    await c.set("seat_window", "rehearsal", { reason: REASON });
    await expectCode(c.as(c.admin, "seat_release_now", s0.clock, "They told us they cannot come"), "22023");
    await on();
    await expectCode(c.as(c.admin, "seat_release_now", s0.clock, "no"), "22023");
    expect(await c.as(c.admin, "seat_release_now", s0.clock, "They told us they cannot come")).toEqual({ ok: true });
    expect(await seatOf(s0.tm)).toMatchObject({ status: "released" });
    expect(await clockOf(s0.tm)).toMatchObject({ state: "released", outcome: "by_office" });
    expect((await c.sql("select by_person from public.seat_clock_log where clock_id = $1 and kind = 'release'", [s0.clock]))[0].by_person).toBe(c.admin);
    await expectCode(c.as(c.admin, "seat_keep", s0.clock, "It was a mistake to release"), "22023");
    expect(await c.as(c.admin, "seat_give_back", s0.clock)).toEqual({ ok: true });
    expect(await seatOf(s0.tm)).toMatchObject({ status: "active" });
    await expectCode(c.as(c.admin, "seat_give_back", s0.clock), "22023");
  });

  it("is for the office only: a pastor, an admin, a director and the owner act; a data lead looks; a leader, a member and nobody else can do neither", async () => {
    await on();
    const s = await running("Roles", 10);
    const data = (await c.k.staff("Data lead", "data_lead")).id;
    for (const who of [c.admin, c.director, c.pastor]) expect((await c.as(who, "seat_board", null, 50, 0)).role).toBe("act");
    expect((await c.as(data, "seat_board", null, 50, 0)).role).toBe("look");
    await expectCode(c.as(data, "seat_keep", s.clock, "Looking, not touching"), "42501");
    await expectCode(c.as(data, "seat_pause_set", true, "Looking, not touching"), "42501");
    for (const who of [c.member, leaderOnly, s.leader]) {
      await expectCode(c.as(who, "seat_board", null, 50, 0), "42501");
      await expectCode(c.as(who, "seat_extend", s.clock), "42501");
    }
    await expectCode(c.anon("seat_board", null, 50, 0), "42501");
    await expectCode(c.as(c.admin, "god_seat_settings"), "42501");
    expect(await c.o.call("god_seat_settings")).toMatchObject({ window_hours: 48, bar: 70 });
  });

  it("shows tiles that equal the rows beneath them, names and tribes and never a phone number", async () => {
    await on();
    const t = await fresh("Board");
    const a = await running("Board A", 30, { tribe: t });
    const b = await running("Board B", 10, { tribe: t });
    await c.as(c.admin, "seat_keep", b.clock, "Speaking to the family");
    const all = await c.as(c.admin, "seat_board", null, 50, 0);
    expect(all.tiles).toMatchObject({ waiting: 1, kept: 1 });
    expect(all.total).toBe(2);
    for (const flag of ["waiting", "kept"]) expect((await c.as(c.admin, "seat_board", flag, 50, 0)).rows.length).toBe(all.tiles[flag]);
    expect((await c.as(c.admin, "seat_board", "under24", 50, 0)).total).toBe(all.tiles.under24);
    expect(noNumber(all)).not.toMatch(/\+?\d{9,}|phone|whatsapp/i);
    const hist = await c.as(c.admin, "seat_clock_history", a.clock);
    expect(hist.map((h: { kind: string }) => h.kind)).toEqual(["remind", "start"]);
    // the owner's numbers change only with a reason and inside their ranges
    await expectCode(c.o.call("god_seat_settings_set", 48, 24, 40, 7, 3, 30, 70, null, "no"), "22023");
    await expectCode(c.o.call("god_seat_settings_set", 48, 40, 24, 7, 3, 30, 70, null, "Reminder after the last call"), "22023");
    await expectCode(c.o.call("god_seat_settings_set", 100, 24, 40, 7, 3, 30, 70, null, "Window too long for this"), "22023");
    await c.o.call("god_seat_settings_set", 72, 24, 60, 5, 2, 20, 75, 2, "A longer window for the holiday");
    expect(await c.one("select * from public.seat_window_settings")).toMatchObject({ window_hours: 72, last_call_hours: 60, take_back_days: 5, offers_in_row: 2, day_cap: 20, bar: 75 });
    expect((await c.sql("select 1 from public.event_log where action = 'seat_window.settings'")).length).toBe(1);
  });

  it("sends the three seat emails to the person asking, with an invented name, and no member is written to", async () => {
    await on();
    const t = await fresh("TestSend");
    await placed("Untouched", t.tribe);
    const r = await c.as(c.admin, "seat_test_send");
    expect(r).toEqual({ ok: true, queued: 3 });
    const rows = await c.sql("select template, params from public.messages where person_id = $1 and template like 'seat_%' order by template", [c.admin]);
    expect(rows.map((x) => x.template)).toEqual(["seat_last_call", "seat_released", "seat_reminder"]);
    expect(rows.every((x) => x.params.sample === true && x.params.tribe === "Sample Tribe")).toBe(true);
    expect((await c.sql("select 1 from public.messages where template like 'seat_%' and person_id <> $1", [c.admin])).length).toBe(0);
    await expectCode(c.as(c.member, "seat_test_send"), "42501");
  });
});

describe("the leader", () => {
  it("sees first names and where each seat stands, and may ask for more time once; nobody else's leader may", async () => {
    await on();
    const s = await running("Lead", 30);
    const strip = await c.as(s.leader, "seat_leader_strip", (await clockOf(s.tm)).tribe_id);
    expect(strip.mode).toBe("on");
    expect(strip.rows).toHaveLength(1);
    expect(strip.rows[0]).toMatchObject({ flag: "waiting", clock_id: s.clock });
    expect(noNumber(strip)).not.toMatch(/Test\b|\+?\d{9,}/); // a first name only: never the surname, never a number
    const t2 = await fresh("Not mine");
    await expectCode(c.as(s.leader, "seat_leader_strip", t2.tribe), "42501");
    await expectCode(c.as(t2.leader.id, "seat_leader_more_time", s.clock), "42501");
    expect(await c.as(s.leader, "seat_leader_more_time", s.clock)).toMatchObject({ ok: true });
    expect(await clockOf(s.tm)).toMatchObject({ extended: true, extended_by: "leader" });
    await expectCode(c.as(s.leader, "seat_leader_more_time", s.clock), "22023");
  });
});

describe("the guard and the ledger", () => {
  it("refuses a 13th active member whatever wrote it, and a seat that is released frees the place", async () => {
    const t = await fresh("Twelve");
    const seated: string[] = [];
    for (let i = 0; i < 12; i++) seated.push((await c.k.seat(t.tribe, c.season, `Twelve${i}`, { profile: false })).id);
    const thirteenth = (await c.k.person("Thirteenth")).id;
    const insert = () =>
      c.sql(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
        [t.tribe, thirteenth, c.season],
      );
    await expectCode(insert(), "23514");
    // a member who moves in from elsewhere is held to it too
    const elsewhere = await fresh("Moving");
    const mover = (await c.k.seat(elsewhere.tribe, c.season, "Mover", { profile: false })).id;
    await expectCode(c.sql("update public.tribe_members set tribe_id = $1 where person_id = $2", [t.tribe, mover]), "23514");
    await c.sql("update public.tribe_members set status = 'released', release_reason = 'Left' where person_id = $1", [seated[0]]);
    await insert();
    expect((await c.one("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [t.tribe])).n).toBe(12);
  });

  it("writes a line for every seat taken, confirmed, released and left, and nothing can change or remove one", async () => {
    const t = await fresh("Ledger");
    const p = await placed("Ledger", t.tribe);
    expect((await c.sql("select kind from public.seat_ledger where tm_id = $1 order by id", [p.tm])).map((r) => r.kind)).toEqual(expect.arrayContaining(["taken"]));
    await c.sql("update public.tribe_members set confirmed_at = now() where id = $1", [p.tm]);
    await c.sql("update public.tribe_members set status = 'released', release_reason = 'No reply in time' where id = $1", [p.tm]);
    const kinds = (await c.sql("select kind from public.seat_ledger where tm_id = $1 order by id", [p.tm])).map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["confirmed", "released"]));
    await expectCode(c.sql("update public.seat_ledger set kind = 'taken' where tm_id = $1", [p.tm]), "42501");
    await expectCode(c.sql("delete from public.seat_ledger where tm_id = $1", [p.tm]), "42501");
  });

  it("is closed to everyone but the functions: none of its tables can be read or written by a member or a signed-in person", async () => {
    for (const table of ["seat_window_settings", "seat_clocks", "seat_clock_log", "seat_chain", "seat_ledger"]) {
      await expectCode(c.db.asUser(c.admin, (q) => q(`select 1 from public.${table} limit 1`)), "42501");
      await expectCode(c.db.asAnon((q) => q(`select 1 from public.${table} limit 1`)), "42501");
    }
  });
});
