import { describe, expect, it } from "vitest";
import {
  buildAttendanceRegister, buildCommunityReport, buildLeadersRoster, buildMessageVolumes, buildPastorateOnePager, buildPeopleRoles,
  buildProgrammeReport, buildSupplyDemand, buildTribesGlance, buildTribesHealth, buildTribeSheet, type Ctx,
} from "@/lib/exports/builders";
import { displayCell } from "@/lib/exports/display";
import type { Workbook } from "@/lib/exports/model";
import type { Opened, PackId } from "@/lib/exports/types";
import type { CommunityPage, Insight } from "@/lib/dashboard/insight";
import type { Dashboard, DashTribe } from "@/lib/dashboard/types";

const ctx = (pack: PackId, lane: "people" | "insight", extra: Partial<Opened> = {}): Ctx => ({
  made: new Date("2026-10-27T03:07:00Z"),
  opened: {
    export_id: "0b1f6c7a-1111-4222-8333-444455556666", pack, pack_name: pack, lane, format: "xlsx", purpose: lane === "people" ? "planning" : null, filters: {},
    role: "leader", rehearsal: false, made_at: "2026-10-27T03:07:00Z", expires_at: "2026-10-28T03:07:00Z", who: "Ada Okafor", ...extra,
  },
});

const everything = (w: Workbook) => JSON.stringify(w);

const tribe = (over: Partial<DashTribe> = {}): DashTribe => ({
  tribe_id: "t1", name: "Alpha Tribe", leader: "Chidinma Eze", coach: "Tunde Bello", community: "Gospel", track: "Builders", members: 10, capacity: 12, held: 4,
  attendance_rate: 0.8, thriving: 7, thriving_rate: 0.7, gain_n: 6, gain_avg: 1.5, gain_share: 0.6, steps_done_rate: 0.55, verdict: "close", ...over,
});

const dashboard = (): Dashboard => ({
  state: "running", scope: "church",
  targets: { thriving_rate: 0.8, attend_share: 0.7, belonging_min: 4, gain_min: 2, effective_thriving: 0.8, effective_gain: 0.7, min_weeks: 3, min_cell: 5, min_answers: 5, retrain_after: 50 },
  season: { id: "s1", name: "Season 3", starts_on: "2026-09-14", weeks: 10, current_week: 4, weeks_over: 3, meetings_needed: 7 },
  headline: { members: 40, tribes: 4, measured: true, thriving: 28, thriving_rate: 0.7, attendance_rate: 0.8, base_n: 30, base_avg: 8, latest_avg: 9.5, gain_n: 30, gain_avg: 1.5, gain_share: 0.6, steps_done_rate: 0.55, checkin_rate: 0.9, ever_came: 38, still_coming: 36, verdicts: { effective: 0, not_yet: 0, on_course: 1, close: 2, at_risk: 1 } },
  weeks: [{ week: 1, current: false, logged: 4, met: 4, present: 30, possible: 40, steps_set: 30, steps_done: 20, steps_checked: 10 }],
  tribes: [tribe(), tribe({ tribe_id: "t2", name: "Beta Tribe", leader: "Segun Ade", coach: null, verdict: "at_risk", thriving_rate: 0.3 }), tribe({ tribe_id: "t3", name: "Gamma Tribe", verdict: "on_course", thriving_rate: 0.9 })],
  funnel: [{ key: "form", label: "Finished the form", count: 50 }, { key: "placed", label: "Placed in a tribe", count: 40 }],
  supply: { communities: ["Gospel"], tracks: ["Builders"], cells: [{ community: "Gospel", track: "Builders", wants: 20, seats: 15, placed: 12 }, { community: "Gospel", track: "Makers", wants: 5, seats: 9, placed: 5 }], wants: 25, seats: 24, placed: 17, unmet: 8 },
  communities: [{ community: "Gospel", members: 40, thriving_rate: 0.7, gain_avg: 1.5 }],
  care: { open: 3, escalated: 1, oldest_open_days: 5, closed_7d: 4, median_days_to_close: 2 },
  testimonies: { waiting: 2, tribe: 3, church: 1, declined: 0 },
});

