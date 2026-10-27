import type { CommunityPage, Insight, Kpi } from "@/lib/dashboard/insight";
import { formatTarget, kpiNote, kpisByNeed, STATUS } from "@/lib/dashboard/insight";
import type { DashTribe, Dashboard } from "@/lib/dashboard/types";
import { pct, VERDICTS, VERDICT_ORDER } from "@/lib/dashboard/wording";
import { cleanDate, cleanDateTime } from "./guard";
import { col, lagosDay, type Cell, type Table, type Workbook } from "./model";
import { PURPOSES } from "./purposes";
import { packInfo } from "./registry";
import type { Opened } from "./types";

/**
 * From what the database gave to the typed tables of a file. Pure: nothing here reads the network, so the same input always gives the
 * same file, and every builder can be tested on its own. A column that holds a person's name exists only in the People packs; the
 * Insight packs carry whether a tribe has a coach and a certified leader, never who they are.
 */

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]).map(obj) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
/** A moment (or a day) as its day in Lagos. */
const dayOf = (v: unknown): string | null => {
  const t = cleanDateTime(v);
  return t ? t.slice(0, 10) : cleanDate(v);
};

export type Ctx = { opened: Opened; made: Date };

const ROLE_WORDS = (role: string) => {
  const w = role.replace(/_/g, " ").trim();
  return w ? w[0].toUpperCase() + w.slice(1) : "Someone";
};

const SEASON_NONE = "No season to show yet.";

function frame(ctx: Ctx, title: string, subtitle: string | null, facts: [string, string][], notes: string[], tables: Table[]): Workbook {
  const o = ctx.opened;
  const info = packInfo(o.pack);
  const lagos = new Date(ctx.made.getTime() + 3_600_000).toISOString();
  const purpose = o.purpose ? (PURPOSES[o.purpose] ?? null) : null;
  return {
    pack: o.pack,
    packName: info?.name ?? o.pack_name,
    lane: o.lane,
    title,
    subtitle,
    made: ctx.made,
    by: o.who,
    role: o.role,
    purpose,
    exportId: o.export_id,
    rehearsal: o.rehearsal,
    tables,
    notes,
    facts: [
      ["Made for", `${o.who} (${ROLE_WORDS(o.role).toLowerCase()})`],
      ["Made on", `${lagos.slice(0, 10)} ${lagos.slice(11, 16)} (Lagos time)`],
      ["Kind of file", o.lane === "people" ? "People: names people, for the church's own use" : "Insight: counted figures, no names of members"],
      ...(purpose ? ([["Reason", purpose]] as [string, string][]) : []),
      ...facts,
      ["File", o.export_id],
      ["Kept by the church", "No. This file was made when you asked for it. Only the fact that it was made, and by whom, is recorded."],
    ],
  };
}

const none = (t: Table, what: string): Table => (t.rows.length === 0 ? { ...t, caption: `${t.caption ? `${t.caption} ` : ""}${what}` } : t);

// ---------------------------------------------------------------------------
// People packs
// ---------------------------------------------------------------------------

export type TribeSheetData = { tribe?: J; members?: J[]; young_count?: number };

