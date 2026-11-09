// The placed-member answer sequence, the board and the call desk (seats and contacts, Package 6b): every sentence the member's page and the office's screens say,
// and everything they read from the database. Off, the database answers "off" and every screen behaves as it did. No full number reaches any of these
// screens except the one a desk reveal returns and the download the owner switched on: everywhere else a number has its middle hidden.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A link is 64 hex characters. Anything else is not ours, so it is never sent to the database. */
export const isAnswerLink = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isTribeId = isUuid;

export type AnswersState = "off" | "rehearsal" | "on";
export const parseAnswersState = (v: unknown): AnswersState => (v === "rehearsal" || v === "on" ? v : "off");

// ---------------------------------------------------------------------------
// Dates, as the church in Lagos writes them
// ---------------------------------------------------------------------------
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Sunday 22 November", for a day written 2026-11-22. The same on every server. */
export function longDay(isoDate: string | null): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "the day joining closes";
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${d} ${MONTHS[m - 1]}`;
}

/** "5 days", "26 hours" or "4 hours", for the time left. */
export function timeLeft(hours: number | null): string {
  if (hours === null) return "";
  if (hours <= 0) return "closed";
  if (hours < 48) return `${Math.max(1, Math.round(hours))} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// The choices a member makes (all from short lists)
// ---------------------------------------------------------------------------
export const REASONS = [
  { key: "timing", label: "The time does not suit me" },
  { key: "place", label: "The place does not suit me" },
  { key: "busy", label: "I am too busy this season" },
  { key: "different", label: "It is not what I expected" },
  { key: "other", label: "Something else" },
] as const;
export type ReasonKey = (typeof REASONS)[number]["key"];
export const isReason = (v: unknown): v is ReasonKey => REASONS.some((r) => r.key === v);

export const WINDOWS = [
  { key: "morning", label: "Morning", hours: "8 am to 12 noon" },
  { key: "afternoon", label: "Afternoon", hours: "12 noon to 5 pm" },
  { key: "evening", label: "Evening", hours: "5 pm to 8 pm" },
] as const;
export type WindowKey = (typeof WINDOWS)[number]["key"];
export const isWindow = (v: unknown): v is WindowKey => WINDOWS.some((w) => w.key === v);
export const windowLabel = (v: string | null): string => WINDOWS.find((w) => w.key === v)?.label.toLowerCase() ?? "any time";

export type AnswerKind = "not_this_season" | "call_me" | "remind_tonight" | "stop_reminders" | "dont_call";
export const ANSWER_KINDS: readonly AnswerKind[] = ["not_this_season", "call_me", "remind_tonight", "stop_reminders", "dont_call"];
export const isAnswerKind = (v: unknown): v is AnswerKind => (ANSWER_KINDS as readonly unknown[]).includes(v);

/** What the email's buttons point at: the page opens with that answer ready. Nothing is saved until the member presses it. */
export type Pointed = "notnow" | "call" | "remind" | "stop";
export const POINTED: readonly Pointed[] = ["notnow", "call", "remind", "stop"];
export const isPointed = (v: unknown): v is Pointed => (POINTED as readonly unknown[]).includes(v);
/** The page's own words in the address after an answer. */
export type Done = "notnow" | "call" | "remind" | "stop" | "nocall";
export const DONE: readonly Done[] = ["notnow", "call", "remind", "stop", "nocall"];
export const isDone = (v: unknown): v is Done => (DONE as readonly unknown[]).includes(v);

export type AnswersInfo = {
  on: boolean;
  deadline: string | null;
  closed: boolean;
  canChange: boolean;
  callPending: boolean;
  callWindow: WindowKey | null;
  remindSet: boolean;
  remindPossible: boolean;
  /** After 6 pm the one reminder goes at 6 pm the next day, and the page says so. */
  remindTomorrow: boolean;
  stopped: boolean;
  /** The number we hold, with its middle hidden. */
  number: string | null;
  withheld: boolean;
};
export const ANSWERS_OFF: AnswersInfo = { on: false, deadline: null, closed: false, canChange: false, callPending: false, callWindow: null, remindSet: false, remindPossible: false, remindTomorrow: false, stopped: false, number: null, withheld: false };
export function parseAnswersInfo(v: unknown): AnswersInfo {
  if (!isObj(v) || v.on !== true) return ANSWERS_OFF;
  return {
    on: true,
    deadline: text(v.deadline),
    closed: v.closed === true,
    canChange: v.can_change === true,
    callPending: v.call_pending === true,
    callWindow: isWindow(v.call_window) ? v.call_window : null,
    remindSet: v.remind_set === true,
    remindPossible: v.remind_possible === true,
    remindTomorrow: v.remind_tomorrow === true,
    stopped: v.stopped === true,
    number: text(v.number),
    withheld: v.withheld === true,
  };
}

