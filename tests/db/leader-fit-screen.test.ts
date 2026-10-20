import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { ALL_OFF, answers, calling, pipelineKit, setPositions, type PipelineKit } from "./pipeline-kit";

// Phase 6: the "Find your tribe" screen. The pieces in the database are the ready check, the send gate, "Tribes you could lead next
// season" for a leader we already have, and the Admin card. The tests here also prove that the leaders' first check on the written
// answers is untouched by the new screen: it still comes first, with the same words.

let db: TestDb;
let k: Kit;
let pk: PipelineKit;
let pastor: string;
let director: string;
let adminId: string;
let n = 0;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;
const ready = async () => (await one("select public.leader_fit_ready() as r")).r as boolean;
const setFit = (v: "on" | "off") => db.admin.query("update public.leader_pipeline_settings set tribe_fit = $1", [v]);
const rawSubmit = (uid: string, app: string) => db.asUser(uid, (q) => q("select public.submit_leader_application($1) as r", [app]));

type Draft = { user: { id: string }; app: string };
async function applicant(o: { track?: string; community?: string; goal?: string; goalOther?: string } = {}): Promise<Draft> {
  const user = await pk.person(undefined, `Applicant${++n}`);
  const app = await pk.startDraft(
    user.id,
    answers(undefined, {
      calling: calling({
        track: o.track ?? "builders",
        community: o.community ?? "professionals",
        goal: o.goalOther ? undefined : (o.goal ?? "step-into-a-leadership-role"),
        goalOther: o.goalOther,
      }),
    }),
    "lead-best",
  );
  return { user, app };
}

const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug])).id as string;
const signOff = (slug: string) => call(pastor, "card_template_sign_off", [slug]);

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  pk = pipelineKit(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  await setPositions(db, ALL_OFF);
});

afterAll(async () => {
  await db?.close();
});

describe("ready", () => {
  it("is false in a new database: no model is approved and no card is signed off", async () => {
    expect(await ready()).toBe(false);
  });

  it("is false with a signed-off card and no approved model", async () => {
    await signOff("step-into-a-leadership-role");
    expect(await ready()).toBe(false);
  });

  it("is false with an approved model and no signed-off card", async () => {
    await call(pastor, "card_template_retire", ["step-into-a-leadership-role"]);
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    expect(await ready()).toBe(false);
  });

  it("is true with both", async () => {
    await signOff("step-into-a-leadership-role");
    expect(await ready()).toBe(true);
  });

  it("goes back to false when the only signed card's goal, or its community, is switched off", async () => {
    const goal = await goalId("step-into-a-leadership-role");
    await db.admin.query("update public.season_goals set active = false where id = $1", [goal]);
    expect(await ready()).toBe(false);
    await db.admin.query("update public.season_goals set active = true where id = $1", [goal]);
    await db.admin.query("update public.communities set active = false where slug = 'professionals'");
    expect(await ready()).toBe(false);
    await db.admin.query("update public.communities set active = true where slug = 'professionals'");
    expect(await ready()).toBe(true);
  });

  it("is closed to every client", async () => {
    await expectCode(db.asUser(pastor, (q) => q("select public.leader_fit_ready()")), "42501");
    await expectCode(db.asUser(pastor, (q) => q("select public.leader_fit_gate($1)", ["00000000-0000-0000-0000-000000000000"])), "42501");
  });
});

