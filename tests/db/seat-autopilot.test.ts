import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// Package 8: the Seat autopilot (the bench, the daily plan, opening small tribes, the small-tribe watch). What these prove:
//   * the switch ships Off, needs Seat window, and cannot be put On while a seat-window check is red (Rehearsal is never refused)
//   * the bench is the people waiting (finished form, agreed to be matched, no seat, on no clock, answers unchanged for 7 days), longest wait first
//   * the plan: best fit at the bar, within 5 points the tribe with fewer members, one seat kept free, at most 2 a day to one tribe and 25 a day in all; a tribe with fewer
//     than the smallest size is opened only when that many people fit it, and as a team
//   * Rehearsal writes the plan and places nobody and makes no email; Suggest waits for one tap (and lapses at midnight); Auto places at the first beat after 9 am
//   * everything is checked again when the plan is placed, each person is placed through the office's own door, and what was skipped says why
//   * one plan a day, only between 8 am and 7 pm, only while joining is open (and the days the owner allows after), never when stopped; one tribe can be the first live run
//   * the small-tribe watch suggests a merge or says why nobody fits; the office sees names and numbers and never a phone number; only the owner changes the numbers

let c: Cast;
let n = 0;
let other: string;
let look: string;

const REASON = "Trying the seat autopilot";
const SLOT = "weeknight-evening";
const hour = (h: number) => c.db.admin.query(`create or replace function public.lagos_hour() returns integer language sql as $$ select ${h} $$`);
const unhour = () =>
  c.db.admin.query(
    "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$",
  );
const beat = () => c.sql("update public.seat_window_settings set last_tick_at = now()");
/** Runs one statement with the table's own triggers left out (a setup that the triggers would stamp over). */
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
const on = async (mode: "on" | "rehearsal" = "on", setting: "suggest" | "auto" = "suggest") => {
  await beat();
  await c.set("seat_window", "on", { reason: REASON });
  await c.set("seat_autopilot", mode, { reason: REASON });
  await c.sql("update public.autopilot_settings set mode = $1", [setting]);
};
const tick = async () => (await c.one("select public.autopilot_tick() as r")).r as Record<string, unknown>;
const tribe = (name: string, capacity = 12) => c.k.tribe(c.season, { name: `${name} ${++n}`, capacity, slot: SLOT });
const seatIn = async (name: string, t: string, profile: { faith?: string; social?: number } = {}) => (await c.k.seat(t, c.season, `${name}${++n}`, { profile })).id;
/**
 * A tribe that already has `size` members, so it is not "small". Its first two members are established believers, one quiet and one lively: the matching only
 * offers a tribe whose mix can still be reached with the seats left, so a plain tribe nearly full would never be offered to anyone.
 */
async function established(name: string, size = 4, capacity = 12) {
  const t = await tribe(name, capacity);
  for (let i = 0; i < size; i++) await seatIn(`${name}M`, t.tribe, i < 2 ? { faith: "established", social: i === 0 ? -1 : 1 } : {});
  return t;
}
const waiting = (name: string, daysAgo = 20) => readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo, times: [SLOT] });
const planOf = async () => (await c.sql("select * from public.autopilot_plans order by made_at desc limit 1"))[0];
const itemsOf = (plan: string) => c.sql("select * from public.autopilot_items where plan_id = $1 order by id", [plan]);
const seated = async (person: string) => (await c.sql("select tribe_id from public.tribe_members where person_id = $1 and status = 'active'", [person]))[0]?.tribe_id as string | undefined;
const benchIds = async () => (await c.sql("select person_id from public.autopilot_bench($1, 100)", [c.season])).map((r) => r.person_id as string);
const stats = async () => (await planOf()).stats as { bench_total: number; blocked_by_bar: number; kinds: { community: string; slot: string; waiting: number; seats: number }[]; small: Record<string, unknown>[] };

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  other = await c.k.season("Elsewhere", -400);
  look = (await c.k.staff("Data lead", "data_lead")).id;
}, 240_000);

