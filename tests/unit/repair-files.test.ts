import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "../../scripts/build-repair.mjs";

// The two repair files (supabase/repair/) are written from the migration and rollback files by scripts/build-repair.mjs. If a rollback file changes and the repair
// files are not written again, the undo would run old text on a live database. These fail until `node scripts/build-repair.mjs` is run.

const ROOT = join(__dirname, "../..");
const REPAIR = join(ROOT, "supabase/repair");
const built = build() as { count: string; undo: string; tables: number; downs: number; ups: number };

describe("the repair files for files that went in out of order", () => {
  it("are what the script writes now (run `node scripts/build-repair.mjs` if this fails)", () => {
    expect(readFileSync(join(REPAIR, "1-count-before-undo.sql"), "utf8")).toBe(built.count);
    expect(readFileSync(join(REPAIR, "2-undo-from-20270126-to-20270114.sql"), "utf8")).toBe(built.undo);
  });

  it("undo covers every way-back file from 20270114000100 onward, newest first", () => {
    const names = readdirSync(join(ROOT, "supabase/rollback")).filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) >= "20270114000100").sort().reverse();
    expect(names.length).toBeGreaterThanOrEqual(13);
    const at = names.map((n) => built.undo.indexOf(`-- ===== ${n} =====`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the count file names every table those migrations create, and only reads", () => {
    const made = new Set<string>();
    for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter((x) => x.slice(0, 14) >= "20270114000100")) {
      for (const m of readFileSync(join(ROOT, "supabase/migrations", f), "utf8").matchAll(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_0-9]+)/gim)) made.add(m[1]);
    }
    for (const t of made) expect(built.count).toContain(`('${t}',`);
    expect(built.count).not.toMatch(/(^|\n)\s*(insert|update|delete|drop|alter|truncate)\s/i);
  });
});