export function buildTribeSheet(ctx: Ctx, d: TribeSheetData): Workbook {
  const tribe = obj(d.tribe);
  const members = arr(d.members);
  const name = str(tribe.name) ?? "Your tribe";
  const table: Table = {
    id: "members",
    sheet: "Members",
    title: `Members of ${name}`,
    caption: "As your roster shows them, in the order they joined.",
    columns: [
      col.text("name", "Name", "The member's name.", 28),
      col.phone("whatsapp", "WhatsApp", "The member's WhatsApp number. Blank unless they agreed to share it and did not ask for it to be withheld.", 18),
      col.date("joined", "Joined", "The day the member joined the tribe.", 13),
      col.date("first_meeting_by", "First meeting by", "The day by which the member should have come to a first meeting.", 16),
      col.yesno("called", "Called", "Whether someone has called the member since they joined.", 9),
      col.date("called_on", "Called on", "The day of the call.", 13),
      col.text("roles", "Group roles", "The roles the member said they like to take in a group.", 26),
      col.free("success", "Success sentence", "What the member wrote about what a good season would be for them.", 50),
    ],
    rows: members.map((m): Cell[] => [
      str(m.name) ?? str(m.first_name),
      str(m.whatsapp),
      dayOf(m.joined_at),
      dayOf(m.first_meeting_by),
      bool(m.called),
      dayOf(m.called_at),
      Array.isArray(m.roles) ? (m.roles as unknown[]).filter((r): r is string => typeof r === "string").join(", ") || null : null,
      str(m.success),
    ]),
  };
  const young = Math.max(0, Math.round(num(d.young_count) ?? 0));
  return frame(
    ctx,
    `Tribe sheet: ${name}`,
    [str(tribe.community), str(tribe.season)].filter(Boolean).join(" · ") || null,
    [["Tribe", name], ["Members listed", String(members.length)]],
    [
      "Your tribe's members as your roster shows them. A member the church has placed but not yet told you about is not listed.",
      "A WhatsApp number is here only if the member agreed to WhatsApp and did not ask for their number to be withheld.",
      young > 0 ? `${young} ${young === 1 ? "member is" : "members are"} under 18: counted here, never listed.` : "No member under 18 is in this tribe, so none is left out.",
      "The private notes members wrote for their leader are never in a file.",
    ],
    [none(table, "No members are listed yet.")],
  );
}

export type RegisterData = { tribe?: J; members?: J[]; young_count?: number };

export function buildAttendanceRegister(ctx: Ctx, d: RegisterData): Workbook {
  const tribe = obj(d.tribe);
  const members = arr(d.members);
  const name = str(tribe.name) ?? "Your tribe";
  const weeks = Math.min(30, Math.max(1, Math.round(num(tribe.weeks) ?? 10)));
  const columns = [
    col.text("name", "Name", "The member's name.", 30),
    ...Array.from({ length: weeks }, (_, i) => col.text(`week_${i + 1}`, `Wk ${i + 1}`, `Week ${i + 1} of the season: tick if the member came.`, 7)),
    col.text("notes", "Notes", "Anything to remember.", 30),
  ];
  const blank = (label: string): Cell[] => [label, ...Array.from({ length: weeks }, () => null), null];
  const rows: Cell[][] = [
    blank("Date of the meeting"),
    ...members.map((m) => blank(str(m.name) ?? str(m.first_name) ?? "")),
    ...Array.from({ length: 4 }, () => blank("")),
  ];
  const day = typeof tribe.meeting_day === "number" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][tribe.meeting_day % 7] : null;
  const young = Math.max(0, Math.round(num(d.young_count) ?? 0));
  return frame(
    ctx,
    `Attendance register: ${name}`,
    [str(tribe.community), str(tribe.season)].filter(Boolean).join(" · ") || null,
    [["Tribe", name], ["Weeks", String(weeks)], ...(day ? ([["Meets", `${day}${str(tribe.meeting_time) ? ` at ${str(tribe.meeting_time)}` : ""}`]] as [string, string][]) : [])],
    [
      "Print it or keep it on a tablet and tick each member who comes. The first row is for the date of each meeting; the blank rows are for visitors.",
      young > 0 ? `${young} ${young === 1 ? "member is" : "members are"} under 18: counted, never listed. Add them by hand if you keep a paper register.` : "No member under 18 is in this tribe, so none is left out.",
    ],
    [{ id: "register", sheet: "Register", title: `Register: ${name}`, caption: "One row for each member, one column for each week.", columns, rows, grid: true }],
  );
}

export type RosterData = { season?: string | null; rows?: J[] };

