import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/messaging/render";
import { PLACEMENT_SAMPLES } from "@/lib/messaging/templates-placement";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import { IN_SEASON_PROMISES, windowLine } from "@/lib/placement/wording";
import { parseOneCheck, parseOneOptions, parseOverview, parseWindow } from "@/lib/placement/types";

const SITE = "https://unitedtribes.example";
const SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const day = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

function mail(template: string, params: Params) {
  const msg: ClaimedMessage = {
    id: "00000000-0000-4000-8000-000000000003", template, channel: "email", params, urgency: "normal", attempts: 1, reply_token: SECRET,
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
  };
  return renderEmail(msg, SITE);
}

describe("the season line on the Placement page", () => {
  it("says a season is still to start, is running with joining open, or has closed to joining", () => {
    expect(windowLine(null, null, null, day)).toBe("No season is open. ");
    const w = { name: "Season 1", started: false, week: null, weeks: 12, open: true };
    expect(windowLine(w, "2026-11-01", "2026-11-15", day)).toBe("Season 1, starting 01/11. ");
    expect(windowLine({ ...w, started: true, week: 2 }, "2026-11-01", "2026-11-15", day)).toBe(
      "Season 1 is running, in week 2 of 12. Joining is open until 15/11, so people can still be placed. ",
    );
    expect(windowLine({ ...w, started: true, week: 4, open: false }, "2026-11-01", "2026-11-15", day)).toBe(
      "Season 1 is running, in week 4 of 12. Joining closed on 15/11. Tick “place after the cut-off” to place people now anyway. ",
    );
  });

  it("lists what is different for a running season", () => {
    expect(IN_SEASON_PROMISES.length).toBe(4);
    expect(IN_SEASON_PROMISES.join(" ")).toMatch(/never held back for being small/);
    expect(IN_SEASON_PROMISES.join(" ")).toMatch(/at most once a day/);
  });
});

describe("what the database says is read, or refused", () => {
  it("reads the joining window, and refuses one without its dates", () => {
    expect(parseWindow({ name: "S1", starts_on: "2026-11-01", closes_on: "2026-11-15", started: true, week: 2, weeks: 12, open: true })).toEqual({
      name: "S1", startsOn: "2026-11-01", started: true, week: 2, weeks: 12, closesOn: "2026-11-15", open: true,
    });
    expect(parseWindow({ name: "S1" })).toBeNull();
    expect(parseWindow(null)).toBeNull();
  });

  it("reads the overview's window and the single placements in the run list, and an older database without them", () => {
    const base = {
      settings: { mode: "on", grace_days: 7, seats_free: 1, min_tribe: 5, pace_per_hour: 100, send_from: 9, send_until: 19, hold_hours: 24, reminder_days: 5, floor: 60 },
      season: { id: "11111111-1111-4111-8111-111111111111", name: "S1", starts_on: "2026-11-01" },
      supply: {},
    };
    const run = { id: "22222222-2222-4222-8222-222222222222", seq: 3, status: "placed", rehearsal: false, created_at: "2026-11-03T10:00:00Z", pool: 1, placed: 1, confirmed: 0 };
    const o = parseOverview({ ...base, window: { name: "S1", starts_on: "2026-11-01", closes_on: "2026-11-15", started: true, week: 1, weeks: 12, open: true }, runs: [{ ...run, single: true, in_season: true, note: "Asked in person" }] });
    expect(o?.window?.week).toBe(1);
    expect(o?.runs[0]).toMatchObject({ single: true, inSeason: true, note: "Asked in person" });
    const old = parseOverview({ ...base, runs: [run] });
    expect(old?.window).toBeNull();
    expect(old?.runs[0]).toMatchObject({ single: false, inSeason: false, note: null });
  });

  it("reads the check for placing one person, and drops what is not usable", () => {
    const check = parseOneCheck({
      ok: false,
      blockers: [{ code: "has_seat", text: "They already have a seat" }, { code: "x" }, 4],
      warnings: [{ code: "full", text: "This tribe is full (4 of 4)" }],
      person: { id: "11111111-1111-4111-8111-111111111111", name: "Tobi" },
      tribe: { id: "22222222-2222-4222-8222-222222222222", name: "Mid", leader: "Ngozi", active: 4, capacity: 4 },
      degree: null, label: null, window: null,
    });
    expect(check?.blockers).toEqual([{ code: "has_seat", text: "They already have a seat" }]);
    expect(check?.warnings[0].code).toBe("full");
    expect(check?.degree).toBeNull();
    expect(parseOneCheck({ ok: true })).toBeNull();
    expect(parseOneOptions([{ tribe: "bad" }, { tribe: "22222222-2222-4222-8222-222222222222", name: "Mid", leader: "N", active: 1, capacity: 12, degree: 72, label: "strong", below_floor: false }])).toHaveLength(1);
  });
});

describe("the emails of a running season", () => {
  const running = { ...PLACEMENT_SAMPLES.placement_your_tribe, in_season: true, week: 2, season: "Season 1", first_meeting_by: "2026-11-12", change_until: "2026-11-15" };

  it("tells the member the season is already under way, that the first meeting is within the week, and until when they may change", () => {
    const m = mail("placement_your_tribe", running);
    expect(m.text).toContain("Season 1 is already under way, in week 2");
    expect(m.text).toMatch(/first meeting should be within the week/);
    expect(m.text).toMatch(/until joining closes on/);
    expect(m.text).not.toMatch(/The season begins on/);
    expect(m.text).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
  });

  it("still says what it always said before the season starts", () => {
    const m = mail("placement_your_tribe", { ...PLACEMENT_SAMPLES.placement_your_tribe, in_season: false });
    expect(m.text).toMatch(/The season begins on/);
    expect(m.text).toMatch(/at any time before the season starts/);
  });

  it("says no fit when there is no score, rather than a made-up one", () => {
    const m = mail("placement_your_tribe", { ...running, fit: null });
    expect(m.text).not.toMatch(/fit for what you asked for/);
  });

  it("reminds a member in a running season until when they may change", () => {
    const m = mail("placement_reminder", { ...PLACEMENT_SAMPLES.placement_reminder, in_season: true, change_until: "2026-11-15" });
    expect(m.text).toMatch(/until joining closes on/);
  });

  it("tells a leader about new members in a running season, not a whole team", () => {
    const people = [{ name: "Tobi Running", state: "open", email: "tobi@example.org", whatsapp: null, withheld: false }];
    const m = mail("placement_your_team", { ...PLACEMENT_SAMPLES.placement_your_team, in_season: true, week: 2, members: people });
    expect(m.subject).toMatch(/^New members for /);
    expect(m.text).toMatch(/One new member has joined/);
    expect(m.text).toMatch(/the tribe is already meeting/);
  });
});
