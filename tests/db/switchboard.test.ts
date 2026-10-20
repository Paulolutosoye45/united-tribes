import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";
import { ALL_OFF, ELIG_KEYS, OPEN_DOOR, answers, pipelineKit, setPositions, type PipelineKit, type Positions, type Pos } from "./pipeline-kit";

// Phase A, part two: the switches carried through the application. With every switch at today's position each revised function must give
// exactly the answer it gave before (the saved _v1 copies are the proof), and the effective position of a step must follow its one rule.

let db: TestDb;
let kit: PipelineKit;
let staff: Awaited<ReturnType<PipelineKit["panel"]>>;
let reviewers: { id: string }[];

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  kit = pipelineKit(db);
  for (const file of ["leader-v1.sql"]) await db.admin.query(fs.readFileSync(path.join(__dirname, "golden", file), "utf8"));
  staff = await kit.panel();
  reviewers = [await kit.person("coach"), await kit.person("pastor"), await kit.person("director")];
});

afterAll(async () => {
  await db?.close();
});

/** Runs one statement as a signed-in person and rolls it back, keeping what it returned (or the error) and what it left behind. */
const INTERNAL = "internal"; // functions only the database itself calls: no signed-in role
async function probe(userId: string | null, text: string, params: unknown[] = [], after: string[] = []) {
  await db.admin.query("begin");
  try {
    if (userId !== INTERNAL) {
      await db.admin.query("set local role authenticated");
      await db.admin.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await db.admin.query("select set_config('request.jwt.claims', '', true)");
    }
    await db.admin.query("savepoint probe");
    let outcome: { ok: true; value: unknown } | { ok: false; code?: string; message: string };
    try {
      const r = await db.admin.query(text, params);
      outcome = { ok: true, value: r.rows[0]?.r ?? null };
    } catch (e) {
      outcome = { ok: false, code: (e as { code?: string }).code, message: (e as Error).message };
      await db.admin.query("rollback to savepoint probe");
    }
    if (userId !== INTERNAL) await db.admin.query("reset role");
    const left: unknown[] = [];
    for (const s of after) left.push((await db.admin.query(s)).rows);
    return { outcome, left };
  } finally {
    await db.admin.query("rollback");
  }
}

/** What the old function and the new one do with the same call on the same data. The new one may add keys to what it returns. */
async function same(userId: string | null, call: (suffix: string) => string, params: unknown[], after: string[] = [], opts: { extraKeys?: string[]; label?: string } = {}) {
  const before = await probe(userId, call("_v1"), params, after);
  const now = await probe(userId, call(""), params, after);
  const label = opts.label ?? call("");
  if (!before.outcome.ok) {
    expect(now.outcome, `${label}: the error must be the same`).toEqual(before.outcome);
  } else {
    expect(now.outcome.ok, `${label}: ${JSON.stringify(now.outcome)}`).toBe(true);
    const a = before.outcome.value as unknown;
    let b = (now.outcome as { value?: unknown }).value;
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !opts.extraKeys!.includes(k)).map(([k, x]) => [k, strip(x)])) : v;
    if (opts.extraKeys) b = strip(b);
    expect(b, label).toEqual(a);
  }
  expect(now.left, `${label}: what it left behind`).toEqual(before.left);
  return before.outcome;
}

type RefSeed = { rating?: number; concern?: boolean; cleared?: boolean; head?: boolean; disputed?: boolean; held?: boolean; pending?: boolean };
type Seed = {
  status?: string;
  calling?: number[]; // one review per number, each scoring every question that number
  interview?: number[];
  scen?: number | null;
  refs?: RefSeed[];
  aiClear?: boolean;
  eligibility?: Record<string, unknown>;
  answers?: Record<string, unknown>;
};

