/** What the weekly-rhythm functions return. The database is the source of truth. */

export type Theme = "begin" | "loving_god" | "loving_others" | "loving_life" | "review" | "finish";
export type Outcome = "done" | "partly" | "not_yet";
export type Attendance = "present" | "absent" | "excused";
export type NudgeKind = "set_step" | "check_in" | "pulse" | "testimony";
export type ReportStatus = "on_track" | "watch" | "needs_attention" | "no_log" | "upcoming";
export type FlagKind = "missed_twice" | "not_yet_twice" | "low_belonging" | "leader_concern";
export type FlagStatus = "open" | "escalated" | "closed";
export type CallOutcome = "reached" | "not_reached" | "needs_care_lead";

export interface MemberGuide {
  week: number;
  theme: Theme;
  title: string;
  passage: string;
  big_idea: string;
  opening_question: string;
  questions: string[];
  practice: string;
  step_hint: string;
  prayer: string;
}

export interface PlanSegment {
  minutes: number;
  title: string;
  how: string;
}

export interface LeaderGuide extends MemberGuide {
  plan: PlanSegment[];
  leader_tip: string;
}

export interface Picture {
  god: string;
  others: string;
  life: string;
  refined: boolean;
}

export interface WeekRow {
  week: number;
  state: "past" | "now" | "future";
  held: boolean | null;
  attended: Attendance | null;
  step: "set" | Outcome | null;
}

export interface Nudge {
  kind: NudgeKind;
  week: number;
}

export interface MyWeekPlaced {
  placed: true;
  state: "before" | "running" | "complete";
  week: number | null;
  viewing: number | null;
  weeks: number;
  starts_on: string;
  ends_on: string;
  days_to_start: number | null;
  season_name: string;
  circle: {
    id: string;
    name: string;
    leader_first_name: string;
    meeting_day: number;
    meeting_time: string;
    meeting_mode: "online" | "in_person";
    group_url: string | null;
    meeting_date: string | null;
  };
  picture: Picture;
  guide: MemberGuide | null;
  step: { week: number; when: string; will: string; outcome: Outcome | null; reflection: string | null } | null;
  check_in: { week: number | null; opens_on: string | null; closes_on: string | null };
  pulse_week: number | null;
  rows: WeekRow[];
  attended: number;
  logged: number;
  testimonies: number;
  nudges: Nudge[];
}

export type MyWeek = { placed: false } | MyWeekPlaced;

export interface RhythmTestimony {
  id: string;
  week: number;
  body: string;
  share_with: "Tribe" | "church";
  credit: "full_name" | "first_name" | "anonymous";
  status: "submitted" | "Tribe_approved" | "church_approved" | "declined" | "withdrawn";
  mine: boolean;
  decline_note: string | null;
  by: string;
  created_at: string;
}

export interface WeekReport {
  week: number;
  meeting_date: string;
  logged: boolean;
  held: boolean | null;
  highlight: string | null;
  members: number;
  present: number;
  absent: number;
  excused: number;
  attendance_rate: number | null;
  steps_set: number;
  steps_done: number;
  steps_partly: number;
  steps_not_yet: number;
  pulse_week: boolean;
  pulse_answers: number | null;
  belonging_average: number | null;
  follow_ups_open: number;
  follow_ups_escalated: number;
  testimonies: number;
  status: ReportStatus;
}

export interface WeekMember {
  person_id: string;
  name: string;
  first_name: string;
  whatsapp: string | null;
  attendance: Attendance | null;
  last_attendance: Attendance | null;
  attended: number;
  step: "none" | "set" | Outcome | null;
  open_follow_up: boolean;
}

export interface FollowUp {
  id: string;
  person_id: string;
  name: string;
  first_name: string;
  whatsapp: string | null;
  kind: FlagKind;
  status: FlagStatus;
  attempts: number;
  last_outcome: CallOutcome | null;
  note: string | null;
  opened_at: string;
  last_called_at: string | null;
}

export interface Celebration {
  kind: "birthday" | "every_meeting" | "steps_streak";
  first_name: string;
  on?: string;
}

export interface CircleWeek {
  circle: { id: string; name: string; status: string; capacity: number; meeting_day: number; meeting_time: string };
  state: "before" | "running" | "complete";
  season_name: string;
  starts_on: string;
  weeks: number;
  current_week: number | null;
  week: number;
  week_starts_on: string;
  meeting_date: string;
  can_edit: boolean;
  log_open: boolean;
  guide: LeaderGuide;
  picture: Picture & { can_refine: boolean };
  log: { held: boolean; highlight: string | null; logged_at: string } | null;
  members: WeekMember[];
  logged_weeks: number;
  follow_ups: FollowUp[];
  celebrations: Celebration[];
  report: WeekReport;
  last_report: WeekReport | null;
  testimonies_waiting: number;
}

export interface PendingTestimony {
  id: string;
  week: number;
  body: string;
  share_with: "Tribe" | "church";
  credit: "full_name" | "first_name" | "anonymous";
  by: string;
  circle: string;
  status?: "submitted" | "Tribe_approved";
  created_at: string;
}

export interface Digest {
  state: "none" | "before" | "running" | "complete";
  season_name?: string;
  starts_on?: string;
  weeks?: number;
  current_week?: number | null;
  week?: number;
  circles?: { circle_id: string; name: string; leader: string; coach: string | null; report: WeekReport }[];
  totals?: {
    circles: number;
    logged: number;
    not_logged: number;
    needs_attention: number;
    watch: number;
    present: number;
    members: number;
    follow_ups: number;
  };
}

export interface CareItem {
  id: string;
  name: string;
  whatsapp: string | null;
  circle: string;
  leader: string;
  kind: FlagKind;
  status: FlagStatus;
  attempts: number;
  last_outcome: CallOutcome | null;
  note: string | null;
  opened_at: string;
  last_called_at: string | null;
}
