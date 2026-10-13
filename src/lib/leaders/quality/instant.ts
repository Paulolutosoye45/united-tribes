import { FIELD_INFO, type WrittenField } from "./fields";
import { countWords, tokens } from "./text";

/**
 * The checks that need no AI: they cost nothing, run in a blink, and catch what a person would spot at a glance.
 * An answer that fails one is asked for again with a kind note. The check is deliberately modest. It looks for
 * the obvious (keyboard mashing, the same words over and over, a pasted question, instructions to the checker)
 * and never for style, spelling or language, so Pidgin, Yoruba, Igbo and Hausa answers pass as they are.
 */
export type InstantReason = "too_short" | "mashing" | "repeated" | "lorem" | "copied_question" | "instruction" | "link";

export type InstantResult = { ok: boolean; reasons: InstantReason[]; note: string | null };

const NOTES: Record<InstantReason, (minWords: number) => string> = {
  instruction: () => "Please write about yourself, in your own words. This box is for your story, not for instructions.",
  mashing: () => "This doesn’t read like words yet. Write a few sentences about your own experience, in your own words.",
  lorem: () => "This doesn’t read like your own answer yet. Write a few sentences about your own experience.",
  copied_question: () => "This repeats the question. Tell us your own answer to it.",
  repeated: () => "Some words repeat a lot. Say it once, then add one more detail about what happened.",
  link: () => "Please write your answer here in your own words, rather than adding a link.",
  too_short: (min) => `Say a little more. A few sentences in your own words is enough, at least ${min} words.`,
};

/** Which note to show when several things are wrong: the most important first. */
const PRIORITY: InstantReason[] = ["instruction", "mashing", "lorem", "copied_question", "repeated", "link", "too_short"];

export const instantNote = (reasons: InstantReason[], minWords: number): string | null => {
  const first = PRIORITY.find((r) => reasons.includes(r));
  return first ? NOTES[first](minWords) : null;
};

// ---------------------------------------------------------------------------------------------- mashing

const VOWELS = /[aeiouyɔɛ]/; // y counts, so "rhythm" and "gym" are fine; ɔ and ɛ are Yoruba and Hausa vowels
const KEYBOARD = [
  "qwer", "wert", "rtyu", "tyui", "yuio", "uiop", "qwert", "werty", "ertyu", "rtyui", "tyuio", "yuiop",
  "asdf", "sdfg", "dfgh", "fghj", "ghjk", "hjkl", "asdfg", "sdfgh", "dfghj", "fghjk", "ghjkl",
  "zxcv", "xcvb", "cvbn", "vbnm", "zxcvb", "xcvbn", "cvbnm",
];
const KEYBOARD_BOTH = [...new Set([...KEYBOARD, ...KEYBOARD.map((k) => [...k].reverse().join(""))])];
// Real words with a long run of consonants. Removed before the run is measured.
const ALLOWED_RUNS = /ngths|nths|lfths|xths/g;

/** Strips accents so "ẹ" and "ọ" are plain vowels for this check. */
const plain = (word: string) => word.normalize("NFD").replace(/\p{M}+/gu, "");

function implausible(raw: string): boolean {
  const word = plain(raw.toLowerCase());
  if (!/^\p{L}+$/u.test(word) || word.length < 4) return false;
  if (!VOWELS.test(word)) return true; // no vowel at all in four or more letters
  if (/(.)\1{4,}/.test(word)) return true; // the same letter five times in a row
  if (/^(.{1,3})\1{3,}$/.test(word)) return true; // "hahahaha", "kjkjkjkj"
  if (KEYBOARD_BOTH.some((k) => word.includes(k))) return true;
  const rest = word.replace(ALLOWED_RUNS, "-");
  return /[^aeiouyɔɛ-]{6,}/.test(rest); // six consonants in a row
}

function looksMashed(words: string[]): boolean {
  if (words.length === 0) return false;
  const bad = words.filter(implausible).length;
  if (bad === 0) return false;
  return bad >= 2 ? bad / words.length >= 0.25 : words.length <= 6;
}

