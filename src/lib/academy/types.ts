/** Shapes returned by the Academy and Circle Card functions in the Phase 3 migration. */

export type SessionKind = "practice_workshop" | "commissioning_workshop";
export type CircleStatus = "draft" | "submitted" | "changes_requested" | "approved" | "closed";
export type CircleMode = "online" | "in_person";
export type CircleType = "mixed" | "women" | "men";

export type ModuleSummary = {
  slug: string;
  number: number;
  title: string;
  outcome: string;
  format: string;
  minutes: number;
  opened: boolean;
  attempts: number;
  best: number | null;
  passed: boolean;
};

export type SessionSummary = {
  id: string;
  kind: SessionKind;
  starts_at: string;
  minutes: number;
  mode: CircleMode;
  /** The place or link, shown only to people who have booked. */
  place: string | null;
  seats_left: number;
  booked: boolean;
  can_cancel: boolean;
};

export type CertState = {
  modules_total: number;
  modules_passed: number;
  modules_done: boolean;
  declaration: boolean;
  practice: boolean;
  card_required: boolean;
  card: boolean;
  certified: boolean;
};

export type MyAcademy = {
  is_leader: boolean;
  pass_mark: number;
  modules: ModuleSummary[];
  sessions: SessionSummary[];
  attended: Record<SessionKind, boolean>;
  declaration: { version: string; signed_at: string } | null;
  practice: { ready: boolean; format: "co_lead" | "recorded"; note: string | null; assessed_at: string } | null;
  card: { id: string; status: CircleStatus; role: "leader" | "assistant" } | null;
  state: CertState;
  certified_at: string | null;
};

export type Section = { title: string; body?: string[]; points?: string[] };

export type ModuleDetail = {
  module: {
    slug: string;
    number: number;
    title: string;
    outcome: string;
    format: string;
    minutes: number;
    lesson: Section[];
    practice: string | null;
  };
  questions: { position: number; prompt: string; options: string[] }[];
  progress: { attempts: number; best: number | null; passed: boolean };
  previous: string | null;
  next: string | null;
  pass_mark: number;
  can_take: boolean;
};

export type QuizResult = {
  score: number;
  passed: boolean;
  right: number;
  total: number;
  results: { position: number; right: boolean; explanation?: string }[];
};

export type Named = { id: string; name: string };

export type CircleCard = {
  id: string;
  status: CircleStatus;
  name: string | null;
  season: { id: string; name: string; starts_on: string };
  track: { slug: string; name: string } | null;
  tribe: { slug: string; name: string } | null;
  goal: { slug: string; title: string } | null;
  fixed: ("track" | "tribe" | "goal")[];
  circle_type: CircleType;
  story: string | null;
  meeting_day: number | null;
  meeting_time: string | null;
  slot: string | null;
  duration_minutes: number;
  mode: CircleMode | null;
  zone: string | null;
  place_note: string | null;
  capacity: number;
  god: string | null;
  others: string | null;
  life: string | null;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  leader: Named;
  assistant: Named | null;
  coach: Named | null;
};

export type MyCircle = CircleCard & {
  role: "leader" | "assistant";
  missing: string[];
  module_ok: boolean;
  editable: boolean;
  certified: boolean;
};

export type CohortRow = {
  person_id: string;
  name: string;
  role: "leader" | "assistant_leader";
  state: CertState;
  practice: { ready: boolean; format: "co_lead" | "recorded"; note: string | null; assessed_at: string } | null;
  card: { id: string; status: CircleStatus } | null;
  workshops: Record<SessionKind, "attended" | "booked" | "missed" | "to_mark" | null>;
};

export type SessionAdmin = {
  id: string;
  kind: SessionKind;
  starts_at: string;
  minutes: number;
  mode: CircleMode;
  place: string;
  capacity: number;
  booked: number;
  started: boolean;
  roster: { person_id: string; name: string; attended: boolean | null }[];
};

export type CardQueueItem = {
  id: string;
  status: CircleStatus;
  name: string | null;
  leader: string;
  assistant: string | null;
  coach: string | null;
  tribe: string | null;
  track: string | null;
  goal: string | null;
  submitted_at: string | null;
  published_at: string | null;
  certified: boolean;
};

export type CardReview = CircleCard & {
  leader_state: CertState;
  can_decide: boolean;
  coaches: { id: string; name: string; circles: number }[];
};

export type AssistantSuggestion = {
  person_id: string;
  name: string;
  style: string | null;
  style_label: string | null;
  fit: number;
  reason: string;
  certified: boolean;
  paired_here: boolean;
};

export type AcademyStats = {
  trainees: number;
  leaders: number;
  assistants: number;
  certified: number;
  certified_leaders: number;
  certified_assistants: number;
  practice_ready: number;
  declarations: number;
  cards_submitted: number;
  cards_approved: number;
  cards_paired: number;
  upcoming_workshops: number;
  modules: { number: number; title: string; opened: number; passed: number }[];
};
