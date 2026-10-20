import { describe, expect, it } from "vitest";
import { EMPTY_ANSWERS } from "@/lib/leaders/answers";
import { FIT_WORDS, allOptions, fitInputKey, matchText, parseFitMine, parseFitView, parseSavedCalling } from "@/lib/leaders/fit";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const G3 = "33333333-3333-4333-8333-333333333333";
const G4 = "44444444-4444-4444-8444-444444444444";

const top = (id: string, title: string, degree: number, label = "strong") => ({
  goal_id: id,
  title,
  community: "Creative Economy",
  label,
  degree,
  reasons: ["You said you like to teach", "Your style suits this", "There is room for you", "a fourth that must be dropped"],
});

const view = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  run: "run-1",
  options: 12,
  shown: 2,
  top: [top(G1, "Teach a trade", 84, "excellent"), top(G2, "Open a studio", 71)],
  groups: [
    {
      community_id: "c1",
      slug: "families",
      community: "Families",
      mine: false,
      options: [
        { goal_id: G3, title: "Marriage care", label: "good", degree: 62 },
        { goal_id: G4, title: "Parents' circle", label: "stretch", note: "A pastor will talk with you about this one" },
      ],
    },
  ],
  choice: null,
  ...over,
});

describe("reading the Find your tribe screen", () => {
  it("reads a good answer", () => {
    const v = parseFitView(view());
    expect(v).not.toBeNull();
    expect(v!.run).toBe("run-1");
    expect(v!.options).toBe(12);
    expect(v!.shown).toBe(2);
    expect(v!.top.map((o) => o.title)).toEqual(["Teach a trade", "Open a studio"]);
    expect(v!.groups).toHaveLength(1);
    expect(v!.groups[0].options.map((o) => o.title)).toEqual(["Marriage care", "Parents' circle"]);
    expect(v!.choice).toBeNull();
  });

  it("keeps at most three reasons, and the group's community on each of its tribes", () => {
    const v = parseFitView(view())!;
    expect(v.top[0].reasons).toHaveLength(3);
    expect(v.groups[0].options.every((o) => o.community === "Families")).toBe(true);
  });

  it("shows a stretch as a word, never as a number", () => {
    const v = parseFitView(view({ top: [{ ...top(G1, "X", 55, "stretch") }] }))!;
    expect(v.top[0].degree).toBeNull();
    expect(matchText(v.top[0])).toBe(FIT_WORDS.stretch);
    expect(parseFitView(view())!.groups[0].options[1].degree).toBeNull();
    expect(matchText({ label: "strong", degree: 78 })).toBe("Strong match, 78%");
  });

  it("carries the note on a tribe a pastor will talk about, in plain words", () => {
    const v = parseFitView(view())!;
    expect(v.groups[0].options[1].note).toBe("A pastor will talk with you about this one");
    expect(v.groups[0].options[0].note).toBeNull();
  });

  it("never lets through anything the database should not have sent", () => {
    const sneaky = view({
      parts: { skill: 90 },
      weights: { care_bar: 70 },
      judgement: 12,
      top: [{ ...top(G1, "Teach a trade", 84), parts: { a: 1 }, care_flag: true, sensitive: true, judgement: 50, weights: {} }],
    });
    const keys = new Set<string>();
    JSON.parse(JSON.stringify(parseFitView(sneaky)), function (key) {
      if (key) keys.add(key);
      return this[key];
    });
    for (const k of ["parts", "weights", "judgement", "care_flag", "careFlag", "sensitive", "skill", "care_bar"]) expect(keys.has(k)).toBe(false);
    expect(JSON.stringify(parseFitView(sneaky))).not.toContain("care_bar");
  });

  it("reads the choice and up to two backups", () => {
    const v = parseFitView(
      view({
        choice: {
          goal_id: G1,
          title: "Teach a trade",
          community: "Creative Economy",
          backups: [
            { goal_id: G2, title: "Open a studio", community: "Creative Economy" },
            { goal_id: G3, title: "Marriage care", community: "Families" },
            { goal_id: G4, title: "A third", community: "Families" },
          ],
        },
      }),
    )!;
    expect(v.choice?.goalId).toBe(G1);
    expect(v.choice?.backups.map((b) => b.goalId)).toEqual([G2, G3]);
  });

  it("drops what is not usable and returns null when nothing is left", () => {
    expect(parseFitView(null)).toBeNull();
    expect(parseFitView("x")).toBeNull();
    expect(parseFitView([])).toBeNull();
    expect(parseFitView({ status: "no_model" })).toBeNull();
    expect(parseFitView({ status: "missing", missing: ["track"] })).toBeNull();
    expect(parseFitView(view({ top: [], groups: [] }))).toBeNull();
    // an option with a bad id, an unknown label or no title is dropped
    const v = parseFitView(
      view({
        top: [
          { ...top("not-a-uuid", "Bad id", 80) },
          { ...top(G1, "Odd label", 80, "perfect") },
          { ...top(G2, "", 80) },
          top(G3, "Fine", 80),
        ],
        groups: "nope",
      }),
    )!;
    expect(v.top.map((o) => o.title)).toEqual(["Fine"]);
    expect(v.groups).toEqual([]);
  });

  it("never throws, whatever it is given", () => {
    for (const junk of [undefined, 1, true, { status: "ok" }, { status: "ok", run: 4 }, { status: "ok", run: "r", top: [null, 3, "x"], groups: [null, { options: 5 }] }]) {
      expect(() => parseFitView(junk)).not.toThrow();
    }
  });

  it("lists every tribe once, best first", () => {
    expect(allOptions(parseFitView(view())!).map((o) => o.goalId)).toEqual([G1, G2, G3, G4]);
  });
});

