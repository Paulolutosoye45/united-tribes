import { describe, expect, it } from "vitest";
import { buildExport } from "@/lib/privacy/export";
import { parseOfficeAsked, parseOfficeAsks, parsePage, parseSaved, parseStillRight } from "@/lib/profile/parse";
import { DETAIL_KEYS, STORY_KEYS } from "@/lib/profile/types";
import { APPLICANT_WORDS, CLASS_WORDS, OFFICE, SAVED_WORDS, SAVE_FAILURES, STILL_RIGHT, monthDay } from "@/lib/profile/wording";
import { STATUS_INFO } from "@/lib/leaders/options";

// Profiles stage 2 as the website reads it: what the database says about More facts, My story, role panels, the office ask and "Still right?", read
// defensively, and the words of those parts.

const base = { enabled: true, first: "Eze", facts: [] };
const text = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, question: "Q", kind: "text", class: "A", value: null, valueLabel: null, at: null, options: [], max: 40, limit: null, ...extra });

describe("My page as the database now sends it", () => {
  it("reads a page from a database that has only stage 1 as having nothing more", () => {
    expect(parsePage(base)).toEqual({ enabled: true, first: "Eze", facts: [], details: [], story: [], panels: [], canAsk: false, office: null });
  });

  it("reads each typed fact and each line of the story, in the order sent, with how it is asked", () => {
    const page = parsePage({
      ...base,
      details: [
        text("preferred_name", { value: "Ezinne", valueLabel: "Ezinne", at: "2027-01-02T09:00:00Z" }),
        text("area", { kind: "choice", class: "B", value: "mainland", valueLabel: "Lagos Mainland", max: null, options: [{ value: "mainland", label: "Lagos Mainland", detail: "Yaba" }, { value: 4 }] }),
        text("birthday", { kind: "monthday", value: "03-14", valueLabel: "14 March", max: null }),
      ],
      story: [text("about_me", { max: 140 }), text("gifts", { kind: "gifts", max: null, limit: 3, options: [{ value: "prayer", label: "Prayer", detail: "Ephesians 6:18" }] })],
    });
    if (!page.enabled) throw new Error("expected My page to be enabled");
    expect(page.details.map((d) => [d.key, d.kind, d.changeClass])).toEqual([["preferred_name", "text", "A"], ["area", "choice", "B"], ["birthday", "monthday", "A"]]);
    expect(page.details[0]).toMatchObject({ value: "Ezinne", max: 40, limit: null, at: "2027-01-02T09:00:00Z" });
    expect(page.details[1].options).toEqual([{ value: "mainland", label: "Lagos Mainland", detail: "Yaba" }]);
    expect(page.details[2]).toMatchObject({ value: "03-14", valueLabel: "14 March" });
    expect(page.story.map((d) => [d.key, d.kind])).toEqual([["about_me", "text"], ["gifts", "gifts"]]);
    expect(page.story[1]).toMatchObject({ limit: 3, value: "", valueLabel: "" });
  });

  it("drops a field the website does not know, a field in the wrong group and a kind it cannot draw, so a newer database never breaks an older page", () => {
    const page = parsePage({ ...base, details: [text("shoe_size"), text("about_me"), text("area", { kind: "slider" }), text("preferred_name"), "x", null], story: [text("preferred_name"), text("ask_me")] });
    if (!page.enabled) throw new Error("expected My page to be enabled");
    expect(page.details.map((d) => d.key)).toEqual(["preferred_name"]);
    expect(page.story.map((d) => d.key)).toEqual(["ask_me"]);
  });

  it("knows the same fields the database lists", () => {
    expect([...DETAIL_KEYS, ...STORY_KEYS]).toEqual(["preferred_name", "area", "birthday", "about_me", "gifts", "ask_me", "pray_for_me"]);
  });

  it("reads each panel's lines, puts words on an application's code, and keeps a link only when it is a path inside the site", () => {
    const page = parsePage({
      ...base,
      panels: [
        { key: "office", title: "Waiting for you", lines: [{ label: "Changes waiting for a pastor", value: "2" }, { label: "no value" }, { value: "no label" }], link: { label: "Open Review", path: "/review" } },
        { key: "applicant", title: "Your application to lead", lines: [{ label: "Where it stands", code: "submitted" }], link: { label: "Open", path: "https://evil.example/x" } },
        { key: "member", title: "Your season", lines: [{ label: "Your tribe", value: "Not placed yet" }], link: { label: "Open", path: "//evil.example" } },
        { key: "care", title: "Care", lines: [{ label: "a", value: "1" }], link: { label: "Open", path: "//evil" } },
        { key: "empty", title: "Nothing", lines: [] },
        { title: "no key", lines: [{ label: "a", value: "b" }] },
      ],
    });
    if (!page.enabled) throw new Error("expected My page to be enabled");
    expect(page.panels.map((p) => p.key)).toEqual(["office", "applicant", "member", "care"]);
    expect(page.panels[0].lines).toEqual([{ label: "Changes waiting for a pastor", value: "2" }]);
    expect(page.panels[0].link).toEqual({ label: "Open Review", path: "/review" });
    expect(page.panels[1].lines).toEqual([{ label: "Where it stands", value: "With the review panel" }]);
    expect(page.panels[1].link).toBeNull();
    expect(page.panels[2].link).toBeNull();
    expect(page.panels[3].link).toBeNull();
  });

  it("says something plain for an application code it has no word for", () => {
    const page = parsePage({ ...base, panels: [{ key: "applicant", title: "Application", lines: [{ label: "Where it stands", code: "something_new" }] }] });
    if (!page.enabled) throw new Error("expected My page to be enabled");
    expect(page.panels[0].lines[0].value).toBe("Being looked at");
  });

  it("reads where a message to the Care Team stands, and only a state it knows", () => {
    const open = parsePage({ ...base, canAsk: true, office: { status: "open", askedAt: "2027-01-02T09:00:00Z", closedAt: null, note: null } });
    const done = parsePage({ ...base, canAsk: true, office: { status: "done", askedAt: "2027-01-02T09:00:00Z", closedAt: "2027-01-03T09:00:00Z", note: "We will call you" } });
    const odd = parsePage({ ...base, canAsk: "yes", office: { status: "lost" } });
    if (!open.enabled || !done.enabled || !odd.enabled) throw new Error("expected My page to be enabled");
    expect(open).toMatchObject({ canAsk: true, office: { status: "open", closedAt: null, note: null } });
    expect(done.office).toMatchObject({ status: "done", note: "We will call you", closedAt: "2027-01-03T09:00:00Z" });
    expect(odd).toMatchObject({ canAsk: false, office: null });
  });
});

