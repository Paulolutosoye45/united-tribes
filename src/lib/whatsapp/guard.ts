import { faultCause, faultFix } from "./faults";

// How WhatsApp stands for the people who run it (WhatsApp safety net). The database answers; this reads the answer defensively and puts it in words.

export type GuardState = "off" | "rehearsal" | "on";

export type GuardView = {
  state: GuardState;
  paused: boolean;
  auto: boolean;
  reason: string | null;
  pausedAt: string | null;
  pausedBy: string | null;
  wouldPauseAt: string | null;
  canChange: boolean;
  canSettings: boolean;
  settings: { tripCount: number; tripMinutes: number; unconfirmedHours: number };
  faultsNow: number;
  faultCodes: { code: number; n: number }[];
  unconfirmed: { count: number; oldest: string | null };
  log: { at: string; kind: string; reason: string | null; by: string | null }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Anything that is not the shape expected is "nothing": the page then shows nothing about the safety net, which is how it looks while it is Off. */
export function parseGuard(v: unknown): GuardView | null {
  if (!isObj(v) || (v.state !== "off" && v.state !== "rehearsal" && v.state !== "on")) return null;
  const s = isObj(v.settings) ? v.settings : {};
  const u = isObj(v.unconfirmed) ? v.unconfirmed : {};
  return {
    state: v.state,
    paused: v.paused === true,
    auto: v.auto === true,
    reason: str(v.reason),
    pausedAt: str(v.pausedAt),
    pausedBy: str(v.pausedBy),
    wouldPauseAt: str(v.wouldPauseAt),
    canChange: v.canChange === true,
    canSettings: v.canSettings === true,
    settings: { tripCount: num(s.tripCount, 5), tripMinutes: num(s.tripMinutes, 30), unconfirmedHours: num(s.unconfirmedHours, 24) },
    faultsNow: num(v.faultsNow, 0),
    faultCodes: arr(v.faultCodes).flatMap((x) => (isObj(x) && typeof x.code === "number" ? [{ code: x.code, n: num(x.n, 0) }] : [])),
    unconfirmed: { count: num(u.count, 0), oldest: str(u.oldest) },
    log: arr(v.log).flatMap((x) => (isObj(x) && typeof x.at === "string" && typeof x.kind === "string" ? [{ at: x.at, kind: x.kind, reason: str(x.reason), by: str(x.by) }] : [])),
  };
}

/** Where WhatsApp stands, in one word and one line, for the badge. */
export function guardHeadline(g: GuardView): { word: string; tone: "good" | "warn" | "quiet"; line: string } {
  if (g.state === "off") return { word: "Not watched", tone: "quiet", line: "The safety net is Off in God Mode, so nothing watches WhatsApp and nothing can pause it." };
  if (g.paused) {
    return {
      word: g.auto ? "Paused by itself" : "Paused",
      tone: "warn",
      line: "Every WhatsApp message goes to the member's next channel, email or text, as they agreed. Nothing is lost.",
    };
  }
  if (g.state === "rehearsal") return { word: "Rehearsal", tone: "quiet", line: "The safety net is counting rejections and says when it would have paused. Nothing is held back." };
  return { word: "Running", tone: "good", line: "WhatsApp messages are going out. It will pause by itself if Meta refuses the account too often." };
}

/** What the most common refusal of the last day means and what to do about it, or null when there was none. */
export function guardAdvice(g: GuardView): { code: number; cause: string; fix: string } | null {
  const top = g.faultCodes[0];
  return top ? { code: top.code, cause: faultCause(top.code), fix: faultFix(top.code) } : null;
}

export const LOG_WORDS: Record<string, string> = {
  paused: "paused by a person",
  resumed: "restarted by a person",
  auto_paused: "paused itself",
  would_pause: "would have paused (Rehearsal)",
  settings: "numbers changed",
};
