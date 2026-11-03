import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { type TestDb } from "./helpers";
import {
  anon,
  asUser,
  linkFor,
  markSent,
  openSeason,
  placeRun,
  planRun,
  readyMember,
  rows,
  workerToken,
} from "./placement-kit";

// Package 1 of the placement blueprint: a season that has started can still be placed into until joining closes (one shared rule), a started
// tribe is never "small", the cut-off governs "Show me other tribes", the leader hears at most once a day, and the owner can place one
// person, with every warning ticked and explained.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let wt: string;
let tag = 0;
let original: { status: string };

const one = async (text: string, params: unknown[] = []) =>
  (await db.admin.query(text, params)).rows[0];

/** Moves the seeded season: positive = it began that many days ago, negative = it starts that many days from now. */
const started = (daysAgo: number) => k.moveSeason(season, daysAgo);

async function world(weeknight = 3, capacity = 12) {
  tag++;
  await db.admin.query(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );
  const C = await k.tribe(season, {
    capacity,
    name: `Mid ${tag}`,
    assistant: "certified",
  });
  const mem: { id: string }[] = [];
  for (let i = 0; i < weeknight; i++)
    mem.push(
      await readyMember(db, k, season, `P${tag}x${i}`, {
        times: ["weeknight-evening"],
        daysAgo: 40 - i,
      }),
    );
  return { C, mem };
}

/** The heartbeat's own call (not open to anyone through the API). */
const teamMail = async (run: string) =>
  (await one("select public.placement_team_mail($1) as n", [run])).n as number;

const cancelOpen = () =>
  db.admin.query(
    "update public.placement_runs set status = 'cancelled' where status in ('planning', 'planned', 'approved')",
  );

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  original = await one("select status from public.seasons where id = $1", [
    season,
  ]);
  o = await makeOwner(db);
  wt = await workerToken(db);
  await o.call(
    "placement_settings_save",
    JSON.stringify({ mode: "on", min_tribe: 4 }),
  );
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the season rule", () => {
  it("is the season to start, then the season that has started and is still open to joining, then nothing", async () => {
    await started(-30);
    expect((await one("select public.placement_season() as s")).s).toBe(
      season,
    );
    let w = (await one("select public.season_joining_window() as w")).w;
    expect(w).toMatchObject({ started: false, week: null, open: true });

    await started(5);
    expect((await one("select public.placement_season() as s")).s).toBe(
      season,
    );
    w = (await one("select public.season_joining_window() as w")).w;
    expect(w).toMatchObject({ started: true, week: 1, open: true });
    const closes = await one(
      "select (starts_on + 14)::text as d from public.seasons where id = $1",
      [season],
    );
    expect(w.closes_on).toBe(closes.d);

    await started(15);
    expect((await one("select public.placement_season() as s")).s).toBeNull();
    w = (await one("select public.season_joining_window($1) as w", [season]))
      .w;
    expect(w).toMatchObject({ started: true, week: 3, open: false });
    await started(-30);
  });

  it("serves a running season to the leader pages, and leaves a season that has not started exactly as before", async () => {
    await started(5);
    await db.admin.query("update public.seasons set status = 'running' where id = $1", [season]);
    expect((await one("select public.leader_fit_season() as s")).s).toBe(season);
    await db.admin.query("update public.seasons set status = $2 where id = $1", [season, original.status]);
    await started(-30);
    expect((await one("select public.leader_fit_season() as s")).s).toBe(season);
  });

  it("lets a leader start a Tribe Card while the season is running, and still in the season to come", async () => {
    const lead = await k.staff(`Starter${Date.now()}`, "leader");
    await started(5);
    await db.admin.query("update public.seasons set status = 'running' where id = $1", [season]);
    const card = await asUser(db, lead.id, "start_tribe_card");
    expect(card).toMatch(/^[0-9a-f-]{36}$/);
    expect((await one("select season_id from public.tribes where id = $1", [card])).season_id).toBe(season);
    await db.admin.query("delete from public.tribes where id = $1", [card]);
    await db.admin.query("update public.seasons set status = $2 where id = $1", [season, original.status]);
    await started(-30);
    const again = await asUser(db, lead.id, "start_tribe_card");
    expect((await one("select season_id from public.tribes where id = $1", [again])).season_id).toBe(season);
    await db.admin.query("delete from public.tribes where id = $1", [again]);
  });

  it("is readable by a signed-in member and by no one who is not signed in", async () => {
    const m = await k.person("Reader");
    expect(await asUser(db, m.id, "placement_season")).toBe(season);
    await expect(anon(db, "placement_season")).rejects.toThrow();
  });
});

