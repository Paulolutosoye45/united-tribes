import { describe, expect, it } from "vitest";
import {
  CHIPS,
  DESK_WORDS,
  POOLS,
  SIGNAL_PARTS,
  SLOTS,
  TABS,
  chipLabel,
  describeGroup,
  isChip,
  isDeskId,
  isPool,
  isTab,
  pageOf,
  parseClusters,
  parseGroup,
  parseGroups,
  parseLeaders,
  parseOverview,
  parseRevealed,
  parseSuggestions,
  parseWaiting,
} from "@/lib/god/desk";

// The Leader Desk as the website reads it: the database's answers are data, read defensively, and the words of the page.

const ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const ID2 = "11111111-2222-3333-4444-555555555555";

describe("the lists and pools", () => {
  it("has words for each list and pool, and recognises its own names and nothing else", () => {
    for (const c of CHIPS) {
      expect(c.label.length).toBeGreaterThan(3);
      expect(c.help.length).toBeGreaterThan(10);
      expect(isChip(c.key)).toBe(true);
      expect(chipLabel(c.key)).toBe(c.label);
    }
    expect(isChip("everyone")).toBe(false);
    expect(isChip(null)).toBe(false);
    for (const p of POOLS) expect(isPool(p.key)).toBe(true);
    expect(isPool("rising")).toBe(false);
    expect(TABS.map((t) => t.key)).toEqual(["waiting", "proposals", "leaders", "sending"]);
    expect(isTab("proposals")).toBe(true);
    expect(isTab("send")).toBe(false);
    expect(isDeskId(ID)).toBe(true);
    expect(isDeskId("not-an-id")).toBe(false);
  });

  it("names the five parts of the leadership signal with the weights the database uses, adding to 100", () => {
    expect(SIGNAL_PARTS.map((p) => [p.key, p.max])).toEqual([["willingness", 30], ["walk", 25], ["reliability", 20], ["named", 15], ["progress", 10]]);
    expect(SIGNAL_PARTS.reduce((a, p) => a + p.max, 0)).toBe(100);
  });

  it("says what the signal never looks at", () => {
    expect(DESK_WORDS.signalHelp).toMatch(/never looks at gender, age, area, health, care notes or how much support/);
  });

  it("promises nothing is sent while the desk only shows", () => {
    expect(DESK_WORDS.intro).toMatch(/nothing here sends a message/i);
    expect(DESK_WORDS.rehearsalNote).toMatch(/Nothing on this page sends anything/);
  });

  it("describes a draft group in a sentence", () => {
    expect(describeGroup({ slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8 })).toBe("Weeknight evening, in person, Mainland, mixed, up to 8");
    expect(describeGroup({ slot: "sunday-evening", mode: "online", zone: null, type: "women", capacity: 6 })).toBe("Sunday evening, online, women, up to 6");
    expect(Object.keys(SLOTS)).toHaveLength(4);
  });

  it("reads a page number safely", () => {
    expect(pageOf(undefined)).toBe(1);
    expect(pageOf("3")).toBe(3);
    for (const bad of ["0", "-1", "2.5", "abc", "1001", ""]) expect(pageOf(bad), bad).toBe(1);
  });
});

describe("the overview", () => {
  it("is read from the database's numbers, with zero for anything missing, and off unless it says otherwise", () => {
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview([])).toBeNull();
    const o = parseOverview({
      mode: "rehearsal",
      season: { id: ID, name: "Season 1", starts_on: "2026-11-01", weeks: 12, week: 2 },
      waiting: { all: 9, none_shown: 4, few_shown: 2, not_chosen: 1, not_run: 2, starter: 3 },
      leaders: { ready: 2, almost: 5, members: 40 },
      drafts: 2,
      held_back: 1,
      min_tribe: 5,
      floor: 60,
      calls_open: true,
    })!;
    expect(o.mode).toBe("rehearsal");
    expect(o.season).toEqual({ id: ID, name: "Season 1", startsOn: "2026-11-01", weeks: 12, week: 2 });
    expect(o.waiting).toEqual({ all: 9, none_shown: 4, few_shown: 2, not_chosen: 1, not_run: 2, starter: 3 });
    expect(o.leaders).toEqual({ ready: 2, almost: 5, members: 40 });
    expect([o.drafts, o.heldBack, o.minTribe, o.floor, o.callsOpen]).toEqual([2, 1, 5, 60, true]);
    const empty = parseOverview({ mode: "loud", waiting: "no", leaders: 5, season: { id: "x" } })!;
    expect(empty.mode).toBe("off");
    expect(empty.season).toBeNull();
    expect(empty.waiting.all).toBe(0);
    expect(empty.minTribe).toBe(5);
    expect(empty.callsOpen).toBe(false);
  });
});

