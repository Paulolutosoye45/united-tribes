/**
 * "Let them choose", on the owner's side. The owner can unlock the goal (and, if ticked, the community) on the Tribe Card of a leader they
 * appointed, so the leader picks it from a list on their own card. The database does all of it (god_unlock_goal and its neighbours) and
 * checks again that the caller is the owner and unlocked. This file reads what it sends and says each outcome in words.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type UnlockState = "none" | "waiting" | "chosen" | "changed" | "sent" | "locked_again";
const STATES: UnlockState[] = ["none", "waiting", "chosen", "changed", "sent", "locked_again"];

export type WelcomeSent = { variant: "choose" | "fixed"; n: number; queuedAt: string | null; status: string | null };

/** What the owner's screens know about one tribe's goal lock. */
export type UnlockView = {
  tribe: string;
  /** Why it cannot be unlocked now, in words, or null. */
  why: string | null;
  canUnlock: boolean;
  canLock: boolean;
  state: UnlockState;
  communityToo: boolean;
  careCleared: boolean;
  started: string | null;
  goalNow: string | null;
  chosen: string | null;
  picks: number;
  waitingAtPick: number | null;
  seatsOpenAtPick: number | null;
  unlockedAt: string | null;
  chosenAt: string | null;
  welcome: WelcomeSent[];
};

/** The views by tribe. A plain object, so it can cross from the page to the screen. */
export function parseUnlockViews(json: unknown): Record<string, UnlockView> {
  const out: Record<string, UnlockView> = {};
  for (const v of arr(json)) {
    if (!isObject(v)) continue;
    const tribe = uuid(v.tribe);
    if (!tribe) continue;
    const state = STATES.find((s) => s === v.state) ?? "none";
    out[tribe] = {
      tribe,
      why: strOrNull(v.why),
      canUnlock: v.can_unlock === true,
      canLock: v.can_lock === true,
      state,
      communityToo: v.community_too === true,
      careCleared: v.care_cleared === true,
      started: strOrNull(v.started),
      goalNow: strOrNull(v.goal_now),
      chosen: strOrNull(v.chosen),
      picks: int(v.picks),
      waitingAtPick: intOrNull(v.waiting_at_pick),
      seatsOpenAtPick: intOrNull(v.seats_open_at_pick),
      unlockedAt: strOrNull(v.unlocked_at),
      chosenAt: strOrNull(v.chosen_at),
      welcome: arr(v.welcome).flatMap((w) =>
        isObject(w) && (w.variant === "choose" || w.variant === "fixed")
          ? [{ variant: w.variant, n: Math.max(1, int(w.n)), queuedAt: strOrNull(w.queued_at), status: strOrNull(w.status) } as WelcomeSent]
          : [],
      ),
    };
  }
  return out;
}

export type WelcomeSettings = { name: string; title: string; approved: boolean; approvedVersion: string | null; approvedAt: string | null };

export function parseWelcomeSettings(json: unknown): WelcomeSettings | null {
  if (!isObject(json)) return null;
  const name = strOrNull(json.signature_name);
  const title = strOrNull(json.signature_title);
  if (!name || !title) return null;
  return { name, title, approved: json.approved === true, approvedVersion: strOrNull(json.approved_version), approvedAt: strOrNull(json.approved_at) };
}

export type UnlockOutcome = {
  unlocked: number;
  skipped: number;
  results: { tribe: string; ok: boolean; already: boolean; communityAdded: boolean; reason: string | null }[];
  mail: { tribe: string; queued: boolean; reason: string | null; variant: string | null }[];
};

