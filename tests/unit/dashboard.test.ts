import { describe, expect, it } from "vitest";
import type { Targets, Verdict } from "@/lib/dashboard/types";
import { STANDING, VERDICTS, VERDICT_ORDER, against, pct, signed, thrivingDefinition } from "@/lib/dashboard/wording";

const targets: Targets = {
  thriving_rate: 0.85,
  attend_share: 2 / 3,
  belonging_min: 4,
  gain_min: 2,
  effective_thriving: 0.8,
  effective_gain: 0.7,
  min_weeks: 3,
  min_cell: 5,
  min_answers: 3,
  retrain_after: 300,
};

describe("dashboard wording", () => {
  it("writes a rate as a whole percentage, and a missing one as a dash", () => {
    expect(pct(0.7273)).toBe("73%");
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
    expect(pct(null)).toBe("–");
    expect(pct(undefined)).toBe("–");
    expect(pct(0.8125, 1)).toBe("81.3%");
  });

  it("signs a gain", () => {
    expect(signed(2.6)).toBe("+2.6");
    expect(signed(0)).toBe("0");
    expect(signed(-1.2)).toBe("-1.2");
    expect(signed(null)).toBe("–");
  });

  it("says where a rate stands against its target", () => {
    expect(against(0.818, 0.85)).toBe("3 points below the target");
    expect(against(0.9, 0.85)).toBe("5 points above the target");
    expect(against(0.85, 0.85)).toBe("on target");
    expect(against(null, 0.85)).toBe("");
  });

  it("defines thriving in the words the pastorate uses", () => {
    expect(thrivingDefinition(8, 12, targets)).toBe(
      "Thriving means coming to at least 8 of 12 meetings and feeling at home: a belonging answer of 4 or 5.",
    );
  });

  it("has a label for every verdict and puts the Tribes that need help first", () => {
    const all: Verdict[] = ["before", "too_early", "on_course", "close", "at_risk", "effective", "not_yet"];
    for (const v of all) {
      expect(VERDICTS[v].text.length).toBeGreaterThan(0);
      expect(VERDICTS[v].line.endsWith(".")).toBe(true);
    }
    expect([...VERDICT_ORDER].sort()).toEqual([...all].sort());
    expect(VERDICT_ORDER.indexOf("at_risk")).toBeLessThan(VERDICT_ORDER.indexOf("on_course"));
    expect(VERDICT_ORDER.indexOf("not_yet")).toBeLessThan(VERDICT_ORDER.indexOf("effective"));
  });

  it("is kind to a member who did not thrive", () => {
    expect(STANDING.not_yet.title).toMatch(/did not go the way you hoped/);
    expect(STANDING.not_yet.line).toMatch(/okay/);
    for (const s of Object.values(STANDING)) {
      expect(s.title.endsWith(".")).toBe(true);
      expect(s.line.endsWith(".")).toBe(true);
    }
  });
});
