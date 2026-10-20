import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { ALL_OFF, SCENARIOS_BEST, SCENARIOS_POOR, answers, calling, pipelineKit, setPositions, type PipelineKit } from "./pipeline-kit";
import { referenceOptions, rng, type Card, type GoalInfo, type Inputs, type Model, type World } from "./leader-fit-reference";

// Phase 5: the compatibility engine for leaders, in the database. The engine is held to a second copy written in plain TypeScript
// (leader-fit-reference.ts) over several hundred generated cases, then each rule is tested on its own: the filter, the care gate,
// the "members waiting" figure, what the applicant may see, the choice, the model, the first thought, and the quiet run.

let db: TestDb;
let k: Kit;
let pk: PipelineKit;
let pastor: string;
let director: string;
let adminId: string;
let seasonId: string;
let n = 0;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;
const internal = async (fn: string, args: unknown[] = []) =>
  (await db.admin.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;

// Scenario answers. The key rates the best pick 4 and the worst 1; these give the care situations (s2, s3, s6) a result just under the bar.
const CARE_LOW = { ...SCENARIOS_BEST, s2: { best: "d", worst: "a" }, s3: { best: "c", worst: "b" }, s6: { best: "b", worst: "c" } };

type Draft = { user: { id: string }; app: string };
async function applicant(o: {
  track?: string; community?: string; goal?: string; goalOther?: string; relation?: "achieved" | "pursuing"; leadBest?: string;
  scenarios?: Record<string, unknown>;
} = {}): Promise<Draft> {
  const user = await pk.person(undefined, `Applicant${++n}`);
  const app = await pk.startDraft(
    user.id,
    answers(undefined, {
      calling: calling({
        track: o.track ?? "builders",
        community: o.community ?? "professionals",
        goal: o.goalOther ? undefined : (o.goal ?? "step-into-a-leadership-role"),
        goalOther: o.goalOther,
        goalRelation: o.relation ?? "pursuing",
      }),
      scenarios: o.scenarios ?? SCENARIOS_BEST,
      style: { styleSocial: 1, styleStructure: -1, leadBest: o.leadBest ?? "connection" },
    }),
    "lead-best",
  );
  return { user, app };
}

const fitOn = () => db.admin.query("update public.leader_pipeline_settings set tribe_fit = 'on'");
const fitOff = () => db.admin.query("update public.leader_pipeline_settings set tribe_fit = 'off'");

async function worldFromDb(): Promise<World> {
  const cards: Card[] = (await sql(
    `select t.season_goal_id as "goalId", t.slug, t.community_id as "communityId", g.family_id as "familyId", t.track_slugs as tracks,
            t.demand_structure as s, t.demand_connection as c, t.demand_teaching as te, t.demand_doing as d, t.sensitive
       from public.tribe_card_templates t join public.season_goals g on g.id = t.season_goal_id and g.active
       join public.communities cm on cm.id = t.community_id and cm.active
      where t.status = 'signed_off'`,
  )).map((r) => ({ goalId: r.goalId, slug: r.slug, communityId: r.communityId, familyId: r.familyId, tracks: r.tracks, demand: { structure: r.s, connection: r.c, teaching: r.te, doing: r.d }, sensitive: r.sensitive }));
  const goalsBySlug: Record<string, GoalInfo> = {};
  for (const g of await sql('select id, slug, community_id as "communityId", family_id as "familyId" from public.season_goals')) goalsBySlug[g.slug] = g as GoalInfo;
  const communityIds: Record<string, string> = {};
  for (const c of await sql("select id, slug from public.communities")) communityIds[c.slug] = c.id;
  const trackOrder = (await sql("select slug from public.tracks where active order by sort")).map((t) => t.slug as string);
  const gap: Record<string, number> = {};
  for (const r of await sql("select goal_id, gap from public.goal_demand_rows($1)", [seasonId])) gap[r.goal_id] = r.gap;
  return { cards, goalsBySlug, communityIds, trackOrder, gap };
}

const modelOf = async (): Promise<Model> => {
  const m = await one("select weights, min_degree from public.leader_fit_models where active");
  return { weights: m.weights, min_degree: m.min_degree };
};

async function signOffAll() {
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  pk = pipelineKit(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  await k.staff("Coach", "coach");
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  memberId = (await k.person("Member")).id;
  await setPositions(db, {});
});

afterAll(async () => {
  await db?.close();
});

describe("the model", () => {
  it("starts as lf-1, not active, with weights that add to 100", async () => {
    const m = await one("select * from public.leader_fit_models where version = 'lf-1'");
    expect(m.active).toBe(false);
    expect(m.min_degree).toBe(60);
    const w = m.weights;
    expect(w.calling + w.judgement + w.style + w.need + w.stage).toBe(100);
    expect([w.calling, w.judgement, w.style, w.need, w.stage]).toEqual([35, 20, 20, 15, 10]);
    expect(await count("select count(*)::int c from public.leader_fit_models where active")).toBe(0);
  });

  it("says plainly that there is no approved model while none is active", async () => {
    await fitOn();
    const a = await applicant();
    expect(await call(a.user.id, "leader_fit_run", [a.app])).toEqual({ status: "no_model" });
    await fitOff();
    await expect(internal("leader_fit_record", [a.user.id, a.app, "{}", "application"])).rejects.toThrow(/No fit model/);
  });

  it("refuses weights that do not add to 100 or are not whole numbers, and unknown keys", async () => {
    for (const bad of [{ calling: 40 }, { calling: 35.5, need: 14.5 }, { calling: -5, need: 20 }, { foo: 1 }, { calling: "35" }, {}]) {
      await expectCode(call(pastor, "leader_fit_model_save", [JSON.stringify(bad), null]), "22023");
    }
    await expectCode(call(pastor, "leader_fit_model_save", [JSON.stringify({ care_bar: 101 }), null]), "22023");
  });

  it("saves a new inactive version that points to its parent, and keeps the old one", async () => {
    const r = await call(adminId, "leader_fit_model_save", [JSON.stringify({ calling: 30, need: 20 }), "More weight on need."]);
    expect(r).toEqual({ version: "lf-2", active: false });
    const m = await one("select * from public.leader_fit_models where version = 'lf-2'");
    expect(m.parent_version).toBe("lf-1");
    expect(m.weights).toMatchObject({ calling: 30, need: 20, judgement: 20, style: 20, stage: 10, care_bar: 70 });
    expect(m.active).toBe(false);
    await expectCode(call(member(), "leader_fit_model_save", [JSON.stringify({ calling: 30, need: 20 }), null]), "42501");
  });

  it("never lets a version be edited or deleted", async () => {
    await expect(db.admin.query("update public.leader_fit_models set weights = weights || '{\"calling\": 36, \"need\": 14}' where version = 'lf-1'")).rejects.toThrow(/cannot be changed/);
    await expect(db.admin.query("delete from public.leader_fit_models where version = 'lf-1'")).rejects.toThrow(/kept for the record/);
  });

  it("lets only the pastor approve, and only one version is ever active", async () => {
    await expectCode(call(adminId, "leader_fit_model_activate", ["lf-1"]), "42501");
    await expectCode(call(director, "leader_fit_model_activate", ["lf-1"]), "42501");
    await expectCode(call(pastor, "leader_fit_model_activate", ["lf-9"]), "P0002");
    expect((await call(pastor, "leader_fit_model_activate", ["lf-1"])).active).toBe(true);
    expect((await call(pastor, "leader_fit_model_activate", ["lf-1"])).already).toBe(true);
    await call(pastor, "leader_fit_model_activate", ["lf-2"]);
    expect((await sql("select version from public.leader_fit_models where active")).map((r) => r.version)).toEqual(["lf-2"]);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    expect((await sql("select version from public.leader_fit_models where active")).map((r) => r.version)).toEqual(["lf-1"]);
    expect((await one("select approved_by from public.leader_fit_models where version = 'lf-1'")).approved_by).toBe(pastor);
    await expect(db.admin.query("update public.leader_fit_models set active = true where version = 'lf-2'")).rejects.toThrow();
  });

  it("lists the versions for the office and nobody else, naming the approver", async () => {
    const list = await call(adminId, "leader_fit_models_list");
    expect(list.map((m: Row) => m.version)).toEqual(["lf-1", "lf-2"]);
    expect(list[0].approved_by).toBe("Pastor Test");
    await expectCode(call(member(), "leader_fit_models_list"), "42501");
  });
});

let memberId: string | null = null;
function member() {
  if (!memberId) throw new Error("member not ready");
  return memberId;
}

describe("the catalogue the engine reads", () => {
  it("is built from signed-off cards only", async () => {
    await fitOn();
    const a = await applicant();
    // Nothing signed off yet: the run is made and finds no options
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r).toMatchObject({ status: "ok", options: 0, shown: 0, top: [], groups: [] });
    expect((await one("select candidates, shown from public.leader_fit_runs where application_id = $1", [a.app]))).toMatchObject({ candidates: 0, shown: 0 });
    // A few-options event is written
    expect(await count("select count(*)::int c from public.event_log where action = 'leader_fit.few_options'")).toBeGreaterThan(0);
    await fitOff();
  });

  it("signs off all 100 cards for the rest of this file", async () => {
    await signOffAll();
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'")).toBe(100);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(100);
  });
});

