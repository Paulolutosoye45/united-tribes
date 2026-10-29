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

/** The facts a person types or picks (layer "facts") and the words they write about themselves (layer "story"). */
export const DETAIL_KEYS = ["preferred_name", "area", "birthday"] as const;
export const STORY_KEYS = ["about_me", "gifts", "ask_me", "pray_for_me"] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type StoryKey = (typeof STORY_KEYS)[number];

/** How the field is asked: a short text, a choice from a list, a day and month, or up to three gifts. */
export type DetailKind = "text" | "choice" | "monthday" | "gifts";

export type PageDetail = {
  key: DetailKey | StoryKey;
  label: string;
  question: string;
  kind: DetailKind;
  /** A: saved at once, nothing else moves. B: saved at once, suggested tribes are worked out again from the next look. */
  changeClass: "A" | "B";
  /** Empty when nothing has been written. For gifts, the chosen values joined by commas; for a birthday, MM-DD. */
  value: string;
  valueLabel: string;
  at: string | null;
  options: FactOption[];
  max: number | null;
  limit: number | null;
};

export type PanelLine = { label: string; value: string };
export type PagePanel = { key: string; title: string; lines: PanelLine[]; link: { label: string; path: string } | null };

/** Where a person's "Ask the church office" stands: waiting for the Care Team, or looked at (with the note they left). */
export type OfficeStatus = { status: "open" | "done"; askedAt: string; closedAt: string | null; note: string | null };

/** My page. `enabled` false means the function is Off for this person and the screen shows nothing. */
export type PageState =
  | { enabled: false }
  | { enabled: true; first: string; facts: PageFact[]; details: PageDetail[]; story: PageDetail[]; panels: PagePanel[]; canAsk: boolean; office: OfficeStatus | null };

/** What saving a typed fact or story field says back. */
export type Saved = { ok: true; outcome: "saved" | "cleared" } | { ok: false; reason: string; message: string | null };
export type OfficeAsked = { ok: true } | { ok: false; reason: string; message: string | null };

/** The once-a-season strip on Home: the facts that may have moved since the season began. */
export type StillRightItem = { key: FactKey; label: string; valueLabel: string; options: FactOption[] };
export type StillRight = { due: false } | { due: true; season: string; items: StillRightItem[] };

/** The Care Team's list of people who said their age range is not right. */
export type OfficeAsk = {
  id: string;
  status: "open" | "done";
  person: string;
  held: string;
  note: string | null;
  askedAt: string;
  closedAt: string | null;
  closingNote: string | null;
};

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
