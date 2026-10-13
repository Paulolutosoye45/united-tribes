import { scrubPersonalDetails } from "./sensitive";
import { providerFromEnv } from "./suggest";
import type { AiProvider } from "./types";

/**
 * Short pieces of writing from facts we already have: a coach's Monday summary, a one-sentence draft of a
 * tribe's success picture, a line for the pastor's report. Every use has a plain draft written without AI,
 * which is what people get when no key is set, when the call is slow, or when the answer looks wrong.
 *
 * The rules, in code rather than in a prompt:
 *   - the facts handed over are written by us (counts, tribe names), never what a person typed privately;
 *   - email addresses and phone numbers are removed from anything that leaves the server;
 *   - the answer may not contain a number, link or address that was not in the facts;
 *   - it is cut to length and flattened; if it fails any check, the plain draft is used.
 */
export type WriteRequest = {
  /** What this is for. Only these may call the writer. */
  purpose: "digest_summary" | "success_sentence" | "report_summary";
  system: string;
  /** The facts, as plain lines. */
  facts: string;
  /** What to say if the AI cannot. Written by us, always usable. */
  draft: string;
  maxChars: number;
};

export type WriteResult = { text: string; ai: boolean; reason?: "no_provider" | "timeout" | "error" | "rejected" | "empty" };

export const WRITE_TIMEOUT_MS = 6000;

const URLISH = /https?:\/\/|www\.|@[a-z0-9._-]+\.[a-z]{2,}/i;
const NUMBER = /\d+(?:[.,]\d+)?/g;

const WORD_VALUES: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17",
  eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
  eighty: "80", ninety: "90", hundred: "100", thousand: "1000", zero: "0",
};
const NUMBER_WORDS = new RegExp(`\\b(${Object.keys(WORD_VALUES).join("|")})\\b`, "gi");

/** Every number in the answer, written in figures or in words, must appear in the facts or the draft. A model that invents a figure is not trusted. */
export function numbersAreGrounded(answer: string, ...sources: string[]): boolean {
  const allowed = new Set(sources.flatMap((s) => [...(s.match(NUMBER) ?? []), ...(s.match(NUMBER_WORDS) ?? []).map((w) => WORD_VALUES[w.toLowerCase()])]));
  const used = [...(answer.match(NUMBER) ?? []), ...(answer.match(NUMBER_WORDS) ?? []).map((w) => WORD_VALUES[w.toLowerCase()])];
  return used.every((n) => allowed.has(n));
}

export function tidyAnswer(text: string, maxChars: number): string {
  const flat = text
    .replace(/[*_`#>]+/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("."));
  return stop > maxChars * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd();
}

/** Never throws. */
export async function writeText(
  req: WriteRequest,
  opts: { provider?: AiProvider | null; timeoutMs?: number } = {},
): Promise<WriteResult> {
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const fallback = (reason: WriteResult["reason"]): WriteResult => ({ text: req.draft, ai: false, reason });
  if (!provider) return fallback("no_provider");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? WRITE_TIMEOUT_MS);
  try {
    const facts = scrubPersonalDetails(req.facts).slice(0, 4000);
    const raw = await provider.write(
      {
        system: req.system,
        user: `Facts:\n${facts}\n\nWrite the piece now, using only these facts.`,
        draft: req.draft,
        maxTokens: Math.ceil(req.maxChars / 3) + 40,
      },
      controller.signal,
    );
    const text = tidyAnswer(raw.text ?? "", req.maxChars);
    if (!text) return fallback("empty");
    if (URLISH.test(text) || !numbersAreGrounded(text, facts, req.draft)) return fallback("rejected");
    return { text, ai: true };
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
    return fallback(aborted ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}

export const WRITER_SYSTEM = [
  "You write short, warm, plain messages for a church small-group programme in Lagos.",
  "Use only the facts you are given. Do not add names, numbers, advice about health or family, or anything not stated.",
  "Write in simple British English. No headings, no lists, no emoji, no markdown.",
].join(" ");
