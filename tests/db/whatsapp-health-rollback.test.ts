import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "WhatsApp that cannot fail quietly", stage 2 (the health page), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270103000100, which is stage 1) and the one with everything applied.
// The migration replaced no function that already existed. The rollback file must drop everything it added, take the one function off the
// Switchboard, keep every message and the log of who moved a switch, change nothing the second time, and leave the safety net doing what stage 1
// made it.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270103000100";
const THIS = "20270103000200_whatsapp_health";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270103000200")
  .sort()
  .reverse();
const TABLES = ["whatsapp_signals", "whatsapp_outcomes", "whatsapp_checks"];
const GOOD = "Trying the health page with everyone";

let c: Cast;
let baseline: Client;
let baselineName: string;
let rootClient: Client;
let token: string;

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
const tableExists = async (name: string) => (await c.one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `wa2base_${Date.now().toString(36)}`;
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
  token = (await c.one("select public.bootstrap_worker_token('test-whatsapp-health-rollback') as t")).t;
  for (const f of LATER_DOWN) await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await c?.db.close();
});

describe("the way back from 'WhatsApp that cannot fail quietly', stage 2", () => {
  let before: Record<string, number>;

  it("is what the migration added: no function that already existed was replaced, and the rest are new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig))).toEqual([]);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const had = new Set(await triggers(baseline));
    expect((await triggers(c.db.admin)).filter((t) => !had.has(t))).toEqual(["messages.messages_outcome_watch"]);
  });

  it("starts with something to keep: the page On, notices from Meta, causes counted, a saved check, a test message, the log of who moved a switch", async () => {
    await c.reset();
    await c.set("whatsapp_health", "on", { reason: GOOD });
    await c.sql("select public.worker_whatsapp_signal($1, 'template', 'ut_welcome', 'REJECTED', 'INVALID_FORMAT')", [token]);
    const eze = (await c.k.person("Eze")).id;
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031999002', 'whatsapp') on conflict (person_id) do update set phone = '+2348031999002'", [eze]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [eze]);
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'g1') as id", [eze])).id as string;
    await c.sql("update public.messages set status = 'sending', channel = 'whatsapp', attempts = 1, claimed_at = now() where id = $1", [id]);
    await c.sql("select public.worker_report($1, $2, 'rejected', null, 'meta 131026: (#131026) Message undeliverable')", [token, id]);
    await c.as(c.admin, "whatsapp_check_save", { ok: true });
    before = {
      signals: await count("whatsapp_signals"),
      outcomes: await count("whatsapp_outcomes"),
      messages: await count("messages"),
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      consents: await count("consents"),
    };
    expect(before.signals).toBe(1);
    expect(before.outcomes).toBe(1);
    expect(before.feature_log).toBeGreaterThan(0);
    expect(before.feature_registry).toBe(23);
  });

  it("runs the rollback file without error, and writes only to the Switchboard's two tables", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\bcreate\s+or\s+replace\b/i);
    expect(code).not.toMatch(/\b(truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect([...code.matchAll(/\bdelete\s+from\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_settings"]);
    const created = [...migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(created.sort());
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
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

  it("drops the three tables and takes the function off the Switchboard, leaving the safety net's", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(false);
    expect(await count("feature_registry")).toBe(22);
    expect((await c.sql("select key from public.feature_registry where stage > 6")).map((r) => r.key)).toEqual(["whatsapp_guard"]);
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'whatsapp_health'")).n).toBe(0);
    expect((await c.one("select public.feature_platform_state('whatsapp_guard') as s")).s).toBe("off");
  });

  it("keeps every message, every consent, and the log of who moved a switch", async () => {
    expect(await count("messages")).toBe(before.messages);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect(await count("consents")).toBe(before.consents);
  });

  it("stops every new door, and the sending service's new call", async () => {
    for (const [fn, args] of [
      ["whatsapp_health_overview", []],
      ["whatsapp_check_save", [{ ok: true }]],
      ["whatsapp_test_send", []],
    ] as const) await expect(c.as(c.admin, fn, ...args)).rejects.toThrow(/does not exist/);
    await expect(c.db.admin.query("select public.worker_whatsapp_signal($1, 'template', 'x', 'APPROVED', null)", [token])).rejects.toThrow(/does not exist/);
  });

  it("still gives up on a refused WhatsApp message and moves it to the next channel, as before", async () => {
    const who = (await c.k.person("Ola")).id;
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031999003', 'whatsapp') on conflict (person_id) do update set phone = '+2348031999003'", [who]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [who]);
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'g2') as id", [who])).id as string;
    await c.sql("update public.messages set status = 'sending', channel = 'whatsapp', attempts = 1, claimed_at = now() where id = $1", [id]);
    await c.sql("select public.worker_report($1, $2, 'rejected', null, 'meta 131026: (#131026) Message undeliverable')", [token, id]);
    expect(await c.one("select status, tried from public.messages where id = $1", [id])).toMatchObject({ status: "queued", tried: ["whatsapp"] });
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("feature_registry")).toBe(22);
  });
});
