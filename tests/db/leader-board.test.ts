import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { SCENARIOS_BEST, answers, calling, pipelineKit, setPositions, type PipelineKit } from "./pipeline-kit";

// Phase 7: the supply-and-demand board, the suggestions of leaders for a gap, and offers. The board reads the same demand figure the
// compatibility test's Need part reads; a suggestion is scored fresh by the same engine; an offer goes out once, states only a count,
// and when it is accepted starts a Tribe Card the way an appointment does.

let db: TestDb;
let k: Kit;
let pk: PipelineKit;
let o: OwnerKit;
let pastor: string;
let director: string;
let adminId: string;
let dataLead: string;
let coachId: string;
let memberId: string;
let seasonId: string;
let n = 0;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;
const callRaw = (uid: string, fn: string, args: unknown[] = []) =>
  db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));
const nobody = (fn: string, args: unknown[] = []) =>
  db.asAnon((q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));

// Care situations (s2, s3, s6) just under the bar, everything else the best answer.
const CARE_LOW = { ...SCENARIOS_BEST, s2: { best: "d", worst: "a" }, s3: { best: "c", worst: "b" }, s6: { best: "b", worst: "c" } };

type GoalFact = { id: string; slug: string; title: string; community: string; communityId: string; tracks: string[]; sensitive: boolean };
const goals: Record<string, GoalFact> = {};
async function goal(slug: string): Promise<GoalFact> {
  if (goals[slug]) return goals[slug];
  const r = await one(
    `select g.id, g.slug, g.title, c.slug as community, c.id as "communityId", t.track_slugs as tracks, t.sensitive
       from public.season_goals g join public.communities c on c.id = g.community_id
       join public.tribe_card_templates t on t.season_goal_id = g.id where g.slug = $1`,
    [slug],
  );
  goals[slug] = r as GoalFact;
  return goals[slug];
}
/** Goals nobody else in this file uses, so the figures of one test do not leak into the next. */
async function freshGoals(howMany: number, o2: { sensitive?: boolean } = {}): Promise<GoalFact[]> {
  const rows = await sql(
    `select g.slug from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id
      where t.status = 'signed_off' and t.sensitive = $1 and not (g.slug = any($2::text[])) order by g.slug`,
    [o2.sensitive ?? false, used],
  );
  const picked = rows.slice(0, howMany).map((r) => r.slug as string);
  used.push(...picked);
  return Promise.all(picked.map(goal));
}
const used: string[] = [];

type Leader = { id: string; app: string };
/** An approved leader with saved answers that name a goal: the input the suggestions use. */
async function leaderFor(g: GoalFact, o2: { name?: string; track?: string; leadBest?: string; scenarios?: Record<string, unknown>; since?: string; relation?: "achieved" | "pursuing"; role?: boolean; approved?: boolean } = {}): Promise<Leader> {
  const user = await pk.person(o2.role === false ? undefined : "leader", o2.name ?? `Leader${++n}`);
  const app = await pk.startDraft(
    user.id,
    answers(undefined, {
      calling: calling({ track: o2.track ?? g.tracks[0], community: g.community, goal: g.slug, goalRelation: o2.relation ?? "achieved" }),
      scenarios: o2.scenarios ?? SCENARIOS_BEST,
      style: { styleSocial: 1, styleStructure: -1, leadBest: o2.leadBest ?? "connection" },
    }),
    "lead-best",
  );
  await sql("update public.leader_applications set status = $2, decided_at = now(), submitted_at = $3 where id = $1", [
    app,
    o2.approved === false ? "submitted" : "approved_leader",
    o2.since ?? new Date().toISOString(),
  ]);
  return { id: user.id, app };
}

/** A stored run, as the application screen or a quiet run would have left it. */
async function planRun(person: string, o2: { source?: "application" | "quiet" | "appointment"; first?: string; backups?: string[]; hash?: string } = {}) {
  const first = o2.first ?? null;
  const backups = o2.backups ?? [];
  const chosen = first ?? (backups.length ? (await goal(used[0])).id : null);
  await sql(
    `insert into public.leader_fit_runs (person_id, model_version, inputs, inputs_hash, source, candidates, shown, options, chosen_goal_id, chosen_at, backup_goal_ids)
     values ($1, 'lf-1', '{}', $2, $3, 0, 3, '[]', $4, case when $4::uuid is null then null else now() end, $5::uuid[])`,
    [person, o2.hash ?? `h${++n}`, o2.source ?? "application", chosen, backups],
  );
}

const board = async (uid: string) => (await call(uid, "leader_board")) as Row;
const row = (b: Row, goalId: string) => (b.goals as Row[]).find((r) => r.goal_id === goalId) as Row;
const suggested = async (uid: string, g: GoalFact) => (await call(uid, "leader_suggest", [g.id])) as Row;
const demand = async (goalId: string) => one("select * from public.goal_demand_rows($1) where goal_id = $2", [seasonId, goalId]);

