/**
 * The programme's objectives, the retention curve and the reports: what the database says (types) and how
 * we say it (wording). Nothing here touches the network, so the same words are used on screen, in a printed
 * report and in the summary written for the pastorate.
 */
import type { DashTribe, DashWeek, Headline, Verdict } from "./types";
import { pct } from "./wording";

export type KpiKey =
  | "connect"
  | "belong"
  | "word"
  | "goal"
  | "care"
  | "multiply"
  | "match"
  | "form_time"
  | "form_completion"
  | "ai_keep";

export type KpiStatus = "met" | "close" | "behind" | "na";
export type KpiUnit = "days" | "minutes" | "rate" | "ratio" | "gap";

export type Kpi = {
  key: KpiKey;
  objective: string;
  value: number | null;
  target: number | null;
  /** "min": higher is better. "max": lower is better. */
  dir: "min" | "max";
  /** How many people (or tribes, or tasks) stand behind the value. */
  n: number;
  unit: KpiUnit;
  status: KpiStatus;
  // Extras, depending on the row
  target_alt?: number;
  measured?: boolean;
  coverage?: number | null;
  days_min?: number;
  gain_min?: number;
  days?: number;
  urgent?: number;
  urgent_same_day?: number;
  certified?: number;
  high_n?: number;
  low_n?: number;
  high_rate?: number | null;
  low_rate?: number | null;
  wait_days?: number | null;
  wait_n?: number;
  finished?: number;
  started?: number;
  lowest_field?: string | null;
};

export type RetentionPoint = { week: number; retained: number; rate: number | null };
export type Retention = { cohort: number; points: RetentionPoint[] };
export type EarlierSeason = Retention & { season_id: string; name: string; starts_on: string };

export type AiField = { field: string; shown: number; kept: number; rate: number | null };
export type GoalRow = { goal: string; community: string | null; members: number; gain_n: number; gain_avg: number | null; gain_share: number | null };

export type TrendPoint = {
  taken_on: string;
  week: number;
  members?: number;
  attendance_rate?: number | null;
  retention_rate?: number | null;
  belong?: number | null;
  open_care?: number;
} & Partial<Record<KpiKey, number | null>>;

export type AllTargets = {
  thriving_rate: number;
  attend_share: number;
  belonging_min: number;
  gain_min: number;
  effective_thriving: number;
  effective_gain: number;
  min_weeks: number;
  min_cell: number;
  min_answers: number;
  retrain_after: number;
  connect_days: number;
  connect_days_season: number;
  form_minutes: number;
  form_completion: number;
  ai_keep: number;
  word_habit: number;
  word_days_min: number;
  care_resolved: number;
  care_days: number;
  assistants: number;
  match_gap: number;
  swap_weeks: number;
};

export type Insight = {
  state: "none" | "before" | "running" | "complete";
  season?: { id: string; name: string; starts_on: string; ends_on: string; weeks: number; current_week: number | null; weeks_over: number };
  measured?: boolean;
  members?: number;
  retention?: Retention;
  earlier?: EarlierSeason[];
  kpis?: Kpi[];
  ai?: { fields: AiField[]; times_shown: number; times_kept: number };
  goals?: GoalRow[];
  trend?: TrendPoint[];
  targets: AllTargets;
};

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const KPI_ORDER: KpiKey[] = ["belong", "goal", "word", "care", "multiply", "connect", "match", "form_time", "form_completion", "ai_keep"];

export const KPI_TITLES: Record<KpiKey, string> = {
  belong: "Members thriving",
  goal: "Gaining on their goal",
  word: "In the Word, most days",
  care: "Care done in time",
  multiply: "Assistants ready to lead",
  connect: "Days to a first meeting",
  match: "Matching that works",
  form_time: "Minutes on the form",
  form_completion: "Forms finished",
  ai_keep: "Suggestions that fit",
};

export function kpiMeaning(k: Kpi, t: AllTargets): string {
  switch (k.key) {
    case "belong":
      return `Came to at least ${Math.round(t.attend_share * 100)}% of the season’s meetings and feels at home (a belonging answer of ${t.belonging_min} or more).`;
    case "goal":
      return `Members whose Success Picture score rose by ${t.gain_min} points or more (the score runs from 3 to 15).`;
    case "word":
      return `Members whose last three weekly reports average ${t.word_days_min} or more days in the Word. Members report this themselves each week.`;
    case "care":
      return `Care tasks that were done within ${t.care_days} days. An urgent need is answered the same day.`;
    case "multiply":
      return "Tribes that have an assistant who has finished their training, so a second tribe can open.";
    case "connect":
      return "The middle number of days from sending the form to the first meeting a member came to.";
    case "match":
      return "How much more often members matched at 85% or more thrive than members matched at 60 to 69%.";
    case "form_time":
      return "The middle number of minutes members spent on the form, from the first screen to the last.";
    case "form_completion":
      return "Of the people who started the form, the share who finished it.";
    case "ai_keep":
      return "How often a member kept what the assistant suggested. The row shows the field with the lowest rate.";
  }
}

