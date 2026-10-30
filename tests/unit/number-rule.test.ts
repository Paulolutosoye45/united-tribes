import { describe, expect, it } from "vitest";
import { contactProblem, firstProblem, normaliseWhatsapp, type Answers } from "@/lib/intake/answers";
import { canContinue } from "@/lib/intake/steps";
import { parseContactForm } from "@/lib/messaging/contact";
import { NUMBER_RULE_OFF, NUMBER_WORDS, looksMadeUp, parseNumberGaps, parseNumberRule, showNumber } from "@/lib/messaging/number-rule";

// WhatsApp that cannot fail quietly, stage 3: the compulsory WhatsApp number. What these prove:
//   * Off (the default), every check about the number is exactly what it was
//   * On: an adult must give a number, and a made-up number is refused, in the form, at the step and at the end; a teenager is never asked
//   * saying yes to WhatsApp stays separate from giving a number
//   * what the screens read from the database is read defensively, and anything unclear means Off
//   * the sentences say what is needed and why, and never include a person's whole number except to that person

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

describe("a made-up number", () => {
  it("is a number whose last seven digits are one digit repeated, however it was written", () => {
    for (const bad of ["+2348111111111", "0811 111 1111", "+234 803 3333333", "+12222222222", "+2340000000000"]) expect(looksMadeUp(normaliseWhatsapp(bad) ?? bad), bad).toBe(true);
  });

  it("is not a real number that merely repeats a few digits, and is not an empty one", () => {
    for (const good of ["+2348033335555", "+2347011222233", "+2348031234567", "+447700900123"]) expect(looksMadeUp(good), good).toBe(false);
    expect(looksMadeUp("")).toBe(false);
    expect(looksMadeUp(null)).toBe(false);
    expect(looksMadeUp(undefined)).toBe(false);
    expect(looksMadeUp("123")).toBe(false);
  });
});