export type AnswerResult = { ok: true; kind: AnswerKind; again: boolean; window: WindowKey | null } | { ok: false; reason: "invalid" | "not_available" | "not_active" | "off" | "closed" | "too_late" | "other" };
export function parseAnswerResult(v: unknown): AnswerResult {
  if (!isObj(v)) return { ok: false, reason: "other" };
  if (v.ok === true) return { ok: true, kind: isAnswerKind(v.kind) ? v.kind : "stop_reminders", again: v.again === true, window: isWindow(v.window) ? v.window : null };
  const r = v.reason;
  return { ok: false, reason: r === "invalid" || r === "not_available" || r === "not_active" || r === "off" || r === "closed" || r === "too_late" ? r : "other" };
}

/** Where the member lands after an answer. */
export const DONE_OF: Record<AnswerKind, Done> = { not_this_season: "notnow", call_me: "call", remind_tonight: "remind", stop_reminders: "stop", dont_call: "nocall" };

export const ANSWER_WORDS = {
  heldUntil: (deadline: string | null) => `Your seat is held for you. You can switch tribes until ${longDay(deadline)}.`,
  closedLine: (deadline: string | null) => `Joining closed on ${longDay(deadline)}. Your seat is still held while you decide, and you can no longer swap tribes on your own.`,
  moreTitle: "Not ready to say yes?",
  moreBody: "You do not have to ignore us. Any of these is a fine answer.",
  notNowButton: "Not this season",
  notNowNote: "You give up this place. The door stays open for the next season, and we will not place you in a tribe again this season.",
  reasonTitle: "Would you tell us why? (optional)",
  notNowConfirm: "Confirm: not this season",
  callButton: "Call me",
  callOffice: "Ask the office about another tribe",
  callNote: "Your seat stays held. Someone from the church office will phone you. Choose when suits you.",
  callOfficeNote: "Joining has closed, so you can no longer swap tribes yourself. Someone from the church office will phone you about another tribe.",
  windowTitle: "When suits you?",
  windowAny: "Any time between 8 am and 8 pm",
  numberLabel: "Your phone number",
  numberHint: "With the country code, like +234 803 123 4567. Only the church office will see it, and only to call you. It is not shared with your leader.",
  haveNumber: (masked: string) => `We would phone the number we hold for you: ${masked}. Write another below if you would like us to use a different one.`,
  noNumber: "We have no number for you yet. Write one below so we can phone you.",
  badNumber: "That number does not look right. Write it with its country code, like +2348031234567.",
  callConfirm: "Ask for a call",
  remindButton: "Remind me tonight at 6 pm",
  remindButtonTomorrow: "Remind me tomorrow at 6 pm",
  remindNote: "We will send you one more email at 6 pm. It does not change the day joining closes.",
  remindNoteTomorrow: "It is past 6 pm, so we will send you one more email at 6 pm tomorrow. It does not change the day joining closes.",
  remindClosed: "Joining closes today, so there is no time for a reminder tonight. Please choose now.",
  stopButton: "Stop these reminders",
  stopNote: "We will stop writing to you about this seat. It does not give the seat up.",
  noCallButton: "Don’t call me",
  noCallNote: "The church office will not phone you about this seat.",
  officeMayCall: "The church office may also call you about your place. Press Don’t call me any time and we will not.",
  doneNotNow: { title: "Understood. The door stays open.", body: "You gave up that place, and we will not place you in a tribe again this season. When the next season opens, you will hear from us. You can also look at other tribes yourself any time." },
  doneCall: (window: string | null) => ({
    title: "Someone from the church office will call you.",
    body: window && window !== "any time" ? `We will call in the ${window}, as you chose. Your seat stays held.` : "We will call you between 8 am and 8 pm. Your seat stays held.",
  }),
  doneCallAgain: "You have already asked for a call. Someone will phone you.",
  doneRemind: { title: "We will remind you at 6 pm.", body: "One email, once. The day joining closes has not moved." },
  doneRemindAgain: "You already asked for a reminder tonight. It is on its way.",
  doneStop: { title: "We have stopped the reminders.", body: "Your seat is still held, and you can answer on this page whenever you are ready." },
  doneNoCall: { title: "Understood. We will not phone you.", body: "Your seat is still held. You can answer on this page whenever you are ready." },
  closedRemind: "Joining has closed, so there is no reminder to set.",
  problem: "That didn’t save. Please try again.",
} as const;

