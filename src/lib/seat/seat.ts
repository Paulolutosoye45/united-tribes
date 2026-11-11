// The seat window (Package 6, the 48-hour clock): every sentence its screens and emails say, and everything they read from the database. Every parser takes whatever the
// database sent and gives back something safe to show: anything it does not understand becomes nothing, never a guess. No phone number, note or reason is read by any of
// these, and a first name is all a leader is ever given.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
/** A private link is 64 hex characters. Anything else is not ours, so it is never sent to the database. */
export const isSeatLink = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export type SeatState = "off" | "rehearsal" | "on";
export const parseSeatState = (v: unknown): SeatState => (v === "rehearsal" || v === "on" ? v : "off");

// ---------------------------------------------------------------------------
// Time, as the church in Lagos says it
// ---------------------------------------------------------------------------
/** "Thursday 12 November, 9 am", for a moment, in Lagos time and the same on every server. Nothing when the value is not a moment. */
export function lagosWhen(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  const hour = `${get("hour")}${minute && minute !== "00" ? `:${minute}` : ""} ${get("dayPeriod").toLowerCase()}`;
  return `${get("weekday")} ${get("day")} ${get("month")}, ${hour}`;
}

/** "26 hours", "1 hour", "3 days": the time left. Closed when there is none. */
export function hoursWords(hours: number | null): string {
  if (hours === null) return "";
  if (hours <= 0) return "due now";
  if (hours < 48) return `${Math.max(1, Math.round(hours))} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------
export const SEAT_SUBJECT_MAX = 60;

export const SEAT_FLAGS = {
  waiting: "Waiting",
  blocked: "Held back",
  not_reached: "Not reached",
  kept: "Kept by the office",
  released: "Released, can be taken back",
  hard: "Hard to fill",
} as Record<string, string>;

export const SEAT_FILTERS = [
  { key: "waiting", label: "Waiting" },
  { key: "under24", label: "Under 24 hours left" },
  { key: "blocked", label: "Held back" },
  { key: "not_reached", label: "Not reached" },
  { key: "kept", label: "Kept" },
  { key: "released", label: "Released" },
  { key: "hard", label: "Hard to fill" },
] as const;
export type SeatFilter = (typeof SEAT_FILTERS)[number]["key"];
export const isSeatFilter = (v: unknown): v is SeatFilter => SEAT_FILTERS.some((f) => f.key === v);

export const SEAT_WORDS = {
  title: "Seats",
  intro:
    "Every seat the church placed has a clock. A reminder goes at hour 24 and a last call at hour 40. At the deadline, if the member has not answered, the seat is offered to the next best fit and the member is told kindly, and may take it back for a while. Someone who said yes is never touched, and nor is anyone the church could not email.",
  off: "The seat window is Off, so no clock is running and nobody is written to.",
  rehearsal: "This is Rehearsal. The clocks are kept and what each would do is written down, but nothing is sent and no seat moves.",
  paused: "The seat clocks are paused by the office. Each keeps the time it had left.",
  health: "Is it safe to run?",
  healthOk: "Every check is green.",
  beatLate: "The heartbeat has not beaten in the last 15 minutes",
  lastBeat: (when: string) => (when ? `Last beat: ${when}` : "The heartbeat has never beaten"),
  tiles: { waiting: "Waiting", under24: "Under 24 hours left", blocked: "Held back", not_reached: "Not reached", kept: "Kept", released: "Released", hard: "Hard to fill" } as Record<string, string>,
  columns: ["Member", "Tribe and leader", "Time", "Where it stands", ""],
  none: "No seats here.",
  left: (hours: number | null) => (hours === null ? "" : `${hoursWords(hours)} left`),
  extended: "More time given",
  chain: (n: number) => `Offered ${n} ${n === 1 ? "time" : "times"} for this place`,
  until: (when: string) => `Can be taken back until ${when}`,
  actions: { keep: "Keep this seat", extend: "Give 48 hours more", release: "Release now", giveBack: "Give it back", history: "What happened" },
  reasonLabel: "Why? (5 to 300 characters, written to the log)",
  confirm: "Do it",
  cancel: "Not now",
  keepHelp: "The clock stops for this seat and it is never released until you decide. The reason is written down.",
  releaseHelp: "The seat is released now and offered to the next best fit. The member is told kindly and can take it back.",
  pause: "Pause every clock",
  resume: "Let the clocks run",
  pauseHelp: "Every clock stops and keeps the time it had left. Needs a reason.",
  testSend: "Send me the three emails",
  testSent: "Sent to you, with an invented name. No member was written to.",
  done: "Done.",
  more: "More",
  filters: { label: "Show", any: "Everything", apply: "Show", clear: "Clear" },
  problem: "That did not work. Reload the page and try again.",
  unavailable: "The page is not available right now. Reload it. If the database has not had the Package 6 file applied yet, there is nothing to show.",
  stops: {
    email: "More than a quarter of the last 20 seat emails failed",
    day_cap: "The day's limit of releases was reached",
    tribe_quarter: "A quarter of this tribe's seats were released today",
    under18: "Under 18",
    deletion: "Asked for their account to be deleted",
    announcements_off: "Stopped announcements",
    bounced: "Their email is bouncing",
    email_off: "No usable email",
    care: "A care follow-up is open",
    stopped: "Pressed Stop these reminders",
    held: "The office is holding the seat",
    call_pending: "Asked for a call",
    not_reached: "Their first email never arrived",
  } as Record<string, string>,
} as const;

export const LEADER_SEAT_WORDS = {
  title: "Seats waiting for a yes",
  intro: "These members were placed in your tribe and have not answered yet. If you know someone is travelling or unwell, you can give them 48 hours more, once.",
  waiting: (left: string) => `Waiting, ${left}`,
  more: "Ask for 48 hours more",
  moreDone: "More time given",
  moreHelp: "Give this person 48 hours more, once.",
  released: "Released, can be taken back",
  kept: "Kept by the office",
  blocked: "With the office",
  none: "Nobody is waiting for a yes.",
  rehearsal: "This is Rehearsal: nothing will be released.",
} as const;

export const MEMBER_WORDS = {
  site: "United Tribes",
  title: (first: string) => (first ? `${first}, your seat` : "Your seat"),
  free: (tribe: string, leader: string, until: string) =>
    `${tribe} is still free, and ${leader ? `${leader} would` : "its leader would"} be glad to have you. You can take your seat back until ${until}.`,
  back: "Your seat is yours again. Nothing more to do now except answer the church's email when you can.",
  gone: (tribe: string) => `Your seat in ${tribe} has gone to someone else, and you are first in line for the next one that opens. Your next step is to sign in and look at the other tribes.`,
  closed: "The time to take this seat back has passed. You can sign in and look at the tribes that are open.",
  invalid: "This link is not valid, or it has run out. If you were sent it by the church, ask the office for a new one.",
  takeBack: "Take my seat back",
  signIn: "Sign in to look at other tribes",
  problem: "That did not work. Try once more, or ask the church office.",
  kind: "You did nothing wrong. We could not hear back in time, and we try to keep every tribe moving.",
} as const;

// ---------------------------------------------------------------------------
// What the screens read
// ---------------------------------------------------------------------------
export type SeatHealth = {
  mode: SeatState;
  placementOn: boolean;
  lastBeatAt: string | null;
  beatLate: boolean;
  sentToday: number;
  deliveredToday: number;
  failedToday: number;
  emailBreaker: boolean;
  releasesToday: number;
  dayCap: number;
  overCapacity: number;
  paused: boolean;
  ok: boolean;
  problems: string[];
};
export type SeatRow = {
  clockId: string | null;
  tmId: string;
  personId: string;
  tribe: string;
  leader: string;
  name: string;
  flag: string;
  hoursLeft: number | null;
  hoursIn: number;
  deadlineAt: string | null;
  extended: boolean;
  chain: number;
  retakeUntil: string | null;
};
export type SeatBoard = {
  role: "act" | "look";
  rehearsal: boolean;
  health: SeatHealth;
  tiles: Record<string, number>;
  total: number;
  filter: SeatFilter | null;
  rows: SeatRow[];
};

function parseHealth(v: unknown): SeatHealth {
  const h = isObj(v) ? v : {};
  return {
    mode: parseSeatState(h.mode),
    placementOn: h.placement_on === true,
    lastBeatAt: text(h.last_beat_at),
    beatLate: h.beat_late === true,
    sentToday: int(h.sent_today),
    deliveredToday: int(h.delivered_today),
    failedToday: int(h.failed_today),
    emailBreaker: h.email_breaker === true,
    releasesToday: int(h.releases_today),
    dayCap: int(h.day_cap),
    overCapacity: int(h.over_capacity),
    paused: h.paused === true,
    ok: h.ok === true,
    problems: list(h.problems).filter((p): p is string => typeof p === "string").slice(0, 8),
  };
}

export function parseSeatBoard(v: unknown): SeatBoard | null {
  if (!isObj(v) || (v.role !== "act" && v.role !== "look")) return null;
  const tiles: Record<string, number> = {};
  if (isObj(v.tiles)) for (const [k, n] of Object.entries(v.tiles)) tiles[k] = int(n);
  const rows: SeatRow[] = [];
  for (const r of list(v.rows)) {
    if (!isObj(r)) continue;
    const tm = r.tm_id;
    const person = r.person_id;
    if (!isUuid(tm) || !isUuid(person)) continue;
    rows.push({
      clockId: isUuid(r.clock_id) ? r.clock_id : null,
      tmId: tm,
      personId: person,
      tribe: text(r.tribe) ?? "A tribe",
      leader: text(r.leader) ?? "",
      name: text(r.name) ?? "A member",
      flag: text(r.flag) ?? "waiting",
      hoursLeft: num(r.hours_left),
      hoursIn: int(r.hours_in),
      deadlineAt: text(r.deadline_at),
      extended: r.extended === true,
      chain: Math.max(1, int(r.chain)),
      retakeUntil: text(r.retake_until),
    });
  }
  return {
    role: v.role,
    rehearsal: v.rehearsal === true,
    health: parseHealth(v.health),
    tiles,
    total: int(v.total),
    filter: isSeatFilter(v.filter) ? v.filter : null,
    rows,
  };
}

export type SeatEvent = { at: string; kind: string; by: string | null };
const KIND_WORDS: Record<string, string> = {
  start: "The clock started",
  remind: "The reminder was sent",
  last_call: "The last call was sent",
  release: "The seat was released",
  replace: "The seat was offered to someone else",
  no_bench: "Nobody was offered the seat",
  hard_to_fill: "Marked hard to fill",
  extend: "More time was given",
  keep: "The office kept the seat",
  back: "The member took the seat back",
  fresh_hours: "A fresh 12 hours was given because the site was late",
  blocked: "Held back by a safety rule",
  would_remind: "Would have sent the reminder",
  would_last_call: "Would have sent the last call",
  would_release: "Would have released the seat",
  would_replace: "Would have offered it to someone else",
  not_reached: "The email did not reach them",
  breaker: "Held back by a safety limit",
};
export const kindWords = (k: string): string => KIND_WORDS[k] ?? "Something happened";
export function parseSeatHistory(v: unknown): SeatEvent[] {
  const out: SeatEvent[] = [];
  for (const e of list(v)) {
    if (!isObj(e)) continue;
    const at = text(e.at);
    const kind = text(e.kind);
    if (at && kind) out.push({ at, kind, by: text(e.by) });
  }
  return out;
}

export type SeatSettings = { windowHours: number; remindHours: number; lastCallHours: number; takeBackDays: number; offersInRow: number; dayCap: number; bar: number; countedFrom: string | null };
export function parseSeatSettings(v: unknown): SeatSettings | null {
  if (!isObj(v) || typeof v.window_hours !== "number") return null;
  return {
    windowHours: int(v.window_hours),
    remindHours: int(v.remind_hours),
    lastCallHours: int(v.last_call_hours),
    takeBackDays: int(v.take_back_days),
    offersInRow: int(v.offers_in_row),
    dayCap: int(v.day_cap),
    bar: int(v.bar),
    countedFrom: text(v.counted_from),
  };
}
/** The ranges the database enforces; the form checks them first so a typing slip is caught before the database is asked. */
export const SEAT_RANGES = { window: [24, 96], remind: [6, 90], lastCall: [12, 94], takeBack: [0, 14], offers: [1, 5], dayCap: [5, 100], bar: [60, 95], include: [0, 30] } as const;

export type SeatSettingsInput = { window: string; remind: string; lastCall: string; takeBack: string; offers: string; dayCap: string; bar: string; includeDays: string; reason: string };
export function checkSeatSettings(i: SeatSettingsInput): { ok: true; value: { window: number; remind: number; lastCall: number; takeBack: number; offers: number; dayCap: number; bar: number; includeDays: number | null; reason: string } } | { ok: false; message: string } {
  const one = (raw: string, key: keyof typeof SEAT_RANGES, label: string): number | string => {
    const t = raw.trim();
    if (!/^\d{1,3}$/.test(t)) return `${label}: use a whole number.`;
    const n = Number(t);
    const [lo, hi] = SEAT_RANGES[key];
    return n < lo || n > hi ? `${label}: between ${lo} and ${hi}.` : n;
  };
  const window = one(i.window, "window", "Hours to answer");
  const remind = one(i.remind, "remind", "Hours before the reminder");
  const lastCall = one(i.lastCall, "lastCall", "Hours before the last call");
  const takeBack = one(i.takeBack, "takeBack", "Days to take a seat back");
  const offers = one(i.offers, "offers", "Offers in a row");
  const dayCap = one(i.dayCap, "dayCap", "Most releases in a day");
  const bar = one(i.bar, "bar", "The bar for the next person");
  for (const n of [window, remind, lastCall, takeBack, offers, dayCap, bar]) if (typeof n === "string") return { ok: false, message: n };
  let includeDays: number | null = null;
  if (i.includeDays.trim() !== "") {
    const r = one(i.includeDays, "include", "Count seats placed in the last (days)");
    if (typeof r === "string") return { ok: false, message: r };
    includeDays = r;
  }
  if (!((remind as number) < (lastCall as number) && (lastCall as number) < (window as number))) return { ok: false, message: "The reminder must come before the last call, and the last call before the deadline." };
  const reason = i.reason.trim();
  if (reason.length < 5 || reason.length > 300) return { ok: false, message: "Say why you are changing this, in 5 to 300 characters." };
  return { ok: true, value: { window: window as number, remind: remind as number, lastCall: lastCall as number, takeBack: takeBack as number, offers: offers as number, dayCap: dayCap as number, bar: bar as number, includeDays, reason } };
}

export type LeaderStripRow = { clockId: string | null; first: string; flag: string; hoursIn: number; hoursLeft: number | null; extended: boolean; deadlineAt: string | null };
export type LeaderStrip = { mode: SeatState; rows: LeaderStripRow[] };
export function parseLeaderStrip(v: unknown): LeaderStrip | null {
  if (!isObj(v)) return null;
  const rows: LeaderStripRow[] = [];
  for (const r of list(v.rows)) {
    if (!isObj(r)) continue;
    rows.push({
      clockId: isUuid(r.clock_id) ? r.clock_id : null,
      first: text(r.first) ?? "A member",
      flag: text(r.flag) ?? "waiting",
      hoursIn: int(r.hours_in),
      hoursLeft: num(r.hours_left),
      extended: r.extended === true,
      deadlineAt: text(r.deadline_at),
    });
  }
  return { mode: parseSeatState(v.mode), rows };
}

export type SeatInfo = { found: boolean; state: "free" | "back" | "gone" | "closed" | null; tribe: string; leader: string; first: string; until: string | null };
export function parseSeatInfo(v: unknown): SeatInfo {
  if (!isObj(v) || v.found !== true) return { found: false, state: null, tribe: "", leader: "", first: "", until: null };
  const state = v.state === "free" || v.state === "back" || v.state === "gone" || v.state === "closed" ? v.state : null;
  return { found: state !== null, state, tribe: text(v.tribe) ?? "your tribe", leader: text(v.leader) ?? "", first: text(v.first) ?? "", until: text(v.until) };
}

// ---------------------------------------------------------------------------
// "I need to leave this tribe" (Package 7)
// ---------------------------------------------------------------------------
export type LeaveState = { can: boolean; tribe: string; until: string | null };

/** What the member's own page needs to know: can they leave now, from which tribe, and the last day. Anything odd is "no". */
export function parseLeaveState(v: unknown): LeaveState {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { can: false, tribe: "", until: null };
  const o = v as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim().slice(0, 120) : "");
  const until = typeof o.until === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.until) ? o.until.slice(0, 10) : null;
  return { can: o.can === true && text(o.tribe) !== "", tribe: text(o.tribe), until };
}

/** The reasons offered, all optional. A reason is only ever one of these, never typed, and it goes to the log, never to the leader. */
export const LEAVE_REASONS = [
  { key: "time", label: "The time does not work for me" },
  { key: "place", label: "The place is too far, or the meeting is online and I would rather meet in person" },
  { key: "fit", label: "It does not feel like the right fit" },
  { key: "other", label: "Something else" },
] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number]["key"];
export const isLeaveReason = (v: unknown): v is LeaveReason => LEAVE_REASONS.some((r) => r.key === v);

export const LEAVE_WORDS = {
  open: "I need to leave this tribe",
  title: "Need to leave this tribe?",
  intro: (tribe: string, until: string | null) =>
    `That is all right. In the first two weeks you can leave ${tribe} at any time${until ? `, until ${new Date(`${until}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "long" })}` : ""}, and your seat opens for the next person in line. Your leader is told that a seat has opened, not why.`,
  ask: "Would you like to tell us why? You can skip this.",
  confirm: "Yes, I am leaving this tribe",
  keep: "No, I will stay",
  done: (tribe: string) => `You have left ${tribe}. Thank you for telling us. You can look at the other tribes that are open.`,
  look: "Look at the open tribes",
  later: "The first two weeks are over, so we ask you to talk to your coach or the church office about moving. Nothing has changed.",
} as const;
