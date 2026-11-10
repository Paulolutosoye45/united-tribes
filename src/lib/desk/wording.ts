/**
 * The words of the Leader Desk's two emails to members (Phase 2a) and of the private page they open, kept in one place so the email, the page and the tests
 * cannot say different things. Nothing here reads a number, a score's inner parts, faith, stage, support or anyone else's name.
 *
 *   Tribe proposed    one open tribe a waiting member fits, with the fit and up to three reasons about the goal, the place and the time
 *   Interest check    a group still being put together, with no leader's name, and one question
 */

export const DESK_SLOTS: Record<string, string> = {
  "sunday-afternoon": "Sunday afternoons",
  "sunday-evening": "Sunday evenings",
  "weeknight-evening": "weeknight evenings",
  "saturday-morning": "Saturday mornings",
};
export const DESK_SLOT_KEYS = Object.keys(DESK_SLOTS);
export const isDeskSlot = (v: unknown): v is string => typeof v === "string" && DESK_SLOT_KEYS.includes(v);

export const DESK_ZONES: Record<string, string> = {
  "iganmu-surulere": "Iganmu and Surulere",
  mainland: "the Lagos mainland",
  "island-lekki": "the Island and Lekki",
  "other-nigeria": "elsewhere in Nigeria",
  abroad: "abroad",
};

/** Why a tribe fits, in a phrase that follows "We think so because". Only reasons about the goal, the place and the time. */
export const DESK_WHY: Record<string, string> = {
  goal_same: "it is working on the same goal as you",
  goal_family: "its goal is close to yours",
  community_same: "it is in the community you chose",
  place_online: "it meets online, so you can join from wherever you are",
  place_same: "it meets in your area",
  place_near: "it meets near you",
  rhythm_fit: "it meets at a time that fits the rhythm you told us about",
};

export const DESK_SUBJECT_MAX = 60;

const clean = (v: unknown, fallback = "") => (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim() || fallback;
const whole = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null);

export type DeskKind = "tribe" | "interest";
export type DeskAnswerKey = "yes" | "no" | "other_time" | "stop";
export const isDeskAnswer = (v: unknown): v is DeskAnswerKey => v === "yes" || v === "no" || v === "other_time" || v === "stop";

/** What the page shows about a proposal, as the database supplies it (worker_desk_info). Anything wrong parses as "no page". */
export type DeskInfo = {
  kind: DeskKind;
  open: boolean;
  first: string;
  answered: boolean;
  answer: DeskAnswerKey | null;
  slots: string[];
  stopped: boolean;
  expiresAt: string | null;
  tribe: string;
  leaderFirst: string;
  meetingDay: number | null;
  meetingTime: string;
  mode: string;
  zone: string | null;
  seatsLeft: number | null;
  degree: number | null;
  reasons: string[];
  community: string;
  goal: string;
  slot: string;
  capacity: number | null;
  hours: number | null;
};

export function parseDeskInfo(v: unknown): DeskInfo | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.found !== true || (o.kind !== "tribe" && o.kind !== "interest")) return null;
  const d = (typeof o.details === "object" && o.details !== null ? o.details : {}) as Record<string, unknown>;
  return {
    kind: o.kind,
    open: o.open === true,
    first: clean(o.first),
    answered: o.answered === true,
    answer: isDeskAnswer(o.answer) ? o.answer : null,
    slots: Array.isArray(o.slots) ? o.slots.filter(isDeskSlot) : [],
    stopped: o.stopped === true,
    expiresAt: typeof o.expires_at === "string" ? o.expires_at : null,
    tribe: clean(d.tribe),
    leaderFirst: clean(d.leader_first),
    meetingDay: whole(d.meeting_day),
    meetingTime: clean(d.meeting_time),
    mode: clean(d.mode),
    zone: typeof d.zone === "string" ? d.zone : null,
    seatsLeft: whole(d.seats_left),
    degree: whole(d.degree),
    reasons: Array.isArray(d.reasons) ? d.reasons.filter((k): k is string => typeof k === "string" && k in DESK_WHY).slice(0, 3) : [],
    community: clean(d.community),
    goal: clean(d.goal),
    slot: clean(d.slot),
    capacity: whole(d.capacity),
    hours: whole(d.hours),
  };
}

