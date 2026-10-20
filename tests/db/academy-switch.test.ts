import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { OPEN_DOOR, pipelineKit, setPositions, type PipelineKit } from "./pipeline-kit";

// Phase A, part three: the Academy and declaration switches. With both at Required every revised function must give exactly the answer
// it gave before (the saved _v1 copies are the proof). Otherwise a person is certified exactly when the rule table says, no certificate
// is ever withdrawn, and the parts that are switched off refuse plainly.

type Academy = "required" | "optional" | "off";
type Declaration = "required" | "off";
const ACADEMY: Academy[] = ["required", "optional", "off"];
const DECLARATION: Declaration[] = ["required", "off"];

let db: TestDb;
let kit: PipelineKit;
let seasonId: string;
let pastor: { id: string };
let coach: { id: string };
let director: { id: string };

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];

beforeAll(async () => {
  db = await createTestDb();
  kit = pipelineKit(db);
  await db.admin.query(fs.readFileSync(path.join(__dirname, "golden", "academy-v1.sql"), "utf8"));
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  pastor = await kit.person("pastor", "Pastor");
  coach = await kit.person("coach", "Coach");
  director = await kit.person("director", "Director");
});

afterAll(async () => {
  await db?.close();
});

async function switches(academy: Academy, declaration: Declaration) {
  await db.admin.query("update public.leader_pipeline_settings set academy_mode = $1, declaration_mode = $2", [academy, declaration]);
}
const TODAY = () => switches("required", "required");

// ---------------------------------------------------------------------------------------------------------------------------------
// Fixtures: a table of states, written straight into the tables (no function sees them being made)
// ---------------------------------------------------------------------------------------------------------------------------------

type Role = "leader" | "assistant_leader" | "none";
interface State {
  role: Role;
  modules: boolean;
  practice: boolean;
  declaration: boolean;
  card: boolean;
}
const ROLES: Role[] = ["leader", "assistant_leader", "none"];
const BOOLS = [false, true];

async function slugs(): Promise<string[]> {
  return (await sql("select slug from public.academy_modules where active order by number")).map((r) => r.slug as string);
}