describe("what saving, asking and putting off say back", () => {
  it("reads a save as saved or cleared, or a refusal with the database's words", () => {
    expect(parseSaved({ ok: true, outcome: "saved" })).toEqual({ ok: true, outcome: "saved" });
    expect(parseSaved({ ok: true, outcome: "cleared" })).toEqual({ ok: true, outcome: "cleared" });
    expect(parseSaved({ ok: true, outcome: "teleported" })).toEqual({ ok: false, reason: "unknown", message: null });
    expect(parseSaved({ ok: false, reason: "bad_value", message: "Choose up to three" })).toEqual({ ok: false, reason: "bad_value", message: "Choose up to three" });
    expect(parseSaved(null)).toEqual({ ok: false, reason: "unknown", message: null });
  });

  it("reads an ask as sent or refused", () => {
    expect(parseOfficeAsked({ ok: true, ask: "x" })).toEqual({ ok: true });
    expect(parseOfficeAsked({ ok: false, reason: "waiting", message: "The Care Team already has your message" })).toEqual({ ok: false, reason: "waiting", message: "The Care Team already has your message" });
    expect(parseOfficeAsked("x")).toEqual({ ok: false, reason: "unknown", message: null });
  });

  it("has words for every way a save can be refused", () => {
    for (const r of ["off", "not_applicable", "bad_value", "unknown"]) expect(SAVE_FAILURES[r].length, r).toBeGreaterThan(0);
    expect(SAVED_WORDS.saved).toBe("Saved.");
    expect(SAVED_WORDS.cleared).toBe("Cleared.");
    for (const r of ["waiting", "off", "not_applicable"]) expect(OFFICE.failures[r].length, r).toBeGreaterThan(0);
  });
});

describe("the Still right? strip", () => {
  it("is due only when the database says so and names something to ask", () => {
    expect(parseStillRight({ due: false })).toEqual({ due: false });
    expect(parseStillRight({ due: true, season: "Season 2", items: [] })).toEqual({ due: false });
    expect(parseStillRight({ due: "yes", items: [{ key: "life_stage" }] })).toEqual({ due: false });
    expect(parseStillRight(null)).toEqual({ due: false });
    const due = parseStillRight({ due: true, season: "Season 2, 2027", items: [{ key: "age_range", label: "Age range", valueLabel: "26–32", options: [{ value: "33-40", label: "33–40", detail: "Builders" }] }, { key: "shoe_size", label: "x" }, null] });
    expect(due).toEqual({ due: true, season: "Season 2, 2027", items: [{ key: "age_range", label: "Age range", valueLabel: "26–32", options: [{ value: "33-40", label: "33–40", detail: "Builders" }] }] });
  });

  it("names the season in the line above it, and has words for every end", () => {
    expect(STILL_RIGHT.line("Season 2")).toBe("A new season, Season 2, has begun. Please check that this is still true.");
    expect(STILL_RIGHT.line("")).toBe("A new season has begun. Please check that this is still true.");
    for (const k of ["heading", "yes", "change", "later", "thanks", "hidden"] as const) expect(STILL_RIGHT[k].length, k).toBeGreaterThan(0);
  });
});