export function formatKpi(value: number | null, unit: KpiUnit): string {
  if (value === null || value === undefined) return "–";
  switch (unit) {
    case "days":
      return `${trimZero(value)} ${value === 1 ? "day" : "days"}`;
    case "minutes":
      return `${trimZero(value)} min`;
    case "rate":
      return pct(value);
    case "ratio":
      return `${trimZero(value)} per tribe`;
    case "gap":
      return `${value >= 0 ? "+" : "−"}${Math.abs(Math.round(value * 100))} points`;
  }
}

export function formatTarget(k: Kpi): string {
  if (k.target === null) return "";
  const v = formatKpi(k.target, k.unit);
  return k.dir === "max" ? `${v} or fewer` : `${v} or more`;
}

export const STATUS: Record<KpiStatus, { text: string; tone: "gold" | "neutral" | "flame" | "outline" }> = {
  met: { text: "On target", tone: "gold" },
  close: { text: "Close", tone: "neutral" },
  behind: { text: "Behind", tone: "flame" },
  na: { text: "Too early", tone: "outline" },
};

export const AI_FIELD_LABELS: Record<string, string> = {
  community: "Community",
  community_second: "Second community",
  season_goal: "Goal",
  success_sentence: "Success sentence",
  work_field: "Field of work",
  work_status: "Work",
  relationship: "Relationship",
  children: "Children",
  group_roles: "Group roles",
  meeting_times: "Meeting times",
};

export const aiFieldLabel = (key: string) => AI_FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The small print under a row: what sits behind the number. */
export function kpiNote(k: Kpi, t: AllTargets): string {
  const parts: string[] = [];
  switch (k.key) {
    case "connect":
      parts.push(`${t.connect_days_season} days once the programme is established`);
      break;
    case "word":
      if (k.coverage != null) parts.push(`${pct(k.coverage)} of members have reported`);
      break;
    case "care":
      if ((k.urgent ?? 0) > 0) parts.push(`${k.urgent_same_day ?? 0} of ${k.urgent} urgent needs answered the same day`);
      break;
    case "multiply":
      parts.push(`${k.certified ?? 0} of ${k.n} tribes`);
      break;
    case "match":
      if (k.high_rate != null && k.low_rate != null) parts.push(`${pct(k.high_rate)} thriving at 85%+, ${pct(k.low_rate)} at 60 to 69%`);
      else parts.push(`Shown once both groups have ${t.min_cell} members (now ${k.high_n ?? 0} and ${k.low_n ?? 0})`);
      break;
    case "form_time":
      if (k.wait_days != null) parts.push(`${trimZero(k.wait_days)} days from finishing the form to choosing a tribe`);
      break;
    case "form_completion":
      if ((k.started ?? 0) > 0) parts.push(`${k.finished ?? 0} of ${k.started} who started`);
      break;
    case "ai_keep":
      if (k.lowest_field) parts.push(`Lowest: ${aiFieldLabel(k.lowest_field).toLowerCase()}`);
      break;
    case "belong":
      if (k.measured === false) parts.push(`Shown after ${t.min_weeks} weeks`);
      break;
    case "goal":
      break;
  }
  return parts.join(" · ");
}