let counter = 0;
/** An application in the state described, built straight into the tables. */
async function seed(o: Seed = {}) {
  const user = await kit.person(undefined, `Applicant${++counter}`);
  const status = o.status ?? "submitted";
  const appId = await kit.startDraft(user.id, o.answers ?? answers(o.eligibility));
  for (const [i, r] of (o.refs ?? []).entries()) {
    const id = (await kit.setReferee(user.id, appId, i + 1, r.head ?? false)).rows[0].id as string;
    if (!r.pending) {
      await db.admin.query("update public.leader_references set submitted_at = now(), stage = 'answered' where id = $1", [id]);
      const n = r.rating ?? 5;
      await db.admin.query(
        "insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern, concern_note, concern_cleared_at, concern_cleared_by, concern_cleared_note) values ($1,$2,$2,$2,$2,$3,$4,$5,$6,$7)",
        [id, n, !!r.concern, r.concern ? "a concern" : null, r.cleared ? new Date() : null, r.cleared ? staff.pastor.id : null, r.cleared ? "looked into it" : null],
      );
    }
    await db.admin.query("update public.referee_trust set standing = $2, verification = $3 where reference_id = $1", [id, !!r.head, r.disputed ? "disputed" : "unverified"]);
    if (r.held) await db.admin.query("insert into public.leader_reference_flags (reference_id, kind, severity, detail) values ($1, 'same_browser', 'hold', 'held')", [id]);
  }
  const sub = status === "draft" || status === "ineligible" ? "null" : "now()";
  await db.admin.query(`update public.leader_applications set status = $2, step = 'done', submitted_at = ${sub} where id = $1`, [appId, status]);
  if (o.scen !== undefined && o.scen !== null) {
    await db.admin.query("insert into public.leader_assessments (application_id, scenario_pct) values ($1, $2)", [appId, o.scen]);
  }
  const score = (n: number, count: number) => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i + 1}`, n])));
  for (const [i, n] of (o.calling ?? []).entries()) {
    await db.admin.query("insert into public.leader_reviews (application_id, reviewer_id, stage, scores) values ($1, $2, 'calling', $3::jsonb)", [appId, reviewers[i].id, score(n, 6)]);
  }
  for (const [i, n] of (o.interview ?? []).entries()) {
    await db.admin.query("insert into public.leader_reviews (application_id, reviewer_id, stage, scores) values ($1, $2, 'interview', $3::jsonb)", [appId, reviewers[i].id, score(n, 5)]);
  }
  if (o.aiClear) await db.admin.query("insert into public.leader_ai_state (application_id, state, basis) values ($1, 'clear', 'ai')", [appId]);
  return { user, appId };
}

describe("the effective position of a step", () => {
  const LEVELS: Pos[] = ["required", "optional", "off"];
  const STORED: (Pos | "none")[] = ["none", "required", "optional", "off"];
  const lenient = (a: Pos, b: Pos) => (["required", "optional", "off"].indexOf(a) >= ["required", "optional", "off"].indexOf(b) ? a : b);

  it("is the position now for a draft or someone stopped at a question, whatever was stored", async () => {
    for (const now of LEVELS) {
      await setPositions(db, { references: now, interview: now, eligibility: Object.fromEntries(ELIG_KEYS.map((k) => [k, now])) as Record<string, Pos> });
      for (const status of ["draft", "ineligible"]) {
        const { appId } = await seed({ status });
        await sql("insert into public.leader_application_policy (application_id, at_send) values ($1, $2::jsonb)", [appId, JSON.stringify({ references: "off", interview: "off", eligibility: Object.fromEntries(ELIG_KEYS.map((k) => [k, "off"])) })]);
        const m = await kit.modes(appId);
        expect(m.sent).toBe(false);
        expect(m.references).toBe(now);
        expect(m.interview).toBe(now);
        for (const k of ELIG_KEYS) expect(m.eligibility[k], `${status} ${k}`).toBe(now);
      }
    }
  });

  it("is the more lenient of the position when it was sent and the position now, for every stage", async () => {
    for (const stored of STORED) {
      for (const now of LEVELS) {
        await setPositions(db, { references: now, interview: now, eligibility: Object.fromEntries(ELIG_KEYS.map((k) => [k, now])) as Record<string, Pos> });
        const { appId } = await seed({ status: "submitted" });
        if (stored !== "none") {
          await sql("insert into public.leader_application_policy (application_id, at_send) values ($1, $2::jsonb)", [
            appId,
            JSON.stringify({ references: stored, interview: stored, eligibility: Object.fromEntries(ELIG_KEYS.map((k) => [k, stored])) }),
          ]);
        }
        const expected = stored === "none" ? lenient("required", now) : lenient(stored, now);
        const m = await kit.modes(appId);
        expect(m.sent).toBe(true);
        expect(m.references, `references stored ${stored}, now ${now}`).toBe(expected);
        expect(m.interview, `interview stored ${stored}, now ${now}`).toBe(expected);
        for (const k of ELIG_KEYS) expect(m.eligibility[k], `${k} stored ${stored}, now ${now}`).toBe(expected);
      }
    }
  });

  it("treats a stage missing from what was stored as required at sending", async () => {
    await setPositions(db, { references: "required", interview: "off" });
    const { appId } = await seed({ status: "interviewed" });
    await sql("insert into public.leader_application_policy (application_id, at_send) values ($1, '{}'::jsonb)", [appId]);
    const m = await kit.modes(appId);
    expect(m.references).toBe("required");
    expect(m.interview).toBe("off");
    await setPositions(db);
  });

  it("is only ever visible to the applicant for their own application", async () => {
    await setPositions(db);
    const a = await seed();
    const b = await seed();
    const own = (await db.asUser(a.user.id, (q) => q("select public.my_application_modes($1) as r", [a.appId]))).rows[0].r;
    expect(own.references).toBe("required");
    await expect(db.asUser(a.user.id, (q) => q("select public.my_application_modes($1)", [b.appId]))).rejects.toMatchObject({ code: "P0002" });
    await expect(db.asAnon((q) => q("select public.my_application_modes($1)", [a.appId]))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(a.user.id, (q) => q("select public.leader_stage_modes($1)", [a.appId]))).rejects.toMatchObject({ code: "42501" });
  });

  it("returns the position now for an application that does not exist", async () => {
    await setPositions(db, { interview: "off" });
    const m = (await sql("select public.leader_stage_modes(gen_random_uuid()) as r"))[0].r;
    expect(m.sent).toBe(false);
    expect(m.interview).toBe("off");
    await setPositions(db);
  });
});

describe("at today's positions, every revised function gives the answer it gave before", () => {
  beforeAll(async () => {
    await setPositions(db);
    // The earlier tests left applications that were sent under other positions; these ones start clean
    await sql("delete from public.leader_application_policy");
  });

  it("the readiness score: every combination of what is present, to the last decimal", async () => {
    const callings: (number[] | undefined)[] = [undefined, [4], [4, 4], [5, 3]];
    const interviews: (number[] | undefined)[] = [undefined, [4], [4, 5]];
    const scens: (number | null)[] = [null, 70];
    const refSets: (RefSeed[] | undefined)[] = [undefined, [{ head: true }], [{ head: true }, { rating: 3 }]];
    let n = 0;
    for (const calling of callings)
      for (const interview of interviews)
        for (const scen of scens)
          for (const refs of refSets) {
            const { appId } = await seed({ status: "interviewed", calling, interview, scen, refs });
            await same(INTERNAL, (s) => `select public.application_readiness${s}($1) as r`, [appId], [], { extraKeys: ["weights", "counted", "missing", "evidence", "modes"], label: `readiness ${JSON.stringify({ calling, interview, scen, refs })}` });
            n++;
          }
    expect(n).toBe(4 * 3 * 2 * 3);
  });

  it("the readiness score: at 59, 60, 74 and 75, with an open concern, a held and a disputed referee", async () => {
    // calling, references and interview all rate 60 (every question 3). The situations make up the difference.
    for (const scen of [56, 60, 70, 100]) {
      const { appId } = await seed({ status: "interviewed", calling: [3, 3], interview: [3, 3], scen, refs: [{ head: true, rating: 3 }, { rating: 3 }] });
      await same(INTERNAL, (s) => `select public.application_readiness${s}($1) as r`, [appId], [], { extraKeys: ["weights", "counted", "missing", "evidence", "modes"], label: `scenario ${scen}` });
    }
    for (const calling of [[4, 4], [5, 5], [4, 5]]) {
      for (const scen of [59, 60, 74, 75]) {
        const { appId } = await seed({ status: "interviewed", calling, interview: [4, 4], scen, refs: [{ head: true, rating: 4 }, { rating: 4 }] });
        await same(INTERNAL, (s) => `select public.application_readiness${s}($1) as r`, [appId], [], { extraKeys: ["weights", "counted", "missing", "evidence", "modes"], label: `calling ${calling} scenario ${scen}` });
      }
    }
    for (const refs of [
      [{ head: true, concern: true }, { rating: 4 }],
      [{ head: true, concern: true, cleared: true }, { rating: 4 }],
      [{ head: true, held: true }, { rating: 4 }],
      [{ head: true, disputed: true }, { rating: 4 }],
      [{ head: false }, { rating: 4 }],
      [{ head: true, pending: true }, { rating: 4 }],
    ] as RefSeed[][]) {
      const { appId } = await seed({ status: "interviewed", calling: [4, 4], interview: [4, 4], scen: 80, refs });
      await same(INTERNAL, (s) => `select public.application_readiness${s}($1) as r`, [appId], [], { extraKeys: ["weights", "counted", "missing", "evidence", "modes"], label: `referees ${JSON.stringify(refs)}` });
    }
    const { appId } = await seed({ status: "interviewed", calling: [4, 4], interview: [4, 4], scen: 80, refs: [{ head: true }, {}], aiClear: true });
    await same(INTERNAL, (s) => `select public.application_readiness${s}($1) as r`, [appId], [], { extraKeys: ["weights", "counted", "missing", "evidence", "modes"], label: "first check passed" });
    await same(INTERNAL, (s) => `select public.application_readiness${s}(gen_random_uuid()) as r`, [], [], { label: "no such application" });
  });

  it("the decision: every status, decision and reason, errors word for word, roles and status left behind", async () => {
    const afterOf = (id: string) => [
      `select status, decision_note, decided_by is not null as decided from public.leader_applications where id = '${id}'`,
      `select role from public.person_roles where person_id = (select person_id from public.leader_applications where id = '${id}') order by role`,
      `select action, meta - 'evidence' as meta from public.event_log where entity_id = '${id}' and action = 'leader.decided'`,
    ];
    const full = { calling: [5, 5], interview: [5, 5], scen: 90, refs: [{ head: true }, {}] };
    const cases: Seed[] = [
      { ...full, status: "interviewed" },
      { ...full, status: "submitted" },
      { ...full, status: "interview_invited" },
      { ...full, status: "interview_booked" },
      { ...full, status: "approved_leader" },
      { ...full, status: "draft" },
      { ...full, status: "interviewed", scen: null },
      { ...full, status: "interviewed", refs: [{ head: true, concern: true }, {}] },
      { ...full, status: "interviewed", refs: [{ head: false }, {}] },
      { ...full, status: "interviewed", refs: [{ head: true }] },
      { ...full, status: "interviewed", scen: 45, interview: [3, 3], calling: [3, 3] },
      { ...full, status: "interviewed", scen: 60, interview: [4, 4], calling: [4, 4], refs: [{ head: true, rating: 4 }, { rating: 4 }] },
      { ...full, status: "interviewed", calling: [4] },
      { ...full, status: "interviewed", answers: answers(undefined, { calling: { track: "builders", community: "professionals" } }) },
    ];
    for (const [i, c] of cases.entries()) {
      for (const decision of ["leader", "assistant_leader", "not_approved", "wizard"]) {
        for (const note of [null, "  A kind word.  "]) {
          const { appId } = await seed(c);
          await same(staff.pastor.id, (s) => `select public.decide_application${s}($1, $2, $3) as r`, [appId, decision, note], afterOf(appId), { label: `case ${i} ${decision}` });
        }
      }
    }
    // Who may decide
    const { appId, user } = await seed({ ...full, status: "interviewed" });
    for (const who of [staff.coach, staff.director, user, null]) {
      await same(who?.id ?? null, (s) => `select public.decide_application${s}($1, 'leader', null) as r`, [appId], afterOf(appId), { label: `decided by ${who ? "someone else" : "nobody"}` });
    }
  });

  it("the invitation: every status, reviewer count, reference count and first-check state", async () => {
    const afterOf = (id: string) => [`select status from public.leader_applications where id = '${id}'`];
    const cases: Seed[] = [
      { calling: [4, 4], refs: [{ head: true }, {}] },
      { calling: [4], refs: [{ head: true }, {}] },
      { calling: [], refs: [{ head: true }, {}] },
      { calling: [4, 4], refs: [{ head: true }] },
      { calling: [4, 4], refs: [{ head: true }, { pending: true }] },
      { calling: [4, 4], refs: [] },
      { calling: [], refs: [{ head: true }, {}], aiClear: true },
      { calling: [4, 4], refs: [{ head: true }, {}], status: "interview_invited" },
      { calling: [4, 4], refs: [{ head: true }, {}], status: "draft" },
    ];
    for (const [i, c] of cases.entries()) {
      for (const who of [staff.director, staff.pastor, staff.coach]) {
        const { appId } = await seed(c);
        await same(who.id, (s) => `select public.invite_to_interview${s}($1) as r`, [appId], afterOf(appId), { label: `case ${i}` });
      }
    }
    // An AI hold stops it, and an unknown application is not found
    const held = await seed({ calling: [4, 4], refs: [{ head: true }, {}] });
    await sql("insert into public.leader_ai_state (application_id, state, basis) values ($1, 'held', 'ai')", [held.appId]);
    await same(staff.director.id, (s) => `select public.invite_to_interview${s}($1) as r`, [held.appId], [], { label: "held" });
    await same(staff.director.id, (s) => `select public.invite_to_interview${s}(gen_random_uuid()) as r`, [], [], { label: "no such application" });
  });

  it("the eligibility check: all yes, any no, a missing answer, a stopped or sent application", async () => {
    const yes = Object.fromEntries(ELIG_KEYS.map((k) => [k, true]));
    const sets: Record<string, unknown>[] = [
      yes,
      { ...yes, age21: false },
      { ...yes, member6: false, time: false },
      Object.fromEntries(ELIG_KEYS.map((k) => [k, false])),
      Object.fromEntries(ELIG_KEYS.filter((k) => k !== "serving").map((k) => [k, true])),
      { ...yes, serving: "yes" },
      { ...yes, serving: null },
      {},
    ];
    const afterOf = (id: string) => [`select status, failed_checks, step from public.leader_applications where id = '${id}'`, `select action, meta from public.event_log where entity_id = '${id}' and action = 'leader.ineligible'`];
    for (const [i, e] of sets.entries()) {
      for (const status of ["draft", "ineligible", "submitted"]) {
        const { user, appId } = await seed({ status, eligibility: e });
        await same(user.id, (s) => `select public.check_leader_eligibility${s}($1) as r`, [appId], afterOf(appId), { label: `set ${i} ${status}` });
      }
    }
    const { appId } = await seed({ status: "draft", eligibility: yes });
    const other = await kit.person();
    await same(other.id, (s) => `select public.check_leader_eligibility${s}($1) as r`, [appId], [], { label: "someone else's" });
    await same(null, (s) => `select public.check_leader_eligibility${s}($1) as r`, [appId], [], { label: "nobody" });
  });

  it("sending: every answer that is missing or wrong, the referee rules, and a good application", async () => {
    const afterOf = (id: string) => [
      `select status, step, submitted_at is not null as sent from public.leader_applications where id = '${id}'`,
      `select scenario_pct, scenario_detail from public.leader_assessments where application_id = '${id}'`,
      `select action from public.event_log where entity_id = '${id}' and action = 'leader.applied'`,
    ];
    const good = answers();
    const withCalling = (c: Record<string, unknown>) => answers(undefined, { calling: { ...(good.calling as object), ...c } });
    const variants: [string, Record<string, unknown>, RefSeed[]][] = [
      ["good", good, [{ head: true }, {}]],
      ["good, head second", good, [{}, { head: true }]],
      ["no referees", good, []],
      ["one referee", good, [{ head: true }]],
      ["no head", good, [{}, {}]],
      ["an eligibility no", answers({ ...good.eligibility, age21: false }), [{ head: true }, {}]],
      ["an eligibility missing", answers({ ...good.eligibility, time: undefined }), [{ head: true }, {}]],
      ["no track", withCalling({ track: "" }), [{ head: true }, {}]],
      ["no goal", withCalling({ goal: "" }), [{ head: true }, {}]],
      ["a goal of their own", withCalling({ goal: "", goalOther: "Help my neighbours" }), [{ head: true }, {}]],
      ["no relation", withCalling({ goalRelation: "" }), [{ head: true }, {}]],
      ["a short answer", withCalling({ why: "short" }), [{ head: true }, {}]],
      ["no walk rating", withCalling({ walkRating: 9 }), [{ head: true }, {}]],
      ["no whatsapp", answers(undefined, { contact: { whatsapp: "" } }), [{ head: true }, {}]],
      ["no leading style", answers(undefined, { style: {} }), [{ head: true }, {}]],
      ["a missing situation", answers(undefined, { scenarios: { s1: { best: "b", worst: "d" } } }), [{ head: true }, {}]],
      ["same best and worst", answers(undefined, { scenarios: { ...(good.scenarios as object), s1: { best: "b", worst: "b" } } }), [{ head: true }, {}]],
    ];
    for (const [label, ans, refs] of variants) {
      const { user, appId } = await seed({ status: "draft", answers: ans, refs });
      await same(user.id, (s) => `select public.submit_leader_application${s}($1) as r`, [appId], afterOf(appId), { label });
    }
    const sent = await seed({ status: "submitted", refs: [{ head: true }, {}] });
    await same(sent.user.id, (s) => `select public.submit_leader_application${s}($1) as r`, [sent.appId], [], { label: "already sent" });
    const other = await kit.person();
    await same(other.id, (s) => `select public.submit_leader_application${s}($1) as r`, [sent.appId], [], { label: "someone else's" });
  });

  it("asking a referee: every state of the application and the referee", async () => {
    const cases: [string, Seed][] = [
      ["sent", { status: "submitted", refs: [{ head: true, pending: true }, { pending: true }] }],
      ["draft", { status: "draft", refs: [{ head: true, pending: true }, { pending: true }] }],
      ["answered", { status: "submitted", refs: [{ head: true }, { pending: true }] }],
      ["booked", { status: "interview_booked", refs: [{ head: true, pending: true }, { pending: true }] }],
      ["decided", { status: "approved_leader", refs: [{ head: true, pending: true }, { pending: true }] }],
    ];
    for (const [label, c] of cases) {
      const { user, appId } = await seed(c);
      const refId = (await sql("select id from public.leader_references where application_id = $1 order by slot limit 1", [appId]))[0].id;
      await same(user.id, (s) => `select public.request_referee_send${s}($1) as r`, [refId], [`select requests, stage from public.leader_references where id = '${refId}'`], { label });
    }
    const held = await seed({ status: "submitted", refs: [{ head: true, pending: true }, { pending: true }] });
    await sql("insert into public.leader_ai_state (application_id, state, basis) values ($1, 'checking', 'ai')", [held.appId]);
    const refId = (await sql("select id from public.leader_references where application_id = $1 order by slot limit 1", [held.appId]))[0].id;
    await same(held.user.id, (s) => `select public.request_referee_send${s}($1) as r`, [refId], [], { label: "first check running (off)" });
    await same((await kit.person()).id, (s) => `select public.request_referee_send${s}($1) as r`, [refId], [], { label: "someone else's" });
    await same(held.user.id, (s) => `select public.request_referee_send${s}(gen_random_uuid()) as r`, [], [], { label: "no such referee" });
  });

  it("the queue, one application, the activity funnel and booking", async () => {
    // A spread of applications in every state
    const spread: Seed[] = [
      { status: "submitted", calling: [4], refs: [{ head: true }] },
      { status: "interview_invited", calling: [4, 4], refs: [{ head: true }, {}] },
      { status: "interview_booked", calling: [4, 4], refs: [{ head: true }, {}] },
      { status: "interviewed", calling: [4, 4], interview: [4, 4], scen: 80, refs: [{ head: true }, {}] },
      { status: "approved_leader", calling: [4, 4], interview: [4, 4], scen: 80, refs: [{ head: true }, {}] },
      { status: "not_approved", calling: [2] },
      { status: "draft" },
      { status: "ineligible" },
      { status: "submitted", refs: [{ head: true, concern: true }, {}] },
    ];
    const made = [] as { appId: string }[];
    for (const s of spread) made.push(await seed(s));
    // the queue gains two keys per row and keeps every other one
    const queueNew = (await probe(staff.pastor.id, "select public.review_queue() as r")).outcome as { ok: true; value: Row[] };
    const queueOld = (await probe(staff.pastor.id, "select public.review_queue_v1() as r")).outcome as { ok: true; value: Row[] };
    expect(queueNew.value.length).toBe(queueOld.value.length);
    const madeIds = new Set(made.map((m) => m.appId));
    for (const row of queueNew.value.filter((r) => madeIds.has(r.id as string))) {
      expect(row.references_mode).toBe("required");
      expect(row.interview_mode).toBe("required");
      const { references_mode: _r, interview_mode: _i, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
      expect(queueOld.value.find((o) => o.id === row.id)).toEqual(rest);
    }
    const stranger = await kit.person();
    for (const who of [staff.coach.id, staff.director.id, staff.pastor.id, null, stranger.id]) {
      await same(who, (s) => `select public.review_queue${s}() as r`, [], [], { extraKeys: ["references_mode", "interview_mode"], label: "the queue for someone" });
    }
    for (const { appId } of made) {
      for (const who of [staff.pastor, staff.coach, staff.director]) {
        await same(who.id, (s) => `select public.review_application${s}($1) as r`, [appId], [], { extraKeys: ["modes", "optional_no", "evidence", "evidence_note", "weights", "counted", "missing"], label: `opening ${appId}` });
      }
    }
    // The funnel: every row, every column
    await sql("select public.activity_refresh(now(), true)");
    const rows = async (fn: string) => (await sql(`select * from public.${fn}('2020-01-01'::date, '2030-01-01'::date) order by person_id`)).map((r) => JSON.stringify(r));
    expect(await rows("activity_leader_rows")).toEqual(await rows("activity_leader_rows_v1"));
    expect((await rows("activity_leader_rows")).length).toBeGreaterThan(8);
    // Booking
    const slot = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [new Date(Date.now() + 5 * 864e5).toISOString()]))).rows[0].id;
    const invited = await seed({ status: "interview_invited", calling: [4, 4], refs: [{ head: true }, {}] });
    await same(invited.user.id, (s) => `select public.book_interview_slot${s}($1) as r`, [slot], [`select status from public.leader_applications where id = '${invited.appId}'`, `select application_id is not null as taken from public.interview_slots where id = '${slot}'`], { label: "booking" });
    const draft = await seed({ status: "draft" });
    await same(draft.user.id, (s) => `select public.book_interview_slot${s}($1) as r`, [slot], [], { label: "booking when not invited" });
  });

  it("the first check's message to the applicant is exactly what it was", async () => {
    const { user, appId } = await seed({ status: "submitted", calling: [], refs: [{ head: true }, {}] });
    await sql("insert into public.leader_ai_state (application_id, state, basis) values ($1, 'held', 'ai')", [appId]);
    await db.asUser(staff.pastor.id, (q) => q("select public.leader_ai_clear($1, 'read it')", [appId]));
    const sent = await sql("select template, params from public.messages where person_id = $1 and template = 'leader_check_clear'", [user.id]).catch(() => [] as Row[]);
    const rows = sent.length ? sent : await sql("select template, params from public.messages where template = 'leader_check_clear' order by created_at desc limit 1");
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].params)).toEqual(["first_name"]);
    // and the trigger's message for a sent application
    const received = await sql("select params from public.messages where template = 'application_received' order by created_at desc limit 1");
    if (received.length) expect(Object.keys(received[0].params).sort()).toEqual(["first_name", "minutes", "mode", "place", "role", "starts_at"].filter((k) => k in received[0].params).sort());
  });

  it("no revised function was copied by a changed argument list", async () => {
    const names = [
      "check_leader_eligibility", "submit_leader_application", "invite_to_interview", "application_readiness", "decide_application", "review_queue",
      "request_referee_send", "book_interview_slot", "review_application", "activity_leader_rows", "on_application_stage", "leader_ai_clear", "worker_save_leader_ai_score",
    ];
    for (const name of names) {
      const n = (await sql("select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1", [name]))[0].n;
      expect(n, name).toBe(1);
    }
  });
});

describe("the switches never move the bars", () => {
  it("a leader needs 75 and an assistant leader 60 under every position", async () => {
    for (const positions of [{}, OPEN_DOOR, ALL_OFF, { references: "optional", interview: "optional" } as Positions]) {
      await setPositions(db, positions);
      // calling 80, situations 70: 75.5 on calling and situations alone, the leader range
      const high = await seed({ status: "submitted", calling: [4, 4], scen: 70 });
      const low = await seed({ status: "submitted", calling: [3, 3], scen: 70 });
      const hi = await kit.readiness(high.appId);
      const lo = await kit.readiness(low.appId);
      if ((positions.references ?? "required") === "required" || (positions.interview ?? "required") === "required") {
        expect(hi.readiness).toBeNull();
        continue;
      }
      expect(Number(hi.readiness)).toBe(75.5);
      expect(hi.band).toBe("leader");
      expect(Number(lo.readiness)).toBe(Math.round(((60 * 30 + 70 * 25) / 55) * 10) / 10);
      expect(lo.band).toBe("assistant_leader");
      await expect(db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [low.appId]))).rejects.toThrow(/leader needs a readiness score of 75/);
    }
    await setPositions(db);
  });
});