// ---------------------------------------------------------------------------
// The emails (the words are fixed; only the leader's one line is written by a person)
// ---------------------------------------------------------------------------
export type SeqStep = "2a" | "2b" | "3" | "4" | "remind";
export const SEQ_STEPS: readonly SeqStep[] = ["2a", "2b", "3", "4", "remind"];
export const isSeqStep = (v: unknown): v is SeqStep => (SEQ_STEPS as readonly unknown[]).includes(v);

/** The longest subject that fits a phone's lock screen. */
export const SEQ_SUBJECT_MAX = 60;

export const SEQ_WORDS = {
  why: "You are getting this because the church placed you in a tribe on United Tribes and you have not answered yet.",
  mayCall: "The church office may also call you about your place. Say Don’t call me any time and we will not.",
  numberLine: "Your leader, their assistant and your coach can see your number only if you agree to WhatsApp. Other members never see it.",
  stop: "Stop these reminders",
  buttons: {
    yes: "Yes, I’m in",
    other: "Show me other tribes",
    notNow: "Not this season",
    call: "Call me",
    callOffice: "Ask the office about another tribe",
    remind: "Remind me tonight",
    withhold: "Don’t share my details",
  },
} as const;

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------
export const STEP_LABELS: Record<string, string> = {
  none: "Not started",
  "2a": "2a, Did this reach you?",
  "2b": "2b, Anything stopping you?",
  "3": "3, Still held",
  "4": "4, Last call",
  remind: "Reminder at 6 pm",
};
/** The step a board row is on, in the board's own words (a plain function, so a server page can call it). */
export const stepLabel = (step: string): string => STEP_LABELS[step] ?? step;
export const ANSWER_LABELS: Record<string, string> = {
  none: "None",
  yes: "Yes",
  not_season: "Not this season",
  other_tribe: "Another tribe",
  call_me: "Call me",
  remind: "Remind me tonight",
};
export const FLAG_LABELS: Record<string, string> = {
  email_failing: "Email not reaching them",
  under18: "Under 18",
  deletion: "Asked to be deleted",
  care: "Care follow-up",
  withheld: "Don’t share my details",
  announcements_off: "Stopped announcements",
  stopped: "Stopped reminders",
  dont_call: "Don’t call me",
  wrong_number: "Wrong number",
  held: "Seat held",
};
export const CALL_LABELS: Record<string, string> = {
  not_needed: "Not needed",
  asked: "Asked for a call",
  waiting: "Waiting",
  tried: "Tried",
  reached: "Reached",
  wrong_number: "Wrong number",
  dont_call: "Don’t call",
};
export const OUTCOMES = [
  { key: "yes", label: "Reached, said yes", help: "Confirms the place. It does not save a WhatsApp yes." },
  { key: "other_tribe", label: "Reached, wants another tribe", help: "Writes it down and ends the emails. You move them by hand." },
  { key: "not_this_season", label: "Reached, not this season", help: "Releases the seat, marked Not this season." },
  { key: "needs_time", label: "Reached, needs time", help: "Choose a follow-up date. The seat is held until then, once." },
  { key: "no_answer", label: "No answer", help: "Counts as a try. After the last try they leave the desk." },
  { key: "wrong_number", label: "Wrong number", help: "Flags the number. Nothing is deleted." },
  { key: "dont_call", label: "Asked not to be called", help: "They are never shown on the desk again." },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["key"];
export const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some((o) => o.key === v);

export const TILES = [
  { key: "placed", label: "Placed" },
  { key: "emailed", label: "Emailed" },
  { key: "opened", label: "Page opened" },
  { key: "answered", label: "Answered" },
  { key: "needs_call", label: "Needs a call" },
] as const;
export const EXTRA_TILES = [
  { key: "waiting", label: "Waiting" },
  { key: "asked", label: "Asked for a call" },
  { key: "under48", label: "Under 48 hours left" },
] as const;
export type TileKey = "placed" | "emailed" | "opened" | "answered" | "needs_call" | "waiting" | "asked" | "under48";
export const isTile = (v: unknown): v is TileKey => [...TILES, ...EXTRA_TILES].some((t) => t.key === v);

export type BoardTiles = { placed: number; emailed: number; opened: number; answered: number; waiting: number; needsCall: number; asked: number; under48: number };
export type BoardSummary = {
  state: AnswersState;
  paused: boolean;
  pausedReason: string | null;
  deadline: string | null;
  hoursLeft: number | null;
  tiles: BoardTiles;
  health: { sent: number; delivered: number; bounced: number; complaints: number; stopped: number; since: string | null };
  rehearsal: { enrolled: number; wouldSend: Record<string, number> };
  canDesk: boolean;
  callsOk: boolean;
};
export function parseBoardSummary(v: unknown): BoardSummary | null {
  if (!isObj(v)) return null;
  const t = isObj(v.tiles) ? v.tiles : {};
  const h = isObj(v.health) ? v.health : {};
  const r = isObj(v.rehearsal) ? v.rehearsal : {};
  const would: Record<string, number> = {};
  if (isObj(r.would_send)) for (const [k, n] of Object.entries(r.would_send)) would[k] = int(n);
  return {
    state: parseAnswersState(v.state),
    paused: v.paused === true,
    pausedReason: text(v.paused_reason),
    deadline: text(v.deadline),
    hoursLeft: num(v.hours_left),
    tiles: { placed: int(t.placed), emailed: int(t.emailed), opened: int(t.opened), answered: int(t.answered), waiting: int(t.waiting), needsCall: int(t.needs_call), asked: int(t.asked), under48: int(t.under48) },
    health: { sent: int(h.sent), delivered: int(h.delivered), bounced: int(h.bounced), complaints: int(h.complaints), stopped: int(h.stopped), since: text(h.since) },
    rehearsal: { enrolled: int(r.enrolled), wouldSend: would },
    canDesk: v.can_desk === true,
    callsOk: v.calls_ok === true,
  };
}

export type BoardRow = {
  tm: string;
  person: string;
  name: string;
  tribeId: string;
  tribe: string;
  community: string | null;
  placedAt: string | null;
  emailed: boolean;
  opened: boolean;
  answer: string;
  answered: boolean;
  step: string;
  sends: number;
  seq: string;
  lastTouchAt: string | null;
  lastTouch: string | null;
  hoursLeft: number | null;
  flags: string[];
  call: string;
  tries: number;
  window: string | null;
  desk: string | null;
};
export type BoardRows = { total: number; rows: BoardRow[] };
export function parseBoardRows(v: unknown): BoardRows {
  if (!isObj(v) || !Array.isArray(v.rows)) return { total: 0, rows: [] };
  const rows = v.rows.flatMap((r): BoardRow[] => {
    if (!isObj(r) || !isUuid(r.tm) || !isUuid(r.person)) return [];
    return [
      {
        tm: r.tm,
        person: r.person,
        name: text(r.name) ?? "A member",
        tribeId: isUuid(r.tribe_id) ? r.tribe_id : "",
        tribe: text(r.tribe) ?? "",
        community: text(r.community),
        placedAt: text(r.placed_at),
        emailed: r.emailed === true,
        opened: r.opened === true,
        answer: text(r.answer) ?? "none",
        answered: r.answered === true,
        step: text(r.step) ?? "none",
        sends: int(r.sends),
        seq: text(r.seq) ?? "none",
        lastTouchAt: text(r.last_touch_at),
        lastTouch: text(r.last_touch),
        hoursLeft: num(r.hours_left),
        flags: Array.isArray(r.flags) ? r.flags.filter((f): f is string => typeof f === "string") : [],
        call: text(r.call) ?? "not_needed",
        tries: int(r.tries),
        window: text(r.window),
        desk: text(r.desk),
      },
    ];
  });
  return { total: int(v.total), rows };
}

export type TribeRow = { tribe: string; name: string; community: string | null; leader: string | null; placed: number; waiting: number; yes: number; notSeason: number; otherTribe: number; asked: number; active: number; confirmed: number; thin: boolean };
export function parseTribeRows(v: unknown): TribeRow[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r): TribeRow[] => {
    if (!isObj(r) || !isUuid(r.tribe)) return [];
    return [
      {
        tribe: r.tribe,
        name: text(r.name) ?? "",
        community: text(r.community),
        leader: text(r.leader),
        placed: int(r.placed),
        waiting: int(r.waiting),
        yes: int(r.yes),
        notSeason: int(r.not_season),
        otherTribe: int(r.other_tribe),
        asked: int(r.asked),
        active: int(r.active),
        confirmed: int(r.confirmed),
        thin: r.thin === true,
      },
    ];
  });
}

