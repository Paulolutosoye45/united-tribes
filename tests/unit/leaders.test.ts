import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_ANSWERS,
  charsToGo,
  contactLooksReal,
  firstProblem,
  hasText,
  normalisedContact,
  parseLeaderAnswers,
  refereeProblem,
  withNormalisedContact,
  type LeaderAnswers,
  type RefereeInput,
} from "@/lib/leaders/answers";
import { friendly, isUuid } from "@/lib/leaders/errors";
import {
  CALLING_RUBRIC,
  ELIGIBILITY,
  ELIGIBILITY_ADVICE,
  ELIGIBILITY_IDS,
  INTERVIEW_RUBRIC,
  REVIEW_STATUS,
  STAGES,
  STATUS_INFO,
} from "@/lib/leaders/options";
import { OPTION_IDS, SCENARIOS, SCENARIO_IDS, shuffled } from "@/lib/leaders/scenarios";
import { IN_REVIEW, refereeMessage, salutation, stageStates, whatsappLink } from "@/lib/leaders/status";
import { STEP_IDS, SECTIONS, canContinue, minutesLeft, nextStep, previousStep, sectionOf, shieldFills, timeLeftLabel } from "@/lib/leaders/steps";

const ok = "I have been stepping into leadership at work this year and I am still learning how.";

function complete(): LeaderAnswers {
  return {
    eligibility: Object.fromEntries(ELIGIBILITY_IDS.map((id) => [id, true])),
    contact: { whatsapp: "0803 123 4567" },
    calling: {
      track: "builders",
      tribe: "professionals",
      goal: "step-into-a-leadership-role",
      goalRelation: "pursuing",
      goalStory: ok,
      why: ok,
      walked: ok,
      walkRating: 4,
      walkNote: ok,
      obstacles: ok,
    },
    scenarios: Object.fromEntries(SCENARIO_IDS.map((id) => [id, { best: "a", worst: "b" }])),
    style: { leadBest: "connection" },
  };
}

const ref = (over: Partial<RefereeInput> = {}): RefereeInput => ({
  name: "Pastor Ife",
  relationship: "Unit head",
  contact: "0803 000 1111",
  head: true,
  ...over,
});

describe("the six situations", () => {
  it("each has four distinct responses, a to d", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([...SCENARIO_IDS]);
    for (const s of SCENARIOS) {
      expect(s.options.map((o) => o.id).sort()).toEqual([...OPTION_IDS]);
      expect(new Set(s.options.map((o) => o.text)).size).toBe(4);
    }
  });

  it("matches the answer key in the migration, which has one clearly best and one clearly worst each", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261020000100_leaders.sql"), "utf8");
    const block = sql.slice(sql.indexOf("insert into public.scenario_keys"), sql.indexOf("-- Interview times"));
    const rows = [...block.matchAll(/\('(s\d)', '([a-d])', (\d)\)/g)].map((m) => ({ s: m[1], o: m[2], r: Number(m[3]) }));
    expect(rows).toHaveLength(SCENARIOS.length * 4);
    for (const s of SCENARIOS) {
      const mine = rows.filter((r) => r.s === s.id);
      expect(mine.map((r) => r.o).sort()).toEqual(["a", "b", "c", "d"]);
      expect(mine.filter((r) => r.r === 4)).toHaveLength(1);
      expect(mine.filter((r) => r.r === 1)).toHaveLength(1);
    }
  });

  it("shuffles the same way for the same person and differently for others", () => {
    const items = ["a", "b", "c", "d"];
    expect(shuffled(items, "x:s1")).toEqual(shuffled(items, "x:s1"));
    expect(shuffled(items, "x:s1").sort()).toEqual(items);
    const orders = new Set(Array.from({ length: 30 }, (_, i) => shuffled(items, `person-${i}:s1`).join("")));
    expect(orders.size).toBeGreaterThan(6);
    expect(items).toEqual(["a", "b", "c", "d"]); // the input is untouched
  });
});

