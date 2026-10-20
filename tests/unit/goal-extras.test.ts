import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOAL_AFFINITY } from "@/lib/companion/rank";
import { GOAL_AFFINITY_EXTRA, OUTCOMES_EXTRA } from "@/lib/companion/goal-extras";
import { isTrait } from "@/lib/companion/traits";
import { outcomeSentences } from "@/lib/companion/sentences";

const seed = ["20261219000200_card_templates_seed.sql", "20261219000300_card_templates_seed_new.sql"].map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
const cardSlugs = [...seed.matchAll(/^\('([a-z0-9-]+)','[a-z-]+','[a-z-]+','/gm)].map((m) => m[1]);

describe("goal extras for the 77 added goals", () => {
  it("covers exactly the cards that are not among the 23 live goals", () => {
    expect(cardSlugs).toHaveLength(100);
    const extras = Object.keys(GOAL_AFFINITY_EXTRA).sort();
    expect(extras).toEqual(cardSlugs.filter((s) => !(s in GOAL_AFFINITY)).sort());
    expect(extras).toHaveLength(77);
    expect(Object.keys(OUTCOMES_EXTRA).sort()).toEqual(extras);
  });
  it("never overlaps the live table", () => {
    for (const k of Object.keys(GOAL_AFFINITY_EXTRA)) expect(k in GOAL_AFFINITY).toBe(false);
  });
  it("uses only real traits, sensible weights and three week-12 sentences", () => {
    for (const [slug, aff] of Object.entries(GOAL_AFFINITY_EXTRA)) {
      expect(Object.keys(aff).length).toBeGreaterThan(0);
      for (const [t, w] of Object.entries(aff)) {
        expect(isTrait(t), `${slug}: ${t}`).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0.4);
        expect(w).toBeLessThanOrEqual(4);
      }
      const o = OUTCOMES_EXTRA[slug];
      expect(o).toHaveLength(3);
      for (const line of o) expect(line.startsWith("By week 12, ")).toBe(true);
      expect(outcomeSentences(slug)).toEqual([...o]);
    }
  });
  it("leaves the live goals' sentences alone", () => {
    expect(outcomeSentences("launch-or-formalise-a-business")[0]).toContain("business is registered");
  });
});