describe("the switch", () => {
  it("refuses On while it is not ready, and accepts it when it is", async () => {
    await call(pastor, "card_template_retire", ["step-into-a-leadership-role"]);
    await expect(call(director, "leader_pipeline_set", [{ tribe_fit: "on" }, null])).rejects.toThrow(/Find your tribe cannot be switched on/);
    expect((await one("select tribe_fit from public.leader_pipeline_settings")).tribe_fit).toBe("off");
    await signOff("step-into-a-leadership-role");
    const r = await call(director, "leader_pipeline_set", [{ tribe_fit: "on" }, "Ready"]);
    expect(r.positions.tribe_fit).toBe("on");
    expect(await count("select count(*)::int c from public.leader_pipeline_log where setting = 'tribe_fit' and new_value = 'on'")).toBe(1);
    await setFit("off");
  });

  it("is left Off by the open door while not ready, with the note, and On once ready", async () => {
    await call(pastor, "card_template_retire", ["step-into-a-leadership-role"]);
    const off = await call(director, "leader_pipeline_preset", ["open_door"]);
    expect(off.positions.tribe_fit).toBe("off");
    expect(off.note).toMatch(/stays off for now/);
    await signOff("step-into-a-leadership-role");
    const on = await call(director, "leader_pipeline_preset", ["open_door"]);
    expect(on.positions.tribe_fit).toBe("on");
    expect(on.note).toBeNull();
    // The full process always puts it Off
    expect((await call(director, "leader_pipeline_preset", ["full"])).positions.tribe_fit).toBe("off");
    await setPositions(db, ALL_OFF);
  });
});

