import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mockProvider } from "@/lib/ai/providers/mock";
import { suggestOptions } from "@/lib/ai/suggest";
import { checkBars, percentile, scoreProvider, type Run, type Story } from "../../scripts/bakeoff/score";

const stories: Story[] = JSON.parse(fs.readFileSync(path.join(__dirname, "../../scripts/bakeoff/stories.json"), "utf8"));

const story = (over: Partial<Story>): Story => ({
  id: "s",
  field: "community",
  question: "q",
  options: [],
  story: "",
  best: ["a"],
  acceptable: ["a", "b"],
  ...over,
});
const run = (over: Partial<Run>): Run => ({
  storyId: "s",
  provider: "p",
  model: "m",
  picks: [],
  reasons: [],
  fallback: false,
  dropped: 0,
  latencyMs: 100,
  ...over,
});

describe("bake-off stories", () => {
  it("are well formed", () => {
    expect(stories.length).toBeGreaterThanOrEqual(25);
    const ids = new Set<string>();
    for (const s of stories) {
      expect(ids.has(s.id), `duplicate ${s.id}`).toBe(false);
      ids.add(s.id);
      const optionIds = new Set(s.options.map((o) => o.id));
      for (const id of [...s.best, ...s.acceptable]) expect(optionIds.has(id), `${s.id}: ${id}`).toBe(true);
      for (const id of s.best) expect(s.acceptable).toContain(id);
      if (s.expect === "none") expect(s.best).toEqual([]);
      else expect(s.best.length).toBeGreaterThan(0);
    }
  });

  it("only use options that exist in the database catalogue", () => {
    const migration = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261012000200_reference_data.sql"), "utf8");
    for (const s of stories) for (const o of s.options) expect(migration, `${o.id} missing from migration`).toContain(`'${o.id}'`);
  });

  it("run through the mock provider without errors (a plumbing dry run)", async () => {
    const provider = mockProvider();
    for (const s of stories) {
      const res = await suggestOptions({ field: s.field, question: s.question, options: s.options, story: s.story, max: 3 }, { provider });
      expect(res.reason === "error" || res.reason === "timeout", s.id).toBe(false);
      expect(res.dropped, s.id).toBe(0);
    }
  });
});

describe("scoring", () => {
  it("computes percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
  });

  it("scores top-1, hit-in-list, precision and restraint separately", () => {
    const set = [story({ id: "1" }), story({ id: "2" }), story({ id: "3", expect: "none", best: [], acceptable: [] })];
    const score = scoreProvider(set, [
      run({ storyId: "1", picks: ["a", "z"] }),
      run({ storyId: "2", picks: ["b", "a"] }),
      run({ storyId: "3", picks: [] }),
    ]);
    expect(score.top1).toBe(0.5);
    expect(score.hitAt3).toBe(1);
    expect(score.precision).toBe(0.75);
    expect(score.restraint).toBe(1);
  });

  it("counts invented picks and failures, and leaves failures out of latency", () => {
    const set = [story({ id: "1" })];
    const score = scoreProvider(set, [
      run({ storyId: "1", picks: ["a"], dropped: 1, latencyMs: 400 }),
      run({ storyId: "1", fallback: true, failureReason: "timeout", latencyMs: 10000 }),
    ]);
    expect(score.invalidRate).toBe(0.5);
    expect(score.failureRate).toBe(0.5);
    expect(score.p95).toBe(400);
  });

  it("reports pass and fail against the bars", () => {
    const good = scoreProvider([story({})], [run({ picks: ["a"] })]);
    expect(checkBars(good).filter((r) => r.name !== "Stays quiet when it should").every((r) => r.pass)).toBe(true);
    const bad = scoreProvider([story({})], [run({ picks: ["z"], dropped: 3, latencyMs: 9000 })]);
    expect(checkBars(bad).some((r) => !r.pass)).toBe(true);
  });
});