describe("reading what a choice saved", () => {
  it("accepts a community and a goal", () => {
    expect(parseSavedCalling({ community: "families", goal: "marriage-care" })).toEqual({ community: "families", goal: "marriage-care" });
  });
  it("refuses anything else", () => {
    for (const bad of [null, {}, { community: "families" }, { community: "", goal: "x" }, { community: 3, goal: "x" }, []]) expect(parseSavedCalling(bad)).toBeNull();
  });
});

describe("the answers the comparison reads", () => {
  const base = () => structuredClone(EMPTY_ANSWERS);
  it("changes when a screen the comparison reads changes", () => {
    const a = base();
    const k0 = fitInputKey(a);
    const edits: ((x: ReturnType<typeof base>) => void)[] = [
      (x) => void (x.calling.track = "young-adults"),
      (x) => void (x.calling.community = "families"),
      (x) => void (x.calling.goal = "marriage-care"),
      (x) => void (x.calling.goalRelation = "pursuing"),
      (x) => void (x.style.leadBest = "teaching"),
      (x) => void (x.scenarios.s1 = { best: "a", worst: "b" } as never),
    ];
    for (const edit of edits) {
      const b = base();
      edit(b);
      expect(fitInputKey(b)).not.toBe(k0);
    }
  });

  it("does not change when a written answer, the referees' details or the contact change", () => {
    const a = base();
    const k0 = fitInputKey(a);
    a.calling.goalStory = "I would like to serve";
    a.calling.why = "Because";
    a.calling.walked = "Yes";
    a.calling.walkRating = 4;
    a.calling.walkNote = "Steady";
    a.calling.obstacles = "Time";
    a.contact.whatsapp = "+2348000000000";
    a.eligibility.age21 = true;
    expect(fitInputKey(a)).toBe(k0);
  });

  it("is the same for the same answers however the object was built", () => {
    const a = base();
    a.scenarios.s2 = { best: "a", worst: "c" } as never;
    a.scenarios.s1 = { best: "b", worst: "d" } as never;
    const b = base();
    b.scenarios.s1 = { best: "b", worst: "d" } as never;
    b.scenarios.s2 = { best: "a", worst: "c" } as never;
    expect(fitInputKey(a)).toBe(fitInputKey(b));
  });
});

describe("tribes a leader we already have could lead next", () => {
  const opt = (id: string, title: string, label: string, degree: number) => ({ goal_id: id, title, community: "Families", label, degree, reasons: ["A reason"] });
  it("reads up to three, never a stretch", () => {
    const got = parseFitMine({ status: "ok", ran_at: "2026-10-20T10:00:00Z", options: [opt(G1, "A", "excellent", 90), opt(G2, "B", "stretch", 55), opt(G3, "C", "good", 65), opt(G4, "D", "strong", 75), opt(G1, "E", "good", 61)] })!;
    expect(got.options.map((o) => o.title)).toEqual(["A", "C", "D"]);
    expect(got.options[0].reasons).toEqual(["A reason"]);
    expect(got.ranAt).toBe("2026-10-20T10:00:00Z");
  });
  it("says nothing when it is off, there is no run, or nothing can be shown", () => {
    for (const j of [{ status: "off" }, { status: "none" }, null, undefined, "x", { status: "ok" }, { status: "ok", options: [] }, { status: "ok", options: [opt(G1, "S", "stretch", 50)] }]) expect(parseFitMine(j)).toBeNull();
  });
});
