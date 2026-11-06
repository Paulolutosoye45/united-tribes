// Contact gaps (fix 13): the members a leader cannot reach on WhatsApp, and why. What the screens read from the database (contact_gaps_report,
// tribe_reach_gaps, my_reach), every cause in words, and every sentence the prompts and buttons say. Off, the database answers "off" and every
// screen behaves exactly as it did. The database never sends a number to any of these screens.

import { SERIES_FILTERS, SERIES_NONE, SERIES_STATS_NONE, parseSeriesCounts, parseSeriesOf, parseSeriesStats, type SeriesOfRow, type SeriesState, type SeriesStats } from "@/lib/reach/series";

export type GapCause = "unreachable" | "no_number" | "no_yes" | "made_up" | "not_open" | "withheld";

/** In the order the list puts them: the people only a person can reach first. */
export const CAUSES: readonly {
  key: GapCause;
  label: string;
  /** One line a person reads under the count. */
  line: string;
  /** Whether the office may ask this person by email. */
  askable: boolean;
}[] = [
  { key: "unreachable", label: "No way to be reached", line: "No number, and email is switched off. Only a person can ask them, in person.", askable: false },
  { key: "no_number", label: "No number saved", line: "Nothing for a leader to use.", askable: true },
  { key: "no_yes", label: "Number saved, WhatsApp not agreed", line: "The leader sees nothing, because the person has not said yes to WhatsApp.", askable: true },
  { key: "made_up", label: "Number looks made up", line: "The last seven digits are one digit repeated.", askable: true },
  { key: "not_open", label: "Contact not open yet", line: "Held, waiting or not reached. It opens by itself, so nobody is asked.", askable: false },
  { key: "withheld", label: "Said “Don’t share”", line: "Their choice. They are never asked.", askable: false },
] as const;

export const causeLabel = (key: string): string => CAUSES.find((c) => c.key === key)?.label ?? key;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const isCause = (v: unknown): v is GapCause => typeof v === "string" && CAUSES.some((c) => c.key === v);

// ---------------------------------------------------------------------------
// The office list
// ---------------------------------------------------------------------------
export type GapRow = { personId: string; name: string; tribeId: string; tribe: string; leader: string; cause: GapCause; asks: number; lastAsked: string | null; series: SeriesOfRow };
export type GapTrend = { day: string; counts: Partial<Record<GapCause, number>>; adults: number };
export type GapReport = {
  state: "off" | "rehearsal" | "on";
  role: "act" | "look" | null;
  counts: Record<GapCause, number>;
  adults: number;
  total: number;
  rows: GapRow[];
  trend: GapTrend[];
  limit: number;
  offset: number;
  /** The contact series: how many people stand at each stage (the whole church, like the counts above), what it has done so far, and whether it is paused. */
  seriesCounts: Record<SeriesState, number>;
  seriesStats: SeriesStats;
  seriesSwitch: "off" | "rehearsal" | "limited" | "on";
  seriesPaused: boolean;
};

export const EMPTY_COUNTS: Record<GapCause, number> = { unreachable: 0, no_number: 0, no_yes: 0, made_up: 0, not_open: 0, withheld: 0 };
export const GAP_REPORT_OFF: GapReport = {
  state: "off",
  role: null,
  counts: { ...EMPTY_COUNTS },
  adults: 0,
  total: 0,
  rows: [],
  trend: [],
  limit: 100,
  offset: 0,
  seriesCounts: parseSeriesCounts(null),
  seriesStats: SERIES_STATS_NONE,
  seriesSwitch: "off",
  seriesPaused: false,
};

function counts(v: unknown): Record<GapCause, number> {
  const out = { ...EMPTY_COUNTS };
  if (isObj(v)) for (const c of CAUSES) out[c.key] = int(v[c.key]);
  return out;
}

