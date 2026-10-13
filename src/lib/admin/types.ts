/** What an action gives back to the screen: whether it worked, and if not, why (in words a person can act on). */
export type Result = { ok: true } | { ok: false; message: string };

/** What the office screens read. The database builds each of these; see supabase/migrations/20261206000100_admin_hub.sql. */

export const SEASON_STATUSES = ["planning", "open", "running", "closed"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export type AdminSeason = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  weeks: number;
  status: SeasonStatus;
  sermon_series: string | null;
  /** 0 before it starts, 1 to weeks while it runs, weeks + 1 once it is over. */
  week: number;
  tribes: number;
  approved: number;
  members: number;
  can_move_dates: boolean;
};
export type AdminSeasons = { today: string; can_edit: boolean; seasons: AdminSeason[] };

export type CatalogueGoal = {
  id: string;
  title: string;
  family_id: string;
  family: string;
  active: boolean;
  /** Members who chose it in the current season. */
  picked: number;
  ever: number;
  tribes: number;
};
export type CatalogueCommunity = { id: string; slug: string; name: string; description: string; active: boolean; goals: CatalogueGoal[] };
export type CatalogueFamily = { id: string; name: string; goals: number };
export type CatalogueTrack = {
  id: string;
  slug: string;
  name: string;
  description: string;
  min_age: number;
  max_age: number | null;
  active: boolean;
  ranges: string[];
};
export type AdminCatalogue = {
  can_edit: boolean;
  teens_allowed: boolean;
  communities: CatalogueCommunity[];
  families: CatalogueFamily[];
  tracks: CatalogueTrack[];
};
export type WriteIn = { text: string; community_id: string | null; community: string | null; count: number };

export type GuideSummary = {
  week: number;
  theme: string;
  title: string;
  passage: string;
  sermon_series: string | null;
  sermon_title: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type GuideList = { can_edit: boolean; guides: GuideSummary[] };

export type Guide = GuideSummary & {
  can_edit: boolean;
  big_idea: string;
  opening_question: string;
  questions: [string, string, string];
  practice: string;
  step_hint: string;
  prayer: string;
  confession: string | null;
  leader_tip: string;
  word_how: string;
  talk_how: string;
};
/** What the form sends back. Same fields, nothing computed. */
export type GuideDraft = Omit<Guide, "can_edit" | "week" | "theme" | "reviewed_at" | "reviewed_by">;

export type LayerGoal = { id: string; title: string; ideas: (string | null)[] };
export type LayerCommunity = { id: string; name: string; active: boolean; prompts: (string | null)[]; goals: LayerGoal[] };
export type Layers = { can_edit: boolean; communities: LayerCommunity[] };

export type ChurchSettings = { vision: string | null; mission: string | null; testimony_form_url: string | null; can_edit: boolean };
export type PlatformFlag = { key: string; enabled: boolean; note: string | null };
export type PlatformStatus = { flags: PlatformFlag[]; centres: number };

export type CheckItem =
  | { key: "season"; ok: boolean; name: string | null; starts_on: string | null; status: SeasonStatus | null }
  | { key: "team"; ok: boolean; missing: string[] }
  | { key: "words"; ok: boolean; vision: boolean; mission: boolean }
  | { key: "guides"; ok: boolean; reviewed: number; of: number }
  | { key: "tribes"; ok: boolean; approved: number }
  | { key: "messages"; ok: boolean; tokens: number; last_used_at: string | null }
  | { key: "champions"; ok: boolean; covered: number; of: number }
  | { key: "testimony_form"; ok: boolean }
  | { key: "bi"; ok: boolean; refreshed_at: string | null };
export type Checklist = { items: CheckItem[] };

export type TargetRow = {
  key: string;
  value: number;
  default: number;
  min: number;
  max: number;
  whole: boolean;
  custom: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

export type Champion = { person_id: string; name: string; community_id: string; community: string; since: string };
export type PersonHit = { id: string; name: string; email: string; roles: string[] };

export type BiStatus = { refreshed_at: string | null; reader_role: string; views: { name: string; rows: number }[] };

export type MessageRow = {
  id: string;
  to: string | null;
  template: string;
  channel: string | null;
  status: string;
  urgency: string;
  tried: string[] | null;
  attempts: number;
  error: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};
export type MessageStats = {
  days: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  by_channel: Record<string, number>;
  by_template: { template: string; count: number }[];
  last_sent_at: string | null;
  last_worker_seen: string | null;
};
export const MESSAGE_STATUSES = ["queued", "sending", "sent", "delivered", "read", "failed", "skipped"] as const;

export type TokenRow = { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type CentreRow = { id: string; name: string; slug: string; active: boolean; roles: string[] | null };
export type MyCentres = { multi: boolean; current: { id: string; name: string; slug: string } | null; centres: CentreRow[] };

export const ERASURE_BLOCKERS = ["is_you", "leads_a_tribe", "needs_an_admin", "last_admin"] as const;
export type ErasureBlocker = (typeof ERASURE_BLOCKERS)[number];

/** One member's request to have their account deleted, with what the deletion would touch. */
export type ErasureRequest = {
  person: string;
  name: string;
  email: string;
  status: "open" | "declined";
  note: string | null;
  by_office: boolean;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  roles: string[];
  in_tribes: number;
  care_records: number;
  blockers: ErasureBlocker[];
};
