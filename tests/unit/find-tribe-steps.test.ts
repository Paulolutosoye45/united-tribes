import { describe, expect, it } from "vitest";
import { DEFAULT_MODES, type StageModes } from "@/lib/leaders/modes";
import { ELIGIBILITY_KEYS, type Position } from "@/lib/leaders/pipeline";
import {
  FIT_INPUT_STEPS,
  FIT_SECONDS,
  FIT_VIEW,
  STEP_IDS,
  activeSteps,
  fitFills,
  isStepId,
  minutesLeft,
  savedStep,
  shieldFills,
  timeLeftLabel,
  viewAfter,
  viewBefore,
  type FlowView,
} from "@/lib/leaders/steps";

// Find your tribe is a view, not a step. These tests hold it to that: the list of twenty-one steps never changes, the saved step is
// never "find-tribe", and for every position of every switch the way forward reaches the review and the way back retraces it.

const POSITIONS: Position[] = ["required", "optional", "off"];
const allQuestions = (p: Position) => Object.fromEntries(ELIGIBILITY_KEYS.map((k) => [k, p])) as Record<(typeof ELIGIBILITY_KEYS)[number], Position>;

/** Every combination that changes which screens exist: the questions (some asked, none asked), references, and the interview. */
function everyMode(): StageModes[] {
  const out: StageModes[] = [];
  for (const q of [allQuestions("required"), allQuestions("optional"), allQuestions("off"), { ...allQuestions("off"), age21: "required" as Position }]) {
    for (const references of POSITIONS) {
      for (const interview of POSITIONS) out.push({ ...DEFAULT_MODES, eligibility: q, references, interview });
    }
  }
  return out;
}

function forward(from: FlowView, modes: StageModes, fit: boolean): FlowView[] {
  const path: FlowView[] = [from];
  while (path[path.length - 1] !== "review") {
    path.push(viewAfter(path[path.length - 1], modes, fit));
    if (path.length > 40) throw new Error("the way forward does not end");
  }
  return path;
}

function backward(from: FlowView, modes: StageModes, fit: boolean): FlowView[] {
  const path: FlowView[] = [from];
  for (let prev = viewBefore(from, modes, fit); prev !== null; prev = viewBefore(prev, modes, fit)) {
    path.push(prev);
    if (path.length > 40) throw new Error("the way back does not end");
  }
  return path;
}

describe("the list of steps", () => {
  it("is still twenty-one, and Find your tribe is not one of them", () => {
    expect(STEP_IDS).toHaveLength(21);
    expect((STEP_IDS as readonly string[]).includes(FIT_VIEW)).toBe(false);
    expect(isStepId(FIT_VIEW)).toBe(false);
    expect(activeSteps()).toHaveLength(21);
  });

  it("saves the step before it, never its own name", () => {
    expect(savedStep(FIT_VIEW)).toBe("lead-best");
    for (const s of STEP_IDS) expect(savedStep(s)).toBe(s);
    for (const v of [FIT_VIEW, ...STEP_IDS] as FlowView[]) expect(isStepId(savedStep(v))).toBe(true);
  });
});

describe("with Tribe fit off", () => {
  it("goes exactly where it went before: next and back are the old next and back", () => {
    for (const m of everyMode()) {
      const here = activeSteps(m);
      expect(forward(here[0], m, false)).toEqual(here);
      expect(backward("review", m, false)).toEqual([...here].reverse());
      expect(forward(here[0], m, false)).not.toContain(FIT_VIEW);
    }
  });
});