// ---------------------------------------------------------------------------------------------- repetition

function looksRepeated(words: string[], text: string): boolean {
  if (words.length >= 10) {
    const unique = new Set(words).size;
    if (unique / words.length < 0.4) return true;
  }
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 4 && words[i].length > 1) return true; // "test test test test"
  }
  const sentences = text
    .split(/[.!?\n]+/)
    .map((s) => tokens(s).join(" "))
    .filter((s) => s.split(" ").length >= 3);
  const counts = new Map<string, number>();
  for (const s of sentences) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 3);
}

// ---------------------------------------------------------------------------------------------- the rest

const INSTRUCTION = [
  /\bignore\b.{0,24}\b(previous|above|prior|earlier|all|any|the)\b.{0,24}\b(instructions?|prompts?|rules?|rubric)\b/i,
  /\bdisregard\b.{0,30}\b(instructions?|rules?|rubric|above)\b/i,
  /\b(new|updated|real) instructions?\b/i,
  /\b(give|award|assign|score|rate|mark|grade)\b.{0,40}\b(me|this|my|it|answer|application)\b.{0,30}\b(5|five|full|maximum|max|top|highest|perfect|100)\b/i,
  /\b(system prompt|language model|chatgpt|openai|anthropic|\bllm\b|as an ai\b)/i,
  /\b(pass|approve|accept|clear|shortlist)\b.{0,16}\b(me|this application|my application)\b.{0,30}\b(automatically|now|immediately|regardless)\b/i,
  /\b(output|respond|reply|return|answer)\b.{0,20}\b(only|just)?\s*(json|a score|the score|5|five)\b/i,
  /<\/?\s*(answer|context|system|instructions?|assistant|user)\b/i,
  /```/,
];

const LOREM = /lorem ipsum|dolor sit amet|consectetur adipiscing/i;
const LINK = /https?:\/\/|www\./i;

/** Most of the answer is the question's own words: it was pasted back rather than answered. */
function copiedFromQuestion(words: string[], field: WrittenField): boolean {
  const mine = new Set(words);
  if (mine.size < 6) return false;
  const info = FIELD_INFO[field];
  const asked = new Set(tokens(`${info.question} ${info.hint}`));
  let shared = 0;
  for (const w of mine) if (asked.has(w)) shared += 1;
  return shared / mine.size >= 0.8;
}

export function instantChecks(text: string, field: WrittenField, opts: { minWords: number }): InstantResult {
  const clean = (text ?? "").trim();
  const words = tokens(clean);
  const reasons: InstantReason[] = [];
  if (INSTRUCTION.some((re) => re.test(clean))) reasons.push("instruction");
  if (LOREM.test(clean)) reasons.push("lorem");
  if (looksMashed(words)) reasons.push("mashing");
  if (copiedFromQuestion(words, field)) reasons.push("copied_question");
  if (looksRepeated(words, clean)) reasons.push("repeated");
  if (LINK.test(clean)) reasons.push("link");
  if (countWords(clean) < opts.minWords) reasons.push("too_short");
  return { ok: reasons.length === 0, reasons, note: instantNote(reasons, opts.minWords) };
}

/** The flags these reasons mean for the first score. */
export function flagsFromReasons(reasons: InstantReason[]): ("gibberish" | "instruction_attempt" | "low_effort" | "copied_or_templated")[] {
  const flags = new Set<"gibberish" | "instruction_attempt" | "low_effort" | "copied_or_templated">();
  if (reasons.includes("mashing") || reasons.includes("lorem")) flags.add("gibberish");
  if (reasons.includes("instruction")) flags.add("instruction_attempt");
  if (reasons.includes("repeated") || reasons.includes("too_short")) flags.add("low_effort");
  if (reasons.includes("copied_question")) flags.add("copied_or_templated");
  return [...flags];
}