/** "We think so because it meets near you, and it meets at a time that fits the rhythm you told us about." Nothing when there is no reason to give. */
export function becauseLine(reasons: string[]): string | null {
  const parts = reasons.filter((k) => k in DESK_WHY).slice(0, 3).map((k) => DESK_WHY[k]);
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `We think so because ${joined}.`;
}

export const seatsLine = (n: number | null): string | null => (n === null || n < 1 ? null : n === 1 ? "There is 1 seat left." : `There are ${n} seats left.`);

/** "Sunday evenings, in person, on the Lagos mainland" / "Weeknight evenings, online". */
export function groupWhen(slot: string, mode: string, zone: string | null): string {
  const when = DESK_SLOTS[slot] ?? "a time still to be set";
  const where = mode === "online" ? "online" : `in person${zone && DESK_ZONES[zone] ? `, ${zone === "abroad" || zone === "other-nigeria" ? DESK_ZONES[zone] : `in ${DESK_ZONES[zone]}`}` : ""}`;
  return `${when[0].toUpperCase()}${when.slice(1)}, ${where}`;
}

/** The words on the private page and in the two emails' buttons. */
export const DESK_WORDS = {
  site: "United Tribes",
  buttons: {
    look: "Look at this tribe",
    yes: "Yes, count me in",
    no: "Not for me",
    time: "A different time",
    stop: "Stop these emails",
  },
  stop: "Stop these emails",
  tribeTitle: (first: string) => (first ? `${first}, a tribe that could suit you` : "A tribe that could suit you"),
  interestTitle: (first: string) => (first ? `${first}, would this group suit you?` : "Would this group suit you?"),
  notice: {
    nothingDecided: "Nothing is decided for you. If you want this seat, open the tribe and choose it, the same way as any other tribe.",
    nothingYet: "Saying yes does not give you a seat. It only tells us you would like to be in this group. If it goes ahead, we will write to you again.",
    noIsFine: "Saying no is a fine answer, and you stay on our list for another tribe.",
    silence: "If we do not hear from you, nothing changes. We will not place you in a group because you were silent.",
    stopWhy: "Stop these emails ends every email like this from the Leader Desk. You will still hear from your tribe and from the church as usual.",
  },
  done: {
    yes: "Thank you. You are counted in for this group. If it goes ahead, we will write to you again.",
    no: "Understood. You are off this one, and you stay on our list for another tribe.",
    other_time: "Thank you. We have noted the times that suit you better, and you stay on our list.",
    stop: "Done. The Leader Desk will not write to you again.",
  },
  closed: "This question has closed. You are still on our list, and nothing has changed for you.",
  gone: "This tribe is not available now. You are still on our list, and nothing has changed for you.",
  off: "This page is not open at the moment. Nothing has changed for you.",
  noPage: "We could not open this page. The link may have run out. Nothing has changed for you.",
  fault: "Something went wrong on our side. Nothing has changed for you. Please try again in a little while.",
  problem: "That didn’t save. Please try again.",
  chooseTimes: "Which times would suit you better? Choose one or more.",
  saveTimes: "Save these times",
  openTribes: "Open my tribes",
} as const;

export const DESK_EMAIL_SAMPLES = {
  desk_proposal: {
    kind: "tribe",
    first: "Ada",
    tribe: "Builders Tribe",
    leader_first: "Ngozi",
    meeting_day: 3,
    meeting_time: "20:00",
    mode: "in_person",
    zone: "mainland",
    seats_left: 4,
    degree: 82,
    fit: "strong",
    reasons: ["goal_same", "place_near", "rhythm_fit"],
    stop: true,
  },
  desk_interest: {
    kind: "interest",
    first: "Ada",
    community: "Professionals",
    goal: "Lead with excellence at work",
    slot: "weeknight-evening",
    mode: "in_person",
    zone: "mainland",
    capacity: 8,
    hours: 48,
    stop: true,
  },
} as const;
