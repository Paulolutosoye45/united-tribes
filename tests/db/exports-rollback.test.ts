import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { Row, TestDb } from "./helpers";

// The way back from "Exports and Reports", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20261230000100) and the one with everything applied. The new
// migration must not have changed any function that already existed, the platform's own clean-up included. The rollback file must leave
// exactly the baseline's functions and triggers, keep the eight tables it added with every row in them (as the way back from the earlier
// features does), change nothing the second time, and leave the platform doing what it did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20261230000100";
const THIS = "20261231000100_exports";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20261231000100")
  .sort()
  .reverse();
const TABLES = ["export_packs", "export_settings", "export_switches", "export_switch_log", "export_testers", "export_log", "export_links", "export_feed_links"];
const json = (v: unknown) => JSON.stringify(v);

let k: Kit;
let o: OwnerKit;
let db: TestDb;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const functions = async (c: Client) =>
  new Map(
    (
      await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)
    ).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (c: Client) =>
  (
    await c.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                    where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)
  ).rows.map((r) => r.t as string);
const tableExists = async (name: string) => (await one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await tableExists(t)) ? (await one(`select count(*)::int n from public.${t}`)).n : -1;
  return out;
};

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `exbase_${Date.now().toString(36)}`;
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
  ({ db, k } = await newKit());
  for (const f of LATER_DOWN) await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
  o = await makeOwner(db);
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await db?.close();
});

describe("the way back from 'Exports and Reports'", () => {
  let rowsBefore: Record<string, number>;
  let director: string;

  it("is what the migration added and nothing else: no function that existed before was changed, the clean-up included", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    const created = new Set<string>();
    for (const m of fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map((sig) => sig.split("(")[0]);
    expect(extra.length).toBe(created.size);
    expect(extra.filter((name) => !created.has(name))).toEqual([]);
    expect(await triggers(db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: a pack moved, a file made, a feed link, a tester, a switch log", async () => {
    director = (await k.staff("Director", "director")).id;
    const tester = (await k.staff("Tester", "admin")).id;
    await o.call("export_settings_save", json({ formats: ["xlsx", "csv"], deliveries: ["download"], doors: ["standing_link"] }), null);
    await o.call("export_pack_set", "tribes_health", "on", "{}", "Trying it with the director");
    await o.call("export_pack_set", "insight_feeds", "on", "{}", "Trying the feeds with the director");
    await o.call("export_tester_set", tester, true);
    const made = await k.call(director, "export_prepare", ["tribes_health", "xlsx", null, "{}"]);
    expect(made.token).toBeTruthy();
    await k.call(director, "export_feed_create", ["tribes", "For the dashboard"]);
    rowsBefore = await counts();
    expect(rowsBefore.export_packs).toBe(14);
    expect(rowsBefore.export_log).toBe(1);
    expect(rowsBefore.export_feed_links).toBe(1);
    expect(rowsBefore.export_testers).toBe(1);
    expect(rowsBefore.export_links).toBe(1);
    expect(rowsBefore.export_switch_log).toBeGreaterThanOrEqual(2);
  });

  it("runs the rollback file without error: it drops functions only, and writes nothing", async () => {
    const text = fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\b(delete|truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(column|schema|type|table)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bcreate\b/i);
    // the way to take the tables out too is written in the file for a person to run, not run for them
    for (const t of TABLES) expect(text, t).toContain(`public.${t}`);
    await db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps the eight tables and every row in them: no log line, switch change or link is lost", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("stops every door: no link opens, no file is made, no feed is read, no switch moves", async () => {
    for (const fn of ["export_options()", "export_prepare('tribes_health','xlsx',null,'{}')", "export_feed_list()", "my_exports()"]) {
      await expect(db.asUser(director, (q) => q(`select public.${fn}`)), fn).rejects.toThrow(/does not exist/);
    }
    await expect(db.asAnon((q) => q("select public.export_feed_read('x', 'tribes')"))).rejects.toThrow(/does not exist/);
    await expect(o.call("export_pack_set", "tribes_health", "off", "{}", null)).rejects.toThrow(/does not exist/);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(db.admin);
    const firstTriggers = await triggers(db.admin);
    await db.admin.query(fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8"));
    const again = await functions(db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(db.admin)).toEqual(firstTriggers);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("leaves the platform doing what it did: the daily clean-up still runs, and a member can still be placed and counted", async () => {
    await db.admin.query("delete from public.calendar_runs where key like 'retention:%'");
    const out = (await db.admin.query("select public.retention_tick(now()) as r")).rows[0].r;
    expect(out.retention_ran).toBe(true);
    expect(Object.keys(out).sort()).toEqual(["bare_messages_removed", "drafts_removed", "guardians_removed", "message_wording_cleared", "retention_ran", "stories_cleared"]);
    expect((await sql("select public.retention_periods() as p"))[0].p).toEqual({ guardian_days: 90, draft_days: 30, message_days: 90 });
    const season = await k.season("After the way back", 30);
    const t = await k.tribe(season, { name: "Still works" });
    const seat = await k.seat(t.tribe, season, "Joiner");
    expect((await one("select count(*)::int n from public.tribe_members where tribe_id = $1 and person_id = $2", [t.tribe, seat.id])).n).toBe(1);
  });
});
