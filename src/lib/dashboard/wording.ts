import type { MyStanding, Targets, Verdict } from "./types";

export type Tone = "gold" | "neutral" | "flame" | "outline" | "charcoal";

export const VERDICTS: Record<Verdict, { text: string; tone: Tone; line: string }> = {
  effective: { text: "Effective", tone: "gold", line: "At least 80% thriving and 70% gaining on the Success Picture." },
  not_yet: { text: "Not there yet", tone: "flame", line: "The season ended below the bar. Look at what the members said." },
  on_course: { text: "On course", tone: "gold", line: "At least 80% are on pace to thrive." },
  close: { text: "Close", tone: "neutral", line: "Between 60% and 80% are on pace to thrive." },
  at_risk: { text: "At risk", tone: "flame", line: "Fewer than 60% are on pace to thrive. Call the leader." },
  too_early: { text: "Too early", tone: "outline", line: "A rate shows after three weeks." },
  before: { text: "Not started", tone: "outline", line: "The season has not started." },
};

/** Worst first, so the tribe that needs help is at the top. */
export const VERDICT_ORDER: Verdict[] = ["at_risk", "not_yet", "close", "too_early", "before", "on_course", "effective"];

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

export function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  const r = Math.round(value * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

export function thrivingDefinition(needed: number, weeks: number, t: Targets): string {
  return `Thriving means coming to at least ${needed} of ${weeks} meetings and feeling at home: a belonging answer of ${t.belonging_min} or ${t.belonging_min + 1}.`;
}

export const SUCCESS_PICTURE_NOTE =
  "The Success Picture score adds a member’s three answers (God, others, life, each 1 to 5), so it runs from 3 to 15. The gain is the latest score minus the first.";

export const STANDING: Record<MyStanding, { title: string; line: string }> = {
  before: { title: "Your season has not started.", line: "Your numbers will appear here once the tribe begins to meet." },
  too_early: { title: "It is early.", line: "Your picture appears after week 3. Keep coming and keep taking your step." },
  on_pace: { title: "You are on pace.", line: "Keep going: it is the small, steady steps that carry the season." },
  catching_up: { title: "You can still catch up.", line: "Come to the next meetings, and tell your leader what would help you." },
  thriving: { title: "You thrived this season.", line: "Well done. Tell someone what changed." },
  not_yet: { title: "This season did not go the way you hoped.", line: "That is okay. Talk to your leader about what would help next time." },
};

/** Where a rate should stand against a target, in words. */
export function against(rate: number | null, target: number): string {
  if (rate === null) return "";
  const gap = Math.round((rate - target) * 100);
  if (gap >= 0) return gap === 0 ? "on target" : `${gap} points above the target`;
  return `${Math.abs(gap)} points below the target`;
}
