import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";
import { pipelineKit, type PipelineKit } from "./pipeline-kit";
import { DIMENSIONS, REPRESENTATIVE, TOTAL, allCombos, comboName, journey, makeEnv, type Combo, type Env } from "./matrix-kit";

// Phase 8: the combined test matrix. One journey takes an applicant from the first answer to a tribe that members can see, under a whole
// set of positions of every switch, and twelve invariants are read after every journey. Ordinary runs do the twelve representative
// combinations; the release run (UT_FULL_MATRIX=1, or `npm run test:matrix`) does all 324. If anything fails, the combination and the
// invariant are printed.

const FULL = process.env.UT_FULL_MATRIX === "1";
const OWNER_NAME = "Zephyrine Hiddenowner";

let db: TestDb;
let kit: PipelineKit;
let env: Env;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

const INVARIANTS = [
  "Only a pastor's decision produces an approval",
  "The readiness bars are 75 and 60, and the weights used add to 100",
  "An open referee concern blocks approval",
  "A tribe is shown to members only when its card is approved and its leader is certified",
  "A person is certified exactly when the certification rule table says so",
  "No application is left waiting for a stage that is off",
  "No application is stuck at ineligible because of a question that is not Required",
  "The applicant's own view carries no scores, tags, reasons, judgement, care or hidden card data",
  "The activity funnel shows no drop at a stage that was off",
  "No hidden owner's name is in any log, list or screen a normal user can open",
  "Every message queued matches the wording flags, and none is queued twice",
  "Nothing the new code does deletes a row",
];

beforeAll(async () => {
  db = await createTestDb();
  kit = pipelineKit(db);
  env = await makeEnv(db, kit, OWNER_NAME);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the matrix itself", () => {
  it("has 324 combinations, all different", () => {
    const all = allCombos();
    expect(TOTAL).toBe(324);
    expect(all).toHaveLength(324);
    expect(new Set(all.map(comboName)).size).toBe(324);
  });

  it("has twelve representative combinations that put every position of every switch at least once", () => {
    expect(REPRESENTATIVE).toHaveLength(12);
    expect(new Set(REPRESENTATIVE.map(comboName)).size).toBe(12);
    for (const key of Object.keys(DIMENSIONS) as (keyof Combo)[]) {
      for (const value of DIMENSIONS[key]) {
        expect(REPRESENTATIVE.some((c) => c[key] === value), `${key} = ${value}`).toBe(true);
      }
    }
  });

  it("names twelve invariants", () => {
    expect(INVARIANTS).toHaveLength(12);
  });
});

const RUN: Combo[] = FULL ? allCombos() : REPRESENTATIVE;

describe(FULL ? "all 324 combinations, start to finish" : "the twelve representative combinations, start to finish", () => {
  const seen = new Set<number>();

  for (const combo of RUN) {
    it(comboName(combo), { timeout: 120_000 }, async () => {
      const out = await journey(env, combo);
      for (const i of out.checked) seen.add(i);
      // Printed as: the combination, then each invariant that failed
      expect(
        out.failures.map((f) => `invariant ${f.invariant} (${INVARIANTS[f.invariant - 1]}): ${f.text}`),
        comboName(combo),
      ).toEqual([]);
      // Every journey reads all twelve
      expect([...out.checked].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      // and the plain happy path
      expect(out.facts.decided).toMatchObject({ ok: true, status: "approved_leader" });
      expect(out.facts.role).toBe(true);
      expect(out.facts.certified).toBe(true);
      expect(out.facts.offered).toBe(true);
    });
  }

  it("read every invariant at least once", () => {
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("the owner's name, across the whole house, after the journeys", () => {
  it("is in no table a normal user can reach, apart from the owner's own person row", async () => {
    const tables = (await sql("select table_name::text t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).map((r) => r.t as string);
    const hits: string[] = [];
    for (const t of tables) {
      if (["people", "god_log", "platform_owner", "platform_owner_unlocks", "platform_owners"].includes(t)) continue;
      const n = (await sql(`select count(*)::int n from public.${t} x where x::text ilike '%' || $1 || '%'`, [OWNER_NAME]))[0].n as number;
      if (n > 0) hits.push(`${t}: ${n}`);
    }
    expect(hits).toEqual([]);
  });
});