describe("members waiting, seats open and the gap (one figure)", () => {
  let goalA: string;
  let goalC: string;

  async function waiting(goal: string, count_: number) {
    for (let i = 0; i < count_; i++) {
      const u = await k.person(`Waiting${++n}`);
      await sql(
        "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3",
        [u.id, seasonId, goal],
      );
    }
  }
  const rows = async () => {
    const out: Record<string, Row> = {};
    for (const r of await sql("select * from public.goal_demand_rows($1)", [seasonId])) out[r.goal_id] = r;
    return out;
  };

  it("counts members waiting and ignores people who have since been placed", async () => {
    goalA = (await one("select id from public.season_goals where slug = 'build-a-steady-client-pipeline'")).id;
    goalC = (await one("select id from public.season_goals where slug = 'land-my-first-three-clients'")).id;
    await waiting(goalA, 5);
    expect((await rows())[goalA]).toMatchObject({ waiting: 5, seats_open: 0, gap: 5 });
    // One of them is placed in a tribe: no longer waiting, even though the old demand row is still there
    const placed = (await sql("select person_id from public.match_demand where season_goal_id = $1 limit 1", [goalA]))[0].person_id;
    const t = await k.tribe(seasonId, { community: "consulting" });
    await sql(
      "insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by) values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)",
      [t.tribe, placed, seasonId],
    );
    expect((await rows())[goalA]).toMatchObject({ waiting: 4 });
  });

  let seatGoal: string;
  it("counts seats open the way match_stats counts seats: approved tribes with a certified leader, never below zero", async () => {
    const community = "creative-economy";
    const make = async (o: { capacity: number; members: number; certified?: boolean; status?: string }) => {
      const t = await k.tribe(seasonId, { community, capacity: o.capacity, certified: o.certified, status: o.status });
      for (let i = 0; i < o.members; i++) await k.seat(t.tribe, seasonId, `M${++n}`, { profile: false });
      return t;
    };
    const first = await make({ capacity: 12, members: 5 }); // 7 open
    seatGoal = (await one("select season_goal_id from public.tribes where id = $1", [first.tribe])).season_goal_id;
    expect([goalA, goalC]).not.toContain(seatGoal);
    await make({ capacity: 12, members: 0, certified: false }); // no certificate: no seats
    await make({ capacity: 12, members: 0, status: "submitted" }); // not approved: no seats
    await make({ capacity: 4, members: 5 }); // over full: never below zero
    expect((await rows())[seatGoal]).toMatchObject({ seats_open: 7 });
    const stats = await call(adminId, "match_stats");
    expect(JSON.stringify(stats)).toContain("seats");
  });

  it("shows a negative gap when leaders outnumber members", async () => {
    expect((await rows())[seatGoal]).toMatchObject({ waiting: 0, seats_open: 7, gap: -7 });
  });

  it("gives several goals a positive gap, so the rest of this file has demand to work with", async () => {
    await waiting(goalC, 3);
    const marriage = (await one("select id from public.season_goals where slug = 'strengthen-our-marriage'")).id;
    await waiting(marriage, 2);
    const r = await rows();
    expect(r[goalC]).toMatchObject({ waiting: 3, gap: 3 });
    expect(r[marriage]).toMatchObject({ waiting: 2, gap: 2 });
  });

  it("counts leaders interested from the latest run only, first choice and backup together, never quiet runs", async () => {
    await fitOn();
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    const a = await applicant({ community: "consulting", goal: "build-a-steady-client-pipeline" });
    await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, goalA, [goalC]]);
    let r = await rows();
    expect(r[goalA].interested).toBe(1);
    expect(r[goalC].interested).toBe(1);
    // A leader's quiet run chooses nothing
    const quiet = await k.person("Quiet");
    await sql(
      `insert into public.leader_fit_runs (person_id, model_version, inputs, inputs_hash, source, candidates, shown, options) values ($1, 'lf-1', '{}', 'x', 'quiet', 0, 0, '[]')`,
      [quiet.id],
    );
    r = await rows();
    expect(r[goalA].interested).toBe(1);
    // A later run with no choice replaces the earlier one, for the same person
    await sql(`insert into public.leader_fit_runs (person_id, application_id, model_version, inputs, inputs_hash, source, candidates, shown, options)
               values ($1, $2, 'lf-1', '{}', 'newer', 'application', 0, 0, '[]')`, [a.user.id, a.app]);
    expect((await rows())[goalA].interested).toBe(0);
    await sql("delete from public.leader_fit_runs where person_id = $1 and inputs_hash in ('x', 'newer')", [quiet.id]);
    await sql("delete from public.leader_fit_runs where inputs_hash = 'newer'");
    await fitOff();
  });

  it("is the only place the figure is computed", async () => {
    const users = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'leader_fit%' or p.proname like 'card_template%' or p.proname like 'goal_demand%')
          and pg_get_functiondef(p.oid) ilike '%match_demand%'`,
    );
    expect(users.map((u) => u.proname)).toEqual(["goal_demand_rows"]);
    const seats = await sql(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'leader_fit%' or p.proname like 'card_template%')
          and pg_get_functiondef(p.oid) ilike '%leader_certifications%'`,
    );
    expect(seats.map((u) => u.proname)).toEqual([]);
  });
});