afterAll(async () => {
  await unhour();
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await unhour();
  await c.sql("delete from public.autopilot_items");
  await c.sql("delete from public.autopilot_plans");
  await c.sql("update public.autopilot_settings set mode = 'suggest', bar = 70, per_tribe_day = 2, day_cap = 25, extra_days = 7, small_days = 10, paused = false, paused_reason = null");
  await c.sql("update public.placement_settings set min_tribe = 4, seats_free = 1, grace_days = 7");
  await c.sql("delete from public.seat_clock_log");
  await c.sql("delete from public.seat_clocks");
  await c.sql("delete from public.seat_chain");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.placed_holds");
  await c.sql("delete from public.erasure_requests");
  await c.sql("delete from public.email_signals");
  await c.sql("delete from public.care_flags");
  await c.sql("delete from public.contact_preferences");
  await c.sql("update public.seat_window_settings set window_hours = 48, remind_hours = 24, last_call_hours = 40, take_back_days = 7, offers_in_row = 3, day_cap = 30, bar = 70, counted_from = now() - interval '30 days', paused = false, paused_reason = null, last_tick_at = null, swept_at = null");
  await c.sql("update public.seasons set starts_on = current_date - 3 where id = $1", [c.season]);
  // tribes and people left over from an earlier test must not be offered or offer a seat in this one
  await c.sql("update public.tribes set status = 'closed' where season_id = $1", [c.season]);
  await c.sql("update public.member_profiles set season_id = $1 where season_id = $2 and person_id not in (select person_id from public.tribe_members where status = 'active')", [other, c.season]);
});

describe("it ships Off", () => {
  it("is on the Switchboard, starts Off, needs Seat window, and keeps the numbers the blueprint gives", async () => {
    const a = await c.one("select * from public.feature_registry where key = 'seat_autopilot'");
    expect(a).toMatchObject({ default_mode: "off", available: true, platform_only: false, stage: 8, sort: 35 });
    expect(a.modes).toEqual(["off", "rehearsal", "on"]);
    expect(a.depends).toEqual(["seat_window"]);
    expect(await c.one("select * from public.autopilot_settings")).toMatchObject({ mode: "suggest", bar: 70, per_tribe_day: 2, day_cap: 25, extra_days: 7, small_days: 10, paused: false });
    expect((await c.one("select public.autopilot_any() as a")).a).toBe("off");
  });

  it("cannot be put On before the seat window is open, nor while one of its checks is red, and says which; Rehearsal is never refused", async () => {
    await expect(c.set("seat_autopilot", "on", { reason: REASON })).rejects.toThrow(/Open Seat window first/);
    await beat();
    await c.set("seat_window", "on", { reason: REASON });
    await c.sql("update public.seat_window_settings set last_tick_at = null");
    await expect(c.set("seat_autopilot", "on", { reason: REASON })).rejects.toThrow(/cannot be put On yet/);
    await c.set("seat_autopilot", "rehearsal", { reason: REASON });
    expect((await c.one("select public.autopilot_any() as a")).a).toBe("rehearsal");
    await beat();
    await c.set("seat_autopilot", "on", { reason: REASON });
    expect((await c.one("select public.autopilot_any() as a")).a).toBe("on");
  });

  it("keeps its tables closed to everyone, and its inside functions to the database itself", async () => {
    for (const t of ["autopilot_settings", "autopilot_plans", "autopilot_items"]) {
      const r = await c.one("select relrowsecurity as rls, has_table_privilege('authenticated', $1::regclass, 'select') as sel from pg_class where oid = $1::regclass", [`public.${t}`]);
      expect(r, t).toMatchObject({ rls: true, sel: false });
    }
    for (const f of ["autopilot_any()", "autopilot_gate()", "autopilot_degree(uuid, uuid, boolean)", "autopilot_bench(uuid, integer)", "autopilot_plan_build(uuid, text)", "autopilot_apply_core(uuid, uuid)", "autopilot_tick()"]) {
      const r = await c.one("select has_function_privilege('anon', $1::regprocedure, 'execute') as a, has_function_privilege('authenticated', $1::regprocedure, 'execute') as b", [`public.${f}`]);
      expect(r, f).toMatchObject({ a: false, b: false });
    }
    for (const f of ["autopilot_overview()", "autopilot_approve(uuid)", "autopilot_pause_set(boolean, text)", "god_autopilot_settings()", "god_autopilot_settings_set(text, integer, integer, integer, integer, integer, text)"]) {
      const r = await c.one("select has_function_privilege('anon', $1::regprocedure, 'execute') as a, has_function_privilege('authenticated', $1::regprocedure, 'execute') as b", [`public.${f}`]);
      expect(r, f).toMatchObject({ a: false, b: true });
    }
  });
});

