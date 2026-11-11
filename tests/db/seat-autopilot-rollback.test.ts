import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Package 8" (the Seat autopilot: the bench, the daily plan, opening small tribes, the small-tribe watch), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270121000100, the end of the series) and the one with everything applied. The migration
// replaces two functions (seat_morning_numbers and worker_seat_window_tick), adds 13, two triggers, three tables and one line on the Switchboard, and no column. The
// rollback file must put the two functions back exactly as they were, drop everything that was added, keep every seat, member, tribe, message, notice, consent and log
// line (a person autopilot placed stays placed, with their email and their seat), change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270121000100";
const THIS = "20270122000100_seat_autopilot";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270122000100")
  .sort()
  .reverse();
const REPLACED = ["seat_morning_numbers", "worker_seat_window_tick"];
const TABLES = ["autopilot_items", "autopilot_plans", "autopilot_settings"];
const TRIGGERS = ["feature_settings.autopilot_gate_insert", "feature_settings.autopilot_gate_update"];

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

describe("the way back from Package 8", () => {
  let before: Record<string, number>;
  let leftTm: string;
  let placed: string;
  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("is what the migration did: two functions replaced, thirteen new, two triggers, three tables and one Switchboard line, and no column", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect(created.size).toBe(13);
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const baseTriggers = await triggers(baseline);
    expect((await triggers(c.db.admin)).filter((t) => !baseTriggers.includes(t)).sort()).toEqual([...TRIGGERS].sort());
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t)).sort()).toEqual([...TABLES].sort());
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    const baseRegistry = await registry(baseline);
    expect((await registry(c.db.admin)).filter((r) => !baseRegistry.some((b) => b.key === r.key)).map((r) => r.key)).toEqual(["seat_autopilot"]);
  });

  it("starts with something to keep: a person autopilot placed, the ordinary seats and messages, and the owner's numbers", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    await c.db.admin.query("update public.seat_window_settings set last_tick_at = now()");
    await c.set("seat_window", "on", { reason: "Trying the autopilot rollback" });
    await c.set("seat_autopilot", "on", { reason: "Trying the autopilot rollback" });
    await c.db.admin.query("update public.autopilot_settings set mode = 'auto'");
    const hourDef = (await c.one("select pg_get_functiondef('public.lagos_hour()'::regprocedure) as d")).d as string;
    await c.db.admin.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 10 $$");
    const t = await c.k.tribe(c.season, { name: "Keep this tribe", capacity: 12, slot: "weeknight-evening" });
    for (let i = 0; i < 4; i++) await c.k.seat(t.tribe, c.season, `KeepM${i}`, { profile: i < 2 ? { faith: "established", social: i === 0 ? -1 : 1 } : {} });
    const w = await readyMember(c.db, c.k, c.season, "KeepPlaced", { daysAgo: 20, times: ["weeknight-evening"] });
    const r = (await c.one("select public.autopilot_tick() as r")).r as { plan?: boolean; state?: string };
    expect(r).toMatchObject({ plan: true, state: "planned" });
    placed = w.id;
    leftTm = (await c.one("select id from public.tribe_members where person_id = $1 and status = 'active'", [w.id])).id as string;
    await c.o.call("god_seat_settings_set", 72, 24, 60, 5, 2, 20, 75, null, "Keeping these for the way back");
    await c.db.admin.query(hourDef);
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      consents: await count("consents"),
      people: await count("people"),
      event_log: await count("event_log"),
      seat_clocks: await count("seat_clocks"),
      seat_ledger: await count("seat_ledger"),
      placement_runs: await count("placement_runs"),
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
    expect(text).toMatch(/delete from public\.feature_settings where feature = 'seat_autopilot'/);
    expect(text).toMatch(/delete from public\.feature_registry where key = 'seat_autopilot'/);
    expect([...text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions, triggers, tables, columns, checks, indexes and Switchboard the database had before, each function and each registry line unchanged", async () => {
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
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
  });

  it("keeps every seat, the person autopilot placed with their email and their line in the ledger, and every message and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect((await c.one("select status from public.tribe_members where id = $1", [leftTm]))).toMatchObject({ status: "active" });
    expect((await c.sql("select 1 from public.messages where person_id = $1 and template = 'placement_your_tribe'", [placed])).length).toBe(1);
    expect((await c.one("select via from public.seat_ledger where tm_id = $1 and kind = 'taken'", [leftTm]))).toMatchObject({ via: "autopilot" });
  });

  it("closes the switch and the office's calls, and puts the heartbeat step and the morning numbers back as they were", async () => {
    await expect(c.as(c.admin, "autopilot_overview")).rejects.toThrow(/does not exist/);
    await expect(c.as(c.admin, "autopilot_approve", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/does not exist/);
    expect((await c.sql("select 1 from public.feature_registry where key = 'seat_autopilot'")).length).toBe(0);
    const tick = (await c.one("select pg_get_functiondef('public.worker_seat_window_tick(text)'::regprocedure) as d")).d as string;
    expect(tick).not.toMatch(/autopilot/);
    expect(tick).toMatch(/seat_notes_tick/);
    const nums = (await c.one("select pg_get_functiondef('public.seat_morning_numbers()'::regprocedure) as d")).d as string;
    expect(nums).not.toMatch(/auto_placed|autopilot/);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTables = await tables(c.db.admin);
    const firstColumns = await columns(c.db.admin);
    const firstConstraints = await constraints(c.db.admin);
    const firstRegistry = await registry(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await tables(c.db.admin)).toEqual(firstTables);
    expect(await columns(c.db.admin)).toEqual(firstColumns);
    expect(await constraints(c.db.admin)).toEqual(firstConstraints);
    expect(await registry(c.db.admin)).toEqual(firstRegistry);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("can be applied again over the way back", async () => {
    await c.db.admin.query(migrationText());
    const now = await functions(c.db.admin);
    expect(now.has("autopilot_tick()")).toBe(true);
    expect((await registry(c.db.admin)).some((r) => r.key === "seat_autopilot")).toBe(true);
  });
});
