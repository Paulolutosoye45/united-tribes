import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "WhatsApp mode" (Full, Saver and Free, the cost page, WhatsApp sent by people), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270104000100) and the one with everything applied. The migration may
// replace the five functions it names and must not have changed any other function that already existed. The rollback file must put those five back
// exactly as they were, drop everything it added, take the one function off the Switchboard, keep every message, consent and the log of who moved a
// switch, change nothing the second time, and send WhatsApp the way it did before.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270104000100";
const THIS = "20270105000100_whatsapp_mode";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270105000100")
  .sort()
  .reverse();
const REPLACED = ["message_channels", "worker_claim", "worker_whatsapp_signal", "whatsapp_check_save", "whatsapp_test_send"];
const TABLES = ["whatsapp_mode", "whatsapp_mode_log", "whatsapp_message_class", "whatsapp_rates", "whatsapp_marketing", "whatsapp_hand_log"];
const GOOD = "Trying WhatsApp mode with everyone";

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
const registryBase = async () => Number((await baseline.query("select count(*)::int n from public.feature_registry")).rows[0].n);
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
  token = (await c.one("select public.bootstrap_worker_token('test-whatsapp-mode-rollback') as t")).t;
  for (const f of LATER_DOWN) await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await c?.db.close();
});

describe("the way back from 'WhatsApp mode'", () => {
  let before: Record<string, number>;
  let held: string;
  let eze: string;

  it("is what the migration added: only the five functions it names were replaced, the rest are new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: the function On and in Free, rates, a class change, a Marketing line, hand-sent lines, messages in every state", async () => {
    await c.reset();
    await c.sql("delete from public.messages");
    await c.set("whatsapp_guard", "on", { reason: GOOD });
    await c.set("whatsapp_mode", "on", { reason: GOOD });
    await c.as(c.admin, "whatsapp_mode_set", "free", "Nothing may go through Meta this month");
    await c.as(c.director, "whatsapp_rate_add", "utility", 0.02, "2026-11-02", "Rate card");
    await c.as(c.director, "whatsapp_class_set", "friday_checkin", "A");
    await c.sql("insert into public.whatsapp_marketing (template_key) values ('week_start')");
    eze = (await c.k.person("Eze")).id;
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031999002', 'whatsapp') on conflict (person_id) do update set phone = '+2348031999002'", [eze]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [eze]);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'email', false, 'test')", [eze]);
    held = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'held-by-free', null, 'urgent') as id", [eze])).id as string;
    await c.sql("select public.worker_claim($1, 25)", [token]);
    expect((await c.one("select error from public.messages where id = $1", [held])).error).toMatch(/Free mode/);
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [c.seasoned.members[0]]);
    await c.sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031999003', 'whatsapp') on conflict (person_id) do update set phone = '+2348031999003'", [c.seasoned.members[0]]);
    await c.as(c.seasoned.id, "hand_open", c.seasoned.members[0], c.seasoned.tribe, "welcome");
    expect(await count("whatsapp_mode_log")).toBeGreaterThan(0);
    expect(await count("whatsapp_hand_log")).toBe(1);
    before = {
      messages: await count("messages"),
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      consents: await count("consents"),
      contact_preferences: await count("contact_preferences"),
    };
    expect(before.feature_log).toBeGreaterThan(0);
    expect(before.feature_registry).toBe((await registryBase()) + 1);
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
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$function\$[\s\S]*?\$function\$;?/gi) ?? [];
    expect(bodies).toHaveLength(REPLACED.length);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    expect(own).not.toMatch(/\b(truncate|insert)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type)\b/i);
    expect([...own.matchAll(/\bdelete\s+from\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_settings"]);
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
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

  it("drops the six tables and the index, and puts the Switchboard back to the functions it had", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(false);
    expect((await c.one("select to_regclass('public.messages_whatsapp_claim_idx') is not null as e")).e).toBe(false);
    expect(await count("feature_registry")).toBe(await registryBase());
    expect((await c.one("select count(*)::int n from public.feature_registry where key = 'whatsapp_mode'")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'whatsapp_mode'")).n).toBe(0);
    const board = await c.o.call("god_feature_board");
    expect(board.features).toHaveLength(await registryBase());
  });

  it("keeps every message, every consent, and the log of who moved a switch", async () => {
    expect(await count("messages")).toBe(before.messages);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect(await count("consents")).toBe(before.consents);
    expect(await count("contact_preferences")).toBe(before.contact_preferences);
  });

  it("sends WhatsApp as it did before: the member's WhatsApp first, whatever the mode was, and a test message goes to Meta again", async () => {
    const id = (await c.one("select public.enqueue_message($1, 'week_start', '{}'::jsonb, null, 'after-rollback') as id", [eze])).id as string;
    expect(((await c.one("select public.message_channels($1) as ch", [id])).ch as string[])[0]).toBe("whatsapp");
    const swap = (await c.one("select public.enqueue_message($1, 'friday_checkin', '{}'::jsonb, null, 'after-rollback-2') as id", [eze])).id as string;
    expect(((await c.one("select public.message_channels($1) as ch", [swap])).ch as string[])[0]).toBe("whatsapp");
  });

  it("stops every new door", async () => {
    for (const [fn, args] of [
      ["whatsapp_mode_overview", []],
      ["whatsapp_cost_report", []],
      ["whatsapp_mode_set", ["saver", "Looking at the account"]],
      ["hand_staff_list", []],
    ] as const) await expect(c.as(c.director, fn, ...args)).rejects.toThrow(/does not exist/);
    await expect(c.sql("select public.worker_whatsapp_allowed($1)", [token])).rejects.toThrow(/does not exist/);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("feature_registry")).toBe(await registryBase());
    expect(await count("messages")).toBe(before.messages + 2);
  });
});