describe("Off: nothing about the number changes", () => {
  it("lets a form with no number through, and a number kept for the leader", () => {
    expect(firstProblem(complete())).toBeNull();
    expect(firstProblem({ ...complete(), phone: "0803 123 4567" })).toBeNull();
    expect(contactProblem({})).toBeNull();
    expect(contactProblem({ phone: "0811 111 1111" })).toBeNull();
    expect(canContinue("contact", {})).toBe(true);
    expect(canContinue("contact", {}, { numberRequired: false })).toBe(true);
  });

  it("keeps the old checks on a number's shape and on the channels", () => {
    expect(contactProblem({ phone: "12345" })).toMatch(/doesn't look right/);
    expect(contactProblem({ whatsappOk: true })).toMatch(/Add your phone number/);
    expect(contactProblem({ emailOk: false })).toMatch(/at least one way/);
  });

  it("lets the profile form through with no number", () => {
    const form = new FormData();
    form.set("email", "on");
    form.set("preferred", "email");
    expect(parseContactForm(form)).toMatchObject({ ok: true });
  });
});

describe("On: an adult must give a number that is not made up", () => {
  it("refuses a form with no number, naming the contact step", () => {
    expect(firstProblem(complete(), { numberRequired: true })).toEqual({ step: "contact", message: NUMBER_WORDS.missing });
    expect(firstProblem({ ...complete(), phone: "   " }, { numberRequired: true })?.step).toBe("contact");
  });

  it("refuses a made-up number, and a number that is not a number", () => {
    expect(firstProblem({ ...complete(), phone: "0811 111 1111" }, { numberRequired: true })).toEqual({ step: "contact", message: NUMBER_WORDS.madeUp });
    expect(firstProblem({ ...complete(), phone: "nope" }, { numberRequired: true })?.message).toMatch(/doesn't look right/);
  });

  it("lets a real number through with every channel declined", () => {
    expect(firstProblem({ ...complete(), phone: "0803 123 4567" }, { numberRequired: true })).toBeNull();
    expect(firstProblem({ ...complete(), phone: "0803 123 4567", whatsappOk: false, smsOk: false, emailOk: true }, { numberRequired: true })).toBeNull();
    // yes to WhatsApp is its own yes, and still needs the number it needs
    expect(firstProblem({ ...complete(), phone: "0803 123 4567", whatsappOk: true }, { numberRequired: true })).toBeNull();
  });

  it("holds the contact step: no Continue without a good number", () => {
    expect(canContinue("contact", {}, { numberRequired: true })).toBe(false);
    expect(canContinue("contact", { phone: "0811 111 1111" }, { numberRequired: true })).toBe(false);
    expect(canContinue("contact", { phone: "0803 123 4567" }, { numberRequired: true })).toBe(true);
    expect(canContinue("contact", { phone: "0803 123 4567", emailOk: false }, { numberRequired: true })).toBe(false); // the old channel rule still holds
  });

  it("never asks a teenager", () => {
    const teen = { ...complete(), ageRange: "13-17" };
    expect(firstProblem(teen, { teensOpen: true, numberRequired: true })).toBeNull();
    expect(canContinue("contact", { ageRange: "13-17" }, { numberRequired: true })).toBe(true);
    expect(contactProblem({}, { required: false })).toBeNull();
  });

  it("says what is needed in the profile form too", () => {
    const form = new FormData();
    form.set("email", "on");
    form.set("preferred", "email");
    expect(parseContactForm(form, { required: true })).toEqual({ ok: false, message: NUMBER_WORDS.missing });
    form.set("phone", "0811 111 1111");
    expect(parseContactForm(form, { required: true })).toEqual({ ok: false, message: NUMBER_WORDS.madeUp });
    form.set("phone", "0803 123 4567");
    expect(parseContactForm(form, { required: true })).toMatchObject({ ok: true, value: { phone: "+2348031234567", whatsapp: false } });
  });
});

describe("what the screens read", () => {
  it("is Off for anything that is not clearly the database's answer", () => {
    for (const odd of [null, undefined, 3, "on", [], {}, { on: false, required: true, prompt: true }, { on: "true" }]) expect(parseNumberRule(odd)).toEqual(NUMBER_RULE_OFF);
  });

  it("reads the rule", () => {
    expect(parseNumberRule({ on: true, required: true, prompt: true, mismatch: null })).toEqual({ on: true, required: true, prompt: true, mismatch: null });
    // a prompt never shows to someone it is not required of
    expect(parseNumberRule({ on: true, required: false, prompt: true })).toMatchObject({ prompt: false });
    expect(parseNumberRule({ on: true, required: true, prompt: false, mismatch: { signin: "+2349012345678", contact: "+2348031234567" } }).mismatch).toEqual({
      signin: "+2349012345678",
      contact: "+2348031234567",
    });
    // half a mismatch is none
    expect(parseNumberRule({ on: true, required: true, mismatch: { signin: "+2349012345678" } }).mismatch).toBeNull();
  });

  it("reads the leader's list", () => {
    expect(parseNumberGaps(null)).toEqual({ on: false, count: 0, names: [] });
    expect(parseNumberGaps({ on: false, count: 4, names: ["Ada"] })).toEqual({ on: false, count: 0, names: [] });
    expect(parseNumberGaps({ on: true, count: 2, names: ["Bola", "Chidi", 7, ""] })).toEqual({ on: true, count: 2, names: ["Bola", "Chidi"] });
    expect(parseNumberGaps({ on: true, count: -3, names: [] })).toEqual({ on: true, count: 0, names: [] });
  });
});

describe("the words", () => {
  it("shows a Nigerian number the way people say it, and any other as given", () => {
    expect(showNumber("+2348031234567")).toBe("+234 803 123 4567");
    expect(showNumber("+447700900123")).toBe("+447700900123");
    expect(NUMBER_WORDS.showBack("+2348031234567")).toBe("We’ll use +234 803 123 4567");
  });

  it("explains why the number is needed and what the leader sees, in plain words", () => {
    expect(NUMBER_WORDS.explain).toMatch(/reach you about your tribe/);
    expect(NUMBER_WORDS.explain).toMatch(/only if you choose WhatsApp/);
    expect(NUMBER_WORDS.missing).toMatch(/WhatsApp number/);
  });

  it("names both numbers to the person, and says which is which", () => {
    const line = NUMBER_WORDS.mismatch("+2349012345678", "+2348031234567");
    expect(line).toContain("+234 901 234 5678");
    expect(line).toContain("+234 803 123 4567");
    expect(line).toMatch(/sign in with/);
    expect(line).toMatch(/message you on/);
  });

  it("tells a leader how many have none, by first name only, and nothing when everyone has one", () => {
    expect(NUMBER_WORDS.leaderNote(0, [])).toBeNull();
    expect(NUMBER_WORDS.leaderNote(1, ["Bola"])).toBe("1 person in your tribe has not added a phone number yet: Bola. You can ask them in person.");
    expect(NUMBER_WORDS.leaderNote(2, ["Bola", "Chidi"])).toMatch(/^2 people in your tribe have not added a phone number yet: Bola, Chidi\./);
    // a long list is counted, not recited
    expect(NUMBER_WORDS.leaderNote(6, ["A", "B", "C", "D", "E", "F"])).toBe("6 people in your tribe have not added a phone number yet. You can ask them in person.");
  });
});
