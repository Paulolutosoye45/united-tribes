// The contact series and the tribe note (seats and contacts, Package 5): what the private page, the leader's strip and the office list read from the
// database, and every sentence they say. Off, the database answers "off" or "not found" and every screen behaves as it did. No number ever reaches
// these screens: the database sends a number only with its middle hidden, and only to the person it belongs to.

export type ReachKind = "no_number" | "no_yes";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const kindOf = (v: unknown): ReachKind | null => (v === "no_number" || v === "no_yes" ? v : null);

/** A link is 64 hex characters. Anything else is not ours, so it is never sent to the database. */
export const isReachLink = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

// ---------------------------------------------------------------------------
// The member's private page
// ---------------------------------------------------------------------------
export type PageState = "form" | "done" | "email_only" | "expired";
export type PageInfo = {
  state: PageState;
  first: string;
  leaderFirst: string | null;
  tribe: string | null;
  kind: ReachKind | null;
  /** The number they already gave, with its middle hidden. */
  number: string | null;
  /** The number they sign in with, with its middle hidden. The server uses the real one only when the button is pressed. */
  signin: string | null;
};

/** null means the link is not one of ours (or the person cannot be written to): the page says "this link isn’t valid". */
export function parsePageInfo(data: unknown): PageInfo | null {
  if (!isObj(data) || data.found !== true) return null;
  const state: PageState = data.state === "done" || data.state === "email_only" || data.state === "expired" ? data.state : "form";
  return {
    state,
    first: text(data.first) ?? "Friend",
    leaderFirst: text(data.leader_first),
    tribe: text(data.tribe),
    kind: kindOf(data.kind),
    number: text(data.number),
    signin: text(data.signin),
  };
}

/** The two extra boxes on "Yes, I’m in": shown only when there is a number or a yes to put right. */
export type PlacedReach = { gap: ReachKind; number: string | null; signin: string | null };
export function parsePlacedReach(data: unknown): PlacedReach | null {
  if (!isObj(data)) return null;
  const gap = kindOf(data.gap);
  return gap ? { gap, number: text(data.number), signin: text(data.signin) } : null;
}

// ---------------------------------------------------------------------------
// The leader's strip
// ---------------------------------------------------------------------------
export type StripStatus = "to_ask" | "first_go" | "asked" | "follow_up" | "email_only" | "asked_out";
export type StripPerson = { personId: string; firstName: string; status: StripStatus; email: number | null; until: string | null; followUpUsed: boolean };
export type NoteState = "off" | "rehearsal" | "on";
export type TribeStrip = {
  /** The series is On for this leader. */
  on: boolean;
  adults: number;
  reachable: number;
  people: StripPerson[];
  ask: { count: number; names: string[]; nextAt: string | null; can: boolean };
  note: { state: NoteState; limit: number; used: number; nextAt: string | null; recipients: number; can: boolean };
};

export const STRIP_OFF: TribeStrip = {
  on: false,
  adults: 0,
  reachable: 0,
  people: [],
  ask: { count: 0, names: [], nextAt: null, can: false },
  note: { state: "off", limit: 0, used: 0, nextAt: null, recipients: 0, can: false },
};

const STRIP_STATUSES: readonly StripStatus[] = ["to_ask", "first_go", "asked", "follow_up", "email_only", "asked_out"];

export function parseTribeStrip(data: unknown): TribeStrip {
  if (!isObj(data)) return STRIP_OFF;
  const n = isObj(data.note) ? data.note : {};
  const noteState: NoteState = n.state === "on" || n.state === "rehearsal" ? n.state : "off";
  const note = {
    state: noteState,
    limit: int(n.limit),
    used: int(n.used),
    nextAt: text(n.next_at),
    recipients: int(n.recipients),
    can: noteState !== "off" && n.can === true,
  };
  if (data.on !== true) return { ...STRIP_OFF, note };
  const people: StripPerson[] = [];
  for (const p of Array.isArray(data.people) ? data.people : []) {
    if (!isObj(p)) continue;
    const personId = text(p.person_id);
    const status = STRIP_STATUSES.find((s) => s === p.status);
    if (!personId || !status) continue;
    people.push({
      personId,
      firstName: text(p.first_name) ?? "A member",
      status,
      email: typeof p.email === "number" ? int(p.email) : null,
      until: text(p.until),
      followUpUsed: p.follow_up_used === true,
    });
  }
  const a = isObj(data.ask) ? data.ask : {};
  return {
    on: true,
    adults: int(data.adults),
    reachable: int(data.reachable),
    people,
    ask: {
      count: int(a.count),
      names: (Array.isArray(a.names) ? a.names : []).filter((x): x is string => typeof x === "string"),
      nextAt: text(a.next_at),
      can: a.can === true,
    },
    note,
  };
}

