import { describe, expect, it } from "vitest";
import { EMPTY_REFEREE, firstProblem, isBlankReferee, type LeaderAnswers, type RefereeInput } from "@/lib/leaders/answers";
import { DEFAULT_MODES, askedQuestions, lenient, modesFromPipeline, optionalQuestions, parseModes, requiredQuestions, type StageModes } from "@/lib/leaders/modes";
import { DEFAULT_PIPELINE, ELIGIBILITY_KEYS, type Position } from "@/lib/leaders/pipeline";
import { adaptParagraphs, fieldValues, leaderProgress, modesOfData } from "@/lib/outreach/compose";
import { stageStates } from "@/lib/leaders/status";
import {
  STEP_IDS,
  activeSteps,
  canContinue,
  minutesLeft,
  nextStep,
  previousStep,
  resolveStep,
  shieldFills,
  stepApplies,
  timeLeftLabel,
} from "@/lib/leaders/steps";
import { eligibilityHeading, outlineDetails, reviewFooter, stageDetails, statusLine, submittedWording, welcomeStages } from "@/lib/leaders/wording";
import { STATUS_INFO } from "@/lib/leaders/options";
import { receivedNext } from "@/lib/messaging/templates";
import { TEMPLATES } from "@/lib/messaging/templates";

const modes = (over: Partial<Omit<StageModes, "eligibility">> & { eligibility?: Partial<Record<(typeof ELIGIBILITY_KEYS)[number], Position>> } = {}): StageModes => ({
  ...DEFAULT_MODES,
  ...over,
  eligibility: { ...DEFAULT_MODES.eligibility, ...(over.eligibility ?? {}) },
});
const allQuestions = (p: Position) => Object.fromEntries(ELIGIBILITY_KEYS.map((k) => [k, p])) as Record<(typeof ELIGIBILITY_KEYS)[number], Position>;

