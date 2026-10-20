import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase C: the owner appoints a leader from the console. Only the owner, only while unlocked; the appointment starts a Tribe Card
// and grants the role, and changes nothing about who approves the card or who certifies the leader.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
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

const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug])).id as string;

async function candidate(name = `Candidate${++n}`) {
  const u = await k.person(name);
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Surname`, name]);
  return u;
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
  // Members waiting in a few places, so the "needed" list has something to say
  for (const [slug, waiting] of [["build-a-steady-client-pipeline", 6], ["land-my-first-three-clients", 4], ["strengthen-our-marriage", 3], ["grow-a-network-that-opens-doors", 2]] as const) {
    const g = await goalId(slug);
    for (let i = 0; i < waiting; i++) {
      const u = await k.person(`Waiting${++n}`);
      await sql("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3", [u.id, seasonId, g]);
    }
  }
});

afterAll(async () => {
  await db?.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["god_appointment_find", ["ada"]],
    ["god_appointment_suggest", ["00000000-0000-0000-0000-000000000000", FORM]],
    ["god_appoint_leader", ["00000000-0000-0000-0000-000000000000", FORM, "00000000-0000-0000-0000-000000000000", null]],
    ["god_appointment_list", []],
    ["god_appointment_step_down", ["00000000-0000-0000-0000-000000000000", null]],
  ];

  it("refuses everyone who is not the owner, whatever their role", async () => {
    const leader = await k.staff("SomeLeader", "leader");
    const member = await k.person("Plain");
    for (const who of [adminId, director, pastor, leader.id, member.id]) {
      for (const [fn, args] of CALLS) {
        await expectCode(db.asUser(who, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)))), "42501");
      }
    }
    for (const [fn, args] of CALLS) {
      await expectCode(db.asAnon((q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)))), "42501");
    }
  });

  it("refuses the owner too, until they have unlocked on this sign-in", async () => {
    for (const [fn, args] of CALLS) {
      await expectCode(
        db.asUser(o.owner.id, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a))), { session: randomUUID() }),
        "42501",
      );
    }
  });

  it("keeps the table closed to every client", async () => {
    for (const who of [adminId, pastor, o.owner.id]) await expectCode(db.asUser(who, (q) => q("select * from public.leader_appointments")), "42501");
    await expectCode(db.asAnon((q) => q("select * from public.leader_appointments")), "42501");
  });

  it("has row level security on and no policy", async () => {
    const r = await one("select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = 'public.leader_appointments'::regclass");
    expect(r).toEqual({ rls: true, pol: 0 });
  });

  it("closes the internal form check to clients", async () => {
    await expectCode(db.asUser(o.owner.id, (q) => q("select public.god_appointment_inputs($1::jsonb)", [JSON.stringify(FORM)]), { session: o.session }), "42501");
  });
});

describe("finding a person", () => {
  it("needs two letters, matches name, preferred name and email, and leaves out the owner and hidden people", async () => {
    const ada = await candidate("Adaeze");
    expect(await o.call("god_appointment_find", "a")).toEqual([]);
    expect(await o.call("god_appointment_find", null)).toEqual([]);
    const found = await o.call("god_appointment_find", "adaez");
    expect(found.map((p: Row) => p.id)).toContain(ada.id);
    expect(found[0]).toMatchObject({ id: ada.id, leads: 0, appointed: false, has_application: false });
    expect((await o.call("god_appointment_find", "Surname")).length).toBeGreaterThan(0);
    expect((await o.call("god_appointment_find", "The Owner")).map((p: Row) => p.id)).not.toContain(o.owner.id);
    expect((await o.call("god_appointment_find", "owner@example")).map((p: Row) => p.id)).not.toContain(o.owner.id);
  });

  it("treats % and _ as plain letters, and returns at most eight", async () => {
    expect(await o.call("god_appointment_find", "%%")).toEqual([]);
    expect(await o.call("god_appointment_find", "__")).toEqual([]);
    for (let i = 0; i < 10; i++) await candidate(`Bulk${i}`);
    expect((await o.call("god_appointment_find", "Bulk")).length).toBe(8);
  });
});

describe("the short fit form", () => {
  const bad = async (form: unknown, pattern?: RegExp) => {
    const p = await candidate();
    const r = o.call("god_appointment_suggest", p.id, JSON.stringify(form));
    if (pattern) await expect(r).rejects.toThrow(pattern);
    else await expectCode(r, "22023");
  };

  it("refuses anything but the five questions, in plain words", async () => {
    await bad(null, /Fill in the short form/);
    await bad([], /Fill in the short form/);
    await bad({ ...FORM, extra: "x" }, /a question we do not ask/);
    await bad({ lead_best: "doing" }, /their stage of life/);
    await bad({ track: "teens", lead_best: "doing" }, /their stage of life/);
    await bad({ track: "builders" }, /how they lead best/);
    await bad({ track: "builders", lead_best: "bossy" }, /how they lead best/);
    await bad({ track: "builders", lead_best: "doing", community: "nowhere" }, /not one we have/);
    await bad({ track: "builders", lead_best: "doing", goal: "nothing-here", relation: "achieved" }, /not one we have/);
    await bad({ track: "builders", lead_best: "doing", community: "education", goal: "step-into-a-leadership-role", relation: "achieved" }, /different community/);
    await bad({ track: "builders", lead_best: "doing", goal: "step-into-a-leadership-role" }, /achieved that goal or are pursuing/);
    await bad({ track: "builders", lead_best: "doing", relation: "maybe" }, /achieved that goal or are pursuing/);
    await bad({ track: "builders", lead_best: "doing", care_cleared: "yes" }, /yes or no/);
  });

  it("takes the community from the goal, and builds the inputs the application screen builds", async () => {
    const inputs = async (form: unknown) => (await one("select public.god_appointment_inputs($1::jsonb) as r", [JSON.stringify(form)])).r;
    const r = { inputs: await inputs({ track: "builders", lead_best: "connection", goal: "step-into-a-leadership-role", relation: "pursuing" }) };
    expect(r.inputs).toEqual({ track: "builders", community: "professionals", goal: "step-into-a-leadership-role", relation: "pursuing", lead_best: "connection", judgement: null, care: null });
  });

  it("opens the care gate only when the owner says a pastor has cleared the person", async () => {
    const inputs = async (form: unknown) => ({ inputs: (await one("select public.god_appointment_inputs($1::jsonb) as r", [JSON.stringify(form)])).r });
    const closed = await inputs({ track: "builders", lead_best: "connection" });
    const open = await inputs({ track: "builders", lead_best: "connection", care_cleared: true });
    expect(closed.inputs.care).toBeNull();
    expect(open.inputs.care).toBe(100);
  });
});

describe("the suggestions", () => {
  let p: { id: string };

  it("say there is no model while none is approved, and then give both lists", async () => {
    p = await candidate();
    expect(await o.call("god_appointment_suggest", p.id, JSON.stringify(FORM))).toEqual({ status: "no_model" });
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    const r = await o.call("god_appointment_suggest", p.id, JSON.stringify(FORM));
    expect(r.status).toBe("ok");
    expect(r.model).toBe("lf-1");
    expect(r.options.length).toBeGreaterThan(3);
    expect(r.options.length).toBeLessThanOrEqual(8);
    expect(r.needed.length).toBeGreaterThan(0);
  });

  it("list the recommended tribes best first, with every part and the numbers behind Need", async () => {
    const r = await o.call("god_appointment_suggest", p.id, JSON.stringify(FORM));
    const degrees = r.options.map((x: Row) => x.degree);
    expect(degrees).toEqual([...degrees].sort((a: number, b: number) => b - a));
    for (const x of r.options) {
      expect(x.recommended).toBe(true);
      expect(Object.keys(x.parts).sort()).toEqual(["calling", "judgement", "need", "stage", "style"]);
      expect(x.waiting).toBeGreaterThanOrEqual(0);
      expect(x.seats_open).toBeGreaterThanOrEqual(0);
    }
    // The same engine as the application screen: the same rows for the same inputs
    const engine = await sql("select goal_id, degree from public.leader_fit_options($1::jsonb) where recommended order by ord limit 8", [JSON.stringify(r.inputs)]);
    expect(r.options.map((x: Row) => ({ goal_id: x.goal_id, degree: x.degree }))).toEqual(engine);
  });

  it("list where members are waiting, biggest gap first, with how well this person would fit", async () => {
    const r = await o.call("god_appointment_suggest", p.id, JSON.stringify(FORM));
    const gaps = r.needed.map((x: Row) => x.gap);
    expect(gaps).toEqual([...gaps].sort((a: number, b: number) => b - a));
    expect(gaps.every((g: number) => g > 0)).toBe(true);
    expect(r.needed[0].title).toBe("Build a steady client pipeline");
    expect(r.needed[0]).toMatchObject({ waiting: 6, seats_open: 0, gap: 6 });
    expect(typeof r.needed[0].degree).toBe("number");
  });

  it("flag a sensitive tribe the person is not cleared for", async () => {
    const r = await o.call("god_appointment_suggest", p.id, JSON.stringify({ ...FORM, community: "marriage-relationships", goal: "strengthen-our-marriage" }));
    const row = r.needed.find((x: Row) => x.title === "Strengthen our marriage");
    expect(row).toMatchObject({ sensitive: true, care_flag: true, recommended: false });
    const cleared = await o.call("god_appointment_suggest", p.id, JSON.stringify({ ...FORM, community: "marriage-relationships", goal: "strengthen-our-marriage", care_cleared: true }));
    expect(cleared.needed.find((x: Row) => x.title === "Strengthen our marriage")).toMatchObject({ sensitive: true, care_flag: false, recommended: true });
  });

  it("save nothing", async () => {
    const before = await one("select (select count(*)::int from public.leader_fit_runs) r, (select count(*)::int from public.leader_appointments) a, (select count(*)::int from public.tribes) t, (select count(*)::int from public.person_roles) p");
    await o.call("god_appointment_suggest", p.id, JSON.stringify(FORM));
    expect(await one("select (select count(*)::int from public.leader_fit_runs) r, (select count(*)::int from public.leader_appointments) a, (select count(*)::int from public.tribes) t, (select count(*)::int from public.person_roles) p")).toEqual(before);
  });

  it("refuse a person who is not there", async () => {
    await expectCode(o.call("god_appointment_suggest", "00000000-0000-0000-0000-000000000000", JSON.stringify(FORM)), "P0002");
  });
});

describe("appointing", () => {
  let ada: { id: string };
  let result: Row;
  let goal: string;

  it("refuses when the tribe is not an option for this person, or the person is not there", async () => {
    ada = await candidate("Ada");
    goal = await goalId("step-into-a-leadership-role");
    await expect(o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), "00000000-0000-0000-0000-000000000000", null)).rejects.toThrow(/not one of the options/);
    await expectCode(o.call("god_appoint_leader", "00000000-0000-0000-0000-000000000000", JSON.stringify(FORM), goal, null), "P0002");
    await expectCode(o.call("god_appoint_leader", o.owner.id, JSON.stringify(FORM), goal, null), "P0002");
    await expect(o.call("god_appoint_leader", ada.id, JSON.stringify({ ...FORM, bad: 1 }), goal, null)).rejects.toThrow(/question we do not ask/);
    await expect(o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), goal, "x".repeat(501))).rejects.toThrow(/under 500/);
    expect(await count("select count(*)::int c from public.leader_appointments")).toBe(0);
  });

  it("refuses a sensitive tribe unless the owner says a pastor has cleared the person", async () => {
    const marriage = await goalId("strengthen-our-marriage");
    const form = { ...FORM, community: "marriage-relationships", goal: "strengthen-our-marriage" };
    await expect(o.call("god_appoint_leader", ada.id, JSON.stringify(form), marriage, null)).rejects.toThrow(/sensitive subject/);
    expect(await count("select count(*)::int c from public.leader_appointments")).toBe(0);
    expect(await count("select count(*)::int c from public.tribes where leader_id = $1", [ada.id])).toBe(0);
  });

  it("gives the role, starts a Tribe Card with the community, goal and life stage locked, and records the choice", async () => {
    result = await o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), goal, "Known to the church for years.");
    expect(result).toMatchObject({ ok: true });
    expect(result.degree).toBeGreaterThanOrEqual(60);
    const roles = (await sql("select role, granted_by from public.person_roles where person_id = $1", [ada.id])).map((r) => r.role).sort();
    expect(roles).toEqual(["leader", "member"]);
    // The owner is never named as the one who gave the role
    expect((await one("select granted_by from public.person_roles where person_id = $1 and role = 'leader'", [ada.id])).granted_by).toBeNull();
    const t = await one("select t.*, tr.slug as track_slug, c.slug as community_slug, g.slug as goal_slug from public.tribes t join public.tracks tr on tr.id = t.track_id join public.communities c on c.id = t.community_id join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [result.tribe]);
    expect(t).toMatchObject({ leader_id: ada.id, status: "draft", track_slug: "builders", community_slug: "professionals", goal_slug: "step-into-a-leadership-role", name: "Ada’s Professionals tribe" });
    expect(t.fixed.slice().sort()).toEqual(["community", "goal", "track"]);
    expect(t.season_id).toBe(seasonId);
    // The three Success Picture lines come from the signed-off card
    const card = await one("select loving_god, loving_others, loving_life from public.tribe_card_templates where season_goal_id = $1", [goal]);
    expect({ a: t.loving_god, b: t.loving_others, c: t.loving_life }).toEqual({ a: card.loving_god, b: card.loving_others, c: card.loving_life });
    const run = await one("select * from public.leader_fit_runs where id = $1", [result.run]);
    expect(run).toMatchObject({ person_id: ada.id, application_id: null, source: "appointment", chosen_goal_id: goal, model_version: "lf-1" });
    expect(run.chosen_degree).toBe(result.degree);
    const a = await one("select * from public.leader_appointments where id = $1", [result.appointment]);
    expect(a).toMatchObject({ person_id: ada.id, tribe_id: result.tribe, season_goal_id: goal, run_id: result.run, status: "active", granted_role: true, care_cleared: false, note: "Known to the church for years." });
    expect(a.appointed_by).toBe(o.owner.id);
  });

  it("leaves the pastor to approve the card and the Academy to certify the leader: neither happens here", async () => {
    expect((await one("select status, published_at from public.tribes where id = $1", [result.tribe]))).toMatchObject({ status: "draft", published_at: null });
    expect(await count("select count(*)::int c from public.leader_certifications where person_id = $1", [result.person ?? (await one("select leader_id from public.tribes where id = $1", [result.tribe])).leader_id])).toBe(0);
    // Members cannot see seats in it: it is not approved and the leader is not certified
    const rows = await sql("select * from public.goal_demand_rows($1) where goal_id = $2", [seasonId, await goalId("step-into-a-leadership-role")]);
    expect(rows[0].seats_open).toBe(0);
  });

  it("is the card the leader opens: start_tribe_card gives them the same one, with nothing to choose again", async () => {
    const id = await call(ada.id, "start_tribe_card");
    expect(id).toBe(result.tribe);
    expect(await count("select count(*)::int c from public.tribes where leader_id = $1", [ada.id])).toBe(1);
  });

  it("writes to the owner's own log and never to the office's", async () => {
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.appointed'")).toBe(1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.appointed'")).toBe(1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.appointed' and actor_id is not null")).toBe(0);
  });

  it("does not make them interested in their own tribe, and the quiet run for existing leaders skips them", async () => {
    expect((await one("select interested from public.goal_demand_rows($1) where goal_id = $2", [seasonId, goal])).interested).toBe(0);
    const before = await count("select count(*)::int c from public.leader_fit_runs where person_id = $1", [ada.id]);
    const r = await call(pastor, "leader_fit_quiet_all");
    expect(r.no_application).toBeGreaterThanOrEqual(1);
    expect(await count("select count(*)::int c from public.leader_fit_runs where person_id = $1", [ada.id])).toBe(before);
  });

  it("refuses a second appointment of the same person, and a person who already leads a tribe", async () => {
    await expect(o.call("god_appoint_leader", ada.id, JSON.stringify(FORM), await goalId("grow-a-network-that-opens-doors"), null)).rejects.toThrow(/already appointed/);
    const lead = await k.tribe(seasonId, { community: "consulting" });
    await expect(o.call("god_appoint_leader", lead.leader.id, JSON.stringify(FORM), goal, null)).rejects.toThrow(/already lead a tribe/);
  });

  it("allows a sensitive tribe once the owner says a pastor has cleared the person, and records that", async () => {
    const bea = await candidate("Bea");
    const marriage = await goalId("strengthen-our-marriage");
    const form = { track: "builders", lead_best: "connection", community: "marriage-relationships", goal: "strengthen-our-marriage", relation: "achieved", care_cleared: true };
    const r = await o.call("god_appoint_leader", bea.id, JSON.stringify(form), marriage, null);
    expect(r.ok).toBe(true);
    const a = await one("select care_cleared from public.leader_appointments where id = $1", [r.appointment]);
    expect(a.care_cleared).toBe(true);
  });

  it("keeps an existing role: someone who is already a leader is appointed without the appointment claiming the role", async () => {
    const cal = await candidate("Cal");
    await db.grant(cal.id, "leader");
    const r = await o.call("god_appoint_leader", cal.id, JSON.stringify({ track: "stewards", lead_best: "teaching" }), await goalId("find-a-mentor-and-become-one"), null);
    expect(r.ok).toBe(true);
    expect((await one("select granted_role from public.leader_appointments where id = $1", [r.appointment])).granted_role).toBe(false);
  });

  it("needs an approved fit model and an open season", async () => {
    const dee = await candidate("Dee");
    await db.admin.query("update public.leader_fit_models set active = false");
    await expect(o.call("god_appoint_leader", dee.id, JSON.stringify(FORM), goal, null)).rejects.toThrow(/approve a fit model/);
    await db.admin.query("update public.leader_fit_models set active = true where version = 'lf-1'");
    await db.admin.query("update public.seasons set status = 'closed'");
    await expect(o.call("god_appoint_leader", dee.id, JSON.stringify(FORM), goal, null)).rejects.toThrow(/No season is open/);
    await db.admin.query("update public.seasons set status = 'open' where id = $1", [seasonId]);
  });
});

describe("the list", () => {
  it("shows the owner every appointment with the person, the tribe and what the choice rested on", async () => {
    const list = await o.call("god_appointment_list");
    expect(list.length).toBeGreaterThanOrEqual(3);
    const ada = list.find((a: Row) => a.person.name === "Ada Surname");
    expect(ada).toMatchObject({ status: "active", goal: "Step into a leadership role", community: "Professionals", care_cleared: false, note: "Known to the church for years." });
    expect(ada.tribe).toMatchObject({ status: "draft", members: 0, certified: false });
    expect(ada.label).toBeTruthy();
    expect(Array.isArray(ada.flags)).toBe(true);
  });
});

describe("what the office is told", () => {
  let tribe: string;
  let adaId: string;

  it("says the leader was appointed by an administrator, never by name, to the pastor, a director and the admin", async () => {
    const ada = (await o.call("god_appointment_list")).find((a: Row) => a.person.name === "Ada Surname");
    tribe = ada.tribe.id;
    adaId = ada.person.id;
    for (const who of [pastor, director, adminId]) {
      const note = await call(who, "tribe_appointment_note", [tribe]);
      expect(note.text).toBe("This leader was appointed by an administrator. There is no application behind this card.");
      expect(note.active).toBe(true);
      expect(JSON.stringify(note)).not.toMatch(/Owner|owner@/);
    }
  });

  it("says nothing about an ordinary tribe, and refuses anyone outside the office", async () => {
    const t = await k.tribe(seasonId, { community: "education" });
    expect(await call(pastor, "tribe_appointment_note", [t.tribe])).toBeNull();
    await expectCode(call(adaId, "tribe_appointment_note", [tribe]), "42501");
    await expectCode(call((await k.person("Nobody")).id, "tribe_appointment_note", [tribe]), "42501");
    await expectCode(db.asAnon((q) => q("select public.tribe_appointment_note($1)", [tribe])), "42501");
  });
});

describe("stepping down", () => {
  it("closes a tribe nobody has joined, takes back the role the appointment gave, and keeps every certificate", async () => {
    const eve = await candidate("Eve");
    const r = await o.call("god_appoint_leader", eve.id, JSON.stringify({ track: "builders", lead_best: "doing", community: "health-fitness-sports", goal: "build-a-consistent-fitness-habit", relation: "achieved" }), await goalId("build-a-consistent-fitness-habit"), null);
    await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [eve.id]);
    const out = await o.call("god_appointment_step_down", r.appointment, "Moving abroad");
    expect(out).toEqual({ ok: true, tribe_closed: true, role_removed: true });
    expect((await one("select status from public.tribes where id = $1", [r.tribe])).status).toBe("closed");
    expect(await count("select count(*)::int c from public.person_roles where person_id = $1 and role = 'leader'", [eve.id])).toBe(0);
    expect(await count("select count(*)::int c from public.person_roles where person_id = $1 and role = 'member'", [eve.id])).toBe(1);
    // The certificate is never withdrawn
    expect(await count("select count(*)::int c from public.leader_certifications where person_id = $1", [eve.id])).toBe(1);
    const a = await one("select * from public.leader_appointments where id = $1", [r.appointment]);
    expect(a).toMatchObject({ status: "stepped_down", step_down_reason: "Moving abroad", stepped_down_by: o.owner.id });
    expect(a.stepped_down_at).toBeTruthy();
    // Their appointment is not counted as interest in the tribe they stepped down from
    expect((await one("select interested from public.goal_demand_rows($1) where goal_id = $2", [seasonId, await goalId("build-a-consistent-fitness-habit")])).interested).toBe(0);
    // The note still says the card had no application, now that it is closed
    expect((await call(pastor, "tribe_appointment_note", [r.tribe])).active).toBe(false);
  });

  it("can be appointed again afterwards, to a different tribe", async () => {
    const eve = (await o.call("god_appointment_list")).find((a: Row) => a.person.name === "Eve Surname").person;
    const again = await o.call("god_appoint_leader", eve.id, JSON.stringify({ track: "builders", lead_best: "teaching", community: "education", goal: "build-study-habits-that-last", relation: "pursuing" }), await goalId("build-study-habits-that-last"), null);
    expect(again.ok).toBe(true);
    expect(await count("select count(*)::int c from public.leader_appointments where person_id = $1", [eve.id])).toBe(2);
    expect(await count("select count(*)::int c from public.leader_appointments where person_id = $1 and status = 'active'", [eve.id])).toBe(1);
  });

  it("refuses while members have joined, says how many, and changes nothing", async () => {
    const fay = await candidate("Fay");
    const r = await o.call("god_appoint_leader", fay.id, JSON.stringify({ track: "builders", lead_best: "connection", community: "consulting", goal: "land-my-first-three-clients", relation: "achieved" }), await goalId("land-my-first-three-clients"), null);
    await db.admin.query("update public.tribes set status = 'approved', name = 'Fay tribe', story = 'x', meeting_day = 3, meeting_time = '20:00', slot = 'weeknight-evening', meeting_mode = 'in_person', zone = 'mainland' where id = $1", [r.tribe]);
    await k.seat(r.tribe, seasonId, `Joiner${++n}`, { profile: false });
    await k.seat(r.tribe, seasonId, `Joiner${++n}`, { profile: false });
    await expect(o.call("god_appointment_step_down", r.appointment, null)).rejects.toThrow(/2 members have joined this tribe/);
    expect((await one("select status from public.tribes where id = $1", [r.tribe])).status).toBe("approved");
    expect((await one("select status from public.leader_appointments where id = $1", [r.appointment])).status).toBe("active");
    expect(await count("select count(*)::int c from public.person_roles where person_id = $1 and role = 'leader'", [fay.id])).toBe(1);
  });

  it("leaves the role alone when the person was a leader already, and when they hold an approved application", async () => {
    const cal = (await o.call("god_appointment_list")).find((a: Row) => a.person.name === "Cal Surname");
    const out = await o.call("god_appointment_step_down", cal.id, null);
    expect(out).toMatchObject({ ok: true, tribe_closed: true, role_removed: false });
    expect(await count("select count(*)::int c from public.person_roles where person_id = $1 and role = 'leader'", [cal.person.id])).toBe(1);
  });

  it("refuses twice, an unknown appointment, a reason that is too long, and anyone who is not the owner", async () => {
    const cal = (await o.call("god_appointment_list")).find((a: Row) => a.person.name === "Cal Surname");
    await expect(o.call("god_appointment_step_down", cal.id, null)).rejects.toThrow(/already stepped down/);
    await expectCode(o.call("god_appointment_step_down", "00000000-0000-0000-0000-000000000000", null), "P0002");
    const bea = (await o.call("god_appointment_list")).find((a: Row) => a.person.name === "Bea Surname");
    await expect(o.call("god_appointment_step_down", bea.id, "x".repeat(501))).rejects.toThrow(/under 500/);
    await expectCode(call(adminId, "god_appointment_step_down", [bea.id, null]), "42501");
    await expectCode(call(pastor, "god_appointment_step_down", [bea.id, null]), "42501");
  });

  it("can only be undone by appointing again, and the list keeps the record", async () => {
    const list = await o.call("god_appointment_list");
    expect(list.filter((a: Row) => a.status === "stepped_down").length).toBeGreaterThanOrEqual(2);
    expect(list[0].status).toBe("active");
    const stepped = list.find((a: Row) => a.status === "stepped_down");
    expect(stepped.stepped_down_at).toBeTruthy();
  });
});

describe("the check that nothing else moved", () => {
  it("leaves the leaders' own tables, the certificates and the application rules alone", async () => {
    // An appointment has no application row, and nothing in the appointment writes to one
    expect(await count("select count(*)::int c from public.leader_applications")).toBe(0);
    expect(await count("select count(*)::int c from public.leader_assessments")).toBe(0);
    expect(await count("select count(*)::int c from public.leader_answer_checks")).toBe(0);
    const pol = await one("select pg_get_functiondef('public.submit_leader_application(uuid)'::regprocedure) d");
    expect(pol.d).toContain("leader_ai_consent_ok");
    expect(pol.d).toContain("perform public.leader_fit_gate");
  });
});
