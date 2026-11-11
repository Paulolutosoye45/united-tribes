import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the sign-in prompt" (the screen on top of the page that asks a signed-in person for the answer they owe), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270125000100, the Desk's extras) and the one with everything applied. The migration
// replaces no function, adds 17, no trigger, four tables and one line on the Switchboard, and no column. The rollback file must drop what was added and nothing
// else, keep every answer a person gave on the screen (a "yes" to a placement is an ordinary placement with its seat, its email and its notice), keep every seat,
// member, tribe, message, notice, consent and log line, change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270125000100";
const THIS = "20270126000100_sign_in_prompt";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270126000100")
  .sort()
  .reverse();
const TABLES = ["prompt_log", "prompt_settings", "prompt_streaks", "prompt_visits"];
const SIGN_IN_FUNCTIONS = [
  "god_prompt_settings",
  "god_prompt_settings_set",
  "my_prompt_queue",
  "prompt_can_skip",
  "prompt_kinds",
  "prompt_log_set",
  "prompt_mask",
  "prompt_never",
  "prompt_overview",
  "prompt_placement_answer",
  "prompt_rostered",
  "prompt_rung",
  "prompt_save_number",
  "prompt_seat_deadline",
  "prompt_task",
  "prompt_tasks_owed",
  "prompt_whatsapp_answer",
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
const WATCHED = "('tribe_members', 'tribes', 'feature_registry', 'feature_settings', 'messages', 'contact_preferences', 'consents', 'seat_clocks')";
const columns = async (cl: Client) =>
  (
    await cl.query(`select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as c
                      from information_schema.columns where table_schema = 'public' and table_name in ${WATCHED}
                     order by table_name, ordinal_position`)
  ).rows.map((r) => r.c as string);
const constraints = async (cl: Client) =>
  (
    await cl.query(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text in ${WATCHED} order by 1`)
  ).rows.map((r) => r.c as string);
const indexes = async (cl: Client) =>
  (await cl.query(`select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename in ${WATCHED} order by 1`)).rows.map((r) => r.i as string);
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const registry = async (cl: Client) => (await cl.query("select key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only from public.feature_registry order by sort, key")).rows;
async function replica(text: string, params: unknown[] = []) {
  await c.db.admin.query("begin");
  try {
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query(text, params);
    await c.db.admin.query("commit");
  } catch (error) {
    await c.db.admin.query("rollback");
    throw error;
  }
}
const sid = (s: string) => `00000000-0000-4000-8000-${Buffer.from(s).toString("hex").padStart(12, "0").slice(-12)}`;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `sipbase_${Date.now().toString(36)}`;
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

describe("the way back from the sign-in prompt", () => {
  let before: Record<string, number>;
  let answered: string;
  let answeredTm: string;
  let baseTable: string[] = [];
  beforeAll(async () => {
    baseTable = await tables(baseline);
  });

  it("is what the migration did: nothing replaced, seventeen functions new, no trigger, four tables and one Switchboard line, and no column", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig))).toEqual([]);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect([...created].sort()).toEqual([...SIGN_IN_FUNCTIONS].sort());
    expect(migrationText()).not.toMatch(/create\s+or\s+replace\s+function/i);
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect((await tables(c.db.admin)).filter((t) => !new Set(baseTable).has(t)).sort()).toEqual([...TABLES].sort());
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    const baseRegistry = await registry(baseline);
    expect((await registry(c.db.admin)).filter((r) => !baseRegistry.some((b) => b.key === r.key)).map((r) => r.key)).toEqual(["sign_in_prompt"]);
  });

  it("starts with something to keep: a placement answered on the screen, an ordinary seat with its email, and the owner's settings", async () => {
    await c.reset();
    await c.set("sign_in_prompt", "on", { reason: "Trying the sign-in prompt rollback" });
    await c.o.call("god_prompt_settings_set", 6, 2, 8, 5, [], "Keeping these for the way back");
    const t = await c.k.tribe(c.season, { name: "Keep this tribe", capacity: 12 });
    for (let i = 0; i < 3; i++) await c.k.seat(t.tribe, c.season, `KeepM${i}`);
    const p = await c.k.seat(t.tribe, c.season, "KeepAnswered");
    await replica("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where person_id = $1", [p.id]);
    await c.db.admin.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031234567', 'email') on conflict (person_id) do update set phone = excluded.phone", [p.id]);
    const q = (await c.db.asUser!(p.id, (query) => query("select public.my_prompt_queue() as r"), { session: sid("keep") })).rows[0].r as { tasks: { kind: string }[] };
    expect(q.tasks.map((x) => x.kind)).toContain("placement");
    expect(await c.as(p.id, "placement_my_confirm", "v1")).toMatchObject({ ok: true });
    await c.db.asUser!(p.id, (query) => query("select public.prompt_log_set('placement', 'answered')"), { session: sid("keep") });
    answered = p.id;
    answeredTm = (await c.one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [p.id, t.tribe])).id as string;
    expect((await c.sql("select 1 from public.prompt_log where person_id = $1", [p.id])).length).toBeGreaterThan(0);
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      consents: await count("consents"),
      people: await count("people"),
      event_log: await count("event_log"),
      contact_preferences: await count("contact_preferences"),
    };
  });

  it("runs the rollback file without error, and touches only what the migration added", async () => {
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
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...SIGN_IN_FUNCTIONS].sort());
    expect(code).not.toMatch(/\binsert\b/i);
    expect(code).not.toMatch(/\bupdate\b/i);
    expect(code).not.toMatch(/create\s+or\s+replace/i);
    expect(text).toMatch(/delete from public\.feature_settings where feature = 'sign_in_prompt'/);
    expect(text).toMatch(/delete from public\.feature_registry where key = 'sign_in_prompt'/);
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

  it("keeps the answer given on the screen, every seat and every message and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect(await c.one("select status, confirmed_at is not null as confirmed from public.tribe_members where id = $1", [answeredTm])).toMatchObject({ status: "active", confirmed: true });
    expect((await c.one("select preferred from public.contact_preferences where person_id = $1", [answered])).preferred).toBe("email");
  });

  it("closes the switch and the site's calls", async () => {
    expect((await c.sql("select 1 from public.feature_registry where key = 'sign_in_prompt'")).length).toBe(0);
    await expect(c.as(answered, "my_prompt_queue")).rejects.toThrow(/does not exist/);
    await expect(c.as(answered, "prompt_whatsapp_answer", true)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("god_prompt_settings")).rejects.toThrow(/does not exist/);
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
    expect(now.has("my_prompt_queue()")).toBe(true);
    expect((await registry(c.db.admin)).some((r) => r.key === "sign_in_prompt")).toBe(true);
    expect(await count("prompt_log")).toBe(0);
  });
});
