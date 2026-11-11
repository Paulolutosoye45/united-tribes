import { slotWord } from "./desk";

// The Leader Desk's emails (Phase 2a), as the God Mode screens read them. Every parser takes whatever the database sent and gives back something safe to show:
// anything it does not understand becomes nothing, never a guess.

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);

export const SEND_WORDS = {
  tab: "Sending",
  title: "What the Desk sends",
  intro: "Emails to members who are waiting for a tribe: one open tribe that fits them, a question about a group still being put together, and, once a group has a leader, a note to say so. Leader offers are listed apart, below. Each is answered with one tap on a private page.",
  modes: {
    off: "The Desk is switched off. Nothing is sent.",
    rehearsal: "Rehearsal. Nothing is sent. The Desk writes down who would have been emailed, and you can read it below.",
    on: "On. The emails are sent, between 9 am and 7 pm Lagos time.",
  } as Record<string, string>,
  paused: "The Master pause is on, so nothing is sent whatever the switch says.",
  today: (sent: number, would: number) => `Today: ${sent} sent, ${would} written down in Rehearsal.`,
  limitsTitle: "Limits",
  limitsHelp: "Each change needs a reason, is written down, and applies from the next email on. Rehearsal and real emails are counted apart.",
  fields: {
    daily: { label: "Emails a day", hint: "1 to 300. The most the Desk sends in one day." },
    gap: { label: "Days between one member’s emails", hint: "1 to 60. A member hears from the Desk at most once in this time." },
    season: { label: "Emails to one member in a season", hint: "1 to 10." },
    hours: { label: "Hours to answer an interest check", hint: "12 to 240. After this, no answer leaves the member waiting. Nobody is placed by silence." },
    reason: { label: "Why you are changing this", hint: "3 to 300 characters. Only you see it." },
  },
  listTitle: "What was sent",
  listEmpty: "Nothing has been sent, or written down in Rehearsal, yet.",
  kind: { tribe: "A proposed tribe", interest: "An interest check", found: "Your group has a leader" } as Record<string, string>,
  withdraw: "Withdraw",
  propose: {
    button: "Email a proposed group",
    asking: "Looking for the best tribe…",
    on: "This sends one email now.",
    rehearsal: "This is Rehearsal: it is only written down, and nothing is sent.",
    confirm: "Send it",
    confirmRehearsal: "Write it down",
    cancel: "Not now",
    sent: "The email is on its way.",
    written: "Written down. Nothing was sent.",
  },
  interest: {
    button: "Check interest",
    on: "This sends one email to each member of the draft who can be asked.",
    rehearsal: "This is Rehearsal: it is only written down, and nothing is sent.",
    confirm: "Ask them",
    confirmRehearsal: "Write it down",
    cancel: "Not now",
  },
} as const;

export type SendState = {
  mode: "off" | "rehearsal" | "on";
  paused: boolean;
  dailyCap: number;
  gapDays: number;
  seasonCap: number;
  interestHours: number;
  sentToday: number;
  wouldToday: number;
  sendingHours: boolean;
};

export function parseSendState(v: unknown): SendState | null {
  if (!isObj(v)) return null;
  const mode = v.mode === "on" || v.mode === "rehearsal" ? v.mode : "off";
  return {
    mode,
    paused: v.paused === true,
    dailyCap: int(v.daily_cap),
    gapDays: int(v.gap_days),
    seasonCap: int(v.season_cap),
    interestHours: int(v.interest_hours),
    sentToday: int(v.sent_today),
    wouldToday: int(v.would_today),
    sendingHours: v.sending_hours === true,
  };
}

export type ProposalRow = {
  id: string;
  kind: "tribe" | "interest" | "found";
  personId: string;
  name: string;
  target: string | null;
  status: "would_send" | "sent" | "answered" | "expired" | "cancelled";
  answer: "yes" | "no" | "other_time" | "stop" | null;
  slots: string[];
  rehearsal: boolean;
  degree: number | null;
  at: string | null;
  expiresAt: string | null;
};
export type ProposalsPage = {
  total: number;
  counts: { sent: number; wouldSend: number; yes: number; no: number; otherTime: number; stop: number; expired: number };
  rows: ProposalRow[];
};
export const EMPTY_PROPOSALS: ProposalsPage = { total: 0, counts: { sent: 0, wouldSend: 0, yes: 0, no: 0, otherTime: 0, stop: 0, expired: 0 }, rows: [] };

const STATUSES = ["would_send", "sent", "answered", "expired", "cancelled"] as const;
const ANSWERS = ["yes", "no", "other_time", "stop"] as const;

