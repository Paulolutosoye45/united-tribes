import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES } from "@/lib/guides/catalogue";
import { RELEASE_MINUTES, RELEASE_WORDS, checkRelease, clockWords, nextOpensLine, parseReleaseSettings } from "@/lib/rhythm/release";
import { isLockedGuide, type TribeGuide } from "@/lib/rhythm/types";

// Fix 8 as the website reads and says it: what the setting's reader accepts, what a leader is told about a week that has not opened, the guide of questions leaders ask,
// and the wiring that keeps the rule in the database and the screen honest.

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("reading the setting", () => {
  it("reads a full setting", () => {
    expect(parseReleaseSettings({ weekly: true, hour: 17, minute: 30, can_edit: true, changed_at: "2026-11-11T10:00:00Z", changed_by: "Mary" })).toEqual({
      weekly: true, hour: 17, minute: 30, canEdit: true, changedAt: "2026-11-11T10:00:00Z", changedBy: "Mary",
    });
  });
  it("gives nothing for anything that is not a setting, and safe numbers for odd ones", () => {
    for (const bad of [null, undefined, 3, "x", [], {}, { weekly: "yes" }]) expect(parseReleaseSettings(bad)).toBeNull();
    expect(parseReleaseSettings({ weekly: false, hour: 99, minute: 7 })).toMatchObject({ weekly: false, hour: 8, minute: 0, canEdit: false, changedAt: null, changedBy: null });
    expect(parseReleaseSettings({ weekly: true, hour: 8.5, minute: 15, changed_by: "  " })).toMatchObject({ hour: 8, minute: 15, changedBy: null });
  });
});

describe("the form's check", () => {
  it("accepts every hour and every quarter, and says what is wrong otherwise", () => {
    for (let h = 0; h <= 23; h++) for (const m of RELEASE_MINUTES) expect(checkRelease({ weekly: true, hour: String(h), minute: String(m) }).ok, `${h}:${m}`).toBe(true);
    for (const bad of ["", "24", "-1", "8.5", "eight", "08:00", "100"]) expect(checkRelease({ weekly: true, hour: bad, minute: "0" }).ok, bad).toBe(false);
    for (const bad of ["", "5", "10", "60", "x"]) expect(checkRelease({ weekly: true, hour: "8", minute: bad }).ok, bad).toBe(false);
    expect(checkRelease({ weekly: false, hour: "08", minute: "00" })).toEqual({ ok: true, value: { weekly: false, hour: 8, minute: 0 } });
  });
});