/** Reads the answer of an unlock. Null when it is not usable. */
export function parseUnlockOutcome(json: unknown): UnlockOutcome | null {
  if (!isObject(json)) return null;
  return {
    unlocked: int(json.unlocked),
    skipped: int(json.skipped),
    results: arr(json.results).flatMap((r) => {
      if (!isObject(r)) return [];
      const tribe = uuid(r.tribe);
      return tribe ? [{ tribe, ok: r.ok === true, already: r.already === true, communityAdded: r.community_added === true, reason: strOrNull(r.reason) }] : [];
    }),
    mail: arr(json.mail).flatMap((m) => {
      if (!isObject(m)) return [];
      const tribe = uuid(m.tribe);
      return tribe ? [{ tribe, queued: m.queued === true, reason: strOrNull(m.reason), variant: strOrNull(m.variant) }] : [];
    }),
  };
}

export type SendOutcome = { queued: number; results: { tribe: string; queued: boolean; reason: string | null; variant: string | null }[] };

export function parseSendOutcome(json: unknown): SendOutcome | null {
  if (!isObject(json)) return null;
  return {
    queued: int(json.queued),
    results: arr(json.results).flatMap((m) => {
      if (!isObject(m)) return [];
      const tribe = uuid(m.tribe);
      return tribe ? [{ tribe, queued: m.queued === true, reason: strOrNull(m.reason), variant: strOrNull(m.variant) }] : [];
    }),
  };
}

export type LockOutcome = { locked: number; skipped: number };

export function parseLockOutcome(json: unknown): LockOutcome | null {
  return isObject(json) ? { locked: int(json.locked), skipped: int(json.skipped) } : null;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What an unlock does and does not do, shown before the owner confirms. */
export const UNLOCK_PROMISE = [
  "They pick their goal from a list on their own Tribe Card, in their own community. Nothing else on the card is unlocked.",
  "Sensitive goals stay off the list unless you said a pastor cleared them. The goal the church started them on is always on it.",
  "Their three Success Picture lines are refilled from the goal they pick, unless they have written their own words.",
  "It stops by itself when they send their card, or when a member joins. You can lock it again at any time and what they picked stays.",
  "The pastor who reviews the card is told they chose their own goal. Your name is never shown.",
];

export const COMMUNITY_TOO_LABEL = "Let them choose the community too";
export const COMMUNITY_TOO_HELP = "Their list then covers every community, and the tribe’s name follows the community they pick (unless they wrote a name).";

export const WELCOME_TICK_LABEL = "Send the welcome email";

/** Why a welcome email was not queued. */
export const WELCOME_REASON: Record<string, string> = {
  not_approved: "The welcome wording is not approved yet, so no email went.",
  no_email: "They have no email address on file.",
  gone: "Their tribe is closed or gone.",
  already_sent: "They have already had this email.",
  not_queued: "It could not be queued. Try again.",
  not_yours: "Only a leader you appointed can be sent this.",
};

/** One line on where a leader's goal stands. */
export function stateLine(v: UnlockView): string {
  const started = v.started ?? "the goal the church picked";
  const now = v.goalNow ?? "no goal yet";
  switch (v.state) {
    case "none":
      return "Their goal is set by the church and they cannot change it.";
    case "waiting":
      return `They can choose their goal${v.communityToo ? " and community" : ""}. They have not yet. They were started on “${started}”.`;
    case "chosen": {
      const same = v.chosen !== null && v.chosen === v.started;
      const waited = v.waitingAtPick === null ? "" : ` ${plural(v.waitingAtPick, "member was", "members were")} waiting for it.`;
      return same ? `They looked and kept “${now}”.` : `They chose “${now}”. You started them on “${started}”.${waited}`;
    }
    case "changed":
      return `They have changed their mind ${v.picks - 1} ${v.picks - 1 === 1 ? "time" : "times"}. Now “${now}”. You started them on “${started}”.`;
    case "sent":
      return v.picks > 0 ? `They sent their card with “${now}”. You started them on “${started}”. The goal is now final.` : `They sent their card with “${now}”. The goal is now final.`;
    case "locked_again":
      return v.picks > 0 ? `Locked again. Their goal is “${now}”, which they chose.` : `Locked again. Their goal is “${now}”.`;
  }
}

/** The line about the welcome email for one tribe, or null when none has been queued. */
export function welcomeLine(v: UnlockView): string | null {
  if (v.welcome.length === 0) return null;
  const last = v.welcome[0];
  const what = last.variant === "choose" ? "welcome email (they may choose)" : "welcome email (goal chosen for them)";
  const when = last.queuedAt ? new Date(last.queuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }) : "";
  const status = last.status === "sent" || last.status === "delivered" || last.status === "read" ? "sent" : last.status === "failed" ? "failed" : last.status === "skipped" ? "replaced" : "waiting to go";
  const times = v.welcome.length > 1 ? ` (${plural(v.welcome.length, "time", "times")} in all)` : "";
  return `The ${what} is ${status}${when ? `, queued ${when}` : ""}${times}.`;
}

