/** What the Leader quality screen reads (leader_ai_overview and leader_ai_list). */
export type LeaderAiSettings = {
  mode: "off" | "shadow" | "on";
  clear_min_score: number;
  min_question_score: number;
  min_confidence: number;
  min_words: number;
  max_step_tries: number;
  max_rewrites: number;
  rewrite_gap_hours: number;
  audit_pct: number;
  consent_version: string;
  ai_consent_covers_old: boolean;
  activated_at: string | null;
  updated_at: string | null;
};

export type LeaderAiOverview = {
  settings: LeaderAiSettings;
  counts: Record<string, number>;
  shadow: { applications: number; would_clear: number; would_strengthen: number; would_hold: number; instant_only: number };
  audit: { pairs: number; mean_gap: number | null };
  queue: { queued: number; running: number; failed_24h: number; oldest_minutes: number | null };
  usage: { runs_30d: number; ai_runs_30d: number; avg_latency_ms: number | null; input_tokens: number; output_tokens: number };
};

export const LIST_FILTERS = ["held", "strengthen", "checking", "consent_needed", "clear", "all"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];
export const isListFilter = (v: unknown): v is ListFilter => typeof v === "string" && (LIST_FILTERS as readonly string[]).includes(v);

export const LIST_LABEL: Record<ListFilter, string> = {
  held: "Held for a person",
  strengthen: "With the applicant",
  checking: "Being read",
  consent_needed: "Waiting for agreement",
  clear: "Passed",
  all: "All",
};

export type ListRow = {
  id: string;
  applicant: string;
  track: string | null;
  community: string | null;
  status: string;
  submitted_at: string | null;
  state: string;
  basis: string;
  asked_person_at: string | null;
  rewrites_used: number;
  waiting_days: number;
  flags: string[] | null;
  confidence: number | null;
  calling_pct: number | null;
  outcome: string | null;
  shadow: boolean | null;
};

export type LeaderAiList = { total: number; counts: Record<string, number>; rows: ListRow[] };

export const PAGE_SIZE = 25;

/** The thresholds, as the screen shows and edits them. `scale` turns the stored number into the one on screen. */
export type SettingKey = "clear_min_score" | "min_question_score" | "min_confidence" | "min_words" | "max_step_tries" | "max_rewrites" | "rewrite_gap_hours" | "audit_pct";

export const SETTING_INFO: { key: SettingKey; label: string; help: string; min: number; max: number; step: number; unit: string; scale: number; fallback: number }[] = [
  { key: "clear_min_score", label: "Average to pass", help: "The six scores, averaged, must reach this for the first check to pass.", min: 1, max: 5, step: 0.1, unit: "out of 5", scale: 1, fallback: 2.5 },
  { key: "min_question_score", label: "Lowest score on a written question", help: "If any of the five written questions scores below this, the application is held for a person.", min: 1, max: 4, step: 1, unit: "out of 5", scale: 1, fallback: 2 },
  { key: "min_confidence", label: "Least confidence to trust a score", help: "Below this the score is not trusted and a person reads the application.", min: 30, max: 95, step: 1, unit: "%", scale: 100, fallback: 60 },
  { key: "min_words", label: "Fewest words in a written answer", help: "Counted the way the form counts them. A few real sentences is about 25.", min: 5, max: 40, step: 1, unit: "words", scale: 1, fallback: 8 },
  { key: "max_step_tries", label: "Tries on one answer", help: "After this many tries a real answer the check cannot read is let through, and a person reads it closely.", min: 1, max: 6, step: 1, unit: "tries", scale: 1, fallback: 3 },
  { key: "max_rewrites", label: "Updates after sending", help: "How many times an applicant can add to answers after sending. Zero switches updates off.", min: 0, max: 5, step: 1, unit: "times", scale: 1, fallback: 2 },
  { key: "rewrite_gap_hours", label: "Wait between updates", help: "Stops someone changing a word and sending again straight away.", min: 0, max: 168, step: 1, unit: "hours", scale: 1, fallback: 24 },
  { key: "audit_pct", label: "Passed applications a person also scores", help: "A share of passed applications is scored by a reviewer as well, so the first check can be compared with a person.", min: 0, max: 100, step: 1, unit: "%", scale: 1, fallback: 10 },
];

export function readOverview(value: unknown): LeaderAiOverview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<LeaderAiOverview>;
  if (!v.settings) return null;
  return {
    settings: v.settings,
    counts: v.counts ?? {},
    shadow: { applications: 0, would_clear: 0, would_strengthen: 0, would_hold: 0, instant_only: 0, ...(v.shadow ?? {}) },
    audit: { pairs: 0, mean_gap: null, ...(v.audit ?? {}) },
    queue: { queued: 0, running: 0, failed_24h: 0, oldest_minutes: null, ...(v.queue ?? {}) },
    usage: { runs_30d: 0, ai_runs_30d: 0, avg_latency_ms: null, input_tokens: 0, output_tokens: 0, ...(v.usage ?? {}) },
  };
}

export function readList(value: unknown): LeaderAiList | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<LeaderAiList>;
  return { total: typeof v.total === "number" ? v.total : 0, counts: v.counts ?? {}, rows: Array.isArray(v.rows) ? v.rows : [] };
}
