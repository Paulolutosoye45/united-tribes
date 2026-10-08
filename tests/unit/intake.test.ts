import { describe, expect, it } from "vitest";
import {
  firstProblem,
  isValidBirthday,
  normaliseWhatsapp,
  parseDraftAnswers,
  type Answers,
} from "@/lib/intake/answers";
import {
  SECTIONS,
  SECONDS_PER_STEP,
  STEP_IDS,
  canContinue,
  nextStep,
  previousStep,
  sectionOf,
  shieldFills,
  timeLeftLabel,
} from "@/lib/intake/steps";

/** A finished form, to start each test from. */
const complete = (): Answers => ({
  ageRange: "33-40",
  preferredName: "Tunde",
  gender: "male",
  circleMix: "mixed",
  zone: "mainland",
  tribe: "professionals",
  faith: "growing",
  goal: "step-into-a-leadership-role",
  baseline: 3,
  meetingMode: "online",
  times: ["sunday-afternoon"],
});

describe("intake steps", () => {
  it("walks the steps in order and stops at both ends", () => {
    expect(nextStep("age")).toBe("name");
    expect(nextStep("review")).toBe("review");
    expect(previousStep("age")).toBeNull();
    expect(previousStep("name")).toBe("age");
  });

  it("puts every step except the review in exactly one section", () => {
    const placed = SECTIONS.flatMap((s) => s.steps);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(STEP_IDS.filter((s) => s !== "review").sort());
    expect(sectionOf("tribe")).toBe(1);
    expect(sectionOf("review")).toBe(-1);
  });

  it("fills the shield one quarter at a time", () => {
    expect(shieldFills("welcome")).toEqual([0, 0, 0, 0]);
    // A small head start once the welcome is done, so the form already feels under way.
    expect(shieldFills("age")).toEqual([0.2, 0, 0, 0]);
    expect(shieldFills("gender")).toEqual([0.5, 0, 0, 0]);
    expect(shieldFills("story")).toEqual([1, 0, 0, 0]);
    expect(shieldFills("goal")).toEqual([1, 1, 0, 0]);
    expect(shieldFills("rhythm")).toEqual([1, 1, 1, 0]);
    expect(shieldFills("review")).toEqual([1, 1, 1, 1]);
    expect(shieldFills("done")).toEqual([1, 1, 1, 1]);
  });

  it("keeps the time estimate honest: about four minutes at the start, under a minute near the end", () => {
    expect(timeLeftLabel("age")).toBe("About 4 minutes left");
    expect(timeLeftLabel("extras")).toBe("Under a minute left");
    // Twelve questions at about eighteen seconds each is under four minutes, well inside the six-minute goal.
    expect((STEP_IDS.length - 1) * SECONDS_PER_STEP).toBeLessThan(300);
  });
});

describe("when Continue is allowed", () => {
  it("needs an age range, and turns teens away", () => {
    expect(canContinue("age", {})).toBe(false);
    expect(canContinue("age", { ageRange: "33-40" })).toBe(true);
    expect(canContinue("age", { ageRange: "13-17" })).toBe(false);
  });

  it("takes a birthday only as a real day and month, both or neither", () => {
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 14 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayMonth: 2 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 31, birthdayMonth: 4 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 29, birthdayMonth: 2 })).toBe(true);
    expect(isValidBirthday(30, 2)).toBe(false);
    expect(isValidBirthday(31, 12)).toBe(true);
  });

  it("accepts a tribe or goal in the person's own words, if they say something", () => {
    expect(canContinue("tribe", {})).toBe(false);
    expect(canContinue("tribe", { tribeOther: "ab" })).toBe(false);
    expect(canContinue("tribe", { tribeOther: "Pastors’ wives" })).toBe(true);
    expect(canContinue("goal", { goalOther: "Start a ministry" })).toBe(true);
  });

  it("lets people skip the story, style and extras", () => {
    for (const step of ["story", "style", "extras"] as const) expect(canContinue(step, {})).toBe(true);
  });

  it("needs a time that could work, and consent before a WhatsApp number is kept", () => {
    expect(canContinue("rhythm", { meetingMode: "online", times: [] })).toBe(false);
    expect(canContinue("rhythm", { meetingMode: "online", times: ["sunday-evening"] })).toBe(true);
    expect(canContinue("extras", { whatsapp: "0803 123 4567" })).toBe(false);
    expect(canContinue("extras", { whatsapp: "0803 123 4567", whatsappOk: true })).toBe(true);
    expect(canContinue("extras", { whatsapp: "12345", whatsappOk: true })).toBe(false);
  });
});

