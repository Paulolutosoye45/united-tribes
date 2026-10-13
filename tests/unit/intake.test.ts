import { describe, expect, it } from "vitest";
import {
  PRIVATE_ANSWER_KEYS,
  contactProblem,
  enabledChannels,
  firstProblem,
  isValidBirthday,
  normaliseWhatsapp,
  parseDraftAnswers,
  supportLoad,
  type Answers,
} from "@/lib/intake/answers";
import {
  SECTIONS,
  SECONDS_PER_STEP,
  STEP_IDS,
  canContinue,
  nextStep,
  previousStep,
  resumeStep,
  sectionOf,
  shieldFills,
  timeLeftLabel,
} from "@/lib/intake/steps";

/** A finished form, to start each test from. */
const complete = (): Answers => ({
  ageRange: "33-40",
  preferredName: "Tunde",
  gender: "male",
  tribeMix: "mixed",
  zone: "mainland",
  community: "professionals",
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
    expect(sectionOf("community")).toBe(1);
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
    expect(timeLeftLabel("contact")).toBe("Under a minute left");
    // Fourteen questions at about sixteen seconds each is under four minutes, well inside the six-minute goal.
    expect((STEP_IDS.length - 1) * SECONDS_PER_STEP).toBeLessThan(300);
  });
});

describe("when Continue is allowed", () => {
  it("needs an age range, and turns teens away", () => {
    expect(canContinue("age", {})).toBe(false);
    expect(canContinue("age", { ageRange: "33-40" })).toBe(true);
    expect(canContinue("age", { ageRange: "13-17" })).toBe(false);
    // closed unless the church has opened the teen track
    expect(canContinue("age", { ageRange: "13-17" }, { teensOpen: false })).toBe(false);
    expect(canContinue("age", { ageRange: "13-17" }, { teensOpen: true })).toBe(true);
    expect(canContinue("age", { ageRange: "33-40" }, { teensOpen: true })).toBe(true);
  });

  it("takes a birthday only as a real day and month, both or neither", () => {
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 14 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayMonth: 2 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 31, birthdayMonth: 4 })).toBe(false);
    expect(canContinue("age", { ageRange: "33-40", birthdayDay: 29, birthdayMonth: 2 })).toBe(true);
    expect(isValidBirthday(30, 2)).toBe(false);
    expect(isValidBirthday(31, 12)).toBe(true);
  });

  it("accepts a community or goal in the person's own words, if they say something", () => {
    expect(canContinue("community", {})).toBe(false);
    expect(canContinue("community", { communityOther: "ab" })).toBe(false);
    expect(canContinue("community", { communityOther: "Pastors’ wives" })).toBe(true);
    expect(canContinue("goal", { goalOther: "Start a ministry" })).toBe(true);
  });

  it("lets people skip the story, what we heard, style, care and contact", () => {
    for (const step of ["story", "heard", "style", "care", "contact"] as const) expect(canContinue(step, {})).toBe(true);
  });

  it("needs a time that could work, and consent before a WhatsApp number is kept", () => {
    expect(canContinue("rhythm", { meetingMode: "online", times: [] })).toBe(false);
    expect(canContinue("rhythm", { meetingMode: "online", times: ["sunday-evening"] })).toBe(true);
    expect(canContinue("contact", { phone: "0803 123 4567", whatsappOk: true })).toBe(true);
    expect(canContinue("contact", { phone: "0803 123 4567" })).toBe(true); // a number kept for the leader, no channel on it
    expect(canContinue("contact", { whatsappOk: true })).toBe(false); // WhatsApp needs a number
    expect(canContinue("contact", { phone: "12345" })).toBe(false);
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
    expect(firstProblem({ ...complete(), ageRange: "13-17" }, { teensOpen: false })?.step).toBe("age");
    // once the church has opened tribes for teens, the same answers are accepted
    expect(firstProblem({ ...complete(), ageRange: "13-17" }, { teensOpen: true })).toBeNull();
    // ...and nothing else is relaxed for them
    expect(firstProblem({ ...complete(), ageRange: "13-17", preferredName: undefined }, { teensOpen: true })?.step).toBe("name");
    expect(firstProblem({ ...complete(), preferredName: undefined })?.step).toBe("name");
    expect(firstProblem({ ...complete(), tribeMix: undefined })?.step).toBe("gender");
    expect(firstProblem({ ...complete(), zone: undefined })?.step).toBe("where");
    expect(firstProblem({ ...complete(), community: undefined })?.step).toBe("community");
    expect(firstProblem({ ...complete(), faith: undefined })?.step).toBe("faith");
    expect(firstProblem({ ...complete(), goal: undefined })?.step).toBe("goal");
    expect(firstProblem({ ...complete(), baseline: undefined })?.step).toBe("success");
    expect(firstProblem({ ...complete(), times: [] })?.step).toBe("rhythm");
  });

  it("takes a community and goal in the person's own words", () => {
    const own = { ...complete(), community: undefined, goal: undefined, communityOther: "Farmers", goalOther: "Grow my farm" };
    expect(firstProblem(own)).toBeNull();
  });

  it("will not keep a goal without a community", () => {
    expect(firstProblem({ ...complete(), community: undefined, communityOther: "Farmers" })?.step).toBe("community");
  });

  it("will not keep WhatsApp or text without a number that is one", () => {
    expect(firstProblem({ ...complete(), phone: "0803 123 4567", whatsappOk: true })).toBeNull();
    expect(firstProblem({ ...complete(), whatsappOk: true })?.step).toBe("contact");
    expect(firstProblem({ ...complete(), phone: "nope", whatsappOk: true })?.step).toBe("contact");
    expect(firstProblem({ ...complete(), smsOk: true })?.step).toBe("contact");
  });

  it("wants at least one way to reach the person", () => {
    expect(firstProblem({ ...complete(), emailOk: false })?.step).toBe("contact");
    expect(firstProblem({ ...complete(), emailOk: false, phone: "0803 123 4567", smsOk: true })).toBeNull();
  });

  it("will not take a second-choice community that is the first", () => {
    expect(firstProblem({ ...complete(), secondCommunity: "professionals" })?.step).toBe("community");
    expect(firstProblem({ ...complete(), secondCommunity: "marriage-relationships" })).toBeNull();
  });

  it("rejects a half-given or impossible birthday", () => {
    expect(firstProblem({ ...complete(), birthdayDay: 5 })?.step).toBe("age");
    expect(firstProblem({ ...complete(), birthdayDay: 31, birthdayMonth: 6 })?.step).toBe("age");
    expect(firstProblem({ ...complete(), birthdayDay: 5, birthdayMonth: 6 })).toBeNull();
  });
});