const insight = (): Insight => ({
  state: "running",
  targets: { thriving_rate: 0.8, attend_share: 0.7, belonging_min: 4, gain_min: 2, effective_thriving: 0.8, effective_gain: 0.7, min_weeks: 3, min_cell: 5, min_answers: 5, retrain_after: 50, connect_days: 7, connect_days_season: 5, form_minutes: 10, form_completion: 0.8, ai_keep: 0.6, word_habit: 0.6, word_days_min: 4, care_resolved: 0.9, care_days: 3, assistants: 1, match_gap: 0.1, swap_weeks: 3 } as Insight["targets"],
  kpis: [
    { key: "belong", objective: "Members thriving", value: 0.7, target: 0.8, dir: "min", n: 40, unit: "rate", status: "close", measured: true },
    { key: "connect", objective: "Days to a first meeting", value: 4.5, target: 7, dir: "max", n: 38, unit: "days", status: "met" },
    { key: "match", objective: "Matching that works", value: 0.12, target: 0.1, dir: "min", n: 30, unit: "gap", status: "met", high_rate: 0.8, low_rate: 0.68 },
  ],
});

describe("the tribe sheet and the register (People packs)", () => {
  const data = {
    tribe: { name: "Alpha Tribe", community: "Gospel", season: "Season 3", weeks: 10, meeting_day: 3, meeting_time: "19:00" },
    members: [
      { name: "Ada Okafor", first_name: "Ada", whatsapp: "+2348031234567", joined_at: "2026-09-14T20:30:00Z", first_meeting_by: "2026-09-28", called: true, called_at: "2026-09-15T09:00:00Z", roles: ["Encourager", "Host"], success: "To find a mentor" },
      { name: "Bola Ade", first_name: "Bola", whatsapp: null, joined_at: "2026-09-15T08:00:00Z", first_meeting_by: null, called: false, called_at: null, roles: [], success: null },
    ],
    young_count: 2,
  };

  it("lists the members with typed columns and says what was left out", () => {
    const w = buildTribeSheet(ctx("tribe_sheet", "people"), data);
    const t = w.tables[0];
    expect(t.columns.map((c) => c.label)).toEqual(["Name", "Where they stand", "WhatsApp", "Joined", "First meeting by", "Called", "Called on", "Group roles", "Success sentence"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual(["Ada Okafor", "Chose this tribe", "+2348031234567", "2026-09-14", "2026-09-28", true, "2026-09-15", "Encourager, Host", "To find a mentor"]);
    // 20:30 UTC on the 14th is 21:30 in Lagos, still the 14th; a late evening one moves to the next day
    expect(buildTribeSheet(ctx("tribe_sheet", "people"), { ...data, members: [{ ...data.members[0], joined_at: "2026-09-14T23:30:00Z" }] }).tables[0].rows[0][3]).toBe("2026-09-15");
    expect(t.rows[1][2]).toBeNull();
    expect(w.notes.join(" ")).toContain("2 members are under 18: counted here, never listed.");
    expect(w.notes.join(" ")).toContain("never in a file");
    expect(w.facts.find(([k]) => k === "Reason")?.[1]).toBe("Planning");
    expect(w.lane).toBe("people");
  });

  it("says where each member stands: their own choice, a yes, or a place still waiting for their reply", () => {
    const w = buildTribeSheet(ctx("tribe_sheet", "people"), {
      ...data,
      members: [
        { name: "Chi", placement: "confirmed", whatsapp: "+2348030000001" },
        { name: "Dayo", placement: "pending", whatsapp: null },
        { name: "Eze" },
      ],
    });
    expect(w.tables[0].rows.map((r) => r[1])).toEqual(["Said yes", "Waiting for a reply", "Chose this tribe"]);
    expect(w.notes.join(" ")).toContain("has said yes");
  });

  it("never carries an id or a sealed note, even if the source gave one", () => {
    const w = buildTribeSheet(ctx("tribe_sheet", "people"), { ...data, members: [{ ...data.members[0], person_id: "11111111-2222-3333-4444-555555555555", note_enc: "sealed" }] });
    expect(everything(w)).not.toMatch(/11111111-2222|sealed/);
  });

  it("makes a register with a column for each week, a date row, and blank rows for visitors", () => {
    const w = buildAttendanceRegister(ctx("attendance_register", "people"), data);
    const t = w.tables[0];
    expect(t.grid).toBe(true);
    expect(t.columns).toHaveLength(1 + 10 + 1);
    expect(t.columns[1].label).toBe("Wk 1");
    expect(t.rows).toHaveLength(1 + 2 + 4);
    expect(t.rows[0][0]).toBe("Date of the meeting");
    expect(t.rows[1][0]).toBe("Ada Okafor");
    expect(w.facts.find(([k]) => k === "Meets")?.[1]).toBe("Wednesday at 19:00");
    expect(buildAttendanceRegister(ctx("attendance_register", "people"), { tribe: { weeks: 500 } }).tables[0].columns).toHaveLength(32);
  });

  it("copes with a tribe nobody has joined yet", () => {
    const w = buildTribeSheet(ctx("tribe_sheet", "people"), { tribe: { name: "New" }, members: [], young_count: 0 });
    expect(w.tables[0].rows).toEqual([]);
    expect(w.tables[0].caption).toContain("No members are listed yet.");
    expect(w.notes.join(" ")).toContain("No member under 18");
    expect(() => buildTribeSheet(ctx("tribe_sheet", "people"), {})).not.toThrow();
  });
});

describe("the leaders roster and the people roster (People packs)", () => {
  it("lists leaders, assistants and coaches with what they are certified for", () => {
    const w = buildLeadersRoster(ctx("leaders_roster", "people"), {
      season: "Season 3",
      rows: [{ leader: "Chidinma Eze", assistant: null, tribe: "Alpha", community: "Gospel", track: "Builders", coach: "Tunde Bello", leader_certified: true, assistant_certified: null, status: "approved", members: 10 }],
    });
    expect(w.tables[0].rows[0]).toEqual(["Chidinma Eze", null, "Alpha", "Gospel", "Builders", "Tunde Bello", true, null, "approved", 10]);
    expect(w.notes.join(" ")).toContain("No contact details");
  });

  it("lists names, roles and the day a role was first given", () => {
    const w = buildPeopleRoles(ctx("people_roles", "people"), { rows: [{ name: "Ada Okafor", roles: "coach, community_champion", since: "2026-08-01T10:00:00Z" }] });
    expect(w.tables[0].rows[0]).toEqual(["Ada Okafor", "coach, community champion", "2026-08-01"]);
    expect(w.tables[0].columns.map((c) => c.key)).toEqual(["name", "roles", "since"]);
  });
});

describe("the Insight packs never name a person", () => {
  const people = ["Chidinma Eze", "Tunde Bello", "Segun Ade"];

  it("carries no leader or coach name in any table of any of them", () => {
    const d = dashboard();
    const i = insight();
    const books = [
      buildTribesGlance(ctx("my_tribes_glance", "insight", { role: "coach" }), d),
      buildTribesHealth(ctx("tribes_health", "insight", { role: "director" }), d),
      buildSupplyDemand(ctx("supply_demand", "insight", { role: "director" }), d),
      buildProgrammeReport(ctx("programme_report", "insight", { role: "director" }), d, i),
      buildPastorateOnePager(ctx("pastorate_one_pager", "insight", { role: "pastor" }), d, i),
    ];
    for (const w of books) {
      expect(w.lane).toBe("insight");
      for (const name of people) expect(everything(w), `${w.pack} / ${name}`).not.toContain(name);
      for (const t of w.tables) for (const c of t.columns) expect(c.key, `${w.pack}.${t.id}`).not.toMatch(/leader|coach_name|assistant$|^name$|person|member_name/);
      expect(w.facts.find(([k]) => k === "Reason")).toBeUndefined();
    }
  });

  it("puts the tribe that needs a call first, and shows whether it has a coach instead of who", () => {
    const w = buildTribesHealth(ctx("tribes_health", "insight"), dashboard());
    const t = w.tables[0];
    expect(t.rows.map((r) => r[0])).toEqual(["Beta Tribe", "Alpha Tribe", "Gamma Tribe"]);
    expect(t.rows[0][11]).toBe("At risk");
    expect(t.rows.map((r) => r[12])).toEqual([false, true, true]);
    expect(t.columns.map((c) => c.key)).toContain("has_coach");
  });

  it("works out the seats a community is short of, never below zero", () => {
    const w = buildSupplyDemand(ctx("supply_demand", "insight"), dashboard());
    expect(w.tables[0].rows.map((r) => r.slice(0, 6))).toEqual([["Gospel", "Builders", 20, 15, 12, 5], ["Gospel", "Makers", 5, 9, 5, 0]]);
    expect(w.tables[1].rows).toEqual([["Finished the form", 50], ["Placed in a tribe", 40]]);
  });

  it("gives the programme report its targets with rates as shares and other figures in their unit", () => {
    const w = buildProgrammeReport(ctx("programme_report", "insight"), dashboard(), insight());
    const f = w.tables.find((t) => t.id === "figures")!;
    expect(f.rows[0].slice(0, 6)).toEqual(["Members thriving", 0.7, null, null, "80% or more", "Close"]);
    expect(f.rows.find((r) => r[0] === "Days to a first meeting")?.slice(1, 5)).toEqual([null, 4.5, "days", "7 days or fewer"]);
    expect(f.rows.find((r) => r[0] === "Matching that works")?.slice(1, 4)).toEqual([null, 12, "points"]);
    expect(w.tables.map((t) => t.id)).toEqual(["figures", "headline", "weeks", "tribes", "communities", "supply", "funnel", "care"]);
    const weeks = w.tables.find((t) => t.id === "weeks")!;
    expect(weeks.rows[0][6]).toBe(0.75);
  });

  it("says plainly that a table is empty rather than leaving a blank sheet", () => {
    const w = buildTribesGlance(ctx("my_tribes_glance", "insight"), null);
    expect(w.tables[0].rows).toEqual([]);
    expect(w.tables[0].caption).toContain("There are no tribes to show yet.");
    expect(w.facts.find(([k]) => k === "Season")?.[1]).toBe("No season to show yet.");
  });

  it("keeps the pastorate one-pager to the tribes that need a look", () => {
    const w = buildPastorateOnePager(ctx("pastorate_one_pager", "insight", { role: "pastor" }), dashboard(), insight());
    const watch = w.tables.find((t) => t.id === "watch")!;
    expect(watch.rows.map((r) => r[0])).toEqual(["Beta Tribe", "Alpha Tribe"]);
    expect(w.tables[0].rows[0]).toEqual(["Members", "40"]);
  });

  it("builds the community report without a leader's name and says when a rate is too small to show", () => {
    const page: CommunityPage = {
      state: "running", community: { id: "c1", name: "Gospel" }, communities: [], season: { id: "s1", name: "Season 3", starts_on: "2026-09-14", weeks: 10, current_week: 4, weeks_over: 3 },
      headline: { members: 20, tribes: 2, measured: true, thriving_rate: 0.6, attendance_rate: 0.7 },
      tribes: [{ tribe_id: "t1", name: "Alpha Tribe", leader: "Chidinma Eze", members: 4, capacity: 12, held: 4, attendance_rate: 0.8, verdict: "small", track: "Builders" }],
      supply: [{ community: "Gospel", track: "Builders", wants: 8, seats: 6, placed: 5, short: 2, tribes_to_open: 1 }],
      care: { open: 2, late: 1 }, testimonies: { waiting: 1, church: 0, recent: [] }, champions: ["Someone Else"],
    };
    const w = buildCommunityReport(ctx("community_report", "insight", { role: "community_champion" }), page);
    expect(everything(w)).not.toMatch(/Chidinma|Someone Else/);
    expect(w.tables.find((t) => t.id === "tribes")!.rows[0][8]).toBe("Too few to show");
    expect(w.title).toBe("Community report: Gospel");
  });

  it("counts messages by day and says where the figures came from", () => {
    const w = buildMessageVolumes(ctx("message_volumes", "insight", { role: "admin" }), { from: "2026-07-30", to: "2026-10-27", refreshed_at: "2026-10-27T02:00:00Z", rows: [{ day: "2026-10-26", template: "welcome", channel: "email", status: "sent", messages: 12 }] });
    expect(w.tables[0].rows[0]).toEqual(["2026-10-26", "welcome", "email", "sent", 12]);
    expect(w.facts.find(([k]) => k === "Figures refreshed")?.[1]).toBe("2026-10-27 03:00");
    expect(w.notes.join(" ")).toContain("never the wording");
  });
});

describe("every file says what it is", () => {
  it("names who it was made for, when, what kind it is and that it is not kept", () => {
    const w = buildPeopleRoles(ctx("people_roles", "people", { role: "admin", who: "Mary Ogedengbe" }), { rows: [] });
    const facts = Object.fromEntries(w.facts);
    expect(facts["Made for"]).toBe("Mary Ogedengbe (admin)");
    expect(facts["Made on"]).toBe("2026-10-27 04:07 (Lagos time)");
    expect(facts["File"]).toBe("0b1f6c7a-1111-4222-8333-444455556666");
    expect(facts["Kept by the church"]).toMatch(/^No\./);
    expect(facts["Kind of file"]).toMatch(/^People/);
  });

  it("shows a cell the way a person reads it", () => {
    expect(displayCell(0.756, "percent")).toBe("76%");
    expect(displayCell(1.25, "decimal")).toBe("1.3");
    expect(displayCell(true, "yesno")).toBe("Yes");
    expect(displayCell("2026-10-27T23:30:00Z", "datetime")).toBe("2026-10-28 00:30");
    expect(displayCell("=1+1", "phone")).toBe("");
    expect(displayCell(null, "int")).toBe("");
  });
});