describe("the bench", () => {
  it("is the people waiting, longest wait first, and not anyone who holds a seat, is on a clock, changed their answers this week, has not agreed to matching or is under 18", async () => {
    const t = await established("Bench");
    const oldest = await waiting("Oldest", 30);
    const newer = await waiting("Newer", 10);
    const seatedMember = await seatIn("Seated", t.tribe);
    const recent = await waiting("Recent", 2);
    const noConsent = await readyMember(c.db, c.k, c.season, `Nc${++n}`, { daysAgo: 20, times: [SLOT], matching: false });
    const clocked = await waiting("Clocked", 15);
    const tm = (await c.one("select id from public.tribe_members where tribe_id = $1 and status = 'active' limit 1", [t.tribe])).id as string;
    await c.sql("insert into public.seat_clocks (tm_id, person_id, tribe_id, season_id, state, started_at, deadline_at, remind_at, last_call_at) select $1, $2, $3, $4, 'running', now(), now() + interval '2 days', now() + interval '1 day', now() + interval '40 hours'", [tm, clocked.id, t.tribe, c.season]);
    const teen = await waiting("Teen", 20);
    await replica("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [teen.id]);
    const ids = await benchIds();
    expect(ids.indexOf(oldest.id)).toBeLessThan(ids.indexOf(newer.id));
    expect(ids).toContain(oldest.id);
    expect(ids).toContain(newer.id);
    for (const gone of [seatedMember, recent.id, noConsent.id, clocked.id, teen.id]) expect(ids, gone).not.toContain(gone);
  });
});

describe("the daily plan", () => {
  it("in Rehearsal is written down and places nobody, and makes no email", async () => {
    const t = await established("Rehearse");
    const w = await waiting("Reh");
    await hour(10);
    await on("rehearsal");
    const before = await c.sql("select 1 from public.messages");
    const r = await tick();
    expect(r).toMatchObject({ ran: true, plan: true, state: "rehearsal" });
    const p = await planOf();
    expect(p).toMatchObject({ state: "rehearsal", n_items: 1, n_placed: 0 });
    expect(await itemsOf(p.id)).toEqual([expect.objectContaining({ person_id: w.id, tribe_id: t.tribe, kind: "fill", rehearsal: true, outcome: null })]);
    expect(await seated(w.id)).toBeUndefined();
    expect(await c.sql("select 1 from public.messages where template in ('placement_your_tribe', 'admin_autopilot_ready', 'leader_new_member')")).toHaveLength(0);
    expect(await c.sql("select 1 from public.messages")).toHaveLength(before.length);
  });

  it("in Suggest waits for one tap, tells the admin and the director once, and places on the tap with the office's own checks and emails", async () => {
    await c.noticesOn();
    const t = await established("Suggest");
    const w = await waiting("Sug");
    await hour(10);
    await on("on", "suggest");
    const r = await tick();
    expect(r).toMatchObject({ plan: true, state: "planned", items: 1 });
    expect(await seated(w.id)).toBeUndefined();
    const p = await planOf();
    expect(p.state).toBe("planned");
    const told = await c.sql("select distinct person_id from public.messages where template = 'admin_autopilot_ready'");
    expect(told.map((x) => x.person_id)).toEqual(expect.arrayContaining([c.admin, c.director]));
    const again = await tick();
    expect(again).toMatchObject({ plan: false });
    expect(await c.sql("select 1 from public.messages where template = 'admin_autopilot_ready' and person_id = $1", [c.admin])).toHaveLength(1);

    await expectCode(c.as(c.member, "autopilot_approve", p.id), "42501");
    await expectCode(c.as(look, "autopilot_approve", p.id), "42501");
    const done = await c.as(c.admin, "autopilot_approve", p.id);
    expect(done).toMatchObject({ ok: true, placed: 1, skipped: 0 });
    expect(await seated(w.id)).toBe(t.tribe);
    expect(await planOf()).toMatchObject({ state: "applied", n_placed: 1, decided_by: c.admin });
    expect((await itemsOf(p.id))[0].outcome).toBe("placed");
    expect(await c.sql("select 1 from public.messages where person_id = $1 and template = 'placement_your_tribe'", [w.id])).toHaveLength(1);
    expect(await c.sql("select 1 from public.seat_ledger where person_id = $1 and kind = 'taken' and via = 'autopilot'", [w.id])).toHaveLength(1);
    expect(await c.sql("select 1 from public.event_log where action = 'autopilot.placed' and entity_id = $1", [w.id])).toHaveLength(1);
    await expectCode(c.as(c.admin, "autopilot_approve", p.id), "22023");
  });

  it("in Auto places at the first beat after 9 am, and not before", async () => {
    const t = await established("Auto");
    const w = await waiting("Aut");
    await on("on", "auto");
    await hour(8);
    expect(await tick()).toMatchObject({ ran: false, why: "hour" });
    expect(await seated(w.id)).toBeUndefined();
    await hour(9);
    expect(await tick()).toMatchObject({ ran: true, plan: true, state: "planned" });
    expect(await seated(w.id)).toBe(t.tribe);
    expect(await planOf()).toMatchObject({ state: "applied", n_placed: 1, decided_by: null });
  });

  it("puts a person with the best fit, and within 5 points the tribe with fewer members, and keeps one seat free", async () => {
    const big = await established("Big", 6);
    const small = await established("Small", 4);
    const w = await waiting("Pick");
    await hour(10);
    await on("rehearsal");
    await tick();
    expect((await itemsOf((await planOf()).id))[0]).toMatchObject({ person_id: w.id, tribe_id: small.tribe });
    expect(big.tribe).not.toBe(small.tribe);
  });

  it("keeps the seat free: a tribe of 12 with 10 in it takes one more, not two", async () => {
    const t = await established("Spare", 10);
    await waiting("A");
    await waiting("B");
    await hour(10);
    await on("rehearsal");
    await c.sql("update public.autopilot_settings set per_tribe_day = 4");
    await tick();
    const items = await itemsOf((await planOf()).id);
    expect(items).toHaveLength(1);
    expect(items[0].tribe_id).toBe(t.tribe);
  });

  it("puts at most 2 a day into one tribe, and at most the day's limit in all", async () => {
    const t = await established("Cap", 4);
    for (const w of ["A", "B", "C"]) await waiting(w);
    await hour(10);
    await on("rehearsal");
    await tick();
    expect(await itemsOf((await planOf()).id)).toHaveLength(2);
    await c.sql("delete from public.autopilot_items");
    await c.sql("delete from public.autopilot_plans");
    const t2 = await established("Cap2", 4);
    await c.sql("update public.autopilot_settings set per_tribe_day = 4, day_cap = 5");
    for (const w of ["D", "E", "F"]) await waiting(w);
    await tick();
    const items = await itemsOf((await planOf()).id);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.tribe_id))).toEqual(new Set([t.tribe, t2.tribe]));
  });

  it("never places below the bar, and counts the people the bar alone holds back", async () => {
    await established("Bar");
    await waiting("Fit");
    await hour(10);
    await on("rehearsal");
    await c.sql("update public.autopilot_settings set bar = 95");
    await tick();
    const p = await planOf();
    expect(p).toMatchObject({ state: "empty", n_items: 0 });
    expect((await stats()).blocked_by_bar).toBe(1);
  });

  it("opens a tribe with fewer than the smallest size only when that many fit it, and then as a team, never one person alone", async () => {
    const t = await tribe("Empty");
    for (const w of ["A", "B", "C"]) await waiting(w);
    await hour(10);
    await on("rehearsal");
    await tick();
    expect(await itemsOf((await planOf()).id)).toHaveLength(0);
    await c.sql("delete from public.autopilot_plans");
    await waiting("D");
    await tick();
    const items = await itemsOf((await planOf()).id);
    expect(items).toHaveLength(4);
    for (const i of items) expect(i).toMatchObject({ tribe_id: t.tribe, kind: "open" });
  });

  it("does not open a tribe the team would not fit in", async () => {
    await tribe("Tiny", 4);
    for (const w of ["A", "B", "C", "D"]) await waiting(w);
    await hour(10);
    await on("rehearsal");
    await tick();
    expect(await itemsOf((await planOf()).id)).toHaveLength(0);
  });

  it("makes one plan a day, only between 8 am and 7 pm, and not when stopped", async () => {
    await established("Day");
    await waiting("A");
    await on("rehearsal");
    await hour(7);
    expect(await tick()).toMatchObject({ ran: false, why: "hour" });
    await hour(19);
    expect(await tick()).toMatchObject({ ran: false, why: "hour" });
    await hour(8);
    await c.sql("update public.autopilot_settings set paused = true");
    expect(await tick()).toMatchObject({ ran: false, why: "paused" });
    await c.sql("update public.autopilot_settings set paused = false");
    expect(await tick()).toMatchObject({ plan: true });
    expect(await tick()).toMatchObject({ plan: false });
    expect(await c.sql("select 1 from public.autopilot_plans")).toHaveLength(1);
  });

  it("does nothing while Off or the Master pause is on", async () => {
    await established("Off");
    await waiting("A");
    await hour(10);
    expect(await tick()).toMatchObject({ ran: false });
    await on("rehearsal");
    await c.sql("update public.feature_master set paused = true");
    expect(await tick()).toMatchObject({ ran: false });
    await c.sql("update public.feature_master set paused = false");
    expect(await c.sql("select 1 from public.autopilot_plans")).toHaveLength(0);
  });

  it("keeps placing for the days the owner allows after joining closes, saying so on each placement, and stops after them", async () => {
    const t = await established("Closed", 4);
    const w = await waiting("A");
    await hour(10);
    await on("on", "auto");
    await c.sql("update public.seasons set status = 'closed' where id <> $1", [c.season]);
    // joining closes 14 days after the season starts: 17 days in, it closed 3 days ago, and the owner allows 7
    await c.sql("update public.seasons set starts_on = current_date - 17 where id = $1", [c.season]);
    expect(await tick()).toMatchObject({ ran: true, plan: true, state: "planned" });
    expect(await seated(w.id)).toBe(t.tribe);
    expect((await c.one("select note from public.placement_runs where single order by planned_at desc limit 1")).note).toMatch(/Placed by autopilot/);
    await c.sql("delete from public.autopilot_items");
    await c.sql("delete from public.autopilot_plans");
    await c.sql("update public.seasons set starts_on = current_date - 40 where id = $1", [c.season]);
    expect(await tick()).toMatchObject({ ran: false, why: "closed" });
    await c.sql("update public.seasons set starts_on = current_date - 3 where id = $1", [c.season]);
    await c.sql("update public.seasons set status = 'open' where id <> $1 and id <> $2", [c.season, other]);
  });

  it("can be the first live run for one tribe: only that tribe is planned into", async () => {
    const a = await established("First", 4);
    await established("Second", 4);
    await waiting("A");
    await hour(10);
    await beat();
    await c.set("seat_window", "on", { reason: REASON });
    await c.set("seat_autopilot", "on", { scope: "tribe", id: a.tribe, reason: REASON });
    await tick();
    const items = await itemsOf((await planOf()).id);
    expect(items).toHaveLength(1);
    expect(items[0].tribe_id).toBe(a.tribe);
  });

  it("lapses at midnight when nobody tapped, and says so in the office's morning email numbers", async () => {
    await established("Lapse");
    await waiting("A");
    await hour(10);
    await on("on", "suggest");
    await tick();
    const p = await planOf();
    await c.sql("update public.autopilot_plans set plan_on = public.today_lagos() - 1 where id = $1", [p.id]);
    await c.sql("update public.autopilot_plans set made_at = now() - interval '1 day' where id = $1", [p.id]);
    await beat();
    await tick();
    expect((await c.one("select state from public.autopilot_plans where id = $1", [p.id])).state).toBe("lapsed");
    await expectCode(c.as(c.admin, "autopilot_approve", p.id), "22023");
    const numbers = (await c.one("select public.seat_morning_numbers() as r")).r as { lapsed: number; auto_placed: number };
    expect(numbers.lapsed).toBe(1);
  });
});