describe("the words", () => {
  it("says a time the way people say it", () => {
    expect(clockWords(0, 0)).toBe("12 am");
    expect(clockWords(8, 0)).toBe("8 am");
    expect(clockWords(12, 0)).toBe("12 pm");
    expect(clockWords(17, 30)).toBe("5:30 pm");
    expect(clockWords(23, 45)).toBe("11:45 pm");
  });

  it("tells a leader when the next week opens, in Lagos time, and says nothing when nothing is waiting", () => {
    const base = { weekly: true, open_week: 2, next_week: 3, next_opens_at: "2026-11-14T07:00:00Z" };
    expect(nextOpensLine({ release: base })).toBe("Next week's guide opens on Saturday 14 November, 8 am.");
    expect(nextOpensLine({ release: { ...base, next_opens_at: "2026-11-14T16:30:00Z" } })).toBe("Next week's guide opens on Saturday 14 November, 5:30 pm.");
    expect(nextOpensLine({ release: { ...base, weekly: false } })).toBeNull();
    expect(nextOpensLine({ release: { ...base, next_opens_at: null } })).toBeNull();
    expect(nextOpensLine({ release: null })).toBeNull();
    expect(nextOpensLine({})).toBeNull();
    expect(nextOpensLine({ release: { ...base, next_opens_at: "not a date" } })).toBeNull();
  });

  it("tells a leader a week has not opened, with the day if it is known, and never blames", () => {
    expect(RELEASE_WORDS.closedTitle(5)).toBe("Week 5 has not opened yet");
    expect(RELEASE_WORDS.closedBody(5, "Saturday 14 November, 8 am")).toMatch(/^Week 5 opens on Saturday 14 November, 8 am\./);
    expect(RELEASE_WORDS.closedBody(5, null)).toMatch(/^Week 5 is not open yet\./);
    const all = JSON.stringify(RELEASE_WORDS) + RELEASE_WORDS.onHelp(8, 0) + RELEASE_WORDS.closedBody(5, "x");
    expect(all).not.toMatch(/undefined|NaN|\[object|too early|not allowed|forbidden|denied/i);
  });

  it("knows a locked guide from an open one", () => {
    const locked: TribeGuide = { week: 4, locked: true, opens_at: null };
    expect(isLockedGuide(locked)).toBe(true);
  });
});

describe("the questions leaders ask", () => {
  const guide = GUIDES.find((g) => g.slug === "leader-questions");
  const text = JSON.stringify(guide);

  it("is in the library for leaders, with the assistant leader and the coach reading it", () => {
    expect(guide).toBeDefined();
    expect(guide?.audience).toEqual(["leader"]);
    expect(guide?.seenBy).toEqual(["assistant_leader", "coach"]);
    expect(guide?.code).toBe("L11");
  });

  it("answers the five questions, each as a question, in plain words", () => {
    const steps = guide!.parts.flatMap((p) => p.steps);
    expect(steps.map((s) => s.id)).toEqual(["finish-card", "see-members", "number-missing", "whatsapp-group", "someone-declines"]);
    for (const s of steps) {
      expect(s.title, s.id).toMatch(/\?$/);
      expect(s.do.length, s.id).toBeGreaterThanOrEqual(1);
      expect(s.do.length, s.id).toBeLessThanOrEqual(3);
    }
  });

  it("never carries a phone number, an address, a real name, or a word that blames a member", () => {
    expect(text).not.toMatch(/\b0\d{10}\b|\+234|@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\blazy\b|\bignor|\bfailed\b|did not bother/i);
  });

  it("does not promise what the church's rules do not give a leader", () => {
    const members = guide!.parts[0].steps.find((s) => s.id === "see-members")!;
    expect(members.do.join(" ")).toMatch(/places in your tribe by name/);
    const number = guide!.parts[0].steps.find((s) => s.id === "number-missing")!;
    expect(number.do.join(" ")).toMatch(/never opened/);
    expect(number.careful).toMatch(/Do not ask a member for a number the church is holding back/);
    const group = guide!.parts[1].steps.find((s) => s.id === "whatsapp-group")!;
    expect(group.careful).toMatch(/shows a member's number to everyone/);
    // the pictures are not needed: no step asks for one
    expect(guide!.parts.flatMap((p) => p.steps).some((s) => s.shot)).toBe(false);
  });
});

describe("the wiring", () => {
  it("keeps the rule in the database's leader page, hides a closed week there, and leaves the office able to read every week", () => {
    const sql = read("supabase/migrations/20270123000100_guide_release.sql");
    expect(sql).toMatch(/v_locked := not office and public\.guide_release_weekly\(\) and wk > public\.guide_open_week\(c\.season_id\);/);
    expect(sql).toMatch(/case when v_locked then jsonb_build_object\('week', wk, 'locked', true, 'opens_at'/);
    // the setting is for the office only, and an admin, a director or a pastor changes it
    expect(sql).toMatch(/array\['admin', 'director', 'pastor'\]::public\.app_role\[\]\) then\s+raise exception 'Only an admin, a director or a pastor can change this'/);
    expect(sql).toMatch(/revoke execute on function\s+public\.guide_release_weekly\(\), public\.guide_opens_at\(uuid, integer\), public\.guide_open_week\(uuid\), public\.guide_release_view\(uuid\)\s+from public, anon, authenticated;/);
  });

  it("puts the card on the Weekly guides page and the action behind the database's own check", () => {
    expect(read("src/app/(app)/admin/guides/page.tsx")).toMatch(/<GuideReleaseCard settings=\{release\} \/>/);
    const action = read("src/app/(app)/admin/guides/actions.ts");
    expect(action).toMatch(/guide_release_set/);
    expect(action).toMatch(/Number\.isInteger\(hour\) \|\| !Number\.isInteger\(minute\)/);
  });

  it("shows a closed week as a closed week, stops the arrow at the last open week, and does not draw a week's content for it", () => {
    const page = read("src/components/rhythm/LeaderWeek.tsx");
    const start = page.indexOf("if (isLockedGuide(guide))");
    const closed = page.slice(start, page.indexOf("\n  }\n", start));
    expect(closed).toMatch(/data-testid="week-closed"/);
    expect(closed).not.toMatch(/PrepPack|ConfessionCard|CommunityLayerCard|LogForm|FollowUpList/);
    expect(page).toMatch(/lastOpen !== null \? week\.week < lastOpen/);
  });
});
