/** What the database says when a referee asks for a code or types one, turned into words they can act on. */

export type AskOutcome =
  | { ok: true; kind: "email" | "phone"; masked: string | null }
  | { ok: false; reason: string; message: string; seconds?: number; minutes?: number };

export type CheckOutcome =
  | { ok: true }
  | { ok: false; reason: string; message: string; triesLeft?: number; minutes?: number };

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const int = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);

const minutesWord = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);

const DEAD_LINK: Record<string, string> = {
  invalid: "This link isn’t valid. Check you copied all of it.",
  expired: "This link has expired. Ask the applicant to send you a new request.",
  closed: "This reference is no longer needed. Thank you for being willing to help.",
};

export function askOutcome(data: unknown): AskOutcome {
  const d = obj(data);
  if (d.ok === true) return { ok: true, kind: d.kind === "email" ? "email" : "phone", masked: typeof d.masked === "string" ? d.masked : null };
  const reason = typeof d.reason === "string" ? d.reason : "error";
  if (reason in DEAD_LINK) return { ok: false, reason, message: DEAD_LINK[reason] };
  switch (reason) {
    case "wait": {
      const seconds = int(d.seconds, 60);
      return { ok: false, reason, seconds, message: `A code is on its way. You can ask for another in ${seconds} second${seconds === 1 ? "" : "s"}.` };
    }
    case "limit":
      return { ok: false, reason, message: "We have sent you the most codes we can for today. Please try again tomorrow." };
    case "locked": {
      const minutes = int(d.minutes, 30) || 1;
      return { ok: false, reason, minutes, message: `Too many wrong codes. Please try again in ${minutesWord(minutes)}.` };
    }
    case "unreachable":
      return { ok: false, reason, message: "We can’t reach you with the details we were given. Please ask the applicant to check them." };
    default:
      return { ok: false, reason: "error", message: "We couldn’t send the code. Please try again in a moment." };
  }
}

export function checkOutcome(data: unknown): CheckOutcome {
  const d = obj(data);
  if (d.ok === true) return { ok: true };
  const reason = typeof d.reason === "string" ? d.reason : "error";
  if (reason === "invalid" || reason === "closed") return { ok: false, reason, message: DEAD_LINK[reason] };
  switch (reason) {
    case "wrong": {
      const triesLeft = int(d.tries_left);
      return { ok: false, reason, triesLeft, message: triesLeft <= 1 ? "That isn’t the code. You have one try left." : `That isn’t the code. You have ${triesLeft} tries left.` };
    }
    case "locked": {
      const minutes = int(d.minutes, 30) || 1;
      return { ok: false, reason, minutes, message: `Too many wrong codes. Please try again in ${minutesWord(minutes)}.` };
    }
    case "expired":
      return { ok: false, reason, message: "That code has run out. Ask for a new one." };
    case "format":
      return { ok: false, reason, message: "Type the six numbers from the message." };
    default:
      return { ok: false, reason: "error", message: "We couldn’t check that code. Please try again in a moment." };
  }
}