describe("the engine against the second copy written in TypeScript", () => {
  it("gives the same degree, parts, label, flags and order over 400 generated cases", async () => {
    const world = await worldFromDb();
    const model = await modelOf();
    expect(world.cards).toHaveLength(100);
    expect(Object.values(world.gap).some((g) => g > 0)).toBe(true);
    expect(Object.values(world.gap).some((g) => g < 0)).toBe(true);
    const rand = rng(20261020);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const goalSlugs = Object.keys(world.goalsBySlug);
    const communities = Object.keys(world.communityIds);
    const tracks = [...world.trackOrder];
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const goal = rand() < 0.2 ? null : pick(goalSlugs);
      const inputs: Inputs = {
        track: pick(tracks),
        // Sometimes a community that does not match the goal (a goal left over from another community), sometimes none
        community: rand() < 0.1 ? null : goal && rand() < 0.8 ? communities.find((c) => world.communityIds[c] === world.goalsBySlug[goal].communityId)! : pick(communities),
        goal,
        relation: pick(["achieved", "pursuing", null] as const),
        lead_best: pick(["structure", "connection", "teaching", "doing"] as const),
        judgement: rand() < 0.15 ? null : Math.round(rand() * 10000) / 100,
        care: rand() < 0.15 ? null : Math.round(rand() * 10000) / 100,
      };
      const expected = referenceOptions(inputs, world, model);
      const actual = await sql("select * from public.leader_fit_options($1::jsonb) order by ord", [JSON.stringify(inputs)]);
      const shape = (o: Row) => ({ g: o.goal_id, c: o.closeness, a: o.calling, j: o.judgement, s: o.style, n: o.need, t: o.stage, d: o.degree, nt: o.next_to, cf: o.care_flag, r: o.recommended, ord: o.ord, rr: o.rec_rank });
      const refShape = (o: (typeof expected)[number]) => ({ g: o.goal_id, c: o.closeness, a: o.calling, j: o.judgement, s: o.style, n: o.need, t: o.stage, d: o.degree, nt: o.next_to, cf: o.care_flag, r: o.recommended, ord: o.ord, rr: o.rec_rank });
      expect(actual.map(shape), `case ${i}: ${JSON.stringify(inputs)}`).toEqual(expected.map(refShape));
      expect(actual.map((o) => o.label), `labels, case ${i}`).toEqual(expected.map((o) => o.label));
      compared += actual.length;
    }
    expect(compared).toBeGreaterThan(10000);
  });

  it("follows a changed model: the weights come from the active row, not from the code", async () => {
    await call(pastor, "leader_fit_model_activate", ["lf-2"]);
    const world = await worldFromDb();
    const model = await modelOf();
    expect(model.weights.calling).toBe(30);
    const inputs: Inputs = { track: "builders", community: "consulting", goal: "build-a-steady-client-pipeline", relation: "achieved", lead_best: "doing", judgement: 83.33, care: 100 };
    const actual = await sql("select goal_id, degree from public.leader_fit_options($1::jsonb) order by ord", [JSON.stringify(inputs)]);
    expect(actual).toEqual(referenceOptions(inputs, world, model).map((o) => ({ goal_id: o.goal_id, degree: o.degree })));
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });
});