describe("the rest of the smart form", () => {
  it("reads the new answers and drops the ones that are not on the list", () => {
    const a = parseDraftAnswers({
      relationship: "married",
      children: ["under_12", "teens"],
      workStatus: "employed",
      workField: "finance",
      groupRoles: ["host", "connector"],
      secondCommunity: "marriage-relationships",
      openToAdjacent: true,
      areaSlug: "yaba",
      channel: "sms",
    });
    expect(a).toMatchObject({ relationship: "married", children: ["under_12", "teens"], groupRoles: ["host", "connector"], openToAdjacent: true, channel: "sms" });
    const bad = parseDraftAnswers({ relationship: "complicated", children: ["many"], groupRoles: ["host", "connector", "thinker"], workField: "magic", areaSlug: "Yaba!", channel: "pigeon" });
    expect(bad).toEqual({});
  });

  it("works out how a person can be reached, best first", () => {
    expect(enabledChannels({})).toEqual(["email"]);
    expect(enabledChannels({ phone: "0803 123 4567", whatsappOk: true })).toEqual(["whatsapp", "email"]);
    expect(enabledChannels({ phone: "0803 123 4567", whatsappOk: true, smsOk: true, channel: "sms" })).toEqual(["sms", "whatsapp", "email"]);
    // A channel that is not on cannot be preferred, and WhatsApp without a number is not on.
    expect(enabledChannels({ whatsappOk: true, channel: "whatsapp" })).toEqual(["email"]);
    expect(enabledChannels({ emailOk: false, phone: "0803 123 4567", smsOk: true })).toEqual(["sms"]);
    expect(contactProblem({ emailOk: false })).toMatch(/at least one way/);
  });

  it("turns a private support note into a single number for the engine", () => {
    expect(supportLoad([], "")).toBe(0);
    expect(supportLoad(undefined, undefined)).toBe(0);
    expect(supportLoad(["quiet"], "")).toBe(1);
    expect(supportLoad([], "Please keep the group small.")).toBe(1);
    expect(supportLoad(["quiet", "grief"], "")).toBe(2);
    expect(supportLoad(["job_money"], "")).toBe(2);
  });

  it("names the answers that must never go in a browser draft", () => {
    expect([...PRIVATE_ANSWER_KEYS].sort()).toEqual(["leaderNote", "supportChips", "supportNote"]);
  });

  it("resumes drafts saved before the extras screen was split in two", () => {
    expect(resumeStep("extras")).toBe("care");
    expect(resumeStep("heard")).toBe("heard");
    expect(resumeStep("nonsense")).toBeNull();
    expect(resumeStep(undefined)).toBeNull();
  });
});