export function buildLeadersRoster(ctx: Ctx, d: RosterData): Workbook {
  const rows = arr(d.rows);
  const table: Table = {
    id: "leaders",
    sheet: "Leaders",
    title: "Leaders roster",
    caption: "One row for each approved tribe of the season.",
    columns: [
      col.text("leader", "Leader", "The tribe's leader.", 26),
      col.text("assistant", "Assistant", "The tribe's assistant leader, if it has one.", 26),
      col.text("tribe", "Tribe", "The tribe's name.", 24),
      col.text("community", "Community", "The tribe's community.", 22),
      col.text("track", "Track", "The tribe's track.", 22),
      col.text("coach", "Coach", "The coach who looks after the tribe, if there is one.", 26),
      col.yesno("leader_certified", "Leader certified", "Whether the leader has finished the training.", 12),
      col.yesno("assistant_certified", "Assistant certified", "Whether the assistant has finished the training. Blank if there is no assistant.", 12),
      col.text("status", "Status", "Where the tribe stands in approval.", 14),
      col.int("members", "Members", "Members now in the tribe.", 10),
    ],
    rows: rows.map((r): Cell[] => [
      str(r.leader), str(r.assistant), str(r.tribe), str(r.community), str(r.track), str(r.coach),
      bool(r.leader_certified), bool(r.assistant_certified), str(r.status), num(r.members),
    ]),
  };
  return frame(
    ctx,
    "Leaders roster",
    str(d.season),
    [["Season", str(d.season) ?? SEASON_NONE], ["Tribes", String(rows.length)]],
    ["Adults only: a leader, an assistant and a coach. No contact details are in this file.", "Members are never listed here."],
    [none(table, "There are no approved tribes in this season yet.")],
  );
}

export type PeopleRolesData = { rows?: J[] };

export function buildPeopleRoles(ctx: Ctx, d: PeopleRolesData): Workbook {
  const rows = arr(d.rows);
  const table: Table = {
    id: "people",
    sheet: "People and roles",
    title: "People and roles",
    caption: "Each person who holds a role.",
    columns: [
      col.text("name", "Name", "The person's name.", 30),
      col.text("roles", "Roles", "The roles they hold, apart from member.", 50),
      col.date("since", "Since", "The day they were first given a role.", 14),
    ],
    rows: rows.map((r): Cell[] => [str(r.name), str(r.roles)?.replace(/_/g, " ") ?? null, dayOf(r.since)]),
  };
  return frame(
    ctx,
    "People and roles",
    null,
    [["People listed", String(rows.length)]],
    ["Names and roles only: no email address, phone number or anything else about the person.", "Members who hold no other role are not listed, and nobody under 18 is."],
    [none(table, "Nobody holds a role yet.")],
  );
}

// ---------------------------------------------------------------------------
// Insight packs
// ---------------------------------------------------------------------------

const verdictText = (v: unknown): string | null => {
  if (v === "small") return "Too few to show";
  return typeof v === "string" && v in VERDICTS ? VERDICTS[v as keyof typeof VERDICTS].text : null;
};

function tribeRows(tribes: DashTribe[]): Cell[][] {
  return [...tribes]
    .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.name.localeCompare(b.name))
    .map((t): Cell[] => [
      t.name, t.community, t.track, t.members, t.capacity, t.held, t.attendance_rate, t.thriving, t.thriving_rate, t.gain_avg, t.steps_done_rate,
      verdictText(t.verdict), t.coach ? true : false,
    ]);
}

const TRIBE_COLUMNS = [
  col.text("tribe", "Tribe", "The tribe's name.", 24),
  col.text("community", "Community", "The tribe's community.", 22),
  col.text("track", "Track", "The tribe's track.", 22),
  col.int("members", "Members", "Members in the tribe.", 10),
  col.int("capacity", "Seats", "Seats in the tribe.", 8),
  col.int("held", "Meetings held", "Meetings the tribe has held.", 10),
  col.percent("attendance", "Attendance", "Places filled at meetings, as a share of the places there could have been.", 11),
  col.int("thriving", "Thriving", "Members who came to enough meetings and feel at home.", 10),
  col.percent("thriving_rate", "Thriving rate", "Thriving members as a share of the tribe. Blank until three weeks have passed.", 12),
  col.decimal("gain", "Gain", "The average rise in members' Success Picture score (the score runs from 3 to 15).", 9),
  col.percent("steps", "Steps done", "Weekly steps members said they did, as a share of those set.", 11),
  col.text("standing", "Where it stands", "On course, close, at risk and so on, against the programme's targets.", 18),
  col.yesno("has_coach", "Has a coach", "Whether a coach looks after the tribe.", 11),
] as const;

