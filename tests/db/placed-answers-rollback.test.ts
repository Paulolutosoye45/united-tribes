import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Package 6b" (the placed answer sequence, the board and the call desk), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270113000100, the placed nudge) and the one with everything applied. The migration
// replaces two functions (person_cap_ok, the weekly limit on emails to a person, and retry_message), adds 47, eight tables, one column and its check on tribes, a trigger
// on tribe_members, a Switchboard line and a wider list of where a placement hold can come from. The rollback file must put the two functions back exactly as they were,
// drop everything that was added, keep every seat, member, tribe, message and log line, keep a "not this season" member held out, change nothing the second time, and be
// applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270113000100";
const THIS = "20270114000100_placed_answers";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270114000100")
  .sort()
  .reverse();
const REPLACED = ["person_cap_ok", "retry_message"];
const TABLES = ["placed_answers", "placed_answers_settings", "placed_calls", "placed_downloads", "placed_holds", "placed_reveals", "placed_seq", "placed_seq_sends"];

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
                      from information_schema.columns where table_schema = 'public' and table_name in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings', 'messages', 'placement_holds')
                     order by table_name, ordinal_position`)
  ).rows.map((r) => r.c as string);
const constraints = async (cl: Client) =>
  (
    await cl.query(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings', 'placement_holds') order by 1`)
  ).rows.map((r) => r.c as string);
const indexes = async (cl: Client) =>
  (await cl.query("select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename in ('tribe_members', 'tribes', 'feature_registry', 'feature_settings', 'placement_holds') order by 1")).rows.map(
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

describe("the way back from Package 6b", () => {
  let before: Record<string, number>;
  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("is what the migration did: two functions replaced, 47 new, eight tables, one column, one trigger and one Switchboard line", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect(created.size).toBe(47);
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const trig = new Set(await triggers(baseline));
    expect((await triggers(c.db.admin)).filter((t) => !trig.has(t))).toEqual(["tribe_members.placed_seq_on_answer"]);
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t)).sort()).toEqual([...TABLES].sort());
    const col = new Set(await columns(baseline));
    expect((await columns(c.db.admin)).filter((x) => !col.has(x))).toEqual(["tribes.seat_line text YES "]);
    const reg = new Set((await registry(baseline)).map((r) => r.key));
    expect((await registry(c.db.admin)).filter((r) => !reg.has(r.key)).map((r) => r.key)).toEqual(["placed_answers"]);
  });

  it("starts with something to keep: a tribe, its members, the sequence On, a member held out for the season, and a sequence email waiting", async () => {
    await c.sql("update public.placed_answers_settings set paused = false");
    await c.sql("insert into public.placement_holds (person_id, note, until, source) values ($1, null, now() + interval '30 days', 'not_season')", [c.member]);
    await c.sql("insert into public.messages (person_id, template, status, to_email, params) values ($1, 'placed_seq', 'queued', 'keep@example.org', '{}'::jsonb)", [c.member]);
    await c.sql("update public.tribes set seat_line = 'Welcome, we meet on Sundays' where id = $1", [c.seasoned.tribe]);
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      notice_items: await count("notice_items"),
      people: await count("people"),
      event_log: await count("event_log"),
      placement_holds: await count("placement_holds"),
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
    // the one column it drops is the leader's one line to new members, which the migration added
    expect([...code.matchAll(/\bdrop\s+column\b[^;]*;/gi)].map((m) => m[0])).toEqual(["drop column if exists seat_line;"]);
    expect([...code.matchAll(/\bdrop\s+table\b[^;]*;/gi)].map((m) => m[0]).sort()).toEqual(TABLES.map((t) => `drop table if exists public.${t};`).sort());
    expect(code).not.toMatch(/\binsert\b/i);
    expect([...text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    expect([...code.matchAll(/\bdrop\s+function\b/gi)].length).toBe(47);
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

  it("keeps every tribe, member and log line, keeps the member who said not this season held out, and withdraws the sequence email that was waiting", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    const hold = await c.one("select source, (until > now()) as live from public.placement_holds where person_id = $1", [c.member]);
    expect(hold).toMatchObject({ source: "owner", live: true });
    const msg = await c.one("select status, reply_token from public.messages where person_id = $1 and template = 'placed_seq'", [c.member]);
    expect(msg.status).toBe("skipped");
    expect(msg.reply_token).toBeNull();
    await expect(c.as(c.admin, "placed_board_summary")).rejects.toThrow(/does not exist/);
    await expect(c.as(c.admin, "god_placed_answers_settings")).rejects.toThrow(/does not exist/);
    await expect(c.as(c.admin, "tribe_seat_line_get", c.seasoned.tribe)).rejects.toThrow(/does not exist/);
  });

  it("puts the weekly limit on emails back to counting only the emails it counted before", async () => {
    const def = (await c.one("select pg_get_functiondef('public.person_cap_ok(uuid, text)'::regprocedure) as d")).d as string;
    expect(def).not.toMatch(/placed_seq/);
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
    expect((await functions(c.db.admin)).has("placed_seq_tick()")).toBe(true);
    expect((await c.one("select count(*)::int n from public.placed_seq")).n).toBe(0);
    expect((await c.one("select source from public.placement_holds where person_id = $1", [c.member])).source).toBe("owner");
  });
});