describe("placing the plan", () => {
  it("checks everyone again: someone who withdrew their consent or changed their answers this morning is skipped, with the reason, and the rest are placed", async () => {
    const t = await established("Again", 4);
    const gone = await waiting("Gone");
    const changed = await waiting("Changed");
    const stays = await waiting("Stays");
    await hour(10);
    await on("on", "suggest");
    await c.sql("update public.autopilot_settings set per_tribe_day = 3");
    await tick();
    const p = await planOf();
    expect((await itemsOf(p.id)).length).toBe(3);
    await c.sql("delete from public.consents where person_id = $1 and purpose = 'matching'", [gone.id]);
    await c.sql("update public.member_profiles set updated_at = now() where person_id = $1", [changed.id]);
    await beat();
    const r = await c.as(c.admin, "autopilot_approve", p.id);
    const outcome = Object.fromEntries((await itemsOf(p.id)).map((i) => [i.person_id, i.outcome]));
    expect(outcome[gone.id]).toBe("skipped:not_eligible");
    expect(outcome[changed.id]).toBe("skipped:not_eligible");
    expect(outcome[stays.id]).toBe("placed");
    expect(r).toMatchObject({ ok: true, placed: 1, skipped: 2 });
    expect(await seated(stays.id)).toBe(t.tribe);
    expect(await seated(gone.id)).toBeUndefined();
    expect(await planOf()).toMatchObject({ state: "applied", n_placed: 1, n_skipped: 2 });
  });

  it("skips a person whose tribe filled up while the plan waited, and says it was full", async () => {
    const t = await established("Fills", 4, 6);
    const w = await waiting("A");
    await hour(10);
    await on("on", "suggest");
    await tick();
    const p = await planOf();
    expect(await itemsOf(p.id)).toHaveLength(1);
    await seatIn("Late", t.tribe);
    await beat();
    expect(await c.as(c.admin, "autopilot_approve", p.id)).toMatchObject({ ok: true, placed: 0, skipped: 1 });
    expect((await itemsOf(p.id))[0].outcome).toBe("skipped:full");
    expect(await seated(w.id)).toBeUndefined();
  });

  it("refuses to place while a seat-window check is red or autopilot is stopped, and places once both are clear", async () => {
    await established("Limit", 4);
    await waiting("A");
    await hour(10);
    await on("on", "suggest");
    await tick();
    const p = await planOf();
    await c.sql("update public.seat_window_settings set last_tick_at = null");
    await expectCode(c.as(c.admin, "autopilot_approve", p.id), "22023");
    await beat();
    await c.sql("update public.autopilot_settings set paused = true");
    await expectCode(c.as(c.admin, "autopilot_approve", p.id), "22023");
    await c.sql("update public.autopilot_settings set paused = false");
    expect(await c.as(c.admin, "autopilot_approve", p.id)).toMatchObject({ ok: true, placed: 1 });
  });

  it("refuses to place while Placement itself is not On", async () => {
    await established("Placement", 4);
    const w = await waiting("A");
    await hour(10);
    await on("on", "suggest");
    await tick();
    const p = await planOf();
    await c.sql("update public.placement_settings set mode = 'off'");
    await beat();
    await expectCode(c.as(c.admin, "autopilot_approve", p.id), "22023");
    await c.sql("update public.placement_settings set mode = 'on'");
    expect(await seated(w.id)).toBeUndefined();
  });
});