// ---------------------------------------------------------------------------
// The office list
// ---------------------------------------------------------------------------
export type SeriesState = "in_series" | "rehearsal" | "email_only" | "seen_not_done" | "silent" | "not_reached" | "stopped" | "not_in_series";
export const SERIES_STATES: readonly SeriesState[] = ["in_series", "rehearsal", "email_only", "seen_not_done", "silent", "not_reached", "stopped", "not_in_series"];
export const isSeriesState = (v: unknown): v is SeriesState => typeof v === "string" && (SERIES_STATES as readonly string[]).includes(v);

export type SeriesOfRow = { state: SeriesState; sends: number; followingUp: boolean; frozen: boolean };
export const SERIES_NONE: SeriesOfRow = { state: "not_in_series", sends: 0, followingUp: false, frozen: false };

export function parseSeriesOf(v: unknown): SeriesOfRow {
  if (!isObj(v) || !isSeriesState(v.state)) return SERIES_NONE;
  return { state: v.state, sends: Math.min(int(v.sends), 4), followingUp: v.following_up === true, frozen: v.frozen === true };
}

export type SeriesStats = { started: number; running: number; fixed: number; emailOnly: number; seenNotDone: number; silent: number; notReached: number; fixedBy: Record<"before" | "1" | "2" | "3" | "4", number> };
export const SERIES_STATS_NONE: SeriesStats = { started: 0, running: 0, fixed: 0, emailOnly: 0, seenNotDone: 0, silent: 0, notReached: 0, fixedBy: { before: 0, "1": 0, "2": 0, "3": 0, "4": 0 } };

export function parseSeriesStats(v: unknown): SeriesStats {
  if (!isObj(v)) return SERIES_STATS_NONE;
  const f = isObj(v.fixed_by) ? v.fixed_by : {};
  return {
    started: int(v.started),
    running: int(v.running),
    fixed: int(v.fixed),
    emailOnly: int(v.email_only),
    seenNotDone: int(v.seen_not_done),
    silent: int(v.silent),
    notReached: int(v.not_reached),
    fixedBy: { before: int(f.before), "1": int(f["1"]), "2": int(f["2"]), "3": int(f["3"]), "4": int(f["4"]) },
  };
}

export function parseSeriesCounts(v: unknown): Record<SeriesState, number> {
  const out = Object.fromEntries(SERIES_STATES.map((s) => [s, 0])) as Record<SeriesState, number>;
  if (isObj(v)) for (const s of SERIES_STATES) out[s] = int(v[s]);
  return out;
}

/** In the order the filter chips are offered. */
export const SERIES_FILTERS: readonly { key: SeriesState; label: string; line: string }[] = [
  { key: "in_series", label: "In the series", line: "Being asked now: the leader’s go, or email 1 to 4." },
  { key: "email_only", label: "Chose email", line: "Pressed “Email me instead”. They are not asked again this season." },
  { key: "seen_not_done", label: "Looked, did not add", line: "Opened a link or signed in, but still no number or yes after the fourth email." },
  { key: "silent", label: "No answer", line: "Four emails, no sign of them." },
  { key: "not_reached", label: "Emails did not arrive", line: "An email failed or bounced. Only a person can reach them." },
  { key: "stopped", label: "Stopped by the office", line: "Someone in the office ended the series for them." },
  { key: "rehearsal", label: "Rehearsal", line: "Written down only. Nothing was sent." },
  { key: "not_in_series", label: "Not started", line: "Has a gap, but the series has not reached them yet." },
];

