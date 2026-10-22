import { describe, expect, it } from "vitest";
import { areaOf, describeAction, describeKind, goalLine } from "@/lib/god/wording";

describe("the owner's record, for letting a leader choose", () => {
  it("has plain words for every new action and for the kind a leader's own pick is filed under", () => {
    for (const a of ["leader.goal_unlocked", "leader.goal_locked", "leader.goal_chosen", "leader.welcome_queued", "leader.welcome_approved", "leader.welcome_withdrawn", "leader.welcome_signature_saved"]) {
      expect(describeAction(a), a).not.toBe(a.replace(/[._]/g, " "));
      expect(areaOf(a)).toBe("leaders");
    }
    expect(describeKind("leader")).toBe("A leader");
  });

  it("says what the owner unlocked, with the goal the leader was started on", () => {
    expect(goalLine("action", "leader.goal_unlocked", { goal: "Build a steady client pipeline", community_too: false })).toBe(
      "You let a leader choose their own goal. They were started on “Build a steady client pipeline”",
    );
    expect(goalLine("action", "leader.goal_unlocked", { goal: "Grow", community_too: true })).toContain("and the community too");
  });

  it("says what the owner locked again", () => {
    expect(goalLine("action", "leader.goal_locked", { goal: "Grow" })).toBe("You locked a leader’s goal again. It is “Grow”");
  });

  it("says what a leader chose, from what, and how many were waiting, without a name", () => {
    expect(goalLine("leader", "leader.goal_chosen", { goal: "Set boundaries", was: "Grow", waiting: 5, seats_open: 1 })).toBe(
      "A leader chose their own goal: “Set boundaries”, instead of “Grow”. 5 members were waiting for it",
    );
    expect(goalLine("leader", "leader.goal_chosen", { goal: "Set boundaries", was: "Grow", waiting: 1 })).toContain("1 member was waiting");
    expect(goalLine("leader", "leader.goal_chosen", { goal: "Set boundaries", was: "Grow", waiting: 0 })).toContain("No one was waiting for it");
    expect(goalLine("leader", "leader.goal_chosen", {})).toBe("A leader chose their own goal");
  });

  it("says which welcome email was queued", () => {
    expect(goalLine("action", "leader.welcome_queued", { variant: "choose", again: false })).toBe("You queued the welcome email for a leader (they may choose)");
    expect(goalLine("action", "leader.welcome_queued", { variant: "fixed", again: true })).toBe("You queued the welcome email for a leader (their goal was chosen for them), again");
  });

  it("leaves every other entry to the usual words", () => {
    expect(goalLine("action", "tribe.approved", {})).toBeNull();
    expect(goalLine("looked", "desks", {})).toBeNull();
    expect(goalLine("leader", "something.else", {})).toBeNull();
  });
});
