/**
 * The sentence a person hopes to say in week 12. We draft it for them; they keep it, change it or write
 * their own. The plain draft below needs no assistant and is what everyone gets when the assistant is off,
 * slow, or its answer is not trusted (see src/lib/ai/write.ts).
 */

export const SUCCESS_MAX = 240;

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The catalogue's goals all start with a verb ("Strengthen our marriage"), so they read naturally after "I want to".
 * A goal in someone's own words might not, so it is quoted instead of bent into a sentence.
 */
export function plainSuccessDraft(goal: { title?: string | null; own?: string | null }): string {
  const title = goal.title?.trim().replace(/[.!]+$/, "");
  if (title) return `By week 12, I want to ${lowerFirst(title)}.`.slice(0, SUCCESS_MAX);
  const own = goal.own?.trim().replace(/[.!]+$/, "");
  if (own) return `By week 12, I have made real progress on this: ${lowerFirst(own)}.`.slice(0, SUCCESS_MAX);
  return "";
}

export const SUCCESS_WRITER_SYSTEM = [
  "You help a member of a Nigerian church write one sentence about how they hope to feel at the end of a twelve-week small-group season.",
  "Write exactly one sentence, in the first person, at most 200 characters, starting with 'By week 12,'.",
  "Reuse the person's own words and phrases where you can, so it sounds like them.",
  "Use only what you are given. Do not add facts, numbers, names, places or promises, and do not mention health, money, marriage or family unless they did.",
  "Plain British English. No quotation marks, no lists, no emoji.",
].join(" ");

/** The facts handed to the writer: their goal and, if they wrote one, their story. */
export function successFacts(input: { goalTitle?: string | null; goalOwn?: string | null; story?: string | null }): string {
  const lines: string[] = [];
  if (input.goalTitle) lines.push(`Their goal this season: ${input.goalTitle}`);
  else if (input.goalOwn) lines.push(`Their goal this season, in their words: ${input.goalOwn}`);
  if (input.story?.trim()) lines.push(`About their season, in their words: ${input.story.trim()}`);
  return lines.join("\n");
}

/**
 * What the person did with the drafted sentence, for the quality log: kept as it was, edited (most of the words are still
 * theirs to keep), or replaced. A blank box counts as replaced: they took it out.
 */
export function successOutcome(draft: string, final: string | undefined): "kept" | "edited" | "replaced" {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean));
  const a = words(draft);
  const b = words(final ?? "");
  if (b.size === 0) return "replaced";
  const same = [...a].filter((w) => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  if (a.size === b.size && same === a.size) return "kept";
  return same / union >= 0.5 ? "edited" : "replaced";
}
