import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers";

// supabase/patches/desk-lead-options-wording.sql corrects one sentence ("Groups tab" should say Proposals tab) for a database that applied 20270125000100 before the fix.
// Put the old sentence back in the function, run the patch (twice), and the function must be exactly the one the migration builds, with its permissions untouched.

const PATCH = fs.readFileSync(path.resolve(__dirname, "../../supabase/patches/desk-lead-options-wording.sql"), "utf8");
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

const state = async () =>
  (await db.admin.query(`select md5(pg_get_functiondef(p.oid)) as def, p.proacl::text as acl, pg_get_functiondef(p.oid) as text
                           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'desk_person_lead_options'`)).rows[0] as { def: string; acl: string; text: string };

describe("the wording patch for the Recommend-as-leader button", () => {
  it("the migration already says Proposals tab, and never says a tab the Desk does not have", async () => {
    const now = await state();
    expect(now.text).toContain("Start one on the Proposals tab (Start a draft group).");
    expect(now.text).not.toContain("Groups tab");
  });

  it("turns the old sentence into the new one, changes nothing else, and is safe to run twice", async () => {
    const good = await state();
    await db.admin.query(good.text.replace("Proposals tab (Start a draft group)", "Groups tab")); // a database built before the fix
    const old = await state();
    expect(old.text).toContain("Groups tab");
    expect(old.def).not.toBe(good.def);
    await db.admin.query(PATCH);
    await db.admin.query(PATCH);
    const fixed = await state();
    expect(fixed.def).toBe(good.def);
    expect(fixed.acl).toBe(good.acl);
  });
});
