import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FACTS, readersMarkdown } from "../../src/lib/profile/registry";
import { createTestDb, type TestDb } from "./helpers";

// One fact, one owner, many readers: every reader written down.
//
// For each fact the platform keeps about a person, every database function and every file of the application that reads it must be on the list in
// src/lib/profile/registry.ts, and everything on the list must still read it. A new reader that nobody wrote down fails here, with its name; so does
// a name left on the list after the reader is gone. The list must also agree with the database's own registry, and docs/PROFILE-READERS.md must be
// what the list says.

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const MIGRATION = path.join(ROOT, "supabase/migrations/20270101000100_profiles_stage1.sql");

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const REGISTRY_FILE = "src/lib/profile/registry.ts";
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

describe("the readers of what a person has told us", () => {
  for (const fact of FACTS) {
    it(`${fact.key}: every database function that reads it is on the list, and every one on the list still does`, async () => {
      const rows = (
        await db.admin.query(
          `select distinct p.proname as n from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and pg_get_functiondef(p.oid) ~ $1 order by 1`,
          [fact.dbPattern],
        )
      ).rows.map((r) => r.n as string);
      const listed = names(fact.db);
      expect(rows.filter((n) => !listed.includes(n)), `reads ${fact.key} and is not on the list in ${REGISTRY_FILE}`).toEqual([]);
      expect(listed.filter((n) => !rows.includes(n)), `is on the list for ${fact.key} but no longer reads it`).toEqual([]);
      expect(new Set(listed).size, "a function is listed twice").toBe(listed.length);
    });

    it(`${fact.key}: every file of the application that reads it is on the list, and every one on the list still does`, () => {
      const pattern = new RegExp(fact.appPattern);
      const found = sourceFiles(SRC)
        .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
        .filter((f) => f !== REGISTRY_FILE && pattern.test(fs.readFileSync(path.join(ROOT, f), "utf8")))
        .sort();
      const listed = names(fact.app);
      expect(found.filter((f) => !listed.includes(f)), `reads ${fact.key} and is not on the list in ${REGISTRY_FILE}`).toEqual([]);
      expect(listed.filter((f) => !found.includes(f)), `is on the list for ${fact.key} but no longer reads it`).toEqual([]);
      expect(new Set(listed).size, "a file is listed twice").toBe(listed.length);
    });
  }

  it("names as owners only what the facts store added, and as readers only what was there before it", () => {
    const created = new Set<string>();
    for (const m of fs.readFileSync(MIGRATION, "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    for (const fact of FACTS) {
      for (const r of fact.db) expect(created.has(r.name), `${r.name} (${fact.key}) is ${r.kind}`).toBe(r.kind === "owner");
      for (const r of fact.app) {
        const own = /^src\/(lib\/profile\/|app\/\(app\)\/my\/|app\/\(public\)\/details\/|components\/god\/DetailsConsole|components\/profile\/)/.test(r.name);
        expect(own, `${r.name} (${fact.key}) is ${r.kind}`).toBe(r.kind === "owner");
      }
      for (const r of [...fact.db, ...fact.app]) expect(r.use.length, `${r.name} says what it uses ${fact.key} for`).toBeGreaterThan(15);
    }
  });

  it("agrees with the database's own registry on which facts exist, who they apply to and how a change is handled", async () => {
    const rows = (await db.admin.query("select key, label, layer, change_class, applies_to from public.profile_fact_registry order by sort")).rows;
    expect(rows.map((r) => ({ key: r.key, label: r.label, layer: r.layer, changeClass: r.change_class, appliesTo: r.applies_to }))).toEqual(
      FACTS.map((f) => ({ key: f.key, label: f.label, layer: f.layer, changeClass: f.changeClass, appliesTo: f.appliesTo })),
    );
  });

  it("is written down in docs/PROFILE-READERS.md exactly as the list says (npm run readers writes it)", () => {
    const file = path.join(ROOT, "docs/PROFILE-READERS.md");
    expect(fs.existsSync(file), "run npm run readers").toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(readersMarkdown());
  });

  it("would notice a reader nobody wrote down: a new function that reads an age range fails the first check", async () => {
    await db.admin.query(`create function public.zz_unlisted_reader() returns text language sql as $$ select ar.label from public.age_ranges ar limit 1 $$`);
    const fact = FACTS.find((f) => f.key === "age_range")!;
    const rows = (await db.admin.query("select distinct p.proname as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and pg_get_functiondef(p.oid) ~ $1", [fact.dbPattern])).rows.map((r) => r.n as string);
    expect(rows.filter((n) => !names(fact.db).includes(n))).toEqual(["zz_unlisted_reader"]);
    await db.admin.query("drop function public.zz_unlisted_reader()");
  });
});
