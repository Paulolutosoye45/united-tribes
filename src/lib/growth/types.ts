/** What the Stage 6 database functions return. The database is the source of truth; these only describe it. */
import type { TribeCardForMember, DegreeLabel } from "@/lib/matching/types";

// ---------------------------------------------------------------------------
// The matching model
// ---------------------------------------------------------------------------

export const MODEL_KEYS = ["goal", "stage", "community", "place", "style", "rhythm", "faith"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];
export type Weights = Record<ModelKey, number>;

export interface ModelRow {
  version: string;
  active: boolean;
  weights: Weights;
  min_degree: number;
  parent: string | null;
  notes: string | null;
  created_at: string;
  activated_at: string | null;
  created_by: string | null;
  /** What the proposal was built from; absent on the first, hand-set model. */
  trained: { sample?: ProposalSample; backtest?: Backtest; small?: boolean } | null;
  placements: number;
  results: { n: number; thriving: number };
  /** A model that has been used in a matching run is kept for good. */
  used: boolean;
}

export interface ProposalSample {
  n: number;
  thriving: number;
  other: number;
  seasons: number;
}

export interface Backtest {
  now: number | null;
  proposed: number | null;
}

export interface ProposalComponent {
  key: ModelKey;
  weight: number;
  thriving_avg: number | null;
  other_avg: number | null;
  lift: number | null;
  varies: boolean;
  proposed: number;
}

export interface RetrainPreview {
  base: string;
  base_weights: Weights;
  sample: ProposalSample;
  needed: number;
  enough: boolean;
  ready: boolean;
  components: ProposalComponent[];
  proposed: Weights;
  changed: boolean;
  backtest: Backtest;
}

// ---------------------------------------------------------------------------
// Changing tribe
// ---------------------------------------------------------------------------

export const SWAP_REASONS = ["time", "place", "fit", "conflict", "other"] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];
export type SwapStatus = "requested" | "offered" | "moved" | "declined" | "withdrawn" | "member_declined";

export interface MySwapRequest {
  id: string;
  status: SwapStatus;
  reason: SwapReason;
  note: string | null;
  created_at: string;
  by_coach: boolean;
  decision_note: string | null;
  offered: TribeCardForMember | null;
  offered_degree: number | null;
  offered_label: DegreeLabel | null;
}

export type MySwap =
  | { in_tribe: false }
  | {
      in_tribe: true;
      tribe: { id: string; name: string };
      season_started: boolean;
      week: number | null;
      window: { open: boolean; weeks: number };
      request: MySwapRequest | null;
    };

export interface SwapOption {
  tribe_id: string;
  name: string;
  degree: number;
  seats: number;
  leader_first_name: string;
  meeting_day: number;
  meeting_time: string;
  mode: "online" | "in_person";
  zone: string;
  community: string | null;
}

export interface SwapItem {
  id: string;
  status: SwapStatus;
  reason: SwapReason;
  note: string | null;
  person: { id: string; name: string; first_name: string };
  from: { id: string; name: string; leader: string; community: string | null };
  by_coach: boolean;
  wants: { id: string; name: string } | null;
  offered: { id: string; name: string; degree: number } | null;
  moved_to: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  options: SwapOption[];
}

export interface SwapQueue {
  weeks: number;
  items: SwapItem[];
}

// ---------------------------------------------------------------------------
// Multiplication
// ---------------------------------------------------------------------------

export const PLANS = ["assistant_leads", "leader_continues", "leader_rests", "closes"] as const;
export type Plan = (typeof PLANS)[number];
export type AssistantState = "none" | "in_training" | "certified";

export interface BoardTribe {
  id: string;
  name: string;
  leader: string;
  assistant: string | null;
  assistant_state: AssistantState;
  community: string | null;
  members: number;
  plan: Plan | null;
  plan_community_id: string | null;
  plan_community: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

export type MultiplicationBoard =
  | { state: "none" }
  | {
      state: "ok";
      season: { id: string; name: string; ends_on: string };
      summary: { tribes: number; with_assistant: number; certified: number; new_planned: number };
      tribes: BoardTribe[];
      communities: { id: string; name: string }[];
      gaps: { community: string | null; track: string | null; kind: string; members: number }[];
    };

// ---------------------------------------------------------------------------
// Teens and their parents or guardians
// ---------------------------------------------------------------------------

export type RelationshipKind = "mother" | "father" | "guardian" | "other";

export type GuardianState =
  | "not_needed"
  | "none"
  | "requested"
  | "expired"
  | "approved"
  | "ready"
  | "declined"
  | "withdrawn";

export type MyGuardian =
  | { needed: false; state: "not_needed"; track_open: boolean }
  | {
      needed: true;
      track_open: boolean;
      state: Exclude<GuardianState, "not_needed">;
      guardian_name: string | null;
      relationship: RelationshipKind | null;
      /** Masked: enough to tell it is the right address or number, never the whole of it. */
      sent_to: string | null;
      requested_at: string | null;
      answered_at: string | null;
      can_send: boolean;
      sends_left_today: number;
    };

export interface GuardianRequest {
  teen_first: string;
  guardian: string;
  relationship: RelationshipKind;
  status: "requested" | "approved" | "declined" | "withdrawn";
  expired: boolean;
  answered_at: string | null;
  consent_version: string | null;
  tribe: {
    name: string;
    leader: string;
    assistant: string | null;
    day: number;
    time: string;
    mode: "online" | "in_person";
    place: string | null;
  } | null;
}

export interface GuardianOverview {
  track_open: boolean;
  to_call: {
    person_id: string;
    teen: string;
    guardian: string;
    relationship: RelationshipKind;
    email: string | null;
    phone: string | null;
    answered_at: string;
    note: string | null;
  }[];
  waiting: { person_id: string; teen: string; guardian: string; relationship: RelationshipKind; requested_at: string; expired: boolean }[];
  said_no: { person_id: string; teen: string; status: "declined" | "withdrawn"; answered_at: string }[];
  ready: number;
  tribes_short: { id: string; name: string; members: number }[];
}
