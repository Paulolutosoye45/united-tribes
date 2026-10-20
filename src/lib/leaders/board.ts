/**
 * The supply-and-demand board for leaders (Phase 7): where members are waiting for a tribe and no leader is ready, who could be
 * suggested, and the offers made. The database does the counting and the scoring (the members-waiting figure is the one the
 * compatibility test reads); this reads what it says defensively and puts it in words. A figure that is not in the expected shape is
 * left out, never guessed.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const nat = (v: unknown): number => Math.max(0, int(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ---------------------------------------------------------------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------------------------------------------------------------

export type BoardGoal = {
  goalId: string;
  title: string;
  community: string;
  /** Members waiting for this goal with no seat in a tribe for it. */
  waiting: number;
  seatsOpen: number;
  /** Waiting less the seats already open. Above zero means a leader is needed. */
  gap: number;
  interestedFirst: number;
  interestedBackup: number;
  /** Whether the goal’s ready-made card is signed off, which an offer needs. */
  ready: boolean;
  card: string | null;
  openOffers: number;
};

export type FewOptions = { personId: string; name: string; shown: number; source: string; ranAt: string | null };

export type Board = {
  season: { id: string; name: string } | null;
  model: string | null;
  cardsSigned: number;
  /** One sentence saying what is not in place yet, or null. */
  missing: string | null;
  goals: BoardGoal[];
  fewOptions: FewOptions[];
};

export function parseBoard(json: unknown): Board | null {
  if (!isObject(json)) return null;
  const season = isObject(json.season) && isId(json.season.id) ? { id: json.season.id, name: str(json.season.name) ?? "This season" } : null;
  const goals: BoardGoal[] = [];
  if (Array.isArray(json.goals)) {
    for (const g of json.goals) {
      if (!isObject(g) || !isId(g.goal_id)) continue;
      const title = str(g.title);
      if (!title) continue;
      goals.push({
        goalId: g.goal_id,
        title,
        community: str(g.community_name) ?? "",
        waiting: nat(g.waiting),
        seatsOpen: nat(g.seats_open),
        gap: int(g.gap),
        interestedFirst: nat(g.interested_first),
        interestedBackup: nat(g.interested_backup),
        ready: g.ready === true,
        card: str(g.card),
        openOffers: nat(g.open_offers),
      });
    }
  }
  const fewOptions: FewOptions[] = [];
  if (Array.isArray(json.few_options)) {
    for (const f of json.few_options) {
      if (!isObject(f) || !isId(f.person_id)) continue;
      fewOptions.push({ personId: f.person_id, name: str(f.name) ?? "A leader", shown: nat(f.shown), source: str(f.source) ?? "", ranAt: str(f.ran_at) });
    }
  }
  return { season, model: str(json.model), cardsSigned: nat(json.cards_signed), missing: str(json.missing), goals, fewOptions };
}

/** Goals where members wait and no leader is ready, largest gap first (the database sorts them the same way). */
export const goalsInNeed = (board: Board): BoardGoal[] => board.goals.filter((g) => g.gap > 0);
export const otherGoals = (board: Board): BoardGoal[] => board.goals.filter((g) => g.gap <= 0 && (g.waiting > 0 || g.interestedFirst + g.interestedBackup > 0));

export const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;
export const leaders = (n: number): string => `${n} ${n === 1 ? "leader" : "leaders"}`;

/** What the numbers on one goal mean, as one sentence. */
export function gapSentence(g: BoardGoal): string {
  if (g.gap > 0) {
    const seats = g.seatsOpen > 0 ? `, and ${g.seatsOpen} ${g.seatsOpen === 1 ? "seat is" : "seats are"} open` : "";
    return `${people(g.waiting)} waiting${seats}. ${g.gap === 1 ? "One more seat is needed" : `${g.gap} more seats are needed`}.`;
  }
  if (g.waiting > 0) return `${people(g.waiting)} waiting, and the open seats cover them.`;
  return "Nobody is waiting.";
}