export function parseProposals(v: unknown): ProposalsPage {
  if (!isObj(v)) return EMPTY_PROPOSALS;
  const c = isObj(v.counts) ? v.counts : {};
  const rows: ProposalRow[] = [];
  for (const r of list(v.rows)) {
    if (!isObj(r)) continue;
    const rid = id(r.id);
    const pid = id(r.person_id);
    const status = STATUSES.find((s) => s === r.status);
    if (!rid || !pid || !status || (r.kind !== "tribe" && r.kind !== "interest" && r.kind !== "found")) continue;
    rows.push({
      id: rid,
      kind: r.kind,
      personId: pid,
      name: text(r.name) ?? "A member",
      target: text(r.target),
      status,
      answer: ANSWERS.find((a) => a === r.answer) ?? null,
      slots: list(r.slots).filter((s): s is string => typeof s === "string"),
      rehearsal: r.rehearsal === true,
      degree: typeof r.degree === "number" ? Math.round(r.degree) : null,
      at: text(r.at),
      expiresAt: text(r.expires_at),
    });
  }
  return {
    total: int(v.total),
    counts: { sent: int(c.sent), wouldSend: int(c.would_send), yes: int(c.yes), no: int(c.no), otherTime: int(c.other_time), stop: int(c.stop), expired: int(c.expired) },
    rows,
  };
}

/** How an email stands, in words. */
export function statusWord(r: Pick<ProposalRow, "status" | "answer" | "slots" | "rehearsal">): string {
  if (r.status === "would_send") return "Would have been sent";
  if (r.status === "sent") return "Sent, no answer yet";
  if (r.status === "expired") return "No answer in time";
  if (r.status === "cancelled") return "Withdrawn";
  if (r.answer === "yes") return "Said yes";
  if (r.answer === "no") return "Said not for me";
  if (r.answer === "stop") return "Asked us to stop";
  if (r.answer === "other_time") return r.slots.length > 0 ? `Would rather: ${r.slots.map(slotWord).join(", ").toLowerCase()}` : "Asked for a different time";
  return "Answered";
}

export const canWithdraw = (r: Pick<ProposalRow, "status">): boolean => r.status === "sent" || r.status === "would_send";

export type InterestState = "yes" | "asked" | "would_ask" | "expired" | "none";
export type InterestView = {
  members: Record<string, InterestState>;
  left: { personId: string; name: string; answer: "no" | "other_time"; slots: string[] }[];
};
export const EMPTY_INTEREST: InterestView = { members: {}, left: [] };

export function parseInterest(v: unknown): InterestView {
  if (!isObj(v)) return EMPTY_INTEREST;
  const members: Record<string, InterestState> = {};
  for (const m of list(v.members)) {
    if (!isObj(m)) continue;
    const pid = id(m.person_id);
    if (!pid) continue;
    members[pid] = m.state === "yes" ? "yes" : m.state === "sent" ? "asked" : m.state === "would_ask" ? "would_ask" : m.state === "expired" ? "expired" : "none";
  }
  const left: InterestView["left"] = [];
  for (const m of list(v.left)) {
    if (!isObj(m)) continue;
    const pid = id(m.person_id);
    if (!pid || (m.answer !== "no" && m.answer !== "other_time")) continue;
    left.push({ personId: pid, name: text(m.name) ?? "A member", answer: m.answer, slots: list(m.slots).filter((s): s is string => typeof s === "string") });
  }
  return { members, left };
}

export const INTEREST_WORDS: Record<InterestState, string> = {
  yes: "Said yes",
  asked: "Asked, no answer yet",
  would_ask: "Would be asked",
  expired: "No answer in time",
  none: "Not asked",
};

export type Preview =
  | { ok: true; tribeId: string; mode: "rehearsal" | "on"; tribe: string; leaderFirst: string; degree: number | null; seatsLeft: number | null }
  | { ok: false; text: string };

export function parsePreview(v: unknown): Preview | null {
  if (!isObj(v)) return null;
  if (v.ok !== true) return { ok: false, text: text(v.text) ?? "No email can be sent to that member now." };
  const tribeId = id(v.tribe_id);
  const p = isObj(v.params) ? v.params : {};
  if (!tribeId) return null;
  return {
    ok: true,
    tribeId,
    mode: v.mode === "on" ? "on" : "rehearsal",
    tribe: text(p.tribe) ?? "A tribe",
    leaderFirst: text(p.leader_first) ?? "its leader",
    degree: typeof p.degree === "number" ? Math.round(p.degree) : null,
    seatsLeft: typeof p.seats_left === "number" ? Math.round(p.seats_left) : null,
  };
}