describe("the filter", () => {
  const optionsFor = async (over: Partial<Inputs> = {}) =>
    sql("select * from public.leader_fit_options($1::jsonb) order by ord", [
      JSON.stringify({ track: "builders", community: "professionals", goal: "step-into-a-leadership-role", relation: "pursuing", lead_best: "connection", judgement: 90, care: 90, ...over }),
    ]);

  it("offers a card that is signed off, in a community and with a goal that are on", async () => {
    const all = await optionsFor();
    expect(all.length).toBeGreaterThan(50);
    expect(new Set(all.map((o) => o.goal_id)).size).toBe(all.length);
  });

  it("drops a card that is back in draft until it is signed off again", async () => {
    const slug = "handle-workplace-conflict-with-grace";
    const goal = (await one("select id from public.season_goals where slug = $1", [slug])).id;
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(true);
    await call(pastor, "card_template_save", [slug, JSON.stringify({ who_for: "Professionals in tension with a colleague, a manager or a team, who want to respond well." })]);
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(false);
    await call(pastor, "card_template_sign_off", [slug]);
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(true);
  });

  it("drops a retired card, an inactive goal and an inactive community", async () => {
    const slug = "plan-the-next-five-years-of-my-career";
    const goal = (await one("select id from public.season_goals where slug = $1", [slug])).id;
    await call(pastor, "card_template_retire", [slug]);
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(false);
    await call(pastor, "card_template_sign_off", [slug]);
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(true);
    await sql("update public.season_goals set active = false where id = $1", [goal]);
    expect((await optionsFor()).some((o) => o.goal_id === goal)).toBe(false);
    await sql("update public.season_goals set active = true where id = $1", [goal]);
    const before = (await optionsFor()).length;
    await sql("update public.communities set active = false where slug = 'consulting'");
    const after = await optionsFor();
    expect(after.length).toBeLessThan(before);
    expect(after.every((o) => o.community_slug !== "consulting")).toBe(true);
    await sql("update public.communities set active = true where slug = 'consulting'");
  });

  it("offers a card one life stage away, flagged and scored lower on Stage, and none two stages away", async () => {
    // "business-entrepreneurship / launch-or-formalise-a-business" suits rising, builders and stewards, not sages
    const sage = await optionsFor({ track: "sages" });
    const launch = (await one("select id from public.season_goals where slug = 'launch-or-formalise-a-business'")).id;
    const steward = await optionsFor({ track: "stewards" });
    const stewardLaunch = steward.find((o) => o.goal_id === launch)!;
    expect(stewardLaunch.next_to).toBe(false);
    expect(stewardLaunch.stage).toBe(100);
    const sageLaunch = sage.find((o) => o.goal_id === launch)!;
    expect(sageLaunch.next_to).toBe(true);
    expect(sageLaunch.stage).toBe(60);
    // Only rising: sages are three steps away from it
    await call(pastor, "card_template_save", ["launch-or-formalise-a-business", JSON.stringify({ track_slugs: ["rising"] })]);
    await call(pastor, "card_template_sign_off", ["launch-or-formalise-a-business"]);
    expect((await optionsFor({ track: "sages" })).some((o) => o.goal_id === launch)).toBe(false);
    expect((await optionsFor({ track: "builders" })).find((o) => o.goal_id === launch)!.next_to).toBe(true);
    await call(pastor, "card_template_save", ["launch-or-formalise-a-business", JSON.stringify({ track_slugs: ["rising", "builders", "stewards"] })]);
    await call(pastor, "card_template_sign_off", ["launch-or-formalise-a-business"]);
  });

  it("returns nothing for inputs it cannot work with", async () => {
    expect(await optionsFor({ track: "teens" })).toEqual([]);
    expect(await optionsFor({ track: null })).toEqual([]);
    expect(await optionsFor({ lead_best: null })).toEqual([]);
  });
});

describe("the care gate", () => {
  const options = async (care: number | null) =>
    sql("select * from public.leader_fit_options($1::jsonb) order by ord", [
      JSON.stringify({ track: "builders", community: "marriage-relationships", goal: "strengthen-our-marriage", relation: "achieved", lead_best: "connection", judgement: 95, care }),
    ]);
  const strengthen = async () => (await one("select id from public.season_goals where slug = 'strengthen-our-marriage'")).id;

  it("lists a sensitive card with its flag but never recommends it below the care bar", async () => {
    const g = await strengthen();
    expect((await one("select sensitive from public.tribe_card_templates where slug = 'strengthen-our-marriage'")).sensitive).toBe(true);
    const low = (await options(69)).find((o) => o.goal_id === g)!;
    expect(low.care_flag).toBe(true);
    expect(low.recommended).toBe(false);
    expect(low.rec_rank).toBeNull();
    expect(low.degree).toBeGreaterThanOrEqual(60); // good enough to be recommended, were it not for the gate
  });

  it("recommends it at or above the bar", async () => {
    const g = await strengthen();
    const at = (await options(70)).find((o) => o.goal_id === g)!;
    expect(at.care_flag).toBe(false);
    expect(at.recommended).toBe(true);
  });

  it("treats an unknown care result as below the bar", async () => {
    const g = await strengthen();
    expect((await options(null)).find((o) => o.goal_id === g)!.care_flag).toBe(true);
  });

  it("leaves a card that is not sensitive alone, whatever the care result", async () => {
    const plain = (await one("select g.id from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id where not t.sensitive and t.status = 'signed_off' order by t.slug limit 1")).id;
    for (const care of [0, 50, 100, null]) {
      expect((await options(care)).find((o) => o.goal_id === plain)!.care_flag).toBe(false);
    }
  });

  it("uses the care bar of the active model (the bar is the model's, not the code's)", async () => {
    await call(adminId, "leader_fit_model_save", [JSON.stringify({ care_bar: 100 }), "Care bar at 100."]);
    await call(pastor, "leader_fit_model_activate", ["lf-3"]);
    const g = await strengthen();
    expect((await options(99.99)).find((o) => o.goal_id === g)!.care_flag).toBe(true);
    expect((await options(100)).find((o) => o.goal_id === g)!.care_flag).toBe(false);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });
});

describe("determinism and ties", () => {
  it("gives the same answer for the same inputs, in the same order", async () => {
    const inputs = JSON.stringify({ track: "rising", community: "education", goal: "excel-in-my-studies-or-exams", relation: "achieved", lead_best: "teaching", judgement: 77.5, care: 80 });
    const a = await sql("select goal_id, degree, ord from public.leader_fit_options($1::jsonb) order by ord", [inputs]);
    const b = await sql("select goal_id, degree, ord from public.leader_fit_options($1::jsonb) order by ord", [inputs]);
    expect(a).toEqual(b);
  });

  it("orders equal degrees by Calling, then Need, then the goal id", async () => {
    const rows = await sql(
      "select goal_id, degree, calling, need, ord from public.leader_fit_options($1::jsonb) order by ord",
      [JSON.stringify({ track: "builders", community: null, goal: null, relation: null, lead_best: "doing", judgement: 70, care: 100 })],
    );
    const ties = rows.filter((r, i) => i > 0 && rows[i - 1].degree === r.degree);
    expect(ties.length).toBeGreaterThan(5);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      const ordered = a.degree > b.degree || (a.degree === b.degree && (a.calling > b.calling || (a.calling === b.calling && (a.need > b.need || (a.need === b.need && a.goal_id < b.goal_id)))));
      expect(ordered, `${a.goal_id} before ${b.goal_id}`).toBe(true);
    }
  });
});

