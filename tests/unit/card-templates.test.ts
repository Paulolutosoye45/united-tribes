import { describe, expect, it } from "vitest";
import {
  NOT_WRITTEN,
  SHEET_HEADER,
  TEXT_FIELDS,
  bulkEligible,
  communitySentence,
  csvCell,
  demandLine,
  demandSummary,
  editDiff,
  editProblem,
  fieldsOf,
  notWritten,
  parseReadyMade,
  parseTemplateList,
  prefillLines,
  reviewSheet,
} from "@/lib/cards/templates";

const raw = (over: Record<string, unknown> = {}) => ({
  slug: "launch-a-business",
  title: "Launch or formalise a business",
  community_id: "c1",
  community: "Business & Entrepreneurship",
  goal_id: "g1",
  goal_active: true,
  sort: 1,
  who_for: "Anyone with a business idea, or a business that runs on handshakes.",
  loving_god: "We bring our plans to God each week and start with honesty.",
  loving_others: "We test each other's ideas and cheer every first step.",
  loving_life: "By week 12 each of us has a registered or clearly planned business.",
  week12_outcome: "A registered or clearly planned business and a first sale.",
  arc: ["Write down who your first ten customers are.", "Take the next legal step: register the name.", "Set a 90-day plan with one revenue target."],
  guardrail: "Leaders do not give legal, tax or investment advice.",
  tracks: ["rising", "builders"],
  rhythm_slot: "weeknight-evening",
  rhythm_mode: "online",
  who_leads_well: "Has started a business and remembers what the first steps cost.",
  demand: { structure: 2, connection: 1, teaching: 2, doing: 0 },
  sensitive: false,
  status: "draft",
  version: 1,
  signed_off_at: null,
  signed_off_by: null,
  updated_at: "2026-10-20T00:00:00Z",
  ...over,
});

const list = (templates: unknown[] = [raw()]) => ({
  counts: { total: templates.length, draft: templates.length, signed_off: 0, retired: 0 },
  by_community: [{ community_id: "c1", slug: "business", name: "Business & Entrepreneurship", total: templates.length, signed_off: 0, draft: templates.length, retired: 0, sensitive_left: 0 }],
  templates,
});

describe("reading the list", () => {
  it("reads a card, its counts and its communities", () => {
    const l = parseTemplateList(list())!;
    expect(l.counts.total).toBe(1);
    expect(l.communities[0].name).toBe("Business & Entrepreneurship");
    expect(l.templates[0].arc).toHaveLength(3);
    expect(l.templates[0].demand.teaching).toBe(2);
    expect(l.templates[0].status).toBe("draft");
  });
  it("leaves out a card that is not in the shape, and returns null for a list that is not", () => {
    const l = parseTemplateList(list([raw(), raw({ status: "live" }), raw({ slug: "" }), null, "x"]))!;
    expect(l.templates).toHaveLength(1);
    for (const j of [null, undefined, {}, [], "x", { templates: "no" }]) expect(parseTemplateList(j)).toBeNull();
  });
  it("keeps the numbers of leading between 0 and 3", () => {
    const l = parseTemplateList(list([raw({ demand: { structure: 9, connection: -4, teaching: 2, doing: 1 } })]))!;
    expect(l.templates[0].demand).toEqual({ structure: 3, connection: 0, teaching: 2, doing: 1 });
  });
});

