import { describe, expect, it } from "vitest";
import { LIMITS, firstName, missingFields, storyForCard, type CardValues } from "@/lib/academy/card";
import { SAFEGUARDING_PROMISES, SAFEGUARDING_VERSION } from "@/lib/academy/declaration";
import { DAYS, checklist, clockLabel, dayName, meetingLine, nextAction, shieldFills, timesFor } from "@/lib/academy/options";
import type { CertState, MyAcademy, ModuleSummary } from "@/lib/academy/types";

const state = (over: Partial<CertState> = {}): CertState => ({
  modules_total: 6,
  modules_passed: 0,
  modules_done: false,
  declaration: false,
  practice: false,
  card_required: true,
  card: false,
  certified: false,
  ...over,
});

const modules = (passed: number, opened = passed): ModuleSummary[] =>
  Array.from({ length: 6 }, (_, i) => ({
    slug: `m${i + 1}`,
    number: i + 1,
    title: `Module ${i + 1}`,
    outcome: "",
    format: "30 min online",
    minutes: 30,
    opened: i < opened,
    attempts: i < passed ? 1 : 0,
    best: i < passed ? 100 : null,
    passed: i < passed,
  }));

const academy = (over: Partial<MyAcademy> = {}): MyAcademy => ({
  is_leader: true,
  pass_mark: 80,
  modules: modules(0),
  sessions: [],
  attended: { practice_workshop: false, commissioning_workshop: false },
  declaration: null,
  practice: null,
  card: null,
  state: state(),
  certified_at: null,
  ...over,
});

const card = (over: Partial<CardValues> = {}): CardValues => ({
  name: "Tola’s Tribe",
  circle_type: "mixed",
  track: "builders",
  tribe: "professionals",
  goal: "step-into-a-leadership-role",
  story: "I was passed over twice before I learned to lead by serving, and I want to help you.",
  meeting_day: 3,
  meeting_time: "20:00",
  mode: "online",
  zone: "mainland",
  place_note: "",
  capacity: 12,
  god: "Read the week’s passage five days a week.",
  others: "Pray for our triad weekly, and call anyone who misses.",
  life: "Each of us completes 10 of 12 weekly steps.",
  ...over,
});

