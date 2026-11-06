// The placed-member nudge (seats and contacts, Package 6a): every sentence it says and everything its screens read from the database. Off, the database
// answers "off" and every screen behaves as it did. No full number reaches these screens: the database sends a number only with its middle hidden, and
// only to the person it belongs to.

import type { DesignSpec } from "@/lib/outreach/email-design";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** A link is 64 hex characters. Anything else is not ours, so it is never sent to the database. */
export const isNudgeLink = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export type NudgeState = "off" | "rehearsal" | "on";
export const parseNudgeState = (v: unknown): NudgeState => (v === "rehearsal" || v === "on" ? v : "off");

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------
/** Said in every nudge, whatever the office writes. The email puts it in again if a writer takes it out. */
export const LOCKED_PARAGRAPH = "Your leader, their assistant and your coach can see your number only if you agree to WhatsApp. Other members never see it.";

/** The longest subject that fits a phone's lock screen. */
export const SUBJECT_MAX = 78;

/** The wording "Use the nudge wording" fills in. Only the words the announcement check allows: {first_name} and {tribe}. */
export const NUDGE_WORDING = {
  title: "Nudge the members we placed",
  subject: "One tap keeps your place in {tribe}",
  paragraphs: [
    "Your place in {tribe} is being held for you, and your leader is looking forward to meeting you.",
    "One tap tells us you are in. On the next page you choose whether your leader may message you on WhatsApp. That choice is yours.",
    "If this tribe is not right for you, you can choose another. Nothing is lost.",
  ],
  label: "Placed by the church, waiting for a reply",
} as const;

/** The three buttons every nudge carries. An email that offered only "yes" would be pressure. */
export const NUDGE_BUTTONS = {
  yes: "Yes, I’m in",
  other: "Show me other tribes",
  withhold: "Don’t share my details",
} as const;

export const NUDGE_WHY = "You are getting this because the church placed you in a tribe on United Tribes and you have not replied yet.";

/** Inserts the locked paragraph before the writer's last paragraph (after it when there is only one), unless the writer already wrote it. */
export function withLocked(paragraphs: string[]): string[] {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (paragraphs.some((p) => squash(p) === squash(LOCKED_PARAGRAPH))) return paragraphs;
  if (paragraphs.length < 2) return [...paragraphs, LOCKED_PARAGRAPH];
  return [...paragraphs.slice(0, -1), LOCKED_PARAGRAPH, paragraphs[paragraphs.length - 1]];
}

/** What the composer's preview shows for a nudge: the same card, three buttons and locked line the member's email carries, with links that go nowhere. */
export function nudgePreview(spec: DesignSpec, tribe: string | undefined, site: string): DesignSpec {
  const link = (a: string) => `${site.replace(/\/+$/, "")}/placed/${"0".repeat(64)}?a=${a}`;
  return {
    ...spec,
    preheader: "Your leader is looking forward to meeting you.",
    paragraphs: withLocked(spec.paragraphs),
    hero: { kind: "held", name: tribe || "Your tribe", when: "Its day and time", leader: "your leader" },
    button: { label: NUDGE_BUTTONS.yes, url: link("confirm") },
    options: [
      { label: NUDGE_BUTTONS.other, url: link("change") },
      { label: NUDGE_BUTTONS.withhold, url: link("withhold") },
    ],
    note: undefined,
    why: NUDGE_WHY,
  };
}

// ---------------------------------------------------------------------------
// Announcements: the audience
// ---------------------------------------------------------------------------
export type NudgeNeed = "all" | "gap";
export const NUDGE_AUDIENCE = {
  label: "Placed by the church, waiting for a reply",
  help: "Members the church placed in a tribe who have not yet said yes. Each email carries their own private link.",
  needTitle: "Who",
  needAll: "Everyone who is waiting",
  needGap: "Only those with no number or no WhatsApp yes",
  waitedTitle: "Placed more than",
  waitedHours: (h: number) => (h === 24 ? "24 hours ago (the default)" : h % 24 === 0 ? `${h / 24} days ago` : `${h} hours ago`),
  tribeTitle: "One tribe only (optional)",
  useWording: "Use the nudge wording",
  rehearsal: "Rehearsal: nothing will be sent",
  rehearsalHelp: "Placed nudge is in Rehearsal. You can see who would get it and send a test to yourself. Nothing goes to members until it is moved to On.",
  lockedNote: "A line about who can see a number is added to every nudge. It cannot be taken out.",
  buttonNote: "The buttons are fixed: each member gets Yes, I’m in, Show me other tribes and Don’t share my details, with their own private link.",
} as const;