describe("which steps apply to an application", () => {
  it("is every one of the twenty-one when every step is asked", () => {
    expect(activeSteps()).toEqual([...STEP_IDS]);
    expect(activeSteps(DEFAULT_MODES)).toHaveLength(21);
    for (const s of STEP_IDS) expect(stepApplies(s)).toBe(true);
  });

  it("drops the referee screens when references are off, and keeps them when they are optional", () => {
    expect(activeSteps(modes({ references: "off" }))).toEqual(STEP_IDS.filter((s) => s !== "ref1" && s !== "ref2"));
    expect(activeSteps(modes({ references: "optional" }))).toHaveLength(21);
  });

  it("drops the questions screen only when every question is off", () => {
    expect(stepApplies("eligibility", modes({ eligibility: { member6: "off", foundation: "off", serving: "off" } }))).toBe(true);
    expect(stepApplies("eligibility", modes({ eligibility: allQuestions("optional") }))).toBe(true);
    expect(stepApplies("eligibility", modes({ eligibility: allQuestions("off") }))).toBe(false);
    expect(activeSteps(modes({ eligibility: allQuestions("off"), references: "off" }))).toHaveLength(18);
  });

  it("never leaves out the interview, the written questions or the review: only those three kinds of screen can go", () => {
    const fewest = activeSteps(modes({ eligibility: allQuestions("off"), references: "off", interview: "off" }));
    expect(fewest.filter((s) => !STEP_IDS.includes(s))).toEqual([]);
    expect(fewest).toContain("contact");
    expect(fewest).toContain("review");
    expect(fewest).toHaveLength(18);
  });

  it("goes on to the next screen that applies, and back to the one before it", () => {
    const m = modes({ references: "off" });
    expect(nextStep("lead-best", m)).toBe("review");
    expect(previousStep("review", m)).toBe("lead-best");
    expect(nextStep("lead-best")).toBe("ref1");
    expect(previousStep("review")).toBe("ref2");
    const noQuestions = modes({ eligibility: allQuestions("off") });
    expect(previousStep("contact", noQuestions)).toBeNull();
    expect(previousStep("contact")).toBe("eligibility");
    expect(nextStep("review", m)).toBe("review");
  });

  it("with every step asked, moves exactly as it always did", () => {
    for (const [i, step] of STEP_IDS.entries()) {
      expect(nextStep(step)).toBe(STEP_IDS[Math.min(i + 1, STEP_IDS.length - 1)]);
      expect(previousStep(step)).toBe(i > 0 ? STEP_IDS[i - 1] : null);
      expect(resolveStep(step)).toBe(step);
      expect(shieldFills(step, DEFAULT_MODES)).toEqual(shieldFills(step));
      expect(minutesLeft(step, DEFAULT_MODES)).toBe(minutesLeft(step));
    }
  });

  it("a draft saved at a screen that no longer applies carries on at the next one", () => {
    expect(resolveStep("ref1", modes({ references: "off" }))).toBe("review");
    expect(resolveStep("ref2", modes({ references: "off" }))).toBe("review");
    expect(resolveStep("eligibility", modes({ eligibility: allQuestions("off") }))).toBe("contact");
    expect(resolveStep("ref1", modes({ references: "optional" }))).toBe("ref1");
  });

  it("fills the shield by the screens there are, so a quarter is never short and never over", () => {
    const m = modes({ references: "off", eligibility: allQuestions("off") });
    const at = (step: Parameters<typeof shieldFills>[0]) => shieldFills(step, m);
    for (const step of activeSteps(m)) {
      for (const f of at(step)) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
    expect(at("review")).toEqual([1, 1, 1, 1]);
    // The last screen before review fills the first three quarters
    const beforeReview = at("lead-best");
    expect(beforeReview[0]).toBe(1);
    expect(beforeReview[1]).toBe(1);
    expect(beforeReview[2]).toBeGreaterThan(0.8);
    // With references off the "people" quarter is only the review, so it fills at the review and not before
    expect(beforeReview[3]).toBe(0);
  });

  it("takes the time of the screens that are gone off the time left", () => {
    expect(minutesLeft("eligibility", modes({ references: "off" }))).toBeLessThan(minutesLeft("eligibility"));
    expect(timeLeftLabel("review", modes({ references: "off" }))).toBe("Under a minute left");
    expect(minutesLeft("eligibility", modes({ eligibility: allQuestions("off") }))).toBeGreaterThanOrEqual(1);
  });
});

describe("whether Continue is allowed", () => {
  const answers = (eligibility: LeaderAnswers["eligibility"]): LeaderAnswers => ({ eligibility, calling: {}, scenarios: {}, style: {}, contact: {} });
  const filled: RefereeInput = { name: "Pastor Ife", relationship: "Unit head", contact: "ife@example.org", head: true };

  it("needs every question answered when all are required, as before", () => {
    expect(canContinue("eligibility", answers({ member6: true }), {}, true)).toBe(false);
    expect(canContinue("eligibility", answers(Object.fromEntries(ELIGIBILITY_KEYS.map((k) => [k, true]))), {}, true)).toBe(true);
  });

  it("needs only the required questions, and lets an optional one be left or answered either way", () => {
    const m = modes({ eligibility: { age21: "optional", time: "optional", member6: "off" } });
    const need = requiredQuestions(m);
    expect(need).toEqual(["foundation", "serving", "safeguarding", "confidentiality"]);
    expect(askedQuestions(m)).toHaveLength(6);
    expect(optionalQuestions(m)).toEqual(["age21", "time"]);
    const base = Object.fromEntries(need.map((k) => [k, true]));
    expect(canContinue("eligibility", answers(base), {}, true, m)).toBe(true);
    expect(canContinue("eligibility", answers({ ...base, age21: false }), {}, true, m)).toBe(true);
    expect(canContinue("eligibility", answers({ ...base, foundation: undefined }), {}, true, m)).toBe(false);
  });

  it("lets references be skipped when optional, but not half filled", () => {
    const m = modes({ references: "optional" });
    expect(canContinue("ref1", answers({}), {}, true, m)).toBe(true);
    expect(canContinue("ref1", answers({}), { 1: { ...EMPTY_REFEREE } }, true, m)).toBe(true);
    expect(canContinue("ref1", answers({}), { 1: { ...EMPTY_REFEREE, name: "Ife" } }, true, m)).toBe(false);
    expect(canContinue("ref1", answers({}), { 1: filled }, true, m)).toBe(true);
    expect(canContinue("ref2", answers({}), { 2: filled }, true, m)).toBe(true);
    expect(canContinue("ref1", answers({}), {}, true)).toBe(false);
    expect(canContinue("ref1", answers({}), {}, true, modes({ references: "off" }))).toBe(true);
  });

  it("knows an empty referee", () => {
    expect(isBlankReferee(undefined)).toBe(true);
    expect(isBlankReferee(EMPTY_REFEREE)).toBe(true);
    expect(isBlankReferee({ ...EMPTY_REFEREE, head: true })).toBe(false);
    expect(isBlankReferee({ ...EMPTY_REFEREE, contact: " x " })).toBe(false);
  });
});

describe("the first thing missing from a finished application", () => {
  const complete: LeaderAnswers = {
    eligibility: Object.fromEntries(ELIGIBILITY_KEYS.map((k) => [k, true])),
    calling: {
      track: "builders",
      community: "professionals",
      goal: "step-into-a-leadership-role",
      goalRelation: "pursuing",
      goalStory: "I have been stepping into leadership at work this year.",
      why: "I want to help other people grow into what God put in them.",
      walked: "I walked with a friend through a job loss and mostly listened.",
      walkRating: 4,
      walkNote: "Steady, though I get tired in busy seasons and pray less than I want.",
      obstacles: "Work travel in the second half of the season might get in the way.",
    },
    scenarios: Object.fromEntries(["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => [id, { best: "a", worst: "b" }])) as LeaderAnswers["scenarios"],
    style: { leadBest: "connection" },
    contact: { whatsapp: "+2348031234567" },
  };
  const r1: RefereeInput = { name: "Pastor Ife", relationship: "Unit head", contact: "ife@example.org", head: true };
  const r2: RefereeInput = { name: "Ngozi Eze", relationship: "Friend", contact: "ngozi@example.org", head: false };

  it("asks for everything with every step asked, with the same words", () => {
    expect(firstProblem(complete, { 1: r1, 2: r2 })).toBeNull();
    expect(firstProblem({ ...complete, eligibility: { member6: false } }, { 1: r1, 2: r2 })).toEqual({ step: "eligibility", message: "Answer yes to all seven questions to apply." });
    expect(firstProblem(complete, {})).toEqual({ step: "ref1", message: "Add this referee." });
    expect(firstProblem(complete, { 1: { ...r1, head: false }, 2: r2 })?.message).toBe("One referee must be a pastor or unit head.");
  });

  it("only asks for the questions that are required", () => {
    const m = modes({ eligibility: { age21: "optional", member6: "off" } });
    expect(firstProblem({ ...complete, eligibility: { ...complete.eligibility, age21: false, member6: undefined } }, { 1: r1, 2: r2 }, m)).toBeNull();
    expect(firstProblem({ ...complete, eligibility: { ...complete.eligibility, time: false } }, { 1: r1, 2: r2 }, m)).toEqual({
      step: "eligibility",
      message: "Answer yes to every required question to apply.",
    });
  });

  it("asks for no referees when they are off, and checks only the ones added when optional", () => {
    expect(firstProblem(complete, {}, modes({ references: "off" }))).toBeNull();
    expect(firstProblem(complete, {}, modes({ references: "optional" }))).toBeNull();
    expect(firstProblem(complete, { 1: { ...r1, head: false } }, modes({ references: "optional" }))).toBeNull();
    expect(firstProblem(complete, { 1: { ...EMPTY_REFEREE, name: "Ife" } }, modes({ references: "optional" }))?.step).toBe("ref1");
    expect(firstProblem(complete, { 1: r1, 2: { ...r2, contact: r1.contact } }, modes({ references: "optional" }))).toEqual({
      step: "ref2",
      message: "Your two referees must be different people.",
    });
  });
});

describe("reading what the database says", () => {
  it("is every step asked when it cannot be read", () => {
    for (const bad of [null, undefined, "x", 4, [], {}, { references: "sometimes", eligibility: [] }]) {
      const m = parseModes(bad);
      expect(m.references).toBe("required");
      expect(m.interview).toBe("required");
      expect(Object.values(m.eligibility)).toEqual(Array(7).fill("required"));
    }
  });

  it("reads each position on its own, and keeps what it understands", () => {
    const m = parseModes({ eligibility: { age21: "off", time: "maybe", member6: "optional" }, references: "off", interview: "optional", sent: true });
    expect(m.eligibility.age21).toBe("off");
    expect(m.eligibility.time).toBe("required");
    expect(m.eligibility.member6).toBe("optional");
    expect(m.references).toBe("off");
    expect(m.interview).toBe("optional");
    expect(m.sent).toBe(true);
  });

  it("takes the positions now for someone who has not started", () => {
    const m = modesFromPipeline({ ...DEFAULT_PIPELINE, references: "off", eligibility: { ...DEFAULT_PIPELINE.eligibility, serving: "optional" } });
    expect(m.references).toBe("off");
    expect(m.eligibility.serving).toBe("optional");
    expect(m.sent).toBe(false);
  });

  it("combines two positions the way the database does: the more lenient, and anything unknown as required", () => {
    const all: (string | null)[] = ["required", "optional", "off", null, "nonsense"];
    const rank = (p: string | null) => (p === "off" ? 3 : p === "optional" ? 2 : 1);
    for (const a of all)
      for (const b of all) {
        const expected = rank(a) >= rank(b) ? (rank(a) === 1 ? "required" : a) : rank(b) === 1 ? "required" : b;
        expect(lenient(a, b)).toBe(expected);
      }
    expect(lenient("required", "off")).toBe("off");
    expect(lenient("optional", "required")).toBe("optional");
  });
});

describe("the tracker", () => {
  const ids = (states: ReturnType<typeof stageStates>) => states.map((s) => s.state);

  it("is the five stages it has always been with every step asked", () => {
    expect(ids(stageStates("draft", 0))).toEqual(["current", "later", "later", "later", "later"]);
    expect(ids(stageStates("submitted", 1))).toEqual(["done", "current", "current", "later", "later"]);
    expect(ids(stageStates("submitted", 2))).toEqual(["done", "done", "current", "later", "later"]);
    expect(ids(stageStates("interview_booked", 2))).toEqual(["done", "done", "done", "current", "later"]);
    expect(ids(stageStates("interviewed", 2))).toEqual(["done", "done", "done", "done", "current"]);
    expect(ids(stageStates("approved_leader", 2))).toEqual(["done", "done", "done", "done", "done"]);
    expect(stageStates("submitted", 1, DEFAULT_MODES, 2)).toEqual(stageStates("submitted", 1));
  });

  it("leaves out references and the interview when they are off", () => {
    const m = modes({ references: "off", interview: "off" });
    expect(ids(stageStates("submitted", 0, m))).toEqual(["done", "off", "current", "off", "later"]);
    expect(ids(stageStates("approved_leader", 0, m))).toEqual(["done", "off", "done", "off", "done"]);
  });

  it("waits for referees only if some were added when they are optional", () => {
    const m = modes({ references: "optional" });
    expect(stageStates("submitted", 0, m, 0)[1].state).toBe("off");
    expect(stageStates("submitted", 0, m, 1)[1].state).toBe("current");
    expect(stageStates("submitted", 1, m, 1)[1].state).toBe("done");
    expect(stageStates("draft", 0, m, 0)[1].state).toBe("later");
  });

  it("shows an optional interview only once the panel has asked for one", () => {
    const m = modes({ interview: "optional" });
    expect(stageStates("submitted", 2, m)[3].state).toBe("later");
    expect(stageStates("interview_invited", 2, m)[3].state).toBe("current");
    expect(stageStates("interviewed", 2, m)[3].state).toBe("done");
    expect(stageStates("approved_leader", 2, m)[3].state).toBe("off");
  });

  it("has a line under the stage that says how many answered, or that it is optional", () => {
    expect(stageDetails(DEFAULT_MODES, 1, 2)).toEqual({ references: "1 of 2 answered" });
    expect(stageDetails(modes({ references: "optional" }), 1, 1).references).toBe("1 of 1 answered");
    expect(stageDetails(modes({ references: "optional" }), 0, 0).references).toMatch(/^Optional/);
    expect(stageDetails(modes({ interview: "optional" }), 0, 0).interview).toBe("Only if the panel asks for one.");
    expect(stageDetails(modes({ references: "off", interview: "off" }), 0, 0)).toEqual({});
    expect(outlineDetails(DEFAULT_MODES)).toEqual({});
    expect(outlineDetails(modes({ references: "optional", interview: "optional" }))).toHaveProperty("references");
  });
});

describe("what the screens say", () => {
  it("keeps every word it has always had when every step is asked", () => {
    expect(welcomeStages().map((p) => p.title)).toEqual(["This application", "Two referees", "Panel and interview", "A pastor decides"]);
    expect(welcomeStages()[1].body).toBe("Two people who have seen you serve answer four questions about you. We send each of them their own private link. One is a pastor or unit head.");
    expect(welcomeStages()[2].body).toBe("Two reviewers read your answers. If you are invited, you have a 20-minute conversation.");
    expect(eligibilityHeading()).toEqual({
      title: "First, seven quick questions.",
      body: "Every answer needs to be yes to lead. If one is not yet, we will point you to another way to serve.",
    });
    expect(reviewFooter()).toBe(
      "After you send it, you press “Send request” for each referee and we send them a private link and a code. You never see the link. The panel reads your application while they answer. An interview invitation waits until both have.",
    );
    expect(submittedWording().body).toBe(
      "Your application is with the panel, who can start reading it now. One more step: ask each of your referees. We send them a private link and a code ourselves. Interview invitations wait until both have answered.",
    );
    expect(submittedWording().button).toBe("Ask my referees");
    expect(submittedWording(DEFAULT_MODES, true).body).toBe(
      "Your application is with us. We are reading it now, which takes a few minutes. We will message you when it is done, and then you can ask your referees. Interview invitations wait until both have answered.",
    );
    expect(submittedWording(DEFAULT_MODES, true).button).toBe("See where it stands");
    for (const status of Object.keys(STATUS_INFO)) expect(statusLine(status)).toBe(STATUS_INFO[status].line);
  });

  it("says nothing about a step that is not asked", () => {
    const m = modes({ references: "off", interview: "off" });
    expect(welcomeStages(m).map((p) => p.title)).toEqual(["This application", "Panel review", "A pastor decides"]);
    expect(reviewFooter(m)).not.toMatch(/referee|interview/i);
    expect(submittedWording(m).body).not.toMatch(/referee/i);
    expect(submittedWording(m).body).not.toMatch(/interview/i);
    expect(statusLine("submitted", m)).not.toMatch(/referee/i);
    expect(statusLine("submitted", m)).toMatch(/pastor will then decide/);
  });

  it("names the questions that are asked, and which of them are optional", () => {
    expect(eligibilityHeading(modes({ eligibility: { member6: "off", foundation: "off", serving: "off" } })).title).toBe("First, four quick questions.");
    expect(eligibilityHeading(modes({ eligibility: { member6: "off", foundation: "off", serving: "off" } })).body).toMatch(/Every answer needs to be yes/);
    expect(eligibilityHeading(modes({ eligibility: { age21: "optional" } })).body).toMatch(/marked required/);
    expect(eligibilityHeading(modes({ eligibility: allQuestions("optional") })).body).toMatch(/will not stop your application/);
    expect(eligibilityHeading(modes({ eligibility: { member6: "off", foundation: "off", serving: "off", age21: "off", time: "off", safeguarding: "off" } })).title).toBe("First, one quick question.");
  });

  it("tells an applicant with optional referees that they can skip, and one with none that nothing more is needed", () => {
    expect(submittedWording(modes({ references: "optional" }), false, false).button).toBe("See where it stands");
    expect(submittedWording(modes({ references: "optional" }), false, true).button).toBe("Ask my referees");
    expect(reviewFooter(modes({ references: "optional" }))).toMatch(/does not wait for them/);
  });
});

describe("the reminder email follows the steps", () => {
  it("is exactly the same with every step asked", () => {
    const text = ["You have {parts_left} parts left.", "Have your two referees’ names and numbers ready: each gets a private link once you send it."];
    expect(adaptParagraphs(text, "leader_application", DEFAULT_MODES)).toEqual(text);
    expect(adaptParagraphs(text, "member_form", modes({ references: "off" }))).toEqual(text);
    expect(modesOfData({ step: "why" })).toBe(DEFAULT_MODES);
  });

  it("drops the sentence about referees when they are off, and says they are optional when they are", () => {
    const text = ["A line.", "Have your two referees’ names and numbers ready: each gets a private link once you send it.", "You can speak your answers."];
    expect(adaptParagraphs(text, "leader_application", modes({ references: "off" }))).toEqual(["A line.", "You can speak your answers."]);
    const optional = adaptParagraphs(text, "leader_application", modes({ references: "optional" }));
    expect(optional[1]).toMatch(/^If you would like to add referees/);
    expect(optional).toHaveLength(3);
  });

  it("counts the screens left by the ones this application has", () => {
    const all = leaderProgress("why")!;
    const fewer = leaderProgress("why", modes({ references: "off", eligibility: allQuestions("off") }))!;
    expect(all.partsLeft).toBe(21 - STEP_IDS.indexOf("why"));
    expect(fewer.partsLeft).toBe(all.partsLeft - 2);
    expect(leaderProgress("ref1", modes({ references: "off" }))!.partsLeft).toBe(1);
    const values = fieldValues({ step: "why", modes: { references: "off", interview: "required", eligibility: {}, sent: false } }, "leader_application", "https://x.example");
    expect(values.parts_left).toBe("13");
    expect(fieldValues({ step: "why" }, "leader_application", "https://x.example").parts_left).toBe("15");
  });
});

describe("the messages to an applicant", () => {
  it("says what happens next as it always has, and leaves out a step that does not apply", () => {
    expect(receivedNext({})).toBe("Next, we read it together with your references. If everything is in order we’ll invite you to a short conversation. You’ll hear from us at each step.");
    expect(receivedNext({ refs: false })).toBe("Next, we read it. If everything is in order we’ll invite you to a short conversation. You’ll hear from us at each step.");
    expect(receivedNext({ refs_optional: true })).toMatch(/together with your references if you added any\. If everything/);
    expect(receivedNext({ interview: false })).toBe("Next, we read it together with your references, and a pastor decides. You’ll hear from us at each step.");
    expect(receivedNext({ refs: false, interview: false })).toBe("Next, we read it, and a pastor decides. You’ll hear from us at each step.");
  });

  it("has the two messages the database sends when references are not asked or are optional", () => {
    for (const key of ["leader_check_clear_open", "leader_check_clear_optional"]) {
      const def = TEMPLATES[key];
      expect(def, key).toBeDefined();
      expect(def.audience).toBe("applicant");
    }
    // and leaves the approved wording of the original alone
    const original = TEMPLATES.leader_check_clear.whatsapp({}, { site: "https://x.example", first: "Ada", link: (p: string) => `https://x.example${p}`, reply: () => null });
    expect(original.body).toBe("Hi {{1}}, your leader application has been read and the panel will take it from here. Next, please send each of your two referees their private link: {{2}} – United Tribes");
  });
});