const tribeTable = (id: string, title: string, caption: string, tribes: DashTribe[]): Table => ({
  id, sheet: title, title, caption, columns: [...TRIBE_COLUMNS], rows: tribeRows(tribes),
});

const THRIVING_NOTE = "Thriving means coming to enough of the season's meetings and feeling at home. A rate shows after three weeks.";

export function buildTribesGlance(ctx: Ctx, d: Dashboard | null): Workbook {
  const tribes = d?.tribes ?? [];
  return frame(
    ctx,
    "My tribes at a glance",
    d?.season?.name ?? null,
    [["Season", d?.season?.name ?? SEASON_NONE], ["Tribes", String(tribes.length)]],
    ["Only the tribes you coach.", THRIVING_NOTE, "No names of leaders or members: whether a tribe has a coach is shown instead."],
    [none(tribeTable("tribes", "Tribes", "Worst-off first, so the tribe that needs a call is at the top.", tribes), "There are no tribes to show yet.")],
  );
}

export function buildTribesHealth(ctx: Ctx, d: Dashboard | null): Workbook {
  const tribes = d?.tribes ?? [];
  const h = d?.headline;
  return frame(
    ctx,
    "Tribes health sheet",
    d?.season?.name ?? null,
    [["Season", d?.season?.name ?? SEASON_NONE], ["Tribes", String(tribes.length)], ...(h?.measured ? ([["Thriving", pct(h.thriving_rate)]] as [string, string][]) : [])],
    [THRIVING_NOTE, "No names of leaders or members. Worst-off first."],
    [none(tribeTable("tribes", "Tribes", "Every tribe of the season, worst-off first.", tribes), "There are no tribes to show yet.")],
  );
}

const SUPPLY_COLUMNS = [
  col.text("community", "Community", "The community.", 24),
  col.text("track", "Track", "The track.", 24),
  col.int("wants", "Members wanting", "Members who chose this community and track.", 14),
  col.int("seats", "Seats", "Seats in approved tribes in this community and track.", 10),
  col.int("placed", "Placed", "Members already in a tribe here.", 10),
  col.int("short", "Short of seats", "How many more seats are needed (members wanting, less seats). Zero if there are enough.", 14),
] as const;

function supplyTable(d: Dashboard | null): Table {
  const cells = d?.supply?.cells ?? [];
  return {
    id: "supply",
    sheet: "Supply and demand",
    title: "Supply and demand",
    caption: "Community by track.",
    columns: [...SUPPLY_COLUMNS],
    rows: cells.map((c): Cell[] => [c.community, c.track, c.wants, c.seats, c.placed, Math.max(0, c.wants - c.seats)]),
  };
}

function funnelTable(d: Dashboard | null): Table {
  return {
    id: "funnel",
    sheet: "Funnel",
    title: "From the form to a tribe",
    caption: "How many people reach each step.",
    columns: [col.text("step", "Step", "The step.", 36), col.int("count", "People", "People who have reached the step.", 12)],
    rows: (d?.funnel ?? []).map((f): Cell[] => [f.label, f.count]),
  };
}

export function buildSupplyDemand(ctx: Ctx, d: Dashboard | null): Workbook {
  const s = d?.supply;
  return frame(
    ctx,
    "Supply and demand",
    d?.season?.name ?? null,
    [["Season", d?.season?.name ?? SEASON_NONE], ...(s ? ([["Members wanting", String(s.wants)], ["Seats", String(s.seats)], ["Still without a tribe", String(s.unmet)]] as [string, string][]) : [])],
    ["Where members want to be, and where the seats are. Counts only: no names."],
    [none(supplyTable(d), "Nothing to show yet."), funnelTable(d)],
  );
}

