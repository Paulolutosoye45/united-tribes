import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";

// The way back from the team's emails, rehearsed.
//
// Two databases: the one as it stood before the notice migrations (every file up to 20261224000100) and the one with everything applied.
// The notice migrations must not have changed any function that already existed. The two rollback files, run in the order the apply guide
// gives, must then leave exactly the baseline's functions and triggers, keep every row of every notice table, change nothing the second
// time, and leave the platform doing what it did (a role given, an application moved on, a message queued).

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE_NOTICES = "20261224000100";
/**
 * Run in this order: anything built after the notices first (the way back is newest first), then the notice triggers, then the engine.
 * The files built after are found by name, so a later feature's rollback is run here without this test having to know about it.
 */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20261225000200")
  .sort()
  .reverse();
const DOWN = [...LATER_DOWN, "20261225000200_notice_triggers.down.sql", "20261225000100_notices.down.sql"];
/**
 * Functions a later feature puts back to their old text in its own way back (found by name, like the files). That feature changed them on
 * purpose, so they differ from the baseline while it is applied; the third test below checks that each one is back to the baseline's text
 * once the way back has run. A function nobody's way back restores is still held to "unchanged".
 */
const RESTORED_BY_LATER = new Set(
  LATER_DOWN.flatMap((f) =>
    [...fs.readFileSync(path.join(ROLLBACK, f), "utf8").matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()),
  ),
);

/**
 * Tables a feature built after the notices created. Its own way back may drop them (it says in its first lines what that takes with it and how
 * to copy it first); a table the notices made, or one that was there before, is still held to "never dropped".
 */
const LATER_TABLES = new Set(
  fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > "20261225000200")
    .flatMap((f) => [...fs.readFileSync(path.join(MIGRATIONS, f), "utf8").matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gi)].map((m) => m[1].toLowerCase())),
);

let db: TestDb;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;

const functions = async (c: Client) =>
  new Map(
    (await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (c: Client) =>
  (await c.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                   where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)).rows.map((r) => r.t as string);

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `nbase_${Date.now().toString(36)}`;
  rootClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await rootClient.connect();
  await rootClient.query(`create database ${baselineName} template ut_before_tribes`);
  baseline = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: baselineName });
  await baseline.connect();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f >= "20261210000100" && f.slice(0, 14) <= LAST_BEFORE_NOTICES)
    .sort();
  for (const f of files) await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  db = await createTestDb();
}, 240_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await db?.close();
});

