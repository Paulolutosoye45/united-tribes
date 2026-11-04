import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isRole } from "@/lib/auth/roles";
import { isFeatureKey, isPosition, isScope, parseBoard, parseFound, parseLog, parseOverview, parseStates } from "@/lib/features/parse";
import { FEATURE_KEYS, POSITIONS, SCOPES, type FeatureRow, type Rule } from "@/lib/features/types";
import { MASTER_LINE, POSITION_WORDS, ROLE_FILTERS, SCOPE_WORDS, STAGE_WORDS, SUMMARY_WORDS, describeLog, describeRule, needs, positionName, roleName, rolesPhrase } from "@/lib/features/wording";

// The Switchboard as the website reads it: the database's answers are data, read defensively, and the words of the page.

const MIGRATION = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20270101000100_profiles_stage1.sql"), "utf8");
const MIGRATION_2 = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20270102000100_profiles_stage2.sql"), "utf8");

describe("the list of functions", () => {
  it("is the database's own list, in the same order", () => {
    const block = MIGRATION.slice(MIGRATION.indexOf("insert into public.feature_registry"), MIGRATION.indexOf("-- The rules, the Master pause, the log"));
    const keys = [...block.matchAll(/^\s+\('([a-z_]+)',/gm)].map((m) => m[1]);
    // stage 2 puts its four after the third row (the migration moves the rest down by four)
    const block2 = MIGRATION_2.slice(MIGRATION_2.indexOf("insert into public.feature_registry"), MIGRATION_2.indexOf("update public.feature_registry\n   set blurb"));
    const added = [...block2.matchAll(/^\s+\('([a-z_]+)',.*, (\d+)\)[,;]\s*$/gm)].sort((a, b) => Number(a[2]) - Number(b[2])).map((m) => m[1]);
    expect(added).toEqual(["my_details", "my_story", "role_panels", "still_right"]);
    // the WhatsApp and number/removal functions come after them, in the order their migrations add them (sort 22 to 29)
    const later = ["whatsapp_guard", "whatsapp_health", "number_required", "removal_requests", "whatsapp_mode", "contact_gaps", "reach_series", "tribe_note"];
    expect([...keys.slice(0, 3), ...added, ...keys.slice(3), ...later]).toEqual([...FEATURE_KEYS]);
  });

  it("has words for every position, every summary, every scope and every stage the road has", () => {
    for (const p of POSITIONS) expect(POSITION_WORDS[p].name.length, p).toBeGreaterThan(0);
    for (const s of ["off", "rehearsal", "limited", "on", "optional", "required"] as const) expect(SUMMARY_WORDS[s]).toBeTruthy();
    for (const s of SCOPES) expect(SCOPE_WORDS[s]).toBeTruthy();
    for (const n of [1, 2, 3, 4, 5, 6]) expect(STAGE_WORDS[n]).toMatch(/^Stage \d/);
    // the two groups after the profile stages are named for what they do, not numbered
    for (const n of [7, 8]) expect(STAGE_WORDS[n].length).toBeGreaterThan(10);
    expect(MASTER_LINE).toMatch(/Nothing is deleted/);
  });

  it("offers only roles the platform knows, to narrow a rule to", () => {
    for (const r of ROLE_FILTERS) expect(isRole(r), r).toBe(true);
    expect(new Set(ROLE_FILTERS).size).toBe(ROLE_FILTERS.length);
  });

  it("recognises its own names and nothing else", () => {
    expect(FEATURE_KEYS.every(isFeatureKey)).toBe(true);
    expect(isFeatureKey("my_pages")).toBe(false);
    expect(isFeatureKey(null)).toBe(false);
    expect(POSITIONS.every(isPosition)).toBe(true);
    expect(isPosition("maybe")).toBe(false);
    expect(SCOPES.every(isScope)).toBe(true);
    expect(isScope("galaxy")).toBe(false);
  });
});

describe("what a screen asks once", () => {
  it("keeps only the positions that open something, and drops names it does not know", () => {
    const out = parseStates({ my_page: "on", details_check: "rehearsal", hold_card: "required", photos: "off", visibility: "maybe", nonsense: "on", pulse: 1 });
    expect(out).toEqual({ my_page: "on", details_check: "rehearsal", hold_card: "required" });
  });

  it("reads anything unreadable as nothing, so every function is Off", () => {
    for (const bad of [null, undefined, "on", 7, [], [["my_page", "on"]]]) expect(parseStates(bad)).toEqual({});
  });
});

describe("the owner's board", () => {
  const rule = { id: "r1", scope: "community", scopeId: "c1", label: "Professionals", position: "on", roles: ["leader", 3], reason: "Trying it with the professionals", holdoutUntil: "2027-03-01", at: "2027-01-10T09:00:00Z" };

  it("reads a board, drops a function it does not know and a rule it cannot place, and keeps the rest", () => {
    const board = parseBoard({
      paused: false,
      features: [
        { key: "my_page", name: "My page", blurb: "b", stage: 1, depends: ["details_check", "mystery"], modes: ["off", "on", "bogus"], default: "off", available: true, summary: "limited", rules: [rule, { id: 3 }, { id: "r2", scope: "galaxy", position: "on" }] },
        { key: "mystery", name: "Mystery" },
        { key: "photos", name: "Photos", summary: "surprise" },
      ],
    });
    expect(board?.features.map((f) => f.key)).toEqual(["my_page", "photos"]);
    const my = board!.features[0];
    expect(my.depends).toEqual(["details_check"]);
    expect(my.modes).toEqual(["off", "on"]);
    expect(my.available).toBe(true);
    expect(my.summary).toBe("limited");
    expect(my.rules).toHaveLength(1);
    expect(my.rules[0]).toMatchObject({ id: "r1", scope: "community", label: "Professionals", position: "on", roles: ["leader"], holdoutUntil: "2027-03-01" });
    // an unknown summary reads as Off, and a function that is not marked available is not
    expect(board!.features[1]).toMatchObject({ summary: "off", available: false, stage: 1 });
  });

  it("gives nothing for an answer that is not a board", () => {
    for (const bad of [null, "x", [], {}, { paused: "no" }]) expect(parseBoard(bad)).toBeNull();
  });

  it("reads the log, line by line, and drops what has no number", () => {
    const lines = parseLog([{ id: 4, at: "2027-01-10T09:00:00Z", feature: "my_page", name: "My page", scope: "platform", label: null, from: "off", to: "on", roles: ["leader"], reason: "A good reason" }, { id: "5" }, null, { id: 6 }]);
    expect(lines.map((l) => l.id)).toEqual([4, 6]);
    expect(lines[0]).toMatchObject({ feature: "my_page", from: "off", to: "on", roles: ["leader"], reason: "A good reason", label: null });
    expect(lines[1]).toMatchObject({ feature: null, name: null, roles: [], reason: null });
    expect(parseLog("nothing")).toEqual([]);
  });

  it("reads the read-only overview the pastors and directors see, and never a name for the owner", () => {
    const o = parseOverview({ paused: true, features: [{ key: "details_check", name: "Details Check", summary: "on", available: true, depends: ["my_page"] }, { key: "x" }], log: [{ at: "t", name: "My page", from: "off", to: "on" }, null] });
    expect(o?.paused).toBe(true);
    expect(o?.features).toHaveLength(1);
    expect(o?.log).toEqual([{ at: "t", by: "an administrator", name: "My page", label: null, from: "off", to: "on", reason: null }]);
    expect(parseOverview({})).toBeNull();
  });

  it("reads a list of what a search found, and only what has an id", () => {
    expect(parseFound([{ id: "a", label: "Ada" }, { id: "b" }, { label: "no id" }, null])).toEqual([{ id: "a", label: "Ada" }, { id: "b", label: "Unnamed" }]);
    expect(parseFound(undefined)).toEqual([]);
  });
});

describe("the words of the page", () => {
  const base: Rule = { id: "r", scope: "platform", scopeId: null, label: "", position: "on", roles: [], reason: null, holdoutUntil: null, at: "" };

  it("says where a rule applies, what it says and who it reaches", () => {
    expect(describeRule(base)).toBe("The whole church: On for everyone it reaches");
    expect(describeRule({ ...base, scope: "community", label: "Professionals", roles: ["leader"], holdoutUntil: "2027-03-01" })).toBe("One community: Professionals: On for only tribe leader, one tribe in ten held back until 2027-03-01");
  });

  it("says what moved, where and why", () => {
    expect(describeLog({ name: "My page", label: null, from: "off", to: "on", roles: [], reason: null })).toBe("My page went from Off to On");
    expect(describeLog({ name: null, label: "Professionals", from: "on", to: "paused", roles: ["leader"], reason: "Something looked wrong" })).toBe("Every new function for Professionals went from On to Paused (only tribe leader). “Something looked wrong”");
    expect(positionName(null)).toBe("Off");
    expect(positionName("running")).toBe("Running");
  });

  it("names a role, with a fall-back for one it does not know", () => {
    expect(roleName("leader")).toMatch(/leader/i);
    expect(roleName("made_up_role")).toBe("made up role");
    expect(rolesPhrase([])).toBe("everyone it reaches");
  });

  it("says what a function needs first, or nothing", () => {
    const row = (depends: FeatureRow["depends"]): FeatureRow => ({ key: "details_check", name: "", blurb: "", stage: 1, depends, modes: [], default: "off", available: true, platformOnly: false, summary: "off", rules: [] });
    expect(needs(row([]), {})).toBeNull();
    expect(needs(row(["my_page"]), { my_page: "My page" })).toBe("Needs My page to be at least as open.");
    expect(needs(row(["my_page", "photos"]), {})).toBe("Needs my_page and photos to be at least as open.");
  });
});