function figuresTable(i: Insight | null): Table {
  const kpis: Kpi[] = i?.kpis ? kpisByNeed(i.kpis) : [];
  const t = i?.targets;
  return {
    id: "figures",
    sheet: "Targets",
    title: "The programme's targets",
    caption: "Behind or close first. Rates are shares; the other figures are in the unit named.",
    columns: [
      col.text("objective", "Objective", "What the programme is aiming for.", 30),
      col.percent("rate", "Rate", "The figure, when it is a share.", 10),
      col.decimal("amount", "Amount", "The figure, when it is not a share.", 10),
      col.text("unit", "Unit", "What the amount is counted in.", 14),
      col.text("target", "Target", "What the programme aims for.", 20),
      col.text("status", "Status", "On target, close, behind or too early.", 12),
      col.int("n", "Behind it", "People, tribes or tasks the figure rests on.", 10),
      col.text("note", "Note", "What sits behind the number.", 50),
    ],
    rows: kpis.map((k): Cell[] => {
      const isRate = k.unit === "rate";
      const unit = k.unit === "days" ? "days" : k.unit === "minutes" ? "minutes" : k.unit === "ratio" ? "per tribe" : k.unit === "gap" ? "points" : null;
      return [
        k.objective, isRate ? k.value : null, !isRate ? (k.unit === "gap" && k.value !== null ? Math.round(k.value * 100) : k.value) : null, unit,
        formatTarget(k) || null, STATUS[k.status].text, k.n, t ? kpiNote(k, t) || null : null,
      ];
    }),
  };
}

const measure = (id: string, title: string, caption: string, rows: [string, string | number | null][]): Table => ({
  id, sheet: title, title, caption,
  columns: [col.text("measure", "Measure", "What is measured.", 36), col.text("value", "Value", "The figure, as it is shown on screen.", 20)],
  rows: rows.map(([m, v]): Cell[] => [m, v === null ? null : String(v)]),
});

function headlineRows(d: Dashboard | null): [string, string | number | null][] {
  const h = d?.headline;
  if (!h) return [];
  return [
    ["Members", h.members], ["Tribes", h.tribes],
    ["Thriving", h.measured ? `${h.thriving} of ${h.members} (${pct(h.thriving_rate)})` : "Shown after week 3"],
    ["Attendance", h.measured ? pct(h.attendance_rate) : "Shown after week 3"],
    ["Steps done", pct(h.steps_done_rate)], ["Weekly check-ins", pct(h.checkin_rate)],
    ["Still coming", `${h.still_coming} of ${h.ever_came}`],
    ["Tribes effective", h.verdicts.effective], ["Tribes on course", h.verdicts.on_course], ["Tribes close", h.verdicts.close], ["Tribes at risk", h.verdicts.at_risk],
  ];
}

function careRows(d: Dashboard | null): [string, string | number | null][] {
  const c = d?.care;
  const t = d?.testimonies;
  return [
    ...(c ? ([["Care tasks open", c.open], ["Escalated", c.escalated], ["Oldest open (days)", c.oldest_open_days], ["Closed in the last 7 days", c.closed_7d], ["Median days to close", c.median_days_to_close]] as [string, string | number | null][]) : []),
    ...(t ? ([["Testimonies waiting to be read", t.waiting], ["Testimonies shared with the tribe", t.tribe], ["Testimonies shared with the church", t.church]] as [string, string | number | null][]) : []),
  ];
}

