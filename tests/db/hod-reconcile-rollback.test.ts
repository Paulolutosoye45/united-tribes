import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Fix 7" (the report of the heads-of-department list), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270123000100, the end of Fix 8) and the one with everything applied. The migration
// replaces no function, adds eight, two tables and no column, trigger or Switchboard line. The rollback file must drop everything that was added, keep every department already put
// on a leader, every invitation, role, tribe, member, message and log line, change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270123000100";
const THIS = "20270124000100_hod_reconcile";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270124000100")
  .sort()
  .reverse();
const REPLACED: string[] = [];
const TABLES = ["hod_reconcile_rows", "hod_reconciles"];

let c: Cast;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const functions = async (cl: Client) =>
  new Map(
    (
      await cl.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)
    ).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (cl: Client) =>
  (
    await cl.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                     where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)
  ).rows.map((r) => r.t as string);
const tables = async (cl: Client) => (await cl.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).rows.map((r) => r.relname as string);
const columns = async (cl: Client) =>
  (
    await cl.query(`select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as c
                      from information_schema.columns where table_schema = 'public' and table_name in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings', 'messages')
                     order by table_name, ordinal_position`)
  ).rows.map((r) => r.c as string);
const constraints = async (cl: Client) =>
  (
    await cl.query(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings') order by 1`)
  ).rows.map((r) => r.c as string);
const indexes = async (cl: Client) =>
  (await cl.query("select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings') order by 1")).rows.map(
    (r) => r.i as string,
  );
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const registry = async (cl: Client) => (await cl.query("select key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only from public.feature_registry order by sort, key")).rows;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `sabase_${Date.now().toString(36)}`;
  rootClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await rootClient.connect();
  await rootClient.query(`create database ${baselineName} template ut_before_tribes`);
  baseline = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: baselineName });
  await baseline.connect();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f >= "20261210000100" && f.slice(0, 14) <= LAST_BEFORE)
    .sort();
  for (const f of files) await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  c = await makeCast();
  for (const f of LATER_DOWN) await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await c?.db.close();
});

describe("the way back from Fix 7", () => {
  let before: Record<string, number>;
  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("is what the migration did: no function replaced, eight new, two tables, and no column, trigger or Switchboard line", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect(created.size).toBe(8);
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t)).sort()).toEqual([...TABLES].sort());
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
  });

  it("starts with something to keep: a report, a department put on a leader, an invitation sent", async () => {
    const email = (await c.one("select email from public.people where id = $1", [c.seasoned.id])).email as string;
    const r = await c.as(c.admin, "hod_reconcile_run", JSON.stringify([{ name: "Seasoned", email, department: "Ushers" }, { name: "New", email: "rollback.new@example.org" }]), "Before the way back");
    expect(r.counts).toEqual({ appointed: 1, no_account: 1 });
    expect(await c.as(c.admin, "hod_reconcile_tag", r.id)).toEqual({ tagged: 1, differs: 0 });
    expect(await c.as(c.admin, "hod_reconcile_invite", r.id)).toEqual({ invited: 1 });
    expect(await count("hod_reconcile_rows")).toBe(2);
    before = {
      leader_departments: await count("leader_departments"),
      invitations: await count("invitations"),
      person_roles: await count("person_roles"),
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      people: await count("people"),
      event_log: await count("event_log"),
    };
  });

  it("runs the rollback file without error, and touches only what the migration added or replaced", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "$$$$");
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect([...code.matchAll(/\bdrop\s+table\b[^;]*;/gi)].map((m) => m[0]).sort()).toEqual(TABLES.map((t) => `drop table if exists public.${t};`).sort());
    expect(code).not.toMatch(/\binsert\b/i);
    expect(code).not.toMatch(/\bupdate\b/i);
    expect(code).not.toMatch(/\bdelete\b/i);
    expect([...text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions, triggers, tables, columns, checks and indexes the database had before, each function unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect(await tables(c.db.admin)).toEqual(await tables(baseline));
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    expect(await constraints(c.db.admin)).toEqual(await constraints(baseline));
    expect(await indexes(c.db.admin)).toEqual(await indexes(baseline));
  });

  it("keeps every department, invitation, role, tribe, member, message and log line, and the report is gone", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect((await c.one("select department from public.leader_departments where person_id = $1", [c.seasoned.id])).department).toBe("Ushers");
    expect((await c.one("select status from public.invitations where email = 'rollback.new@example.org'")).status).toBe("pending");
    await expect(c.as(c.admin, "hod_reconcile_list")).rejects.toThrow(/does not exist/);
    expect((await c.one("select to_regclass('public.hod_reconciles') as t")).t).toBeNull();
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTables = await tables(c.db.admin);
    const firstColumns = await columns(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await tables(c.db.admin)).toEqual(firstTables);
    expect(await columns(c.db.admin)).toEqual(firstColumns);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("can be applied again over the way back", async () => {
    await c.db.admin.query(migrationText());
    expect((await functions(c.db.admin)).has("hod_results(p_run uuid)")).toBe(true);
    expect((await c.as(c.admin, "hod_reconcile_list")).runs).toEqual([]);
    expect(await count("hod_reconcile_rows")).toBe(0);
  });
});
