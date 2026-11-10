/** Shapes returned by the Academy and Tribe Card functions in the Phase 3 migration. */

export type SessionKind = "practice_workshop" | "commissioning_workshop";
export type TribeStatus = "draft" | "submitted" | "changes_requested" | "approved" | "closed";
export type TribeMode = "online" | "in_person";
export type TribeType = "mixed" | "women" | "men";

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
  mode: TribeMode;
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
  /**
   * What the switches ask for. The keys above still say what was actually done. A key that is missing counts as needed, so an
   * older answer from the database reads as the process has always run.
   */
  modules_needed?: boolean;
  practice_needed?: boolean;
  declaration_needed?: boolean;
};

export type MyAcademy = {
  is_leader: boolean;
  pass_mark: number;
  modules: ModuleSummary[];
  sessions: SessionSummary[];
  attended: Record<SessionKind, boolean>;
  declaration: { version: string; signed_at: string } | null;
  practice: { ready: boolean; format: "co_lead" | "recorded"; note: string | null; assessed_at: string } | null;
  card: { id: string; status: TribeStatus; role: "leader" | "assistant" } | null;
  state: CertState;
  certified_at: string | null;
  /** The two switches and when each was last moved. Missing means both are required. */
  modes?: { academy: string; declaration: string; academy_since?: string | null; declaration_since?: string | null };
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
  /** The Academy's position. When it is off a leader cannot open the module, but the panel and administrators can read it. */
  mode?: string;
};

export type QuizResult = {
  score: number;
  passed: boolean;
  right: number;
  total: number;
  results: { position: number; right: boolean; explanation?: string }[];
};

export type Named = { id: string; name: string };

export type TribeCard = {
  id: string;
  status: TribeStatus;
  name: string | null;
  season: { id: string; name: string; starts_on: string };
  track: { slug: string; name: string } | null;
  community: { slug: string; name: string } | null;
  goal: { slug: string; title: string } | null;
  /** What the card cannot change. An appointment fixes the track, community and goal; a tribe formed by the Leader Desk also fixes the slot, format, area, kind and seats. */
  fixed: ("track" | "community" | "goal" | "slot" | "mode" | "zone" | "kind" | "capacity")[];
  tribe_type: TribeType;
  story: string | null;
  meeting_day: number | null;
  meeting_time: string | null;
  slot: string | null;
  duration_minutes: number;
  mode: TribeMode | null;
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

export type MyTribe = TribeCard & {
  role: "leader" | "assistant";
  missing: string[];
  module_ok: boolean;
  /** Whether the Success Picture module must be passed before the card is sent. False when the Academy is optional or off. */
  module_needed?: boolean;
  editable: boolean;
  certified: boolean;
  /** The link an online tribe meets on, set by the leader once the card is approved. */
  meeting_link?: string | null;
};

export type CohortRow = {
  person_id: string;
  name: string;
  role: "leader" | "assistant_leader";
  state: CertState;
  practice: { ready: boolean; format: "co_lead" | "recorded"; note: string | null; assessed_at: string } | null;
  card: { id: string; status: TribeStatus } | null;
  workshops: Record<SessionKind, "attended" | "booked" | "missed" | "to_mark" | null>;
};

export type SessionAdmin = {
  id: string;
  kind: SessionKind;
  starts_at: string;
  minutes: number;
  mode: TribeMode;
  place: string;
  capacity: number;
  booked: number;
  started: boolean;
  roster: { person_id: string; name: string; attended: boolean | null }[];
};

export type CardQueueItem = {
  id: string;
  status: TribeStatus;
  name: string | null;
  leader: string;
  assistant: string | null;
  coach: string | null;
  community: string | null;
  track: string | null;
  goal: string | null;
  submitted_at: string | null;
  published_at: string | null;
  certified: boolean;
};

export type CardReview = TribeCard & {
  leader_state: CertState;
  can_decide: boolean;
  coaches: { id: string; name: string; tribes: number }[];
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
