/**
 * The limits on codes, written out in plain code. The database is what enforces them (so a flood of simultaneous
 * requests cannot slip past); this is the same rule in a form that is easy to read and test, and a test makes sure
 * the two give the same answer for the same history.
 *
 * Counted codes are the ones that reached a send or a hold. A request that was declined uses no place.
 */
export type Limits = {
  /** Codes to one number in 15 minutes */
  cap15m: number;
  /** Codes to one number in 24 hours */
  capDay: number;
  /** Seconds to wait for the next code to the same number, after the first, the second, and the third or later (in 24 hours) */
  gaps: readonly [number, number, number];
  capChannelHour: number;
  capChannelDay: number;
};

export const DEFAULT_LIMITS: Limits = { cap15m: 3, capDay: 8, gaps: [60, 120, 300], capChannelHour: 20, capChannelDay: 150 };

export type Verdict = "ok" | "number_day" | "number_15m" | "wait" | "channel_hour" | "channel_day";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** `numberTimes`: when each counted code to this number was asked for. `channelTimes`: the same for the whole channel. Milliseconds. */
export function limitsVerdict(numberTimes: readonly number[], channelTimes: readonly number[], now: number, limits: Limits = DEFAULT_LIMITS): Verdict {
  const mine = numberTimes.filter((t) => t > now - DAY);
  const last = mine.length > 0 ? Math.max(...mine) : null;
  const gap = mine.length <= 1 ? limits.gaps[0] : mine.length === 2 ? limits.gaps[1] : limits.gaps[2];
  const channel = channelTimes.filter((t) => t > now - DAY);
  if (mine.length >= limits.capDay) return "number_day";
  if (mine.filter((t) => t > now - 15 * MIN).length >= limits.cap15m) return "number_15m";
  if (mine.length > 0 && last !== null && last > now - gap * 1000) return "wait";
  if (channel.filter((t) => t > now - HOUR).length >= limits.capChannelHour) return "channel_hour";
  if (channel.length >= limits.capChannelDay) return "channel_day";
  return "ok";
}

/**
 * How long the screen makes someone wait before asking for another code to the same number, given how many have
 * already been sent. It matches the wait the database enforces, so a person who is patient never presses a button
 * that would be quietly ignored.
 */
export function resendWaitSeconds(sentSoFar: number, limits: Limits = DEFAULT_LIMITS): number {
  const n = Math.max(1, Math.floor(sentSoFar));
  return n === 1 ? limits.gaps[0] : n === 2 ? limits.gaps[1] : limits.gaps[2];
}