/** An approved Tribe Card with everything a card needs, written straight into the table. */
async function insertApprovedTribe(leaderId: string) {
  const one = async (table: string, slug: string) => (await sql(`select id from public.${table} where slug = $1`, [slug]))[0].id as string;
  const { rows } = await db.admin.query(
    `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, 'approved', $3, $4, $5, $6, '{}', 'mixed', 'My story.', 3, '20:00', 'weeknight-evening', 'in_person', 'mainland', 'Near the bridge', 12,
             'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [seasonId, leaderId, `Fixture ${leaderId.slice(0, 4)}`, await one("tracks", "builders"), await one("communities", "professionals"), await one("season_goals", "step-into-a-leadership-role")],
  );
  return rows[0].id as string;
}

/** One person per state. The role is granted first, while nothing has been done, so nothing is certified on the way. */
async function makeStates(): Promise<(State & { id: string })[]> {
  const out: (State & { id: string })[] = [];
  const modules = await sql("select id from public.academy_modules where active");
  for (const role of ROLES) {
    for (const m of BOOLS) for (const p of BOOLS) for (const d of BOOLS) for (const c of BOOLS) {
      const user = await db.createUser();
      if (role !== "none") await db.grant(user.id, role);
      if (m) for (const mod of modules) await db.admin.query("insert into public.academy_progress (person_id, module_id, attempts, best_score, passed_at) values ($1, $2, 1, 100, now())", [user.id, mod.id]);
      if (p) await db.admin.query("insert into public.practice_assessments (person_id, format, ready, assessed_by) values ($1, 'co_lead', true, $2)", [user.id, coach.id]);
      if (d) await db.admin.query("insert into public.safeguarding_declarations (person_id, version, signed_name) values ($1, 'test-v1', 'Tola Adeyemi')", [user.id]);
      if (c) await insertApprovedTribe(user.id);
      out.push({ role, modules: m, practice: p, declaration: d, card: c, id: user.id });
    }
  }
  return out;
}

/** The rule table, written out the long way. */
function shouldBeCertified(s: State, academy: Academy, declaration: Declaration): boolean {
  const modulesOk = academy !== "required" || s.modules;
  const practiceOk = academy !== "required" || s.practice;
  const declarationOk = declaration !== "required" || s.declaration;
  const cardOk = s.role !== "leader" || s.card;
  const everythingAsked = academy === "required" && declaration === "required";
  // Someone who holds neither role is only ever certified under the old rule (everything required), as before.
  if (s.role === "none" && !everythingAsked) return false;
  return modulesOk && practiceOk && declarationOk && cardOk;
}

/** Runs the work inside a transaction and always rolls it back. Only raw queries on the admin connection may be used inside it. */
async function rolledBack<T>(work: () => Promise<T>): Promise<T> {
  await db.admin.query("begin");
  try {
    return await work();
  } finally {
    await db.admin.query("rollback");
  }
}

let states: (State & { id: string })[];
const label = (s: State) => `${s.role}, modules ${s.modules ? "done" : "not"}, practice ${s.practice ? "done" : "not"}, declaration ${s.declaration ? "signed" : "not"}, card ${s.card ? "approved" : "not"}`;

describe("with both switches at Required, nothing is different", () => {
  const NEW_KEYS = ["modules_needed", "practice_needed", "declaration_needed"];

  beforeAll(async () => {
    states = await makeStates();
    await TODAY();
  });

  it("builds every state", () => {
    expect(states).toHaveLength(3 * 16);
  });

  it("certification_state says what it always said, key for key, and the three new keys say everything is needed", async () => {
    for (const s of states) {
      const before = (await one("select public.certification_state_v1($1) as r", [s.id])).r as Row;
      const now = (await one("select public.certification_state($1) as r", [s.id])).r as Row;
      const kept = Object.fromEntries(Object.entries(now).filter(([k]) => !NEW_KEYS.includes(k)));
      expect(kept, label(s)).toEqual(before);
      for (const k of NEW_KEYS) expect(now[k], `${label(s)} ${k}`).toBe(true);
    }
  });

  it("refresh_certification certifies the same people, as the same role", async () => {
    for (const s of states) {
      const verdict = async (suffix: string) =>
        rolledBack(async () => {
          const r = (await one(`select public.refresh_certification${suffix}($1) as r`, [s.id])).r as boolean;
          const row = (await sql("select as_role from public.leader_certifications where person_id = $1", [s.id]))[0] ?? null;
          return { r, role: row?.as_role ?? null };
        });
      expect(await verdict(""), label(s)).toEqual(await verdict("_v1"));
    }
  });

  it("sign_safeguarding, submit_tribe_card, my_academy and my_tribe answer as they did", async () => {
    const leader = await kit.person("leader", "Golden");
    await db.admin.query(
      "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())",
      [leader.id, JSON.stringify({ calling: { track: "builders", community: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: "structure" } })],
    );
    const asLeader = async (text: string, params: unknown[] = []) =>
      rolledBack(async () => {
        await db.admin.query("set local role authenticated");
        await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [leader.id]);
        await db.admin.query("select set_config('request.jwt.claims', '', true)");
        await db.admin.query("savepoint s");
        try {
          const r = await db.admin.query(text, params);
          return { ok: true, value: r.rows[0]?.r ?? null };
        } catch (e) {
          await db.admin.query("rollback to savepoint s");
          return { ok: false, code: (e as { code?: string }).code, message: (e as Error).message };
        }
      });
    // The declaration before module 5, a malformed version, a short name
    for (const call of ["select public.sign_safeguarding%s('2026-11-s1', 'Tola Adeyemi') as r", "select public.sign_safeguarding%s('bad version!', 'Tola Adeyemi') as r"]) {
      expect(await asLeader(call.replace("%s", "")), call).toEqual(await asLeader(call.replace("%s", "_v1")));
    }
    // my_academy: the same, plus modes
    const now = (await asLeader("select public.my_academy() as r")) as { ok: true; value: Row };
    const old = (await asLeader("select public.my_academy_v1() as r")) as { ok: true; value: Row };
    const { modes, ...rest } = now.value;
    const state = Object.fromEntries(Object.entries(rest.state as Row).filter(([k]) => !NEW_KEYS.includes(k)));
    expect({ ...rest, state }).toEqual(old.value);
    expect(modes).toMatchObject({ academy: "required", declaration: "required" });
    // my_tribe: the same, plus module_needed (null when there is no card)
    expect((await asLeader("select public.my_tribe() as r")).value).toEqual((await asLeader("select public.my_tribe_v1() as r")).value);
  });

  it("the modules, workshops, quizzes and sign-off answer as they did", async () => {
    const leader = await kit.person("leader", "Golden Two");
    const asLeader = async (text: string, params: unknown[] = []) =>
      rolledBack(async () => {
        await db.admin.query("set local role authenticated");
        await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [leader.id]);
        await db.admin.query("select set_config('request.jwt.claims', '', true)");
        await db.admin.query("savepoint s");
        try {
          const r = await db.admin.query(text, params);
          return { ok: true, value: r.rows[0]?.r ?? null };
        } catch (e) {
          await db.admin.query("rollback to savepoint s");
          return { ok: false, code: (e as { code?: string }).code, message: (e as Error).message };
        }
      });
    const [first] = await slugs();
    const withoutMode = (v: unknown) => Object.fromEntries(Object.entries(v as Row).filter(([k]) => k !== "mode"));
    const mod = await asLeader("select public.academy_module($1) as r", [first]);
    const modOld = await asLeader("select public.academy_module_v1($1) as r", [first]);
    expect(mod.ok && modOld.ok).toBe(true);
    expect(withoutMode((mod as { value: Row }).value)).toEqual((modOld as { value: Row }).value);
    for (const call of ["select public.submit_quiz%s('the-why', '[0,0]'::jsonb) as r", "select public.submit_quiz%s('nope', '[]'::jsonb) as r", "select public.book_academy_session%s(gen_random_uuid()) as r"]) {
      const a = await asLeader(call.replace("%s", ""));
      const b = await asLeader(call.replace("%s", "_v1"));
      expect(a, call).toEqual(b);
    }
    // and the coach's sign-off: the same refusals
    const asCoach = async (text: string, params: unknown[] = []) =>
      rolledBack(async () => {
        await db.admin.query("set local role authenticated");
        await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [coach.id]);
        await db.admin.query("select set_config('request.jwt.claims', '', true)");
        await db.admin.query("savepoint s");
        try {
          const r = await db.admin.query(text, params);
          return { ok: true, value: r.rows[0]?.r ?? null, left: (await db.admin.query("select ready from public.practice_assessments where person_id = $1", [leader.id])).rows };
        } catch (e) {
          await db.admin.query("rollback to savepoint s");
          return { ok: false, code: (e as { code?: string }).code, message: (e as Error).message };
        }
      });
    for (const args of [["co_lead", true, "Steady."], ["recorded", false, null], ["co_lead", false, "x"], ["nope", true, null]] as const) {
      const a = await asCoach("select public.record_practice($1, $2, $3, $4) as r", [leader.id, ...args]);
      const b = await asCoach("select public.record_practice_v1($1, $2, $3, $4) as r", [leader.id, ...args]);
      expect(a, JSON.stringify(args)).toEqual(b);
    }
  });
});

describe("a person is certified exactly when the rule table says", () => {
  // Every Academy position x every declaration position x every state.
  for (const academy of ACADEMY) {
    for (const declaration of DECLARATION) {
      it(`Academy ${academy}, declaration ${declaration}`, async () => {
        const ids = states.map((s) => s.id);
        await rolledBack(async () => {
          await db.admin.query("update public.leader_pipeline_settings set academy_mode = $1, declaration_mode = $2", [academy, declaration]);
          // The sweep has already looked at everyone; asking again changes nothing, and asking someone who is certified is harmless.
          for (const id of ids) await db.admin.query("select public.refresh_certification($1)", [id]);
          const got = new Map((await sql("select person_id, as_role from public.leader_certifications where person_id = any($1)", [ids])).map((r) => [r.person_id as string, r.as_role as string]));
          const basis = new Map((await sql("select * from public.leader_certification_basis where person_id = any($1)", [ids])).map((r) => [r.person_id as string, r]));
          // The table is not trivially all yes or all no
          const yes = states.filter((s) => shouldBeCertified(s, academy, declaration)).length;
          expect(yes).toBeGreaterThan(0);
          expect(yes).toBeLessThan(states.length);
          expect(got.size).toBe(yes);
          for (const s of states) {
            const expected = shouldBeCertified(s, academy, declaration);
            expect(got.has(s.id), `${label(s)}`).toBe(expected);
            expect(basis.has(s.id), `basis for ${label(s)}`).toBe(expected);
            if (expected) {
              expect(got.get(s.id)).toBe(s.role === "leader" ? "leader" : "assistant_leader");
              expect(basis.get(s.id)).toMatchObject({ academy, declaration, modules_done: s.modules, practice_done: s.practice, declaration_signed: s.declaration });
            }
          }
        });
      });
    }
  }

  it("says what is needed, and keeps saying what was done", async () => {
    const s = states.find((x) => x.role === "leader" && !x.modules && !x.practice && x.declaration && !x.card)!;
    await rolledBack(async () => {
      await db.admin.query("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
      const st = (await one("select public.certification_state($1) as r", [s.id])).r as Row;
      expect(st).toMatchObject({ modules_needed: false, practice_needed: false, declaration_needed: false, modules_done: false, practice: false, declaration: true, card_required: true, card: false, certified: false });
      await db.admin.query("update public.leader_pipeline_settings set academy_mode = 'optional', declaration_mode = 'required'");
      expect(((await one("select public.certification_state($1) as r", [s.id])).r as Row)).toMatchObject({ modules_needed: false, practice_needed: false, declaration_needed: true });
    });
  });

  it("does not count five modules of six, whatever the position that asks for all of them", async () => {
    const user = await db.createUser();
    await db.grant(user.id, "assistant_leader");
    const mods = await sql("select id from public.academy_modules where active order by number");
    for (const m of mods.slice(0, mods.length - 1)) await db.admin.query("insert into public.academy_progress (person_id, module_id, attempts, best_score, passed_at) values ($1, $2, 1, 100, now())", [user.id, m.id]);
    await db.admin.query("insert into public.practice_assessments (person_id, format, ready, assessed_by) values ($1, 'co_lead', true, $2)", [user.id, coach.id]);
    await db.admin.query("insert into public.safeguarding_declarations (person_id, version, signed_name) values ($1, 'test-v1', 'Tola Adeyemi')", [user.id]);
    await TODAY();
    expect((await one("select public.refresh_certification($1) as r", [user.id])).r).toBe(false);
    await switches("optional", "required");
    expect((await one("select public.refresh_certification($1) as r", [user.id])).r).toBe(true);
    await TODAY();
  });

  it("does not certify someone who holds neither role for having nothing to do", async () => {
    const user = await db.createUser();
    await rolledBack(async () => {
      await db.admin.query("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
      expect((await one("select public.refresh_certification($1) as r", [user.id])).r).toBe(false);
      expect(await sql("select 1 from public.leader_certifications where person_id = $1", [user.id])).toHaveLength(0);
    });
  });

  it("reads both switches as required if the settings cannot be read", async () => {
    await rolledBack(async () => {
      await db.admin.query("delete from public.leader_pipeline_settings");
      expect((await one("select public.leader_academy_modes() as r")).r).toEqual({ academy: "required", declaration: "required" });
      const s = states.find((x) => x.role === "leader" && !x.modules && !x.practice && !x.declaration && x.card)!;
      expect((await one("select public.certification_state($1) as r", [s.id])).r).toMatchObject({ modules_needed: true, practice_needed: true, declaration_needed: true });
      expect((await one("select public.refresh_certification($1) as r", [s.id])).r).toBe(false);
    });
    expect(await sql("select 1 from public.leader_pipeline_settings")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The real thing: an application, the Academy, a card, a decision
// ---------------------------------------------------------------------------------------------------------------------------------

const GOOD_CARD = {
  name: "Tola’s Professionals tribe",
  story: "I was passed over twice before I learned to lead by serving. Now I lead a team of eight and I want to help you do it with your peace intact.",
  meeting_day: 3,
  meeting_time: "20:00",
  mode: "online",
  zone: "mainland",
  place_note: "Yaba side, mostly online",
  capacity: 10,
  god: "Read the week’s passage and say the confession five days a week.",
  others: "Pray for our triad weekly; nobody misses twice without a call.",
  life: "Each of us completes 10 of 12 weekly steps and has one leadership conversation.",
};

async function answerKey(slug: string): Promise<number[]> {
  return (await sql("select q.correct from public.academy_questions q join public.academy_modules m on m.id = q.module_id where m.slug = $1 order by q.position", [slug])).map((r) => r.correct as number);
}
async function passModule(userId: string, slug: string) {
  const answers = await answerKey(slug);
  return (await db.asUser(userId, (q) => q("select public.submit_quiz($1, $2::jsonb) as r", [slug, JSON.stringify(answers)]))).rows[0].r;
}
async function passAll(userId: string) {
  for (const slug of await slugs()) await passModule(userId, slug);
}
const sign = (userId: string) => db.asUser(userId, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola Adeyemi')"));
const practice = (personId: string, ready = true) => db.asUser(coach.id, (q) => q("select public.record_practice($1, 'co_lead', $2, $3)", [personId, ready, ready ? "Steady and kind." : "Practise keeping time."]));
const certified = async (userId: string) => (await sql("select 1 from public.leader_certifications where person_id = $1", [userId])).length > 0;
const inHours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

async function approvedLeader(kind: "leader" | "assistant_leader" = "leader") {
  const user = await kit.person(kind, "Tola");
  await db.admin.query(
    "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, $2, 'review', $3::jsonb, 'test', now(), now())",
    [user.id, kind === "leader" ? "approved_leader" : "approved_assistant", JSON.stringify({ calling: { track: "builders", community: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: "structure" } })],
  );
  return user;
}
async function startCard(leaderId: string) {
  const id = (await db.asUser(leaderId, (q) => q("select public.start_tribe_card() as id"))).rows[0].id as string;
  await db.asUser(leaderId, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify(GOOD_CARD)]));
  return id;
}
const submitCard = (leaderId: string, id: string) => db.asUser(leaderId, (q) => q("select public.submit_tribe_card($1)", [id]));
const approveCard = (id: string) => db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [id]));

describe("the default journey is unchanged", () => {
  it("certifies a leader the moment the last of the four is done, and records what it rested on", async () => {
    await TODAY();
    const leader = await approvedLeader();
    await passAll(leader.id);
    await sign(leader.id);
    await practice(leader.id);
    expect(await certified(leader.id), "three of four").toBe(false);
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    expect(await certified(leader.id), "a submitted card is not an approved one").toBe(false);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(true);
    expect(await one("select * from public.leader_certification_basis where person_id = $1", [leader.id])).toMatchObject({
      academy: "required", declaration: "required", modules_done: true, practice_done: true, declaration_signed: true,
    });
  });

  it("holds an approved leader back until every module, the declaration and the practice are done", async () => {
    await TODAY();
    const leader = await approvedLeader();
    expect(await certified(leader.id)).toBe(false);
    await db.admin.query("select public.refresh_certification($1)", [leader.id]);
    expect(await certified(leader.id)).toBe(false);
  });

  it("a person given the leader role with nothing done is not certified", async () => {
    await TODAY();
    for (const role of ["leader", "assistant_leader"]) {
      const user = await kit.person(role);
      expect(await certified(user.id), role).toBe(false);
    }
  });
});

describe("never pulled back", () => {
  const fingerprint = async (id: string) => ({
    certification: await sql("select * from public.leader_certifications where person_id = $1", [id]),
    basis: await sql("select * from public.leader_certification_basis where person_id = $1", [id]),
    progress: await sql("select * from public.academy_progress where person_id = $1 order by module_id", [id]),
    declaration: await sql("select * from public.safeguarding_declarations where person_id = $1", [id]),
    practice: await sql("select * from public.practice_assessments where person_id = $1", [id]),
    tribes: await sql("select id, status from public.tribes where leader_id = $1", [id]),
    roles: await sql("select role from public.person_roles where person_id = $1 order by role", [id]),
  });

  it("leaves a certified leader exactly as they were through Off, Required, Off, Optional and back", async () => {
    await TODAY();
    const leader = await approvedLeader();
    await passAll(leader.id);
    await sign(leader.id);
    await practice(leader.id);
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(true);
    const before = await fingerprint(leader.id);
    for (const [a, d] of [["off", "off"], ["required", "required"], ["off", "required"], ["optional", "off"], ["required", "off"], ["off", "off"], ["required", "required"]] as [Academy, Declaration][]) {
      await switches(a, d);
      expect(await fingerprint(leader.id), `${a} / ${d}`).toEqual(before);
      expect((await one("select public.certification_state($1) as r", [leader.id])).r).toMatchObject({ certified: true });
    }
  });

  it("does not withdraw the certificate of someone certified while the Academy was off, when it comes back on", async () => {
    await switches("off", "off");
    const leader = await approvedLeader();
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(true);
    const before = await fingerprint(leader.id);
    await TODAY();
    expect(await fingerprint(leader.id)).toEqual(before);
    expect(await certified(leader.id)).toBe(true);
    // and the screens read it as certified, with the training still undone
    const academy = (await db.asUser(leader.id, (q) => q("select public.my_academy() as r"))).rows[0].r as Row;
    expect(academy.state).toMatchObject({ certified: true, modules_done: false, modules_needed: true });
  });
});

describe("the sweeps", () => {
  it("certifies a leader with an approved card and nothing else when the Academy and the declaration go off", async () => {
    await TODAY();
    const leader = await approvedLeader();
    await passModule(leader.id, "the-success-picture"); // the one thing a card needs before it can be sent
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    await approveCard(card);
    expect(await certified(leader.id), "under today's rules").toBe(false);
    // through the real setter, as the office would
    const admin = await kit.person("admin", "Office");
    await db.asUser(admin.id, (q) => q("select public.leader_pipeline_set($1::jsonb, 'training handled elsewhere this season')", [JSON.stringify({ academy_mode: "off", declaration_mode: "off" })]));
    expect(await certified(leader.id)).toBe(true);
    expect(await one("select * from public.leader_certification_basis where person_id = $1", [leader.id])).toMatchObject({
      academy: "off", declaration: "off", modules_done: false, practice_done: false, declaration_signed: false,
    });
    await TODAY();
  });

  it("turning only the Academy off certifies those who signed the declaration, and not those who did not", async () => {
    await TODAY();
    const signed = await approvedLeader();
    await passModule(signed.id, "care-and-safeguarding");
    await sign(signed.id);
    const unsigned = await approvedLeader();
    for (const l of [signed, unsigned]) {
      await passModule(l.id, "the-success-picture");
      const card = await startCard(l.id);
      await submitCard(l.id, card);
      await approveCard(card);
    }
    expect(await certified(signed.id), "today's rules want the rest of the Academy").toBe(false);
    await switches("off", "required");
    expect(await certified(signed.id)).toBe(true);
    expect(await certified(unsigned.id)).toBe(false);
    // signing is allowed without module 5 while the Academy is off, and certifies the one who was waiting for it
    await sign(unsigned.id);
    expect(await certified(unsigned.id)).toBe(true);
    await TODAY();
  });

  it("turning the declaration off alone certifies a leader who has done everything but sign", async () => {
    await TODAY();
    const leader = await approvedLeader();
    await passAll(leader.id);
    await practice(leader.id);
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(false);
    await switches("required", "off");
    expect(await certified(leader.id)).toBe(true);
    expect(await one("select academy, declaration, declaration_signed from public.leader_certification_basis where person_id = $1", [leader.id])).toEqual({ academy: "required", declaration: "off", declaration_signed: false });
    await TODAY();
  });

  it("an assistant is certified the moment the role is granted when both are off, and not under today's rules", async () => {
    await TODAY();
    const underToday = await kit.person("assistant_leader");
    expect(await certified(underToday.id)).toBe(false);
    await switches("off", "off");
    const whenOff = await kit.person("assistant_leader");
    expect(await certified(whenOff.id)).toBe(true);
    expect(await one("select as_role from public.leader_certifications where person_id = $1", [whenOff.id])).toEqual({ as_role: "assistant_leader" });
    // the one waiting under today's rules was caught by the sweep when the switches went off
    expect(await certified(underToday.id)).toBe(true);
    await TODAY();
  });

  it("a leader approved while both are off is certified when the card is approved, and not before", async () => {
    await switches("off", "off");
    const leader = await approvedLeader();
    expect(await certified(leader.id), "an approved application is not an approved card").toBe(false);
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    expect(await certified(leader.id)).toBe(false);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(true);
    await TODAY();
  });

  it("making the switches stricter certifies no one and withdraws no one", async () => {
    await switches("off", "off");
    const waiting = await approvedLeader();
    const card = await startCard(waiting.id);
    await submitCard(waiting.id, card);
    const done = await kit.person("assistant_leader");
    expect(await certified(done.id)).toBe(true);
    await TODAY();
    expect(await certified(done.id)).toBe(true);
    expect(await certified(waiting.id)).toBe(false);
    // Approving the card now does not certify: today's rules apply to this leader
    await approveCard(card);
    expect(await certified(waiting.id)).toBe(false);
  });

  it("a switch set to where it already is does nothing", async () => {
    await TODAY();
    const waiting = await approvedLeader();
    await passAll(waiting.id);
    await sign(waiting.id);
    await practice(waiting.id);
    await switches("required", "required");
    expect(await certified(waiting.id)).toBe(false);
  });
});

describe("the tribe is shown to members only when its card is approved and its leader is certified", () => {
  const profileFor = async (userId: string) => {
    const id = (name: string, slug: string) => one(`select id from public.${name} where slug = $1`, [slug]).then((r) => r.id as string);
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
          season_goal_id, goal_baseline, meeting_mode, meeting_times, style_social, style_structure, support_load, duration_seconds)
       values ($1, $2, $3, 'female', 'mixed', 'mainland', $4, 'growing', $5, 3, 'either', $6, 0, 0, 0, 250)`,
      [userId, seasonId, await id("age_ranges", "33-40"), await id("communities", "professionals"), await id("season_goals", "step-into-a-leadership-role"), ["weeknight-evening"]],
    );
  };
  const offered = async (tribeId: string) => {
    const member = await db.createUser();
    await profileFor(member.id);
    const m = (await db.asUser(member.id, (q) => q("select public.match_me(true) as r", []))).rows[0].r as { tribes: { tribe: { id: string } }[] };
    return m.tribes.map((c) => c.tribe.id).includes(tribeId);
  };
  const publish = async (leaderId: string) => {
    const [t] = await sql("select id from public.tribes where leader_id = $1 and status = 'approved'", [leaderId]);
    return t.id as string;
  };

  for (const academy of ACADEMY) {
    for (const declaration of DECLARATION) {
      it(`under Academy ${academy} and declaration ${declaration}`, async () => {
        await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
        await switches(academy, declaration);

        // approved card, nothing else done
        const onlyCard = await approvedLeader();
        const c1 = await startCard(onlyCard.id);
        // the Success Picture module comes first only when the Academy is required
        if (academy === "required") await passModule(onlyCard.id, "the-success-picture");
        await submitCard(onlyCard.id, c1);
        await approveCard(c1);
        await db.admin.query(
          "update public.tribes set published_at = now(), slot = 'weeknight-evening', meeting_day = 3, meeting_time = '20:00', zone = 'mainland', meeting_mode = 'in_person' where id = $1",
          [c1],
        );
        // card still waiting for approval, everything else done
        const doneButCard = await approvedLeader();
        const c2 = await startCard(doneButCard.id);
        if (academy === "required") await passAll(doneButCard.id);
        await submitCard(doneButCard.id, c2);
        if (declaration === "required") await db.admin.query("insert into public.safeguarding_declarations (person_id, version, signed_name) values ($1, 'v', 'Tola Adeyemi') on conflict do nothing", [doneButCard.id]);
        if (academy === "required") await practice(doneButCard.id);
        expect(await certified(doneButCard.id), "no approved card, no certificate").toBe(false);
        expect(await offered(c2), "a card that is not approved is never shown").toBe(false);

        // approved card and every other thing the positions ask for
        const full = await approvedLeader();
        const c3 = await startCard(full.id);
        if (academy === "required") await passAll(full.id);
        if (declaration === "required") await sign(full.id).catch(async () => db.admin.query("insert into public.safeguarding_declarations (person_id, version, signed_name) values ($1, 'v', 'Tola Adeyemi') on conflict do nothing", [full.id]));
        if (academy === "required") await practice(full.id);
        await submitCard(full.id, c3);
        await approveCard(c3);
        await db.admin.query(
          "update public.tribes set published_at = now(), slot = 'weeknight-evening', meeting_day = 3, meeting_time = '20:00', zone = 'mainland', meeting_mode = 'in_person' where id = $1",
          [c3],
        );
        expect(await certified(full.id)).toBe(true);
        expect(await offered(await publish(full.id)), "approved and certified: shown").toBe(true);

        // approved card and nothing else: certified only when the positions ask for nothing else
        const first = await certified(onlyCard.id);
        expect(first, "the card alone is enough exactly when nothing else is asked").toBe(academy !== "required" && declaration === "off");
        expect(await offered(await publish(onlyCard.id))).toBe(first);
        await TODAY();
      });
    }
  }
});