export type AnswersOverview = { state: AnswersState; waiting: number; needsCall: number; asked: number };
export function parseAnswersOverview(v: unknown): AnswersOverview {
  if (!isObj(v)) return { state: "off", waiting: 0, needsCall: 0, asked: 0 };
  return { state: parseAnswersState(v.state), waiting: int(v.waiting), needsCall: int(v.needs_call), asked: int(v.asked) };
}
export const ANSWERS_CARD = {
  line: (needs: number, asked: number) =>
    needs === 0 ? "No one needs a call right now." : `${needs === 1 ? "1 placed member needs" : `${needs} placed members need`} a call${asked > 0 ? `, ${asked === 1 ? "1 asked" : `${asked} asked`} for one` : ""}.`,
  button: "Open the board",
  rehearsalNote: "Rehearsal: the sequence writes down what it would send, and sends nothing.",
} as const;

// ---------------------------------------------------------------------------
// The call desk
// ---------------------------------------------------------------------------
export type DeskRow = {
  tm: string;
  name: string;
  tribe: string;
  window: string | null;
  topic: string | null;
  requestedAt: string | null;
  tries: number;
  lastOutcome: string | null;
  opened: boolean;
  hoursLeft: number | null;
  mask: string | null;
  inWindow: boolean;
};
export type DeskList = { callsOk: boolean; hour: number; maxTries: number; download: boolean; asked: DeskRow[]; worth: DeskRow[] };
function deskRows(v: unknown): DeskRow[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r): DeskRow[] => {
    if (!isObj(r) || !isUuid(r.tm)) return [];
    return [
      {
        tm: r.tm,
        name: text(r.name) ?? "A member",
        tribe: text(r.tribe) ?? "",
        window: text(r.window),
        topic: text(r.topic),
        requestedAt: text(r.requested_at),
        tries: int(r.tries),
        lastOutcome: text(r.last_outcome),
        opened: r.opened === true,
        hoursLeft: num(r.hours_left),
        mask: text(r.mask),
        inWindow: r.in_window !== false,
      },
    ];
  });
}
export function parseDeskList(v: unknown): DeskList | null {
  if (!isObj(v)) return null;
  return { callsOk: v.calls_ok === true, hour: int(v.hour), maxTries: Math.max(1, int(v.max_tries)), download: v.download === true, asked: deskRows(v.asked), worth: deskRows(v.worth) };
}
export const DESK_WORDS = {
  title: "Call desk",
  intro: "Members to phone, and nobody else. A number shows only when you press Show number, and every press is written down (who, which member, when; never the number).",
  askedTitle: "Asked for a call",
  askedHelp: "They pressed Call me. Oldest first.",
  worthTitle: "Worth a call",
  worthHelp: "Placed, with a number, no answer yet, and told by email that the office may call. Page opened first, then those placed longest ago.",
  emptyAsked: "No one has asked for a call.",
  emptyWorth: "No one is waiting for a call.",
  show: "Show number",
  showAnyway: "Show number anyway",
  hours: "Calls are made between 8 am and 8 pm, Lagos time. Outside those hours numbers stay hidden.",
  outsideWindow: (w: string) => `They asked for the ${w}.`,
  tries: (n: number, max: number) => (n === 0 ? "Not tried yet" : `Tried ${n} of ${max}`),
  topicOther: "Wants to talk about another tribe",
  record: "How did the call go?",
  save: "Save the call",
  followup: "Follow-up date",
  saved: "Saved.",
  failed: "That did not save. Check the choice and try again.",
  noMask: "No usable number",
  opened: "Opened the page",
  notOpened: "Has not opened the page",
  download: "Download the list with numbers",
  downloadOff: "The download with numbers is switched off. The owner can switch it on in God Mode.",
  downloadNote: "Each download is written down, and the file’s last line says who downloaded it and when. Keep it private, call only, and delete it when you are done.",
  pastorNote: "You can read the board. The call desk is for the admin and a director.",
} as const;

