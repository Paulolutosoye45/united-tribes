// Profile facts and the Details Check: what a person confirms about themselves, and how the office asks.

export const FACT_KEYS = ["life_stage", "age_range"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** confirmed: the person has said so (or typed it themselves). unconfirmed: someone else proposed it and the person has not answered. */
export type FactState = "confirmed" | "unconfirmed";

export type FactOption = { value: string; label: string; detail: string | null };

export type PageChange = { status: "pending" | "approved" | "declined"; newLabel: string; note: string | null; dueOn: string | null; at: string };

export type PageFact = {
  key: FactKey;
  label: string;
  question: string;
  state: FactState;
  value: string;
  valueLabel: string;
  by: string;
  at: string | null;
  options: FactOption[];
  change: PageChange | null;
  last: { event: string; at: string } | null;
};

/** My page. `enabled` false means the function is Off for this person and the screen shows nothing. */
export type PageState = { enabled: false } | { enabled: true; first: string; facts: PageFact[] };

export type AnswerAction = "yes" | "change" | "not_me" | "later";
export type Outcome = "confirmed" | "recorded" | "applied_now" | "pending_review" | "not_me" | "later";

export type Answered = { ok: true; outcome: Outcome } | { ok: false; reason: string; message: string | null };

// ---- stage reviews (the pastor) ----
export type StageReview = {
  id: string;
  status: "pending" | "approved" | "declined";
  person: string;
  first: string;
  fact: string;
  key: string;
  oldLabel: string | null;
  newLabel: string | null;
  tribe: string | null;
  members: number;
  requestedAt: string;
  dueOn: string;
  overdue: boolean;
  decidedAt: string | null;
  note: string | null;
};
export type StageReviews = { canDecide: boolean; reviews: StageReview[] };

/** Beside a Tribe Card: has the leader confirmed their stage, and does the card agree? Null when the Details Check is not open for them. */
export type StageStatus = {
  state: FactState;
  leader: string | null;
  card: string | null;
  differs: boolean;
  hold: "off" | "optional" | "required" | "rehearsal" | "on";
  pending: string | null;
};

// ---- the console ----
export const AUDIENCES = ["appointed", "leaders", "tribe", "list", "unconfirmed"] as const;
export type AudienceKind = (typeof AUDIENCES)[number];
export type Audience = { kind: "appointed" } | { kind: "leaders" } | { kind: "tribe"; tribe: string } | { kind: "list"; people: string[] } | { kind: "unconfirmed" };

export const LEFT_OUT_REASONS = ["no_fact", "already_confirmed", "under_18", "switch_off", "already_asked", "messages_off", "no_channel"] as const;
export type LeftOutReason = (typeof LEFT_OUT_REASONS)[number];

export type Plan = { asked: number; leftOut: Partial<Record<LeftOutReason, number>>; facts: FactKey[] };
export type Sent = { check: string; asked: number; mode: "rehearsal" | "live"; leftOut: Partial<Record<LeftOutReason, number>> };

export const ITEM_STATUSES = ["rehearsal", "queued", "confirmed", "changed", "pending_review", "not_me", "later", "no_reply", "closed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type CheckSummary = {
  id: string;
  at: string;
  mode: "rehearsal" | "live";
  facts: FactKey[];
  audience: string;
  asked: number;
  leftOut: Partial<Record<LeftOutReason, number>>;
  closed: boolean;
  counts: Partial<Record<ItemStatus, number>>;
};

export type CheckPerson = { id: string; name: string; status: ItemStatus; sent: boolean; channel: string | null; opened: boolean; reminded: boolean; asked: boolean; at: string; wouldSend: string | null };
export type CheckStatus = Omit<CheckSummary, "counts"> & { corrected: number; people: CheckPerson[] };

// ---- the private page ----
export type LinkState =
  | { found: false; reason: "signed_out" | "other_account" | null }
  | { found: true; needsCode: true }
  | { found: true; needsCode?: false; done: false; first: string; key: FactKey; label: string; question: string; valueLabel: string; options: FactOption[]; left: number }
  | { found: true; needsCode?: false; done: true; first: string; waiting: boolean };

export type CodeSent = { ok: true; via: "email" | "sms"; to: string } | { ok: false; reason: "invalid" | "locked" | "too_many" | "no_way"; minutes: number | null };
export type CodeChecked = { ok: true; session: string } | { ok: false; reason: "invalid" | "locked" | "expired" | "format" | "wrong"; minutes: number | null; triesLeft: number | null };