describe("the send gate", () => {
  it("does nothing while Find your tribe is Off", async () => {
    await setFit("off");
    const a = await applicant();
    await rawSubmit(a.user.id, a.app);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("submitted");
    expect(await count("select count(*)::int c from public.leader_fit_runs where application_id = $1", [a.app])).toBe(0);
  });

  it("does nothing when it is On and there is nothing to choose", async () => {
    // The only signed-off card suits sages; a builder is two stages away from it
    await call(pastor, "card_template_save", ["step-into-a-leadership-role", JSON.stringify({ track_slugs: ["sages"] })]);
    await signOff("step-into-a-leadership-role");
    await setFit("on");
    const a = await applicant();
    expect(await call(a.user.id, "leader_fit_run", [a.app])).toMatchObject({ status: "ok", options: 0 });
    await rawSubmit(a.user.id, a.app);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("submitted");
    // ...and with no run at all
    const b = await applicant();
    await rawSubmit(b.user.id, b.app);
    expect((await one("select status from public.leader_applications where id = $1", [b.app])).status).toBe("submitted");
    await call(pastor, "card_template_save", ["step-into-a-leadership-role", JSON.stringify({ track_slugs: ["rising", "builders", "stewards"] })]);
    await signOff("step-into-a-leadership-role");
  });

  it("does nothing when it is On but no model is approved, so nobody is stuck", async () => {
    await db.admin.query("update public.leader_fit_models set active = false");
    const a = await applicant();
    await rawSubmit(a.user.id, a.app);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("submitted");
    await db.admin.query("update public.leader_fit_models set active = true where version = 'lf-1'");
  });

  it("refuses with 'Choose your tribe first' when there are options and no run, or a run with no choice", async () => {
    await setFit("on");
    const a = await applicant();
    await expectCode(rawSubmit(a.user.id, a.app), "22023");
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/Choose your tribe first/);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("draft");
    // A run is not a choice
    await signOff("grow-a-network-that-opens-doors");
    await call(a.user.id, "leader_fit_run", [a.app]);
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/Choose your tribe first/);
  });

  it("passes when the latest run has a choice and that tribe is the goal in the answers", async () => {
    const a = await applicant();
    const run = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(run.options).toBeGreaterThan(0);
    const c = await call(a.user.id, "leader_fit_choose", [a.app, run.top[0].goal_id, []]);
    expect(c.ok).toBe(true);
    await rawSubmit(a.user.id, a.app);
    const sent = await one("select status, answers from public.leader_applications where id = $1", [a.app]);
    expect(sent.status).toBe("submitted");
    expect(sent.answers.calling.goal).toBe(c.calling.goal);
  });

  it("refuses when the form's autosave brought back the old goal after the choice, and passes again once the tribe is chosen", async () => {
    const a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role" });
    const run = await call(a.user.id, "leader_fit_run", [a.app]);
    const other = run.top.find((t: Row) => t.title !== "Step into a leadership role") ?? run.top[1];
    await call(a.user.id, "leader_fit_choose", [a.app, other.goal_id, []]);
    // The race: a save that carries the answers as they were before the choice lands afterwards
    await db.asUser(a.user.id, (q) =>
      q("update public.leader_applications set answers = jsonb_set(jsonb_set(answers, '{calling,goal}', '\"step-into-a-leadership-role\"'), '{calling,community}', '\"professionals\"') where id = $1", [a.app]),
    );
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/Choose your tribe first/);
    // The normal order: the form takes the returned calling values into its state first, so its next save carries the choice
    const again = await call(a.user.id, "leader_fit_choose", [a.app, other.goal_id, []]);
    await db.asUser(a.user.id, (q) =>
      q("update public.leader_applications set answers = jsonb_set(answers, '{calling}', answers -> 'calling' || $2::jsonb) where id = $1", [a.app, JSON.stringify({ goal: again.calling.goal, community: again.calling.community })]),
    );
    await rawSubmit(a.user.id, a.app);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("submitted");
  });

  it("refuses when the leader changed their life stage after choosing, until they have seen the screen again", async () => {
    const a = await applicant({ community: "professionals", goal: "step-into-a-leadership-role", track: "builders" });
    const run = await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, run.top[0].goal_id, []]);
    await db.asUser(a.user.id, (q) => q("update public.leader_applications set answers = jsonb_set(answers, '{calling,track}', '\"stewards\"') where id = $1", [a.app]));
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/Choose your tribe first/);
    // Back on the screen, the run is made again and the choice, still the goal in the answers and still an option, is kept
    const fresh = await call(a.user.id, "leader_fit_run", [a.app]);
    expect(fresh.run).not.toBe(run.run);
    expect(fresh.choice.goal_id).toBe(run.top[0].goal_id);
    await rawSubmit(a.user.id, a.app);
    expect((await one("select status from public.leader_applications where id = $1", [a.app])).status).toBe("submitted");
  });

  it("asks a leader who wrote their own goal to choose a tribe, and the choice clears the write-in", async () => {
    const a = await applicant({ goalOther: "Help young people start small businesses" });
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/Choose your tribe first/);
    const run = await call(a.user.id, "leader_fit_run", [a.app]);
    const c = await call(a.user.id, "leader_fit_choose", [a.app, run.top[0].goal_id, []]);
    expect(c.calling).not.toHaveProperty("goalOther");
    await rawSubmit(a.user.id, a.app);
    const sent = await one("select answers from public.leader_applications where id = $1", [a.app]);
    expect(sent.answers.calling.goalOther).toBeUndefined();
  });

  it("leaves a sent application and the readiness numbers as they were: the run adds nothing to the score", async () => {
    const a = await applicant();
    const run = await call(a.user.id, "leader_fit_run", [a.app]);
    await call(a.user.id, "leader_fit_choose", [a.app, run.top[0].goal_id, []]);
    await rawSubmit(a.user.id, a.app);
    const b = await applicant();
    await setFit("off");
    await rawSubmit(b.user.id, b.app);
    await setFit("on");
    const fa = await one("select scenario_pct from public.leader_assessments where application_id = $1", [a.app]);
    const fb = await one("select scenario_pct from public.leader_assessments where application_id = $1", [b.app]);
    expect(fa.scenario_pct).toBe(fb.scenario_pct);
    const ra = await pk.readiness(a.app);
    const rb = await pk.readiness(b.app);
    expect(Object.keys(ra).sort()).toEqual(Object.keys(rb).sort());
  });
});

