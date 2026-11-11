import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/messaging/render";
import { NOTICE_SAMPLES } from "@/lib/messaging/templates-notices";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import {
  AUTOPILOT_RANGES,
  AUTOPILOT_WORDS,
  checkAutopilotSettings,
  outcomeWords,
  parseAutopilot,
  parseAutopilotSettings,
  slotWords,
} from "@/lib/seat/autopilot";

// The seat autopilot as the website reads and says it: readers that turn anything odd into nothing, words that never blame or show a phone number, the checks the
// owner's form makes before the database is asked, and the wiring that keeps the owner's card owner-only and the office's tap behind the database's checks.

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SITE = "https://unitedtribes.example";

const GOOD = {
  role: "act",
  mode: "on",
  setting: "suggest",
  paused: false,
  bar: 70,
  until: "2026-11-25",
  plan: {
    id: "00000000-0000-4000-8000-000000000001",
    on: "2026-11-11",
    state: "planned",
    made_at: "2026-11-11T07:05:00Z",
    items: 2,
    placed: 0,
    skipped: 0,
    today: true,
    rows: [
      { person: "Ada Okafor", tribe: "Builders", degree: 82, kind: "fill", rehearsal: false, outcome: null },
      { person: "Tunde Bello", tribe: "Rise", degree: 74, kind: "open", rehearsal: false, outcome: null },
    ],
  },
  stats: {
    bench_total: 9,
    considered: 9,
    blocked_by_bar: 2,
    bar: 70,
    kinds: [{ community: "Young adults", slot: "weeknight-evening", waiting: 5, seats: 3 }],
    small: [
      {
        tribe_id: "00000000-0000-4000-8000-000000000002", name: "Rise", leader: "Ngozi", members: 3, slot: "saturday-morning", days: 12, waiting_fit: 1, hard: false, why: null,
        merge: { to: "Builders", fits: 2, of: 3, names: ["Ada", "Tunde"] },
      },
    ],
  },
};

describe("reading what the database sends", () => {
  it("reads a full overview", () => {
    const v = parseAutopilot(GOOD);
    expect(v).not.toBeNull();
    expect(v?.role).toBe("act");
    expect(v?.plan?.rows).toHaveLength(2);
    expect(v?.plan?.today).toBe(true);
    expect(v?.stats?.small[0].merge?.names).toEqual(["Ada", "Tunde"]);
    expect(v?.stats?.kinds[0]).toEqual({ community: "Young adults", slot: "weeknight-evening", waiting: 5, seats: 3 });
  });

  it("gives nothing for anything that is not an overview", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { role: "owner" }, { role: 1 }]) expect(parseAutopilot(bad)).toBeNull();
  });

  it("turns odd parts into nothing, never into a guess", () => {
    const v = parseAutopilot({ role: "look", mode: "banana", setting: "x", paused: "yes", bar: "70", until: 5, plan: { id: "p", state: "weird" }, stats: [] });
    expect(v).toEqual({ role: "look", mode: "off", setting: "suggest", paused: false, bar: 0, until: null, plan: null, stats: null });
  });

  it("drops rows and tribes that are missing the words to show them", () => {
    const v = parseAutopilot({
      ...GOOD,
      plan: { ...GOOD.plan, rows: [{ person: "", tribe: "x", degree: 1, kind: "fill" }, { person: "A", tribe: "B", degree: 70, kind: "other" }, null, 5, GOOD.plan.rows[0]] },
      stats: { ...GOOD.stats, small: [{ name: "" }, null, GOOD.stats.small[0]], kinds: [{ slot: "x" }, GOOD.stats.kinds[0]] },
    });
    expect(v?.plan?.rows).toHaveLength(1);
    expect(v?.stats?.small).toHaveLength(1);
    expect(v?.stats?.kinds).toHaveLength(1);
  });

  it("never lets a number be negative, fractional or not a number", () => {
    const v = parseAutopilot({ ...GOOD, plan: { ...GOOD.plan, items: -3, placed: 2.6, skipped: Number.NaN } });
    expect(v?.plan?.items).toBe(0);
    expect(v?.plan?.placed).toBe(3);
    expect(v?.plan?.skipped).toBe(0);
  });

  it("never reads a phone number, a note or a reason, even if one is sent", () => {
    const v = parseAutopilot({
      ...GOOD,
      plan: { ...GOOD.plan, rows: [{ ...GOOD.plan.rows[0], phone: "0803ZZPHONE", note: "ZZNOTE", reason: "ZZREASON", email: "zz@example.org" }] },
    });
    const dump = JSON.stringify(v);
    for (const secret of ["ZZPHONE", "ZZNOTE", "ZZREASON", "zz@example.org"]) expect(dump).not.toContain(secret);
  });

  it("reads the owner's numbers and refuses what is not a settings object", () => {
    expect(parseAutopilotSettings({ mode: "auto", bar: 75, per_tribe_day: 3, day_cap: 30, extra_days: 5, small_days: 12, paused: true })).toEqual({
      mode: "auto", bar: 75, perTribeDay: 3, dayCap: 30, extraDays: 5, smallDays: 12, paused: true,
    });
    for (const bad of [null, {}, "x", { bar: "70" }]) expect(parseAutopilotSettings(bad)).toBeNull();
    expect(parseAutopilotSettings({ bar: 70, mode: "weird" })?.mode).toBe("suggest");
  });
});

