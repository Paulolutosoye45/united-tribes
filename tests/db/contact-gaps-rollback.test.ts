import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Contact gaps" (find the members a leader cannot reach on WhatsApp, ask them, and let a member choose), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270105000100) and the one with everything applied. The migration may
// replace the four functions it names and must not have changed any other function that already existed. The rollback file must put those four back
// exactly as they were, drop everything it added, take the one function off the Switchboard, keep every message, consent and the log of who moved a
// switch, change nothing the second time, and announce as it did before.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270105000100";
const THIS = "20270106000100_contact_gaps";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270106000100")
  .sort()
  .reverse();
const REPLACED = ["audience_clean", "audience_base", "audience_members", "broadcasts_release"];
const TABLES = ["contact_asks", "reach_prompts", "contact_gap_days"];
const GOOD = "Trying contact gaps with everyone";

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
const registryBase = async () => Number((await baseline.query("select count(*)::int n from public.feature_registry")).rows[0].n);
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const tableExists = async (name: string) => (await c.one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `cgbase_${Date.now().toString(36)}`;
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

describe("the way back from 'Contact gaps'", () => {
  let before: Record<string, number>;
  let asked: string;

  it("is what the migration added: only the four functions it names were replaced, the rest are new", async () => {
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

  it("starts with something to keep: the function On, a person asked, a prompt put away, a daily count, a draft for the new audience, messages", async () => {
    await c.reset();
    await c.sql("delete from public.messages");
    await c.set("contact_gaps", "on", { reason: GOOD });
    asked = c.seasoned.members[0];
    await c.as(c.seasoned.id, "contact_ask_send", asked);
    await c.as(c.seasoned.members[1], "reach_prompt_dismiss");
    await c.as(c.admin, "contact_gaps_report");
    await c.as(c.director, "broadcast_save", null, JSON.stringify({
      title: "Add your number", audience: { kind: "cannot_reach", cause: "either" }, audience_label: "Cannot be reached on WhatsApp",
      subject: "Hello {first_name}", paragraphs: ["We would like your number."], button_label: null, button_target: null,
    }));
    expect(await count("contact_asks")).toBe(1);
    expect(await count("reach_prompts")).toBe(1);
    expect(await count("contact_gap_days")).toBe(1);
    before = {
      messages: await count("messages"),
      broadcasts: await count("broadcasts"),
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      consents: await count("consents"),
      contact_preferences: await count("contact_preferences"),
    };
    expect(before.messages).toBeGreaterThan(0);
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
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$\$[\s\S]*?\$\$;?/gi) ?? [];
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

  it("drops the three tables and puts the Switchboard back to the functions it had", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(false);
    expect(await count("feature_registry")).toBe(await registryBase());
    expect((await c.one("select count(*)::int n from public.feature_registry where key = 'contact_gaps'")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'contact_gaps'")).n).toBe(0);
    const board = await c.o.call("god_feature_board");
    expect(board.features).toHaveLength(await registryBase());
  });

  it("keeps every message, every consent, every announcement draft and the log of who moved a switch", async () => {
    expect(await count("messages")).toBe(before.messages);
    expect(await count("broadcasts")).toBe(before.broadcasts);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect(await count("consents")).toBe(before.consents);
    expect(await count("contact_preferences")).toBe(before.contact_preferences);
    expect((await c.one("select count(*)::int n from public.messages where template = 'contact_ask_leader' and person_id = $1", [asked])).n).toBe(1);
  });

  it("announces as it did before: the old audiences still count, and the new one is no longer offered", async () => {
    for (const kind of ["everyone", "started", "finished_no_tribe", "in_tribe", "leaders"]) {
      expect((await c.as(c.admin, "audience_preview", { kind })).spec).toEqual({ kind });
    }
    await expect(c.as(c.admin, "audience_preview", { kind: "cannot_reach" })).rejects.toThrow(/Choose who this is for/);
  });

  it("stops every new door", async () => {
    for (const [fn, args] of [
      ["contact_gaps_state", []],
      ["contact_gaps_report", []],
      ["contact_gaps_export", []],
      ["my_reach", []],
      ["reach_prompt_dismiss", []],
    ] as const) await expect(c.as(c.director, fn, ...args)).rejects.toThrow(/does not exist/);
    await expect(c.as(c.seasoned.id, "tribe_reach_gaps", c.seasoned.tribe)).rejects.toThrow(/does not exist/);
    await expect(c.as(c.seasoned.id, "contact_ask_send", asked)).rejects.toThrow(/does not exist/);
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
    expect(await count("messages")).toBe(before.messages);
  });
});