describe("the first check on the written answers still comes first", () => {
  afterAll(async () => {
    await db.admin.query("update public.leader_ai_settings set mode = 'off'");
  });

  it("asks for the updated wording before it asks for a tribe", async () => {
    await setFit("on");
    await db.admin.query("update public.leader_ai_settings set mode = 'on'");
    const a = await applicant();
    await expect(rawSubmit(a.user.id, a.app)).rejects.toThrow(/updated wording/);
  });

  it("asks for the quick check on each written answer before it asks for a tribe", async () => {
    const a = await applicant();
    await db.admin.query("update public.leader_applications set consent_version = consent_version where id = $1", [a.app]);
    await expect(rawSubmit(a.user.id, a.app)).rejects.not.toThrow(/Choose your tribe first/);
  });

  it("does not let the screen pass answers that are too short: the minimum words is checked whatever the tribe", async () => {
    const short = await pk.person(undefined, `Short${++n}`);
    const app = await pk.startDraft(short.id, answers(undefined, { calling: calling({ why: "Too short here, honestly." }) }), "lead-best");
    await expect(rawSubmit(short.id, app)).rejects.toThrow(/at least 20 characters|few sentences|updated wording|a little more/);
  });

  it("keeps every rule of the first check in the sent function, in the same order, with the tribe gate after them", async () => {
    const body = (await one("select pg_get_functiondef('public.submit_leader_application(uuid)'::regprocedure) as d")).d as string;
    const at = (needle: string) => body.indexOf(needle);
    expect(at("leader_ai_consent_ok")).toBeGreaterThan(0);
    expect(at("leader_word_count")).toBeGreaterThan(at("leader_ai_consent_ok"));
    expect(at("leader_answer_checks")).toBeGreaterThan(at("leader_word_count"));
    expect(at("perform public.leader_fit_gate")).toBeGreaterThan(at("leader_answer_checks"));
    expect(at("leader_ai_enqueue")).toBeGreaterThan(at("perform public.leader_fit_gate"));
  });
});

describe("tribes you could lead next season", () => {
  let leader: { id: string };
  let assistant: { id: string };

  it("is for leaders and assistant leaders only", async () => {
    const member = await k.person("Member");
    leader = await pk.person("leader", "Leader");
    assistant = await pk.person("assistant_leader", "Assistant");
    await expectCode(db.asUser(member.id, (q) => q("select public.leader_fit_mine()")), "42501");
    await expectCode(db.asUser(pastor, (q) => q("select public.leader_fit_mine()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.leader_fit_mine()")), "42501");
    const a = await applicant();
    await expectCode(db.asUser(a.user.id, (q) => q("select public.leader_fit_mine()")), "42501");
  });

  it("says Off while Find your tribe is off, and none while the leader has no run", async () => {
    await setFit("off");
    expect(await call(leader.id, "leader_fit_mine")).toEqual({ status: "off" });
    await setFit("on");
    expect(await call(leader.id, "leader_fit_mine")).toEqual({ status: "none" });
  });

  it("shows the top three of the quiet run: words, percentages and reasons only, none of the engine's inner workings", async () => {
    for (const slug of ["grow-a-network-that-opens-doors", "find-a-mentor-and-become-one", "handle-workplace-conflict-with-grace", "change-career-direction-with-confidence"]) await signOff(slug);
    // An approved application is where a quiet run gets its answers
    const app = await pk.startDraft(leader.id, answers(), "done");
    await db.admin.query("update public.leader_applications set status = 'approved_leader', decided_at = now() where id = $1", [app]);
    const r = await call(pastor, "leader_fit_quiet_all");
    expect(r.ran).toBeGreaterThanOrEqual(1);
    const mine = await call(leader.id, "leader_fit_mine");
    expect(mine.status).toBe("ok");
    expect(mine.options.length).toBe(3);
    for (const o of mine.options) {
      expect(["excellent", "strong", "good"]).toContain(o.label);
      expect(o.degree).toBeGreaterThanOrEqual(60);
      expect(o.reasons.length).toBeGreaterThan(0);
      expect(Object.keys(o).sort()).toEqual(["community", "degree", "goal_id", "label", "reasons", "title"]);
    }
    expect(mine.options.map((o: Row) => o.degree)).toEqual([...mine.options.map((o: Row) => o.degree)].sort((x: number, y: number) => y - x));
    const text = JSON.stringify(mine);
    expect(text).not.toMatch(/\b(judgement|care|sensitive|parts|weights|model|gap|waiting)\b/i);
  });

  it("leaves out the goals of the tribes they already lead this season, and fills the places from the next recommended", async () => {
    const mine = await call(leader.id, "leader_fit_mine");
    const topGoal = mine.options[0].goal_id as string;
    const season = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
    const t = await k.tribe(season, { community: "professionals" });
    await db.admin.query("update public.tribes set leader_id = $2, season_goal_id = $3 where id = $1", [t.tribe, leader.id, topGoal]);
    const after = await call(leader.id, "leader_fit_mine");
    expect(after.options.map((o: Row) => o.goal_id)).not.toContain(topGoal);
    expect(after.options).toHaveLength(3);
    for (const o of after.options) expect(o.reasons.length).toBeGreaterThan(0);
    // An assistant leader has the same page, with their own run
    expect((await call(assistant.id, "leader_fit_mine")).status).toBe("none");
  });

  it("changes nothing: the leader's tribes, roles and applications are as they were", async () => {
    const before = await one("select (select count(*)::int from public.tribes) t, (select count(*)::int from public.person_roles) r, (select count(*)::int from public.leader_applications) a");
    await call(leader.id, "leader_fit_mine");
    await call(pastor, "leader_fit_quiet_all");
    const after = await one("select (select count(*)::int from public.tribes) t, (select count(*)::int from public.person_roles) r, (select count(*)::int from public.leader_applications) a");
    expect(after).toEqual(before);
  });
});