describe("with Tribe fit on", () => {
  it("shows the screen once, straight after how you lead best, for every combination of the switches", () => {
    for (const m of everyMode()) {
      const here = activeSteps(m);
      const path = forward(here[0], m, true);
      expect(path.filter((v) => v === FIT_VIEW)).toHaveLength(1);
      expect(path.indexOf(FIT_VIEW)).toBe(path.indexOf("lead-best") + 1);
      // Everything else is on the way, in order
      expect(path.filter((v) => v !== FIT_VIEW)).toEqual(here);
      expect(path[path.length - 1]).toBe("review");
    }
  });

  it("reaches the review from every screen, wherever the leader is when it is switched on", () => {
    for (const m of everyMode()) {
      for (const s of activeSteps(m)) {
        const path = forward(s, m, true);
        expect(path[path.length - 1]).toBe("review");
      }
      expect(forward(FIT_VIEW, m, true)[0]).toBe(FIT_VIEW);
    }
  });

  it("retraces the way forward exactly when going back", () => {
    for (const m of everyMode()) {
      const path = forward(activeSteps(m)[0], m, true);
      expect(backward("review", m, true)).toEqual([...path].reverse());
    }
  });

  it("goes from the screen to the next active step, and back to how you lead best", () => {
    const m = { ...DEFAULT_MODES, references: "off" as Position };
    expect(viewAfter("lead-best", m, true)).toBe(FIT_VIEW);
    expect(viewAfter(FIT_VIEW, m, true)).toBe("review");
    expect(viewBefore("review", m, true)).toBe(FIT_VIEW);
    expect(viewBefore(FIT_VIEW, m, true)).toBe("lead-best");
    expect(viewAfter(FIT_VIEW, DEFAULT_MODES, true)).toBe("ref1");
    expect(viewBefore("ref1", DEFAULT_MODES, true)).toBe(FIT_VIEW);
  });

  it("does not add a screen to the first step or take one away from the last", () => {
    for (const m of everyMode()) {
      expect(viewBefore(activeSteps(m)[0], m, true)).toBeNull();
      expect(viewAfter("review", m, true)).toBe("review");
    }
  });
});

describe("the screens that send a leader back to Find your tribe", () => {
  it("are the ones the comparison reads, and no others", () => {
    expect([...FIT_INPUT_STEPS].sort()).toEqual(["community", "goal", "lead-best", "s1", "s2", "s3", "s4", "s5", "s6", "track"].sort());
    for (const s of FIT_INPUT_STEPS) expect(isStepId(s)).toBe(true);
    // The written answers and the referees do not move the comparison
    for (const s of ["goal-story", "why", "walked", "walk", "obstacles", "contact", "eligibility", "ref1", "ref2", "style"]) expect(FIT_INPUT_STEPS).not.toContain(s);
  });
});

describe("time and the shield", () => {
  it("never shows less than a minute, or a negative figure, wherever the leader is", () => {
    for (const m of everyMode()) {
      for (const fit of [false, true]) {
        for (const v of [FIT_VIEW, ...activeSteps(m)] as FlowView[]) {
          const left = minutesLeft(v, m, fit);
          expect(left).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(left)).toBe(true);
          expect(timeLeftLabel(v, m, fit)).toMatch(/^(Under a minute|About \d+ minutes) left$/);
        }
      }
    }
  });

  it("adds about a minute while the screen is still ahead, and counts it while the leader is on it, and not after", () => {
    const m = DEFAULT_MODES;
    const seconds = (v: FlowView, fit: boolean) => minutesLeft(v, m, fit) * 60;
    expect(FIT_SECONDS).toBe(60);
    expect(minutesLeft("track", m, true)).toBeGreaterThanOrEqual(minutesLeft("track", m, false));
    expect(seconds("track", true) - seconds("track", false)).toBeLessThanOrEqual(FIT_SECONDS + 60);
    expect(minutesLeft("lead-best", m, true)).toBeGreaterThanOrEqual(minutesLeft("lead-best", m, false));
    expect(minutesLeft(FIT_VIEW, m, true)).toBeGreaterThanOrEqual(minutesLeft("ref1", m, true));
    expect(minutesLeft("ref1", m, true)).toBe(minutesLeft("ref1", m, false));
    expect(minutesLeft("review", m, true)).toBe(minutesLeft("review", m, false));
  });

  it("fills 'Your judgement' on the screen and leaves 'People who know you' for later", () => {
    for (const m of everyMode()) {
      const f = fitFills(m);
      expect(f[2]).toBe(1);
      expect(f[3]).toBe(0);
      const before = shieldFills("lead-best", m);
      expect(f[0]).toBe(before[0]);
      expect(f[1]).toBe(before[1]);
    }
  });
});