describe("WhatsApp numbers", () => {
  it("accepts the ways Nigerians write numbers", () => {
    for (const input of ["08031234567", "0803 123 4567", "+234 803 123 4567", "2348031234567", "+234-803-123-4567", "(0803) 123-4567", "00234 803 123 4567"]) {
      expect(normaliseWhatsapp(input), input).toBe("+2348031234567");
    }
  });

  it("accepts international numbers and refuses things that are not numbers", () => {
    expect(normaliseWhatsapp("+44 7700 900123")).toBe("+447700900123");
    expect(normaliseWhatsapp("")).toBeNull();
    expect(normaliseWhatsapp("hello")).toBeNull();
    expect(normaliseWhatsapp("0803 123")).toBeNull();
    expect(normaliseWhatsapp("803 123 4567")).toBeNull();
    expect(normaliseWhatsapp("+2348031234567890")).toBeNull();
  });
});

describe("reading a saved draft", () => {
  it("keeps good fields and drops bad ones one by one", () => {
    const parsed = parseDraftAnswers({
      ageRange: "33-40",
      gender: "robot",
      baseline: 9,
      times: ["sunday-evening", "monday-3am"],
      preferredName: "Tunde",
      zone: "mainland",
    });
    expect(parsed).toEqual({ ageRange: "33-40", preferredName: "Tunde", zone: "mainland" });
  });

  it("ignores anything it does not know, so extra fields cannot sneak in", () => {
    const parsed = parseDraftAnswers({ preferredName: "Ada", role: "admin", person_id: "x" });
    expect(parsed).toEqual({ preferredName: "Ada" });
  });

  it("copes with junk", () => {
    for (const value of [null, undefined, 42, "text", [], [1, 2]]) expect(parseDraftAnswers(value)).toEqual({});
  });

  it("refuses names with markup or numbers", () => {
    expect(parseDraftAnswers({ preferredName: "<script>" })).toEqual({});
    expect(parseDraftAnswers({ preferredName: "Ọlá-Adé" })).toEqual({ preferredName: "Ọlá-Adé" });
  });

  it("caps the length of what people write", () => {
    expect(parseDraftAnswers({ story: "x".repeat(1501) })).toEqual({});
    expect(parseDraftAnswers({ supportNeeds: "x".repeat(601) })).toEqual({});
  });
});

describe("checking a finished form", () => {
  it("passes a complete form", () => {
    expect(firstProblem(complete())).toBeNull();
  });

  it("names the step to go back to", () => {
    expect(firstProblem({ ...complete(), ageRange: undefined })?.step).toBe("age");
    expect(firstProblem({ ...complete(), ageRange: "13-17" })?.step).toBe("age");
    expect(firstProblem({ ...complete(), preferredName: undefined })?.step).toBe("name");
    expect(firstProblem({ ...complete(), circleMix: undefined })?.step).toBe("gender");
    expect(firstProblem({ ...complete(), zone: undefined })?.step).toBe("where");
    expect(firstProblem({ ...complete(), tribe: undefined })?.step).toBe("tribe");
    expect(firstProblem({ ...complete(), faith: undefined })?.step).toBe("faith");
    expect(firstProblem({ ...complete(), goal: undefined })?.step).toBe("goal");
    expect(firstProblem({ ...complete(), baseline: undefined })?.step).toBe("success");
    expect(firstProblem({ ...complete(), times: [] })?.step).toBe("rhythm");
  });

  it("takes a tribe and goal in the person's own words", () => {
    const own = { ...complete(), tribe: undefined, goal: undefined, tribeOther: "Farmers", goalOther: "Grow my farm" };
    expect(firstProblem(own)).toBeNull();
  });

  it("will not keep a goal without a tribe", () => {
    expect(firstProblem({ ...complete(), tribe: undefined, tribeOther: "Farmers" })?.step).toBe("tribe");
  });

  it("will not keep a WhatsApp number without consent, or a number that is not one", () => {
    expect(firstProblem({ ...complete(), whatsapp: "0803 123 4567" })?.step).toBe("extras");
    expect(firstProblem({ ...complete(), whatsapp: "0803 123 4567", whatsappOk: true })).toBeNull();
    expect(firstProblem({ ...complete(), whatsapp: "nope", whatsappOk: true })?.step).toBe("extras");
  });

  it("rejects a half-given or impossible birthday", () => {
    expect(firstProblem({ ...complete(), birthdayDay: 5 })?.step).toBe("age");
    expect(firstProblem({ ...complete(), birthdayDay: 31, birthdayMonth: 6 })?.step).toBe("age");
    expect(firstProblem({ ...complete(), birthdayDay: 5, birthdayMonth: 6 })).toBeNull();
  });
});
