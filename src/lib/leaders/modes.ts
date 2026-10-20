/**
 * Which steps of the application apply to one application, as the database works them out (leader_stage_modes).
 *
 * The one rule the database follows, which this file only mirrors for the screens:
 *   - an application not yet sent counts the position now;
 *   - an application that has been sent counts the more lenient of the position when it was sent and the position now
 *     (off, then optional, then required), so turning a step off releases people and turning one on never pulls anyone back.
 *
 * The screens never work this out themselves: they ask the database (my_application_modes, or the positions now for someone who
 * has not started) and use the answer. If the answer cannot be read, every step is asked, exactly as it was before the
 * switchboard existed, so a failure to read can only make the screens stricter than the database, never more lenient.
 */
import { DEFAULT_PIPELINE, ELIGIBILITY_KEYS, type EligibilityKey, type Pipeline, type Position } from "./pipeline";

export type StageModes = {
  eligibility: Record<EligibilityKey, Position>;
  references: Position;
  interview: Position;
  /** True once the application has been sent: the positions are then the more lenient of when it was sent and now. */
  sent: boolean;
};

/** Today's process: every question, both referees and the interview. */
export const DEFAULT_MODES: StageModes = {
  eligibility: { ...DEFAULT_PIPELINE.eligibility },
  references: "required",
  interview: "required",
  sent: false,
};

const POSITIONS: readonly string[] = ["required", "optional", "off"];
const isPosition = (v: unknown): v is Position => typeof v === "string" && POSITIONS.includes(v);

/** Reads what my_application_modes gives. Never throws; anything missing or unreadable counts as required. */
export function parseModes(json: unknown): StageModes {
  if (!json || typeof json !== "object" || Array.isArray(json)) return structuredClone(DEFAULT_MODES);
  const v = json as Record<string, unknown>;
  const raw = v.eligibility && typeof v.eligibility === "object" && !Array.isArray(v.eligibility) ? (v.eligibility as Record<string, unknown>) : {};
  const eligibility = { ...DEFAULT_MODES.eligibility };
  for (const key of ELIGIBILITY_KEYS) if (isPosition(raw[key])) eligibility[key] = raw[key];
  return {
    eligibility,
    references: isPosition(v.references) ? v.references : "required",
    interview: isPosition(v.interview) ? v.interview : "required",
    sent: v.sent === true,
  };
}

/** For someone who has not started: the positions now. */
export function modesFromPipeline(p: Pipeline): StageModes {
  return { eligibility: { ...p.eligibility }, references: p.references, interview: p.interview, sent: false };
}

/** The questions put to the applicant: required and optional, in the order they are asked. */
export const askedQuestions = (m: StageModes): EligibilityKey[] => ELIGIBILITY_KEYS.filter((k) => m.eligibility[k] !== "off");
/** The questions that must be answered yes. */
export const requiredQuestions = (m: StageModes): EligibilityKey[] => ELIGIBILITY_KEYS.filter((k) => m.eligibility[k] === "required");
/** The questions that may be answered either way, or left. */
export const optionalQuestions = (m: StageModes): EligibilityKey[] => ELIGIBILITY_KEYS.filter((k) => m.eligibility[k] === "optional");

/** The same rule the database uses to combine two positions: the more lenient one. Anything unknown counts as required. */
export function lenient(a: string | null | undefined, b: string | null | undefined): Position {
  const rank = (p: string | null | undefined) => (p === "off" ? 3 : p === "optional" ? 2 : 1);
  const pick = (p: string | null | undefined): Position => (p === "off" || p === "optional" ? p : "required");
  return rank(a) >= rank(b) ? pick(a) : pick(b);
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
export const numberWord = (n: number) => WORDS[n] ?? String(n);