/** Reads the database's answer defensively: anything not clearly in the shape means Off. */
export function parseGapReport(data: unknown): GapReport {
  if (!isObj(data) || (data.state !== "rehearsal" && data.state !== "on")) {
    return { ...GAP_REPORT_OFF, role: isObj(data) && (data.role === "act" || data.role === "look") ? data.role : null };
  }
  const rows: GapRow[] = [];
  for (const r of Array.isArray(data.rows) ? data.rows : []) {
    if (!isObj(r) || !isCause(r.cause)) continue;
    const personId = text(r.person_id);
    if (!personId) continue;
    rows.push({
      personId,
      name: text(r.name) ?? "A member",
      tribeId: text(r.tribe_id) ?? "",
      tribe: text(r.tribe) ?? "A tribe",
      leader: text(r.leader) ?? "",
      cause: r.cause,
      asks: int(r.asks),
      lastAsked: text(r.last_asked),
      series: r.series === undefined ? SERIES_NONE : parseSeriesOf(r.series),
    });
  }
  const trend: GapTrend[] = [];
  for (const t of Array.isArray(data.trend) ? data.trend : []) {
    if (!isObj(t) || !text(t.day)) continue;
    trend.push({ day: String(t.day).slice(0, 10), counts: counts(t.counts), adults: int(t.adults) });
  }
  return {
    state: data.state,
    role: data.role === "act" || data.role === "look" ? data.role : null,
    counts: counts(data.counts),
    adults: int(data.adults),
    total: int(data.total),
    rows,
    trend,
    limit: int(data.limit) || 100,
    offset: int(data.offset),
    seriesCounts: parseSeriesCounts(data.series_counts),
    seriesStats: parseSeriesStats(data.series_stats),
    seriesSwitch: data.series_switch === "on" || data.series_switch === "rehearsal" || data.series_switch === "limited" ? data.series_switch : "off",
    seriesPaused: data.series_paused === true,
  };
}

/** How many people the office may ask, and how many only a person can reach. */
export function askableCount(c: Record<GapCause, number>): number {
  return c.no_number + c.no_yes + c.made_up;
}
export function gapCount(c: Record<GapCause, number>): number {
  return askableCount(c) + c.unreachable;
}

/** "3 days ago", "today", "never". */
export function askedWords(lastAsked: string | null, asks: number, now: number = Date.now()): string {
  if (!lastAsked || asks <= 0) return "Not asked";
  const days = Math.floor((now - Date.parse(lastAsked)) / 86_400_000);
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return asks > 1 ? `Asked ${asks} times, last ${when}` : `Asked ${when}`;
}

// ---------------------------------------------------------------------------
// The download: names, tribe, leader, cause, asks. Never a number.
// ---------------------------------------------------------------------------
export type GapExportRow = {
  name: string;
  tribe: string;
  leader: string;
  cause: string;
  asks: number;
  last_asked: string | null;
  series?: string | null;
  emails?: number | null;
  /** The placed nudge: the number we hold reaches this person (it is the one they sign in with). Never the number itself. */
  numberConfirmed?: boolean;
};

/** The stage of a person in the series, in words. */
export const seriesStateLabel = (state: string | null | undefined): string => SERIES_FILTERS.find((f) => f.key === state)?.label ?? "";

