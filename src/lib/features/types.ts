// The Switchboard: what each new function (Profiles and the Weekly Rhythm, WhatsApp reliability, the required number, removal requests) is doing, and where.

/** Every function the blueprint lists. A key here without `available` in the database cannot be moved from Off until its stage ships. */
export const FEATURE_KEYS = [
  "my_page",
  "details_check",
  "hold_card",
  "my_details",
  "my_story",
  "role_panels",
  "still_right",
  "photos",
  "visibility",
  "our_tribe",
  "encourage",
  "week_line",
  "directory",
  "weekly_rhythm",
  "thanks",
  "fruit",
  "personal_fruit",
  "pulse",
  "shepherd_hour",
  "coach_card",
  "rest_week",
  "whatsapp_guard",
  "whatsapp_health",
  "number_required",
  "removal_requests",
  "whatsapp_mode",
  "contact_gaps",
  "reach_series",
  "tribe_note",
  "placed_nudge",
  "placed_answers",
  "leader_desk",
  "seat_window",
  "reach_release",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const POSITIONS = ["off", "rehearsal", "on", "optional", "required"] as const;
export type Position = (typeof POSITIONS)[number];

export const SCOPES = ["platform", "centre", "community", "tribe", "person"] as const;
export type Scope = (typeof SCOPES)[number];

/** What a screen is told for one function, for the signed-in person: nothing, a rehearsal, or live. The hold function also says optional or required. */
export type FeatureState = "off" | "rehearsal" | "on" | "optional" | "required";
export type FeatureStates = Partial<Record<FeatureKey, FeatureState>>;

/** One word for how a function stands overall. */
export type Summary = "off" | "rehearsal" | "limited" | "on" | "optional" | "required";

export type Rule = {
  id: string;
  scope: Scope;
  scopeId: string | null;
  label: string;
  position: Position;
  roles: string[];
  reason: string | null;
  holdoutUntil: string | null;
  at: string;
};

export type FeatureRow = {
  key: FeatureKey;
  name: string;
  blurb: string;
  stage: number;
  depends: FeatureKey[];
  modes: Position[];
  default: Position;
  available: boolean;
  /** True for a function that only makes sense for the whole church: its switch has no place or role to choose. */
  platformOnly: boolean;
  summary: Summary;
  rules: Rule[];
};

export type FeatureBoard = {
  paused: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  features: FeatureRow[];
};

export type FeatureLogLine = {
  id: number;
  at: string;
  feature: string | null;
  name: string | null;
  scope: string;
  label: string | null;
  from: string | null;
  to: string | null;
  roles: string[];
  reason: string | null;
};

/** The read-only view for the pastor, directors and the admin. The owner is only ever "an administrator". */
export type FeaturesOverview = {
  paused: boolean;
  features: { key: FeatureKey; name: string; blurb: string; stage: number; available: boolean; summary: Summary; depends: FeatureKey[] }[];
  log: { at: string; by: string; name: string | null; label: string | null; from: string | null; to: string | null; reason: string | null }[];
};

export type Found = { id: string; label: string };
