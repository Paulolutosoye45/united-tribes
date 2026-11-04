// Leader cards (fix 5, fix 4): for every leader with a Tribe Card this season, where the card is, whether the email with its link arrived, and the
// kind ways to chase it. What the screens read from the database (leader_cards_board, leader_cards_failures, leader_card_reminders_get,
// leader_cards_sheet), every state in words, and the two downloads. The database never sends a number or an address to a screen that may not see one.

export type CardState = "not_started" | "in_progress" | "changes_asked" | "submitted" | "approved";
export type InviteState = "sent" | "sending" | "failed" | "not_sent";
export type CardFilter = "unfinished" | "not_started" | "in_progress" | "changes_asked" | "submitted" | "approved" | "all" | "email_failed" | "never_signed_in";
export type ReminderMode = "off" | "rehearsal" | "on";

/** In the order the filters are shown. */
export const FILTERS: readonly { key: CardFilter; label: string; line: string }[] = [
  { key: "unfinished", label: "Not finished", line: "Not started, in progress, or sent back with changes asked for." },
  { key: "not_started", label: "Not started", line: "The card is there, and the leader has put nothing on it." },
  { key: "in_progress", label: "In progress", line: "Started, not yet sent in." },
  { key: "changes_asked", label: "Changes asked for", line: "The pastorate sent it back." },
  { key: "submitted", label: "Sent in", line: "Waiting for the pastorate." },
  { key: "approved", label: "Approved", line: "Done." },
  { key: "email_failed", label: "Email did not arrive", line: "The email with the link failed, or was never sent." },
  { key: "never_signed_in", label: "Never signed in", line: "Has not signed in since being made a leader." },
  { key: "all", label: "Everyone", line: "Every leader with a card this season." },
] as const;

export const CARD_WORDS: Record<CardState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  changes_asked: "Changes asked for",
  submitted: "Sent in",
  approved: "Approved",
};

export const INVITE_WORDS: Record<InviteState, string> = {
  sent: "Email sent",
  sending: "Waiting to go",
  failed: "Did not arrive",
  not_sent: "Never sent",
};

export const HOW_WORDS: Record<string, string> = { appointed: "Appointed", applied: "Applied" };

/** What the database says when it holds a leader back from an email, in words the office can act on. */
export const SKIP_WORDS: Record<string, string> = {
  card_sent: "Their card is already sent in",
  sent_three_times: "Already sent three times",
  already_today: "Already written to today",
  bounced: "Their address bounces",
  email_off: "They switched email off",
  deletion: "They asked for their data to be deleted",
  under18: "Not a leader we may write to",
};
export const skipWords = (reason: string): string => SKIP_WORDS[reason] ?? reason;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const isState = (v: unknown): v is CardState => typeof v === "string" && v in CARD_WORDS;
const isInvite = (v: unknown): v is InviteState => typeof v === "string" && v in INVITE_WORDS;
const isFilter = (v: unknown): v is CardFilter => typeof v === "string" && FILTERS.some((f) => f.key === v);
export const asFilter = (v: unknown): CardFilter => (isFilter(v) ? v : "unfinished");

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------
export type BoardRow = {
  personId: string;
  name: string;
  tribeId: string;
  tribe: string;
  state: CardState;
  how: string;
  department: string | null;
  invite: { state: InviteState; reason: string | null; at: string | null; tries: number };
  /** Why a bounced or switched-off address will not take the email, when it is that. */
  blocker: string | null;
  signedIn: boolean;
  lastActivity: string | null;
  reminders: number;
  resends: number;
  /** Only for those who act, and only when the email did not arrive. */
  email: string | null;
  canChat: boolean;
};
export type Counts = Record<CardFilter, number>;
export type Board = {
  ok: boolean;
  role: "act" | "look" | null;
  filter: CardFilter;
  counts: Counts;
  total: number;
  rows: BoardRow[];
  departments: string[];
  limit: number;
  offset: number;
  reminderMode: ReminderMode;
};

export const EMPTY_COUNTS: Counts = {
  unfinished: 0, not_started: 0, in_progress: 0, changes_asked: 0, submitted: 0, approved: 0, all: 0, email_failed: 0, never_signed_in: 0,
};
export const BOARD_OFF: Board = { ok: false, role: null, filter: "unfinished", counts: { ...EMPTY_COUNTS }, total: 0, rows: [], departments: [], limit: 100, offset: 0, reminderMode: "off" };