describe("wording that must stay complete", () => {
  it("has advice for every eligibility check and a label for every status", () => {
    for (const e of ELIGIBILITY) expect(ELIGIBILITY_ADVICE[e.id].length).toBeGreaterThan(30);
    for (const s of ["draft", "ineligible", "submitted", "interview_invited", "interview_booked", "interviewed", "approved_leader", "approved_assistant", "not_approved"]) {
      expect(STATUS_INFO[s].label).toBeTruthy();
    }
    for (const s of ["submitted", "interview_invited", "interview_booked", "interviewed", "approved_leader", "approved_assistant", "not_approved"]) {
      expect(REVIEW_STATUS[s].label).toBeTruthy();
    }
    expect(STAGES).toHaveLength(5);
  });

  it("has a rubric for the six calling questions and the five interview questions", () => {
    expect(CALLING_RUBRIC.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    expect(INTERVIEW_RUBRIC.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    for (const q of [...CALLING_RUBRIC, ...INTERVIEW_RUBRIC]) {
      expect(q.low && q.mid && q.high && q.looksAt).toBeTruthy();
    }
  });

  it("gives the ids the database expects", () => {
    expect([...ELIGIBILITY_IDS]).toEqual(["member6", "foundation", "serving", "age21", "time", "safeguarding", "confidentiality"]);
    expect(SECTIONS.flatMap((s) => s.steps)).toEqual([...STEP_IDS]);
    // The database stores the step name, and only allows lower case, digits and hyphens.
    for (const id of STEP_IDS) expect(id).toMatch(/^[a-z0-9-]{1,24}$/);
  });
});

describe("reading a saved draft", () => {
  it("returns empty sections for anything that is not an object", () => {
    for (const bad of [null, undefined, "x", 12, [], true]) expect(parseLeaderAnswers(bad)).toEqual(EMPTY_ANSWERS);
  });

  it("keeps good fields and drops bad ones one by one", () => {
    const got = parseLeaderAnswers({
      eligibility: { member6: true, foundation: "yes", nonsense: true },
      calling: { track: "builders", walkRating: 9, goalRelation: "pursuing", why: 42, tribe: "Not A Slug" },
      scenarios: { s1: { best: "b", worst: "z" }, s9: { best: "a" } },
      style: { styleSocial: 1, styleStructure: 7, leadBest: "doing" },
      contact: { whatsapp: "  0803 123 4567 " },
    });
    expect(got.eligibility).toEqual({ member6: true });
    expect(got.calling).toEqual({ track: "builders", goalRelation: "pursuing" });
    expect(got.scenarios).toEqual({ s1: { best: "b" } });
    expect(got.style).toEqual({ styleSocial: 1, leadBest: "doing" });
    expect(got.contact).toEqual({ whatsapp: "0803 123 4567" });
  });

  it("does not let a section that is the wrong type spoil the others", () => {
    const got = parseLeaderAnswers({ eligibility: "all", calling: { track: "rising" } });
    expect(got.eligibility).toEqual({});
    expect(got.calling).toEqual({ track: "rising" });
  });
});

describe("written answers", () => {
  it("count once they say something real, matching the database's 20 characters", () => {
    expect(hasText("too short")).toBe(false);
    expect(hasText("   padded with spaces only   ".padEnd(5))).toBe(true);
    expect(hasText("x".repeat(19))).toBe(false);
    expect(hasText("x".repeat(20))).toBe(true);
    expect(charsToGo("abc")).toBe(17);
    expect(charsToGo(undefined)).toBe(20);
    expect(charsToGo(ok)).toBe(0);
  });
});

describe("referees", () => {
  it("asks for a name, how they know you, and a way to reach them", () => {
    expect(refereeProblem(ref())).toBeNull();
    expect(refereeProblem(undefined)).toMatch(/Add this referee/);
    expect(refereeProblem(ref({ name: "A" }))).toMatch(/name/);
    expect(refereeProblem(ref({ relationship: "" }))).toMatch(/how you know/i);
    expect(refereeProblem(ref({ contact: "soon" }))).toMatch(/phone number or email/);
  });

  it("accepts Nigerian numbers, international numbers and emails as contacts", () => {
    for (const good of ["0803 123 4567", "+2348031234567", "+44 7700 900123", "ife@church.org", "08031234567"]) {
      expect(contactLooksReal(good), good).toBe(true);
    }
    for (const bad of ["", "abc", "12", "ife@", "@church.org"]) expect(contactLooksReal(bad), bad).toBe(false);
  });

  it("sees the same person written two ways", () => {
    expect(normalisedContact("0803 123 4567")).toBe(normalisedContact("+234 803 123 4567"));
    expect(normalisedContact(" Ife@Church.org ")).toBe("ife@church.org");
    expect(normalisedContact("0803 123 4567")).not.toBe(normalisedContact("0803 123 4568"));
  });

  it("saves the WhatsApp number in international form, which the database requires", () => {
    const typed = { ...EMPTY_ANSWERS, contact: { whatsapp: "0803 123 4567" } };
    expect(withNormalisedContact(typed).contact.whatsapp).toBe("+2348031234567");
    // already in order: the same object comes back
    const done = { ...EMPTY_ANSWERS, contact: { whatsapp: "+2348031234567" } };
    expect(withNormalisedContact(done)).toBe(done);
    // not a full number yet: left as typed
    const partial = { ...EMPTY_ANSWERS, contact: { whatsapp: "0803" } };
    expect(withNormalisedContact(partial).contact.whatsapp).toBe("0803");
    // nothing typed: left alone
    expect(withNormalisedContact(EMPTY_ANSWERS)).toBe(EMPTY_ANSWERS);
  });
});

describe("the finished application", () => {
  const refs = { 1: ref(), 2: ref({ name: "Sister Bola", contact: "bola@example.org", head: false }) };

  it("passes when everything is there", () => {
    expect(firstProblem(complete(), refs)).toBeNull();
  });

  it("names the first thing missing, in the order the form asks", () => {
    const a = complete();
    expect(firstProblem({ ...a, eligibility: { ...a.eligibility, age21: false } }, refs)?.step).toBe("eligibility");
    expect(firstProblem({ ...a, contact: { whatsapp: "123" } }, refs)?.step).toBe("contact");
    expect(firstProblem({ ...a, calling: { ...a.calling, track: undefined } }, refs)?.step).toBe("track");
    expect(firstProblem({ ...a, calling: { ...a.calling, goal: undefined } }, refs)?.step).toBe("goal");
    expect(firstProblem({ ...a, calling: { ...a.calling, goal: undefined, goalOther: "Start a ministry" } }, refs)).toBeNull();
    expect(firstProblem({ ...a, calling: { ...a.calling, goalRelation: undefined } }, refs)?.step).toBe("goal");
    expect(firstProblem({ ...a, calling: { ...a.calling, goalStory: "short" } }, refs)?.step).toBe("goal-story");
    expect(firstProblem({ ...a, calling: { ...a.calling, obstacles: "" } }, refs)?.step).toBe("obstacles");
    expect(firstProblem({ ...a, scenarios: { ...a.scenarios, s4: { best: "a", worst: "a" } } }, refs)?.step).toBe("s4");
    expect(firstProblem({ ...a, style: {} }, refs)?.step).toBe("lead-best");
    expect(firstProblem(a, { 1: refs[1] })?.step).toBe("ref2");
  });

  it("insists on two different referees, one of them a pastor or unit head", () => {
    const a = complete();
    expect(firstProblem(a, { 1: refs[1], 2: { ...refs[2], contact: "+234 803 000 1111" } })?.message).toMatch(/different people/);
    expect(firstProblem(a, { 1: { ...refs[1], head: false }, 2: refs[2] })?.message).toMatch(/pastor or unit head/);
  });
});

describe("moving through the form", () => {
  it("allows Continue only when the screen is answered", () => {
    const empty = structuredClone(EMPTY_ANSWERS);
    const full = complete();
    for (const step of STEP_IDS) {
      if (step === "style") continue; // the this-or-that taps are optional
      expect(canContinue(step, empty, {}, false), `${step} empty`).toBe(false);
    }
    for (const step of STEP_IDS.filter((s) => s !== "ref1" && s !== "ref2" && s !== "review")) {
      expect(canContinue(step, full, {}, false), `${step} full`).toBe(true);
    }
    expect(canContinue("ref1", full, { 1: ref() }, false)).toBe(true);
    expect(canContinue("ref2", full, { 1: ref() }, false)).toBe(false);
    expect(canContinue("review", full, {}, false)).toBe(false);
    expect(canContinue("review", full, {}, true)).toBe(true);
  });

  it("needs a different worst response from the best, and a not-yet means the form is not allowed to go on", () => {
    const a = complete();
    expect(canContinue("s1", { ...a, scenarios: { s1: { best: "b", worst: "b" } } }, {}, false)).toBe(false);
    expect(canContinue("s1", { ...a, scenarios: { s1: { best: "b" } } }, {}, false)).toBe(false);
    expect(canContinue("s1", { ...a, scenarios: { s1: { best: "b", worst: "d" } } }, {}, false)).toBe(true);
    expect(canContinue("walk", { ...a, calling: { ...a.calling, walkRating: undefined } }, {}, false)).toBe(false);
  });

  it("walks the steps in order and fills the shield by section", () => {
    expect(previousStep("eligibility")).toBeNull();
    expect(nextStep("eligibility")).toBe("contact");
    expect(nextStep("review")).toBe("review");
    expect(sectionOf("eligibility")).toBe(0);
    expect(sectionOf("s3")).toBe(2);
    expect(sectionOf("ref2")).toBe(3);
    expect(shieldFills("welcome")).toEqual([0, 0, 0, 0]);
    expect(shieldFills("done")).toEqual([1, 1, 1, 1]);
    const mid = shieldFills("s1");
    expect(mid[0]).toBe(1);
    expect(mid[1]).toBe(1);
    expect(mid[2]).toBe(0);
    expect(shieldFills("eligibility")[0]).toBeGreaterThan(0);
  });

  it("is honest about time: writing takes longer than tapping", () => {
    expect(minutesLeft("eligibility")).toBeGreaterThanOrEqual(10);
    expect(minutesLeft("review")).toBe(1);
    expect(minutesLeft("goal-story")).toBeLessThan(minutesLeft("eligibility"));
    expect(timeLeftLabel("review")).toBe("Under a minute left");
    expect(timeLeftLabel("eligibility")).toMatch(/^About \d+ minutes left$/);
  });
});

describe("the applicant's tracker", () => {
  const states = (status: string, refs = 0) => Object.fromEntries(stageStates(status, refs).map((s) => [s.id, s.state]));

  it("starts at the application and moves to the panel and referees once sent", () => {
    expect(states("draft")).toMatchObject({ apply: "current", references: "later", review: "later", interview: "later", decision: "later" });
    expect(states("submitted", 0)).toMatchObject({ apply: "done", references: "current", review: "current", interview: "later" });
    expect(states("submitted", 2)).toMatchObject({ references: "done", review: "current" });
  });

  it("moves through the interview to the decision", () => {
    expect(states("interview_invited", 2)).toMatchObject({ review: "done", interview: "current", decision: "later" });
    expect(states("interview_booked", 2)).toMatchObject({ interview: "current" });
    expect(states("interviewed", 2)).toMatchObject({ interview: "done", decision: "current" });
    expect(states("approved_leader", 2)).toMatchObject({ interview: "done", decision: "done" });
    expect(states("not_approved", 1)).toMatchObject({ decision: "done" });
  });

  it("knows which statuses are in review", () => {
    expect([...IN_REVIEW]).toEqual(["submitted", "interview_invited", "interview_booked", "interviewed"]);
  });
});

describe("what we hand a referee", () => {
  it("writes a polite message with the link in it", () => {
    const text = refereeMessage("Pastor Ife Adeyemi", "https://x.test/reference/abc");
    expect(text).toContain("Hello Pastor Ife,");
    expect(text).toContain("https://x.test/reference/abc");
    expect(refereeMessage("", "u")).toContain("Hello there,");
  });

  it("greets people the way a Nigerian church would, keeping the title", () => {
    expect(salutation("Pastor Ife Adeyemi")).toBe("Pastor Ife");
    expect(salutation("Funmi Balogun")).toBe("Funmi");
    expect(salutation("Dr. Tunde Bello")).toBe("Dr Tunde");
    expect(salutation("Deaconess Okafor")).toBe("Deaconess Okafor");
    expect(salutation("Pastor")).toBe("Pastor");
    expect(salutation("  ")).toBe("there");
  });

  it("opens the referee's own chat when we have their number, or lets the sender pick", () => {
    expect(whatsappLink("+2348031234567", "hi there")).toBe("https://wa.me/2348031234567?text=hi%20there");
    expect(whatsappLink(null, "hi")).toBe("https://wa.me/?text=hi");
  });
});

describe("error messages", () => {
  it("shows the readable reasons the database raises, and nothing technical", () => {
    expect(friendly({ code: "22023", message: "Add both referees" })).toBe("Add both referees.");
    expect(friendly({ code: "P0002", message: "Application not found" })).toBe("Application not found.");
    expect(friendly({ code: "22023", message: "One referee must be a pastor or unit head." })).toBe("One referee must be a pastor or unit head.");
    expect(friendly({ code: "57014", message: "canceling statement due to statement timeout" })).toMatch(/couldn’t save/);
    expect(friendly({ code: "22023", message: "x".repeat(400) })).toMatch(/couldn’t save/);
    expect(friendly(null)).toMatch(/couldn’t save/);
  });

  it("checks ids before they go near a query", () => {
    expect(isUuid("5b3b6f66-7d7c-4b0e-9b9e-0d0a3c1d2e3f")).toBe(true);
    for (const bad of ["", "abc", "5b3b6f66-7d7c-4b0e-9b9e", "'; drop table x;--", null, 12]) expect(isUuid(bad)).toBe(false);
  });
});