describe("a run in a season that has started", () => {
  it("plans into a season that is running, keeps a started tribe from being small, shortens the grace period, and asks for the first meeting within a week", async () => {
    await world(3);
    // Before the season starts, three people in a tribe that needs four is small
    await started(-30);
    const before = await planRun(o, {});
    expect(
      (
        await rows(
          db,
          "select small from public.placement_teams where run_id = $1",
          [before],
        )
      ).map((r) => r.small),
    ).toEqual([true]);
    await cancelOpen();

    await started(5);
    const run = await planRun(o, {});
    const r = await one(
      "select in_season, after_cutoff, grace_days, single from public.placement_runs where id = $1",
      [run],
    );
    expect(r).toEqual({ in_season: true, after_cutoff: false, grace_days: 2, single: false });
    expect(
      (
        await rows(
          db,
          "select small from public.placement_teams where run_id = $1",
          [run],
        )
      ).map((x) => x.small),
    ).toEqual([false]);
    await o.call("placement_run_approve", run, 3);
    for (let i = 0; i < 10; i++)
      if ((await o.call("placement_run_place", run)).left === 0) break;
    const seats = await rows(
      db,
      "select (first_meeting_by = public.today_lagos() + 7) as soon from public.tribe_members where placed_by_run = $1 and status = 'active'",
      [run],
    );
    expect(seats.length).toBe(3);
    expect(seats.every((s) => s.soon)).toBe(true);
    // the "Your tribe" email says it is a running season
    const msg = await one(
      "select params from public.messages where template = 'placement_your_tribe' order by created_at desc limit 1",
    );
    expect(msg.params).toMatchObject({ in_season: true, week: 1 });
    expect(msg.params.first_meeting_by).toBeTruthy();
    await started(-30);
  });

  it("refuses after the cut-off unless it is asked for on purpose, and says so in words", async () => {
    await started(20);
    await expect(
      o.call("placement_run_new", JSON.stringify({ season })),
    ).rejects.toThrow(/closed on/);
    await expect(
      o.call("placement_run_new", JSON.stringify({ season, after_cutoff: "yes" })),
    ).rejects.toThrow(/yes or no/);
    const made = await o.call("placement_run_new", JSON.stringify({ season, after_cutoff: true }));
    const r = await one("select in_season, after_cutoff from public.placement_runs where id = $1", [made.run]);
    expect(r).toEqual({ in_season: true, after_cutoff: true });
    await cancelOpen();
    await started(-30);
  });

  it("lets a placed member ask for other tribes until the cut-off, and not after", async () => {
    await world(2);
    await started(5);
    const { run } = await placeRun(db, o, {});
    const seats = await rows(
      db,
      "select person_id from public.tribe_members where placed_by_run = $1 and status = 'active' order by id",
      [run],
    );
    const a = (await linkFor(db, seats[0].person_id))!;
    const b = (await linkFor(db, seats[1].person_id))!;
    const info = await anon(db, "worker_placed_info", wt, a);
    expect(info).toMatchObject({ can_change: true, in_season: true });
    expect(await anon(db, "worker_placed_change", wt, a)).toEqual({ ok: true });
    await started(20);
    expect(await anon(db, "worker_placed_info", wt, b)).toMatchObject({ can_change: false });
    expect(await anon(db, "worker_placed_change", wt, b)).toEqual({ ok: false, reason: "started" });
    await started(-30);
  });
});

describe("the leader hears at most once a day per tribe", () => {
  it("holds a second email for a tribe for a day, and sends it when the day has passed", async () => {
    const w = await world(2);
    await started(5);
    const first = await placeRun(db, o, {});
    await markSent(db, 30);
    expect(await teamMail(first.run)).toBe(1);

    const extra = await readyMember(db, k, season, `Late${tag}`, { times: ["weeknight-evening"], daysAgo: 30 });
    const placed = await o.call("placement_one_place", extra.id, w.C.tribe, [], null, false);
    expect(placed.ok).toBe(true);
    await markSent(db, 30);
    expect(await teamMail(placed.run)).toBe(0);
    await db.admin.query(
      "update public.placement_teams set mail_queued_at = now() - interval '25 hours' where run_id = $1",
      [first.run],
    );
    expect(await teamMail(placed.run)).toBe(1);
    const mail = await one(
      "select params from public.messages where template = 'placement_your_team' order by created_at desc limit 1",
    );
    expect(mail.params).toMatchObject({ in_season: true, week: 1 });
    await started(-30);
  });
});

