import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEvent, clearLogs, makeEveryoneOld, makeOwner, makeYoung, sqlOf, type OwnerKit } from "./activity-kit";
import { newKit, type Kit, type Person } from "./builders";
import { expectCode, type TestDb } from "./helpers";

// Phase 5: the dashboard's numbers, checked against data counted by hand. Each describe plants a small, known set of
// people and events in its own database, rebuilds the summaries, and checks what the owner's functions say.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function setup(): Promise<{ db: TestDb; k: Kit; ok: OwnerKit; sql: ReturnType<typeof sqlOf>; S: string }> {
  const { db, k } = await newKit();
  const sql = sqlOf(db);
  const S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id as string;
  return { db, k, ok: await makeOwner(db), sql, S };
}

const people = async (k: Kit, label: string, n: number) => {
  const out: Person[] = [];
  for (let i = 0; i < n; i++) out.push(await k.person(`${label}${i}`));
  return out;
};
const ids = (list: Person[]) => list.map((p) => p.id);
const refresh = (sql: ReturnType<typeof sqlOf>) => sql("select public.activity_refresh(now(), true)");

// ---------------------------------------------------------------------------------------------------------------------

describe("the Pulse tab", () => {
  let db: TestDb;
  let k: Kit;
  let ok: OwnerKit;
  let sql: ReturnType<typeof sqlOf>;
  let S: string;
  let members: Person[];
  let leaders: Person[];
  let young: Person[];
  let waiting: Person[];

  beforeAll(async () => {
    ({ db, k, ok, sql, S } = await setup());
    await sql("update public.seasons set status = 'running' where id = $1", [S]);
    members = await people(k, "Member", 12);
    leaders = [await k.staff("Lead0", "leader"), await k.staff("Lead1", "leader"), await k.staff("Lead2", "leader")];
    young = await people(k, "Young", 2);
    for (const y of young) await makeYoung(db, k, y.id, S);
    waiting = await people(k, "Waiting", 3);
    for (const w of waiting) await k.profile(w.id, S);
    const seated = await k.tribe(S, { name: "Quiet Tribe" });
    const quiet = await k.seat(seated.tribe, S, "Quiet");

    await makeEveryoneOld(db);
    // Waiting for a tribe a long time (100 days), in a running season, with no place.
    await sql("update public.member_profiles set submitted_at = now() - interval '100 days' where person_id = any($1)", [ids(waiting)]);
    // Setup wrote its own events (a changed profile counts as a change); start the count from nothing.
    await clearLogs(db);
    void quiet;

    // Who was active when (a visit each):
    //   today: members 0-5.  yesterday: members 0-2 and both young.  two days ago: the three leaders.  three days ago: members 6-7.
    //   8 days ago: member 8.  10 days ago: member 9.  20 days ago: member 10.  40 days ago: member 11.
    const plan: [Person[], number][] = [
      [members.slice(0, 6), 0], [members.slice(0, 3), 1], [young, 1], [leaders, 2], [members.slice(6, 8), 3],
      [[members[8]], 8], [[members[9]], 10], [[members[10]], 20], [[members[11]], 40],
    ];
    for (const [who, day] of plan) for (const p of who) await addEvent(db, p.id, "visit", day, { device: "phone" });
    await refresh(sql);
  });
  afterAll(async () => {
    await db?.close();
  });

  it("counts who was active today, in 7 and 30 days, and the periods before, exactly", async () => {
    const r = (await ok.call("activity_pulse")) as Json;
    expect(r.active).toEqual({ today: 6, d7: 13, p7: 2, d30: 16, p30: 1 });
  });

  it("counts each group, and reads a group under 5 as '<5' while still counting it in the total", async () => {
    const r = (await ok.call("activity_pulse")) as Json;
    expect(r.groups.member).toEqual({ d7: 8, d30: 11 });
    expect(r.groups.leader).toEqual({ d7: "<5", d30: "<5" });
    expect(r.groups.young).toEqual({ d7: "<5", d30: "<5" });
    expect(Object.keys(r.groups).sort()).toEqual(["leader", "member", "young"]);
    // Young members are in the total of 13: 8 members + 3 leaders + 2 young.
    expect(r.active.d7).toBe(8 + 3 + 2);
  });

  it("draws a thirty-day trend with the period before beside it", async () => {
    const r = (await ok.call("activity_pulse")) as Json;
    const now = r.trend.series.active.now as number[];
    expect(r.trend.days).toHaveLength(30);
    expect(now).toHaveLength(30);
    expect(r.trend.series.active.prev).toHaveLength(30);
    expect([now[29], now[28], now[27], now[26], now[25]]).toEqual([6, 5, 3, 2, 0]);
    // 20 days ago is member 10; 8 and 10 days ago are in the same 30-day window.
    expect(now[29 - 20]).toBe(1);
    expect(now[29 - 8]).toBe(1);
    expect(now[29 - 10]).toBe(1);
    // 40 days ago falls in the previous period, at index 29 - (40 - 30).
    expect((r.trend.series.active.prev as number[])[29 - 10]).toBe(1);
  });

  it("counts visits, and the tiles carry the change since the last period", async () => {
    const r = (await ok.call("activity_pulse")) as Json;
    expect(r.metrics.visits).toEqual({ today: 6, d7: 16, p7: 2, d30: 19, p30: 1 });
  });

  it("raises a decision only when a count passes the threshold the owner set, and drops it when the owner changes it", async () => {
    let r = (await ok.call("activity_pulse")) as Json;
    const wait = r.decisions.find((d: Json) => d.key === "member_wait_days");
    // The three adults and the two young members all have a profile and no place; the count includes everyone.
    expect(wait).toMatchObject({ value: 5, threshold: 14, unit: "days", href: "/god/people" });
    expect(wait.label).toBe("Members waiting more than 14 days for a tribe");
    expect(wait.action).toMatch(/people list/i);
    const quietTribe = r.decisions.find((d: Json) => d.key === "quiet_days");
    expect(quietTribe).toMatchObject({ value: 1, threshold: 21 });
    expect(r.decisions.find((d: Json) => d.key === "failed_messages_7d")).toBeUndefined();

    // Four failed messages is under the line of five; the fifth crosses it.
    for (let i = 0; i < 4; i++) await sql("insert into public.messages (person_id, template, status, error) values ($1, 'welcome', 'failed', 'x')", [members[0].id]);
    r = (await ok.call("activity_pulse")) as Json;
    expect(r.decisions.find((d: Json) => d.key === "failed_messages_7d")).toBeUndefined();
    await sql("insert into public.messages (person_id, template, status, error) values ($1, 'welcome', 'failed', 'x')", [members[0].id]);
    r = (await ok.call("activity_pulse")) as Json;
    expect(r.decisions.find((d: Json) => d.key === "failed_messages_7d")).toMatchObject({ value: 5, href: "/admin/messages" });

    // The longest wait is 200 days (the young members'), which is under a threshold of 250.
    await ok.call("activity_threshold_set", "member_wait_days", 250);
    r = (await ok.call("activity_pulse")) as Json;
    expect(r.decisions.find((d: Json) => d.key === "member_wait_days")).toBeUndefined();
    await ok.call("activity_threshold_set", "member_wait_days", 14);
  });

  it("makes a weekly brief of the last whole week from counts alone", async () => {
    const b = (await ok.call("activity_brief")) as Json;
    const start = new Date(`${b.week_start}T00:00:00Z`);
    const end = new Date(`${b.week_end}T00:00:00Z`);
    expect(start.getUTCDay()).toBe(1);
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(6);
    expect(typeof b.active.now).toBe("number");
    expect(typeof b.active.prev).toBe("number");
    expect(b.decisions.length).toBeLessThanOrEqual(3);
    // Counts only: no names, no wording.
    expect(JSON.stringify(b)).not.toMatch(/Member0|Test/);
  });

  it("shows when people are active, counted exactly, with small cells and small groups hidden", async () => {
    const h = (await ok.call("activity_heatmap", 28)) as Json;
    expect(h.cells.every((c: Json) => c.hour === 12)).toBe(true);
    expect(h.cells.some((c: Json) => c.people === "<5")).toBe(true);
    expect(h.cells.some((c: Json) => typeof c.people === "number" && c.people >= 5)).toBe(true);
    // Only the group with at least 5 different people in the window is shown; its 14 visits are all at noon.
    expect(Object.keys(h.groups)).toEqual(["member"]);
    expect(h.groups.member).toHaveLength(24);
    expect(h.groups.member[12]).toBe(14);
    expect(h.groups.member.reduce((a: number, b: number) => a + b, 0)).toBe(14);
  });

  it("has a retention grid that hides what is small", async () => {
    const g = (await ok.call("activity_retention", 12)) as Json;
    expect(g.weeks).toHaveLength(12);
    for (const w of g.weeks) {
      expect(w.size).toBe(0);
      // A week nobody joined has nothing to show, which is not the same as a small group.
      expect(w.cells.every((c: unknown) => c === null)).toBe(true);
    }
  });

  it("rebuilds the same numbers however many times the refresh runs", async () => {
    const before = (await ok.call("activity_pulse")) as Json;
    await sql("select public.activity_refresh(now(), false)");
    await sql("select public.activity_refresh(now(), false)");
    await refresh(sql);
    const after = (await ok.call("activity_pulse")) as Json;
    expect(after.active).toEqual(before.active);
    expect(after.groups).toEqual(before.groups);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the Funnels tab", () => {
  let db: TestDb;
  let k: Kit;
  let ok: OwnerKit;
  let sql: ReturnType<typeof sqlOf>;
  let S: string;
  let never: Person[];
  let drafted: Person[];
  let submitted: Person[];
  let matched: Person[];
  let accepted: Person[];
  let wk1: Person[];
  let wk4: Person[];
  let young: Person[];
  let island: Person;
  let tribeId: string;

  beforeAll(async () => {
    ({ db, k, ok, sql, S } = await setup());
    const t = await k.tribe(S, { name: "Funnel Tribe" });
    tribeId = t.tribe;
    never = await people(k, "Never", 4);
    drafted = await people(k, "Draft", 3);
    submitted = await people(k, "Sub", 5);
    matched = await people(k, "Match", 3);
    accepted = await people(k, "Acc", 2);
    wk1 = await people(k, "Wk1", 2);
    wk4 = await people(k, "Wk4", 1);
    young = await people(k, "Young", 2);
    island = await k.person("Island");

    for (const p of drafted) await sql("insert into public.intake_drafts (person_id, step) values ($1, 'story')", [p.id]);
    for (const p of [...submitted, ...matched, ...accepted, ...wk1, ...wk4]) await k.profile(p.id, S);
    for (const y of young) await makeYoung(db, k, y.id, S);
    await k.profile(island.id, S);
    await sql("update public.member_profiles set zone = 'island-lekki' where person_id = $1", [island.id]);
    for (const p of [...accepted, ...wk1, ...wk4]) {
      await sql(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
        [tribeId, p.id, S],
      );
    }
    await k.meetings(tribeId, t.leader.id, 5, [[wk1[0].id, 2], [wk1[1].id, 2], [wk4[0].id, 5]]);

    await makeEveryoneOld(db);
    // The cohort registered ten days ago. Saved 26 hours later (or 2 hours, for those who only kept a draft), matched 3
    // hours after submitting (or placed 5 hours after, for those who chose a tribe), agreed an hour after that.
    const cohort = [...never, ...drafted, ...submitted, ...matched, ...accepted, ...wk1, ...wk4, ...young];
    await sql("update public.people set created_at = now() - interval '10 days' where id = any($1)", [ids(cohort)]);
    await sql("update public.member_profiles m set submitted_at = p.created_at + interval '26 hours' from public.people p where p.id = m.person_id and m.person_id = any($1)", [ids(cohort)]);
    await sql("update public.intake_drafts d set started_at = p.created_at + interval '2 hours' from public.people p where p.id = d.person_id");
    const version = (await sql("select version from public.match_models limit 1"))[0].version;
    for (const p of matched) {
      await sql(
        "insert into public.match_runs (person_id, season_id, model_version, ran_at, candidates, shown) values ($1, $2, $3, (select submitted_at + interval '3 hours' from public.member_profiles where person_id = $1), 5, 3)",
        [p.id, S, version],
      );
    }
    await sql(
      `update public.tribe_members tm set joined_at = m.submitted_at + interval '5 hours', agreed_at = m.submitted_at + interval '6 hours'
         from public.member_profiles m where m.person_id = tm.person_id and tm.person_id = any($1)`,
      [ids([...accepted, ...wk1, ...wk4])],
    );
    await refresh(sql);
  });
  afterAll(async () => {
    await db?.close();
  });

  const stage = (r: Json, key: string) => r.stages.find((s: Json) => s.key === key);

  it("counts how far each person got, in order, and reads any bar under 5 as '<5'", async () => {
    const r = (await ok.call("activity_funnels", "member", null, null, null)) as Json;
    expect(r.total).toBe(22);
    expect(r.stages.map((s: Json) => s.key)).toEqual(["registered", "form_saved", "submitted", "matched", "accepted", "week1", "week4", "week12"]);
    expect(r.stages.map((s: Json) => s.reached)).toEqual([22, 18, 15, 8, 5, "<5", "<5", 0]);
    // Who stopped at each step: 4 never began, 3 left a draft, 5 adults and 2 young members submitted and waited, ...
    expect(r.stages.map((s: Json) => s.stopped)).toEqual(["<5", "<5", 7, "<5", "<5", "<5", "<5", 0]);
  });

  it("works out the drop-off, and gives no percentage for a bar that is hidden", async () => {
    const r = (await ok.call("activity_funnels", "member", null, null, null)) as Json;
    expect(stage(r, "registered").pct_start).toBe(100);
    expect(stage(r, "form_saved").pct_start).toBeCloseTo(81.8, 1);
    expect(stage(r, "submitted").pct_prev).toBeCloseTo(83.3, 1);
    expect(stage(r, "accepted").pct_prev).toBeCloseTo(62.5, 1);
    expect(stage(r, "week1").pct_start).toBeNull();
    expect(stage(r, "week1").pct_prev).toBeNull();
    expect(stage(r, "week4").pct_start).toBeNull();
  });

  it("gives the median time between steps", async () => {
    const r = (await ok.call("activity_funnels", "member", null, null, null)) as Json;
    expect(stage(r, "registered").median_hours).toBeNull();
    expect(Number(stage(r, "form_saved").median_hours)).toBeCloseTo(26, 1);
    expect(Number(stage(r, "submitted").median_hours)).toBeCloseTo(0, 1);
    expect(Number(stage(r, "matched").median_hours)).toBeCloseTo(5, 1);
    expect(Number(stage(r, "accepted").median_hours)).toBeCloseTo(1, 1);
  });

  it("splits by zone, hiding the cells of a small group", async () => {
    const r = (await ok.call("activity_funnels", "member", null, null, "zone")) as Json;
    const mainland = r.split.find((g: Json) => g.value === "mainland");
    expect(mainland.total).toBe(15);
    expect(mainland.reached).toEqual([15, 15, 15, 8, 5, "<5", "<5", 0]);
    const notGiven = r.split.find((g: Json) => g.value === "Not given");
    expect(notGiven.total).toBe(7);
    expect(notGiven.reached).toEqual([7, "<5", 0, 0, 0, 0, 0, 0]);
    // The island member registered long ago, so is not in this cohort; widen it and the group is one person, hidden.
    expect(r.split.find((g: Json) => g.value === "island-lekki")).toBeUndefined();
    const wide = (await ok.call("activity_funnels", "member", "2000-01-01", null, "zone")) as Json;
    expect(wide.split.find((g: Json) => g.value === "island-lekki").total).toBe("<5");
    expect(wide.split.find((g: Json) => g.value === "island-lekki").reached.every((c: unknown) => c === "<5" || c === 0)).toBe(true);
  });

  it("splits by community and by season", async () => {
    const c = (await ok.call("activity_funnels", "member", null, null, "community")) as Json;
    expect(c.split.map((g: Json) => g.value)).toContain("Not given");
    const s = (await ok.call("activity_funnels", "member", null, null, "season")) as Json;
    expect(s.split.reduce((n: number, g: Json) => n + (typeof g.total === "number" ? g.total : 0), 0)).toBeGreaterThan(0);
  });

  it("gives the spread of time to finish, with the slowest quarter, and hides small bins", async () => {
    await sql("update public.member_profiles set duration_seconds = 180 where person_id = any($1)", [ids(submitted)]);
    await sql("update public.member_profiles set duration_seconds = 600 where person_id = any($1)", [ids(matched)]);
    await sql("update public.member_profiles set duration_seconds = 900 where person_id = any($1)", [ids(accepted)]);
    const r = (await ok.call("activity_funnels", "member", null, null, null)) as Json;
    expect(r.finish.n).toBeGreaterThanOrEqual(10);
    expect(r.finish.p50).not.toBeNull();
    expect(r.finish.p75).toBeGreaterThanOrEqual(r.finish.p50);
    const bins = Object.fromEntries(r.finish.bins.map((b: Json) => [b.label, b.n]));
    expect(bins["2 to 4 min"]).toBe(5);
    expect(bins["8 to 12 min"]).toBe("<5");
    expect(bins["12 min or more"]).toBe("<5");
  });

  it("names the people behind a bar, but never a young member, and nobody behind a bar of fewer than 5", async () => {
    const wait = (await ok.call("activity_funnel_people", "member", 3, "stopped", null, null, 50)) as Json;
    expect(wait.total).toBe(7);
    expect(wait.young).toBe("<5");
    expect(wait.hidden).toBe(false);
    expect(wait.people).toHaveLength(5);
    const named = wait.people.map((p: Json) => p.id);
    for (const y of young) expect(named).not.toContain(y.id);
    for (const p of submitted) expect(named).toContain(p.id);
    expect(wait.people.every((p: Json) => p.group !== "young")).toBe(true);

    const small = (await ok.call("activity_funnel_people", "member", 4, "stopped", null, null, 50)) as Json;
    expect(small).toMatchObject({ total: "<5", hidden: true, people: [] });
    // "Reached" counts everyone at least that far.
    const reached = (await ok.call("activity_funnel_people", "member", 4, "reached", null, null, 50)) as Json;
    expect(reached.total).toBe(8);
    expect(reached.people).toHaveLength(8);
  });

  it("refuses a bar or a split that is not one", async () => {
    await expectCode(ok.run((q) => q("select public.activity_funnels('everyone')")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_funnels('leader', null, null, 'zone')")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_funnels('member', null, null, 'name')")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_funnels('member', '2026-10-10', '2026-10-01', null)")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_funnel_people('member', 0)")), "22023");
    await expectCode(ok.run((q) => q("select public.activity_funnel_people('member', 3, 'sideways')")), "22023");
  });

  it("follows the leader application: started, each step, submitted, and on", async () => {
    const apps = await people(k, "Applicant", 6);
    const make = (p: Person, status: string, step: string, submitted: boolean) =>
      sql(
        `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, created_at)
         values ($1, $2, $3, '{}'::jsonb, 'test', ${submitted ? "now() - interval '9 days'" : "null"}, now() - interval '10 days')`,
        [p.id, status, step],
      );
    await make(apps[0], "draft", "eligibility", false);
    await make(apps[1], "draft", "eligibility", false);
    await make(apps[2], "draft", "why", false);
    await make(apps[3], "submitted", "review", true);
    await make(apps[4], "approved_leader", "review", true);
    await make(apps[5], "ineligible", "eligibility", false);
    await refresh(sql);
    const r = (await ok.call("activity_funnels", "leader", null, null, null)) as Json;
    expect(r.stages).toHaveLength(28);
    expect(r.stages[0]).toMatchObject({ k: 1, key: "started", reached: 6 });
    expect(r.stages[1]).toMatchObject({ key: "step_eligibility", reached: 6 });
    expect(r.stages[7].key).toBe("step_why");
    expect(r.stages[7].reached).toBe("<5");
    expect(r.stages.map((s: Json) => s.k)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    expect(r.stages[22]).toMatchObject({ key: "submitted", reached: "<5" });
    expect(r.stages[27].key).toBe("leading");
    expect(r.finish).toBeNull();
    expect(r.split).toBeNull();
  });

  it("compares zones: a group of fewer than 5 shows no percentages", async () => {
    const r = (await ok.call("activity_compare", "zone")) as Json;
    const mainland = r.rows.find((x: Json) => x.label === "mainland");
    expect(mainland).toMatchObject({ members: 15, submitted_pct: 100 });
    expect(mainland.placed_pct).toBeCloseTo(33.3, 1);
    expect(mainland.active_pct).toBe(100);
    expect(r.rows.find((x: Json) => x.label === "island-lekki")).toEqual({ label: "island-lekki", members: "<5", submitted_pct: null, placed_pct: null, active_pct: null });
    await expectCode(ok.run((q) => q("select public.activity_compare('name')")), "22023");
  });

  it("compares tribes: members, how many were active, and attendance", async () => {
    const r = (await ok.call("activity_compare", "tribe")) as Json;
    const row = r.rows.find((x: Json) => x.label === "Funnel Tribe");
    expect(row.members).toBe(5);
    expect(row.active_pct).toBe(100);
    // 9 of the 15 attendance marks are 'present'.
    expect(row.attendance_pct).toBeCloseTo(60, 1);
  });

  it("builds a retention grid by start week, starting at everyone in the first week", async () => {
    const g = (await ok.call("activity_retention", 12)) as Json;
    const row = g.weeks.find((w: Json) => typeof w.size === "number" && w.size >= 5);
    expect(row).toBeTruthy();
    expect(row.cells[0]).toBe(100);
    expect(row.cells.length).toBeGreaterThanOrEqual(2);
    // The size counts the whole start week, including the young members.
    const size = Number((await sql("select count(*) as n from public.activity_people where joined_day >= $1::date and joined_day < $1::date + 7 and grp <> 'pastoral'", [row.start]))[0].n);
    expect(row.size).toBe(size);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("the Audit trail, Stakeholders, Quality and integrity, and Messages tabs", () => {
  let db: TestDb;
  let k: Kit;
  let ok: OwnerKit;
  let sql: ReturnType<typeof sqlOf>;
  let S: string;
  let admin: Person;
  let careLead: Person;
  let pastor: Person;
  let member: Person;
  let youngster: Person;

  const note = (actor: string | null, action: string, entity = "person", entityId = "x", meta: Json = {}) =>
    sql("select public.write_event($1, $2, $3, $4, $5::jsonb)", [actor, action, entity, entityId, JSON.stringify(meta)]);

  beforeAll(async () => {
    ({ db, k, ok, sql, S } = await setup());
    admin = await k.staff("Adaeze", "admin");
    careLead = await k.staff("Careful", "care_lead");
    pastor = await k.staff("Pastor", "pastor");
    member = await k.person("Ngozi");
    youngster = await k.person("Young");
    await makeYoung(db, k, youngster.id, S);
    await makeEveryoneOld(db);
    await clearLogs(db);
    for (let i = 0; i < 3; i++) await note(admin.id, "role.granted", "person", `adm${i}`, { note: "wording that must not show" });
    for (let i = 0; i < 2; i++) await note(careLead.id, "care.call", "person", `care${i}`);
    await note(pastor.id, "leader.decided", "application", "app00001");
    await note(member.id, "testimony.submitted", "testimony", "t1", { body: "A private testimony" });
    await note(youngster.id, "testimony.submitted", "testimony", "t2");
    await note(null, "retention.ran", "platform", "retention");
    await note(ok.owner.id, "care.call", "person", "ownerrecord");
    await refresh(sql);
  });
  afterAll(async () => {
    await db?.close();
  });

  const audit = (...args: unknown[]) => ok.call("activity_audit", ...args) as Promise<Json>;

  it("lists when, who by role, what and which record, filtered by stakeholder, kind of action, person and dates", async () => {
    const all = await audit(null, null, null, null, null, null, 100);
    expect(all.rows).toHaveLength(10);
    expect(all.next_before).toBeNull();
    expect((await audit("team", null, null, null, null, null, 100)).rows).toHaveLength(5);
    expect((await audit("pastoral", null, null, null, null, null, 100)).rows.map((r: Json) => r.action)).toEqual(["leader.decided"]);
    expect((await audit("member", null, null, null, null, null, 100)).rows.map((r: Json) => r.action)).toEqual(["testimony.submitted"]);
    expect((await audit("system", null, null, null, null, null, 100)).rows.map((r: Json) => r.action)).toEqual(["retention.ran"]);

    const care = await audit(null, "care", null, null, null, null, 100);
    expect(care.rows.map((r: Json) => r.who).sort()).toEqual(["Careful Test", "Careful Test", "You"]);
    expect(care.rows.every((r: Json) => r.area === "Care")).toBe(true);

    const mine = await audit(null, null, admin.id, null, null, null, 100);
    expect(mine.rows).toHaveLength(3);
    expect(mine.rows.every((r: Json) => r.who === "Adaeze Test" && r.group === "team" && r.person_id === admin.id)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect((await audit(null, null, null, today, today, null, 100)).rows.length).toBeGreaterThan(0);
    expect((await audit(null, null, null, "2000-01-01", "2000-01-02", null, 100)).rows).toHaveLength(0);
    expect(Object.keys(await audit(null, null, null, null, null, null, 1)).sort()).toEqual(["next_before", "rows", "young_hidden"]);
  });

  it("pages back through the list without repeating a row", async () => {
    const first = await audit(null, null, null, null, null, null, 4);
    expect(first.rows).toHaveLength(4);
    expect(first.next_before).not.toBeNull();
    const second = await audit(null, null, null, null, null, first.next_before, 4);
    const third = await audit(null, null, null, null, null, second.next_before, 4);
    const seen = [...first.rows, ...second.rows, ...third.rows].map((r: Json) => `${r.at}|${r.action}|${r.ref}`);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(10);
  });

  it("never shows what someone wrote, and shows the owner's own actions only as 'You'", async () => {
    const all = await audit(null, null, null, null, null, null, 100);
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/wording that must not show|private testimony/i);
    for (const row of all.rows) expect(Object.keys(row).sort()).toEqual(["action", "area", "at", "entity", "group", "person_id", "ref", "who"]);
    const you = all.rows.filter((r: Json) => r.who === "You");
    expect(you).toHaveLength(1);
    expect(you[0]).toMatchObject({ action: "care.call", group: "you", person_id: null });
    expect(all.rows.filter((r: Json) => r.who === "The system")).toHaveLength(1);
    expect(all.rows.some((r: Json) => r.who === "The Owner" || r.who === "Owner")).toBe(false);
  });

  it("counts a young member in the totals but never names them or lets anyone filter to them", async () => {
    const all = await audit(null, null, null, null, null, null, 100);
    const rows = all.rows.filter((r: Json) => r.group === "young");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ who: "Young member", person_id: null, action: "testimony.submitted", ref: null });
    expect(JSON.stringify(all)).not.toContain("Young Test");
    expect(JSON.stringify(all)).not.toContain(youngster.id);
    expect((await audit("young", null, null, null, null, null, 100)).rows).toHaveLength(1);
    expect(await audit(null, null, youngster.id, null, null, null, 100)).toEqual({ rows: [], next_before: null, young_hidden: true });
  });

  it("lists the kinds of action to filter by", async () => {
    const areas = (await ok.call("activity_audit_areas")) as { prefix: string; label: string }[];
    expect(areas).toContainEqual({ prefix: "care", label: "Care" });
    expect(areas).toContainEqual({ prefix: "leader", label: "Leader applications" });
    expect(areas.map((a) => a.prefix)).toContain("testimony");
  });

  it("shows what each stakeholder group is doing, in one panel each", async () => {
    const r = (await ok.call("activity_stakeholders")) as Json;
    expect(r.panels.map((p: Json) => p.id)).toEqual(["members", "applicants", "referees", "leaders", "team", "pastoral", "platform"]);
    for (const p of r.panels) {
      expect(p.title).toBeTruthy();
      expect(p.informs).toBeTruthy();
      expect(p.metrics.length).toBeGreaterThan(2);
      for (const m of p.metrics) expect(Object.keys(m).sort()).toEqual(["key", "label", "note", "prev", "unit", "value"]);
    }
    const team = r.panels.find((p: Json) => p.id === "team");
    expect(team.metrics.find((m: Json) => m.key === "actions").value).toBe(5);
    expect(team.people).toEqual([
      { id: admin.id, name: "Adaeze Test", actions: 3 },
      { id: careLead.id, name: "Careful Test", actions: 2 },
    ]);
    const pastoral = r.panels.find((p: Json) => p.id === "pastoral");
    expect(pastoral.metrics.find((m: Json) => m.key === "decisions").value).toBe(1);
  });

  it("reads the platform's own health", async () => {
    const link = (outcome: string, counted = true) =>
      sql("insert into public.signin_attempts (outcome, counted, flow, route, decided_at) values ($1, $2, 'sign_in', 'official', now() + interval '3 seconds')", [outcome, counted]);
    for (let i = 0; i < 18; i++) await link("delivered");
    for (let i = 0; i < 2; i++) await link("failed");
    for (let i = 0; i < 2; i++) await link("declined_wait", false);
    for (const [ch, st, n] of [["whatsapp", "delivered", 18], ["email", "sent", 3], ["email", "failed", 2]] as [string, string, number][]) {
      for (let i = 0; i < n; i++) await sql("insert into public.messages (person_id, template, status, channel) values ($1, 'welcome', $2, $3)", [member.id, st, ch]);
    }
    const r = (await ok.call("activity_stakeholders")) as Json;
    const platform = r.panels.find((p: Json) => p.id === "platform");
    const m = (key: string) => platform.metrics.find((x: Json) => x.key === key).value;
    expect(m("signin_success")).toBe(90);
    expect(m("messages_failed")).toBe(2);
    expect(m("message_delivery")).toBeCloseTo(91.3, 1);
    expect(m("slow_screens")).toBeNull();

    const msgs = (await ok.call("activity_messages")) as Json;
    expect(msgs.channels.find((c: Json) => c.channel === "whatsapp")).toMatchObject({ delivered: 18, failed: 0, total: 18 });
    expect(msgs.channels.find((c: Json) => c.channel === "email")).toMatchObject({ sent: 3, failed: 2, total: 5 });
    expect(msgs.codes).toMatchObject({ asked: 22, sent: 18, failed: 2, declined: 2 });
    expect(Number(msgs.codes.median_send_seconds)).toBeGreaterThanOrEqual(2);
    expect(msgs.code_days).toHaveLength(14);
    expect(msgs.code_days[13]).toMatchObject({ asked: 22, sent: 18, failed: 2 });
    expect(msgs.breaker.state).toBeTruthy();

    const integrity = (await ok.call("activity_integrity")) as Json;
    expect(integrity.signins.declined_7d).toEqual({ declined_wait: 2 });
    expect(integrity.signins.failed_or_rejected_7d).toBe(2);
  });

  it("flags answers caught by the checks, referee flags and call-backs, and lists cases without names", async () => {
    const applicant = await k.person("Applicant");
    const app = (await sql("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'why', '{}'::jsonb, 'test') returning id", [applicant.id]))[0].id as string;
    const check = (field: string, passes: boolean, forced: boolean) =>
      sql(
        `insert into public.leader_answer_checks (application_id, field, text_hash, words, attempt, instant_ok, relevance, forced, passes)
         values ($1, $2, md5(random()::text) || md5(random()::text), 10, 1, $3, 'skipped', $4, $3)`,
        [app, field, passes, forced],
      );
    await check("why", false, false);
    await check("why", false, false);
    await check("walked", false, true);
    await check("obstacles", true, false);
    await db.asUser(applicant.id, (q) => q("select public.set_referee($1, 1, 'Pastor Ife', 'Unit head', 'ife@example.org', true)", [app]));
    const ref = (await sql("select id from public.leader_references where application_id = $1", [app]))[0].id as string;
    await sql("insert into public.leader_reference_flags (reference_id, kind, severity) values ($1, 'same_browser', 'hold')", [ref]);
    await sql("insert into public.referee_callbacks (reference_id, reason, status, due_on) values ($1, 'flagged', 'open', public.today_lagos() - 2)", [ref]);

    const r = (await ok.call("activity_integrity")) as Json;
    expect(r.answer_checks).toMatchObject({ checked: 4, failed: 3, forced_through: 1 });
    expect(r.failing_fields[0]).toEqual({ field: "why", n: 2 });
    expect(r.referee_flags.same_browser).toEqual({ open: 1, last_30d: 1 });
    expect(r.callbacks).toMatchObject({ open: 1, overdue: 1 });
    const kinds = r.cases.map((c: Json) => c.kind).sort();
    expect(kinds).toEqual(["callback", "flag"]);
    for (const c of r.cases) {
      expect(Object.keys(c).sort()).toEqual(["at", "href", "kind", "label", "ref"]);
      expect(c.ref).toHaveLength(8);
    }
    expect(JSON.stringify(r)).not.toMatch(/Pastor Ife|ife@example|Applicant/);
  });
});
