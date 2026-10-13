import { describe, expect, it } from "vitest";
import {
  SEASON_MOVES,
  SEASON_STATUS,
  TARGET_GROUPS,
  TARGET_INFO,
  checkLine,
  seasonWhen,
  targetChanged,
  targetFromInput,
  targetRange,
  targetText,
  targetToInput,
  targetUnit,
  templateName,
} from "@/lib/admin/wording";
import type { CheckItem, SeasonStatus } from "@/lib/admin/types";

describe("season wording", () => {
  const today = "2026-10-12";

  it("says how long until a season starts, in days then in weeks", () => {
    expect(seasonWhen(0, 12, "2026-10-13", today)).toBe("Starts in 1 day");
    expect(seasonWhen(0, 12, "2026-10-25", today)).toBe("Starts in 13 days");
    expect(seasonWhen(0, 12, "2026-11-08", today)).toBe("Starts in 4 weeks");
    expect(seasonWhen(0, 12, "2026-10-26", today)).toBe("Starts in 2 weeks");
  });

  it("says which week a running season is in, and when it has ended", () => {
    expect(seasonWhen(1, 12, "2026-10-11", today)).toBe("Week 1 of 12");
    expect(seasonWhen(12, 12, "2026-07-26", today)).toBe("Week 12 of 12");
    expect(seasonWhen(13, 12, "2026-07-12", today)).toBe("Ended");
  });

  it("describes every status and only lets a season move forward", () => {
    const statuses: SeasonStatus[] = ["planning", "open", "running", "closed"];
    for (const s of statuses) {
      expect(SEASON_STATUS[s].label.length).toBeGreaterThan(2);
      expect(SEASON_STATUS[s].line.length).toBeGreaterThan(10);
    }
    expect(SEASON_MOVES.planning.map((m) => m.to)).toEqual(["open"]);
    expect(SEASON_MOVES.open.map((m) => m.to)).toEqual(["running", "planning"]);
    expect(SEASON_MOVES.running.map((m) => m.to)).toEqual(["closed"]);
    expect(SEASON_MOVES.closed).toEqual([]);
  });

  it("asks for confirmation only before the move that cannot be undone", () => {
    const asks = statusesWithConfirm();
    expect(asks).toEqual(["running->closed"]);
  });
});

function statusesWithConfirm() {
  const out: string[] = [];
  for (const [from, moves] of Object.entries(SEASON_MOVES)) {
    for (const m of moves) if (m.confirm) out.push(`${from}->${m.to}`);
  }
  return out;
}