describe("placing one person", () => {
  it("checks a good match without a single warning, and says what would stop or need a reason otherwise", async () => {
    const w = await world(1);
    await started(5);
    const good = w.mem[0].id;
    let c = await o.call("placement_one_check", good, w.C.tribe);
    expect(c.ok).toBe(true);
    expect(c.blockers).toEqual([]);
    expect(c.warnings.map((x: { code: string }) => x.code)).not.toContain("no_score");
    expect(c.person.name).toBeTruthy();
    expect(c.window).toMatchObject({ started: true, open: true });

    // not scored: a Sunday-only member is not offered a weeknight tribe
    const sunday = await readyMember(db, k, season, `Sun${tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    c = await o.call("placement_one_check", sunday.id, w.C.tribe);
    expect(c.ok).toBe(true);
    expect(c.warnings.map((x: { code: string }) => x.code)).toContain("no_score");

    // no form at all
    const blank = await k.person(`Blank${tag}`);
    c = await o.call("placement_one_check", blank.id, w.C.tribe);
    expect(c.warnings.map((x: { code: string }) => x.code)).toEqual(expect.arrayContaining(["needs_form", "no_score"]));

    // no agreement to matching
    const noc = await readyMember(db, k, season, `NoC${tag}`, { times: ["weeknight-evening"], daysAgo: 30, matching: false });
    c = await o.call("placement_one_check", noc.id, w.C.tribe);
    expect(c.warnings.map((x: { code: string }) => x.code)).toContain("no_consent");

    // blockers that nothing overrides
    c = await o.call("placement_one_check", w.C.leader.id, w.C.tribe);
    expect(c.ok).toBe(false);
    expect(c.blockers.map((x: { code: string }) => x.code)).toContain("leader");
    await db.admin.query("update public.tribes set status = 'closed' where id = $1", [w.C.tribe]);
    c = await o.call("placement_one_check", good, w.C.tribe);
    expect(c.blockers.map((x: { code: string }) => x.code)).toContain("tribe_closed");
    await db.admin.query("update public.tribes set status = 'approved' where id = $1", [w.C.tribe]);
    await started(-30);
  });

  it("will not place anyone until each warning is ticked and a reason is given, and places them as a run of one once it is", async () => {
    const w = await world(1);
    await started(5);
    const sunday = await readyMember(db, k, season, `Sun2${tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    await expect(o.call("placement_one_place", sunday.id, w.C.tribe, [], null, false)).rejects.toThrow(/tick/);
    await expect(o.call("placement_one_place", sunday.id, w.C.tribe, ["no_score"], "  ", false)).rejects.toThrow(/Say why/);
    const done = await o.call(
      "placement_one_place", sunday.id, w.C.tribe, ["no_score"], "Asked me in person after church", false,
    );
    expect(done.ok).toBe(true);

    const run = await one(
      "select single, in_season, status, note, pool from public.placement_runs where id = $1",
      [done.run],
    );
    expect(run).toEqual({ single: true, in_season: true, status: "placed", note: "Asked me in person after church", pool: 1 });
    const item = await one("select override, override_reason, status, degree from public.placement_items where run_id = $1", [done.run]);
    expect(item).toMatchObject({ override: ["no_score"], override_reason: "Asked me in person after church", status: "placed", degree: null });
    const seat = await one(
      "select placement_source, placed_by_run, contact_withheld, confirmed_at, (first_meeting_by = public.today_lagos() + 7) as soon from public.tribe_members where id = $1",
      [done.placement],
    );
    expect(seat).toMatchObject({ placement_source: "auto", placed_by_run: done.run, contact_withheld: false, confirmed_at: null, soon: true });
    // the member is told by email, with the same private link as for a church run, and no "fit" is claimed
    const msg = await one(
      "select force_channel, status, params from public.messages where template = 'placement_your_tribe' and person_id = $1",
      [sunday.id],
    );
    expect(msg.force_channel).toBe("email");
    expect(msg.params.fit).toBeNull();
    expect(await linkFor(db, sunday.id)).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (await one("select count(*)::int n from public.event_log where action = 'placement.single'")).n,
    ).toBeGreaterThan(0);

    // the same person cannot be placed twice
    const again = await o.call("placement_one_check", sunday.id, w.C.tribe);
    expect(again.ok).toBe(false);
    expect(again.blockers.map((x: { code: string }) => x.code)).toContain("has_seat");

    // and it can be taken back until the leader has been told
    const undone = await o.call("placement_undo", done.run);
    expect(undone).toMatchObject({ status: "undone", released: 1 });
    expect((await one("select status from public.tribe_members where id = $1", [done.placement])).status).toBe("released");
    await started(-30);
  });

  it("places someone into a full tribe, below the bar or after the cut-off only with a reason, and records 'they already agreed' as the owner's word", async () => {
    const w = await world(2, 4);
    // three seats already taken, so one is left
    for (let i = 0; i < 3; i++) await k.seat(w.C.tribe, season, `Seated${tag}x${i}`);
    await started(20);
    const a = w.mem[0].id;
    const b = w.mem[1].id;
    // after the cut-off (and, with a nearly full tribe, the health rules of the matching no longer offer it, so there is no score), then full
    const codes = (c: { warnings: { code: string }[] }) => c.warnings.map((x) => x.code).sort();
    let c = await o.call("placement_one_check", a, w.C.tribe);
    expect(codes(c)).toEqual(["after_cutoff", "no_score"]);
    await expect(o.call("placement_one_place", a, w.C.tribe, codes(c), null, false)).rejects.toThrow(/Say why/);
    const first = await o.call("placement_one_place", a, w.C.tribe, codes(c), "Moved here last week", false);
    expect(first.ok).toBe(true);
    expect((await one("select after_cutoff from public.placement_runs where id = $1", [first.run])).after_cutoff).toBe(true);

    c = await o.call("placement_one_check", b, w.C.tribe);
    expect(codes(c)).toEqual(["after_cutoff", "full", "no_score"]);
    await expect(o.call("placement_one_place", b, w.C.tribe, ["after_cutoff", "no_score"], "Please", false)).rejects.toThrow(/tick/);
    const second = await o.call("placement_one_place", b, w.C.tribe, codes(c), "Her leader asked", false);
    expect(second.ok).toBe(true);
    expect(
      (await one("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [w.C.tribe])).n,
    ).toBe(5);

    // no agreement to matching: the owner must say they agreed, and it is kept as what the owner said
    const noc = await readyMember(db, k, season, `NoC2${tag}`, { times: ["weeknight-evening"], daysAgo: 30, matching: false });
    c = await o.call("placement_one_check", noc.id, w.C.tribe);
    const all = codes(c);
    expect(all).toContain("no_consent");
    await expect(o.call("placement_one_place", noc.id, w.C.tribe, all, "On the phone", false)).rejects.toThrow(/agree/);
    const third = await o.call("placement_one_place", noc.id, w.C.tribe, all, "On the phone", true);
    expect(third.ok).toBe(true);
    const item = await one("select agreed, override from public.placement_items where run_id = $1", [third.run]);
    expect(item.agreed).toBe(true);
    expect([...item.override].sort()).toEqual(all);
    // saying they agreed does not record a consent they never gave
    expect(
      (await one("select count(*)::int n from public.consents where person_id = $1 and purpose = 'matching' and granted", [noc.id])).n,
    ).toBe(0);
    await started(-30);
  });

  it("is for the owner only, and only when Placement is On", async () => {
    const w = await world(1);
    const m = w.mem[0].id;
    await expect(asUser(db, m, "placement_one_place", m, w.C.tribe, [], null, false)).rejects.toThrow();
    await expect(asUser(db, m, "placement_one_check", m, w.C.tribe)).rejects.toThrow();
    await expect(asUser(db, m, "placement_one_options", m)).rejects.toThrow();
    await o.call("placement_settings_save", JSON.stringify({ mode: "rehearsal" }));
    await expect(o.call("placement_one_place", m, w.C.tribe, [], null, false)).rejects.toThrow(/switched On/);
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    const list = await o.call("placement_one_options", m);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ tribe: w.C.tribe, active: 0, below_floor: false });
    expect(list[0].degree).toBeGreaterThanOrEqual(60);
  });
});
