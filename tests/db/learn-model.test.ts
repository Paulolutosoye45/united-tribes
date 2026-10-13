import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, type Row, type TestDb } from "./helpers";
import { newKit, type Kit, type Person } from "./builders";

// Stage 6b: the matching model learns. After a season the system checks which parts of the Degree of
// Compatibility went with a member thriving and proposes new weights. A proposal changes nothing: an admin or
// director makes it a new version, and later switches it on.
//
// The world: Season Z finished long ago. Five tribes of twelve; in each, six people came to every meeting and
// felt they belonged (thriving), six came twice and did not. What the engine saw when it placed them:
//   goal    1.0 for the thriving, 0.4 for the others   (a strong signal)
//   community   0.9 / 0.5, place 0.9 / 0.5                 (a moderate one)
//   style, faith: vary, the same on average for both   (no signal)
//   stage, rhythm: the same for everyone               (by design: they keep their weight)

let db: TestDb;
let k: Kit;
let admin: Person;
let director: Person;
let dataLead: Person;
let pastor: Person;
let coach: Person;
let member: Person;
let seasonZ: string;

const COMPONENTS = (thriving: boolean, i: number) => ({
  goal: thriving ? 1.0 : 0.4,
  stage: 1.0,
  community: thriving ? 0.9 : 0.5,
  place: thriving ? 0.9 : 0.5,
  style: i % 2 === 0 ? 0.8 : 0.4,
  rhythm: 1.0,
  faith: i % 3 === 0 ? 0.8 : 0.6,
});

beforeAll(async () => {
  ({ db, k } = await newKit());
  admin = await k.staff("Adm", "admin");
  director = await k.staff("Dir", "director");
  dataLead = await k.staff("Dat", "data_lead");
  pastor = await k.staff("Pas", "pastor");
  coach = await k.staff("Coa", "coach");
  member = await k.person("Member");

  seasonZ = await k.season("Season Z", 200, 12);
  for (let c = 0; c < 5; c++) {
    const tribe = await k.tribe(seasonZ, { name: `Zed ${c + 1}`, certified: true });
    const people: { u: Person; thriving: boolean; i: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const thriving = i < 6;
      people.push({ u: await k.seat(tribe.tribe, seasonZ, `Z${c}-${i}`, { profile: false }), thriving, i });
    }
    await k.meetings(tribe.tribe, tribe.leader.id, 12, people.map((p) => [p.u.id, p.thriving ? 12 : 2] as [string, number]));
    for (const p of people) {
      await k.pulse(tribe.tribe, p.u.id, 1, p.thriving ? 4 : 2);
      await k.pulse(tribe.tribe, p.u.id, 12, p.thriving ? 5 : 2);
      // what the engine saw when it placed them
      const run = (
        await db.admin.query(
          "insert into public.match_runs (person_id, season_id, model_version, candidates, shown) values ($1, $2, 'v1', 3, 3) returning id",
          [p.u.id, seasonZ],
        )
      ).rows[0].id;
      await db.admin.query(
        `insert into public.match_recommendations (run_id, person_id, rank, tribe_id, degree, components, reasons, chosen)
         values ($1, $2, 1, $3, 80, $4::jsonb, '{seats_open}', true)`,
        [run, p.u.id, tribe.tribe, JSON.stringify(COMPONENTS(p.thriving, p.i))],
      );
      await db.admin.query("update public.tribe_members set model_version = 'v1', run_id = $2 where person_id = $1", [p.u.id, run]);
    }
  }
});

afterAll(async () => {
  await db.close();
});

