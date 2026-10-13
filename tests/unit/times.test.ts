import { describe, expect, it } from "vitest";
import { MEETING_TIMES } from "@/lib/intake/options";
import { suggestTimes } from "@/lib/intake/times";

const ids = (r: ReturnType<typeof suggestTimes>) => r.map((s) => s.id);

describe("suggested meeting times", () => {
  it("steers in-person tribes across town away from weekday traffic", () => {
    const r = suggestTimes({ zone: "mainland", mode: "in_person", work: "employed" });
    expect(ids(r)[0]).toBe("sunday-afternoon");
    expect(r.find((s) => s.id === "weeknight-evening")?.reason).toMatch(/8 pm/);
  });

  it("offers weeknights after 8 pm to people who work and meet online", () => {
    expect(ids(suggestTimes({ zone: "island-lekki", mode: "online", work: "self_employed" }))[0]).toBe("weeknight-evening");
  });

  it("offers Saturday morning to students and people at home", () => {
    expect(ids(suggestTimes({ zone: "mainland", mode: "in_person", work: "student" }))).toContain("saturday-morning");
    expect(ids(suggestTimes({ zone: "iganmu-surulere", mode: "in_person", work: "homemaker" }))[0]).toBe("saturday-morning");
  });

  it("leads with Sunday evening for people abroad", () => {
    expect(ids(suggestTimes({ zone: "abroad" }))[0]).toBe("sunday-evening");
  });

  it("still suggests something when little is known, and never more than three, or the same time twice", () => {
    for (const input of [{}, { zone: "other-nigeria" as const }, { work: "retired" as const }, { mode: "either" as const, zone: "mainland" as const }]) {
      const r = ids(suggestTimes(input));
      expect(r.length).toBeGreaterThanOrEqual(2);
      expect(r.length).toBeLessThanOrEqual(3);
      expect(new Set(r).size).toBe(r.length);
    }
  });

  it("only suggests times the form offers, each with a reason", () => {
    const offered = new Set<string>(MEETING_TIMES.map((t) => t.id));
    for (const zone of ["iganmu-surulere", "mainland", "island-lekki", "other-nigeria", "abroad"] as const) {
      for (const work of [undefined, "employed", "student", "retired"] as const) {
        for (const s of suggestTimes({ zone, work, mode: "either" })) {
          expect(offered.has(s.id)).toBe(true);
          expect(s.reason.length).toBeGreaterThan(10);
        }
      }
    }
  });
});
