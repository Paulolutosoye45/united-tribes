import { describe, expect, it } from "vitest";
import { FIT_PART_KEYS, changedLine, chosenLine, firstLine, parseFitPanel } from "@/lib/leaders/fit-panel";

const run = (over: Record<string, unknown> = {}) => ({
  visible: true,
  run: {
    first: { title: "Open a studio", community: "Creative Economy" },
    wrote_own: false,
    chosen: { title: "Teach a trade", community: "Creative Economy" },
    degree: 78,
    label: "strong",
    parts: { calling: 80, judgement: 70, style: 60, need: 100, stage: 90 },
    flags: [{ code: "changed_after_results", text: "Changed their pick after seeing the results" }],
    backups: [{ title: "Marriage care", community: "Families" }],
    others: [{ title: "Open a studio", community: "Creative Economy", degree: 71, label: "strong" }],
    picks: 2,
    shown: 3,
    options: 14,
    model: "lf-1",
    at: "2026-10-20T10:00:00Z",
    ...over,
  },
});

describe("reading the panel", () => {
  it("reads a full panel", () => {
    const p = parseFitPanel(run());
    expect(p.visible).toBe(true);
    if (!p.visible || !p.run) throw new Error("expected a run");
    expect(p.run.chosen?.title).toBe("Teach a trade");
    expect(p.run.parts).toEqual({ calling: 80, judgement: 70, style: 60, need: 100, stage: 90 });
    expect(p.run.flags).toEqual(["Changed their pick after seeing the results"]);
    expect(p.run.backups).toHaveLength(1);
    expect(p.run.others[0].degree).toBe(71);
    expect(p.run.options).toBe(14);
  });

  it("is not shown unless the database said it is visible", () => {
    for (const j of [null, undefined, "x", [], {}, { visible: false }, { visible: "yes" }, { visible: 1 }]) expect(parseFitPanel(j)).toEqual({ visible: false });
  });

  it("is visible with no run when there is nothing to show yet", () => {
    expect(parseFitPanel({ visible: true, run: null })).toEqual({ visible: true, run: null });
    expect(parseFitPanel({ visible: true })).toEqual({ visible: true, run: null });
  });

  it("drops parts unless all five are there, and keeps them between 0 and 100", () => {
    const missing = parseFitPanel(run({ parts: { calling: 80 } }));
    expect(missing.visible && missing.run?.parts).toBeNull();
    const wild = parseFitPanel(run({ parts: { calling: 400, judgement: -5, style: 60, need: 1, stage: 2 } }));
    if (!wild.visible || !wild.run?.parts) throw new Error("expected parts");
    expect(wild.run.parts.calling).toBe(100);
    expect(wild.run.parts.judgement).toBe(0);
    expect(FIT_PART_KEYS).toHaveLength(5);
  });

  it("never throws on junk", () => {
    for (const bad of [{ visible: true, run: { flags: 3, backups: "x", others: [null, 1, {}], parts: [] } }, { visible: true, run: [] }, { visible: true, run: { chosen: 5 } }]) {
      expect(() => parseFitPanel(bad)).not.toThrow();
    }
  });
});

describe("the words", () => {
  const read = (over?: Record<string, unknown>) => {
    const p = parseFitPanel(run(over));
    if (!p.visible || !p.run) throw new Error("expected a run");
    return p.run;
  };

  it("says what was chosen and how well it matched", () => {
    expect(chosenLine(read())).toBe("Chose Teach a trade (Creative Economy). Strong match, 78%.");
    expect(chosenLine(read({ label: "stretch", degree: 52 }))).toBe("Chose Teach a trade (Creative Economy). Stretch.");
    expect(chosenLine(read({ chosen: null, degree: null, label: null }))).toBe("Did not choose a tribe from the list.");
  });

  it("says where the leader started only when it differs from the choice", () => {
    expect(firstLine(read())).toBe("Started with Open a studio, then chose another after seeing the results.");
    expect(firstLine(read({ wrote_own: true, first: null }))).toBe("Started by writing their own tribe, before seeing the results.");
    expect(firstLine(read({ first: { title: "Teach a trade", community: "Creative Economy" } }))).toBeNull();
  });

  it("counts changes of mind, not the first choice", () => {
    expect(changedLine(read({ picks: 1 }))).toBeNull();
    expect(changedLine(read({ picks: 0 }))).toBeNull();
    expect(changedLine(read({ picks: 2 }))).toBe("Changed their choice 1 time.");
    expect(changedLine(read({ picks: 4 }))).toBe("Changed their choice 3 times.");
  });
});
