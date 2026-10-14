/**
 * When the circuit breaker trips, in plain code. The database does the real watching (supabase/migrations/
 * …signin_channels.sql, signin_breaker_check); this is the same rule written to be read and tested, and a test
 * checks the two agree.
 *
 * The breaker only ever trips. It never turns itself back on: a person does that, on /admin/signin.
 */
export type BreakerCounts = {
  /** Codes that reached the sender in the window (sent, delivered, failed or refused) */
  sends: number;
  failed: number;
  rejected: number;
  /** Ordinary-number codes old enough to have a delivery receipt by now */
  linkedSent: number;
  /** ...of which no receipt has arrived */
  noReceipt: number;
  /** Numbers that replied STOP or "not me" in the window */
  stops: number;
};

export type BreakerLimits = { minSends: number; failPct: number; noReceiptPct: number; stopCount: number };

export const DEFAULT_BREAKER: BreakerLimits = { minSends: 5, failPct: 50, noReceiptPct: 70, stopCount: 3 };

export type TripReason = "failed_sends" | "rejections" | "no_receipts" | "stop_spike";

export function breakerVerdict(c: BreakerCounts, l: BreakerLimits = DEFAULT_BREAKER): TripReason | null {
  if (c.sends >= l.minSends && c.failed * 100 >= l.failPct * c.sends) return "failed_sends";
  if (c.sends >= l.minSends && c.rejected * 100 >= l.failPct * c.sends) return "rejections";
  if (c.linkedSent >= l.minSends && c.noReceipt * 100 >= l.noReceiptPct * c.linkedSent) return "no_receipts";
  if (c.stops >= l.stopCount) return "stop_spike";
  return null;
}

/** What the sending number itself can say that pauses WhatsApp at once. */
export type SenderSignal = "ok" | "logged_out" | "restricted" | "unreachable";