describe("what is refused while the Academy is off, and what is kept", () => {
  it("refuses quizzes, bookings and the practice sign-off with plain messages, keeps what exists, and still lets the panel read a module", async () => {
    await TODAY();
    const leader = await approvedLeader();
    const [first, second] = await slugs();
    await passModule(leader.id, first);
    const session = (await db.asUser(director.id, (q) => q("select public.add_academy_session('practice_workshop', $1, 120, 'online', 'https://meet.example/abc', 10) as id", [inHours(72)]))).rows[0].id as string;
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [session]));
    await practice(leader.id, false);

    await switches("off", "required");
    await expect(db.asUser(leader.id, (q) => q("select public.submit_quiz($1, '[0]'::jsonb)", [second]))).rejects.toThrow(/Academy is switched off/);
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz($1, '[0]'::jsonb)", [second])), "22023");
    const other = (await db.asUser(director.id, (q) => q("select public.add_academy_session('commissioning_workshop', $1, 120, 'online', 'https://meet.example/def', 10) as id", [inHours(96)]))).rows[0].id as string;
    await expect(db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [other]))).rejects.toThrow(/workshops cannot be booked/);
    await expect(practice(leader.id)).rejects.toThrow(/practice session cannot be recorded/);
    await expect(db.asUser(leader.id, (q) => q("select public.academy_module($1)", [first]))).rejects.toThrow(/switched off/);

    // the panel and administrators can still read the content, and reading it creates no progress
    const admin = await kit.person("admin", "Office");
    for (const reader of [coach.id, pastor.id, admin.id]) {
      const m = (await db.asUser(reader, (q) => q("select public.academy_module($1) as r", [first]))).rows[0].r as Row;
      expect(m.module.slug).toBe(first);
      expect(m.can_take).toBe(false);
      expect(m.mode).toBe("off");
      expect(JSON.stringify(m)).not.toContain('"correct"');
    }
    expect(await sql("select 1 from public.academy_progress where person_id = any($1)", [[coach.id, pastor.id, admin.id]])).toHaveLength(0);

    // what existed is still there
    expect(await sql("select 1 from public.academy_progress where person_id = $1 and passed_at is not null", [leader.id])).toHaveLength(1);
    expect(await sql("select 1 from public.academy_bookings where person_id = $1 and session_id = $2", [leader.id, session])).toHaveLength(1);
    expect(await sql("select ready from public.practice_assessments where person_id = $1", [leader.id])).toEqual([{ ready: false }]);

    // my_academy: the same keys, no modules or workshops, the switches, and the state still tells the truth
    const mine = (await db.asUser(leader.id, (q) => q("select public.my_academy() as r"))).rows[0].r as Row;
    expect(mine.modules).toEqual([]);
    expect(mine.sessions).toEqual([]);
    expect(mine.modes).toMatchObject({ academy: "off", declaration: "required" });
    expect(typeof mine.modes.academy_since).toBe("string");
    expect(mine.state).toMatchObject({ modules_done: false, modules_needed: false, practice_needed: false, declaration_needed: true, modules_passed: 1 });
    expect(mine.practice).toMatchObject({ ready: false });
    for (const key of ["is_leader", "pass_mark", "attended", "declaration", "practice", "card", "state", "certified_at", "modes"]) expect(mine, key).toHaveProperty(key);

    // the other staff actions are unchanged: the register can still be marked and a booking cancelled
    await db.asUser(leader.id, (q) => q("select public.cancel_academy_booking($1)", [session]));
    expect(await sql("select 1 from public.academy_bookings where person_id = $1 and session_id = $2", [leader.id, session])).toHaveLength(0);

    // back on, it is all there
    await TODAY();
    const back = (await db.asUser(leader.id, (q) => q("select public.my_academy() as r"))).rows[0].r as Row;
    expect(back.modules.length).toBeGreaterThanOrEqual(6);
    expect(back.modules.find((m: Row) => m.slug === first)).toMatchObject({ passed: true });
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [other]));
  });

  it("offers everything while the Academy is optional, and asks for none of it", async () => {
    await switches("optional", "required");
    const leader = await approvedLeader();
    const [first] = await slugs();
    await passModule(leader.id, first);
    const session = (await db.asUser(director.id, (q) => q("select public.add_academy_session('practice_workshop', $1, 120, 'online', 'https://meet.example/abc', 10) as id", [inHours(72)]))).rows[0].id as string;
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [session]));
    await practice(leader.id);
    const mine = (await db.asUser(leader.id, (q) => q("select public.my_academy() as r"))).rows[0].r as Row;
    expect(mine.modules.length).toBeGreaterThanOrEqual(6);
    expect(mine.sessions.some((s: Row) => s.id === session && s.booked)).toBe(true);
    expect(mine.modes).toMatchObject({ academy: "optional" });
    expect(mine.state).toMatchObject({ modules_needed: false, practice_needed: false, declaration_needed: true });
    // the declaration alone, then the card, are what is left
    await sign(leader.id);
    expect(await certified(leader.id)).toBe(false);
    const card = await startCard(leader.id);
    await submitCard(leader.id, card);
    await approveCard(card);
    expect(await certified(leader.id)).toBe(true);
    expect(await one("select academy, declaration, modules_done, practice_done, declaration_signed from public.leader_certification_basis where person_id = $1", [leader.id])).toEqual({
      academy: "optional", declaration: "required", modules_done: false, practice_done: true, declaration_signed: true,
    });
    await TODAY();
  });
});