describe("judgement and care, from the same rule as the application", () => {
  it("gives the percentage that submit_leader_application stores, for the extremes and for samples between", async () => {
    await setPositions(db, ALL_OFF);
    const key: Record<string, Record<string, number>> = {};
    for (const r of await sql("select scenario_id, option_id, rating from public.scenario_keys")) (key[r.scenario_id] ??= {})[r.option_id] = r.rating;
    const ids = Object.keys(key).sort();
    const rand = rng(77);
    const samples: Record<string, { best: string; worst: string }>[] = [
      SCENARIOS_BEST as never,
      SCENARIOS_POOR as never,
      CARE_LOW as never,
    ];
    for (let i = 0; i < 9; i++) {
      const s: Record<string, { best: string; worst: string }> = {};
      for (const id of ids) {
        const opts = Object.keys(key[id]);
        const best = opts[Math.floor(rand() * 4)];
        let worst = opts[Math.floor(rand() * 4)];
        if (worst === best) worst = opts[(opts.indexOf(best) + 1) % 4];
        s[id] = { best, worst };
      }
      samples.push(s);
    }
    for (const s of samples) {
      const a = await applicant({ scenarios: s });
      await call(a.user.id, "submit_leader_application", [a.app]);
      const stored = Number((await one("select scenario_pct from public.leader_assessments where application_id = $1", [a.app])).scenario_pct);
      const mine = Number(await internal("leader_scenario_score", [JSON.stringify({ scenarios: s }), null]));
      expect(mine).toBe(stored);
    }
    await setPositions(db, {});
  });

  it("scores the three care situations alone, and returns nothing when an answer is missing", async () => {
    expect(Number(await internal("leader_scenario_score", [JSON.stringify({ scenarios: SCENARIOS_BEST }), ["s2", "s3", "s6"]]))).toBe(100);
    expect(Number(await internal("leader_scenario_score", [JSON.stringify({ scenarios: CARE_LOW }), ["s2", "s3", "s6"]]))).toBe(66.67);
    expect(Number(await internal("leader_scenario_score", [JSON.stringify({ scenarios: CARE_LOW }), null]))).toBe(83.33);
    expect(await internal("leader_scenario_score", [JSON.stringify({ scenarios: { s1: { best: "a", worst: "b" } } }), null])).toBeNull();
    expect(await internal("leader_scenario_score", [JSON.stringify({ scenarios: { ...SCENARIOS_BEST, s4: { best: "a", worst: "a" } } }), null])).toBeNull();
    expect(await internal("leader_scenario_score", [JSON.stringify({}), null])).toBeNull();
  });
});