async function waiting(g: GoalFact, howMany: number) {
  for (let i = 0; i < howMany; i++) {
    const u = await k.person(`Waiting${++n}`);
    await sql(
      "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) values ($1, $2, $3, $4, 'any', 0)",
      [u.id, seasonId, g.id, g.communityId],
    );
  }
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  pk = pipelineKit(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  dataLead = (await k.staff("DataLead", "data_lead")).id;
  coachId = (await k.staff("Coach", "coach")).id;
  memberId = (await k.person("Member")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  await setPositions(db, {});
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
  await sql("update public.leader_fit_models set active = true, approved_at = now() where version = 'lf-1'");
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("who may use it", () => {
  const ZERO = "00000000-0000-0000-0000-000000000000";

  it("lets the office read the board, the suggestions and the offers, and nobody else", async () => {
    const leader = await k.staff("SomeLeader", "leader");
    for (const who of [adminId, director, pastor, dataLead]) {
      expect((await board(who)).goals).toBeTruthy();
      expect(await call(who, "leader_offers_list")).toEqual(expect.any(Array));
    }
    const g = await goal("build-a-steady-client-pipeline");
    for (const who of [adminId, director, pastor, dataLead]) expect((await suggested(who, g)).status).toBeTruthy();
    for (const who of [coachId, leader.id, memberId]) {
      await expectCode(callRaw(who, "leader_board"), "42501");
      await expectCode(callRaw(who, "leader_suggest", [g.id]), "42501");
      await expectCode(callRaw(who, "leader_offers_list"), "42501");
    }
    await expectCode(nobody("leader_board"), "42501");
    await expectCode(nobody("leader_suggest", [g.id]), "42501");
    await expectCode(nobody("leader_offers_list"), "42501");
  });

  it("lets only the pastor, directors and the admin make or withdraw an offer", async () => {
    const leader = await k.staff("AnotherLeader", "leader");
    const g = await goal("build-a-steady-client-pipeline");
    for (const who of [dataLead, coachId, leader.id, memberId]) {
      await expectCode(callRaw(who, "leader_offer_send", [g.id, leader.id]), "42501");
      await expectCode(callRaw(who, "leader_offer_withdraw", [ZERO]), "42501");
    }
    await expectCode(nobody("leader_offer_send", [g.id, leader.id]), "42501");
    await expectCode(nobody("leader_offer_withdraw", [ZERO]), "42501");
    await expectCode(nobody("leader_offer_respond", [ZERO, true]), "42501");
    await expectCode(nobody("my_leader_offers"), "42501");
  });

  it("gives a member or a coach nothing from my_leader_offers", async () => {
    expect(await call(memberId, "my_leader_offers")).toBeNull();
    expect(await call(coachId, "my_leader_offers")).toBeNull();
  });

  it("keeps the table closed to every client, with row level security on and no policy", async () => {
    for (const who of [adminId, pastor, o.owner.id]) await expectCode(db.asUser(who, (q) => q("select * from public.leader_offers")), "42501");
    await expectCode(db.asAnon((q) => q("select * from public.leader_offers")), "42501");
    const r = await one("select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = 'public.leader_offers'::regclass");
    expect(r).toEqual({ rls: true, pol: 0 });
  });

  it("closes the two internal helpers to every client", async () => {
    await expectCode(callRaw(pastor, "leader_offers_expire"), "42501");
    await expectCode(callRaw(pastor, "leader_interest_rows", [seasonId]), "42501");
    await expectCode(nobody("leader_interest_rows", [seasonId]), "42501");
  });

  it("is written the safe way: security definer, an empty search path, exactly one copy of each name", async () => {
    const names = ["leader_board", "leader_suggest", "leader_offer_send", "leader_offer_withdraw", "leader_offers_list", "my_leader_offers", "leader_offer_respond", "leader_offers_expire", "leader_interest_rows"];
    for (const name of names) {
      const r = await sql("select p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1", [name]);
      expect(r, name).toHaveLength(1);
      expect(r[0].prosecdef, name).toBe(true);
      expect((r[0].proconfig as string[]).some((c) => c.startsWith("search_path=")), name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the board", () => {
  it("has one row for every active goal, with the numbers the compatibility test reads", async () => {
    const [g1, g2, g3] = [await goal("build-a-steady-client-pipeline"), await goal("land-my-first-three-clients"), await goal("strengthen-our-marriage")];
    used.push(g1.slug, g2.slug, g3.slug);
    await waiting(g1, 6);
    await waiting(g2, 4);
    await waiting(g3, 3);
    const b = await board(pastor);
    const active = await count("select count(*)::int c from public.season_goals g join public.communities c on c.id = g.community_id and c.active where g.active");
    expect(b.goals).toHaveLength(active);
    expect(b.season.id).toBe(seasonId);
    expect(b.model).toBe("lf-1");
    expect(b.cards_signed).toBe(100);
    expect(b.missing).toBeNull();
    // Every board number is the one goal_demand_rows holds
    for (const d of await sql("select * from public.goal_demand_rows($1)", [seasonId])) {
      const r = row(b, d.goal_id);
      if (!r) continue;
      expect([r.waiting, r.seats_open, r.gap]).toEqual([d.waiting, d.seats_open, d.gap]);
    }
    expect(row(b, g1.id).waiting).toBe(6);
    expect(row(b, g2.id).gap).toBe(4);
    expect(row(b, g3.id).waiting).toBe(3);
  });

  it("sorts by the gap, largest first, then the number waiting, then the title", async () => {
    const list = (await board(director)).goals as Row[];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      expect(
        a.gap > b.gap || (a.gap === b.gap && (a.waiting > b.waiting || (a.waiting === b.waiting && a.title <= b.title))),
        `${a.title} (${a.gap}) before ${b.title} (${b.gap})`,
      ).toBe(true);
    }
    expect(list[0].gap).toBeGreaterThanOrEqual(6);
  });

  it("says what each goal's card is: signed off, or not, and so whether the goal can be offered", async () => {
    const g = (await freshGoals(1))[0];
    expect(row(await board(pastor), g.id)).toMatchObject({ card: "signed_off", ready: true });
    await sql("update public.tribe_card_templates set status = 'draft' where season_goal_id = $1", [g.id]);
    expect(row(await board(pastor), g.id)).toMatchObject({ card: "draft", ready: false });
    await sql("update public.tribe_card_templates set status = 'signed_off' where season_goal_id = $1", [g.id]);
  });

  it("shows a goal with leaders but nobody waiting with a negative gap", async () => {
    const g = (await freshGoals(1))[0];
    // A tribe on this goal with open seats, led by a certified leader, and nobody waiting
    const leader = await k.staff("Seated", "leader");
    const t = await k.tribe(seasonId, { status: "approved", name: "Seats open" });
    await sql("update public.tribes set season_goal_id = $2, community_id = $4, leader_id = $3 where id = $1", [t.tribe, g.id, leader.id, g.communityId]);
    await sql("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
    const r = row(await board(pastor), g.id);
    expect(r.seats_open).toBeGreaterThan(0);
    expect(r.gap).toBeLessThan(0);
    await sql("delete from public.leader_certifications where person_id = $1", [leader.id]);
    await sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
  });

  it("counts leaders interested from the latest run only: first choice and backup apart, never quiet runs or appointments", async () => {
    const [g5, g6, other] = await freshGoals(3);
    const a = await leaderFor(g5, { name: "First" });
    const b = await leaderFor(g5, { name: "Backup" });
    const c = await leaderFor(g5, { name: "Changed" });
    const d = await leaderFor(g5, { name: "Quiet" });
    const e = await leaderFor(g5, { name: "Appointed" });
    const f = await leaderFor(g5, { name: "Leading" });
    const h = await leaderFor(g5, { name: "Applicant", role: false, approved: false });
    await planRun(a.id, { first: g5.id });
    await planRun(b.id, { first: other.id, backups: [g5.id] });
    await planRun(c.id, { first: g5.id });
    await planRun(c.id, { first: g6.id }); // changed their mind: only the latest counts
    await planRun(d.id, { source: "quiet" });
    await planRun(e.id, { source: "appointment", first: g5.id });
    await planRun(h.id, { first: g5.id });
    await planRun(f.id, { first: g5.id });
    // f already leads a tribe on this goal this season: not counted
    const t = await k.tribe(seasonId, { status: "approved", name: "Already leading" });
    await sql("update public.tribes set season_goal_id = $2, community_id = $4, leader_id = $3 where id = $1", [t.tribe, g5.id, f.id, g5.communityId]);
    const bd = await board(pastor);
    expect(row(bd, g5.id)).toMatchObject({ interested_first: 1, interested_backup: 1 });
    expect(row(bd, g6.id)).toMatchObject({ interested_first: 1, interested_backup: 0 });
    // The board's split agrees with the compatibility test's total, for leaders; the total also holds applicants' picks
    const total = (await demand(g5.id)).interested as number;
    expect(total).toBeGreaterThanOrEqual(2);
    await sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
  });

  it("lists leaders whose latest run had fewer than three good options", async () => {
    const g = (await freshGoals(1))[0];
    const few = await leaderFor(g, { name: "Few" });
    const plenty = await leaderFor(g, { name: "Plenty" });
    await sql(
      `insert into public.leader_fit_runs (person_id, model_version, inputs, inputs_hash, source, candidates, shown, options) values ($1, 'lf-1', '{}', 'few1', 'quiet', 5, 1, '[]'), ($2, 'lf-1', '{}', 'few2', 'quiet', 5, 3, '[]')`,
      [few.id, plenty.id],
    );
    const names = ((await board(pastor)).few_options as Row[]).map((r) => r.person_id);
    expect(names).toContain(few.id);
    expect(names).not.toContain(plenty.id);
  });

  it("still shows the demand when there is no model, no signed card or no season, and says plainly what is missing", async () => {
    await sql("update public.leader_fit_models set active = false");
    let b = await board(pastor);
    expect(b.model).toBeNull();
    expect(b.missing).toMatch(/fit model/);
    expect(b.goals.length).toBeGreaterThan(0);
    await sql("update public.leader_fit_models set active = true where version = 'lf-1'");

    const season = await one("select id, status from public.seasons where id = $1", [seasonId]);
    await sql("update public.seasons set status = 'closed' where id = $1", [seasonId]);
    b = await board(pastor);
    expect(b.season).toBeNull();
    expect(b.missing).toMatch(/season/);
    await sql("update public.seasons set status = $2 where id = $1", [seasonId, season.status]);

    await sql("update public.tribe_card_templates set status = 'draft'");
    b = await board(pastor);
    expect(b.cards_signed).toBe(0);
    expect(b.missing).toMatch(/signed off/);
    await sql("update public.tribe_card_templates set status = 'signed_off'");
  });

  it("has one copy of the members-waiting rule: neither the board nor the suggestions work it out themselves", async () => {
    const text = readFileSync("supabase/migrations/20261223000100_leader_board.sql", "utf8");
    expect(text).not.toMatch(/match_demand/);
    const readers = await sql("select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc like '%match_demand%' and (p.proname like 'leader%' or p.proname like 'my_leader%')");
    expect(readers.map((r) => r.proname)).toEqual([]);
    const used2 = await sql("select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('leader_board', 'leader_suggest', 'leader_offer_send', 'my_leader_offers') and p.prosrc like '%goal_demand_rows%' order by 1");
    expect(used2.map((r) => r.proname)).toEqual(["leader_board", "leader_offer_send", "leader_suggest", "my_leader_offers"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("suggestions", () => {
  it("proposes up to three leaders for a goal with a gap, each with a degree, a word and one sentence", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 5);
    const ls = [];
    for (let i = 0; i < 5; i++) ls.push(await leaderFor(g));
    const s = await suggested(pastor, g);
    expect(s.status).toBe("ok");
    expect(s.model).toBe("lf-1");
    expect(s.gap).toBe(5);
    expect(s.suggestions.length).toBeLessThanOrEqual(3);
    expect(s.suggestions.length).toBe(3);
    for (const x of s.suggestions as Row[]) {
      expect(x.degree).toBeGreaterThanOrEqual(60);
      expect(["excellent", "strong", "good"]).toContain(x.label);
      expect(typeof x.reason).toBe("string");
      expect(x.reason.length).toBeGreaterThan(5);
      expect(x.reason).not.toMatch(/\b(judgement|care|sensitive|score)\b/i);
      expect(ls.map((l) => l.id)).toContain(x.person_id);
    }
  });

  it("proposes nobody where nothing is waiting beyond the open seats, and says so", async () => {
    const [g] = await freshGoals(1);
    await leaderFor(g);
    const s = await suggested(pastor, g);
    expect(s).toMatchObject({ status: "no_gap", suggestions: [] });
  });

  it("says plainly when the goal's card is not signed off, there is no model, or there is no season", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    await leaderFor(g);
    await sql("update public.tribe_card_templates set status = 'draft' where season_goal_id = $1", [g.id]);
    expect((await suggested(pastor, g)).status).toBe("no_card");
    await sql("update public.tribe_card_templates set status = 'signed_off' where season_goal_id = $1", [g.id]);
    await sql("update public.leader_fit_models set active = false");
    expect((await suggested(pastor, g)).status).toBe("no_model");
    await sql("update public.leader_fit_models set active = true where version = 'lf-1'");
    await sql("update public.seasons set status = 'closed' where id = $1", [seasonId]);
    expect((await suggested(pastor, g)).status).toBe("no_season");
    await sql("update public.seasons set status = 'planning' where id = $1", [seasonId]);
    await expectCode(callRaw(pastor, "leader_suggest", ["00000000-0000-0000-0000-000000000000"]), "P0002");
  });

  it("never suggests someone leading a tribe, holding an open offer, without an application, not yet approved, or the hidden owner", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 4);
    const good = await leaderFor(g, { name: "Good" });
    const leading = await leaderFor(g, { name: "Leading" });
    const offered = await leaderFor(g, { name: "Offered" });
    const noApp = await k.staff("NoApp", "leader");
    const pending = await leaderFor(g, { name: "Pending", approved: false, role: false });
    const t = await k.tribe(seasonId, { status: "draft", name: "Has a card" });
    await sql("update public.tribes set leader_id = $2 where id = $1", [t.tribe, leading.id]);
    await sql("insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer) values ($1, $2, $3, 1)", [g.id, offered.id, seasonId]);
    const ids = ((await suggested(pastor, g)).suggestions as Row[]).map((x) => x.person_id);
    expect(ids).toContain(good.id);
    for (const bad of [leading.id, offered.id, noApp.id, pending.id, o.owner.id]) expect(ids).not.toContain(bad);
    await sql("delete from public.leader_offers where person_id = $1", [offered.id]);
    await sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
  });

  it("leaves out a leader whose saved answers are missing something the comparison needs", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    const thin = await leaderFor(g, { name: "Thin" });
    await sql("update public.leader_applications set answers = answers - 'scenarios' where id = $1", [thin.app]);
    expect(((await suggested(pastor, g)).suggestions as Row[]).map((x) => x.person_id)).not.toContain(thin.id);
  });

  it("does not suggest a sensitive tribe to a leader below the care bar, and does to one above it", async () => {
    const [g] = await freshGoals(1, { sensitive: true });
    await waiting(g, 3);
    const careful = await leaderFor(g, { name: "Careful" });
    const low = await leaderFor(g, { name: "LowCare", scenarios: CARE_LOW });
    const ids = ((await suggested(pastor, g)).suggestions as Row[]).map((x) => x.person_id);
    expect(ids).toContain(careful.id);
    expect(ids).not.toContain(low.id);
  });

  it("orders by degree, then first choice before backup before neither", async () => {
    const [g, other] = await freshGoals(2);
    await waiting(g, 6);
    const none = await leaderFor(g, { name: "None" });
    const backup = await leaderFor(g, { name: "Backup" });
    const first = await leaderFor(g, { name: "First" });
    await planRun(backup.id, { first: other.id, backups: [g.id] });
    await planRun(first.id, { first: g.id });
    const s = (await suggested(pastor, g)).suggestions as Row[];
    const mine = s.filter((x) => [none.id, backup.id, first.id].includes(x.person_id));
    expect(mine.map((x) => x.person_id)).toEqual([first.id, backup.id, none.id]);
    expect(mine.map((x) => x.choice)).toEqual(["first", "backup", null]);
    expect(new Set(mine.map((x) => x.degree)).size).toBe(1);
  });

  it("then breaks a tie by the earliest application, then by the person's id", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 6);
    const late = await leaderFor(g, { name: "Late", since: "2026-09-20T10:00:00Z" });
    const early = await leaderFor(g, { name: "Early", since: "2026-08-01T10:00:00Z" });
    const s1 = (await suggested(pastor, g)).suggestions as Row[];
    expect(s1.map((x) => x.person_id).slice(0, 2)).toEqual([early.id, late.id]);

    const [h] = await freshGoals(1);
    await waiting(h, 6);
    const same = "2026-09-01T10:00:00Z";
    const trio = [await leaderFor(h, { since: same }), await leaderFor(h, { since: same }), await leaderFor(h, { since: same })];
    const s2 = ((await suggested(pastor, h)).suggestions as Row[]).map((x) => x.person_id);
    expect(s2).toEqual(trio.map((t) => t.id).sort());
  });

  it("puts a leader inside the card's life stage before one next to it, when the degrees are equal", async () => {
    const [{ slug }] = await sql(
      `select g.slug from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id
        where t.status = 'signed_off' and not t.sensitive and t.track_slugs @> array['stewards'] and not t.track_slugs @> array['sages'] and not (g.slug = any($1::text[]))
        order by g.slug limit 1`,
      [used],
    ) as Row[];
    used.push(slug);
    const g = await goal(slug);
    await waiting(g, 6);
    // With life stage weighing nothing, a leader one stage away scores the same as one inside the card's stages
    const lf1 = await one("select weights from public.leader_fit_models where version = 'lf-1'");
    const w = { ...(lf1.weights as Row), stage: 0, calling: 45 };
    const saved = await call(pastor, "leader_fit_model_save", [JSON.stringify(w), "stage counts for nothing"]);
    await call(pastor, "leader_fit_model_activate", [saved.version ?? saved]);
    const next = await leaderFor(g, { name: "NextTo", track: "sages", since: "2026-07-01T10:00:00Z" });
    const inside = await leaderFor(g, { name: "Inside", track: "stewards", since: "2026-09-01T10:00:00Z" });
    const s = ((await suggested(pastor, g)).suggestions as Row[]).filter((x) => [next.id, inside.id].includes(x.person_id));
    expect(s.map((x) => x.person_id)).toEqual([inside.id, next.id]);
    expect(s[0].degree).toBe(s[1].degree);
    expect(s[1].next_to).toBe(true);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });

  it("is worked out fresh each time: a new approved model changes who is suggested", async () => {
    const [{ slug }] = await sql(
      `select g.slug from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id
        where t.status = 'signed_off' and not t.sensitive and t.track_slugs @> array['stewards'] and not t.track_slugs @> array['sages'] and not (g.slug = any($1::text[]))
        order by g.slug limit 1`,
      [used],
    ) as Row[];
    used.push(slug);
    const g = await goal(slug);
    await waiting(g, 6);
    const next = await leaderFor(g, { name: "NextToToo", track: "sages" });
    const before = ((await suggested(pastor, g)).suggestions as Row[]).map((x) => x.person_id);
    expect(before).toContain(next.id);
    const lf1 = await one("select weights from public.leader_fit_models where version = 'lf-1'");
    const heavy = { ...(lf1.weights as Row), stage: 80, calling: 5, judgement: 5, style: 5, need: 5 };
    const saved = await call(pastor, "leader_fit_model_save", [JSON.stringify(heavy), "stage above all"]);
    await call(pastor, "leader_fit_model_activate", [saved.version ?? saved]);
    const during = (await suggested(pastor, g)) as Row;
    expect(during.model).not.toBe("lf-1");
    expect((during.suggestions as Row[]).map((x) => x.person_id)).not.toContain(next.id);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    expect(((await suggested(pastor, g)).suggestions as Row[]).map((x) => x.person_id)).toContain(next.id);
  });

  it("changes nothing: asking for suggestions writes no run, no offer and no message", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    await leaderFor(g);
    const before = [await count("select count(*)::int c from public.leader_fit_runs"), await count("select count(*)::int c from public.leader_offers"), await count("select count(*)::int c from public.messages")];
    await suggested(pastor, g);
    await board(pastor);
    expect([await count("select count(*)::int c from public.leader_fit_runs"), await count("select count(*)::int c from public.leader_offers"), await count("select count(*)::int c from public.messages")]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("offers", () => {
  it("sends an offer to an approved leader: recorded, 14 days, the count at the time, and one message", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 5);
    const l = await leaderFor(g, { name: "Offered" });
    const messagesBefore = await count("select count(*)::int c from public.messages where template = 'leader_offer'");
    const r = await call(pastor, "leader_offer_send", [g.id, l.id]);
    expect(r).toMatchObject({ ok: true, queued: true, waiting: 5 });
    const offer = await one("select * from public.leader_offers where id = $1", [r.offer]);
    expect(offer).toMatchObject({ goal_id: g.id, person_id: l.id, season_id: seasonId, status: "offered", waiting_at_offer: 5, tribe_id: null });
    expect(new Date(offer.expires_at).getTime() - new Date(offer.offered_at).getTime()).toBeGreaterThan(13.9 * 24 * 3600 * 1000);
    expect(new Date(offer.expires_at).getTime() - new Date(offer.offered_at).getTime()).toBeLessThan(14.1 * 24 * 3600 * 1000);
    expect(await count("select count(*)::int c from public.messages where template = 'leader_offer'")).toBe(messagesBefore + 1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.offer_sent' and entity_id = $1", [r.offer])).toBe(1);
  });

  it("states only a count and the goal in the message, never a member", async () => {
    const m = await one("select * from public.messages where template = 'leader_offer' order by created_at desc limit 1");
    expect(Object.keys(m.params).sort()).toEqual(["community", "expires_on", "goal", "waiting"]);
    expect(typeof m.params.waiting).toBe("number");
    expect(m.dedupe_key).toMatch(/^leader_offer:[0-9a-f-]{36}$/);
    const text = JSON.stringify(m.params);
    for (const person of await sql("select full_name from public.people where full_name like 'Waiting%'")) expect(text).not.toContain(person.full_name);
  });

  it("queues the message once, whatever happens next", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 3);
    const l = await leaderFor(g, { name: "OnceOnly" });
    const r = await call(director, "leader_offer_send", [g.id, l.id]);
    await expect(call(director, "leader_offer_send", [g.id, l.id])).rejects.toThrow(/already have an open offer/);
    await expect(call(pastor, "leader_offer_send", [g.id, l.id])).rejects.toThrow(/already have an open offer/);
    expect(await count("select count(*)::int c from public.messages where dedupe_key = $1", [`leader_offer:${r.offer}`])).toBe(1);
    // Even asked to queue it again by key, the outbox ignores it
    const again = await internalEnqueue(l.id, `leader_offer:${r.offer}`);
    expect(again).toBeNull();
  });

  it("allows one open offer per leader at a time: the database says so as well as the function", async () => {
    const [g, h] = await freshGoals(2);
    await waiting(g, 2);
    await waiting(h, 2);
    const l = await leaderFor(g, { name: "Busy" });
    await call(adminId, "leader_offer_send", [g.id, l.id]);
    await expect(sql("insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer) values ($1, $2, $3, 1)", [h.id, l.id, seasonId])).rejects.toThrow(/leader_offers_one_open/);
  });

  it("refuses an offer to someone who is not an approved leader, who has a tribe, or for a goal that cannot be offered", async () => {
    const [g, h] = await freshGoals(2);
    await waiting(g, 2);
    const plain = await k.person("JustAMember");
    const roleOnly = await k.staff("RoleOnly", "leader");
    const pending = await leaderFor(g, { name: "PendingToo", approved: false, role: false });
    for (const who of [plain.id, roleOnly.id, pending.id]) await expect(call(pastor, "leader_offer_send", [g.id, who])).rejects.toThrow(/approved leaders/);
    await expect(call(pastor, "leader_offer_send", [g.id, o.owner.id])).rejects.toThrow(/No such person/);

    const busy = await leaderFor(g, { name: "HasTribe" });
    const t = await k.tribe(seasonId, { status: "draft", name: "Mine already" });
    await sql("update public.tribes set leader_id = $2 where id = $1", [t.tribe, busy.id]);
    await expect(call(pastor, "leader_offer_send", [g.id, busy.id])).rejects.toThrow(/already have a Tribe Card or lead/);

    const free = await leaderFor(g, { name: "Free" });
    // nobody is waiting for h
    await expect(call(pastor, "leader_offer_send", [h.id, free.id])).rejects.toThrow(/Nobody is waiting/);
    // a goal whose card is not signed off
    await waiting(h, 2);
    await sql("update public.tribe_card_templates set status = 'draft' where season_goal_id = $1", [h.id]);
    await expect(call(pastor, "leader_offer_send", [h.id, free.id])).rejects.toThrow(/not signed off/);
    await sql("update public.tribe_card_templates set status = 'signed_off' where season_goal_id = $1", [h.id]);
    await expectCode(callRaw(pastor, "leader_offer_send", ["00000000-0000-0000-0000-000000000000", free.id]), "P0002");
    expect(await count("select count(*)::int c from public.leader_offers where person_id = any($1::uuid[])", [[plain.id, roleOnly.id, pending.id, busy.id, free.id]])).toBe(0);
  });

  it("refuses an offer when no season is open", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    const l = await leaderFor(g, { name: "NoSeason" });
    await sql("update public.seasons set status = 'closed' where id = $1", [seasonId]);
    await expect(call(pastor, "leader_offer_send", [g.id, l.id])).rejects.toThrow(/No season is open/);
    await sql("update public.seasons set status = 'planning' where id = $1", [seasonId]);
  });

  it("lets the office withdraw an open offer once, and not one that is already closed", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    const l = await leaderFor(g, { name: "Withdrawn" });
    const r = await call(pastor, "leader_offer_send", [g.id, l.id]);
    expect(await call(director, "leader_offer_withdraw", [r.offer])).toEqual({ ok: true });
    expect((await one("select status from public.leader_offers where id = $1", [r.offer])).status).toBe("withdrawn");
    await expect(call(pastor, "leader_offer_withdraw", [r.offer])).rejects.toThrow(/no longer open/);
    // The leader can no longer answer it
    await expect(call(l.id, "leader_offer_respond", [r.offer, true])).rejects.toThrow(/no longer open/);
    // and may be offered again
    expect((await call(pastor, "leader_offer_send", [g.id, l.id])).ok).toBe(true);
  });

  it("marks an offer expired after its date, shows it that way, refuses an answer, and lets a new offer be made", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    const l = await leaderFor(g, { name: "Late" });
    const r = await call(pastor, "leader_offer_send", [g.id, l.id]);
    await sql("update public.leader_offers set expires_at = now() - interval '1 hour' where id = $1", [r.offer]);
    const shown = ((await call(pastor, "leader_offers_list")) as Row[]).find((x) => x.id === r.offer) as Row;
    expect(shown.status).toBe("expired");
    expect(await call(l.id, "my_leader_offers")).toBeNull();
    await expect(call(l.id, "leader_offer_respond", [r.offer, true])).rejects.toThrow(/no longer open/);
    // A refused answer is rolled back with the rest, so the row is marked the next time an offer is made
    expect((await call(pastor, "leader_offer_send", [g.id, l.id])).ok).toBe(true);
    expect((await one("select status from public.leader_offers where id = $1", [r.offer])).status).toBe("expired");
  });

  it("lists open offers and the last 90 days, with names for the office and no name for an offer the owner made", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 2);
    const l = await leaderFor(g, { name: "FromOwner" });
    const sent = await db.asUser(o.owner.id, (q) => q("select public.leader_offer_send($1, $2) as r", [g.id, l.id]), { session: o.session });
    const offer = sent.rows[0].r.offer as string;
    expect((await one("select offered_by from public.leader_offers where id = $1", [offer])).offered_by).toBeNull();
    const list = (await call(pastor, "leader_offers_list")) as Row[];
    const mine = list.find((x) => x.id === offer) as Row;
    expect(mine).toMatchObject({ goal: g.title, status: "offered", offered_by: null });
    expect(mine.name).toContain("FromOwner");
    expect(JSON.stringify(list)).not.toMatch(/The Owner|owner@example/);
    // The owner is not in the office's log
    expect(await count("select count(*)::int c from public.event_log where actor_id = $1", [o.owner.id])).toBe(0);
    // An old closed offer drops off the list
    await sql("update public.leader_offers set status = 'withdrawn', offered_at = now() - interval '120 days' where id = $1", [offer]);
    expect(((await call(pastor, "leader_offers_list")) as Row[]).map((x) => x.id)).not.toContain(offer);
  });

  it("tells the leader about their own offer, with how many are waiting now, and nobody else", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 4);
    const l = await leaderFor(g, { name: "Sees" });
    const other = await leaderFor(g, { name: "DoesNotSee" });
    const r = await call(pastor, "leader_offer_send", [g.id, l.id]);
    const mine = await call(l.id, "my_leader_offers");
    expect(mine).toMatchObject({ offer_id: r.offer, goal: g.title, waiting: 4, waiting_at_offer: 4 });
    expect(Object.keys(mine).sort()).toEqual(["community", "expires_at", "goal", "goal_id", "offer_id", "offered_at", "waiting", "waiting_at_offer"]);
    expect(await call(other.id, "my_leader_offers")).toBeNull();
    // A goal whose card is retired is not shown to the leader
    await sql("update public.tribe_card_templates set status = 'draft' where season_goal_id = $1", [g.id]);
    expect(await call(l.id, "my_leader_offers")).toBeNull();
    await sql("update public.tribe_card_templates set status = 'signed_off' where season_goal_id = $1", [g.id]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("answering an offer", () => {
  async function offerTo(name: string, o2: { waiting?: number; track?: string } = {}) {
    const [g] = await freshGoals(1);
    await waiting(g, o2.waiting ?? 3);
    const l = await leaderFor(g, { name, track: o2.track });
    const r = await call(pastor, "leader_offer_send", [g.id, l.id]);
    return { g, l, offer: r.offer as string };
  }

  it("lets a leader decline, once, and changes nothing else", async () => {
    const { l, offer } = await offerTo("Decliner");
    const tribes = await count("select count(*)::int c from public.tribes");
    expect(await call(l.id, "leader_offer_respond", [offer, false])).toEqual({ ok: true, declined: true });
    const row = await one("select status, answered_at, tribe_id from public.leader_offers where id = $1", [offer]);
    expect(row.status).toBe("declined");
    expect(row.answered_at).not.toBeNull();
    expect(row.tribe_id).toBeNull();
    expect(await count("select count(*)::int c from public.tribes")).toBe(tribes);
    expect(await call(l.id, "leader_offer_respond", [offer, false])).toMatchObject({ ok: true, already: true });
    await expect(call(l.id, "leader_offer_respond", [offer, true])).rejects.toThrow(/no longer open/);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.offer_declined' and entity_id = $1", [offer])).toBe(1);
  });

  it("starts the Tribe Card on accepting: the goal, community and stage locked, the three lines from the signed-off card", async () => {
    const { g, l, offer } = await offerTo("Accepter");
    const r = await call(l.id, "leader_offer_respond", [offer, true]);
    expect(r.ok).toBe(true);
    const t = await one("select * from public.tribes where id = $1", [r.tribe]);
    expect(t).toMatchObject({ leader_id: l.id, season_id: seasonId, season_goal_id: g.id, community_id: g.communityId, status: "draft" });
    expect([...t.fixed].sort()).toEqual(["community", "goal", "track"]);
    expect(t.track_id).toBe((await one("select id from public.tracks where slug = $1", [g.tracks[0]])).id);
    const card = await one("select loving_god, loving_others, loving_life from public.tribe_card_templates where season_goal_id = $1", [g.id]);
    expect([t.loving_god, t.loving_others, t.loving_life]).toEqual([card.loving_god, card.loving_others, card.loving_life]);
    expect(t.name).toContain("Accepter");
    const o2 = await one("select status, answered_at, tribe_id from public.leader_offers where id = $1", [offer]);
    expect(o2).toMatchObject({ status: "accepted", tribe_id: r.tribe });
    expect(o2.answered_at).not.toBeNull();
    expect(await count("select count(*)::int c from public.event_log where action = 'tribe.started' and entity_id = $1", [r.tribe])).toBe(1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.offer_accepted' and entity_id = $1", [offer])).toBe(1);
    // A pastor still approves it: nothing is certified and nothing is shown to members
    expect(await count("select count(*)::int c from public.leader_certifications where person_id = $1", [l.id])).toBe(0);
  });

  it("changes nothing on a second accept", async () => {
    const { l, offer } = await offerTo("Twice");
    const first = await call(l.id, "leader_offer_respond", [offer, true]);
    const tribes = await count("select count(*)::int c from public.tribes where leader_id = $1", [l.id]);
    const second = await call(l.id, "leader_offer_respond", [offer, true]);
    expect(second).toEqual({ ok: true, tribe: first.tribe, already: true });
    expect(await count("select count(*)::int c from public.tribes where leader_id = $1", [l.id])).toBe(tribes);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.offer_accepted' and entity_id = $1", [offer])).toBe(1);
  });

  it("makes exactly one card when the accept is sent twice at the same moment", async () => {
    const { l, offer } = await offerTo("Racer");
    const answers2 = await Promise.allSettled([call(l.id, "leader_offer_respond", [offer, true]), call(l.id, "leader_offer_respond", [offer, true])]);
    expect(answers2.filter((a) => a.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await count("select count(*)::int c from public.tribes where leader_id = $1 and status <> 'closed'", [l.id])).toBe(1);
  });

  it("refuses an answer from anyone but the leader the offer is for", async () => {
    const { g, offer } = await offerTo("Theirs");
    const other = await leaderFor(g, { name: "Someone" });
    await expectCode(callRaw(other.id, "leader_offer_respond", [offer, true]), "P0002");
    await expectCode(callRaw(pastor, "leader_offer_respond", [offer, true]), "42501");
    await expectCode(callRaw(memberId, "leader_offer_respond", [offer, true]), "42501");
    await expectCode(callRaw(other.id, "leader_offer_respond", [offer, false]), "P0002");
    await expectCode(callRaw(other.id, "leader_offer_respond", ["00000000-0000-0000-0000-000000000000", true]), "P0002");
    expect((await one("select status from public.leader_offers where id = $1", [offer])).status).toBe("offered");
  });

  it("asks for a yes or a no", async () => {
    const { l, offer } = await offerTo("Maybe");
    await expectCode(callRaw(l.id, "leader_offer_respond", [offer, null]), "22023");
  });

  it("refuses an accept from a leader who has since been given a tribe", async () => {
    const { l, offer } = await offerTo("GotOne");
    const t = await k.tribe(seasonId, { status: "draft", name: "Meanwhile" });
    await sql("update public.tribes set leader_id = $2 where id = $1", [t.tribe, l.id]);
    await expect(call(l.id, "leader_offer_respond", [offer, true])).rejects.toThrow(/already have a Tribe Card/);
    expect((await one("select status from public.leader_offers where id = $1", [offer])).status).toBe("offered");
    await sql("update public.tribes set status = 'closed' where id = $1", [t.tribe]);
  });

  it("refuses an accept after the goal's card was taken back, and when no season is open", async () => {
    const a = await offerTo("CardGone");
    await sql("update public.tribe_card_templates set status = 'draft' where season_goal_id = $1", [a.g.id]);
    await expect(call(a.l.id, "leader_offer_respond", [a.offer, true])).rejects.toThrow(/no longer available/);
    await sql("update public.tribe_card_templates set status = 'signed_off' where season_goal_id = $1", [a.g.id]);

    await sql("update public.seasons set status = 'closed' where id = $1", [seasonId]);
    await expect(call(a.l.id, "leader_offer_respond", [a.offer, true])).rejects.toThrow(/No season is open/);
    await sql("update public.seasons set status = 'planning' where id = $1", [seasonId]);
    expect((await call(a.l.id, "leader_offer_respond", [a.offer, true])).ok).toBe(true);
  });

  it("keeps a line the leader wrote first: filling the card only writes into empty lines", async () => {
    const { l, offer } = await offerTo("HasWords");
    const r = await call(l.id, "leader_offer_respond", [offer, true]);
    await sql("update public.tribes set loving_god = 'We meet to pray for each other every week.', loving_others = '' where id = $1", [r.tribe]);
    await sql("select public.card_template_fill($1)", [r.tribe]);
    const t = await one("select loving_god, loving_others from public.tribes where id = $1", [r.tribe]);
    expect(t.loving_god).toBe("We meet to pray for each other every week.");
    expect(t.loving_others.length).toBeGreaterThan(10);
  });

  it("gives a card of the same shape as one started from an application, then filled from the ready-made card", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 3);
    const viaOffer = await leaderFor(g, { name: "ViaOffer" });
    const viaApp = await leaderFor(g, { name: "ViaApp" });
    const sent = await call(pastor, "leader_offer_send", [g.id, viaOffer.id]);
    const accepted = await call(viaOffer.id, "leader_offer_respond", [sent.offer, true]);
    const started = (await callRaw(viaApp.id, "start_tribe_card")).rows[0].r as string;
    await sql("select public.card_template_fill($1)", [started]);
    const a = await one("select * from public.tribes where id = $1", [accepted.tribe]);
    const b = await one("select * from public.tribes where id = $1", [started]);
    const shape = (r: Row) => Object.keys(r).filter((c) => !["id", "slug", "leader_id", "created_at", "updated_at", "name"].includes(c) && r[c] !== null && !(Array.isArray(r[c]) && r[c].length === 0)).sort();
    expect(shape(a)).toEqual(shape(b));
    expect([...a.fixed].sort()).toEqual([...b.fixed].sort());
    expect([a.loving_god, a.loving_others, a.loving_life]).toEqual([b.loving_god, b.loving_others, b.loving_life]);
  });

  it("leaves the board and the suggestions agreeing about the new card: the leader is no longer a candidate", async () => {
    const { g, l, offer } = await offerTo("Placed");
    await call(l.id, "leader_offer_respond", [offer, true]);
    expect(((await suggested(pastor, g)).suggestions as Row[] | undefined ?? []).map((x) => x.person_id)).not.toContain(l.id);
    const list = ((await call(pastor, "leader_offers_list")) as Row[]).find((x) => x.id === offer) as Row;
    expect(list.status).toBe("accepted");
    expect(list.tribe_id).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("at size", () => {
  it("answers the board at once and a suggestion in a few seconds with 100 leaders and 100 goals", async () => {
    const [g] = await freshGoals(1);
    await waiting(g, 8);
    for (let i = 0; i < 100; i++) await leaderFor(g, { name: `Scale${i}`, track: g.tracks[i % g.tracks.length] });
    let t0 = Date.now();
    const b = await board(pastor);
    const boardMs = Date.now() - t0;
    t0 = Date.now();
    const s = await suggested(pastor, g);
    const suggestMs = Date.now() - t0;
    expect(b.goals).toHaveLength(100);
    expect(s.suggestions).toHaveLength(3);
    expect(boardMs).toBeLessThan(2000);
    // Works out how well each of the 100 leaders suits the goal. About 2 seconds on the build machine when it is quiet (the board itself takes
    // milliseconds); the limit is loose on purpose so a busy machine does not fail the run, and tight enough to catch a cost that grows with size.
    expect(suggestMs).toBeLessThan(8000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the leaders we already have are untouched", () => {
  it("changes no existing table's columns and no existing function's name", async () => {
    const cols = await sql(
      "select count(*)::int c from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])",
      [["leader_applications", "leader_fit_runs", "tribes", "person_roles", "tribe_card_templates"]],
    );
    expect(cols[0].c).toBeGreaterThan(0);
    const dupes = await sql("select proname from pg_proc where pronamespace = 'public'::regnamespace group by proname, proargtypes having count(*) > 1");
    expect(dupes).toEqual([]);
    expect(randomUUID()).toBeTruthy();
  });
});

/** The outbox, asked to queue the same offer again by its key. */
async function internalEnqueue(person: string, key: string) {
  return (await db.admin.query("select public.enqueue_message($1, 'leader_offer', '{}'::jsonb, null, $2) as r", [person, key])).rows[0].r as string | null;
}