describe("the launch checklist lines", () => {
  const all: CheckItem[] = [
    { key: "season", ok: true, name: "Season One", starts_on: "2026-11-01", status: "planning" },
    { key: "season", ok: false, name: null, starts_on: null, status: null },
    { key: "team", ok: true, missing: [] },
    { key: "team", ok: false, missing: ["pastor", "care_lead", "coach"] },
    { key: "words", ok: true, vision: true, mission: true },
    { key: "words", ok: false, vision: false, mission: false },
    { key: "words", ok: false, vision: true, mission: false },
    { key: "words", ok: false, vision: false, mission: true },
    { key: "guides", ok: true, reviewed: 12, of: 12 },
    { key: "guides", ok: false, reviewed: 3, of: 12 },
    { key: "tribes", ok: true, approved: 1 },
    { key: "tribes", ok: true, approved: 6 },
    { key: "tribes", ok: false, approved: 0 },
    { key: "messages", ok: true, tokens: 1, last_used_at: "2026-10-11T08:00:00Z" },
    { key: "messages", ok: true, tokens: 1, last_used_at: null },
    { key: "messages", ok: false, tokens: 0, last_used_at: null },
    { key: "messages", ok: false, tokens: 2, last_used_at: "2026-10-01T08:00:00Z" },
    { key: "champions", ok: true, covered: 8, of: 8 },
    { key: "champions", ok: false, covered: 1, of: 8 },
    { key: "testimony_form", ok: true },
    { key: "testimony_form", ok: false },
    { key: "bi", ok: true, refreshed_at: "2026-10-10T01:00:00Z" },
    { key: "bi", ok: false, refreshed_at: null },
  ];

  it("gives every item a title, a detail and a place to go, whatever the database found", () => {
    for (const item of all) {
      const line = checkLine(item);
      expect(line.title.length, JSON.stringify(item)).toBeGreaterThan(5);
      expect(line.detail.length, JSON.stringify(item)).toBeGreaterThan(10);
      expect(line.href).toMatch(/^\/(admin|review)\//);
      expect(line.roles.length).toBeGreaterThan(0);
    }
  });

  it("names the date of the planned season", () => {
    expect(checkLine(all[0]).detail).toBe("Season One, starting 1 November 2026.");
    expect(checkLine(all[1]).title).toBe("Plan the next season");
  });

  it("names the roles nobody holds in plain words", () => {
    expect(checkLine(all[3]).detail).toBe("Nobody holds the role of pastor, care lead and coach yet.");
  });

  it("says which of the church's words is still missing", () => {
    expect(checkLine(all[5]).detail).toMatch(/^Neither is written yet/);
    expect(checkLine(all[6]).detail).toMatch(/^The mission is not written yet/);
    expect(checkLine(all[7]).detail).toMatch(/^The vision is not written yet/);
  });

  it("counts guides and tribes with the right plural", () => {
    expect(checkLine(all[9]).detail).toMatch(/^3 of 12 have been read/);
    expect(checkLine(all[10]).title).toBe("1 tribe approved");
    expect(checkLine(all[11]).title).toBe("6 tribes approved");
  });

  it("tells a missing sending token from a quiet sending service", () => {
    expect(checkLine(all[15]).title).toBe("Connect the sending service");
    expect(checkLine(all[16]).title).toBe("The sending service is quiet");
    expect(checkLine(all[13]).detail).toMatch(/last seen 11 Oct 2026/);
  });

  it("says whether the sending service was never seen or has gone quiet", () => {
    const never = checkLine({ key: "messages", ok: false, tokens: 1, last_used_at: null });
    const quiet = checkLine({ key: "messages", ok: false, tokens: 1, last_used_at: "2026-10-01T08:00:00Z" });
    expect(never.detail).toMatch(/not reported in yet/);
    expect(quiet.detail).toMatch(/not been seen for two days/);
  });

  it("sends each fix to the screen that does it", () => {
    expect(checkLine(all[3]).href).toBe("/admin/people");
    expect(checkLine(all[5]).href).toBe("/admin/settings");
    expect(checkLine(all[12]).href).toBe("/review/cards");
    expect(checkLine(all[18]).href).toBe("/admin/champions");
    expect(checkLine(all[22]).href).toBe("/admin/system");
  });

  it("only offers the people screen to those who may invite", () => {
    expect(checkLine(all[3]).roles).toEqual(["admin", "director"]);
    expect(checkLine(all[2]).roles).toEqual(["admin", "director"]);
  });
});

describe("targets", () => {
  it("describes every group key and puts each key in one group only", () => {
    const seen = new Set<string>();
    for (const g of TARGET_GROUPS) {
      for (const key of g.keys) {
        expect(TARGET_INFO[key], key).toBeDefined();
        expect(seen.has(key), `${key} is listed twice`).toBe(false);
        seen.add(key);
      }
    }
    // Nothing described is left off the screen
    expect([...seen].sort()).toEqual(Object.keys(TARGET_INFO).sort());
  });

  it("shows a percentage as the number a person types", () => {
    expect(targetToInput("thriving_rate", 0.85)).toBe("85");
    expect(targetToInput("attend_share", 0.67)).toBe("67");
    expect(targetToInput("effective_thriving", 0.725)).toBe("72.5");
    expect(targetToInput("min_cell", 5)).toBe("5");
    expect(targetToInput("gain_min", 2)).toBe("2");
  });

  it("stores what was typed without floating-point crumbs", () => {
    expect(targetFromInput("thriving_rate", "85")).toBe(0.85);
    expect(targetFromInput("attend_share", "67")).toBe(0.67);
    expect(targetFromInput("effective_thriving", "72,5")).toBe(0.725);
    expect(targetFromInput("thriving_rate", "29")).toBe(0.29);
    expect(targetFromInput("thriving_rate", "57")).toBe(0.57);
    expect(targetFromInput("min_cell", " 6 ")).toBe(6);
  });

  it("refuses what is not a number", () => {
    expect(targetFromInput("thriving_rate", "")).toBeNull();
    expect(targetFromInput("thriving_rate", "   ")).toBeNull();
    expect(targetFromInput("thriving_rate", "eighty")).toBeNull();
    expect(targetFromInput("min_cell", "NaN")).toBeNull();
    expect(targetFromInput("min_cell", "Infinity")).toBeNull();
  });

  it("round-trips every default a person could type back", () => {
    for (const key of Object.keys(TARGET_INFO)) {
      for (const value of [0, 0.5, 0.85, 1, 3, 12, 90]) {
        const typed = targetToInput(key, value);
        const stored = targetFromInput(key, typed);
        expect(stored, `${key} ${value}`).not.toBeNull();
        expect(Math.abs((stored as number) - value), `${key} ${value}`).toBeLessThan(0.0051);
      }
    }
  });

  it("writes a target with its unit", () => {
    expect(targetText("thriving_rate", 0.85)).toBe("85%");
    expect(targetText("swap_weeks", 3)).toBe("3 weeks");
    expect(targetText("care_days", 5)).toBe("5 days");
    expect(targetText("assistants", 2)).toBe("2 per tribe");
    expect(targetText("min_cell", 5)).toBe("5");
    expect(targetUnit("form_minutes")).toBe("minutes");
    expect(targetUnit("thriving_rate")).toBe("%");
    expect(targetUnit("min_cell")).toBe("");
  });

  it("says one day, one week, one point and one minute in the singular", () => {
    expect(targetText("swap_weeks", 1)).toBe("1 week");
    expect(targetText("care_days", 1)).toBe("1 day");
    expect(targetText("gain_min", 1)).toBe("1 point");
    expect(targetText("form_minutes", 1)).toBe("1 minute");
    expect(targetText("swap_weeks", 2)).toBe("2 weeks");
  });

  it("writes an allowed range with the unit said once", () => {
    expect(targetRange("thriving_rate", 0.5, 1)).toBe("50% to 100%");
    expect(targetRange("gain_min", 1, 12)).toBe("1 to 12 points");
    expect(targetRange("swap_weeks", 1, 12)).toBe("1 to 12 weeks");
    expect(targetRange("min_cell", 2, 50)).toBe("2 to 50");
    expect(targetRange("assistants", 0, 5)).toBe("0 to 5 per tribe");
    expect(targetRange("care_days", 0, 1)).toBe("0 to 1 day");
  });

  it("does not count an untouched box as a change, even when the stored number has more digits than the box shows", () => {
    // Eight meetings of twelve is stored as two thirds and shown as 66.67
    const twoThirds = 8 / 12;
    expect(targetToInput("attend_share", twoThirds)).toBe("66.67");
    expect(targetChanged("attend_share", "66.67", twoThirds)).toBe(false);
    expect(targetChanged("attend_share", "70", twoThirds)).toBe(true);
    expect(targetChanged("thriving_rate", "85", 0.85)).toBe(false);
    expect(targetChanged("thriving_rate", "80", 0.85)).toBe(true);
    expect(targetChanged("thriving_rate", "", 0.85)).toBe(false);
    expect(targetChanged("thriving_rate", "abc", 0.85)).toBe(false);
    expect(targetChanged("min_cell", "6", 5)).toBe(true);
  });

  it("treats an unknown key as a plain count", () => {
    expect(targetToInput("something_new", 4)).toBe("4");
    expect(targetFromInput("something_new", "4")).toBe(4);
    expect(targetText("something_new", 4)).toBe("4");
  });
});

describe("message template names", () => {
  it("turns a template key into words", () => {
    expect(templateName("week_start")).toBe("Week start");
    expect(templateName("care_flag_alert")).toBe("Care flag alert");
    expect(templateName("welcome")).toBe("Welcome");
  });
});
