import type { Flag } from "./fields";

/**
 * What a first reading adds up to. The database makes this decision (leader_ai_decide in the migration) and is the
 * only place that matters; this is the same rule in TypeScript so the comparison script can show a pastor what a
 * threshold would do before it is changed. A database test runs both on the same inputs and fails if they differ.
 */
export type Thresholds = { clearMinScore: number; minQuestionScore: number; minConfidence: number; maxRewrites: number };
export const DEFAULT_THRESHOLDS: Thresholds = { clearMinScore: 2.5, minQuestionScore: 2, minConfidence: 0.6, maxRewrites: 2 };

export type Outcome = "clear" | "strengthen" | "held" | "unscored";

const HELD_FLAGS: Flag[] = ["instruction_attempt", "copied_or_templated", "duplicate_of_other", "same_in_two_answers", "unverified_evidence", "forced_through", "poor_fit"];
const WEAK_FLAGS: Flag[] = ["off_topic", "generic_boilerplate", "low_effort"];

export function decide(
  scores: Record<string, number> | null,
  flags: Flag[],
  confidence: number | null,
  rewrites: number,
  origin: "submit" | "rewrite" | "batch",
  t: Thresholds = DEFAULT_THRESHOLDS,
): Outcome {
  const canRewrite = rewrites < t.maxRewrites;
  if (flags.some((f) => HELD_FLAGS.includes(f))) return "held";
  if (flags.includes("gibberish")) return origin === "batch" && canRewrite ? "strengthen" : "held";
  if (!scores) return "unscored";
  if ((confidence ?? 0) < t.minConfidence) return "held";
  let total = 0;
  let low = false;
  for (const k of ["q1", "q2", "q3", "q4", "q5", "q6"]) {
    const v = scores[k];
    if (v === undefined || v === null) return "held";
    total += v;
    if (k !== "q6" && v < t.minQuestionScore) low = true;
  }
  if (scores.q6 < 2) return "held";
  if (total / 6 < t.clearMinScore || flags.some((f) => WEAK_FLAGS.includes(f))) low = true;
  if (low) return canRewrite ? "strengthen" : "held";
  return "clear";
}
