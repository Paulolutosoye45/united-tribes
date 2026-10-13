import { describe, expect, it } from "vitest";
import { GUARDIAN_AGREE_SENTENCE, GUARDIAN_CONSENT_VERSION, GUARDIAN_STATEMENTS, RELATIONSHIPS, relationshipLabel } from "@/lib/guardian/consent";
import { MODEL_KEYS, PLANS, SWAP_REASONS } from "@/lib/growth/types";
import {
  ASSISTANT_STATE,
  MODEL_PARTS,
  PLAN_LABELS,
  SWAP_REASON_LABELS,
  SWAP_STATUS,
  correlation,
  liftText,
  weightChange,
} from "@/lib/growth/wording";

// Stage 6: the words on the learn-and-scale screens, and the text a parent or guardian agrees to.

describe("the matching model's words", () => {
  it("names every part the database weighs, and nothing else", () => {
    expect(Object.keys(MODEL_PARTS).sort()).toEqual([...MODEL_KEYS].sort());
    for (const key of MODEL_KEYS) {
      expect(MODEL_PARTS[key].label.length).toBeGreaterThan(2);
      expect(MODEL_PARTS[key].blurb.length).toBeGreaterThan(10);
    }
  });

  it("writes a change in the weights plainly", () => {
    expect(weightChange(30, 33)).toBe("+3");
    expect(weightChange(30, 25)).toBe("−5");
    expect(weightChange(10, 10)).toBe("no change");
    expect(weightChange(10, 10.4)).toBe("no change");
  });

  it("writes how much higher thriving members scored, with a sign, and says when there is nothing to say", () => {
    expect(liftText(0.123)).toBe("+0.12");
    expect(liftText(-0.04)).toBe("−0.04");
    expect(liftText(0)).toBe("0.00");
    expect(liftText(null)).toBe("n/a");
    expect(liftText(undefined)).toBe("n/a");
  });

  it("writes the check against past results, or says there are not enough", () => {
    expect(correlation(0.4123)).toBe("0.41");
    expect(correlation(-0.1)).toBe("-0.10");
    expect(correlation(null)).toBe("Not enough results");
  });
});

describe("changing tribe", () => {
  it("has a label and a hint for every reason the database accepts", () => {
    expect(Object.keys(SWAP_REASON_LABELS).sort()).toEqual([...SWAP_REASONS].sort());
    for (const reason of SWAP_REASONS) {
      expect(SWAP_REASON_LABELS[reason].label).toBeTruthy();
      expect(SWAP_REASON_LABELS[reason].hint).toBeTruthy();
    }
  });

  it("has a status label for every state of a request", () => {
    expect(Object.keys(SWAP_STATUS).sort()).toEqual(["declined", "member_declined", "moved", "offered", "requested", "withdrawn"]);
  });
});

describe("multiplication", () => {
  it("describes each plan the database accepts, and each state an assistant can be in", () => {
    expect(Object.keys(PLAN_LABELS).sort()).toEqual([...PLANS].sort());
    expect(Object.keys(ASSISTANT_STATE).sort()).toEqual(["certified", "in_training", "none"]);
  });
});

describe("what a parent or guardian agrees to", () => {
  it("has a version the database will take", () => {
    expect(GUARDIAN_CONSENT_VERSION).toMatch(/^[A-Za-z0-9._-]{1,24}$/);
  });

  it("says the things the programme actually does, and nothing it does not", () => {
    const all = GUARDIAN_STATEMENTS.join(" ");
    // what safeguards the young person
    expect(all).toMatch(/two adults/i);
    expect(all).toMatch(/own age group/i);
    expect(all).toMatch(/never place[^.]*adult tribe/i);
    expect(all).toMatch(/phone or write to you/i);
    expect(all).toMatch(/cannot be placed in a tribe until we have spoken/i);
    expect(all).toMatch(/take your permission back/i);
    expect(all).toMatch(/leave the tribe straight away/i);
    // what the church does with their data
    expect(all).toMatch(/answers/i);
    expect(all).toMatch(/delete/i);
    // promises it cannot keep
    expect(all).not.toMatch(/guarantee|always safe|no risk|100%/i);
  });

  it("asks for an explicit statement that they are the parent or legal guardian", () => {
    expect(GUARDIAN_AGREE_SENTENCE).toMatch(/parent or legal guardian/);
    expect(GUARDIAN_AGREE_SENTENCE).toMatch(/permission/);
  });

  it("offers the same relationships the database accepts", () => {
    expect(RELATIONSHIPS.map((r) => r.id).sort()).toEqual(["father", "guardian", "mother", "other"]);
    expect(relationshipLabel("mother")).toBe("Mother");
    expect(relationshipLabel("nobody")).toBe("Parent or guardian");
    expect(relationshipLabel(null)).toBe("Parent or guardian");
  });
});
