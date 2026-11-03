import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "count only members who said yes, and keep the WhatsApp group closed until they do", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270106000100) and the one with everything applied. The migration
// may replace the fifteen functions it names and must not have changed any other function that already existed. The rollback file must put those
// fifteen back exactly as they were, drop the three it added, keep every seat, number, consent, message and tick, change nothing the second time,
// and announce as it did before. It adds no table and no Switchboard function: the three columns it added stay where they are.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270106000100";
const THIS = "20270107000100_said_yes";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270107000100")
  .sort()
  .reverse();
const REPLACED = [
  "kpi_members", "retention_curve", "church_views", "insight_data", "dashboard_core", "tribe_progress", "placement_contact", "placement_group_open",
  "placement_member_params", "placement_filter_members", "placement_run_view", "placement_open_now", "placement_open_all", "placement_state", "contact_gap_cause_of",
];
const ADDED = ["seat_said_yes", "tribe_group_list", "tribe_group_mark"];

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
  baselineName = `syrbase_${Date.now().toString(36)}`;
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

describe("the way back from 'said yes'", () => {
  let before: Record<string, number>;
  let ticked: string;

  it("is what the migration added: only the fifteen functions it names were replaced, the rest are new", async () => {
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
  });

  it("starts with something to keep: a tick on a member who chose the seat, a person who left, a message, a consent", async () => {
    await c.reset();
    ticked = c.seasoned.members[0];
    await c.as(c.seasoned.id, "tribe_group_mark", c.seasoned.tribe, ticked, "admitted", true);
    expect((await c.one("select count(*)::int n from public.tribe_members where group_admitted_at is not null")).n).toBe(1);
    before = {
      tribe_members: await count("tribe_members"),
      messages: await count("messages"),
      consents: await count("consents"),
      event_log: await count("event_log"),
      ticks: (await c.one("select count(*)::int n from public.tribe_members where group_admitted_at is not null")).n as number,
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
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$function\$[\s\S]*?\$function\$\s*;?/gi) ?? [];
    expect(bodies).toHaveLength(REPLACED.length);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    expect(own).not.toMatch(/\b(truncate|insert|update|delete)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|table|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual([...ADDED].sort());
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

  it("keeps every seat, message, consent and log line, and the tick the leader made", async () => {
    expect(await count("tribe_members")).toBe(before.tribe_members);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.tribe_members where group_admitted_at is not null")).n).toBe(before.ticks);
    expect((await c.one("select count(*)::int n from public.event_log where action = 'group.admitted'")).n).toBe(1);
  });

  it("stops the two new doors, and the dashboards count as they did before", async () => {
    await expect(c.as(c.seasoned.id, "tribe_group_list", c.seasoned.tribe)).rejects.toThrow(/does not exist/);
    await expect(c.as(c.seasoned.id, "tribe_group_mark", c.seasoned.tribe, ticked, "admitted", true)).rejects.toThrow(/does not exist/);
    const d = await c.as(c.director, "dashboard", c.season);
    expect(d.headline).not.toHaveProperty("waiting");
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("tribe_members")).toBe(before.tribe_members);
    expect(await count("messages")).toBe(before.messages);
  });
});
