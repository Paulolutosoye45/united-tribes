// What the owner's activity functions return (supabase/migrations/20261215000100_activity.sql). A count of a small group
// arrives as the text "<5": the database has already hidden the number, and nothing here can bring it back.

/** A people-count that may be hidden: a number, or "<5" for a group of fewer than five. */
export type Cell = number | "<5";

export type Series = { now: number[]; prev: number[] };

export type Decision = {
  key: string;
  label: string;
  value: number | null;
  threshold: number;
  unit: string;
  action: string;
  href: string;
};

export type TileCounts = { today: number; d7: number; p7: number; d30: number; p30: number };

export type Pulse = {
  today: string;
  active: TileCounts;
  groups: Record<string, { d7: Cell; d30: Cell }>;
  metrics: Record<string, TileCounts>;
  trend: { days: string[]; series: Record<string, Series> };
  decisions: Decision[];
  status: { recording: boolean; retention_months: number; last_refresh: string | null; last_backfill: string | null; recording_since: string | null };
};

export type Brief = {
  week_start: string;
  week_end: string;
  active: { now: number; prev: number };
  numbers: Record<string, { now: number; prev: number }>;
  decisions: Decision[];
};

export type FunnelStage = {
  k: number;
  key: string;
  label: string;
  reached: Cell;
  stopped: Cell;
  pct_start: number | null;
  pct_prev: number | null;
  median_hours: number | null;
};

export type Funnel = {
  which: "member" | "leader";
  from: string;
  to: string;
  total: number;
  stages: FunnelStage[];
  split: { value: string; total: Cell; reached: Cell[] }[] | null;
  finish: { n: number; p25: number | null; p50: number | null; p75: number | null; p90: number | null; bins: { label: string; n: Cell }[] } | null;
};

export type FunnelPeople = {
  total: Cell;
  young: Cell;
  hidden: boolean;
  people: { id: string; name: string; group: string; since: string }[];
};

export type CompareRow = {
  label: string;
  members: Cell;
  submitted_pct?: number | null;
  placed_pct?: number | null;
  active_pct: number | null;
  attendance_pct?: number | null;
};
export type Compare = { by: "community" | "zone" | "tribe"; rows: CompareRow[] };

export type Retention = { weeks: { start: string; size: Cell; cells: (number | "<5" | null)[] }[] };

export type Heatmap = {
  days: number;
  cells: { dow: number; hour: number; people: Cell; events: number }[];
  groups: Record<string, number[]>;
};

export type Metric = { key: string; label: string; value: Cell | null; prev: Cell | null; unit: string; note: string | null };
export type Panel = { id: string; title: string; informs: string; metrics: Metric[]; people?: { id: string; name: string; actions: number }[] };
export type Stakeholders = { window_days: number; panels: Panel[] };

export type Integrity = {
  answer_checks: { checked: number; failed: number; forced_through: number; ai_checked: number };
  failing_fields: { field: string; n: number }[];
  ai_vs_people: { pairs: number; mean_gap: number | null; ai_kinder: number; ai_stricter: number };
  ai_states: Record<string, Cell>;
  referee_flags: Record<string, { open: number; last_30d: number }>;
  callbacks: { open: number; overdue: number; confirmed: number; not_reached: number; not_them: number };
  changes: {
    referee_changes_30d: number;
    after_a_request_30d: number;
    changed_three_times_or_more: number;
    answer_changes_30d: number;
    repeat_answer_changers: Cell;
  };
  signins: { declined_7d: Record<string, number>; numbers_hit_the_limit_24h: number; failed_or_rejected_7d: number };
  cases: { kind: string; label: string; ref: string; at: string; href: string }[];
};

export type Messages = {
  channels: { channel: string; queued: number; sent: number; delivered: number; read: number; failed: number; skipped: number; total: number }[];
  codes: { asked: number; sent: number; failed: number; declined: number; unmatched: number; median_send_seconds: number | null };
  code_days: { day: string; asked: number; sent: number; failed: number }[];
  signins_by_method: Record<string, number>;
  breaker: {
    whatsapp_on: boolean;
    mode: string;
    state: string;
    reason: string | null;
    tripped_at: string | null;
    cleared_at: string | null;
    sender_signal: string | null;
    trips_30d: number;
  } | null;
  opt_outs: { opted_out_30d: number; stop_or_not_me_30d: number; email_signals_30d: Record<string, number> };
};

export type AuditRow = {
  at: string;
  who: string;
  group: "member" | "young" | "leader" | "team" | "pastoral" | "system" | "you";
  person_id: string | null;
  action: string;
  area: string;
  entity: string | null;
  ref: string | null;
};
export type Audit = { rows: AuditRow[]; next_before: string | null; young_hidden: boolean };
export type AuditArea = { prefix: string; label: string };

export type Threshold = { key: string; label: string; template: string; value: number; unit: string; action: string; href: string };
export type CatalogueEntry = { kind: string; label: string; area: string; fields: string[]; keep_months: number; reserved: boolean };
export type ActivitySettings = {
  recording: boolean;
  retention_months: number;
  last_refresh: string | null;
  last_backfill: string | null;
  min_group: number;
  thresholds: Threshold[];
  catalogue: CatalogueEntry[];
};

export type Tab = "pulse" | "funnels" | "stakeholders" | "integrity" | "messages" | "audit" | "settings";