const cell = (v: string | number | null): string => {
  // A spreadsheet runs a cell that begins with = + - or @ as a formula: a name never needs to
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function gapsCsv(rows: GapExportRow[], withConfirmed = false): string {
  // The two series columns appear only when the database sent them (an older database sends neither), so the file is as it was until the series exists
  const withSeries = rows.some((r) => r.series !== undefined && r.series !== null);
  const head = ["Name", "Tribe", "Leader", "Why a leader cannot reach them", "Times asked", "Last asked", ...(withSeries ? ["Contact series", "Series emails sent"] : []), ...(withConfirmed ? ["Number confirmed"] : [])];
  const lines = [head.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.tribe, r.leader, causeLabel(r.cause), r.asks, r.last_asked ? r.last_asked.slice(0, 10) : "", ...(withSeries ? [seriesStateLabel(r.series), r.emails ?? 0] : []), ...(withConfirmed ? [r.numberConfirmed ? "Yes" : "No"] : [])]
        .map(cell)
        .join(","),
    );
  }
  // The byte-order mark makes a spreadsheet read the accents in a name
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function parseGapExport(data: unknown): GapExportRow[] {
  if (!Array.isArray(data)) return [];
  const out: GapExportRow[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    out.push({
      name: text(r.name) ?? "",
      tribe: text(r.tribe) ?? "",
      leader: text(r.leader) ?? "",
      cause: text(r.cause) ?? "",
      asks: int(r.asks),
      last_asked: text(r.last_asked),
      ...(text(r.series) ? { series: text(r.series), emails: Math.min(int(r.emails), 4) } : {}),
      ...(typeof r.number_confirmed === "boolean" ? { numberConfirmed: r.number_confirmed } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// A leader's list
// ---------------------------------------------------------------------------
export type ReachState = "ask" | "asked" | "in_person";
export type ReachPerson = { personId: string; firstName: string; state: ReachState; askedAt: string | null };
export type ReachGaps = { on: boolean; people: ReachPerson[] };
export const REACH_GAPS_OFF: ReachGaps = { on: false, people: [] };

export function parseReachGaps(data: unknown): ReachGaps {
  if (!isObj(data) || data.on !== true) return REACH_GAPS_OFF;
  const people: ReachPerson[] = [];
  for (const p of Array.isArray(data.people) ? data.people : []) {
    if (!isObj(p)) continue;
    const personId = text(p.person_id);
    const state = p.state === "ask" || p.state === "asked" || p.state === "in_person" ? p.state : null;
    if (!personId || !state) continue;
    people.push({ personId, firstName: text(p.first_name) ?? "A member", state, askedAt: text(p.asked_at) });
  }
  return { on: true, people };
}

// ---------------------------------------------------------------------------
// The member
// ---------------------------------------------------------------------------
export type Reach = {
  on: boolean;
  /** Why a leader cannot reach this person; null when there is nothing to put right. */
  cause: "no_number" | "made_up" | "no_yes" | null;
  /** Show the prompt: there is a gap, and it was not put away in the last week. */
  prompt: boolean;
  /** The number they sign in with, to offer in the box. Only when they have no usable number. */
  signin: string | null;
};
export const REACH_OFF: Reach = { on: false, cause: null, prompt: false, signin: null };

export function parseReach(data: unknown): Reach {
  if (!isObj(data) || data.on !== true) return REACH_OFF;
  const cause = data.cause === "no_number" || data.cause === "made_up" || data.cause === "no_yes" ? data.cause : null;
  const signin = text(data.signin);
  return { on: true, cause, prompt: cause !== null && data.prompt === true, signin: cause !== null && signin && /^\+[1-9][0-9]{7,14}$/.test(signin) ? signin : null };
}

export const REACH_WORDS = {
  /** The member's prompt, by what is missing. */
  noNumberTitle: "Tell us how to reach you",
  noNumberBody: "We do not have a phone number for you yet, so your leader can only reach you by email. Add one if you are happy to. You choose how it is used, and you can say no to any of it.",
  noYesTitle: "Your leader cannot message you on WhatsApp",
  noYesBody: "You gave us your number, thank you. Your leader cannot see it because WhatsApp is not ticked. If you are happy for your leader to message you there, tick it. If you would rather be reached by email or text, leave it as it is.",
  open: "Choose how I am reached",
  later: "Not now",
  /** On the contact card: who sees the number. */
  whoSees: "Only your tribe’s leader, their assistant and your coach can see your number, and only if WhatsApp is ticked. Other members never see it.",
  signinButton: (signin: string) => `Use ${signin}, the number I sign in with`,
  signinNote: "This only fills the box. Nothing is saved until you press Save, and WhatsApp stays unticked until you tick it.",
  /** A leader's list. */
  leaderTitle: "People whose number you cannot see",
  leaderLine: "These people have not added a number you can use, or have not said yes to WhatsApp. You can ask them by email. It is their choice what they share.",
  leaderAsk: (first: string) => `Ask ${first} to add it`,
  leaderAsked: (first: string) => `${first} was asked`,
  leaderInPerson: "Please ask in person",
  leaderDone: (first: string) => `${first} has been emailed. They choose what to share.`,
} as const;