describe("the Admin card", () => {
  it("shows the switch, whether it is ready, the model, the cards signed off out of the total and the leaders who have a quiet run", async () => {
    const s = await call(adminId, "leader_fit_status");
    expect(s.tribe_fit).toBe("on");
    expect(s.ready).toBe(true);
    expect(s.model.version).toBe("lf-1");
    expect(s.model.approved_by).toBe("Pastor Test");
    expect(s.cards.total).toBe(100);
    expect(s.cards.signed_off).toBe(await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'"));
    expect(s.leaders.quiet_run).toBeGreaterThanOrEqual(1);
    expect(s.leaders.total).toBeGreaterThanOrEqual(s.leaders.quiet_run);
    for (const who of [pastor, director]) expect((await call(who, "leader_fit_status")).ready).toBe(true);
  });

  it("is for the office only", async () => {
    const member = (await k.person("Plain")).id;
    await expectCode(db.asUser(member, (q) => q("select public.leader_fit_status()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.leader_fit_status()")), "42501");
  });

  it("never names a hidden owner as the approver", async () => {
    const owner = (await pk.person("pastor", "Owner")).id;
    await db.admin.query("update public.people set hidden = true where id = $1", [owner]);
    await call(owner, "leader_fit_model_save", [JSON.stringify({ care_bar: 65 }), "A hidden hand."]);
    await call(owner, "leader_fit_model_activate", ["lf-2"]);
    const s = await call(adminId, "leader_fit_status");
    expect(s.model.version).toBe("lf-2");
    expect(s.model.approved_by).toBeNull();
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });

  it("says Off and not ready for a database that has neither", async () => {
    const fresh = await createTestDb();
    try {
      const staff = (await (await makeKit(fresh)).staff("Admin", "admin")).id;
      const s = (await fresh.asUser(staff, (q) => q("select public.leader_fit_status() as r"))).rows[0].r;
      expect(s).toMatchObject({ tribe_fit: "off", ready: false, model: null, cards: { signed_off: 0, total: 100 }, leaders: { quiet_run: 0 } });
    } finally {
      await fresh.close();
    }
  });
});

describe("the funnel and the saved step", () => {
  it("knows the same steps as before: Find your tribe is a view, never a saved step", async () => {
    const steps = (await sql("select step from public.activity_steps where form = 'leader' order by position")).map((r) => r.step);
    expect(steps).toContain("lead-best");
    expect(steps).not.toContain("find-tribe");
    expect(steps.length).toBe(21);
  });
});