describe("the way back from the team's emails", () => {
  let before: Map<string, string>;
  let triggersBefore: string[];
  let rowsBefore: { settings: number; items: number };

  it("is what the migrations added and nothing else: no function that existed before was changed", async () => {
    const base = await functions(baseline);
    before = await functions(db.admin);
    const changed = [...base].filter(([sig, def]) => before.get(sig) !== def && !RESTORED_BY_LATER.has(sig.split("(")[0])).map(([sig]) => sig);
    expect(changed).toEqual([]);
    // …and the new functions are exactly the ones the two migration files create
    const created = new Set<string>();
    for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.slice(0, 14) > LAST_BEFORE_NOTICES)) {
      for (const m of fs.readFileSync(path.join(MIGRATIONS, f), "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    }
    const extra = [...before.keys()].filter((sig) => !base.has(sig)).map((sig) => sig.split("(")[0]);
    expect(extra.length).toBeGreaterThan(40);
    expect(extra.filter((n) => !created.has(n))).toEqual([]);
  });

  it("starts with every group Off and writes a row of the notice tables to keep", async () => {
    expect((await sql("select count(*)::int n from public.notice_settings where mode = 'off'"))[0].n).toBe(11);
    // A switch turned on, and a notice waiting, are the things a person would not want lost by going back
    await sql("update public.notice_settings set mode = 'on' where group_key = 'pastors'");
    const who = await db.createUser();
    await db.grant(who.id, "pastor");
    await sql("insert into public.notice_prefs (person_id, group_key, delivery) values ($1, 'pastors', 'weekly')", [who.id]);
    await sql("insert into public.leader_applications (person_id, consent_version, status) values ($1, 'v1', 'submitted')", [(await db.createUser()).id]);
    await sql("update public.leader_applications set status = 'interviewed'");
    rowsBefore = {
      settings: (await sql("select count(*)::int n from public.notice_settings"))[0].n,
      items: (await sql("select count(*)::int n from public.notice_items"))[0].n,
    };
    expect(rowsBefore.items).toBeGreaterThan(0);
    triggersBefore = await triggers(db.admin);
    const base = await triggers(baseline);
    expect(triggersBefore.length).toBeGreaterThan(base.length + 10);
  });

  it("runs the two rollback files, triggers first, and they run without error", async () => {
    for (const f of DOWN) {
      const text = fs.readFileSync(path.join(ROLLBACK, f), "utf8");
      expect(text, f).toMatch(/^-- /);
      expect(text, f).toMatch(/\bbegin;/);
      expect(text, f).toMatch(/\bcommit;\s*$/);
      // They drop functions and triggers, and do nothing else: no row is touched, no table dropped. A feature built after the notices may
      // need to put data back where it was (the way back from "Let them choose" restores the list of locked parts on the tribes it
      // unlocked), so only the notices' own files are held to "no row is touched"; every file is held to the rest.
      // (A later feature's file may put old function bodies back; what a body does is not what the file does, so bodies are not read here.)
      const lines = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      // (pg_get_functiondef writes CREATE OR REPLACE FUNCTION … $function$; a hand-written file may write create or replace function … $$.)
      // (A later feature's way back may also take out the switchboard and fact-list rows that same feature added: they are settings, not anyone's
      // data. Only statements on those three tables are set aside here; a statement on any other table is still held to the rule.)
      const code = LATER_DOWN.includes(f)
        ? lines
            .replace(/create\s+or\s+replace\s+function[\s\S]*?(?:\$function\$|\$\$);/gi, "")
            .replace(/\b(?:delete\s+from|update)\s+public\.(?:feature_settings|feature_registry|profile_fact_registry)\b[^;]*;/gi, "")
            // …nor the tables that same feature made, nor the Switchboard's own column and range check it added or widened (a way back puts them as they were)
            .replace(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)\s*;/gi, (all, t: string) => (LATER_TABLES.has(t.toLowerCase()) ? "" : all))
            .replace(/\balter\s+table\s+public\.feature_registry\b[^;]*;/gi, "")
            // …and the holds the removal change put on people (a removal or a care hold exists only since that change; the older code cannot end a hold)
            .replace(/\bdelete\s+from\s+public\.placement_holds\s+where\s+source\s+in\s+\('removal',\s*'care'\)\s*;/gi, "")
        : lines;
      expect(code, f).not.toMatch(LATER_DOWN.includes(f) ? /\b(delete|truncate|insert)\b\s/i : /\b(delete|truncate|insert|update)\b\s/i);
      expect(code, f).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
      expect(code, f).not.toMatch(/\balter\s+table\b/i);
      await db.admin.query(text);
    }
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps every row: no switch, choice or waiting notice is lost", async () => {
    expect((await sql("select count(*)::int n from public.notice_settings"))[0].n).toBe(rowsBefore.settings);
    expect((await sql("select count(*)::int n from public.notice_items"))[0].n).toBe(rowsBefore.items);
    expect((await sql("select mode from public.notice_settings where group_key = 'pastors'"))[0].mode).toBe("on");
    expect((await sql("select count(*)::int n from public.notice_prefs where delivery = 'weekly'"))[0].n).toBe(1);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(db.admin);
    const firstTriggers = await triggers(db.admin);
    for (const f of DOWN) await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
    const again = await functions(db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(db.admin)).toEqual(firstTriggers);
  });

  it("leaves the platform doing what it did: a role given, an application moved on, a message queued", async () => {
    const person = await db.createUser();
    await db.grant(person.id, "coach");
    await db.grant(person.id, "pastor");
    await sql("delete from public.person_roles where person_id = $1 and role = 'coach'", [person.id]);
    const app = (await sql("insert into public.leader_applications (person_id, consent_version, status) values ($1, 'v1', 'submitted') returning id", [person.id]))[0].id;
    await sql("update public.leader_applications set status = 'interviewed' where id = $1", [app]);
    const queued = await db.admin.query("select public.enqueue_message($1, 'welcome', '{}'::jsonb, null, $2, null, 'normal', 'email') as id", [person.id, `rollback-${Date.now()}`]);
    expect(queued.rows[0].id).toBeTruthy();
    // and the Admin pages' functions are gone, as the apply guide says they will be
    await expect(db.admin.query("select public.admin_attention()")).rejects.toThrow(/does not exist/);
  });
});
