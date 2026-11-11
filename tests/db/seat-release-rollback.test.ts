import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Package 7" (the end of the series lets the seat go, the leader's 5 pm note, the office's 7 am email, "I need to leave this tribe"), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270120000100, the seat window) and the one with everything applied. The migration
// replaces three functions (reach_step, seat_ledger_write and worker_seat_window_tick), adds 7, two triggers and one line on the Switchboard, and no table or column.
// The rollback file must put the three functions back exactly as they were, drop everything that was added, keep every seat, member, tribe, message, notice, consent
// and log line (a seat a member left stays released), change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270120000100";
const THIS = "20270121000100_seat_release";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270121000100")
  .sort()
  .reverse();
const REPLACED = ["reach_step", "seat_ledger_write", "worker_seat_window_tick"];
const TABLES: string[] = [];
const TRIGGERS = ["feature_settings.reach_release_gate_insert", "feature_settings.reach_release_gate_update"];

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
  baselineName = `srbase_${Date.now().toString(36)}`;
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

describe("the way back from Package 7", () => {
  let before: Record<string, number>;
  let leftTm: string;
  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("is what the migration did: three functions replaced, seven new, two triggers and one Switchboard line, no table and no column", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect(created.size).toBe(7);
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const baseTriggers = await triggers(baseline);
    expect((await triggers(c.db.admin)).filter((t) => !baseTriggers.includes(t)).sort()).toEqual([...TRIGGERS].sort());
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t))).toEqual(TABLES);
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    const baseRegistry = await registry(baseline);
    expect((await registry(c.db.admin)).filter((r) => !baseRegistry.some((b) => b.key === r.key)).map((r) => r.key)).toEqual(["reach_release"]);
  });

  it("starts with something to keep: a seat a member left, the ordinary seats and messages, and the owner's numbers", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.set("seat_window", "rehearsal", { reason: "Trying the series release rollback" });
    const t = await c.k.tribe(c.season, { name: "Keep this tribe", capacity: 12, slot: "weeknight-evening" });
    const a = await c.k.seat(t.tribe, c.season, "KeepLeft");
    await c.k.seat(t.tribe, c.season, "KeepStay");
    expect(await c.as(a.id, "my_tribe_leave", "time")).toMatchObject({ ok: true });
    leftTm = (await c.one("select id from public.tribe_members where person_id = $1", [a.id])).id as string;
    expect((await c.one("select status from public.tribe_members where id = $1", [leftTm])).status).toBe("released");
    await c.o.call("god_seat_settings_set", 72, 24, 60, 5, 2, 20, 75, null, "Keeping these for the way back");
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
    expect(code).not.toMatch(/\bdrop\s+(schema|type|table|column)\b/i);
    expect(code).not.toMatch(/\binsert\b/i);
    expect(code).not.toMatch(/\bupdate\b/i);
    expect(text).toMatch(/delete from public\.feature_settings where feature = 'reach_release'/);
    expect(text).toMatch(/delete from public\.feature_registry where key = 'reach_release'/);
    // (reach_step sits inside a guard that puts it back only while the series' tables exist, so the functions put back are read from the text, not from `code`)
    const uncommented = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect([...uncommented.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    expect(uncommented).toMatch(/to_regclass\('public\.reach_enrolments'\)/);
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

  it("keeps every seat, the seat a member left, and every message and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect((await c.one("select status, release_reason from public.tribe_members where id = $1", [leftTm]))).toMatchObject({ status: "released", release_reason: "Left by the member" });
    expect((await c.one("select kind from public.seat_ledger where tm_id = $1 and kind = 'left'", [leftTm]))).toMatchObject({ kind: "left" });
  });

  it("closes the switch and the member's way out, and puts the seat window's own functions back as they were", async () => {
    await expect(c.as(c.admin, "my_tribe_leave", null)).rejects.toThrow(/does not exist/);
    await expect(c.as(c.admin, "my_tribe_leave_state")).rejects.toThrow(/does not exist/);
    expect((await c.sql("select 1 from public.feature_registry where key = 'reach_release'")).length).toBe(0);
    const def = (await c.one("select pg_get_functiondef('public.reach_step(uuid, boolean, text, uuid)'::regprocedure) as d")).d as string;
    expect(def).not.toMatch(/reach_release_seat/);
    const tick = (await c.one("select pg_get_functiondef('public.worker_seat_window_tick(text)'::regprocedure) as d")).d as string;
    expect(tick).not.toMatch(/seat_notes_tick|seat_morning_tick/);
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
    expect(now.has("seat_notes_tick()")).toBe(true);
    expect((await registry(c.db.admin)).some((r) => r.key === "reach_release")).toBe(true);
  });
});
