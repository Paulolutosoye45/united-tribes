import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createTestDb, type TestDb } from "./helpers";

// The repair for files applied out of order (supabase/repair/), rehearsed on the state Mary's database was found in:
// Package 6b to the seat window (20270114000100 to 20270120000100) undone, the seat release, autopilot, guide release, HOD reconcile and sign-in prompt still applied.
// The undo file, run once and then again, must leave exactly the database as it stood before 20270114000100; applying the files again in order must leave exactly
// the complete database. The count file must find nothing to lose on a fresh install and must stop the person when a table holds a row of real data.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const FIRST = "20270114000100";
const stamp = (f: string) => f.slice(0, 14);
const UPS = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && stamp(f) >= FIRST).sort();
const DOWNS_NEWEST_FIRST = fs.readdirSync(ROLLBACK).filter((f) => f.endsWith(".down.sql") && stamp(f) >= FIRST).sort().reverse();
const COUNT = fs.readFileSync(path.join(ROOT, "supabase/repair/1-count-before-undo.sql"), "utf8");
const UNDO = fs.readFileSync(path.join(ROOT, "supabase/repair/2-undo-from-20270126-to-20270114.sql"), "utf8");

let db: TestDb;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const fingerprint = async (c: Client) => {
  const q = async (text: string) => (await c.query(text)).rows.map((r) => Object.values(r).join("|"));
  return {
    functions: await q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || ' ' || md5(pg_get_functiondef(p.oid))
                          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') order by 1`),
    tables: await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
    columns: await q(`select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
                        from information_schema.columns where table_schema = 'public' order by 1`),
    constraints: await q(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace order by 1`),
    indexes: await q(`select indexname || ' ' || indexdef from pg_indexes where schemaname = 'public' order by 1`),
    triggers: await q(`select c.relname || '.' || g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid
                         where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`),
    registry: await q(`select key || '|' || name || '|' || stage || '|' || depends::text || '|' || default_mode || '|' || sort from public.feature_registry order by sort, key`),
  };
};

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `rbase_${Date.now().toString(36)}`;
  rootClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await rootClient.connect();
  await rootClient.query(`create database ${baselineName} template ut_before_tribes`);
  baseline = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: baselineName });
  await baseline.connect();
  // The database as it stood before FIRST: every file after the tribes rename, up to the one before it
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f >= "20261210000100" && stamp(f) < FIRST).sort();
  for (const f of files) await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  db = await createTestDb();
}, 240_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await db?.close();
});

describe("the repair for files applied out of order", () => {
  let complete: Awaited<ReturnType<typeof fingerprint>>;

  it("the count file finds nothing to lose on a fresh install, and stops the person when a table holds real data", async () => {
    complete = await fingerprint(db.admin);
    const fresh = (await db.admin.query(COUNT)).rows;
    expect(fresh.length).toBeGreaterThanOrEqual(33);
    expect(fresh.filter((r) => r.verdict !== "nothing to lose")).toEqual([]);
    // A row of real data in a table the undo drops
    const person = await db.createUser();
    await db.admin.query("insert into public.prompt_visits (person_id, session_key) values ($1, 'x')", [person.id]);
    const flagged = (await db.admin.query(COUNT)).rows.filter((r) => r.verdict === "HAS DATA - STOP").map((r) => r.table);
    expect(flagged).toEqual(["prompt_visits"]);
    await db.admin.query("delete from public.prompt_visits");
  });

  it("the count file reads nothing when the tables are not there", async () => {
    expect((await baseline.query(COUNT)).rows).toEqual([]);
  });

  it("the seat release file refuses to run without the seat window, and says which file to apply first", async () => {
    await expect(baseline.query(fs.readFileSync(path.join(MIGRATIONS, "20270121000100_seat_release.sql"), "utf8"))).rejects.toThrow(/Apply Package 6 \(20270120000100_seat_window\.sql\) before this file/);
    expect((await baseline.query("select 1 from public.feature_registry where key = 'reach_release'")).rowCount).toBe(0);
  });

  it("puts a database in Mary's state, undoes it, and gets back exactly the database from before 20270114000100 (twice over)", async () => {
    // Her state: 20270114000100 to 20270120000100 undone newest first (and 20270125000100 never applied, so its way back goes first here), the later files still applied
    await db.admin.query(fs.readFileSync(path.join(ROLLBACK, "20270125000100_desk_extras.down.sql"), "utf8"));
    for (const f of DOWNS_NEWEST_FIRST.filter((x) => stamp(x) <= "20270120000100")) await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
    // …and the stray function the seat window's way back leaves when it runs after the one for 6b
    await db.admin.query(fs.readFileSync(path.join(ROLLBACK, "20270120000100_seat_window.down.sql"), "utf8"));
    const broken = await fingerprint(db.admin);
    expect(broken.functions).not.toEqual(complete.functions);
    await db.admin.query(UNDO);
    await db.admin.query(UNDO); // changes nothing the second time
    const back = await fingerprint(db.admin);
    const base = await fingerprint(baseline);
    for (const k of Object.keys(base) as (keyof typeof base)[]) expect(back[k], k).toEqual(base[k]);
  });

  it("applies every file from 20270114000100 again in order, with no error, and gets the complete database", async () => {
    for (const f of UPS) await db.admin.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
    const again = await fingerprint(db.admin);
    for (const k of Object.keys(complete) as (keyof typeof complete)[]) expect(again[k], k).toEqual(complete[k]);
  });
});