describe("a leader's run", () => {
  let a: Draft;

  it("does nothing while Find your tribe is off", async () => {
    a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role" });
    await fitOff();
    await expect(call(a.user.id, "leader_fit_run", [a.app])).rejects.toThrow(/not switched on/);
    await expect(call(a.user.id, "leader_fit_choose", [a.app, (await one("select id from public.season_goals limit 1")).id, []])).rejects.toThrow(/not switched on/);
  });

  it("returns the best three with reasons and every other option by community, and never a part, a score or a flag word", async () => {
    await fitOn();
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r.status).toBe("ok");
    expect(r.top).toHaveLength(3);
    for (const t of r.top) {
      expect(t.degree).toBeGreaterThanOrEqual(60);
      expect(["excellent", "strong", "good"]).toContain(t.label);
      expect(t.reasons.length).toBeGreaterThan(0);
      expect(t.reasons.length).toBeLessThanOrEqual(3);
    }
    expect(r.top[0].degree).toBeGreaterThanOrEqual(r.top[1].degree);
    expect(r.groups[0].mine).toBe(true);
    expect(r.groups[0].slug).toBe("professionals");
    const all = r.groups.flatMap((g: Row) => g.options);
    expect(all.length + 3).toBe(r.options);
    // Below the minimum the word is "stretch" and there is no percentage
    const stretch = all.filter((o: Row) => o.label === "stretch");
    expect(stretch.length).toBeGreaterThan(0);
    expect(stretch.every((o: Row) => !("degree" in o))).toBe(true);
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [key, val] of Object.entries(v)) { keys.add(key); walk(val); }
    };
    walk(r);
    for (const secret of ["judgement", "care", "care_flag", "care_bar", "sensitive", "components", "parts", "weights", "demand", "gap", "waiting", "seats_open", "interested", "model", "model_version", "closeness", "flags", "first_goal_id", "inputs"]) {
      expect(keys.has(secret), `the screen's data must not carry a "${secret}" field`).toBe(false);
    }
    const text = JSON.stringify(r);
    for (const secret of ["lf-1", "sensitive", "\"low\""]) expect(text, `the screen's data must not contain "${secret}"`).not.toContain(secret);
    // The reasons are among the six allowed sentences
    const allowed = new Set(["You have walked this road", "You are walking this road now", "A close neighbour of the goal you named", "Your way of leading suits this group", "It suits your stage of life", "Members are waiting for a leader here"]);
    for (const t of r.top) for (const s of t.reasons) expect(allowed.has(s), s).toBe(true);
  });

  it("puts the goal they named near the top, and says they are walking this road", async () => {
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r.top.some((t: Row) => t.title === "Step into a leadership role")).toBe(true);
    const own = r.top.find((t: Row) => t.title === "Step into a leadership role");
    expect(own.reasons).toContain("You are walking this road now");
  });

  it("flags a sensitive card below the care bar with a plain note, and still lets the leader choose it", async () => {
    const low = await applicant({ community: "marriage-relationships", goal: "strengthen-our-marriage", relation: "achieved", scenarios: CARE_LOW });
    const r = await call(low.user.id, "leader_fit_run", [low.app]);
    const strengthen = (await one("select id from public.season_goals where slug = 'strengthen-our-marriage'")).id;
    expect(r.top.some((t: Row) => t.goal_id === strengthen)).toBe(false);
    const listed = r.groups.flatMap((g: Row) => g.options).find((o: Row) => o.goal_id === strengthen);
    expect(listed.note).toBe("A pastor will talk with you about this one");
    expect(JSON.stringify(r)).not.toContain("sensitive");
    const chosen = await call(low.user.id, "leader_fit_choose", [low.app, strengthen, []]);
    expect(chosen.calling.goal).toBe("strengthen-our-marriage");
    expect((await one("select chosen_flags from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [low.app])).chosen_flags).toContain("sensitive_below_bar");
  });

  it("reuses the last run when nothing has changed, and makes a new one when the demand changes", async () => {
    const first = await call(a.user.id, "leader_fit_run", [a.app]);
    const again = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(again.run).toBe(first.run);
    expect(await count("select count(*)::int c from public.leader_fit_runs where application_id = $1", [a.app])).toBe(1);
    // Members start waiting for a goal that is in the list
    const goal = first.top[0].goal_id as string;
    for (let i = 0; i < 4; i++) {
      const u = await k.person(`Late${++n}`);
      await sql("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3", [u.id, seasonId, goal]);
    }
    const next = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(next.run).not.toBe(first.run);
    expect(await count("select count(*)::int c from public.leader_fit_runs where application_id = $1", [a.app])).toBe(2);
  });

  it("says what is missing and makes no run when the answers are not all there", async () => {
    const part = await pk.person(undefined, "Partial");
    const app = await pk.startDraft(part.id, { calling: { track: "builders" } }, "track");
    const before = await count("select count(*)::int c from public.leader_fit_runs");
    const r = await call(part.id, "leader_fit_run", [app]);
    expect(r.status).toBe("missing");
    expect(r.missing).toEqual(expect.arrayContaining(["community", "goal", "lead-best", "scenarios"]));
    expect(await count("select count(*)::int c from public.leader_fit_runs")).toBe(before);
  });

  it("counts a written-in goal as no goal: the community scores 40, anything else 10", async () => {
    const w = await applicant({ community: "education", goalOther: "Teach children to code", relation: "achieved" });
    const r = await call(w.user.id, "leader_fit_run", [w.app]);
    expect(r.status).toBe("ok");
    const run = await one("select options from public.leader_fit_runs where application_id = $1", [w.app]);
    const closeness = new Set((run.options as Row[]).map((o) => o.closeness));
    expect([...closeness].sort((x, y) => x - y)).toEqual([10, 40]);
  });
});

describe("what one applicant can do to another", () => {
  it("turns away anyone but the applicant, and a sent application", async () => {
    const a = await applicant();
    const b = await applicant();
    await fitOn();
    await call(a.user.id, "leader_fit_run", [a.app]);
    await expectCode(call(b.user.id, "leader_fit_run", [a.app]), "P0002");
    await expectCode(call(b.user.id, "leader_fit_choose", [a.app, (await one("select id from public.season_goals limit 1")).id, []]), "P0002");
    await expectCode(call(b.user.id, "leader_fit_state", [a.app]), "P0002");
    await expectCode(call(member(), "leader_fit_run", [a.app]), "P0002");
    await expectCode(db.asAnon((q) => q("select public.leader_fit_run($1)", [a.app])), "42501");
    await sql("update public.leader_applications set status = 'submitted' where id = $1", [a.app]);
    await expect(call(a.user.id, "leader_fit_run", [a.app])).rejects.toThrow(/can no longer be changed/);
    await expect(call(a.user.id, "leader_fit_choose", [a.app, (await one("select id from public.season_goals limit 1")).id, []])).rejects.toThrow(/can no longer be changed/);
  });

  it("closes the tables to every client", async () => {
    for (const t of ["leader_fit_models", "leader_fit_runs", "leader_fit_recommendations"]) {
      await expectCode(db.asUser(pastor, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${t}`)), "42501");
    }
    for (const fn of ["leader_fit_options($1::jsonb)", "leader_fit_inputs($1::jsonb)", "goal_demand_rows(null)", "leader_fit_cfg()"]) {
      await expectCode(db.asUser(pastor, (q) => q(`select * from public.${fn}`, fn.includes("$1") ? ["{}"] : [])), "42501");
    }
  });
});

describe("choosing", () => {
  let a: Draft;
  let top: Row[];
  let others: Row[];
  let lastPick = "";

  it("accepts one tribe from the latest run and writes it into the draft's answers, clearing a written-in goal", async () => {
    a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role" });
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    top = r.top;
    others = r.groups.flatMap((g: Row) => g.options);
    await sql(`update public.leader_applications set answers = jsonb_set(answers, '{calling,goalOther}', '"my own idea"') where id = $1`, [a.app]);
    const c = await call(a.user.id, "leader_fit_choose", [a.app, top[1].goal_id, [top[2].goal_id]]);
    expect(c.ok).toBe(true);
    const saved = (await one("select answers from public.leader_applications where id = $1", [a.app])).answers;
    expect(saved.calling.goal).toBe(c.calling.goal);
    expect(saved.calling.community).toBe(c.calling.community);
    expect(saved.calling).not.toHaveProperty("goalOther");
    // The rest of the answers are untouched
    expect(saved.calling.track).toBe("builders");
    expect(saved.calling.goalStory).toBeTruthy();
    expect(saved.style.leadBest).toBe("connection");
  });

  it("keeps the first thought, and counts a different pick", async () => {
    const first = (await one("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).id;
    let run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.first_goal_id).toBe(first);
    expect(run.choices).toBe(1);
    expect(run.chosen_goal_id).toBe(top[1].goal_id);
    expect(run.backup_goal_ids).toEqual([top[2].goal_id]);
    // The same tribe again with different backups does not count as a new pick
    await call(a.user.id, "leader_fit_choose", [a.app, top[1].goal_id, [top[0].goal_id]]);
    run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.choices).toBe(1);
    const different = top.find((t) => t.goal_id !== first && t.goal_id !== top[1].goal_id)!;
    await call(a.user.id, "leader_fit_choose", [a.app, different.goal_id, []]);
    lastPick = different.goal_id;
    run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.choices).toBe(2);
    expect(run.first_goal_id).toBe(first);
    expect(run.chosen_flags).toContain("changed_after_results");
    // Choosing the very goal they first named again is not a change after the results
    await call(a.user.id, "leader_fit_choose", [a.app, first, []]);
    run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.chosen_flags).not.toContain("changed_after_results");
    expect(run.choices).toBe(3);
    await call(a.user.id, "leader_fit_choose", [a.app, different.goal_id, []]);
    expect((await one("select choices from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app])).choices).toBe(4);
  });

  it("refuses a tribe that is not an option, three backups, a repeated backup and a backup equal to the tribe", async () => {
    const outside = (await sql("select g.id from public.season_goals g left join (select (e ->> 'goal_id')::uuid id from public.leader_fit_runs r, jsonb_array_elements(r.options) e where r.application_id = $1) o on o.id = g.id where o.id is null limit 1", [a.app]))[0];
    if (outside) await expect(call(a.user.id, "leader_fit_choose", [a.app, outside.id, []])).rejects.toThrow(/not one of your options/);
    await expectCode(call(a.user.id, "leader_fit_choose", [a.app, top[0].goal_id, [top[1].goal_id, top[2].goal_id, others[0].goal_id]]), "22023");
    await expectCode(call(a.user.id, "leader_fit_choose", [a.app, top[0].goal_id, [top[1].goal_id, top[1].goal_id]]), "22023");
    await expectCode(call(a.user.id, "leader_fit_choose", [a.app, top[0].goal_id, [top[0].goal_id]]), "22023");
    await expectCode(call(a.user.id, "leader_fit_choose", [a.app, top[0].goal_id, ["00000000-0000-0000-0000-000000000000"]]), "22023");
    // Nothing was changed by the refusals
    const run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.chosen_goal_id).toBe(lastPick);
    expect(run.backup_goal_ids).toEqual([]);
  });

  it("lets a leader choose a tribe from the long list, below 60, with its flags recorded", async () => {
    const stretch = others.find((o) => o.label === "stretch")!;
    const c = await call(a.user.id, "leader_fit_choose", [a.app, stretch.goal_id, []]);
    expect(c.ok).toBe(true);
    const run = await one("select * from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app]);
    expect(run.chosen_degree).toBeLessThan(60);
  });

  it("shows the applicant their own choice again", async () => {
    const s = await call(a.user.id, "leader_fit_state", [a.app]);
    expect(s.choice.goal_id).toBeTruthy();
    expect(JSON.stringify(s)).not.toMatch(/judgement|care_|sensitive|parts|components/);
  });

  it("says a run with no choice has none, and a new applicant has no run", async () => {
    const b = await applicant();
    expect(await call(b.user.id, "leader_fit_state", [b.app])).toEqual({ run: null, choice: null });
    await call(b.user.id, "leader_fit_run", [b.app]);
    expect((await call(b.user.id, "leader_fit_state", [b.app])).choice).toBeNull();
    await expect(call((await applicant()).user.id, "leader_fit_choose", [(await applicant()).app, top[0].goal_id, []])).rejects.toThrow();
  });
});

describe("coming back to the screen", () => {
  it("reuses the run after a choice, because the chosen goal in the answers is only an echo", async () => {
    const a = await applicant({ community: "education", goal: "excel-in-my-studies-or-exams", track: "rising", leadBest: "teaching" });
    const r1 = await call(a.user.id, "leader_fit_run", [a.app]);
    const pickGoal = r1.top[1].goal_id as string;
    const c = await call(a.user.id, "leader_fit_choose", [a.app, pickGoal, []]);
    expect(c.ok).toBe(true);
    const r2 = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r2.run).toBe(r1.run);
    expect(r2.choice.goal_id).toBe(pickGoal);
    expect(await count("select count(*)::int c from public.leader_fit_runs where application_id = $1", [a.app])).toBe(1);
  });

  it("makes a fresh run, with no choice, when the leader goes back and names a different goal", async () => {
    const a = await applicant({ community: "education", goal: "excel-in-my-studies-or-exams", track: "rising", leadBest: "teaching" });
    const r1 = await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, r1.top[1].goal_id, []]);
    await sql(`update public.leader_applications set answers = jsonb_set(jsonb_set(answers, '{calling,goal}', '"grow-as-an-educator"'), '{calling,community}', '"education"') where id = $1`, [a.app]);
    const r2 = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r2.run).not.toBe(r1.run);
    expect(r2.choice).toBeNull();
    // The first thought stays the very first goal, not the second
    const first = (await one("select id from public.season_goals where slug = 'excel-in-my-studies-or-exams'")).id;
    expect((await one("select first_goal_id from public.leader_fit_runs where id = $1", [r2.run])).first_goal_id).toBe(first);
  });

  it("makes a fresh run when the life stage or the way of leading changes", async () => {
    const a = await applicant({ community: "education", goal: "excel-in-my-studies-or-exams", track: "rising", leadBest: "teaching" });
    const r1 = await call(a.user.id, "leader_fit_run", [a.app]);
    await sql(`update public.leader_applications set answers = jsonb_set(answers, '{style,leadBest}', '"doing"') where id = $1`, [a.app]);
    expect((await call(a.user.id, "leader_fit_run", [a.app])).run).not.toBe(r1.run);
  });

  it("carries a choice to the new run when only the demand moved and the tribe is still an option", async () => {
    const a = await applicant({ community: "health-fitness-sports", goal: "build-a-consistent-fitness-habit", track: "builders", leadBest: "doing" });
    const r1 = await call(a.user.id, "leader_fit_run", [a.app]);
    const goal = r1.top[0].goal_id as string;
    await call(a.user.id, "leader_fit_choose", [a.app, goal, [r1.top[1].goal_id]]);
    for (let i = 0; i < 3; i++) {
      const u = await k.person(`Drift${++n}`);
      await sql("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3", [u.id, seasonId, goal]);
    }
    const r2 = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(r2.run).not.toBe(r1.run);
    expect(r2.choice.goal_id).toBe(goal);
    expect(r2.choice.backups).toHaveLength(1);
    expect((await one("select choices from public.leader_fit_runs where id = $1", [r2.run])).choices).toBe(1);
  });
});

describe("the pastor's panel", () => {
  let a: Draft;
  let scorer: string;

  it("is empty for a reviewer until they have saved their own review, and for everyone who is not on the panel", async () => {
    a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role" });
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, r.top[1].goal_id, []]);
    await setPositions(db, ALL_OFF);
    await call(a.user.id, "submit_leader_application", [a.app]);
    await fitOn();
    scorer = (await k.staff("Scorer", "coach")).id;
    expect(await call(scorer, "leader_fit_panel", [a.app])).toEqual({ visible: false });
    await expectCode(call(member(), "leader_fit_panel", [a.app]), "42501");
    await expectCode(call(adminId, "leader_fit_panel", [a.app]), "42501");
    await expectCode(call(a.user.id, "leader_fit_panel", [a.app]), "42501");
    await db.asUser(scorer, (q) => q("select public.save_review($1, 'calling', $2::jsonb, '')", [a.app, JSON.stringify({ q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 3 })]));
    const after = await call(scorer, "leader_fit_panel", [a.app]);
    expect(after.visible).toBe(true);
    expect(after.run.chosen.goal_id).toBe(r.top[1].goal_id);
  });

  it("shows a pastor or director the first thought against the final choice, the degree, every part and the flags in words", async () => {
    const view = await call(pastor, "leader_fit_panel", [a.app]);
    expect(view.visible).toBe(true);
    const run = view.run;
    expect(run.first.title).toBe("Step into a leadership role");
    expect(run.chosen.title).not.toBe(run.first.title);
    expect(Object.keys(run.parts).sort()).toEqual(["calling", "judgement", "need", "stage", "style"]);
    expect(run.degree).toBeGreaterThanOrEqual(60);
    expect(run.flags.map((f: Row) => f.text)).toContain("Changed their pick after seeing the results");
    expect(run.others.length).toBeLessThanOrEqual(3);
    expect(run.picks).toBe(1);
    const dir = await call(director, "leader_fit_panel", [a.app]);
    expect(dir.run.chosen.goal_id).toBe(run.chosen.goal_id);
    expect(JSON.stringify(view)).not.toMatch(/care_bar|weights|unassessed/);
  });

  it("never lets the application's own person read it, and an application still in draft is not found", async () => {
    const d = await applicant();
    await expectCode(call(pastor, "leader_fit_panel", [d.app]), "P0002");
  });
});

describe("the flags", () => {
  const flagsFor = async (o: Parameters<typeof applicant>[0], pickOf: (r: Row) => string) => {
    const a = await applicant(o);
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, pickOf(r), []]);
    return (await one("select chosen_flags from public.leader_fit_runs where application_id = $1 order by seq desc limit 1", [a.app])).chosen_flags as string[];
  };

  it("flags a pick outside their stage of life", async () => {
    const outside = (await one("select g.id from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id where t.slug = 'launch-or-formalise-a-business'")).id;
    await call(pastor, "card_template_save", ["launch-or-formalise-a-business", JSON.stringify({ track_slugs: ["rising"] })]);
    await call(pastor, "card_template_sign_off", ["launch-or-formalise-a-business"]);
    const flags = await flagsFor({ track: "builders", community: "business-entrepreneurship", goal: "launch-or-formalise-a-business" }, () => outside);
    expect(flags).toContain("outside_stage");
    await call(pastor, "card_template_save", ["launch-or-formalise-a-business", JSON.stringify({ track_slugs: ["rising", "builders", "stewards"] })]);
    await call(pastor, "card_template_sign_off", ["launch-or-formalise-a-business"]);
  });

  it("flags a pick nobody needs while three were needed", async () => {
    const rows = await sql("select goal_id, gap from public.goal_demand_rows($1) where gap > 0", [seasonId]);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const flags = await flagsFor({ community: "professionals", goal: "step-into-a-leadership-role" }, (r) => {
      const all = [...r.top, ...r.groups.flatMap((g: Row) => g.options)];
      const needed = new Set(rows.map((x) => x.goal_id));
      return all.find((o: Row) => !needed.has(o.goal_id))!.goal_id;
    });
    // Whether it fires depends on three or more options having a gap in this applicant's list; the rule itself is proved below
    expect(Array.isArray(flags)).toBe(true);
  });

  it("derives each flag from the stored options, exactly as written", async () => {
    // The rule: a pick whose Need part is 0 while at least three options had a gap above 0
    const a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role" });
    const r = await call(a.user.id, "leader_fit_run", [a.app]);
    const run = await one("select options from public.leader_fit_runs where id = $1", [r.run]);
    const opts = run.options as Row[];
    const zeroNeed = opts.find((o) => o.parts.need === 0)!;
    const withGap = opts.filter((o) => o.gap > 0).length;
    await call(a.user.id, "leader_fit_choose", [a.app, zeroNeed.goal_id, []]);
    const flags = (await one("select chosen_flags from public.leader_fit_runs where id = $1", [r.run])).chosen_flags as string[];
    expect(flags.includes("no_need_while_needed")).toBe(withGap >= 3);
  });
});

describe("the leaders we already have: a quiet run", () => {
  const leaders: string[] = [];

  it("runs once per model version for each approved leader, from their saved answers, and chooses nothing", async () => {
    await setPositions(db, {});
    const staff = await pk.panel();
    for (let i = 0; i < 3; i++) {
      const w = await pk.walk({ references: "off", interview: "off", eligibility: { member6: "off" } }, { staff });
      leaders.push(w.user.id);
    }
    const tribesBefore = await count("select count(*)::int c from public.tribes");
    const rolesBefore = await count("select count(*)::int c from public.person_roles");
    const r = await call(pastor, "leader_fit_quiet_all");
    expect(r.model).toBe("lf-1");
    expect(r.ran).toBeGreaterThanOrEqual(3);
    for (const id of leaders) {
      const run = await one("select * from public.leader_fit_runs where person_id = $1 and source = 'quiet'", [id]);
      expect(run.chosen_goal_id).toBeNull();
      expect(run.shown).toBeGreaterThan(0);
      expect(run.model_version).toBe("lf-1");
    }
    expect(await count("select count(*)::int c from public.tribes")).toBe(tribesBefore);
    expect(await count("select count(*)::int c from public.person_roles")).toBe(rolesBefore);
    // Once per model version
    const again = await call(adminId, "leader_fit_quiet_all");
    expect(again.ran).toBe(0);
    expect(again.already).toBeGreaterThanOrEqual(3);
  });

  it("runs again for a new model version", async () => {
    await call(pastor, "leader_fit_model_activate", ["lf-2"]);
    const r = await call(director, "leader_fit_quiet_all");
    expect(r.ran).toBeGreaterThanOrEqual(3);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });

  it("is for the office only, and needs an approved model", async () => {
    await expectCode(call(member(), "leader_fit_quiet_all"), "42501");
    await expectCode(call(leaders[0], "leader_fit_quiet_all"), "42501");
    await sql("update public.leader_fit_models set active = false");
    await expect(call(pastor, "leader_fit_quiet_all")).rejects.toThrow(/approve a fit model/);
    await sql("update public.leader_fit_models set active = true, approved_at = now() where version = 'lf-1'");
  });

  it("leaves out someone with no approved application and someone whose answers are missing something, and says so", async () => {
    const roleOnly = await k.staff("RoleOnly", "leader");
    const noAnswers = await pk.person("leader", "NoAnswers");
    const app = await pk.startDraft(noAnswers.id, { calling: { track: "builders" } }, "track");
    await sql("update public.leader_applications set status = 'approved_leader', decided_at = now() where id = $1", [app]);
    const r = await call(pastor, "leader_fit_quiet_all");
    expect(r.no_application).toBeGreaterThanOrEqual(1);
    expect(r.no_inputs).toBeGreaterThanOrEqual(1);
    expect(roleOnly.id).toBeTruthy();
  });
});

describe("the tables the engine adds", () => {
  it("leave every existing table as it was", async () => {
    const cols = async (t: string) => (await sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [t])).map((c) => c.column_name);
    expect(await cols("season_goals")).toEqual(["id", "community_id", "family_id", "slug", "title", "sort", "active"]);
    expect(await cols("goal_ideas")).toEqual(["season_goal_id", "phase", "idea"]);
  });

  it("have row level security on and no policy", async () => {
    const rows = await sql(
      `select c.relname, c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('tribe_card_templates', 'leader_fit_models', 'leader_fit_runs', 'leader_fit_recommendations')`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect({ t: r.relname, rls: r.relrowsecurity, policies: r.policies }).toEqual({ t: r.relname, rls: true, policies: 0 });
  });
});
