/**
 * The words of the Leader Desk's emails to members (Phase 2a and 2b) and of the private pages they open, kept in one place so the email, the page and the tests
 * cannot say different things. Nothing here reads a number, a score's inner parts, faith, stage, support or anyone else's name.
 *
 *   Tribe proposed    one open tribe a waiting member fits, with the fit and up to three reasons about the goal, the place and the time
 *   Interest check    a group still being put together, with no leader's name, and one question
 *   Leader found      "Your group has a leader": the leader's first name, no seat promised, and one question
 *   Leader offer      "Would you lead this group?": asked of one member (and, in turn, up to two backups), answered on a page of its own (OFFER_WORDS below)
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

export type DeskKind = "tribe" | "interest" | "found";
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
  if (o.found !== true || (o.kind !== "tribe" && o.kind !== "interest" && o.kind !== "found")) return null;
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
  foundTitle: (first: string) => (first ? `${first}, your group has a leader` : "Your group has a leader"),
  notice: {
    nothingDecided: "Nothing is decided for you. If you want this seat, open the tribe and choose it, the same way as any other tribe.",
    nothingYet: "Saying yes does not give you a seat. It only tells us you would like to be in this group. If it goes ahead, we will write to you again.",
    noIsFine: "Saying no is a fine answer, and you stay on our list for another tribe.",
    silence: "If we do not hear from you, nothing changes. We will not place you in a group because you were silent.",
    stopWhy: "Stop these emails ends every email like this from the Leader Desk. You will still hear from your tribe and from the church as usual.",
    foundNothingDecided:
      "Saying yes does not give you a seat. The pastors still have to approve this group before it opens. If it goes ahead, we will write to you with your place.",
    foundNoIsFine: "Saying no is a fine answer, and you stay on our list for another tribe.",
  },
  found: {
    yes: "Thank you. We have noted that you are still interested. If the group goes ahead, we will write to you with your place.",
    no: "Understood. You are off this group, and you stay on our list for another tribe.",
    button: "Yes, I am still interested",
    about: (leader: string) => (leader ? `${leader} has said yes to leading it.` : "Someone has said yes to leading it."),
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

// ---------------------------------------------------------------------------
// "Would you lead this group?" (Phase 2b): the email and the page of its own at /o/<secret>
// ---------------------------------------------------------------------------

/** The answers the offer page can send, as the database reads them (worker_desk_offer_answer). */
export type OfferAnswerKey = "lead" | "assist" | "not_season" | "call" | "tomorrow" | "never" | "stop";
export const OFFER_ANSWERS: OfferAnswerKey[] = ["lead", "assist", "not_season", "call", "tomorrow", "never", "stop"];
export const isOfferAnswer = (v: unknown): v is OfferAnswerKey => typeof v === "string" && (OFFER_ANSWERS as string[]).includes(v);

/** The reasons a member can give for "Not this season". Kept, counted and shown to nobody by name. */
export const OFFER_REASONS: { id: string; label: string }[] = [
  { id: "busy", label: "I am too busy right now" },
  { id: "family", label: "Family or home comes first right now" },
  { id: "not_ready", label: "I do not feel ready yet" },
  { id: "other_goal", label: "I would rather lead a different goal" },
  { id: "other", label: "Something else" },
];
export const OFFER_REASON_IDS = OFFER_REASONS.map((r) => r.id);
export const isOfferReason = (v: unknown): v is string => typeof v === "string" && OFFER_REASON_IDS.includes(v);

export type OfferInfo = {
  open: boolean;
  status: string;
  first: string;
  answer: string | null;
  callMe: boolean;
  reminderSet: boolean;
  stopped: boolean;
  /** Whether "Yes, as assistant" is still free for this group (only one member can offer to assist a group). */
  assistOpen: boolean;
  ends: string;
  community: string;
  goal: string;
  slot: string;
  mode: string;
  zone: string | null;
  capacity: number | null;
  members: number;
  asked: boolean;
  yes: number;
  hours: number | null;
};

/** What the offer page shows, as the database supplies it (worker_desk_offer_info). Anything wrong parses as "no page". */
export function parseOfferInfo(v: unknown): OfferInfo | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.found !== true) return null;
  const d = (typeof o.details === "object" && o.details !== null ? o.details : {}) as Record<string, unknown>;
  return {
    open: o.open === true,
    status: clean(o.status),
    first: clean(o.first),
    answer: typeof o.answer === "string" ? o.answer : null,
    callMe: o.call_me === true,
    reminderSet: o.reminder_set === true,
    stopped: o.stopped === true,
    assistOpen: o.assist_open === true,
    ends: typeof d.ends === "string" ? clean(d.ends) : "",
    community: clean(d.community),
    goal: clean(d.goal),
    slot: clean(d.slot),
    mode: clean(d.mode),
    zone: typeof d.zone === "string" ? d.zone : null,
    capacity: whole(d.capacity),
    members: whole(d.members) ?? 0,
    asked: d.asked === true,
    yes: whole(d.yes) ?? 0,
    hours: whole(d.hours),
  };
}

