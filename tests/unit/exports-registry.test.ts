import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKS, packInfo } from "@/lib/exports/registry";
import { PACK_IDS } from "@/lib/exports/types";

// The app's list of packs and the database's list must say the same thing, or a screen could offer what the database refuses (or the
// other way round). The database's list is read from the migration that makes it.
const SQL = readFileSync(join(__dirname, "../../supabase/migrations/20261231000100_exports.sql"), "utf8");
const ROW = /\('([a-z_]+)',\s*'([^']+)',\s*'(people|insight)',\s*array\[([^\]]*)\]::public\.app_role\[\],\s*'([a-z]+)',\s*array\[([^\]]*)\],\s*(true|false),\s*(\d+)\)/g;
const list = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("the packs", () => {
  const db = [...SQL.matchAll(ROW)].map((m) => ({ id: m[1], name: m[2], lane: m[3], roles: list(m[4]), scope: m[5], formats: list(m[6]), released: m[7] === "true", sort: Number(m[8]) }));

  it("are the same fourteen in the app and in the database, in the same order", () => {
    expect(db).toHaveLength(14);
    expect(db.sort((a, b) => a.sort - b.sort).map((p) => p.id)).toEqual(PACKS.map((p) => p.id));
    expect(PACK_IDS as readonly string[]).toEqual(PACKS.map((p) => p.id));
  });

  it("agree on each pack's name, lane, scope, formats and whether this release has it", () => {
    for (const d of db) {
      const a = packInfo(d.id)!;
      expect({ id: a.id, name: a.name, lane: a.lane, scope: a.scope, formats: a.formats, released: a.released }, d.id).toEqual({ id: d.id, name: d.name, lane: d.lane, scope: d.scope, formats: d.formats, released: d.released });
    }
  });

  it("give a People pack to roles that may see people, and never name a member in an Insight pack's description", () => {
    for (const d of db.filter((p) => p.lane === "insight")) expect(packInfo(d.id)!.line, d.id).not.toMatch(/\bnames?\b.*\bmember/i);
    // the owner is not a role of any pack: only the platform owner's console moves a switch
    for (const d of db) expect(d.roles, d.id).not.toContain("owner");
    // a member's own pack is for members only and not in this release
    expect(db.find((p) => p.id === "my_data_pack")).toMatchObject({ roles: ["member"], released: false });
  });

  it("has a short line and a file name stem for each, with no spaces", () => {
    for (const p of PACKS) {
      expect(p.line.length, p.id).toBeGreaterThan(20);
      expect(p.stem, p.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(new Set(PACKS.map((p) => p.stem)).size).toBe(PACKS.length);
  });
});
