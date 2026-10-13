import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, type Row, type TestDb } from "./helpers";
import { newKit, type Kit, type Person } from "./builders";

// Stage 6b: the multiplication planner. "Multiply" is a number on the dashboard (tribes whose assistant is certified
// ready to lead). This is where it becomes a decision: for each tribe, what happens next season.
//
// The world (season S is in its eleventh week):
//   Tribe One   coach Anna, assistant certified
//   Tribe Two   coach Anna, assistant still in training
//   Tribe Three   coach Bayo, no assistant
//   D   a tribe that was never published (draft), not part of the plan
//   and a second centre with a tribe of its own, which this centre must never touch

let db: TestDb;
let k: Kit;
let S: string;
let admin: Person;
let director: Person;
let pastor: Person;
let anna: Person;
let bayo: Person;
let dataLead: Person;
let careLead: Person;
let member: Person;
let c1: Awaited<ReturnType<Kit["tribe"]>>;
let c2: Awaited<ReturnType<Kit["tribe"]>>;
let c3: Awaited<ReturnType<Kit["tribe"]>>;
let communityId: string;
let businessId: string;

beforeAll(async () => {
  ({ db, k } = await newKit());
  admin = await k.staff("Adm", "admin");
  director = await k.staff("Dir", "director");
  pastor = await k.staff("Pas", "pastor");
  anna = await k.staff("Anna", "coach");
  bayo = await k.staff("Bayo", "coach");
  dataLead = await k.staff("Dat", "data_lead");
  careLead = await k.staff("Car", "care_lead");
  member = await k.person("Member");

  S = await k.season("S", 70);
  c1 = await k.tribe(S, { name: "Tribe One", coach: anna.id, assistant: "certified" });
  c2 = await k.tribe(S, { name: "Tribe Two", coach: anna.id, assistant: "training", community: "business-entrepreneurship" });
  c3 = await k.tribe(S, { name: "Tribe Three", coach: bayo.id });
  await k.tribe(S, { name: "Draft tribe", status: "draft" });
  for (let i = 0; i < 3; i++) await k.seat(c1.tribe, S, `P${i}`, { profile: false });

  communityId = await k.lookup("communities", "professionals");
  businessId = await k.lookup("communities", "business-entrepreneurship");
  // Members the matching could not place well
  const builders = await k.lookup("tracks", "builders");
  for (const shown of [0, 1, 2]) {
    const p = await k.person(`Waiting${shown}`);
    await db.admin.query(
      `insert into public.match_demand (person_id, season_id, track_id, community_id, tribe_kind, shown) values ($1, $2, $3, $4, 'mixed', $5)`,
      [p.id, S, builders, communityId, shown],
    );
  }
});

afterAll(async () => {
  await db.close();
});

const board = async (who: Person, season: string | null = null) => (await k.call(who.id, "multiplication_board", [season])) as Row;
const tribeOf = (b: Row, name: string) => (b.tribes as Row[]).find((c) => c.name === name)!;
const plan = (who: Person, tribe: string, p: string, community: string | null = null, note: string | null = null) =>
  k.call(who.id, "plan_multiplication", [tribe, p, community, note]) as Promise<Row>;