// ---------------------------------------------------------------------------
// The board's own words
// ---------------------------------------------------------------------------
export const BOARD_WORDS = {
  title: "Placed members",
  intro: "Every member the church placed this season, with where they stand. Every number above opens the rows it counts.",
  tabs: { board: "Board", tribes: "By tribe", desk: "Call desk" },
  funnel: "From placed to answered",
  left: (hours: number | null, deadline: string | null) => (hours === null ? "" : hours <= 0 ? `Joining closed on ${longDay(deadline)}.` : `${timeLeft(hours)} left. Joining closes ${longDay(deadline)}.`),
  health: "Email health since the sequence began",
  healthLine: (h: { sent: number; delivered: number; bounced: number; complaints: number; stopped: number }) =>
    `${h.sent} sent · ${h.delivered} delivered · ${h.bounced} bounced · ${h.complaints} marked as spam · ${h.stopped} stopped announcements`,
  noHealth: "No sequence email has been sent yet.",
  honest: "“Page opened” is not “read”: a mail scanner can open a link. The sequence uses it only to choose its words, never to stop an email or release a seat.",
  off: "The placed answer sequence is Off. The board still shows where every placed member stands. Switch the sequence on in God Mode → Features.",
  rehearsal: (enrolled: number) => `Rehearsal: ${enrolled} ${enrolled === 1 ? "seat is" : "seats are"} in the practice run. Nothing is sent.`,
  rehearsalSteps: (s: Record<string, number>) => Object.entries(s).map(([k, n]) => `${n} × ${STEP_LABELS[k] ?? k}`).join(" · "),
  paused: (why: string | null) => `The sequence is paused${why ? `: ${why}` : ""}. Nothing is sent until it is resumed.`,
  pause: "Pause the sequence",
  resume: "Resume the sequence",
  pauseReason: "Why are you pausing it?",
  columns: ["Member", "Placed", "Step", "Last touch", "Page opened", "Answer", "Time left", "Flags", "Call"] as const,
  filters: { tribe: "Tribe", step: "Step", opened: "Page opened", answer: "Answer", flag: "Flag", call: "Call", any: "Any", yes: "Yes", no: "No", apply: "Filter", clear: "Clear filters" },
  more: "Show more",
  none: "No one matches.",
  rowActions: { hold: "Hold this seat", unhold: "Let the emails resume", called: "Mark called", dont: "Don’t call" },
  holdWhy: "Why are you holding it?",
  holdDays: "For how many days",
  tribesTitle: "Which tribes still have people waiting",
  tribesHelp: "Speak to the leader of the tribes at the top. A tribe marked thin has fewer than five who have said yes.",
  thin: "Thin",
  ago: (hours: number | null) => (hours === null ? "" : hours < 48 ? `${Math.max(0, Math.round(hours))} h ago` : `${Math.floor(hours / 24)} days ago`),
  seatLine: {
    title: "A line for new members",
    help: "One sentence, once. It appears as “From you” in the emails to members placed in your tribe. No links, no phone numbers.",
    placeholder: "I’m praying for this tribe, and I can’t wait to meet you.",
    save: "Save my line",
    saved: "Saved.",
    cleared: "Cleared.",
    failed: "That did not save. Keep it to one plain sentence, with no links or numbers.",
  },
} as const;

