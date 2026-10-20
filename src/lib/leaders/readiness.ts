/**
 * How the Leader Readiness Score is shown to the people who decide. The database works the score out; this only decides what to
 * draw. With all four parts counted, or while the score is still waiting on a required part, it is the screen it has always been.
 */
import type { Readiness } from "./review-types";

export const PARTS = ["calling", "scenarios", "references", "interview"] as const;
export type Part = (typeof PARTS)[number];

/** What each part is worth when all four are in. */
export const NOMINAL: Record<Part, number> = { calling: 30, scenarios: 25, references: 25, interview: 20 };
export const PART_LABEL: Record<Part, string> = { calling: "Calling and goal fit", scenarios: "Situations", references: "References", interview: "Interview" };
const SHORT: Record<Part, string> = { calling: "calling and goal fit", scenarios: "the situations", references: "the references", interview: "the interview" };

/** Which parts the score rests on. A reading from before the switches existed has no list, and counted all four. */
export function countedParts(r: Readiness): Part[] {
  return r.counted ? PARTS.filter((p) => r.counted!.includes(p)) : [...PARTS];
}

/** Whether the score rests on fewer than four parts. */
export function isReduced(r: Readiness): boolean {
  return r.evidence === "reduced" && r.readiness !== null;
}

/**
 * The share of the score each part carries. Usually 30, 25, 25 and 20. When the score rests on fewer parts it is the same bar on
 * what exists, so the shares of the parts that count still add up to 100.
 */
export function shares(r: Readiness): Record<Part, number> {
  if (!isReduced(r)) return { ...NOMINAL };
  const counted = countedParts(r);
  const total = counted.reduce((sum, p) => sum + NOMINAL[p], 0);
  return Object.fromEntries(PARTS.map((p) => [p, counted.includes(p) ? Math.round((NOMINAL[p] / total) * 100) : 0])) as Record<Part, number>;
}

/** The parts to draw a bar for: all of them, except one that was not asked for this application. */
export function visibleParts(r: Readiness): Part[] {
  const notAsked = new Set((r.missing ?? []).filter((m) => m.why === "not_asked").map((m) => m.part));
  return PARTS.filter((p) => !notAsked.has(p));
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** One sentence on what a reduced score rests on, or null when there is nothing to say. */
export function evidenceSentence(r: Readiness): string | null {
  if (!isReduced(r)) return null;
  const counted = countedParts(r).map((p) => SHORT[p]);
  const notAsked = (r.missing ?? []).filter((m) => m.why === "not_asked").map((m) => SHORT[m.part]);
  const notIn = (r.missing ?? []).filter((m) => m.why === "not_received").map((m) => SHORT[m.part]);
  const bits = [`This score rests on ${list(counted)}.`];
  if (notAsked.length > 0) bits.push(`${cap(list(notAsked))} ${notAsked.length === 1 ? "was" : "were"} not asked for this application.`);
  if (notIn.length > 0) bits.push(`${cap(list(notIn))} ${notIn.length === 1 ? "was" : "were"} optional and did not come in.`);
  return bits.join(" ");
}

/** The line for the reference check under the score. With references required it is the line it has always been. */
export function referenceGateText(r: Readiness): string {
  const required = (r.modes?.references ?? "required") === "required";
  if (r.gates.open_concerns > 0) return `Reference check: ${r.gates.open_concerns} open ${r.gates.open_concerns === 1 ? "concern" : "concerns"}`;
  return required ? "Reference check clean: both answered, one a pastor or unit head" : "No referee has an open concern";
}
