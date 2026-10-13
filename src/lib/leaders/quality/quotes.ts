import { isWrittenField, WRITTEN_FIELDS, type WrittenField } from "./fields";
import { normalise } from "./text";

export type Quote = { field: WrittenField; quote: string };
export type Evidence = Record<"q1" | "q2" | "q3" | "q4" | "q5" | "q6", Quote[]>;

const MIN_WORDS = 3;
const MAX_WORDS = 40;
const MIN_CHARS = 12;

export type VerifiedEvidence = {
  evidence: Evidence;
  /** Quotes that were not really in the answer. They are thrown away, never shown to the panel. */
  dropped: number;
  /** Questions scored 3 or more (Q1 to Q5) with no real quote to back them. */
  ungrounded: string[];
};

/**
 * The model gives a score and the words that justify it. This checks each quote is really in the applicant's own
 * answer (ignoring case, accents, spacing and punctuation). A made-up quote is dropped. A score of 3 or more with
 * nothing real behind it is reported, and the database holds that application for a person.
 */
export function verifyEvidence(
  raw: { question: string; field: string; quote: string }[],
  answers: Record<WrittenField, string>,
  scores: Record<string, number>,
): VerifiedEvidence {
  const haystack = Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, ` ${normalise(answers[f] ?? "")} `])) as Record<WrittenField, string>;
  const evidence: Evidence = { q1: [], q2: [], q3: [], q4: [], q5: [], q6: [] };
  let dropped = 0;
  for (const item of raw) {
    const key = item.question as keyof Evidence;
    const needle = normalise(item.quote);
    const words = needle ? needle.split(" ").length : 0;
    // The named answer first; if the model got the answer wrong but the words are really there, they still count.
    const where = isWrittenField(item.field) ? [item.field, ...WRITTEN_FIELDS.filter((f) => f !== item.field)] : [...WRITTEN_FIELDS];
    const real =
      key in evidence &&
      needle.length >= MIN_CHARS &&
      words >= MIN_WORDS &&
      words <= MAX_WORDS &&
      where.some((f) => haystack[f].includes(` ${needle} `));
    if (!real) {
      dropped += 1;
      continue;
    }
    const field = where.find((f) => haystack[f].includes(` ${needle} `))!;
    if (!evidence[key].some((e) => e.field === field && normalise(e.quote) === needle)) evidence[key].push({ field, quote: item.quote.replace(/\s+/g, " ").trim().slice(0, 300) });
  }
  const ungrounded = ["q1", "q2", "q3", "q4", "q5"].filter((k) => (scores[k] ?? 0) >= 3 && evidence[k as keyof Evidence].length === 0);
  return { evidence, dropped, ungrounded };
}