describe("the declaration on its own", () => {
  it("can be signed without module 5 while the Academy is off or optional, and not while it is required", async () => {
    await TODAY();
    const a = await approvedLeader();
    await expect(sign(a.id)).rejects.toThrow(/Pass the care and safeguarding module first/);
    for (const academy of ["off", "optional"] as Academy[]) {
      await switches(academy, "required");
      const l = await approvedLeader();
      await sign(l.id);
      expect(await sql("select 1 from public.safeguarding_declarations where person_id = $1", [l.id])).toHaveLength(1);
    }
    await TODAY();
    await expect(sign((await approvedLeader()).id)).rejects.toThrow(/Pass the care and safeguarding module first/);
  });

  it("is refused plainly when the declaration is off, whatever the Academy says, and keeps those already signed", async () => {
    await TODAY();
    const early = await approvedLeader();
    await passModule(early.id, "care-and-safeguarding");
    await sign(early.id);
    for (const academy of ACADEMY) {
      await switches(academy, "off");
      const l = await approvedLeader();
      await expectCode(sign(l.id), "22023");
      await expect(sign(l.id)).rejects.toThrow(/not being asked for right now/);
      expect(await sql("select 1 from public.safeguarding_declarations where person_id = $1", [l.id])).toHaveLength(0);
    }
    expect(await sql("select 1 from public.safeguarding_declarations where person_id = $1", [early.id])).toHaveLength(1);
    await TODAY();
  });

  it("still refuses a person who is not a leader in training, and a bad name or version", async () => {
    await switches("off", "required");
    const member = await db.createUser();
    await expectCode(sign(member.id), "42501");
    const l = await approvedLeader();
    await expectCode(db.asUser(l.id, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola')")), "22023");
    await expectCode(db.asUser(l.id, (q) => q("select public.sign_safeguarding('bad version!', 'Tola Adeyemi')")), "22023");
    await TODAY();
  });
});

describe("the Tribe Card", () => {
  it("needs the Success Picture module only when the Academy is required", async () => {
    await TODAY();
    const a = await approvedLeader();
    const card = await startCard(a.id);
    await expect(submitCard(a.id, card)).rejects.toThrow(/Pass the module on the Success Picture first/);
    const mine = (await db.asUser(a.id, (q) => q("select public.my_tribe() as r"))).rows[0].r as Row;
    expect(mine).toMatchObject({ module_ok: false, module_needed: true });
    for (const academy of ["optional", "off"] as Academy[]) {
      await switches(academy, "required");
      const l = await approvedLeader();
      const c = await startCard(l.id);
      const m = (await db.asUser(l.id, (q) => q("select public.my_tribe() as r"))).rows[0].r as Row;
      expect(m).toMatchObject({ module_ok: false, module_needed: false });
      await submitCard(l.id, c);
      expect((await one("select status from public.tribes where id = $1", [c])).status).toBe("submitted");
    }
    // every other check on the card is unchanged
    await switches("off", "off");
    const l = await approvedLeader();
    const c = await startCard(l.id);
    await db.asUser(l.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [c, JSON.stringify({ story: "Too short." })]));
    await expectCode(submitCard(l.id, c), "22023");
    await TODAY();
  });
});

describe("the messages", () => {
  // A whole application, decided under the positions given. (The walk sets every switch itself, so the two being tested go in with it.)
  const approvalMessage = async (positions: { academy: Academy; declaration: Declaration }, decision: "leader" | "assistant_leader" = "leader", open = true) => {
    const r = await kit.walk({ ...(open ? OPEN_DOOR : {}), ...positions }, { decision });
    return sql("select template, params from public.messages where person_id = $1 and template like 'application_approved%'", [r.user.id]);
  };

  it("says what has always been said when the Academy is required, with the same details", async () => {
    const sent = await approvalMessage({ academy: "required", declaration: "required" }, "leader", false);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("application_approved");
    expect(Object.keys(sent[0].params as object).sort()).toEqual(["first_name", "minutes", "mode", "place", "role", "starts_at"].sort());
  });

  it("is the same template when only the declaration is off, with a flag the email reads", async () => {
    const sent = await approvalMessage({ academy: "required", declaration: "off" });
    expect(sent[0].template).toBe("application_approved");
    expect((sent[0].params as Row).declaration).toBe(false);
    expect((sent[0].params as Row).academy).toBeUndefined();
  });

  it("is a message that does not promise training that is off", async () => {
    expect((await approvalMessage({ academy: "optional", declaration: "required" }))[0].template).toBe("application_approved_optional");
    expect((await approvalMessage({ academy: "optional", declaration: "off" }))[0].template).toBe("application_approved_optional");
    expect((await approvalMessage({ academy: "off", declaration: "required" }))[0].template).toBe("application_approved_declaration");
    expect((await approvalMessage({ academy: "off", declaration: "off" }))[0].template).toBe("application_approved_open");
    expect((await approvalMessage({ academy: "off", declaration: "off" }, "assistant_leader"))[0].template).toBe("application_approved_open");
    await TODAY();
  });

  it("the flags are empty when both are required, so every message is as it was", async () => {
    await setPositions(db);
    const app = await kit.startDraft((await kit.person()).id);
    expect((await one("select public.leader_message_flags($1) as r", [app])).r).toEqual({});
    await switches("optional", "off");
    expect((await one("select public.leader_message_flags($1) as r", [app])).r).toEqual({ academy: "optional", declaration: false });
    await TODAY();
  });
});

describe("who can call what", () => {
  it("lets any signed-in person read the switches and the dates, and nobody call the internals", async () => {
    const member = await db.createUser();
    const sw = (await db.asUser(member.id, (q) => q("select public.academy_switch() as r"))).rows[0].r as Row;
    expect(sw).toMatchObject({ academy: "required", declaration: "required" });
    await expectCode(db.asAnon((q) => q("select public.academy_switch()")), "42501");
    for (const call of ["select public.leader_academy_modes()", "select public.leader_approved_template(gen_random_uuid())", "select public.certification_state(gen_random_uuid())", "select public.refresh_certification(gen_random_uuid())"]) {
      await expectCode(db.asUser(member.id, (q) => q(call)), "42501");
    }
    await expectCode(db.asUser(member.id, (q) => q("select * from public.leader_certification_basis")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("insert into public.leader_certification_basis (person_id, academy, declaration, modules_done, practice_done, declaration_signed, certified_at) values ($1, 'off', 'off', false, false, false, now())", [member.id])), "42501");
  });

  it("gives the date a switch was last moved to where it is", async () => {
    await TODAY();
    expect(((await one("select public.academy_switch() as r")).r as Row).academy_since).toBeNull();
    const admin = await kit.person("admin", "Office");
    await db.asUser(admin.id, (q) => q("select public.leader_pipeline_set($1::jsonb, 'for the season')", [JSON.stringify({ academy_mode: "off" })]));
    const sw = (await one("select public.academy_switch() as r")).r as Row;
    expect(sw.academy).toBe("off");
    expect(new Date(sw.academy_since).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(sw.declaration_since).toBeNull();
    await TODAY();
  });
});
