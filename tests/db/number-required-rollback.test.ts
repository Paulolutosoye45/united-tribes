import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "WhatsApp that cannot fail quietly", stage 3 (the WhatsApp number is compulsory), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270103000200, which is stage 2) and the one with everything applied.
// The migration replaced exactly one function that already existed, save_contact. The rollback file must put it back as it was, drop everything else it
// added, take the one function off the Switchboard, keep every phone number, consent and message and the log of who moved a switch, change nothing the
// second time, and leave stages 1 and 2 doing what they did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270103000200";
const THIS = "20270103000300_number_required";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270103000300")
  .sort()
  .reverse();
const TABLES = ["number_prompts"];
const GOOD = "Trying the number rule with everyone";

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
const tableExists = async (name: string) => (await c.one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `wa3base_${Date.now().toString(36)}`;
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

describe("the way back from 'WhatsApp that cannot fail quietly', stage 3", () => {
  let before: Record<string, number>;

  it("is what the migration added: save_contact is the only function replaced, and the rest are new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig))).toEqual(["save_contact"]);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: the rule On, a number saved under it, a prompt put away, the log of who moved a switch", async () => {
    await c.reset();
    await c.set("number_required", "on", { reason: GOOD });
    const m = await c.k.person("Keeper");
    await c.k.profile(m.id, c.season);
    await c.as(m.id, "save_contact", "+2348031999004", "whatsapp", true, false, true, "contact-v1");
    const q = await c.k.person("Quiet");
    await c.k.profile(q.id, c.season);
    await c.as(q.id, "number_prompt_dismiss");
    await expect(c.as(q.id, "save_contact", null, "email", false, false, true, "contact-v1")).rejects.toThrow(/Add your WhatsApp number/);
    before = {
      numbers: (await c.one("select count(*)::int n from public.contact_preferences where phone is not null")).n,
      prompts: await count("number_prompts"),
      messages: await count("messages"),
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      consents: await count("consents"),
    };
    expect(before.numbers).toBe(1);
    expect(before.prompts).toBe(1);
    expect(before.feature_log).toBeGreaterThan(0);
    expect(before.feature_registry).toBe(24);
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
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1])).toEqual(["save_contact"]);
    // Outside the text of the one restored function (between its $$ marks), the file writes nothing but the Switchboard's rows
    const outside = code.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outside).not.toMatch(/\b(truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect([...code.matchAll(/\bdelete\s+from\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_settings"]);
    const created = [...migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(created.sort());
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged (save_contact as it was)", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("drops the table and takes the function off the Switchboard, leaving stages 1 and 2", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(false);
    expect(await count("feature_registry")).toBe(23);
    expect((await c.sql("select key from public.feature_registry where stage > 6 order by key")).map((r) => r.key)).toEqual(["whatsapp_guard", "whatsapp_health"]);
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'number_required'")).n).toBe(0);
  });

  it("keeps every phone number, every consent, every message, and the log of who moved a switch", async () => {
    expect((await c.one("select count(*)::int n from public.contact_preferences where phone is not null")).n).toBe(before.numbers);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect(await count("consents")).toBe(before.consents);
  });

  it("stops every new door", async () => {
    const who = (await c.k.person("After")).id;
    for (const [fn, args] of [
      ["my_number_rule", []],
      ["number_prompt_dismiss", []],
      ["tribe_number_gaps", [c.seasoned.tribe]],
    ] as const) await expect(c.as(who, fn, ...args)).rejects.toThrow(/does not exist/);
  });

  it("lets a member save contact details with no number again, exactly as before", async () => {
    const m = await c.k.person("Free");
    await c.k.profile(m.id, c.season);
    await c.as(m.id, "save_contact", null, "email", false, false, true, "contact-v1");
    expect((await c.one("select phone from public.contact_preferences where person_id = $1", [m.id])).phone).toBeNull();
    await expect(c.as(m.id, "save_contact", "08031234567", "email", false, false, true, "contact-v1")).rejects.toThrow(/country code/);
    await expect(c.as(m.id, "save_contact", null, "whatsapp", true, false, true, "contact-v1")).rejects.toThrow(/Add a phone number/);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("feature_registry")).toBe(23);
  });
});