describe("the small-tribe watch and the Seats page", () => {
  it("lists a tribe still under the smallest size ten days after it opened, with a suggested merge, and a tribe nobody fits as hard to fill, with the reason", async () => {
    const big = await established("Home", 4);
    const small = await tribe("Small");
    for (let i = 0; i < 2; i++) {
      const m = await seatIn("Mover", small.tribe);
      await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')", [m]);
    }
    await c.sql("update public.tribes set published_at = now() - interval '15 days' where id = $1", [small.tribe]);
    const lonely = await tribe("Lonely");
    await c.sql("update public.tribes set published_at = now() - interval '15 days' where id = $1", [lonely.tribe]);
    await hour(10);
    await on("rehearsal");
    await tick();
    const s = (await stats()).small as { name: string; hard: boolean; why: string | null; members: number; merge: { to: string; fits: number; of: number } | null }[];
    const mine = s.find((x) => x.name.startsWith("Small"));
    const empty = s.find((x) => x.name.startsWith("Lonely"));
    expect(mine).toMatchObject({ members: 2 });
    expect(mine?.merge).toMatchObject({ fits: 2, of: 2 });
    expect(mine?.merge?.to).toMatch(/^Home/);
    expect(empty).toMatchObject({ members: 0, hard: true });
    expect(["nobody", "time", "format", "fit"]).toContain(empty?.why);
    expect(big.tribe).toBeTruthy();
  });

  it("shows the office the bench against the seats open, the plan and the people in it, and shows a data lead the same without letting them act", async () => {
    await established("Seats", 4);
    await waiting("A");
    await hour(10);
    await on("rehearsal");
    await tick();
    const o = await c.as(c.admin, "autopilot_overview");
    expect(o).toMatchObject({ role: "act", mode: "rehearsal", setting: "suggest", paused: false, bar: 70 });
    expect(o.plan).toMatchObject({ today: true, state: "rehearsal", items: 1 });
    expect(o.plan.rows[0]).toMatchObject({ kind: "fill", rehearsal: true });
    expect(typeof o.plan.rows[0].person).toBe("string");
    expect(o.stats.kinds.some((k: { waiting: number; seats: number }) => k.waiting > 0 && k.seats > 0)).toBe(true);
    expect(JSON.stringify(o)).not.toMatch(/\+\d{8,}/);
    expect(await c.as(look, "autopilot_overview")).toMatchObject({ role: "look" });
    await expectCode(c.as(c.member, "autopilot_overview"), "42501");
    await expectCode(c.anon("autopilot_overview"), "42501");
  });

  it("lets the office stop it with a reason and start it again, and nobody else", async () => {
    await expectCode(c.as(c.member, "autopilot_pause_set", true, REASON), "42501");
    await expectCode(c.as(look, "autopilot_pause_set", true, REASON), "42501");
    await expectCode(c.as(c.admin, "autopilot_pause_set", true, "no"), "22023");
    expect(await c.as(c.admin, "autopilot_pause_set", true, REASON)).toMatchObject({ paused: true });
    expect((await c.one("select paused from public.autopilot_settings")).paused).toBe(true);
    expect(await c.as(c.admin, "autopilot_pause_set", false, null)).toMatchObject({ paused: false });
  });
});