export function buildProgrammeReport(ctx: Ctx, d: Dashboard | null, i: Insight | null): Workbook {
  const weeks = d?.weeks ?? [];
  const tribes = d?.tribes ?? [];
  const communities = d?.communities ?? [];
  const tables: Table[] = [
    figuresTable(i),
    measure("headline", "Headline", "How the season stands.", headlineRows(d)),
    {
      id: "weeks", sheet: "Weeks", title: "Week by week", caption: "Meetings logged, how many came and how many steps were set and done.",
      columns: [
        col.int("week", "Week", "The week of the season.", 8), col.yesno("current", "This week", "Whether this is the current week.", 10),
        col.int("logged", "Meetings logged", "Tribes that logged the week.", 12), col.int("met", "Met", "Tribes that met.", 8),
        col.int("present", "Present", "Places filled.", 9), col.int("possible", "Possible", "Places there could have been.", 9),
        col.percent("attendance", "Attendance", "Present as a share of possible.", 11),
        col.int("steps_set", "Steps set", "Steps members set.", 10), col.int("steps_done", "Steps done", "Steps members said they did.", 10),
      ],
      rows: weeks.map((w): Cell[] => [w.week, w.current, w.logged, w.met, w.present, w.possible, w.possible > 0 ? w.present / w.possible : null, w.steps_set, w.steps_done]),
    },
    tribeTable("tribes", "Tribes", "Worst-off first.", tribes),
    {
      id: "communities", sheet: "Communities", title: "Communities", caption: "Members and how each community is doing.",
      columns: [col.text("community", "Community", "The community.", 28), col.int("members", "Members", "Members in the community.", 10), col.percent("thriving_rate", "Thriving rate", "Thriving members as a share.", 12), col.decimal("gain", "Gain", "The average rise in the Success Picture score.", 9)],
      rows: communities.map((c): Cell[] => [c.community, c.members, c.thriving_rate, c.gain_avg]),
    },
    supplyTable(d),
    funnelTable(d),
    measure("care", "Care", "Care tasks and testimonies, as counts.", careRows(d)),
  ];
  return frame(
    ctx,
    "Programme report",
    d?.season?.name ?? null,
    [["Season", d?.season?.name ?? SEASON_NONE], ...(d?.season?.current_week ? ([["Week", `${d.season.current_week} of ${d.season.weeks}`]] as [string, string][]) : [])],
    [THRIVING_NOTE, "Counts and rates only: no names of members or leaders, and none of what anyone wrote."],
    tables.map((t) => (t.rows.length === 0 ? none(t, "Nothing to show yet.") : t)),
  );
}

export function buildPastorateOnePager(ctx: Ctx, d: Dashboard | null, i: Insight | null): Workbook {
  const tribes = [...(d?.tribes ?? [])]
    .filter((t) => t.verdict === "at_risk" || t.verdict === "close" || t.verdict === "not_yet")
    .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const figures = figuresTable(i);
  const tables: Table[] = [
    measure("headline", "How it is going", "The season at a glance.", headlineRows(d)),
    { ...figures, title: "Against the targets", caption: "Behind or close first." },
    { ...tribeTable("watch", "Tribes that need a look", "Up to eight, worst-off first. Names of tribes only.", tribes), columns: [...TRIBE_COLUMNS] },
    measure("care", "Care", "Care tasks and testimonies, as counts.", careRows(d)),
  ];
  return frame(
    ctx,
    "Pastorate one-pager",
    d?.season?.name ?? null,
    [["Season", d?.season?.name ?? SEASON_NONE]],
    [THRIVING_NOTE, "Counts and rates only: no names of members or leaders, and none of what anyone wrote."],
    tables.map((t) => (t.rows.length === 0 ? none(t, "Nothing to show yet.") : t)),
  );
}

