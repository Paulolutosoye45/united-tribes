import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";
import { REPRESENTATIVE, journey, makeEnv, tableCounts, type Env } from "./matrix-kit";
import { pipelineKit, type PipelineKit } from "./pipeline-kit";

// Phase 8, part three: the way back, rehearsed. Everything is applied forward, all 100 cards are signed off, applicants are taken through, and
// then the three rollback files are run in the order the release notes give. What is left must match the database as it stood before the
// rework began (Phase 0), function for function, with every row still there. The original test suite is run against the same state by
// scripts/rehearse-rollback.sh.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
/** The last migration of the database before the rework (Phase 0): the baseline everything is compared with. */
const LAST_BEFORE_REWORK = "20261215000100";
/** Run in this order: newest first. */
const DOWN = ["20261221000100_leader_fit_screen.down.sql", "20261218000100_academy_switch.down.sql", "20261217000100_leader_switchboard.down.sql"];

let db: TestDb;
let kit: PipelineKit;
let env: Env;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

const functions = async (c: Client) =>
  new Map(
    (await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)).rows.map((r) => [r.sig as string, r.def as string]),
  );

beforeAll(async () => {
  const port = inject("pgPort");
  // The baseline: the database as the rename migration left it, plus everything up to the last file before the rework
  baselineName = `base_${Date.now().toString(36)}`;
  rootClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await rootClient.connect();
  await rootClient.query(`create database ${baselineName} template ut_before_tribes`);
  baseline = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: baselineName });
  await baseline.connect();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f >= "20261210000100" && f.slice(0, 14) <= LAST_BEFORE_REWORK)
    .sort();
  for (const f of files) await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));

  db = await createTestDb();
  kit = pipelineKit(db);
  env = await makeEnv(db, kit, "Zephyrine Hiddenowner");
}, 240_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await db?.close();
});

describe("the way back, rehearsed", () => {
  let functionsBefore: Map<string, string>;
  let countsForward: Map<string, number>;

  it("applies everything forward, signs off all 100 cards and takes applicants through under three sets of positions", async () => {
    const pastor = env.staff.pastor.id;
    for (const c of await sql("select id from public.communities where active order by sort, slug")) await db.asUser(pastor, (q) => q("select public.card_template_sign_off_community($1)", [c.id]));
    for (const s of await sql("select slug from public.tribe_card_templates where status = 'draft' and sensitive order by slug")) await db.asUser(pastor, (q) => q("select public.card_template_sign_off($1)", [s.slug]));
    expect((await sql("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'"))[0].n).toBe(100);

    // today's positions, the open door with Find your tribe on, and everything off
    for (const combo of [REPRESENTATIVE[0], REPRESENTATIVE[2], REPRESENTATIVE[3]]) {
      const out = await journey(env, combo);
      expect(out.failures, JSON.stringify(combo)).toEqual([]);
    }
    functionsBefore = await functions(db.admin);
    countsForward = await tableCounts(db);
  });

  it("has revised functions to put back: the database now differs from the baseline in the functions the plan lists", async () => {
    const base = await functions(baseline);
    const changed = [...base].filter(([sig, def]) => functionsBefore.get(sig) !== def).map(([sig]) => sig.split("(")[0]);
    // 14 from Phase 2, and 10 more from Phase 3 (leader_message_flags is new in Phase 2, and on_application_stage is counted once). The two Phase 6
    // hooks began in Phases 1 and 2, so they are not in the baseline at all.
    expect(changed.length).toBe(14 + 10);
  });

  it("runs the three rollback files, newest first, and they run without error", async () => {
    for (const f of DOWN) {
      const text = fs.readFileSync(path.join(ROLLBACK, f), "utf8");
      expect(text, f).toMatch(/^-- /);
      expect(text, f).toMatch(/\bbegin;/);
      expect(text, f).toMatch(/\bcommit;\s*$/);
      // They put function bodies back and drop triggers, and do nothing else
      expect(text.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g, ""), f).not.toMatch(/\b(delete|truncate|drop\s+table|drop\s+column|alter\s+table|insert|update)\b\s/i);
      await db.admin.query(text);
    }
  });

  it("leaves every function exactly as it was before the rework, with only the new functions added", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    const different = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig);
    expect(different).toEqual([]);
    // what is extra is only what the rework added, by name, in the migration files
    const created = new Set<string>();
    for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.slice(0, 14) > LAST_BEFORE_REWORK)) {
      for (const m of fs.readFileSync(path.join(MIGRATIONS, f), "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    }
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map((sig) => sig.split("(")[0]);
    expect(extra.filter((n) => !created.has(n))).toEqual([]);
  });

  it("drops the triggers the rework added to old tables, and no others", async () => {
    const triggers = await sql(
      `select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where not g.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    );
    const names = triggers.map((r) => r.t as string);
    for (const gone of ["leader_pipeline_settings.leader_pipeline_settings_release", "person_roles.leader_roles_certify", "leader_pipeline_settings.leader_pipeline_settings_certify"]) {
      expect(names, gone).not.toContain(gone);
    }
    const base = (await baseline.query(
      `select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relnamespace = 'public'::regnamespace`,
    )).rows.map((r) => r.t as string);
    for (const t of base) expect(names, t).toContain(t);
  });

  it("deletes and changes no row: every table has exactly the rows it had before", async () => {
    const after = await tableCounts(db);
    for (const [table, n] of countsForward) expect(after.get(table), table).toBe(n);
    // and the cards are all still signed off, the certificates all still there
    expect((await sql("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'"))[0].n).toBe(100);
  });

  it("is safe to run twice", async () => {
    const was = await functions(db.admin);
    for (const f of DOWN) await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
    const now = await functions(db.admin);
    expect([...was].filter(([sig, def]) => now.get(sig) !== def)).toEqual([]);
  });

  it("works as it always did: a whole application, a decision, a certificate, and the new cards retired", async () => {
    // the process as it has always run
    await db.admin.query("update public.leader_pipeline_settings set preset = 'full', elig_member6 = 'required', elig_foundation = 'required', elig_serving = 'required', elig_age21 = 'required', elig_time = 'required', elig_safeguarding = 'required', elig_confidentiality = 'required', references_mode = 'required', interview_mode = 'required', academy_mode = 'required', declaration_mode = 'required', tribe_fit = 'off'");
    const w = await kit.walk({}, { staff: env.staff });
    expect(w.decided).toMatchObject({ ok: true, status: "approved_leader" });
    expect(w.role).toBe(true);
    // the 77 new cards retired: their goals switch off, nothing is deleted
    const original = (await baseline.query("select slug from public.season_goals")).rows.map((r) => r.slug as string);
    expect(original).toHaveLength(23);
    const before = (await sql("select count(*)::int n from public.tribe_card_templates"))[0].n;
    const fresh = await sql("select slug from public.tribe_card_templates where status = 'signed_off' and not (slug = any($1)) order by slug", [original]);
    expect(fresh).toHaveLength(77);
    for (const s of fresh) await db.asUser(env.staff.pastor.id, (q) => q("select public.card_template_retire($1)", [s.slug]));
    expect((await sql("select count(*)::int n from public.tribe_card_templates"))[0].n).toBe(before);
    expect((await sql("select count(*)::int n from public.season_goals where active"))[0].n).toBe(23);
  });
});
