/** Shapes returned by the review functions in the Phase 2 migration. */
export type QueueItem = {
  id: string;
  status: string;
  applicant: string;
  track: string | null;
  community: string | null;
  submitted_at: string | null;
  references_received: number;
  open_concern: boolean;
  calling_reviews: number;
  interview_reviews: number;
  i_reviewed_calling: boolean;
  i_reviewed_interview: boolean;
  interview_at: string | null;
};

export type Readiness = {
  /** Where the calling score came from: the reviewers, or the first check when it cleared the application. */
  calling_source?: "people" | "ai";
  calling: number | null;
  calling_reviews: number;
  scenarios: number | null;
  references: number | null;
  references_received: number;
  interview: number | null;
  interview_reviews: number;
  readiness: number | null;
  gates: { goal_declared: boolean; references_clean: boolean; open_concerns: number; pastor_or_unit_head_referee: boolean };
  band: "leader" | "assistant_leader" | "below" | null;
};

export type ReferenceView = {
  id: string;
  slot: number;
  name: string;
  relationship: string;
  contact: string;
  head: boolean;
  answered: boolean;
  reliability: number | null;
  warmth: number | null;
  confidentiality: number | null;
  maturity: number | null;
  concern: boolean | null;
  concern_note: string | null;
  concern_cleared: boolean | null;
  concern_cleared_note: string | null;
};

export type ReviewDetail = {
  id: string;
  status: string;
  applicant: string;
  whatsapp: string | null;
  submitted_at: string | null;
  answers: Record<string, unknown>;
  community_name: string | null;
  goal_title: string | null;
  scenario: { pct: number; detail: { scenario: string; best: number; worst: number }[] } | null;
  references: ReferenceView[];
  mine: { calling: { scores: Record<string, number>; notes: string | null } | null; interview: { scores: Record<string, number>; notes: string | null } | null };
  others: { calling: { reviewer: string; pct: number; notes: string | null }[] | null; interview: { reviewer: string; pct: number; notes: string | null }[] | null };
  interview: { starts_at: string; minutes: number; mode: string; place: string } | null;
  readiness: Readiness | null;
  can_decide: boolean;
  can_invite: boolean;
  decision_note: string | null;
  decided_at: string | null;
};

export type SlotView = {
  id: string;
  starts_at: string;
  minutes: number;
  mode: "online" | "in_person";
  place: string;
  panel: string | null;
  booked: boolean;
  application_id: string | null;
  applicant: string | null;
};

export type LeaderStats = {
  started: number;
  ineligible: number;
  submitted: number;
  in_review: number;
  interviews_booked: number;
  approved_leaders: number;
  approved_assistants: number;
  not_approved: number;
  open_slots: number;
  median_days_to_decision: number | null;
};

/** The first check's reading of one application, for the review page (leader_ai_scorecard). */
export type AiRun = {
  run: number;
  origin: string;
  shadow: boolean;
  ai_ran: boolean;
  scores: Record<string, number> | null;
  calling_pct: number | null;
  evidence: Record<string, { field: string; quote: string }[]>;
  reasons: Record<string, unknown>;
  flags: string[];
  confidence: number | null;
  outcome: string;
  model: string | null;
  at: string;
};

export type Scorecard = {
  mode: "off" | "shadow" | "on";
  state: string;
  basis: "ai" | "person";
  audit_sample: boolean;
  asked_person: boolean;
  rewrites_used: number;
  /** False for a coach who has not scored yet: the reading stays hidden so it cannot steer their own score. */
  visible: boolean;
  can_clear: boolean;
  can_send_back: boolean;
  run: AiRun | null;
  runs: { run: number; origin: string; shadow: boolean; outcome: string; calling_pct: number | null; at: string }[] | null;
  forced_fields: string[] | null;
  versions: { field: string; round: number; body: string; at: string }[] | null;
  duplicates: { id: string; applicant: string }[] | null;
};

/** One badge per application on the review queue (leader_ai_queue). */
export type QueueAi = { id: string; state: string; basis: "ai" | "person"; audit: boolean };