/** Leaders who said they would lead this goal, first choice and backup. */
export function interestSentence(g: BoardGoal): string {
  const { interestedFirst: a, interestedBackup: b } = g;
  if (a === 0 && b === 0) return "No leader has chosen it.";
  const first = a > 0 ? `${leaders(a)} chose it first` : "";
  const backup = b > 0 ? `${leaders(b)} named it as a backup` : "";
  return `${[first, backup].filter(Boolean).join(", ")}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------------------------------------------------------------

export type Suggestion = {
  personId: string;
  name: string;
  degree: number;
  label: "excellent" | "strong" | "good";
  /** Whether they chose this goal first, as a backup, or neither. */
  choice: "first" | "backup" | null;
  nextToTheirStage: boolean;
  reason: string;
};

export type Suggestions = {
  status: "ok" | "no_gap" | "no_card" | "no_model" | "no_season";
  message: string | null;
  waiting: number;
  seatsOpen: number;
  gap: number;
  model: string | null;
  suggestions: Suggestion[];
};

const STATUSES = ["ok", "no_gap", "no_card", "no_model", "no_season"] as const;
const LABELS = ["excellent", "strong", "good"] as const;

export function parseSuggestions(json: unknown): Suggestions | null {
  if (!isObject(json)) return null;
  const status = STATUSES.find((s) => s === json.status);
  if (!status) return null;
  const suggestions: Suggestion[] = [];
  if (Array.isArray(json.suggestions)) {
    for (const s of json.suggestions) {
      if (!isObject(s) || !isId(s.person_id)) continue;
      const label = LABELS.find((l) => l === s.label);
      if (!label) continue;
      suggestions.push({
        personId: s.person_id,
        name: str(s.name) ?? "A leader",
        degree: Math.min(100, nat(s.degree)),
        label,
        choice: s.choice === "first" || s.choice === "backup" ? s.choice : null,
        nextToTheirStage: s.next_to === true,
        reason: str(s.reason) ?? "Their answers fit this tribe.",
      });
    }
  }
  return { status, message: str(json.message), waiting: nat(json.waiting), seatsOpen: nat(json.seats_open), gap: int(json.gap), model: str(json.model), suggestions };
}

export const CHOICE_WORDS: Record<"first" | "backup", string> = {
  first: "Chose this tribe first",
  backup: "Named this tribe as a backup",
};

/** Said when nobody is suggested, in words that say why. */
export function noSuggestionsLine(s: Suggestions): string {
  if (s.status !== "ok") return s.message ?? "Nobody can be suggested yet.";
  return "No leader without a tribe fits this one well enough yet. A leader who has not joined a tribe this season may still be a good person to ask.";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------------------------------------------

export const OFFER_STATUSES = ["offered", "accepted", "declined", "withdrawn", "expired"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export type Offer = {
  id: string;
  personId: string;
  name: string;
  goalId: string;
  goal: string;
  community: string;
  status: OfferStatus;
  offeredAt: string | null;
  expiresAt: string | null;
  answeredAt: string | null;
  waitingAtOffer: number;
  tribeId: string | null;
  /** Null when the offer was made by the platform owner, whose name is never shown. */
  offeredBy: string | null;
};

export function parseOffers(json: unknown): Offer[] {
  if (!Array.isArray(json)) return [];
  const out: Offer[] = [];
  for (const o of json) {
    if (!isObject(o) || !isId(o.id) || !isId(o.person_id) || !isId(o.goal_id)) continue;
    const status = OFFER_STATUSES.find((s) => s === o.status);
    if (!status) continue;
    out.push({
      id: o.id,
      personId: o.person_id,
      name: str(o.name) ?? "A leader",
      goalId: o.goal_id,
      goal: str(o.goal) ?? "A tribe",
      community: str(o.community) ?? "",
      status,
      offeredAt: str(o.offered_at),
      expiresAt: str(o.expires_at),
      answeredAt: str(o.answered_at),
      waitingAtOffer: nat(o.waiting_at_offer),
      tribeId: isId(o.tribe_id) ? o.tribe_id : null,
      offeredBy: str(o.offered_by),
    });
  }
  return out;
}

export const OFFER_STATUS_WORDS: Record<OfferStatus, string> = {
  offered: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Not answered in time",
};

/** The leader’s own open offer (what the Lead page shows). */
export type MyOffer = {
  offerId: string;
  goalId: string;
  goal: string;
  community: string;
  /** How many are waiting now, which can differ from when the offer was made. */
  waiting: number;
  waitingAtOffer: number;
  offeredAt: string | null;
  expiresAt: string | null;
};

export function parseMyOffer(json: unknown): MyOffer | null {
  if (!isObject(json) || !isId(json.offer_id) || !isId(json.goal_id)) return null;
  const goal = str(json.goal);
  if (!goal) return null;
  return {
    offerId: json.offer_id,
    goalId: json.goal_id,
    goal,
    community: str(json.community) ?? "",
    waiting: nat(json.waiting),
    waitingAtOffer: nat(json.waiting_at_offer),
    offeredAt: str(json.offered_at),
    expiresAt: str(json.expires_at),
  };
}

/** "Nine people are waiting": a count in words up to twelve, the same way the message to the leader says it. */
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
export function waitingLine(n: number): string {
  const count = Math.max(1, Math.floor(n) || 1);
  if (count === 1) return "One person is waiting";
  return `${count < WORDS.length ? WORDS[count] : String(count)} people are waiting`;
}

/** The offer on the leader’s page: what changed since it was made, said plainly. */
export function offerFootnote(o: MyOffer): string | null {
  if (o.waiting === 0) return "Everyone who was waiting has now found a seat elsewhere, but the offer stands if you would still like to lead this tribe.";
  if (o.waiting < o.waitingAtOffer) return `When we asked, ${o.waitingAtOffer} were waiting.`;
  return null;
}

const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }) : "");
export const dayOf = day;