const preview = (who: Person) => k.call(who.id, "retrain_preview") as Promise<Row>;
const models = async (who: Person = admin) => (await k.call(who.id, "list_models")) as Row[];
const weightsOf = (m: Row) => m.weights as Record<string, number>;
const total = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("who can see and change the models", () => {
  it("shows the models to the office and no one else", async () => {
    for (const who of [admin, director, pastor, dataLead]) expect((await models(who)).map((m) => m.version)).toEqual(["v1"]);
    for (const who of [coach, member]) await expectCode(k.call(who.id, "list_models"), "42501");
    await expectCode(db.asAnon((q) => q("select public.list_models()")), "42501");
  });

  it("shows what would be learned to the admin, directors and the data lead only", async () => {
    for (const who of [admin, director, dataLead]) expect((await preview(who)).base).toBe("v1");
    for (const who of [pastor, coach, member]) await expectCode(k.call(who.id, "retrain_preview"), "42501");
    await expectCode(db.asAnon((q) => q("select public.retrain_preview()")), "42501");
  });

  it("lets only the admin and directors make, switch on or remove a model", async () => {
    for (const who of [pastor, dataLead, coach, member]) {
      await expectCode(k.call(who.id, "retrain_model", ["note", true]), "42501");
      await expectCode(k.call(who.id, "activate_model", ["v1"]), "42501");
      await expectCode(k.call(who.id, "discard_model", ["v1"]), "42501");
    }
  });

  it("keeps the working parts out of reach", async () => {
    await expect(db.asUser(admin.id, (q) => q("select * from public.model_sample()"))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(admin.id, (q) => q("select public.model_proposal(null)"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("what the system reads", () => {
  it("counts only finished seasons, and only placements the engine made", async () => {
    const p = await preview(admin);
    expect(p.sample).toEqual({ n: 60, thriving: 30, other: 30, seasons: 1 });
    expect(p.enough).toBe(true);
    // 60 is well short of the 300 the weights are retrained after
    expect(p.needed).toBe(300);
    expect(p.ready).toBe(false);

    // A member who moved tribe has no run, so they are left out of what is learned
    const tribe = (await k.sql("select id from public.tribes where season_id = $1 limit 1", [seasonZ]))[0].id;
    const mover = await k.person("Mover");
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 'test', '{}'::jsonb, current_date + 14)`,
      [tribe, mover.id, seasonZ],
    );
    for (let w = 1; w <= 12; w++) {
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, $2, $3, 'present')", [tribe, w, mover.id]);
    }
    await k.pulse(tribe, mover.id, 12, 5);
    expect((await preview(admin)).sample.n).toBe(60);

    // A season still running has no result yet
    const running = await k.season("Running", 20, 12);
    const rc = await k.tribe(running, { certified: true });
    const runner = await k.seat(rc.tribe, running, "Runner", { profile: false });
    const run = (await db.admin.query("insert into public.match_runs (person_id, season_id, model_version, candidates, shown) values ($1, $2, 'v1', 3, 3) returning id", [runner.id, running])).rows[0].id;
    await db.admin.query(
      "insert into public.match_recommendations (run_id, person_id, rank, tribe_id, degree, components, reasons, chosen) values ($1, $2, 1, $3, 80, $4::jsonb, '{seats_open}', true)",
      [run, runner.id, rc.tribe, JSON.stringify(COMPONENTS(true, 0))],
    );
    await db.admin.query("update public.tribe_members set model_version = 'v1', run_id = $2 where person_id = $1", [runner.id, run]);
    expect((await preview(admin)).sample.n).toBe(60);
  });

  it("reads which parts of the score went with thriving", async () => {
    const p = await preview(admin);
    const part = (key: string) => (p.components as Row[]).find((c) => c.key === key)!;
    expect(part("goal").lift).toBeCloseTo(0.6, 3);
    expect(part("community").lift).toBeCloseTo(0.4, 3);
    expect(part("place").lift).toBeCloseTo(0.4, 3);
    expect(part("style").lift).toBeCloseTo(0, 3);
    expect(part("faith").lift).toBeCloseTo(0, 3);
    // the life stage and the rhythm are the same for everyone, so there is nothing to learn from them
    expect(part("stage").varies).toBe(false);
    expect(part("rhythm").varies).toBe(false);
    expect(part("goal").varies).toBe(true);
  });

  it("proposes small steps that still add up to 100", async () => {
    const p = await preview(admin);
    const next = p.proposed as Record<string, number>;
    const old = p.base_weights as Record<string, number>;
    expect(total(next)).toBe(100);
    expect(p.changed).toBe(true);
    // parts that cannot vary keep their weight
    expect(next.stage).toBe(old.stage);
    expect(next.rhythm).toBe(old.rhythm);
    for (const key of Object.keys(old)) {
      expect(Math.abs(next[key] - old[key]), key).toBeLessThanOrEqual(5);
      expect(next[key], key).toBeGreaterThanOrEqual(3);
    }
    // parts that went with thriving gain; parts that did not, give a little back
    expect(next.community).toBeGreaterThan(old.community);
    expect(next.place).toBeGreaterThan(old.place);
    expect(next.style).toBeLessThan(old.style);
    expect(next.faith).toBeLessThan(old.faith);
    expect(next).toEqual({ goal: 29, stage: 20, community: 17, place: 13, style: 7, rhythm: 10, faith: 4 });
    // on the same results the proposal orders members at least as well as today's weights
    expect(p.backtest.proposed).toBeGreaterThanOrEqual(p.backtest.now);
  });
});

describe("making a new version", () => {
  it("is refused when nothing has finished yet", async () => {
    const empty = await newKit();
    try {
      const boss = await empty.k.staff("Boss", "admin");
      expect((await empty.k.call(boss.id, "retrain_preview")).enough).toBe(false);
      await expectCode(empty.k.call(boss.id, "retrain_model", [null, true]), "22023");
    } finally {
      await empty.db.close();
    }
  });

  it("is refused on a small sample unless the person says they accept a rougher guess", async () => {
    await expectCode(k.call(admin.id, "retrain_model"), "22023");
    await expectCode(k.call(director.id, "retrain_model", ["tried it", false]), "22023");
    expect(await models()).toHaveLength(1);
  });

  it("keeps notes short", async () => {
    await expectCode(k.call(admin.id, "retrain_model", ["x".repeat(401), true]), "22023");
  });

  it("makes a new, inactive version beside the old one, which is never touched", async () => {
    const list = (await k.call(admin.id, "retrain_model", ["First try, on a small sample", true])) as Row[];
    expect(list.map((m) => m.version)).toEqual(["v2", "v1"]);
    const v2 = list[0];
    expect(v2.active).toBe(false);
    expect(v2.parent).toBe("v1");
    expect(v2.notes).toBe("First try, on a small sample");
    expect(v2.created_by).toBe("Adm Test");
    expect(v2.trained.small).toBe(true);
    expect(v2.trained.sample.n).toBe(60);
    expect(total(weightsOf(v2))).toBe(100);
    const v1 = list[1];
    expect(v1.active).toBe(true);
    expect(weightsOf(v1)).toEqual({ goal: 30, stage: 20, community: 15, place: 10, style: 10, rhythm: 10, faith: 5 });
    // every earlier placement is still tied to the weights it was made with
    expect(v1.placements).toBe(61);
    expect(v1.results).toEqual({ n: 60, thriving: 30 });
    expect(v1.used).toBe(true);
    expect(v2.used).toBe(false);
    const log = await k.sql("select meta from public.event_log where action = 'model.created' and entity_id = 'v2'");
    expect(log).toHaveLength(1);
    expect(log[0].meta).toMatchObject({ from: "v1", small: true });
  });

  it("can be thrown away while no one has been matched with it, and not after", async () => {
    await expectCode(k.call(admin.id, "discard_model", ["v1"]), "22023"); // in use
    await expectCode(k.call(admin.id, "discard_model", ["nope"]), "P0002");
    await k.call(admin.id, "retrain_model", ["to discard", true]);
    const v3 = (await models()).find((m) => m.version === "v3")!;
    expect(v3.notes).toBe("to discard");
    const after = (await k.call(director.id, "discard_model", ["v3"])) as Row[];
    expect(after.map((m) => m.version)).toEqual(["v2", "v1"]);
    // the next one reuses the number: versions are v1, v2, then v3 again
    await k.call(admin.id, "retrain_model", [null, true]);
    expect((await models())[0].version).toBe("v3");
    await k.call(admin.id, "discard_model", ["v3"]);
  });
});

describe("switching a model on", () => {
  it("asks for confirmation when it was learned from a small sample", async () => {
    await expectCode(k.call(admin.id, "activate_model", ["v2"]), "22023");
    await expectCode(k.call(admin.id, "activate_model", ["v2", false]), "22023");
    await expectCode(k.call(admin.id, "activate_model", ["nope", true]), "P0002");
    await expectCode(k.call(admin.id, "activate_model", ["v1"]), "22023"); // already in use
  });

  it("makes it the only model in use, and new matches use its weights", async () => {
    const list = (await k.call(director.id, "activate_model", ["v2", true])) as Row[];
    expect(list.filter((m) => m.active).map((m) => m.version)).toEqual(["v2"]);
    const v2 = list.find((m) => m.version === "v2")!;
    expect(v2.activated_at).toBeTruthy();
    expect(list.find((m) => m.version === "v1")!.active).toBe(false);
    expect((await k.sql("select count(*)::int as n from public.match_models where active"))[0].n).toBe(1);

    // a member who now asks for tribes is matched with the new weights, and the run says so
    const next = await k.season("Season B", -30, 12);
    await k.tribe(next, { certified: true });
    const m2 = await k.person("Asker");
    await k.profile(m2.id, next);
    await k.call(m2.id, "match_me", [true]);
    const run = await k.sql("select model_version from public.match_runs where person_id = $1", [m2.id]);
    expect(run.map((r) => r.model_version)).toEqual(["v2"]);
    const rec = await k.sql("select degree, components from public.match_recommendations where person_id = $1", [m2.id]);
    expect(rec).toHaveLength(1);
    const w = weightsOf(v2);
    const c = rec[0].components as Record<string, number>;
    const expected = Math.round(w.goal * c.goal + w.stage * c.stage + w.community * c.community + w.place * c.place + w.style * c.style + w.rhythm * c.rhythm + w.faith * c.faith);
    expect(Math.abs(rec[0].degree - expected)).toBeLessThanOrEqual(1);
    const log = await k.sql("select actor_id from public.event_log where action = 'model.activated' and entity_id = 'v2'");
    expect(log).toHaveLength(1);
    expect(log[0].actor_id).toBe(director.id);
  });

  it("will not remove the model in use, or one that was used", async () => {
    await expectCode(k.call(admin.id, "discard_model", ["v2"]), "22023");
    await expectCode(k.call(admin.id, "discard_model", ["v1"]), "22023");
  });
});

describe("when there is enough to go on", () => {
  it("is ready after the number of placements the weights are retrained after", async () => {
    await k.call(admin.id, "set_kpi_target", ["retrain_after", 50]);
    const p = await preview(admin);
    expect(p.needed).toBe(50);
    expect(p.ready).toBe(true);
    // the next proposal starts from the model now in use
    expect(p.base).toBe("v2");
    expect(total(p.proposed)).toBe(100);
  });

  it("makes a version that is not marked small, which can be switched on without a second confirmation", async () => {
    const list = (await k.call(admin.id, "retrain_model")) as Row[];
    const v3 = list[0];
    expect(v3.version).toBe("v3");
    expect(v3.parent).toBe("v2");
    expect(v3.trained.small).toBe(false);
    expect(v3.notes).toBe("Learned from 60 placements.");
    expect(Math.max(...Object.keys(weightsOf(v3)).map((key) => Math.abs(weightsOf(v3)[key] - weightsOf(list.find((m) => m.version === "v2")!)[key])))).toBeLessThanOrEqual(5);
    const after = (await k.call(admin.id, "activate_model", ["v3"])) as Row[];
    expect(after.find((m) => m.active)!.version).toBe("v3");
    // earlier recommendations still point at the version that made them
    const old = await k.sql("select count(*)::int as n from public.tribe_members where model_version = 'v1'");
    expect(old[0].n).toBe(61);
  });
});
