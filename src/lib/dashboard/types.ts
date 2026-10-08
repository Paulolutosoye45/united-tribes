/** What the database says about how the programme is doing. Every figure is worked out when read. */

export type Verdict = "before" | "too_early" | "on_course" | "close" | "at_risk" | "effective" | "not_yet";

export type Targets = {
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
};

export type SeasonInfo = {
  id: string;
  name: string;
  starts_on: string;
  weeks: number;
  current_week: number | null;
  /** Weeks that are over. */
  weeks_over: number;
  /** Meetings someone must come to, out of the season's weeks, to count as thriving. */
  meetings_needed: number;
};

export type Headline = {
  members: number;
  circles: number;
  /** False until three weeks have passed: no rate is shown before then. */
  measured: boolean;
  thriving: number;
  thriving_rate: number | null;
  attendance_rate: number | null;
  base_n: number;
  base_avg: number | null;
  latest_avg: number | null;
  gain_n: number;
  gain_avg: number | null;
  gain_share: number | null;
  steps_done_rate: number | null;
  checkin_rate: number | null;
  ever_came: number;
  still_coming: number;
  verdicts: { effective: number; not_yet: number; on_course: number; close: number; at_risk: number };
};

export type DashWeek = {
  week: number;
  current: boolean;
  logged: number;
  met: number;
  present: number;
  possible: number;
  steps_set: number;
  steps_done: number;
  steps_checked: number;
};

export type DashCircle = {
  circle_id: string;
  name: string;
  leader: string;
  coach: string | null;
  tribe: string | null;
  track: string | null;
  members: number;
  capacity: number;
  held: number;
  attendance_rate: number | null;
  thriving: number | null;
  thriving_rate: number | null;
  gain_n: number;
  gain_avg: number | null;
  gain_share: number | null;
  steps_done_rate: number | null;
  verdict: Verdict;
};

export type FunnelStep = { key: string; label: string; count: number };

export type SupplyCell = { tribe: string; track: string; wants: number; seats: number; placed: number };

export type Supply = {
  tribes: string[];
  tracks: string[];
  cells: SupplyCell[];
  wants: number;
  seats: number;
  placed: number;
  unmet: number;
};

export type TribeRow = { tribe: string; members: number; thriving_rate: number | null; gain_avg: number | null };

export type BandRow = { key: string; label: string; n: number; thriving_rate: number | null; attendance_rate: number | null };
export type RankRow = { rank: number; label: string; n: number; thriving_rate: number | null; attendance_rate: number | null };

export type Accuracy = {
  bands: BandRow[];
  ranks: RankRow[];
  average_degree: number | null;
  completed: number;
  retrain_after: number;
};

export type CareStats = {
  open: number;
  escalated: number;
  oldest_open_days: number | null;
  closed_7d: number;
  median_days_to_close: number | null;
};

export type TestimonyStats = { waiting: number; circle: number; church: number; declined: number };

export type Dashboard = {
  state: "none" | "before" | "running" | "complete";
  scope?: "church" | "coach";
  targets: Targets;
  season?: SeasonInfo;
  seasons?: { id: string; name: string; starts_on: string; weeks: number }[];
  headline?: Headline;
  weeks?: DashWeek[];
  circles?: DashCircle[];
  // Church only
  funnel?: FunnelStep[];
  supply?: Supply;
  tribes?: TribeRow[];
  accuracy?: Accuracy;
  care?: CareStats;
  testimonies?: TestimonyStats;
};

export type ProgressMember = {
  person_id: string;
  name: string;
  attended: number;
  steps_set: number;
  steps_done: number;
  pace: "on_pace" | "behind" | null;
};

export type ProgressWeek = {
  week: number;
  logged: boolean;
  held: boolean;
  present: number;
  marked: number;
  steps_set: number;
  steps_done: number;
  steps_checked: number;
};

export type CircleProgress = {
  state: "before" | "running" | "complete";
  targets: Targets;
  circle: { id: string; name: string; capacity: number };
  season: Omit<SeasonInfo, "id" | "starts_on"> & { name: string };
  members: number;
  attendance_rate: number | null;
  held: number;
  steps_done_rate: number | null;
  checkin_rate: number | null;
  can_see_rate: boolean;
  thriving: number | null;
  thriving_rate: number | null;
  verdict: Verdict | null;
  picture: {
    answers: number;
    base_avg: number | null;
    latest_avg: number | null;
    gain_n: number;
    gain_avg: number | null;
    gain_share: number | null;
  };
  weeks: ProgressWeek[];
  member_rows: ProgressMember[];
};

export type MyStanding = "before" | "too_early" | "on_pace" | "catching_up" | "thriving" | "not_yet";

export type MyProgress =
  | { placed: false }
  | {
      placed: true;
      state: "before" | "running" | "complete";
      status: MyStanding;
      targets: Targets;
      season: { weeks: number; current_week: number | null; weeks_over: number; meetings_needed: number };
      attended: number;
      held: number;
      steps: { set: number; done: number; partly: number; not_yet: number };
      pulses: { week: number; belonging: number; god: number; others: number; life: number; total: number }[];
      gain: number | null;
    };