// ---------------------------------------------------------------------------
// God Mode
// ---------------------------------------------------------------------------
export type AnswersSettings = {
  secondAfterHours: number;
  step3Days: number;
  lastCallHours: number;
  paceHours: number;
  maxEmails: number;
  callTries: number;
  numbersDownload: boolean;
  paused: boolean;
  pausedReason: string | null;
  reason: string | null;
  changedAt: string | null;
};
export const ANSWERS_SETTINGS_DEFAULT: AnswersSettings = { secondAfterHours: 24, step3Days: 3, lastCallHours: 24, paceHours: 20, maxEmails: 6, callTries: 3, numbersDownload: false, paused: false, pausedReason: null, reason: null, changedAt: null };
export function parseAnswersSettings(v: unknown): AnswersSettings | null {
  if (!isObj(v)) return null;
  return {
    secondAfterHours: Math.max(1, int(v.second_after_hours)),
    step3Days: Math.max(1, int(v.step3_days)),
    lastCallHours: Math.max(6, int(v.last_call_hours)),
    paceHours: Math.max(1, int(v.pace_hours)),
    maxEmails: Math.max(2, int(v.max_emails)),
    callTries: Math.max(1, int(v.call_tries)),
    numbersDownload: v.numbers_download === true,
    paused: v.paused === true,
    pausedReason: text(v.paused_reason),
    reason: text(v.reason),
    changedAt: text(v.changed_at),
  };
}
export const ANSWERS_SETTINGS_WORDS = {
  title: "Placed answer sequence",
  intro: "The numbers behind the sequence, the board and the call desk. Every change needs a reason and is written to the log.",
  secondAfter: "Hours to wait after the placement email before the second email",
  step3: "Days between “Still held” emails",
  lastCall: "Hours before joining closes that “Last call” goes",
  pace: "Hours between two emails to one seat, whoever sent them",
  max: "Most sequence emails for one seat",
  tries: "Most phone tries for one member",
  download: "Allow the call desk download with numbers",
  downloadHelp: "Off by default. When it is on, an admin or a director can download the call desk with numbers. Each download is logged.",
  reason: "Why are you changing it?",
  save: "Save",
  saved: "Saved.",
  failed: "That did not save. Check the numbers and the reason.",
  ranges: "Second email: 1 to 240 hours. Still held: every 1 to 14 days. Last call: 6 to 96 hours. Pace: 1 to 72 hours. Most emails: 2 to 10. Tries: 1 to 6.",
} as const;

