import { describe, expect, it } from "vitest";
import {
  APPOINT_PROMISE,
  EMPTY_FORM,
  STEP_DOWN_PROMISE,
  demandText,
  formPayload,
  formProblem,
  matchLine,
  parseAppointments,
  parseFound,
  parseSuggestions,
} from "@/lib/god/appointments";

const P = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";

describe("the short form", () => {
  const ok = { ...EMPTY_FORM, track: "builders", lead_best: "teaching" };
  it("needs a stage of life and a way of leading", () => {
    expect(formProblem(EMPTY_FORM)).toBe("Choose their stage of life.");
    expect(formProblem({ ...EMPTY_FORM, track: "builders" })).toBe("Say how they lead best.");
    expect(formProblem({ ...ok, lead_best: "dancing" })).toBe("Say how they lead best.");
    expect(formProblem(ok)).toBeNull();
  });
  it("needs reached-or-working-on-it once a goal is named", () => {
    expect(formProblem({ ...ok, goal: "launch-or-formalise-a-business" })).toBe("Say whether they have reached that goal or are working on it.");
    expect(formProblem({ ...ok, goal: "launch-or-formalise-a-business", relation: "achieved" })).toBeNull();
    expect(formProblem({ ...ok, relation: "someday" })).not.toBeNull();
  });
  it("sends only what is filled in, with the care answer always a yes or no", () => {
    expect(formPayload(ok)).toEqual({ track: "builders", lead_best: "teaching", care_cleared: false });
    expect(formPayload({ ...ok, community: "business-entrepreneurship", goal: "g", relation: "pursuing", care_cleared: true })).toEqual({
      track: "builders",
      lead_best: "teaching",
      community: "business-entrepreneurship",
      goal: "g",
      relation: "pursuing",
      care_cleared: true,
    });
    // a relation without a goal is not sent
    expect(formPayload({ ...ok, relation: "achieved" })).not.toHaveProperty("relation");
  });
});

describe("reading what the database sends", () => {
  it("reads people who were found, and drops what is not a person", () => {
    const found = parseFound([{ id: P, name: "Ada Obi", email: "ada@example.org", roles: ["member", "coach"], leads: 0, appointed: false, has_application: true }, { id: "no" }, null, 3]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: "Ada Obi", roles: ["member", "coach"], hasApplication: true });
    expect(parseFound(null)).toEqual([]);
  });

  const sug = (over: Record<string, unknown> = {}) => ({
    goal_id: G,
    title: "Teach a trade",
    community: "Creative Economy",
    label: "strong",
    degree: 78,
    recommended: true,
    next_to: false,
    sensitive: false,
    care_flag: false,
    parts: { calling: 80, judgement: 60, style: 70, need: 100, stage: 90 },
    waiting: 5,
    seats_open: 0,
    gap: 1,
    ...over,
  });
  it("reads suggestions with every part", () => {
    const s = parseSuggestions({ status: "ok", model: "lf-1", options: [sug()], needed: [sug({ title: "Open a studio", waiting: 0, gap: 0 })] });
    expect(s).not.toBeNull();
    if (!s || s.status !== "ok") throw new Error("expected ok");
    expect(s.options[0].parts.need).toBe(100);
    expect(s.needed[0].title).toBe("Open a studio");
    expect(parseSuggestions({ status: "no_model" })).toEqual({ status: "no_model" });
    for (const j of [null, "x", [], {}, { status: "weird" }]) expect(parseSuggestions(j)).toBeNull();
  });
  it("drops a suggestion with no id or title", () => {
    const s = parseSuggestions({ status: "ok", model: "lf-1", options: [sug({ goal_id: "x" }), sug({ title: "" }), sug()], needed: "no" });
    if (!s || s.status !== "ok") throw new Error("expected ok");
    expect(s.options).toHaveLength(1);
    expect(s.needed).toEqual([]);
  });

  it("reads the list of appointments", () => {
    const rows = parseAppointments([
      {
        id: A,
        status: "active",
        person: { id: P, name: "Ada Obi", email: "ada@example.org" },
        goal: "Teach a trade",
        community: "Creative Economy",
        degree: 78,
        label: "strong",
        flags: ["Chose a sensitive tribe below the care bar"],
        care_cleared: true,
        note: "Asked by Pastor",
        tribe: { id: T, status: "draft", name: "Ada’s tribe", members: 0, certified: false },
        appointed_at: "2026-10-20T10:00:00Z",
        stepped_down_at: null,
        step_down_reason: null,
      },
      { id: "bad" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ active: true, careCleared: true, tribe: { members: 0, certified: false }, note: "Asked by Pastor" });
  });
});

describe("words", () => {
  it("says the match", () => {
    expect(matchLine("strong", 78)).toBe("Strong match, 78%");
    expect(matchLine("stretch", 55)).toBe("Stretch");
    expect(matchLine(null, null)).toBe("No match recorded");
  });
  it("says what members are waiting for", () => {
    expect(demandText({ waiting: 0, seatsOpen: 0, gap: 0 })).toBe("Nobody is waiting for this tribe now.");
    expect(demandText({ waiting: 5, seatsOpen: 2, gap: 0 })).toBe("5 members are waiting and 2 seats are open.");
    expect(demandText({ waiting: 1, seatsOpen: 1, gap: 1 })).toBe("1 member is waiting and 1 seat is open. They need 1 more leader.");
  });
  it("promises nothing that is not true", () => {
    expect(APPOINT_PROMISE.join(" ")).toContain("A pastor still approves the card");
    expect(APPOINT_PROMISE.join(" ")).toContain("no name");
    expect(STEP_DOWN_PROMISE.join(" ")).toContain("never withdrawn");
  });
});