/** The sentence after an unlock: how many can now choose, and what happened to the email. */
export function unlockSummary(o: UnlockOutcome, askedWelcome: boolean): string {
  const parts: string[] = [];
  const fresh = o.results.filter((r) => r.ok && !r.already).length;
  const added = o.results.filter((r) => r.ok && r.already && r.communityAdded).length;
  const nothing = o.results.filter((r) => r.ok && r.already && !r.communityAdded).length;
  if (fresh > 0) parts.push(`${plural(fresh, "leader can", "leaders can")} now choose their goal.`);
  if (added > 0) parts.push(`${plural(added, "leader can", "leaders can")} now choose the community too.`);
  if (nothing > 0) parts.push(`${plural(nothing, "leader was", "leaders were")} already unlocked.`);
  if (o.skipped > 0) parts.push(`${plural(o.skipped, "was", "were")} skipped; the reasons are listed below.`);
  if (askedWelcome) {
    const queued = o.mail.filter((m) => m.queued).length;
    const notQueued = o.mail.length - queued;
    if (queued > 0) parts.push(`${plural(queued, "welcome email is", "welcome emails are")} on its way.`);
    if (notQueued > 0) {
      const reasons = [...new Set(o.mail.filter((m) => !m.queued).map((m) => (m.reason ? WELCOME_REASON[m.reason] ?? "" : "")))].filter(Boolean);
      parts.push(`${plural(notQueued, "welcome email was", "welcome emails were")} not queued. ${reasons.join(" ")}`.trim());
    }
  }
  return parts.length > 0 ? parts.join(" ") : "Nothing changed.";
}

export function sendSummary(o: SendOutcome): string {
  const parts: string[] = [];
  if (o.queued > 0) parts.push(`${plural(o.queued, "welcome email is", "welcome emails are")} on its way.`);
  const not = o.results.filter((r) => !r.queued);
  if (not.length > 0) {
    const reasons = [...new Set(not.map((r) => (r.reason ? WELCOME_REASON[r.reason] ?? "" : "")))].filter(Boolean);
    parts.push(`${plural(not.length, "was", "were")} not sent. ${reasons.join(" ")}`.trim());
  }
  return parts.length > 0 ? parts.join(" ") : "Nothing was sent.";
}

export function lockSummary(o: LockOutcome): string {
  const parts: string[] = [];
  if (o.locked > 0) parts.push(`${plural(o.locked, "goal is", "goals are")} locked again. What the leaders picked stays.`);
  if (o.skipped > 0) parts.push(`${plural(o.skipped, "was", "were")} not open, so nothing changed.`);
  return parts.length > 0 ? parts.join(" ") : "Nothing changed.";
}

/** The skipped, each with the reason, for the list under the summary. */
export function skippedLines(o: UnlockOutcome, nameOf: (tribe: string) => string): string[] {
  return o.results.filter((r) => !r.ok).map((r) => `${nameOf(r.tribe)}: ${r.reason ?? "skipped"}`);
}

/** The words for the version of the welcome wording the owner is asked to approve. */
export const WELCOME_APPROVE_HELP =
  "Read both emails on the preview page. Approving says the wording, and the pastor’s name and title under it, are right to send. Until you approve, no welcome email goes out. Changing the name or title takes the approval away.";