describe("the words", () => {
  it("says every outcome in plain words and never shows a raw code", () => {
    for (const o of ["placed", "skipped:full", "skipped:not_eligible", "skipped:no_longer_fits", "skipped:tribe_closed", "skipped:day_limit", "skipped:tribe_day_limit"]) {
      expect(outcomeWords(o)).not.toMatch(/skipped:|_/);
      expect(outcomeWords(o).length).toBeGreaterThan(3);
    }
    expect(outcomeWords("failed: some database text")).toBe("Not placed: the placement was refused");
    expect(outcomeWords("failed: some database text")).not.toContain("database");
    expect(outcomeWords("something new")).toBe("Not placed");
    expect(outcomeWords(null)).toBe("");
  });

  it("says each meeting time in words, and an unknown one without dashes", () => {
    expect(slotWords("weeknight-evening")).toBe("weeknight evening");
    expect(slotWords("any")).toBe("any time");
    expect(slotWords("late-night-owls")).toBe("late night owls");
  });

  it("counts people and placements with the right number", () => {
    expect(AUTOPILOT_WORDS.ready(1)).toMatch(/^1 placement is ready/);
    expect(AUTOPILOT_WORDS.ready(3)).toMatch(/^3 placements are ready/);
    expect(AUTOPILOT_WORDS.placed(1, 0)).toBe("1 person placed.");
    expect(AUTOPILOT_WORDS.placed(4, 2)).toBe("4 people placed, 2 skipped (the list says why).");
    expect(AUTOPILOT_WORDS.benchTotal(1)).toBe("1 person is waiting for a seat.");
    expect(AUTOPILOT_WORDS.members(1)).toBe("1 member");
    expect(AUTOPILOT_WORDS.openFor(1)).toBe("1 day open");
    expect(AUTOPILOT_WORDS.kinds(2, "Young adults", "any", 0)).toContain("no seats open");
    expect(AUTOPILOT_WORDS.kinds(2, "Young adults", "any", 1)).toContain("1 seat open");
  });

  it("never blames anyone, never shows a phone number, and never promises what it does not do", () => {
    const all = JSON.stringify(AUTOPILOT_WORDS) + [0, 1, 4].map((n) => AUTOPILOT_WORDS.ready(n)).join("");
    expect(all).not.toMatch(/ignor|did not read|didn't read|lazy|failed to|your fault|\b0\d{10}\b|\+234/i);
    // it says Undo and the same email, because that is true of every placement it makes
    expect(AUTOPILOT_WORDS.ready(2)).toMatch(/same email and the same Undo/);
    // a plan nobody places runs out, and says so
    expect(AUTOPILOT_WORDS.ready(2)).toMatch(/runs out at midnight/);
    // the hard-to-fill reasons are about the tribe and the timing, never about a person
    for (const w of ["nobody", "time", "format", "fit"] as const) expect(AUTOPILOT_WORDS.hardWhy(w)).toMatch(/^Nobody/);
    expect(AUTOPILOT_WORDS.hardWhy(null)).toMatch(/^Nobody/);
  });
});

describe("the owner's form", () => {
  const ok = { mode: "suggest", bar: "70", perTribe: "2", dayCap: "25", extra: "7", small: "10", reason: "Starting the week" };

  it("accepts the defaults with a reason", () => {
    const r = checkAutopilotSettings(ok);
    expect(r).toEqual({ ok: true, value: { mode: "suggest", bar: 70, perTribe: 2, dayCap: 25, extra: 7, small: 10, reason: "Starting the week" } });
  });

  it("accepts each end of each range, and refuses one step outside it", () => {
    for (const [field, range] of Object.entries(AUTOPILOT_RANGES) as [keyof typeof AUTOPILOT_RANGES, readonly [number, number]][]) {
      expect(checkAutopilotSettings({ ...ok, [field]: String(range[0]) }).ok, `${field} low`).toBe(true);
      expect(checkAutopilotSettings({ ...ok, [field]: String(range[1]) }).ok, `${field} high`).toBe(true);
      expect(checkAutopilotSettings({ ...ok, [field]: String(range[0] - 1) }).ok, `${field} under`).toBe(false);
      expect(checkAutopilotSettings({ ...ok, [field]: String(range[1] + 1) }).ok, `${field} over`).toBe(false);
    }
  });

  it("refuses typing slips: blanks, decimals, signs, words and text with numbers in it", () => {
    for (const bad of ["", " ", "7.5", "-3", "+3", "1e2", "ten", "70%", "0x46", "1234"]) expect(checkAutopilotSettings({ ...ok, bar: bad }).ok, JSON.stringify(bad)).toBe(false);
  });

  it("refuses a mode that is not Suggest or Auto, and a missing or over-long reason", () => {
    for (const mode of ["", "on", "AUTO", "off"]) expect(checkAutopilotSettings({ ...ok, mode }).ok, mode).toBe(false);
    expect(checkAutopilotSettings({ ...ok, reason: "" }).ok).toBe(false);
    expect(checkAutopilotSettings({ ...ok, reason: "four" }).ok).toBe(false);
    expect(checkAutopilotSettings({ ...ok, reason: "x".repeat(301) }).ok).toBe(false);
    expect(checkAutopilotSettings({ ...ok, reason: "x".repeat(300) }).ok).toBe(true);
    expect(checkAutopilotSettings({ ...ok, reason: "   fives   " }).ok).toBe(true);
  });

  it("says which number is wrong", () => {
    const r = checkAutopilotSettings({ ...ok, dayCap: "2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Placements in a day: between 5 and 100/);
  });

  it("uses the same ranges as the database", () => {
    const sql = read("supabase/migrations/20270122000100_seat_autopilot.sql");
    expect(sql).toMatch(/p_bar between 60 and 95/);
    expect(sql).toMatch(/p_per_tribe between 1 and 4/);
    expect(sql).toMatch(/p_day_cap between 5 and 100/);
    expect(sql).toMatch(/p_extra between 0 and 30/);
    expect(sql).toMatch(/p_small between 5 and 30/);
    expect(AUTOPILOT_RANGES).toEqual({ bar: [60, 95], perTribe: [1, 4], dayCap: [5, 100], extra: [0, 30], small: [5, 30] });
  });
});

describe("the notice the office gets", () => {
  const mail = (template: string, params: Params) => {
    const m: ClaimedMessage = {
      id: "00000000-0000-4000-8000-000000000001", template, channel: "email", params, urgency: "normal", attempts: 1, reply_token: null,
      to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
    };
    return renderEmail(m, SITE);
  };

  it("says how many are ready, with the right number, and opens the Seats page", () => {
    const one = mail("admin_autopilot_ready", { n: 1, path: "/admin/seats" });
    expect(one.subject).toBe("1 placement ready to approve");
    expect(one.text).toContain("1 person to put with their best fit");
    expect(one.text).toContain(`${SITE}/admin/seats`);
    const four = mail("admin_autopilot_ready", NOTICE_SAMPLES.admin_autopilot_ready);
    expect(four.subject).toBe("4 placements ready to approve");
    expect(four.text).not.toMatch(/\b0\d{10}\b/);
  });

  it("adds the autopilot lines to the 7 am email only when there is something to say", () => {
    const quiet = mail("admin_seat_morning", { taken: 1, yes: 0, released: 0, left: 0, refilled: 0, needs: 0, auto_placed: 0, lapsed: 0, path: "/admin/seats" });
    expect(quiet.text).not.toMatch(/Autopilot placed|ran out/);
    const busy = mail("admin_seat_morning", { taken: 3, yes: 0, released: 0, left: 0, refilled: 0, needs: 0, auto_placed: 3, lapsed: 2, path: "/admin/seats" });
    expect(busy.text).toContain("Autopilot placed 3 people.");
    expect(busy.text).toContain("2 placements in yesterday's plan ran out because nobody placed them.");
    const one = mail("admin_seat_morning", { taken: 1, auto_placed: 1, lapsed: 1, path: "/admin/seats" });
    expect(one.text).toContain("Autopilot placed 1 person.");
    expect(one.text).toContain("1 placement in yesterday's plan ran out");
    const old = mail("admin_seat_morning", { taken: 1, yes: 0, released: 0, left: 0, refilled: 0, needs: 0, path: "/admin/seats" });
    expect(old.text).not.toMatch(/Autopilot placed|ran out/);
  });
});

describe("the wiring", () => {
  const seatActions = read("src/app/(app)/admin/seats/actions.ts");
  const godActions = read("src/app/(app)/god/features/actions.ts");
  const server = read("src/lib/seat/seat-server.ts");

  it("puts every autopilot action behind a session and the office's roles, and the database checks again", () => {
    const approve = seatActions.slice(seatActions.indexOf("export async function autopilotApproveAction"), seatActions.indexOf("export async function autopilotPauseAction"));
    expect(approve).toMatch(/getSession\(\)/);
    expect(approve).toMatch(/canAct\(\)/);
    expect(approve).toMatch(/isUuid\(plan\)/);
    expect(approve).toMatch(/"autopilot_approve"/);
    const pause = seatActions.slice(seatActions.indexOf("export async function autopilotPauseAction"));
    expect(pause).toMatch(/getSession\(\)/);
    expect(pause).toMatch(/canAct\(\)/);
    expect(pause).toMatch(/"autopilot_pause_set"/);
    // the approve action answers with what the database said, and never runs the placement a second time when it fails
    expect(approve.match(/autopilot_approve/g)).toHaveLength(1);
  });

  it("keeps the owner's numbers owner-only, in the action and in the database", () => {
    const set = godActions.slice(godActions.indexOf("export async function autopilotSettingsAction"));
    expect(set.indexOf("ownerOnly()")).toBeGreaterThan(-1);
    expect(set.indexOf("ownerOnly()")).toBeLessThan(set.indexOf('"god_autopilot_settings_set"'));
    expect(set).toMatch(/Number\.isInteger/);
    const sql = read("supabase/migrations/20270122000100_seat_autopilot.sql");
    for (const fn of ["god_autopilot_settings()", "god_autopilot_settings_set("]) {
      const body = sql.slice(sql.indexOf(`create function public.${fn}`));
      expect(body.slice(0, body.indexOf("$$;", 20))).toMatch(/is_god\(\)/);
    }
  });

  it("loads the overview with the viewer's own session and never with a service key", () => {
    const load = server.slice(server.indexOf("export async function loadAutopilot("), server.indexOf("export async function loadAutopilotSettings"));
    expect(load).toMatch(/supabase\.rpc\("autopilot_overview"\)/);
    expect(server).not.toMatch(/service_role|SERVICE_ROLE/);
  });

  it("shows the panel on the Seats page and the owner's card on the Features page", () => {
    expect(read("src/app/(app)/admin/seats/page.tsx")).toMatch(/<AutopilotPanel view=\{autopilot\} \/>/);
    expect(read("src/app/(app)/god/features/page.tsx")).toMatch(/<AutopilotSettingsCard settings=\{autopilot\} \/>/);
  });

  it("only lets the office tap, and never when it is stopped", () => {
    const panel = read("src/components/seat/AutopilotPanel.tsx");
    expect(panel).toMatch(/waitingForTap && canAct && !view\.paused/);
    expect(panel).toMatch(/view\.role === "act"/);
    // nothing on the panel reads a phone number, a note or a reason
    expect(panel).not.toMatch(/\.(phone|note|reason|email)\b/);
  });

  it("registers the switch, starts it Off, and asks for Seat window", () => {
    expect(read("src/lib/features/types.ts")).toMatch(/"reach_release",\s+"seat_autopilot",\s+\] as const/);
    const sql = read("supabase/migrations/20270122000100_seat_autopilot.sql");
    expect(sql).toMatch(/\('seat_autopilot', 'Seat autopilot'[\s\S]*?array\['seat_window'\], array\['off', 'rehearsal', 'on'\], 'off', true, 35, false\)/);
  });

  it("is in the rollback rehearsal", () => {
    expect(read("scripts/rehearse-rollback.sh")).toMatch(/seat-autopilot\|seat-autopilot-rollback/);
  });
});
