import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BULK_PROMISES,
  MODE_WORDS,
  PHASE_TEXT,
  PLACED_PROMISES,
  PLAN_PROMISES,
  REASON_TEXT,
  RUN_STATUS_TEXT,
  STATUS_TEXT,
  TEAM_CONTACT_LINE,
  count,
  hourText,
  pluralise,
  reasonText,
} from "@/lib/placement/wording";
import { DEFAULT_SETTINGS, MODES, parseSettings } from "@/lib/placement/types";

const sql = readFileSync(
  join(
    __dirname,
    "../../supabase/migrations/20261226000100_auto_placement.sql",
  ),
  "utf8",
);

// The screens say in a plain sentence why someone was left out. The database decides; this is only the words, and it has to cover every
// reason the database can write.

describe("the words on the Placement screens", () => {
  it("has a sentence for every reason the database can give for leaving a member out", () => {
    const poolFn = sql.slice(
      sql.indexOf("create function public.placement_pool_reason"),
      sql.indexOf(
        "create function",
        sql.indexOf("create function public.placement_pool_reason") + 10,
      ),
    );
    const pool = [...poolFn.matchAll(/return '([a-z_0-9]+)'/g)]
      .map((m) => m[1])
      .filter((c) => c !== "off");
    const others = [
      ...sql.matchAll(
        /(?:reason = |v_reason := |then )'(no_tribe|below_bar|full|too_small|removed|run_undone|chose_own|tribe_closed|tribe_changed|tribe_full)'/g,
      ),
    ].map((m) => m[1]);
    const codes = new Set([...pool, ...others, "in_grace"]);
    expect(codes.size).toBeGreaterThan(14);
    for (const code of codes) expect(REASON_TEXT[code], code).toBeDefined();
  });

  it("falls back to a kind sentence for a reason it does not know, and for none", () => {
    expect(reasonText("something_new")).toBe(REASON_TEXT.other);
    expect(reasonText(null)).toBe(REASON_TEXT.other);
    expect(reasonText("under18")).toBe(REASON_TEXT.under18);
  });

  it("never says something private about a member in a reason", () => {
    for (const [code, text] of Object.entries(REASON_TEXT)) {
      expect(text, code).not.toMatch(
        /faith|grief|care|support need|score|owner|god mode/i,
      );
      expect(text.endsWith("."), code).toBe(false); // short labels, not sentences with full stops
    }
    expect(REASON_TEXT.under18).toMatch(/never placed automatically/);
  });

  it("names every state a run and a person can be in", () => {
    for (const s of [
      "pooled",
      "counted",
      "proposed",
      "placed",
      "rehearsed",
      "unplaced",
      "skipped",
      "held",
      "removed",
      "undone",
    ])
      expect(STATUS_TEXT[s], s).toBeTruthy();
    for (const s of [
      "planning",
      "planned",
      "approved",
      "placing",
      "placed",
      "closed",
      "undone",
      "cancelled",
    ])
      expect(RUN_STATUS_TEXT[s], s).toBeTruthy();
    for (const s of ["count", "assign", "check", "ready"])
      expect(PHASE_TEXT[s], s).toBeTruthy();
    for (const m of MODES) expect(MODE_WORDS[m].name.length).toBeGreaterThan(1);
  });

  it("says before each button what it will do", () => {
    expect(PLACED_PROMISES.confirm).toMatch(/place is confirmed/);
    expect(PLACED_PROMISES.change).toMatch(/given up/);
    expect(PLACED_PROMISES.withhold).toMatch(/will not be given my email/);
  });

  it("asks for the contact consent in one sentence on the form, with the day's wait and the right to say no", () => {
    expect(TEAM_CONTACT_LINE).toMatch(/a day after/);
    expect(TEAM_CONTACT_LINE).toMatch(/say no/);
    expect(TEAM_CONTACT_LINE).toMatch(/email/);
    expect(TEAM_CONTACT_LINE).toMatch(/WhatsApp/);
  });

  it("promises on the plan and the bulk tab exactly what the database does", () => {
    const text = PLAN_PROMISES.join(" ");
    expect(text).toMatch(/Nobody under 18 is placed/);
    expect(text).toMatch(
      /undo the whole run until a tribe’s leader has been told/,
    );
    expect(BULK_PROMISES.join(" ")).toMatch(/pastor still reviews every card/);
    expect(BULK_PROMISES.join(" ")).toMatch(
      /Academy still certifies every leader/,
    );
    // …and none of them names the owner
    for (const line of [...PLAN_PROMISES, ...BULK_PROMISES])
      expect(line).not.toMatch(/god mode|owner/i);
  });

  it("writes numbers and hours by hand, the same on the server and in the browser", () => {
    expect(count(0)).toBe("0");
    expect(count(999)).toBe("999");
    expect(count(5000)).toBe("5,000");
    expect(count(1234567.6)).toBe("1,234,568");
    expect(pluralise(1, "member")).toBe("1 member");
    expect(pluralise(2, "member")).toBe("2 members");
    expect(pluralise(1200, "person", "people")).toBe("1,200 people");
    expect([0, 9, 12, 13, 19, 24].map(hourText)).toEqual([
      "12am",
      "9am",
      "12pm",
      "1pm",
      "7pm",
      "12am",
    ]);
    expect(hourText(-1)).toBe("11pm");
  });
});

describe("reading the settings the database returns", () => {
  const good = {
    mode: "on",
    grace_days: 7,
    seats_free: 1,
    min_tribe: 5,
    pace_per_hour: 100,
    send_from: 9,
    send_until: 19,
    hold_hours: 24,
    reminder_days: 5,
    floor: 60,
  };

  it("starts from the recommendations the church chose", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      mode: "off",
      graceDays: 7,
      seatsFree: 1,
      minTribe: 5,
      pacePerHour: 100,
      sendFrom: 9,
      sendUntil: 19,
      holdHours: 24,
      reminderDays: 5,
      floor: 60,
    });
  });

  it("reads a good answer field for field, and refuses one with no usable switch rather than guessing", () => {
    expect(parseSettings(good)).toEqual({ ...DEFAULT_SETTINGS, mode: "on" });
    expect(
      parseSettings({ ...good, mode: "rehearsal", pace_per_hour: 40 }),
    ).toMatchObject({ mode: "rehearsal", pacePerHour: 40 });
    for (const bad of [null, "x", 4, [], {}, { ...good, mode: "maybe" }]) {
      expect(parseSettings(bad as never), JSON.stringify(bad)).toBeNull();
    }
  });
});
