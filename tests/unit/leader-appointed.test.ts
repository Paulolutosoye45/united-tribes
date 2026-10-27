import { describe, expect, it } from "vitest";
import type { AcademyModes } from "@/lib/academy/modes";
import { REQUIRED_MODES } from "@/lib/academy/modes";
import { appointedLine, appointedSteps, appointedTitle, parseMyAppointment, trainingFinished, type MyAppointment } from "@/lib/leaders/appointed";

// What the Lead page says to a leader the church appointed. They have no application, so these words are the whole story.

const modes = (academy: AcademyModes["academy"], declaration: AcademyModes["declaration"]): AcademyModes => ({ academy, declaration, academySince: null, declarationSince: null });
const appt = (o: Partial<MyAppointment> = {}): MyAppointment => ({ tribeName: "Ada’s Professionals tribe", tribeStatus: "draft", certified: false, ...o });

describe("reading what the database gives", () => {
  it("reads the three things, and nothing else", () => {
    expect(parseMyAppointment({ tribe_name: "Ada’s Professionals tribe", tribe_status: "submitted", certified: true, appointed_by: "x", note: "y" })).toEqual({
      tribeName: "Ada’s Professionals tribe",
      tribeStatus: "submitted",
      certified: true,
    });
  });

  it("is null when there is nothing, or the answer is not an object, and never throws", () => {
    for (const raw of [null, undefined, "x", 3, [], true]) expect(parseMyAppointment(raw)).toBeNull();
  });

  it("treats a missing or odd tribe as no tribe, and anything but true as not certified", () => {
    expect(parseMyAppointment({})).toEqual({ tribeName: null, tribeStatus: null, certified: false });
    expect(parseMyAppointment({ tribe_name: "  ", tribe_status: "closed", certified: "yes" })).toEqual({ tribeName: null, tribeStatus: null, certified: false });
    expect(parseMyAppointment({ tribe_name: "x".repeat(121) })?.tribeName).toBeNull();
  });
});

describe("the heading", () => {
  it("names the tribe when it has a name", () => {
    expect(appointedTitle(appt())).toBe("You have been appointed to lead Ada’s Professionals tribe.");
    expect(appointedTitle(appt({ tribeName: null }))).toBe("You have been appointed to lead.");
  });
});

describe("the sentence under it", () => {
  it("follows the Academy and declaration switches in the words the approval line uses", () => {
    const intro = "Welcome. You have been appointed to lead, so there is no application to complete.";
    expect(appointedLine(appt(), REQUIRED_MODES)).toBe(`${intro} Leader training is next.`);
    expect(appointedLine(appt(), modes("optional", "required"))).toBe(`${intro} Leader training is optional, and there is a short safeguarding declaration to sign.`);
    expect(appointedLine(appt(), modes("optional", "off"))).toBe(`${intro} Leader training is optional.`);
    expect(appointedLine(appt(), modes("off", "required"))).toBe(`${intro} A short safeguarding declaration is next.`);
    expect(appointedLine(appt(), modes("off", "off"))).toBe(`${intro} Your Tribe Card is next.`);
  });

  it("moves on as the leader does", () => {
    expect(appointedLine(appt(), REQUIRED_MODES, true)).toMatch(/^Your training is done\. Your Tribe Card is next, and a pastor approves it/);
    expect(appointedLine(appt({ tribeStatus: "approved" }))).toBe("Your Tribe Card is approved. Members can find your tribe once you are certified.");
    expect(appointedLine(appt({ tribeStatus: "approved", certified: true }))).toBe("Your Tribe Card is approved and you are certified, so members can find your tribe.");
    expect(appointedLine(appt({ certified: true }))).toMatch(/^You are certified\. Your Tribe Card is next/);
  });

  it("does not claim training is done when there is no training to do", () => {
    expect(appointedLine(appt(), modes("off", "off"), true)).toMatch(/Your Tribe Card is next\.$/);
    expect(appointedLine(appt(), modes("off", "off"), true)).not.toMatch(/training is done/);
  });
});

describe("the steps", () => {
  const states = (a: MyAppointment, m: AcademyModes = REQUIRED_MODES, done = false) => Object.fromEntries(appointedSteps(a, m, done).map((s) => [s.id, s.state]));

  it("starts with appointed done, training and the card in hand, and members waiting", () => {
    expect(states(appt())).toEqual({ appointed: "done", training: "current", card: "current", open: "later" });
  });

  it("marks training done when it is finished or they are certified, and opens to members only when both are done", () => {
    expect(states(appt(), REQUIRED_MODES, true)).toEqual({ appointed: "done", training: "done", card: "current", open: "later" });
    expect(states(appt({ tribeStatus: "approved" }), REQUIRED_MODES, true)).toMatchObject({ card: "done", open: "later" });
    expect(states(appt({ tribeStatus: "approved", certified: true }))).toEqual({ appointed: "done", training: "done", card: "done", open: "done" });
  });

  it("leaves training out when none is asked for, and calls it the declaration when only that is", () => {
    expect(states(appt(), modes("off", "off")).training).toBe("off");
    expect(appointedSteps(appt(), modes("off", "required")).find((s) => s.id === "training")?.label).toBe("Safeguarding declaration");
    expect(appointedSteps(appt(), REQUIRED_MODES).find((s) => s.id === "training")?.label).toBe("Leader training");
  });

  it("says in words where the card stands", () => {
    const blurb = (status: MyAppointment["tribeStatus"]) => appointedSteps(appt({ tribeStatus: status }), REQUIRED_MODES).find((s) => s.id === "card")?.blurb;
    expect(blurb("draft")).toMatch(/Started for you/);
    expect(blurb(null)).toMatch(/Started for you/);
    expect(blurb("submitted")).toMatch(/With a pastor/);
    expect(blurb("changes_requested")).toMatch(/asked for changes/);
    expect(blurb("approved")).toBe("Approved by a pastor.");
  });
});

describe("what finishing the training means", () => {
  const done = { modules_done: true, declaration: true, practice: true };
  it("needs every part that is asked for, and only those", () => {
    expect(trainingFinished(done)).toBe(true);
    expect(trainingFinished({ ...done, practice: false })).toBe(false);
    expect(trainingFinished({ modules_done: false, declaration: true, practice: false, modules_needed: false, practice_needed: false })).toBe(true);
    expect(trainingFinished({ modules_done: true, declaration: false, practice: true }, modes("required", "required"))).toBe(false);
  });

  it("is never true when there is no training to do", () => {
    expect(trainingFinished(done, modes("off", "off"))).toBe(false);
  });
});

describe("the words never name who appointed them", () => {
  it("says nothing of an administrator, an owner, a pastor having chosen them, or approval by anyone yet", () => {
    const all = [appointedTitle(appt()), ...[REQUIRED_MODES, modes("optional", "off"), modes("off", "off")].flatMap((m) => [false, true].flatMap((d) => [appt(), appt({ tribeStatus: "approved" }), appt({ certified: true })].flatMap((a) => [appointedLine(a, m, d), ...appointedSteps(a, m, d).flatMap((s) => [s.label, s.blurb])])))].join("\n");
    expect(all).not.toMatch(/administrator|owner|appointed by|chose you|God/i);
    // They have not been approved through an application, and the page must not say they were
    expect(all).not.toMatch(/Approved as a leader|your application (is|was) approved/i);
  });
});