export function seriesWords(s: SeriesOfRow): string {
  switch (s.state) {
    case "in_series":
      return s.followingUp ? "Leader is following up" : s.frozen ? "On hold" : s.sends === 0 ? "Waiting for the leader’s go" : `Email ${s.sends} of 4 sent`;
    case "rehearsal":
      return "Rehearsal";
    case "email_only":
      return "Chose email";
    case "seen_not_done":
      return "Looked, did not add";
    case "silent":
      return "No answer";
    case "not_reached":
      return "Emails did not arrive";
    case "stopped":
      return "Stopped by the office";
    default:
      return "Not started";
  }
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------
export const ADD_NUMBER_WORDS = {
  headTitle: "Add your WhatsApp number",
  numberTitle: (first: string) => `${first}, add your WhatsApp number`,
  yesTitle: (first: string) => `${first}, one tick to finish`,
  noNumberBody: (leader: string, tribe: string | null) =>
    `${leader} cannot message you on WhatsApp yet, because we have no number for you${tribe ? ` in ${tribe}` : ""}. Add it here, and tick the box if you are happy for them to use it.`,
  noYesBody: (leader: string, number: string | null) =>
    `You gave us ${number ?? "your number"}. ${leader} cannot use it yet, because WhatsApp is not ticked. Tick the box if you are happy for them to message you there.`,
  numberLabel: "Your WhatsApp number",
  numberHint: "With the country code, like +234 803 123 4567.",
  agree: "My tribe’s leader, their assistant and my coach may message me on WhatsApp about my tribe.",
  whoSees: "Only they can see your number, and only because you ticked this. Other members never see it. You can change your mind any time on your profile.",
  save: "Save",
  saveTick: "Yes, they may message me",
  signinButton: (signin: string) => `Use ${signin}, the number I sign in with`,
  signinNote: "That is the number you sign in with. We use it only because you pressed this button.",
  emailInstead: "I would rather be emailed",
  emailInsteadNote: "That is fine. We will not ask again this season, and your leader will email you instead.",
  badNumber: "That number does not look right. Check it has the country code, like +234 803 123 4567.",
  badSignin: "We do not have a sign-in number to use here. Type your number in the box instead.",
  problem: "That did not save. Please try again.",
  invalidTitle: "This link isn’t valid.",
  invalidBody: "Check you opened the whole link. If it still does not work, sign in and add your number on your profile.",
  expiredTitle: "This link has run out.",
  expiredBody: "Links last thirty days. We can send you a new one.",
  newLink: "Send me a new link",
  linkSent: "If you still need to add your number, a new link is on its way to your email.",
  doneTitle: (first: string) => `Thank you, ${first}.`,
  doneBody: (leader: string | null) => `${leader ?? "Your tribe’s leader"} can now reach you on WhatsApp. Nothing more to do.`,
  savedNoTick: "Your number is saved. Your leader still cannot message you until you tick the box below.",
  emailOnlyTitle: "We will email you.",
  emailOnlyBody: (leader: string | null) => `${leader ?? "Your leader"} will use email. If you change your mind, add your number on your profile any time.`,
  profile: "Open my profile",
} as const;

/** The two boxes on the placement page, above “Yes, I’m in”. */
export const PLACED_REACH_WORDS = {
  title: "Add your WhatsApp number (optional)",
  body: "Your leader can message you on WhatsApp only if you add your number and agree. You can skip this and do it later.",
  tickOnly: "Your number is saved. Tick the box if you are happy for your leader to message you on WhatsApp.",
} as const;

export const STRIP_WORDS = {
  title: "Reaching your tribe",
  line: (reachable: number, adults: number) => (adults === 0 ? "No adults to reach yet." : `${reachable} of ${adults} can be messaged on WhatsApp.`),
  allReachable: "Everyone can be messaged on WhatsApp.",
  askTitle: "Ask my members",
  askBody: (count: number) =>
    count === 1 ? "One member has not added a WhatsApp number, or has not said yes to WhatsApp. They get an email from you now, with a private link to fix it in a minute." : `${count} members have not added a WhatsApp number, or have not said yes to WhatsApp. They get an email from you now, each with a private link to fix it in a minute.`,
  askAuto: "If you do nothing, the church sends the first email for you after a day, then three more over the next days. They choose what to share.",
  lineLabel: "Add a line of your own (optional)",
  lineHint: "A short, personal sentence the email will quote in your name. No links.",
  lineMax: 200,
  askButton: "Ask my members",
  confirm: (count: number) => (count === 1 ? "Send the email to 1 member" : `Send the email to ${count} members`),
  cancel: "Not now",
  sent: (n: number) => (n === 1 ? "Done. One member has been emailed." : `Done. ${n} members have been emailed.`),
  nextAsk: (when: string) => `You can ask again on ${when}.`,
  followUp: "I’ll follow this up myself",
  followUpDone: (first: string) => `Fine. ${first} will not be emailed for three days.`,
  followUpUsed: "Used",
  statusLine: {
    to_ask: "Not asked yet",
    first_go: "Your go: email goes by itself soon",
    asked: (email: number | null) => (email ? `Email ${email} of 4 sent` : "Asked"),
    follow_up: "You are following up",
    email_only: "Wants email only",
    asked_out: "Asked four times: please ask in person",
  },
  noteTitle: "Write to my tribe",
  noteBody: "One email to everyone in your tribe who can be emailed, in your name. Members who still have no WhatsApp number get a button to add it.",
  noteLabel: "Your note",
  noteHint: "Up to 600 characters. No links.",
  noteMax: 600,
  noteSend: "Send the note",
  noteSent: (n: number) => (n === 1 ? "Sent to 1 member." : `Sent to ${n} members.`),
  noteRehearsal: "This is a Rehearsal: the note is kept, and no email goes out.",
  noteLimit: (limit: number, next: string | null) => `You have sent your ${limit} notes for this week.${next ? ` The next can go on ${next}.` : ""}`,
  noteCount: (used: number, limit: number) => `${used} of ${limit} notes sent this week`,
} as const;

export const OFFICE_SERIES_WORDS = {
  title: "The contact series",
  line: "Each person with a gap gets four emails over six days. Nobody is moved or removed by it, and the leader sees on their own page who is still left.",
  stage: "Series",
  pause: "Pause the series for everyone",
  resume: "Resume the series",
  paused: "The series is paused for everyone. Emails already running keep their remaining days.",
  stop: "Stop the series for this person",
  stopReason: "Why? (the person asked, a pastoral reason…)",
  fixedBy: "Which email fixed it",
  reachedTitle: "How the series is going",
  statsLine: (s: { started: number; fixed: number }) => (s.started === 0 ? "Nobody has been through the series yet." : `${s.fixed} of ${s.started} put it right.`),
} as const;

// ---------------------------------------------------------------------------
// The owner's settings (God Mode, under Features)
// ---------------------------------------------------------------------------
export type ReachSettings = {
  firstGoHours: number;
  releaseAfterDays: number;
  endMode: "silent" | "everyone" | "list";
  notePerWeek: number;
  emailDays: number[];
  reason: string | null;
};

export function parseReachSettings(data: unknown): ReachSettings | null {
  if (!isObj(data) || typeof data.first_go_hours !== "number" || typeof data.release_after_days !== "number") return null;
  return {
    firstGoHours: int(data.first_go_hours),
    releaseAfterDays: int(data.release_after_days),
    endMode: data.end_mode === "everyone" || data.end_mode === "list" ? data.end_mode : "silent",
    notePerWeek: int(data.note_per_week) || 2,
    emailDays: (Array.isArray(data.email_days) ? data.email_days : []).filter((x): x is number => typeof x === "number"),
    reason: text(data.reason),
  };
}

export const SETTINGS_WORDS = {
  title: "Contact series settings",
  line: "How long a leader has before the church sends the first email, how many days the four emails are spread over, and how many notes a tribe may send a week. A change applies to people who join the series afterwards; a series already running keeps the days it started with.",
  firstGo: "Hours the leader has to press Ask my members first (0 to 72)",
  length: "Days from the first email to the end (4 to 10)",
  notes: "Notes a tribe may send a week (1 to 4)",
  days: (d: number[]) => `Emails go on day ${d.join(", ")} after the first.`,
  why: "Why are you changing it? (kept in the log)",
  save: "Save the settings",
  saved: "Saved.",
} as const;