describe("words", () => {
  it("says what a card asks of its leader", () => {
    expect(demandLine({ structure: 2, connection: 1, teaching: 2, doing: 0 })).toBe("Structure 2, Connection 1, Teaching 2, Doing 0");
    expect(demandSummary({ structure: 2, connection: 1, teaching: 2, doing: 0 })).toBe("Asks most for structure and teaching");
    expect(demandSummary({ structure: 0, connection: 3, teaching: 0, doing: 0 })).toBe("Asks most for connection");
    expect(demandSummary({ structure: 1, connection: 1, teaching: 1, doing: 1 })).toBe("Asks most for structure, connection, teaching and doing");
    expect(demandSummary({ structure: 0, connection: 0, teaching: 0, doing: 0 })).toBe("No particular way of leading");
  });
  it("names the parts nobody has written yet", () => {
    const t = parseTemplateList(list([raw({ who_for: NOT_WRITTEN, guardrail: NOT_WRITTEN })]))!.templates[0];
    expect(notWritten(t)).toEqual(["Who it is for", "The guardrail"]);
    expect(notWritten(parseTemplateList(list())!.templates[0])).toEqual([]);
  });
  it("says what signing off a community did", () => {
    expect(communitySentence({ signed: 6, left: 0 }, "Families")).toBe("6 cards signed off in Families.");
    expect(communitySentence({ signed: 1, left: 2 }, "Families")).toBe("1 card signed off in Families. 2 sensitive cards are left for you to sign off one at a time.");
    expect(communitySentence({ signed: 0, left: 1 }, "Families")).toBe("No cards were waiting in Families. 1 sensitive card is left for you to sign off one at a time.");
  });
});

describe("signing off the rest of a community", () => {
  it("is only the drafts that are not sensitive and are fully written", () => {
    const l = parseTemplateList(
      list([
        raw({ slug: "a-card-one", title: "Card one title" }),
        raw({ slug: "a-card-two", title: "Card two title", sensitive: true }),
        raw({ slug: "a-card-three", title: "Card three title", status: "signed_off" }),
        raw({ slug: "a-card-four", title: "Card four title", who_for: NOT_WRITTEN }),
        raw({ slug: "a-card-five", title: "Card five title", community_id: "c2" }),
      ]),
    )!;
    expect(bulkEligible(l, "c1").map((t) => t.slug)).toEqual(["a-card-one"]);
    expect(bulkEligible(l, "c2").map((t) => t.slug)).toEqual(["a-card-five"]);
    expect(bulkEligible(l, "nope")).toEqual([]);
  });
});

describe("editing", () => {
  const t = parseTemplateList(list())!.templates[0];
  it("has no problem with a card as it is", () => {
    expect(editProblem(fieldsOf(t), false)).toBeNull();
  });
  it("says in words what is wrong", () => {
    const f = fieldsOf(t);
    expect(editProblem({ ...f, who_for: "short" }, false)).toBe("Who it is for needs at least 10 characters.");
    expect(editProblem({ ...f, loving_god: "x".repeat(201) }, false)).toBe("Loving God can be up to 200 characters.");
    expect(editProblem({ ...f, guardrail: NOT_WRITTEN }, false)).toBe("The guardrail has not been written yet.");
    expect(editProblem({ ...f, track_slugs: [] }, false)).toBe("Choose at least one life stage.");
    expect(editProblem({ ...f, rhythm_slot: "monday" }, false)).toBe("Choose one of the four meeting times.");
    expect(editProblem({ ...f, rhythm_mode: "phone" }, false)).toBe("Choose online or in person.");
    expect(editProblem({ ...f, demand_structure: 0, demand_connection: 0, demand_teaching: 0, demand_doing: 0 }, false)).toBe("At least one way of leading must be above 0.");
    expect(editProblem({ ...f, demand_doing: 4 }, false)).toBe("Each way of leading is a number from 0 to 3.");
    expect(editProblem({ ...f, title: "tiny" }, true)).toBe("The title must be 6 to 100 characters.");
    expect(editProblem({ ...f, title: "tiny" }, false)).toBeNull();
    expect(TEXT_FIELDS.map((x) => x.key)).toHaveLength(10);
  });
  it("sends only what changed, trimmed, and never the title of a card whose goal exists", () => {
    const f = fieldsOf(t);
    expect(editDiff(t, f, false)).toEqual({});
    expect(editDiff(t, { ...f, who_for: `  ${f.who_for}  ` }, false)).toEqual({});
    expect(editDiff(t, { ...f, guardrail: "Leaders point to a qualified professional.  ", demand_doing: 2 }, false)).toEqual({ guardrail: "Leaders point to a qualified professional.", demand_doing: 2 });
    expect(editDiff(t, { ...f, title: "A different title" }, false)).toEqual({});
    expect(editDiff(t, { ...f, title: "A different title" }, true)).toEqual({ title: "A different title" });
    expect(editDiff(t, { ...f, track_slugs: ["builders", "rising"] }, false)).toEqual({});
    expect(editDiff(t, { ...f, track_slugs: ["rising"] }, false)).toEqual({ track_slugs: ["rising"] });
    expect(editDiff(t, { ...f, sensitive: true }, false)).toEqual({ sensitive: true });
  });
});