// ---------------------------------------------------------------------------
// A leader's one line
// ---------------------------------------------------------------------------
export type SeatLine = { line: string | null; canEdit: boolean; leaderFirst: string | null; state: AnswersState };
export function parseSeatLine(v: unknown): SeatLine | null {
  if (!isObj(v)) return null;
  return { line: text(v.line), canEdit: v.can_edit === true, leaderFirst: text(v.leader_first), state: parseAnswersState(v.state) };
}

// ---------------------------------------------------------------------------
// The call desk download
// ---------------------------------------------------------------------------
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  // A cell that starts like a formula is written as text, so a spreadsheet never runs it
  const safe = /^[=+@\-\t\r]/.test(s) && !/^\+\d[\d ]*$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export type DeskDownload = { by: string; at: string; count: number; rows: Array<{ name: string; tribe: string; list: string; window: string | null; tries: number; lastOutcome: string | null; number: string | null }> };
export function parseDeskDownload(v: unknown): DeskDownload | null {
  if (!isObj(v) || !Array.isArray(v.rows)) return null;
  const rows = v.rows.flatMap((r) => {
    if (!isObj(r)) return [];
    return [{ name: text(r.name) ?? "", tribe: text(r.tribe) ?? "", list: text(r.list) ?? "", window: text(r.window), tries: int(r.tries), lastOutcome: text(r.last_outcome), number: text(r.number) }];
  });
  return { by: text(v.by) ?? "", at: text(v.at) ?? "", count: int(v.count), rows };
}
/** The moment as UTC to the minute, whatever time zone the database wrote it in ("2026-11-06 17:50"). */
const utcMinute = (at: string): string => {
  const t = new Date(at);
  return (Number.isNaN(t.getTime()) ? at : t.toISOString()).slice(0, 16).replace("T", " ");
};
/** The file: one row for each member, a blank line, and a last line that names who downloaded it and when. */
export function deskCsv(d: DeskDownload): string {
  const head = ["Name", "Tribe", "List", "Time of day", "Tries", "Last outcome", "Number"];
  const lines = [head.join(",")];
  for (const r of d.rows) {
    lines.push([r.name, r.tribe, r.list === "asked" ? "Asked for a call" : "Worth a call", windowLabel(r.window), r.tries, r.lastOutcome ?? "", r.number ?? ""].map(csvCell).join(","));
  }
  lines.push("");
  lines.push(csvCell(`Downloaded by ${d.by} on ${utcMinute(d.at)} UTC. ${d.count} ${d.count === 1 ? "member" : "members"}. Private: call only, then delete.`));
  return lines.join("\r\n");
}