function counts(v: unknown): Counts {
  const out = { ...EMPTY_COUNTS };
  if (isObj(v)) for (const k of Object.keys(out) as CardFilter[]) out[k] = int(v[k]);
  return out;
}

/** Reads the database's answer defensively: anything not clearly in the shape means the board is not available. */
export function parseBoard(data: unknown): Board {
  if (!isObj(data) || (data.role !== "act" && data.role !== "look")) return BOARD_OFF;
  const rows: BoardRow[] = [];
  for (const r of Array.isArray(data.rows) ? data.rows : []) {
    if (!isObj(r) || !isState(r.state)) continue;
    const personId = text(r.person_id);
    if (!personId) continue;
    const inv = isObj(r.invite) ? r.invite : {};
    rows.push({
      personId,
      name: text(r.name) ?? "A leader",
      tribeId: text(r.tribe_id) ?? "",
      tribe: text(r.tribe) ?? "Their tribe",
      state: r.state,
      how: text(r.how) ?? "applied",
      department: text(r.department),
      invite: { state: isInvite(inv.state) ? inv.state : "not_sent", reason: text(inv.reason), at: text(inv.at), tries: int(inv.tries) },
      blocker: text(r.blocker),
      signedIn: r.signed_in === true,
      lastActivity: text(r.last_activity),
      reminders: int(r.reminders),
      resends: int(r.resends),
      email: text(r.email),
      canChat: r.can_chat === true,
    });
  }
  const reminders = isObj(data.reminders) ? data.reminders : {};
  return {
    ok: true,
    role: data.role,
    filter: asFilter(data.filter),
    counts: counts(data.counts),
    total: int(data.total),
    rows,
    departments: (Array.isArray(data.departments) ? data.departments : []).filter((d): d is string => typeof d === "string"),
    limit: int(data.limit) || 100,
    offset: int(data.offset),
    reminderMode: reminders.mode === "rehearsal" || reminders.mode === "on" ? reminders.mode : "off",
  };
}