describe("the review sheet", () => {
  it("quotes what needs it and starts with a byte order mark", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(3)).toBe("3");
    expect(csvCell("-2")).toBe("-2");
  });
  it("makes anything a spreadsheet could run as a formula plain text", () => {
    for (const bad of ["=1+1", "+44", "@SUM(A1)", "-cmd", "\tx"]) expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
  });
  it("has one row per card under the same headers, with the hidden columns marked", () => {
    const l = parseTemplateList(list([raw(), raw({ slug: "second-card", title: "Second card here", sensitive: true, goal_id: null })]))!;
    const out = reviewSheet(l);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    const lines = out.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].split(",")[0]).toBe("#");
    expect(SHEET_HEADER.filter((h) => h.startsWith("HIDDEN"))).toHaveLength(6);
    expect(lines[1].startsWith("1,Business & Entrepreneurship,Launch or formalise a business,Yes,")).toBe(true);
    expect(lines[2]).toContain(",No,");
    expect(lines[2].endsWith("Waiting for sign-off")).toBe(true);
  });
});

describe("what a leader sees of the card behind their tribe", () => {
  const pub = (over: Record<string, unknown> = {}) => ({
    title: "Launch or formalise a business",
    who_for: "Anyone with a business idea.",
    loving_god: "We bring our plans to God each week.",
    loving_others: "We test each other's ideas.",
    loving_life: "By week 12 each of us has a plan.",
    week12_outcome: "A registered or clearly planned business.",
    arc: ["One", "Two", "Three"],
    guardrail: "Leaders do not give legal advice.",
    rhythm_slot: "weeknight-evening",
    rhythm_mode: "online",
    ...over,
  });
  it("reads the public fields, and nothing the database should keep back", () => {
    const r = parseReadyMade({ ...pub(), who_leads_well: "secret", sensitive: true, demand: { structure: 3 }, demand_structure: 3 })!;
    expect(r.lovingGod).toBe("We bring our plans to God each week.");
    expect(Object.keys(r).sort()).toEqual(["arc", "guardrail", "lovingGod", "lovingLife", "lovingOthers", "mode", "slot", "title", "week12", "whoFor"]);
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("is null when there is no card or it is not complete", () => {
    for (const j of [null, undefined, "x", [], {}, pub({ arc: ["a", "b"] }), pub({ arc: ["a", "", "c"] }), pub({ loving_god: "" })]) expect(parseReadyMade(j)).toBeNull();
  });
  it("fills only the lines that are empty, never one that has anything in it", () => {
    const r = parseReadyMade(pub())!;
    expect(prefillLines({ god: "", others: "  ", life: "" }, r)).toEqual({ god: r.lovingGod, others: r.lovingOthers, life: r.lovingLife });
    expect(prefillLines({ god: "My own line", others: "", life: "Mine too" }, r)).toEqual({ god: "My own line", others: r.lovingOthers, life: "Mine too" });
    expect(prefillLines({ god: "a", others: "b", life: "c" }, r)).toEqual({ god: "a", others: "b", life: "c" });
  });
});