export const NUDGE_WAITED_CHOICES = [24, 48, 72, 120] as const;

// ---------------------------------------------------------------------------
// Admin home, Contact gaps, the leader's list
// ---------------------------------------------------------------------------
export type NudgeOverview = { state: NudgeState; waiting: number; waitedTwoDays: number };
export function parseNudgeOverview(v: unknown): NudgeOverview {
  if (!isObj(v)) return { state: "off", waiting: 0, waitedTwoDays: 0 };
  return { state: parseNudgeState(v.state), waiting: int(v.waiting), waitedTwoDays: int(v.waited_two_days) };
}

export const NUDGE_CARD = {
  title: "Placed members waiting",
  line: (waiting: number, long: number) => {
    const who = waiting === 1 ? "1 placed member is waiting for a reply." : `${waiting} placed members are waiting for a reply.`;
    if (waiting === 0) return "No placed member is waiting for a reply.";
    if (long === 0) return who;
    return `${who} ${long === 1 ? "1 has" : `${long} have`} waited more than 2 days.`;
  },
  button: "Nudge them",
  rehearsalNote: "Rehearsal: you can count and test, but nothing is sent yet.",
} as const;

export type NudgeMark = { personId: string; remindedAt: string | null; numberConfirmed: boolean };
export function parseNudgeMarks(v: unknown): NudgeMark[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    if (!isObj(r) || typeof r.person_id !== "string") return [];
    return [{ personId: r.person_id, remindedAt: text(r.reminded_at), numberConfirmed: r.number_confirmed === true }];
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "10 Nov", for a moment in time, as the church in Lagos would write it (Lagos is always UTC+1). */
export function lagosDay(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 3600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export const LEADER_NUDGE = {
  reminded: (first: string, day: string) => `The church reminded ${first} on ${day}.`,
  confirmed: "Number confirmed",
} as const;

export const CONTACT_GAPS_CONFIRMED = {
  column: "Number confirmed",
  yes: "Confirmed",
  no: "Not confirmed",
  counts: (confirmed: number, agreed: number) => `Confirmed on WhatsApp: ${confirmed} of ${agreed}`,
  link: "Nudge the members we placed",
} as const;

export type ConfirmedCounts = { agreed: number; confirmed: number };
export function parseConfirmedCounts(v: unknown): ConfirmedCounts | null {
  if (!isObj(v)) return null;
  return { agreed: int(v.agreed), confirmed: int(v.confirmed) };
}
/** person id → how the number was confirmed ('signin' or 'message') */
export function parseConfirmedFor(v: unknown): Record<string, string> {
  if (!isObj(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, how] of Object.entries(v)) if (typeof how === "string") out[k] = how;
  return out;
}

// ---------------------------------------------------------------------------
// God Mode
// ---------------------------------------------------------------------------
export type NudgeSettings = { firstAfterHours: number; spacingDays: number; maxPerSeat: number; reason: string | null; changedAt: string | null };
export const NUDGE_SETTINGS_DEFAULT: NudgeSettings = { firstAfterHours: 24, spacingDays: 3, maxPerSeat: 2, reason: null, changedAt: null };
export function parseNudgeSettings(v: unknown): NudgeSettings | null {
  if (!isObj(v)) return null;
  return {
    firstAfterHours: int(v.first_after_hours),
    spacingDays: Math.max(1, int(v.spacing_days)),
    maxPerSeat: Math.max(1, int(v.max_per_seat)),
    reason: text(v.reason),
    changedAt: text(v.changed_at),
  };
}
export const NUDGE_SETTINGS_WORDS = {
  title: "Placed nudge",
  intro: "The three numbers behind the nudge. Every change needs a reason and is written to the log.",
  firstAfter: "Hours to wait after the placement email before the first nudge",
  spacing: "Days between nudges for one seat",
  max: "Most nudges for one seat",
  reason: "Why are you changing it?",
  save: "Save",
  saved: "Saved.",
  failed: "That did not save. Check the numbers and the reason.",
  ranges: "First nudge: 0 to 240 hours. Spacing: 1 to 14 days. Most: 1 to 4.",
} as const;

// ---------------------------------------------------------------------------
// The member's private page
// ---------------------------------------------------------------------------
export type NudgePageInfo = {
  on: boolean;
  /** The number they already gave, with its middle hidden. */
  number: string | null;
  /** The number they sign in with, with its middle hidden. The server uses the real one only when the button is pressed. */
  signin: string | null;
  /** They have already said yes to WhatsApp. */
  yes: boolean;
};
export const NUDGE_PAGE_OFF: NudgePageInfo = { on: false, number: null, signin: null, yes: false };
export function parseNudgePageInfo(v: unknown): NudgePageInfo {
  if (!isObj(v) || v.on !== true) return NUDGE_PAGE_OFF;
  return { on: true, number: text(v.number), signin: text(v.signin), yes: v.yes === true };
}

export type LinkState = "ok" | "expired" | "gone" | "unknown";
export function parseLinkState(v: unknown): LinkState {
  const s = isObj(v) ? v.state : null;
  return s === "ok" || s === "expired" || s === "gone" ? s : "unknown";
}

export type ChooseMode = "whatsapp" | "email";
export type ChooseResult =
  | { ok: true; mode: ChooseMode; confirmed: boolean }
  | { ok: false; reason: "invalid" | "not_available" | "started" | "other" };
export function parseChoose(v: unknown): ChooseResult {
  if (!isObj(v)) return { ok: false, reason: "other" };
  if (v.ok === true) return { ok: true, mode: v.mode === "whatsapp" ? "whatsapp" : "email", confirmed: v.confirmed === true };
  const r = v.reason;
  return { ok: false, reason: r === "invalid" || r === "not_available" || r === "started" ? r : "other" };
}

export const NUDGE_PAGE_WORDS = {
  title: (tribe: string) => `Yes, I’m in ${tribe}`,
  nearly: "You are nearly there.",
  nearlyBody: "You already agreed to WhatsApp. One press tells us you are in.",
  haveNumber: (masked: string) => `We have a number for you: ${masked}. Your leader can message you on it only if you agree.`,
  otherNumber: "Use a different number",
  keepNumber: "Use this number",
  numberLabel: "Your WhatsApp number",
  numberHint: "With the country code, like +234 803 123 4567.",
  signinButton: (masked: string) => `Use ${masked}, the number I sign in with`,
  signinNote: "That is the number you sign in with. We use it only because you pressed this button.",
  noNumber: "Add your WhatsApp number if you would like your leader to message you there. You can skip it and choose email only.",
  whatsapp: "Yes, I’m in, and message me on WhatsApp",
  whatsappNote: "Your leader, their assistant and your coach may message you on WhatsApp about your tribe. Only they can see your number. You can change this any time in your profile.",
  email: "Yes, I’m in, email only",
  emailNote: "Your leader will write to you by email. You can add a number any time in your profile.",
  yes: "Yes, I’m in",
  badNumber: "That number does not look right. Write it with its country code, like +2348031234567. Your place is still held.",
  doneWhatsApp: (tribe: string, leader: string) => `Thank you. You are in ${tribe}. ${leader} can now message you on WhatsApp. You can change this any time in your profile.`,
  doneEmail: (tribe: string, leader: string) => `Thank you. You are in ${tribe}. ${leader} will write to you by email. You can add a number any time in your profile.`,
  confirmedNote: "That is the number you sign in with, so it is confirmed.",
} as const;

export const LINK_WORDS: Record<Exclude<LinkState, "ok">, { title: string; body: string; fresh: boolean }> = {
  expired: { title: "This link has run out.", body: "Private links last 60 days. We can send you a fresh one, to the email address we hold for you.", fresh: true },
  gone: { title: "You are not in this tribe now.", body: "You gave up this place, or the church changed it. Open the app to look at tribes that fit you.", fresh: false },
  unknown: { title: "This link isn’t valid.", body: "Check you opened the whole link. If it still doesn’t work, open your tribe in the app.", fresh: false },
};
export const FRESH_LINK_WORDS = {
  button: "Send me a fresh link",
  sent: "If that link was one of ours and your place is still waiting, a fresh one is on its way to your email.",
  problem: "The server had a problem. Please try again in a minute.",
} as const;