describe("who can plan", () => {
  it("is a coach, a pastor, a director or the admin", async () => {
    for (const who of [admin, director, pastor, anna, bayo]) expect((await board(who)).state).toBe("ok");
    for (const who of [dataLead, careLead, member, c1.leader, c1.assistant!]) {
      await expectCode(k.call(who.id, "multiplication_board", [null]), "42501");
      await expectCode(k.call(who.id, "plan_multiplication", [c1.tribe, "leader_continues", null, null]), "42501");
      await expectCode(k.call(who.id, "clear_multiplication_plan", [c1.tribe]), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.multiplication_board(null)")), "42501");
    await expect(db.asUser(director.id, (q) => q("select * from public.multiplication_plans"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("the board", () => {
  it("shows the office every tribe of the season, and where each assistant stands", async () => {
    const b = await board(director);
    expect(b.season.name).toBe("S");
    expect(b.summary).toEqual({ tribes: 3, with_assistant: 2, certified: 1, new_planned: 0 });
    expect(tribeOf(b, "Tribe One")).toMatchObject({ assistant_state: "certified", members: 3, plan: null });
    expect(tribeOf(b, "Tribe Two").assistant_state).toBe("in_training");
    expect(tribeOf(b, "Tribe Three")).toMatchObject({ assistant: null, assistant_state: "none" });
    expect((b.tribes as Row[]).map((c) => c.name)).not.toContain("Draft tribe");
    expect((b.communities as Row[]).length).toBeGreaterThan(5);
  });

  it("shows where members could not be placed well: the best places for a new tribe", async () => {
    const b = await board(pastor);
    expect(b.gaps).toEqual([{ community: "Professionals", track: "Builders", kind: "mixed", members: 3 }]);
  });

  it("shows a coach their own tribes and not the gaps", async () => {
    const a = await board(anna);
    expect((a.tribes as Row[]).map((c) => c.name)).toEqual(["Tribe One", "Tribe Two"]);
    expect(a.gaps).toEqual([]);
    expect((await board(bayo)).tribes.map((c: Row) => c.name)).toEqual(["Tribe Three"]);
    expect(a.summary).toMatchObject({ tribes: 2, certified: 1 });
  });

  it("agrees with the dashboard's Multiply figure", async () => {
    const insight = (await k.call(director.id, "insight", [S])) as Row;
    const multiply = (insight.kpis as Row[]).find((x) => x.key === "multiply")!;
    expect(multiply.value).toBeCloseTo(1 / 3, 3);
  });
});

describe("planning", () => {
  it("lets a certified assistant be planned to lead a new tribe, in a community", async () => {
    await expectCode(plan(anna, c1.tribe, "assistant_leads"), "22023"); // which community?
    await expectCode(plan(anna, c1.tribe, "assistant_leads", "00000000-0000-4000-8000-000000000000"), "22023");
    const b = await plan(anna, c1.tribe, "assistant_leads", communityId, "Ready, and has led twice already");
    expect(tribeOf(b, "Tribe One")).toMatchObject({
      plan: "assistant_leads", plan_community: "Professionals", note: "Ready, and has led twice already", decided_by: "Anna",
    });
    expect(b.summary.new_planned).toBe(1);
  });

  it("will not plan for an assistant who has not finished training, or who is not there", async () => {
    await expectCode(plan(anna, c2.tribe, "assistant_leads", businessId), "22023");
    await expectCode(plan(bayo, c3.tribe, "assistant_leads", communityId), "22023");
  });

  it("can plan the other things that happen to a tribe", async () => {
    for (const p of ["leader_continues", "leader_rests", "closes"]) {
      const b = await plan(anna, c2.tribe, p, null, "talked it through");
      expect(tribeOf(b, "Tribe Two")).toMatchObject({ plan: p, plan_community: null });
    }
    await expectCode(plan(anna, c2.tribe, "retire"), "22023");
    await expectCode(plan(anna, c2.tribe, null as unknown as string), "22023");
    await expectCode(plan(anna, c2.tribe, "closes", null, "x".repeat(301)), "22023");
  });

  it("keeps a coach to their own tribes", async () => {
    await expectCode(plan(anna, c3.tribe, "leader_continues"), "P0002");
    await expectCode(plan(bayo, c1.tribe, "leader_continues"), "P0002");
    await expectCode(plan(anna, "00000000-0000-4000-8000-000000000000", "leader_continues"), "P0002");
    for (const who of [director, pastor, admin]) await plan(who, c3.tribe, "leader_continues");
  });

  it("changes its mind: a new plan replaces the old, and a community goes with the plan it was chosen for", async () => {
    const b = await plan(director, c1.tribe, "leader_continues");
    expect(tribeOf(b, "Tribe One")).toMatchObject({ plan: "leader_continues", plan_community: null, decided_by: "Dir" });
    expect(b.summary.new_planned).toBe(0);
    expect((await k.sql("select count(*)::int as n from public.multiplication_plans where tribe_id = $1", [c1.tribe]))[0].n).toBe(1);
    await plan(anna, c1.tribe, "assistant_leads", businessId);
    expect((await k.sql("select community_id from public.multiplication_plans where tribe_id = $1", [c1.tribe]))[0].community_id).toBe(businessId);
  });

  it("is written to the log, without anything personal", async () => {
    const log = await k.sql("select actor_id, meta from public.event_log where action = 'multiply.planned' and entity_id = $1 order by id", [c1.tribe]);
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log[0]).toMatchObject({ actor_id: anna.id, meta: { plan: "assistant_leads" } });
  });

  it("changes no one's role, certificate or the dashboard's figure", async () => {
    expect((await k.sql("select as_role from public.leader_certifications where person_id = $1", [c1.assistant!.id]))[0].as_role).toBe("assistant_leader");
    const roles = await k.sql("select role::text as role from public.person_roles where person_id = $1", [c1.assistant!.id]);
    expect(roles.map((r) => r.role).sort()).toEqual(["assistant_leader", "member"]);
    const insight = (await k.call(director.id, "insight", [S])) as Row;
    expect((insight.kpis as Row[]).find((x) => x.key === "multiply")!.value).toBeCloseTo(1 / 3, 3);
  });
});

describe("taking a plan back", () => {
  it("returns a tribe to 'not decided yet'", async () => {
    await expectCode(k.call(bayo.id, "clear_multiplication_plan", [c1.tribe]), "P0002");
    const b = (await k.call(anna.id, "clear_multiplication_plan", [c1.tribe])) as Row;
    expect(tribeOf(b, "Tribe One").plan).toBeNull();
    expect((await k.sql("select 1 from public.event_log where action = 'multiply.cleared' and entity_id = $1", [c1.tribe])).length).toBe(1);
  });
});

describe("another centre", () => {
  it("is out of reach", async () => {
    const other = (await db.admin.query("insert into public.centres (slug, name) values ('tcn-other', 'TCN Other') returning id")).rows[0].id;
    const season = (
      await db.admin.query(
        `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks)
         values ($1, 'Other S', public.today_lagos() - 70, public.today_lagos() + 13, 12) returning id`,
        [other],
      )
    ).rows[0].id;
    const foreign = await k.tribe(season, { name: "Foreign", coach: anna.id });
    await expectCode(plan(director, foreign.tribe, "leader_continues"), "P0002");
    await expectCode(plan(anna, foreign.tribe, "leader_continues"), "P0002");
    await expectCode(k.call(director.id, "clear_multiplication_plan", [foreign.tribe]), "P0002");
    expect((await board(director, season)).state).toBe("none");
  });
});