/** "6 people are on its list so far, and 3 of them have said they would like to join." Counts only, and nothing when there is nothing to say. */
export function offerCountLine(members: number, asked: boolean, yes: number): string | null {
  if (members < 1) return null;
  const list = members === 1 ? "1 person is on its list so far" : `${members} people are on its list so far`;
  if (!asked || yes < 1) return `${list}.`;
  return `${list}, and ${yes === 1 ? "1 of them has" : `${yes} of them have`} said they would like to join.`;
}

export const OFFER_WORDS = {
  site: "United Tribes",
  title: (first: string) => (first ? `${first}, would you lead this group?` : "Would you lead this group?"),
  reminder: {
    "24": "A reminder: this question closes tomorrow.",
    "12": "A reminder: this question closes in about 12 hours.",
    tomorrow: "You asked us to remind you about this today.",
  } as Record<string, string>,
  buttons: {
    lead: "Yes, I will lead",
    assist: "Yes, as assistant",
    sendAssist: "Send my yes",
    notSeason: "Not this season",
    call: "Call me",
    tomorrow: "Remind me tomorrow",
    never: "Never ask me to lead",
    stop: "Stop these emails",
    sendYes: "Send my yes",
    sendReasons: "Send",
  },
  notice: {
    ask: "We think you could lead it. Leading a group means walking with a small group of people through one season, and keeping them going towards a goal.",
    support: "You would not do this alone. The pastors review the group before it opens, and the Academy walks you through what to do before you start.",
    nothingYet: "Saying yes starts your tribe card and tells the people who showed interest that this group has a leader. It does not open the group: a pastor still approves the card, and you finish the Academy before members are matched to you.",
    noIsFine: "Saying no is a fine answer. We will ask someone else, and we will not ask you about this group again.",
    silence: "If we do not hear from you, the question closes and nothing changes for you.",
    stopWhy: "Stop these emails ends every email like this from the Leader Desk. You will still hear from the church as usual.",
    neverWhy: "Never ask me to lead means the Leader Desk will not ask you to lead any group. You will still hear about tribes you could join.",
    reasonsWhy: "Your reasons are kept private. They are only counted, and nobody sees which are yours.",
    callWhy: "We will phone you from the church office. You do not need to do anything else.",
    assistWhy: "Not ready to lead, or would rather help? You can say yes as an assistant instead. It is a no to leading this group, so we will ask someone else to lead it.",
    assistNothingYet: "Saying yes as assistant promises nothing and appoints nobody. If someone else leads this group, the church office will be asked to consider you as its assistant leader, the new leader will be told your first name, and you would be invited to apply. A pastor decides every application, and training comes first. If the office says no, nothing changes for you.",
  },
  yes: {
    heading: "Before you say yes",
    age: "I confirm that I am 21 or older.",
    leadBest: "How do you lead best?",
    relation: "How do you stand with this goal?",
    needAge: "Please confirm that you are 21 or older.",
    needLead: "Please choose how you lead best.",
    needRelation: "Please say how you stand with this goal.",
    assistAge: "I confirm that I am 18 or older.",
    needAssistAge: "Please confirm that you are 18 or older.",
  },
  reasonsHeading: "Is there a reason? You can choose any, or none.",
  done: {
    lead: "Thank you. You are now this group’s leader. Your tribe card has been started, and we will write to you about what comes next.",
    leadReview: "Thank you. We have your yes. The church office will look at it and write to you soon.",
    assist: "Thank you. We have noted that you would be glad to assist this group. We will ask someone else to lead it. If a leader says yes, the church office will be asked to consider you as its assistant leader, and if it agrees we will write to you.",
    not_season: "Understood. Thank you for answering. We will not ask you about leading again this season.",
    call: "Thank you. We will call you from the church office.",
    tomorrow: "Done. We will remind you tomorrow.",
    tomorrowLate: "This question closes before tomorrow, so we cannot remind you then. You can still answer now.",
    never: "Understood. The Leader Desk will not ask you to lead again.",
    stop: "Done. The Leader Desk will not write to you again.",
  },
  taken: "Another member has already offered to assist this group, so there is nothing more to do about that here. You can still answer the question about leading. Nothing has changed for you.",
  closed: "This question has closed. Nothing has changed for you.",
  off: "This page is not open at the moment. Nothing has changed for you.",
  noPage: "We could not open this page. The link may have run out. Nothing has changed for you.",
  fault: "Something went wrong on our side. Nothing has changed for you. Please try again in a little while.",
  problem: "That didn’t save. Please try again.",
  openTribes: "Open my tribes",
} as const;

export const OFFER_EMAIL_SAMPLES = {
  desk_offer: {
    kind: "offer",
    first: "Ada",
    community: "Professionals",
    goal: "Lead with excellence at work",
    slot: "weeknight-evening",
    mode: "in_person",
    zone: "mainland",
    capacity: 8,
    members: 5,
    asked: true,
    yes: 3,
    hours: 72,
    ends: "Friday 13 November at 11:00 am",
    reminder: null,
    stop: true,
  },
  desk_found: {
    kind: "found",
    first: "Ada",
    community: "Professionals",
    goal: "Lead with excellence at work",
    slot: "weeknight-evening",
    mode: "in_person",
    zone: "mainland",
    capacity: 8,
    leader_first: "Ngozi",
    stop: true,
  },
} as const;