describe("the Care Team's list", () => {
  it("reads each message, open or looked at, and nothing for someone who may not see it", () => {
    expect(parseOfficeAsks(null)).toBeNull();
    expect(parseOfficeAsks({ asks: [] })).toEqual([]);
    const list = parseOfficeAsks({
      asks: [
        { id: "a", status: "open", person: "Eze Test", held: "26–32", note: "I am really 16", askedAt: "2027-01-02T09:00:00Z", closedAt: null, closingNote: null },
        { id: "b", status: "done", person: "Ada", held: "33–40", note: null, askedAt: "2027-01-01T09:00:00Z", closedAt: "2027-01-02T09:00:00Z", closingNote: "We spoke" },
        { id: "c", status: "weird" },
        { person: "no id" },
      ],
    });
    expect(list?.map((a) => [a.id, a.status])).toEqual([["a", "open"], ["b", "done"], ["c", "open"]]);
    expect(list?.[0]).toMatchObject({ person: "Eze Test", held: "26–32", note: "I am really 16", closedAt: null });
    expect(list?.[1]).toMatchObject({ closingNote: "We spoke", note: null });
    expect(list?.[2]).toMatchObject({ person: "Someone", held: "", note: null });
  });
});

describe("the words of My page", () => {
  it("writes a birthday as a day and a month, and leaves anything else as given", () => {
    expect(monthDay("03-14")).toBe("14 March");
    expect(monthDay("12-01")).toBe("1 December");
    expect(monthDay("02-29")).toBe("29 February");
    expect(monthDay("13-01")).toBe("13-01");
    expect(monthDay("")).toBe("");
  });

  it("says what each class of change does", () => {
    expect(CLASS_WORDS.A).toMatch(/Saved at once/);
    expect(CLASS_WORDS.B).toMatch(/Nobody is moved/);
  });

  it("has a word for every status an application can have", () => {
    for (const k of Object.keys(STATUS_INFO)) expect(APPLICANT_WORDS[k], k).toBe(STATUS_INFO[k].label);
  });

  it("tells a person who asks the Care Team that nothing changes until someone speaks to them", () => {
    expect(OFFICE.body).toMatch(/under 18/);
    expect(OFFICE.body).toMatch(/We change nothing until someone from the Care Team has spoken to you/);
    expect(OFFICE.sent).toMatch(/Nothing about your age range has changed/);
  });
});

describe("the person's data file", () => {
  const data = { about_this_file: "About.", made_at: "2027-01-02T10:00:00Z", you: { name: "Ada" } };
  const notes = { leaderNote: "Hi" };

  it("carries what My page holds, after what the database sent and before the private notes", () => {
    const file = buildExport(data, notes, { your_story: { "About me": "Hello" }, what_you_told_the_care_team: [{ fact: "Age range" }] });
    expect(Object.keys(file)).toEqual(["about_this_file", "made_at", "you", "your_story", "what_you_told_the_care_team", "your_private_notes"]);
    expect(file.your_story).toEqual({ "About me": "Hello" });
  });

  it("is exactly what it was when there is nothing to add, when the database could not say, or when it said something odd", () => {
    const plain = buildExport(data, notes);
    expect(Object.keys(plain)).toEqual(["about_this_file", "made_at", "you", "your_private_notes"]);
    for (const odd of [null, undefined, "x", 3, [], [{ a: 1 }], {}]) expect(buildExport(data, notes, odd)).toEqual(plain);
  });

  it("never overwrites what the database put in the file, nor the explanation or the private notes", () => {
    const file = buildExport(data, notes, { you: { name: "Mallory" }, about_this_file: "Other", your_private_notes: "x", facts_you_confirmed: [{ fact: "Name" }], gone: null });
    expect(file.you).toEqual({ name: "Ada" });
    expect(file.about_this_file).toBe("About.");
    expect(file.your_private_notes).toMatchObject({ note_to_your_leader: "Hi" });
    expect(file.facts_you_confirmed).toEqual([{ fact: "Name" }]);
    expect("gone" in file).toBe(false);
  });
});