describe("the owner's numbers", () => {
  it("are read and changed only by the unlocked owner, with a reason, inside their ranges, and the change is logged", async () => {
    await expectCode(c.as(c.admin, "god_autopilot_settings"), "42501");
    expect(await c.o.call("god_autopilot_settings")).toMatchObject({ mode: "suggest", bar: 70, per_tribe_day: 2, day_cap: 25, extra_days: 7, small_days: 10 });
    await expectCode(c.as(c.admin, "god_autopilot_settings_set", "auto", 75, 2, 25, 7, 10, REASON), "42501");
    await expect(c.o.call("god_autopilot_settings_set", "auto", 75, 2, 25, 7, 10, "no")).rejects.toThrow(/Say why/);
    await expect(c.o.call("god_autopilot_settings_set", "now", 75, 2, 25, 7, 10, REASON)).rejects.toThrow(/Suggest or Auto/);
    for (const bad of [[59, 2, 25, 7, 10], [96, 2, 25, 7, 10], [70, 0, 25, 7, 10], [70, 5, 25, 7, 10], [70, 2, 4, 7, 10], [70, 2, 101, 7, 10], [70, 2, 25, 31, 10], [70, 2, 25, 7, 4]]) {
      await expect(c.o.call("god_autopilot_settings_set", "auto", ...bad, REASON), JSON.stringify(bad)).rejects.toThrow(/outside its range/);
    }
    await c.o.call("god_autopilot_settings_set", "auto", 75, 3, 30, 5, 12, REASON);
    expect(await c.one("select * from public.autopilot_settings")).toMatchObject({ mode: "auto", bar: 75, per_tribe_day: 3, day_cap: 30, extra_days: 5, small_days: 12 });
    expect(await c.sql("select 1 from public.event_log where action = 'autopilot.settings'")).toHaveLength(1);
  });
});

describe("the office's morning email numbers", () => {
  it("count what autopilot placed yesterday, and the plan nobody approved", async () => {
    const t = await established("Morning", 4);
    const w = await waiting("A");
    await hour(10);
    await on("on", "auto");
    await tick();
    expect(await seated(w.id)).toBe(t.tribe);
    expect(((await c.one("select public.seat_morning_numbers() as r")).r as { auto_placed: number }).auto_placed).toBe(0);
    const today = Number((await c.one("select count(*) as n from public.seat_ledger where via = 'autopilot' and kind = 'taken' and (at at time zone 'Africa/Lagos')::date = public.today_lagos()")).n);
    expect(today).toBeGreaterThanOrEqual(1);
    // tomorrow morning, what was placed today is "yesterday"
    await c.db.admin.query("create or replace function public.today_lagos() returns date language sql stable set search_path = '' as $$ select ((now() at time zone 'Africa/Lagos')::date + 1) $$");
    try {
      expect(((await c.one("select public.seat_morning_numbers() as r")).r as { auto_placed: number }).auto_placed).toBe(today);
    } finally {
      await c.db.admin.query("create or replace function public.today_lagos() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Africa/Lagos')::date $$");
    }
  });
});