describe("waiting members", () => {
  const row = {
    person_id: ID, name: "Ada Test", chip: "none_shown", starter: true, days: 6, community: "Professionals", goal: "Lead well", zone: "mainland", mode: "either",
    times: ["weeknight-evening"], kind: "mixed", phone: "+23480 •••• 4657", has_number: true, options: 0, best: null, best_tribe: null,
    block: { code: "time", text: "No tribe meets at a time they can make" },
    drafts: [{ group_id: ID2, name: "Draft", degree: 81, fits: true }, { group_id: "bad", name: "x", degree: 1, fits: true }],
    in_draft: null, lead: { score: 71, pool: "ready" },
  };

  it("reads a row, drops a draft with no id, and keeps the number masked", () => {
    const page = parseWaiting({ total: 31, rows: [row, { person_id: "nope" }, null, "x"] });
    expect(page.total).toBe(31);
    expect(page.rows).toHaveLength(1);
    const r = page.rows[0];
    expect(r).toMatchObject({ personId: ID, name: "Ada Test", chip: "none_shown", starter: true, days: 6, phone: "+23480 •••• 4657", hasNumber: true, options: 0, best: null });
    expect(r.block).toEqual({ code: "time", text: "No tribe meets at a time they can make" });
    expect(r.drafts).toEqual([{ groupId: ID2, name: "Draft", degree: 81, fits: true }]);
    expect(r.lead).toEqual({ score: 71, pool: "ready" });
    expect(JSON.stringify(page)).not.toMatch(/\+\d{8,}/);
  });

  it("is empty for anything that is not a page", () => {
    for (const v of [null, undefined, "x", 5, []]) expect(parseWaiting(v)).toEqual({ total: 0, rows: [] });
  });
});

describe("draft groups", () => {
  const g = {
    id: ID, name: "Wednesday builders", status: "draft", note: null, track_id: ID2, track: "Builders", community_id: null, community: null, goal_id: null, goal: null,
    slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8, size: 2, average: 84,
    members: [{ person_id: ID2, name: "Bola", degree: 84, blocked: [{ code: "time", text: "They cannot make the group's time" }], phone: "+23480 •••• 4657", has_number: true }, { person_id: "x" }],
    checks: [{ code: "size", state: "wait", text: "2 of at least 5 people so far" }, { code: "fit", state: "bogus", text: "?" }],
    ready: false,
  };

  it("reads a group with its members and checks, and treats an unknown state as not yet", () => {
    const r = parseGroup(g)!;
    expect(r).toMatchObject({ id: ID, name: "Wednesday builders", slot: "weeknight-evening", mode: "in_person", zone: "mainland", capacity: 8, size: 2, average: 84, ready: false });
    expect(r.members).toHaveLength(1);
    expect(r.members[0].blocked[0].text).toMatch(/cannot make/);
    expect(r.checks.map((c) => c.state)).toEqual(["wait", "wait"]);
    expect(parseGroup({ name: "no id" })).toBeNull();
    expect(parseGroups([g, null, { id: "x" }])).toHaveLength(1);
    expect(parseGroups("nope")).toEqual([]);
  });

  it("reads the groups waiting members could fill, and the members who would suit one", () => {
    expect(parseClusters([{ track_id: ID, track: "Builders", slot: "sunday-evening", mode: "online", type: "mixed", size: 7 }, { track_id: "x", slot: "a", mode: "b", type: "c" }, null])).toEqual([
      { trackId: ID, track: "Builders", slot: "sunday-evening", mode: "online", type: "mixed", size: 7 },
    ]);
    const s = parseSuggestions([{ person_id: ID, name: "Chidi", degree: 79, watch: [{ code: "full", text: "The group is full" }], days: 3, phone: "+23480 •••• 4657", has_number: true }, { name: "no id" }]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ personId: ID, degree: 79, days: 3, hasNumber: true });
    expect(s[0].watch).toEqual([{ code: "full", text: "The group is full" }]);
  });
});

describe("possible leaders", () => {
  it("reads the pools, with the five parts and the notes in words", () => {
    const page = parseLeaders({
      total: 3,
      rows: [{ person_id: ID, name: "Ngozi", score: 96, pool: "ready", serving: "yes", faith: "established", parts: { willingness: 30, walk: 25, reliability: 18, named: 15, progress: 8 },
               notes: ["Said yes to serving", 5, "Established in faith"], tribe: "Seasoned", community: "Professionals", phone: null, has_number: false }, { person_id: "x" }],
    });
    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ score: 96, pool: "ready", parts: { willingness: 30, walk: 25, reliability: 18, named: 15, progress: 8 }, tribe: "Seasoned", hasNumber: false });
    expect(page.rows[0].notes).toEqual(["Said yes to serving", "Established in faith"]);
    expect(parseLeaders(null)).toEqual({ total: 0, rows: [] });
    expect(parseLeaders({ total: 1, rows: [{ person_id: ID, pool: "elite" }] }).rows[0].pool).toBe("members");
  });
});

describe("a full number", () => {
  it("is read only when it is an international number, and never from anything else", () => {
    expect(parseRevealed({ ok: true, number: "+2348031924657" })).toEqual({ ok: true, number: "+2348031924657" });
    expect(parseRevealed({ ok: true, number: null })).toEqual({ ok: true, number: null });
    for (const bad of ["08031924657", "+234803", "tel:+2348031924657", "+23480 3192 4657", 2348031924657, "+2348031924657; drop table"]) {
      expect(parseRevealed({ ok: true, number: bad }), String(bad)).toEqual({ ok: true, number: null });
    }
    expect(parseRevealed({ ok: false })).toBeNull();
    expect(parseRevealed(null)).toBeNull();
  });
});