describe("clock and day labels", () => {
  it("writes times the same way on every server", () => {
    expect(clockLabel("20:00")).toBe("8:00 pm");
    expect(clockLabel("07:30")).toBe("7:30 am");
    expect(clockLabel("12:00")).toBe("12:00 pm");
    expect(clockLabel("00:30")).toBe("12:30 am");
    expect(clockLabel("20:00:00")).toBe("8:00 pm");
    expect(clockLabel("")).toBe("");
    expect(clockLabel(null)).toBe("");
  });

  it("names days from Sunday = 0 and shows the week from Monday", () => {
    expect(dayName(0)).toBe("Sunday");
    expect(dayName(3)).toBe("Wednesday");
    expect(dayName(null)).toBe("");
    expect(DAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(meetingLine(3, "20:00")).toBe("Wednesdays at 8:00 pm");
    expect(meetingLine(null, "20:00")).toBeNull();
  });

  it("offers only the times members can make", () => {
    expect(timesFor(3)[0]).toBe("19:30");
    expect(timesFor(3).at(-1)).toBe("21:30");
    expect(timesFor(6)[0]).toBe("07:00");
    expect(timesFor(6).at(-1)).toBe("11:30");
    expect(timesFor(0)[0]).toBe("13:00");
    expect(timesFor(0).at(-1)).toBe("21:30");
    expect(timesFor(null)).toEqual([]);
    for (const day of [1, 2, 3, 4, 5]) expect(timesFor(day).every((t) => t >= "19:30" && t <= "21:30")).toBe(true);
  });
});

describe("the certification checklist", () => {
  it("has four conditions for a leader and three for an assistant", () => {
    expect(checklist(academy()).map((r) => r.id)).toEqual(["modules", "declaration", "practice", "card"]);
    expect(checklist(academy({ state: state({ card_required: false }) })).map((r) => r.id)).toEqual(["modules", "declaration", "practice"]);
  });

  it("reports each condition honestly", () => {
    const rows = checklist(academy({ state: state({ modules_passed: 4, declaration: true }), card: { id: "x", status: "submitted", role: "leader" } }));
    expect(rows.map((r) => r.done)).toEqual([false, true, false, false]);
    expect(rows[0].detail).toBe("4 of 6 passed");
    expect(rows[3].detail).toBe("With the pastorate");
  });

  it("shows a coach’s ‘not yet’ so the leader knows where they stand", () => {
    const rows = checklist(academy({ practice: { ready: false, format: "co_lead", note: "Keep time.", assessed_at: "2026-11-20T10:00:00Z" } }));
    expect(rows[2].done).toBe(false);
    expect(rows[2].detail).toMatch(/Not yet/);
  });

  it("fills the shield one quarter per condition, and completes it for an assistant with no card", () => {
    expect(shieldFills(academy({ state: state({ modules_passed: 3 }) }))).toEqual([0.5, 0, 0, 0]);
    expect(shieldFills(academy({ state: state({ modules_passed: 6, modules_done: true, declaration: true, practice: true, card: true }) }))).toEqual([1, 1, 1, 1]);
    expect(shieldFills(academy({ state: state({ card_required: false, modules_passed: 6, modules_done: true, declaration: true, practice: true }) }))).toEqual([1, 1, 1, 1]);
    expect(shieldFills(academy({ state: state({ modules_total: 0 }) }))[0]).toBe(0);
  });
});

describe("what to do next", () => {
  it("starts with the first module not yet passed", () => {
    const a = nextAction(academy({ modules: modules(0, 0) }));
    expect(a.href).toBe("/lead/academy/m1");
    expect(a.title).toBe("Start module 1");
    const b = nextAction(academy({ modules: modules(2, 3), state: state({ modules_passed: 2 }) }));
    expect(b.href).toBe("/lead/academy/m3");
    expect(b.title).toBe("Carry on with module 3");
  });

  it("moves on to the declaration, then workshops, then the card", () => {
    const done = { modules: modules(6), state: state({ modules_passed: 6, modules_done: true }) };
    expect(nextAction(academy(done)).href).toBe("/lead/academy/declaration");
    const signed = { ...done, state: { ...done.state, declaration: true } };
    expect(nextAction(academy(signed)).href).toBe("/lead/academy#workshops");
    const practised = { ...signed, state: { ...signed.state, practice: true } };
    expect(nextAction(academy(practised)).href).toBe("/lead/circle");
    // An assistant has no card to finish.
    const assistant = { ...practised, state: { ...practised.state, card_required: false } };
    expect(nextAction(academy(assistant)).title).toBe("Nearly there");
  });

  it("says a booked workshop is booked", () => {
    const base = { modules: modules(6), state: state({ modules_passed: 6, modules_done: true, declaration: true }) };
    const booked = nextAction(
      academy({
        ...base,
        sessions: [{ id: "s", kind: "practice_workshop", starts_at: "2026-12-01T10:00:00Z", minutes: 120, mode: "online", place: "x", seats_left: 3, booked: true, can_cancel: true }],
      }),
    );
    expect(booked.title).toBe("Your workshop is booked");
  });

  it("thanks a certified leader, and points a leader without a published card to it", () => {
    const certified = state({ modules_passed: 6, modules_done: true, declaration: true, practice: true, card: true, certified: true });
    expect(nextAction(academy({ state: certified, card: { id: "x", status: "approved", role: "leader" } })).title).toBe("You are certified.");
    expect(nextAction(academy({ state: { ...certified, card: false }, card: { id: "x", status: "changes_requested", role: "leader" } })).href).toBe("/lead/circle");
  });
});

describe("the Tribe Card", () => {
  it("is complete when everything is filled in", () => {
    expect(missingFields(card())).toEqual([]);
  });

  it("names what is missing, in the order the page asks for it", () => {
    expect(missingFields(card({ name: "ab", track: "", tribe: "", goal: "", story: "short", meeting_day: null, meeting_time: "", mode: "", zone: "", god: "", others: "", life: "" }))).toEqual([
      "name",
      "track",
      "tribe",
      "goal",
      "story",
      "time",
      "mode",
      "zone",
      "god",
      "others",
      "life",
    ]);
  });

  it("holds a story to forty characters and a Success Picture line to fifteen", () => {
    expect(missingFields(card({ story: "x".repeat(LIMITS.story.min - 1) }))).toEqual(["story"]);
    expect(missingFields(card({ story: "x".repeat(LIMITS.story.min) }))).toEqual([]);
    expect(missingFields(card({ life: "x".repeat(LIMITS.line.min - 1) }))).toEqual(["life"]);
    expect(missingFields(card({ life: "  short   " }))).toEqual(["life"]);
  });

  it("refuses a time that is not on offer that day", () => {
    expect(missingFields(card({ meeting_day: 3, meeting_time: "07:00" }))).toEqual(["time"]);
    expect(missingFields(card({ meeting_day: 6, meeting_time: "15:00" }))).toEqual(["time"]);
    expect(missingFields(card({ meeting_day: 6, meeting_time: "09:00" }))).toEqual([]);
    expect(missingFields(card({ meeting_day: 0, meeting_time: "14:00" }))).toEqual([]);
  });

  it("takes the first name for the preview", () => {
    expect(firstName("Tola Adeyemi")).toBe("Tola");
    expect(firstName("  Chinedu  Okafor  ")).toBe("Chinedu");
    expect(firstName(null)).toBe("");
  });

  it("cuts a long application story at a full stop", () => {
    const long = `${"I came to this goal late and slowly. ".repeat(12)}The end.`;
    const cut = storyForCard(long);
    expect(cut.length).toBeLessThanOrEqual(LIMITS.story.max);
    expect(cut.endsWith(".")).toBe(true);
    expect(storyForCard("Short and sweet.")).toBe("Short and sweet.");
    expect(storyForCard("  tidy \n  spaces  ")).toBe("tidy spaces");
    expect(storyForCard(null)).toBe("");
    const noStops = storyForCard("word ".repeat(100));
    expect(noStops.length).toBeLessThanOrEqual(LIMITS.story.max + 1);
    expect(noStops.endsWith("…")).toBe(true);
  });
});

describe("the safeguarding declaration", () => {
  it("has eight promises and a version the database records", () => {
    expect(SAFEGUARDING_PROMISES).toHaveLength(8);
    expect(SAFEGUARDING_VERSION).toMatch(/^[A-Za-z0-9._-]{1,24}$/);
    expect(SAFEGUARDING_PROMISES.join(" ")).toMatch(/never promise a member secrecy/);
    expect(SAFEGUARDING_PROMISES.join(" ")).toMatch(/Care Lead the same day/);
  });
});