export function buildCommunityReport(ctx: Ctx, d: CommunityPage | null): Workbook {
  const tribes = d?.tribes ?? [];
  const h = d?.headline;
  const name = d?.community?.name ?? "Community";
  const tables: Table[] = [
    measure("headline", "Headline", "How the community stands.", h ? [["Members", h.members], ["Tribes", h.tribes], ["Thriving", h.measured && h.thriving_rate !== undefined ? pct(h.thriving_rate) : "Shown after week 3"], ["Attendance", h.measured && h.attendance_rate !== undefined ? pct(h.attendance_rate) : "Shown after week 3"]] : []),
    {
      id: "tribes", sheet: "Tribes", title: "Tribes", caption: "Names of tribes only.",
      columns: [
        col.text("tribe", "Tribe", "The tribe's name.", 24), col.text("track", "Track", "The tribe's track.", 22), col.int("members", "Members", "Members in the tribe.", 10), col.int("capacity", "Seats", "Seats in the tribe.", 8),
        col.int("held", "Meetings held", "Meetings held.", 10), col.percent("attendance", "Attendance", "Share of places filled.", 11), col.percent("thriving_rate", "Thriving rate", "Thriving members as a share. Blank when too few members stand behind it.", 12),
        col.decimal("gain", "Gain", "The average rise in the Success Picture score.", 9), col.text("standing", "Where it stands", "Against the programme's targets.", 18),
      ],
      rows: tribes.map((t): Cell[] => [t.name, t.track ?? null, t.members, t.capacity, t.held, t.attendance_rate, t.thriving_rate ?? null, t.gain_avg ?? null, verdictText(t.verdict)]),
    },
    {
      id: "places", sheet: "Places to fill", title: "Places still to fill", caption: "Where members want to be and where the seats are.",
      columns: [
        col.text("community", "Community", "The community.", 22), col.text("track", "Track", "The track.", 24), col.int("wants", "Members wanting", "Members who chose it.", 14), col.int("seats", "Seats", "Seats in approved tribes.", 9),
        col.int("placed", "Placed", "Members already in a tribe.", 9), col.int("short", "Short of seats", "How many more seats are needed.", 13), col.int("to_open", "Tribes to open", "New tribes it would take to seat everyone.", 13),
      ],
      rows: (d?.supply ?? []).map((s): Cell[] => [s.community, s.track, s.wants, s.seats, s.placed, s.short, s.tribes_to_open]),
    },
    measure("care", "Care", "Counts only.", [...(d?.care ? ([["Care tasks open", d.care.open], ["Late", d.care.late]] as [string, number][]) : []), ...(d?.testimonies ? ([["Testimonies waiting", d.testimonies.waiting], ["Shared with the church", d.testimonies.church]] as [string, number][]) : [])]),
  ];
  return frame(
    ctx,
    `Community report: ${name}`,
    d?.season?.name ?? null,
    [["Community", name], ["Season", d?.season?.name ?? SEASON_NONE]],
    [THRIVING_NOTE, "Counts and rates only: no names of members or leaders, and none of what anyone wrote."],
    tables.map((t) => (t.rows.length === 0 ? none(t, "Nothing to show yet.") : t)),
  );
}

export type VolumesData = { from?: string; to?: string; refreshed_at?: string | null; rows?: J[] };

export function buildMessageVolumes(ctx: Ctx, d: VolumesData): Workbook {
  const rows = arr(d.rows);
  const table: Table = {
    id: "messages",
    sheet: "Messages",
    title: "Message volumes",
    caption: `From ${d.from ?? "?"} to ${d.to ?? "?"}.`,
    columns: [
      col.date("day", "Day", "The day the messages were made.", 13),
      col.text("template", "Kind", "The kind of message.", 30),
      col.text("channel", "Channel", "How it was sent.", 12),
      col.text("outcome", "Outcome", "What happened to it.", 14),
      col.int("messages", "Messages", "How many.", 10),
    ],
    rows: rows.map((r): Cell[] => [dayOf(r.day), str(r.template), str(r.channel), str(r.status), num(r.messages)]),
  };
  return frame(
    ctx,
    "Message volumes",
    d.from && d.to ? `${d.from} to ${d.to}` : null,
    [["From", d.from ?? ""], ["To", d.to ?? ""], ["Rows", String(rows.length)], ...(d.refreshed_at ? ([["Figures refreshed", cleanDateTime(d.refreshed_at) ?? ""]] as [string, string][]) : [])],
    ["Counts only: never the wording of a message or who it went to.", "The figures come from the reporting copy, which is refreshed once a day."],
    [none(table, "No messages in this period.")],
  );
}

export { lagosDay };