/** "Behind" and "close" first, so the page opens on what needs a look. */
export function kpisByNeed(kpis: Kpi[]): Kpi[] {
  const rank: Record<KpiStatus, number> = { behind: 0, close: 1, na: 2, met: 3 };
  const order = new Map(KPI_ORDER.map((k, i) => [k, i]));
  return [...kpis].sort((a, b) => rank[a.status] - rank[b.status] || (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
}

function trimZero(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportKind = "programme" | "pastorate" | "community" | "season";

export const REPORT_KINDS: Record<ReportKind, { title: string; line: string }> = {
  programme: { title: "Programme report", line: "Every figure for the month, with the trend. For the directors and the pastorate." },
  pastorate: { title: "Pastorate one-pager", line: "One page for the senior pastor: how it is going, what needs a look, and what God did." },
  community: { title: "Community report", line: "One community’s month, for its champions." },
  season: { title: "Season report", line: "The season in full, once it has ended." },
};

export type ReportListItem = {
  id: string;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  season: string;
  community: string | null;
  generated_at: string;
  has_summary: boolean;
};

export type ReportTestimony = { who: string; body: string; community: string | null; goal: string | null; themes: string[] };

/** What a report holds. The shape depends on the kind; see build_report in the insight migration. */
export type ReportData = {
  kind: ReportKind;
  as_of: string;
  period: { start: string; end: string };
  season: { id: string; name: string; starts_on: string; ends_on: string; weeks: number; current_week: number | null; over: boolean; before: boolean };
  targets: AllTargets;
  headline: {
    members: number;
    tribes?: number;
    measured?: boolean;
    thriving?: number;
    thriving_rate?: number | null;
    attendance_rate?: number | null;
    gain_n?: number;
    gain_avg?: number | null;
    gain_share?: number | null;
    base_avg?: number | null;
    latest_avg?: number | null;
    verdicts?: { effective: number; not_yet: number; on_course: number; close: number; at_risk: number };
  };
  window: {
    meetings_held: number;
    present: number;
    possible: number;
    attendance_rate: number | null;
    joined: number;
    left: number;
    forms_finished: number;
    care_opened: number;
    care_closed: number;
    care_open_now: number;
    urgent_opened: number;
    testimonies_new: number;
    testimonies_to_church: number;
  };
  testimonies: ReportTestimony[];
  watch: { name: string; leader: string; community: string | null; members: number; attendance_rate: number | null; thriving_rate: number | null; verdict: string }[];
  community?: { id: string; name: string };
  tribes?: { name: string; leader: string; members: number; capacity: number; attendance_rate: number | null; thriving_rate?: number | null; gain_avg?: number | null; verdict: string }[];
  supply?: { community?: string; track?: string; wants: number; seats: number; placed: number }[] | { wants: number; seats: number; placed: number; unmet: number };
  kpis?: Kpi[];
  movement?: { from: TrendPoint; to: TrendPoint } | null;
  retention?: Retention;
  ai?: { fields: AiField[]; times_shown: number; times_kept: number };
  goals?: GoalRow[];
  funnel?: { key: string; label: string; count: number }[];
  communities?: { community: string; members: number; thriving_rate: number | null; gain_avg: number | null }[];
  care?: { open: number; escalated?: number; oldest_open_days?: number | null; closed_7d?: number; median_days_to_close?: number | null };
  earlier?: EarlierSeason[];
};

export type ReportDetail = {
  id: string;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  season: string;
  community: string | null;
  generated_at: string;
  summary: string | null;
  summary_by: "assistant" | "plain" | "edited" | null;
  data: ReportData;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "September 2026" for a monthly report, the season's name for a season report. */
export function reportPeriod(r: Pick<ReportListItem, "kind" | "period_start" | "season">): string {
  if (r.kind === "season") return r.season;
  const [y, m] = r.period_start.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function reportTitle(r: Pick<ReportListItem, "kind" | "community">): string {
  return r.kind === "community" ? `${r.community ?? "Community"} report` : REPORT_KINDS[r.kind].title;
}

export const SUMMARY_BY: Record<NonNullable<ReportDetail["summary_by"]>, string> = {
  assistant: "Written by the assistant from the figures below. Reword it if you like.",
  plain: "Written from the figures below. Reword it if you like.",
  edited: "Edited by a person.",
};

// ---------------------------------------------------------------------------
// The community champion's page
// ---------------------------------------------------------------------------

export type CommunityTribe = Pick<DashTribe, "tribe_id" | "name" | "leader" | "members" | "capacity" | "held" | "attendance_rate"> &
  Partial<Pick<DashTribe, "thriving" | "thriving_rate" | "gain_n" | "gain_avg" | "gain_share" | "steps_done_rate">> & {
    coach?: string | null;
    track?: string | null;
    /** "small" when too few people stand behind a rate for it to be shown. */
    verdict: Verdict | "small";
  };

export type CommunitySupplyRow = { community: string; track: string; wants: number; seats: number; placed: number; short: number; tribes_to_open: number };

export type CommunityPage = {
  state: "none" | "before" | "running" | "complete";
  community: { id: string; name: string };
  communities: { id: string; name: string }[];
  season?: { id: string; name: string; starts_on: string; weeks: number; current_week: number | null; weeks_over: number };
  min_cell?: number;
  targets?: { thriving_rate: number; effective_thriving: number; gain_min: number; min_weeks: number };
  headline?: Partial<Headline> & { members: number; tribes: number };
  tribes?: CommunityTribe[];
  weeks?: DashWeek[];
  supply?: CommunitySupplyRow[];
  testimonies?: { waiting: number; church: number; recent: ReportTestimony[] };
  care?: { open: number; late: number };
  champions?: string[];
};

export type WordDays = { placed: boolean; current_week?: number | null; weeks: { week: number; days: number }[] };