export const previewLine = (p: Extract<Preview, { ok: true }>): string =>
  `${p.tribe}, led by ${p.leaderFirst}${p.degree !== null ? `, ${p.degree}% fit` : ""}${p.seatsLeft !== null ? `, ${p.seatsLeft} ${p.seatsLeft === 1 ? "seat" : "seats"} left` : ""}.`;

export type CheckResult = { sent: number; wouldSend: number; skipped: { code: string; count: number }[] };
export function parseCheck(v: unknown): CheckResult | null {
  if (!isObj(v)) return null;
  const sk = isObj(v.skipped) ? v.skipped : {};
  return { sent: int(v.sent), wouldSend: int(v.would_send), skipped: Object.entries(sk).map(([code, count]) => ({ code, count: int(count) })).filter((s) => s.count > 0) };
}

const SKIP_WORDS: Record<string, string> = {
  already: "already asked",
  not_waiting: "no longer waiting",
  no_fit: "no longer fit the group",
  off: "the Desk is off for them",
  under18: "under 18",
  deletion: "asked for their details to be deleted",
  bounced: "emails not arriving",
  email_off: "email switched off",
  announcements_off: "stopped announcements",
  care: "an open care follow-up",
  stopped: "asked the Desk to stop",
  excluded: "not written to",
  gap: "had a Desk email lately",
  season: "had the most allowed this season",
  day: "today’s limit reached",
};

/** "Written down for 3. Left out: 1 already asked, 1 emails not arriving." */
export function checkSummary(r: CheckResult): string {
  const done = r.sent > 0 ? `Sent to ${r.sent}.` : r.wouldSend > 0 ? `Written down for ${r.wouldSend}. Nothing was sent.` : "Nobody was asked.";
  const left = r.skipped.map((s) => `${s.count} ${SKIP_WORDS[s.code] ?? s.code}`);
  return left.length > 0 ? `${done} Left out: ${left.join(", ")}.` : done;
}

// ---------------------------------------------------------------------------
// WhatsApp for the Desk: one switch, Off to begin with
// ---------------------------------------------------------------------------

export const WA_WORDS = {
  title: "WhatsApp",
  help: "While this is Off, every Desk message goes by email only. When it is On, each member gets the Desk's messages the way they agreed to be reached: on WhatsApp if they gave a number and agreed, otherwise by email. WhatsApp mode (Full, Saver or Free), the Master pause and the weekly limit still apply, and email is the fallback when WhatsApp cannot be used. The Desk's own limits, its blocks and Rehearsal are the same either way, and a Rehearsal sends nothing.",
  off: "Off. The Desk sends email only.",
  on: "On. The Desk uses WhatsApp for members who agreed to it, and email for everyone else.",
  mode: (mode: string) => (mode === "free" ? "WhatsApp mode is Free, so nothing goes through Meta even with this On." : mode === "saver" ? "WhatsApp mode is Saver: only the question to someone asked to lead stays on WhatsApp; the rest goes by email." : "WhatsApp mode is Full."),
  paused: "WhatsApp is paused, so nothing goes by WhatsApp whatever this says.",
  reach: (reach: number, waiting: number) => `${reach} of the ${waiting} members waiting for a tribe have a number on file and have agreed to WhatsApp, so they would be reached there.`,
  approval: "Meta must approve the Desk's WhatsApp wording before it can send. Until then a message is turned down and goes by email instead.",
  turnOn: "Turn WhatsApp on for the Desk",
  turnOff: "Turn WhatsApp off for the Desk",
  reason: { label: "Why you are changing this", hint: "3 to 300 characters. Only you see it." },
  savedOn: "Saved. The Desk will use WhatsApp from the next message.",
  savedOff: "Saved. The Desk is email only again, and anything waiting to be sent has gone back to email.",
} as const;

export type WhatsAppState = { on: boolean; mode: "full" | "saver" | "free"; paused: boolean; waiting: number; reach: number; reason: string | null; changedAt: string | null };

export function parseWhatsAppState(v: unknown): WhatsAppState | null {
  if (!isObj(v) || typeof v.on !== "boolean") return null;
  return {
    on: v.on,
    mode: v.mode === "saver" || v.mode === "free" ? v.mode : "full",
    paused: v.paused === true,
    waiting: int(v.waiting),
    reach: int(v.reach),
    reason: text(v.reason),
    changedAt: text(v.changed_at),
  };
}