/** "today", "yesterday", "3 days ago", or "never". */
export function agoWords(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Never";
  const days = Math.floor((now - t) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

/** One line about the invitation: what happened, and when or why. */
export function inviteLine(row: BoardRow, now: number = Date.now()): string {
  const w = INVITE_WORDS[row.invite.state];
  if (row.invite.state === "sent") return `${w} ${agoWords(row.invite.at, now).toLowerCase()}`;
  if (row.invite.state === "failed") return row.invite.reason ? `${w}: ${row.invite.reason.slice(0, 120)}` : w;
  if (row.invite.state === "not_sent" && row.blocker) return `${w}: ${skipWords(row.blocker).toLowerCase()}`;
  return w;
}

/** Whether "Send the email again" makes sense for this row. */
export function canResend(row: BoardRow): boolean {
  return row.state !== "submitted" && row.state !== "approved" && row.resends < 3;
}

/** The leaders the bulk button would write to: the email did not arrive, and they have not started. */
export function bulkTargets(rows: readonly BoardRow[]): BoardRow[] {
  return rows.filter((r) => r.state === "not_started" && (r.invite.state === "failed" || r.invite.state === "not_sent") && r.resends < 3);
}

// ---------------------------------------------------------------------------
// The failures, for Admin -> Sending and email
// ---------------------------------------------------------------------------
export type Failure = { personId: string; name: string; tribe: string; state: "failed" | "not_sent"; reason: string | null; at: string | null };
export type Failures = { count: number; rows: Failure[] };
export const NO_FAILURES: Failures = { count: 0, rows: [] };

export function parseFailures(data: unknown): Failures {
  if (!isObj(data)) return NO_FAILURES;
  const rows: Failure[] = [];
  for (const r of Array.isArray(data.rows) ? data.rows : []) {
    if (!isObj(r) || !text(r.person_id)) continue;
    rows.push({
      personId: String(r.person_id),
      name: text(r.name) ?? "A leader",
      tribe: text(r.tribe) ?? "",
      state: r.state === "failed" ? "failed" : "not_sent",
      reason: text(r.reason),
      at: text(r.at),
    });
  }
  return { count: Math.max(int(data.count), rows.length), rows };
}

// ---------------------------------------------------------------------------
// The reminder setting
// ---------------------------------------------------------------------------
export type Reminders = {
  role: "act" | "look" | null;
  mode: ReminderMode;
  days: number[];
  startHour: number;
  maxTotal: number;
  reason: string | null;
  changedAt: string | null;
  paused: boolean;
  week: { sent: number; wouldSend: number; resent: number };
};
export const REMINDERS_OFF: Reminders = {
  role: null, mode: "off", days: [4, 5, 6], startHour: 9, maxTotal: 12, reason: null, changedAt: null, paused: false, week: { sent: 0, wouldSend: 0, resent: 0 },
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const dayWords = (days: readonly number[]): string => {
  const names = days.map((d) => DAY_NAMES[d]).filter(Boolean);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};
export const hourWords = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

export function parseReminders(data: unknown): Reminders {
  if (!isObj(data)) return REMINDERS_OFF;
  const week = isObj(data.week) ? data.week : {};
  const days = (Array.isArray(data.days) ? data.days : []).filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
  return {
    role: data.role === "act" || data.role === "look" ? data.role : null,
    mode: data.mode === "rehearsal" || data.mode === "on" ? data.mode : "off",
    days: days.length ? days : [4, 5, 6],
    startHour: int(data.start_hour) || 9,
    maxTotal: int(data.max_total) || 12,
    reason: text(data.reason),
    changedAt: text(data.changed_at),
    paused: data.paused === true,
    week: { sent: int(week.sent), wouldSend: int(week.would_send), resent: int(week.resent) },
  };
}

// ---------------------------------------------------------------------------
// The two sheets
// ---------------------------------------------------------------------------
export type SheetKind = "hod" | "call";
export type SheetRow = {
  department: string;
  name: string;
  tribe: string;
  how: string;
  state: string;
  invite: string;
  signedIn: boolean;
  lastActivity: string | null;
  phone: string;
  email: string;
  whatsappOk: boolean | null;
};

export function parseSheet(data: unknown): SheetRow[] {
  if (!Array.isArray(data)) return [];
  const out: SheetRow[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    out.push({
      department: text(r.department) ?? "",
      name: text(r.name) ?? "",
      tribe: text(r.tribe) ?? "",
      how: text(r.how) ?? "",
      state: text(r.state) ?? "",
      invite: text(r.invite) ?? "",
      signedIn: r.signed_in === true,
      lastActivity: text(r.last_activity),
      phone: text(r.phone) ?? "",
      email: text(r.email) ?? "",
      whatsappOk: typeof r.whatsapp_ok === "boolean" ? r.whatsapp_ok : null,
    });
  }
  return out;
}

const cell = (v: string | number | null): string => {
  // A spreadsheet runs a cell that begins with = + - or @ as a formula: a name never needs to. A phone number starts with + and is a number, so it is
  // kept as text with a leading apostrophe by the same rule, which a spreadsheet shows without the apostrophe.
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const yesNo = (v: boolean | null) => (v === null ? "" : v ? "Yes" : "No");

/** "For the heads of department": names, tribe, department and where each card is. No number and no address. Grouped by department, those with none last. */
export function sheetCsv(kind: SheetKind, rows: readonly SheetRow[]): string {
  const call = kind === "call";
  const head = ["Department", "Name", "Tribe", "How they came", "Where their card is", "Their email", "Signed in", "Last did something", ...(call ? ["Phone", "Email address", "Said yes to WhatsApp"] : [])];
  const lines = [head.map(cell).join(",")];
  for (const r of rows) {
    const base = [
      r.department || "No department yet", r.name, r.tribe, HOW_WORDS[r.how] ?? r.how, CARD_WORDS[r.state as CardState] ?? r.state,
      INVITE_WORDS[r.invite as InviteState] ?? r.invite, r.signedIn ? "Yes" : "No", r.lastActivity ? r.lastActivity.slice(0, 10) : "",
    ];
    lines.push((call ? [...base, r.phone, r.email, yesNo(r.whatsappOk)] : base).map(cell).join(","));
  }
  // The byte-order mark makes a spreadsheet read the accents in a name
  return "﻿" + lines.join("\r\n") + "\r\n";
}
