import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Package 6, the seat window" (the 48-hour clock), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270119000100, which includes Phase 2b-2 of the Leader Desk) and the one with everything
// applied. The migration replaces one function (placed_seq_block), adds 48, five tables, nine triggers and one line on the Switchboard. The rollback file must put the one
// function back exactly as it was, drop everything that was added, keep every seat, member, tribe, message, notice, consent and log line (a seat the clock released stays
// released), change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270119000100";
const THIS = "20270120000100_seat_window";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270120000100")
  .sort()
  .reverse();
const REPLACED = ["placed_seq_block"];
const TABLES = ["seat_chain", "seat_clock_log", "seat_clocks", "seat_ledger", "seat_window_settings"];
const TRIGGERS = [
  "feature_settings.seat_window_gate_insert",
  "feature_settings.seat_window_gate_update",
  "seat_ledger.seat_ledger_no_update",
  "tribe_members.seat_clock_on_answer",
  "tribe_members.seat_ledger_write",
  "tribe_members.tribe_members_cap_guard_insert",
  "tribe_members.tribe_members_cap_guard_update",
];

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
  baselineName = `swbase_${Date.now().toString(36)}`;
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

describe("the way back from the seat window", () => {
  let before: Record<string, number>;
  let releasedTm: string;

  it("is what the migration did: one function replaced, the other 48 new, the tables and triggers added, one Switchboard line", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect(created.size).toBe(48);
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const baseTriggers = await triggers(baseline);
    expect((await triggers(c.db.admin)).filter((t) => !baseTriggers.includes(t)).sort()).toEqual([...TRIGGERS].sort());
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t))).toEqual(TABLES);
    // no column on an older table
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    const baseRegistry = await registry(baseline);
    expect((await registry(c.db.admin)).filter((r) => !baseRegistry.some((b) => b.key === r.key)).map((r) => r.key)).toEqual(["seat_window"]);
  });

  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("starts with something to keep: a seat the clock released, a seat that said yes, clocks, the owner's numbers, and the ordinary seats and messages", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    const t = await c.k.tribe(c.season, { name: "Keep this tribe", capacity: 12, slot: "weeknight-evening" });
    const a = await c.k.seat(t.tribe, c.season, "KeepReleased", { profile: false });
    const b = await c.k.seat(t.tribe, c.season, "KeepYes", { profile: false });
    await c.db.admin.query("begin");
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where person_id = any ($1)", [[a.id, b.id]]);
    await c.db.admin.query("commit");
    for (const who of [a, b]) {
      const tm = (await c.one("select id from public.tribe_members where person_id = $1", [who.id])).id as string;
      await c.db.admin.query("insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', '{}', 'sent', $2, now(), now() - interval '30 hours')", [who.id, `placement:${tm}`]);
    }
    await c.db.admin.query("update public.seat_window_settings set counted_from = now() - interval '30 days', last_tick_at = now()");
    await c.set("seat_window", "on", { reason: "Trying one release before the way back" });
    await c.db.admin.query("select public.seat_clock_tick()");
    expect((await c.one("select count(*)::int n from public.seat_clocks")).n).toBe(2);
    await c.db.admin.query("update public.tribe_members set confirmed_at = now() where person_id = $1", [b.id]);
    // the first seat is let go now: the office does it, with a reason
    const clock = (await c.one("select c.id from public.seat_clocks c join public.tribe_members m on m.id = c.tm_id where m.person_id = $1", [a.id])).id as string;
    await c.db.admin.query("update public.seat_clocks set state = 'running', deadline_at = now() - interval '1 hour', remind_sent_at = now() - interval '24 hours', last_call_sent_at = now() - interval '7 hours' where id = $1", [clock]);
    await c.db.admin.query("update public.messages set status = 'sent' where template like 'seat_%'");
    await c.db.admin.query("create or replace function public.seat_in_window() returns boolean language sql stable set search_path = '' as $$ select true $$");
    await c.db.admin.query("select public.seat_clock_tick()");
    releasedTm = (await c.one("select id from public.tribe_members where person_id = $1", [a.id])).id as string;
    expect((await c.one("select status from public.tribe_members where id = $1", [releasedTm])).status).toBe("released");
    await c.o.call("god_seat_settings_set", 72, 24, 60, 5, 2, 20, 75, null, "Keeping these for the way back");
    await c.set("seat_window", "off", { reason: "Switching the seat window off before the way back" });
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      consents: await count("consents"),
      people: await count("people"),
      event_log: await count("event_log"),
      placement_runs: await count("placement_runs"),
      placement_items: await count("placement_items"),
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
    expect(code).not.toMatch(/\bdrop\s+(schema|type)\b/i);
    expect(code).not.toMatch(/\binsert\b/i);
    expect(code).not.toMatch(/\bupdate\b/i);
    // the only rows it removes are the switch's own
    expect(text).toMatch(/delete from public\.feature_settings where feature = 'seat_window'/);
    expect(text).toMatch(/delete from public\.feature_registry where key = 'seat_window'/);
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+([^;]+);/gi)].flatMap((m) => m[1].split(",").map((x) => x.trim().replace("public.", ""))).sort()).toEqual([...TABLES].sort());
    expect([...code.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
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

  it("keeps every seat, the seat the clock released, the one who said yes, and every message and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect((await c.one("select status, release_reason from public.tribe_members where id = $1", [releasedTm]))).toMatchObject({ status: "released", release_reason: "No reply in time" });
    expect((await c.one("select count(*)::int n from public.tribe_members where confirmed_at is not null and placement_source = 'auto'")).n).toBeGreaterThanOrEqual(1);
  });

  it("closes the switch and every screen function, and leaves the answer sequence's own rules as 6b had them", async () => {
    await expect(c.as(c.admin, "seat_board", null, 50, 0)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("god_seat_settings")).rejects.toThrow(/does not exist/);
    await expect(c.anon("worker_seat_info", "x", "y")).rejects.toThrow(/does not exist/);
    expect((await c.sql("select 1 from public.feature_registry where key = 'seat_window'")).length).toBe(0);
    // a 13th member is no longer refused by the table (the placement engine's own check is untouched)
    const def = (await c.one("select pg_get_functiondef('public.placed_seq_block(uuid, uuid)'::regprocedure) as d")).d as string;
    expect(def).not.toMatch(/seat_clock_block|seat_never/);
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
    expect(now.has("seat_clock_tick()")).toBe(true);
    expect((await registry(c.db.admin)).some((r) => r.key === "seat_window")).toBe(true);
    expect((await c.one("select count(*)::int n from public.seat_window_settings")).n).toBe(1);
  });
});
