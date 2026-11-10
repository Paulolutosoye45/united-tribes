import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "requests to the owner, seen and answered", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270114000100) and the one with everything applied. The migration may replace
// exactly one function (notice_sweep, which gains one line in its list of daily checks) and add exactly one (the check for lapsed requests). The rollback file
// must put notice_sweep back exactly as it was, drop the check, change nothing the second time, and keep every request, notice and message already made.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270114000100";
const THIS = "20270115000100_owner_requests";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270115000100")
  .sort()
  .reverse();
const REPLACED = ["notice_sweep"];
const ADDED = ["notice_chk_placement_requests"];

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
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `orrbase_${Date.now().toString(36)}`;
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

describe("the way back from 'requests to the owner'", () => {
  let before: Record<string, number>;

  it("is what the migration added: one function replaced (notice_sweep) and one new, nothing else changed", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect([...created].sort()).toEqual([...ADDED].sort());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    // the sweep gained the one check, and every line it had is still there
    const was = base.get("notice_sweep(p_now timestamp with time zone)") ?? "";
    const is = now.get("notice_sweep(p_now timestamp with time zone)") ?? "";
    expect(was.length).toBeGreaterThan(500);
    expect(is).toContain("('notice_chk_placement_requests', 'daily')");
    expect(is.replace(" ('notice_chk_placement_requests', 'daily'),", "")).toBe(was);
  });

  it("starts with something to keep", async () => {
    await c.reset();
    before = {
      placement_requests: await count("placement_requests"),
      notice_items: await count("notice_items"),
      messages: await count("messages"),
      event_log: await count("event_log"),
      tribe_members: await count("tribe_members"),
    };
  });

  it("runs the rollback file without error, and writes nothing to any table", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const body = code.match(/create\s+or\s+replace\s+function\s+public\.notice_sweep[\s\S]*?\$\$;/i);
    expect(body).not.toBeNull();
    const own = code.replace(body?.[0] ?? "", "");
    expect(own).not.toMatch(/\b(truncate|insert|update|delete)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|table|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps every request, notice, message and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("stops the check, and the sweep still runs without it", async () => {
    await expect(c.db.admin.query("select public.notice_chk_placement_requests(now())")).rejects.toThrow(/does not exist/);
    const swept = (await c.db.admin.query("select public.notice_sweep(now()) as r")).rows[0].r;
    expect(swept).toHaveProperty("problems");
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });
});
