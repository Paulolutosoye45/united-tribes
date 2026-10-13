import { createHash } from "node:crypto";
import { countWords, normalise, simhash } from "./text";

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export type Print = { normHash: string; simhash: string; words: number };

/** What the database keeps to spot the same words twice. The text itself is not part of it. */
export function printOf(text: string): Print {
  return { normHash: sha256(normalise(text)), simhash: simhash(text), words: countWords(text) };
}
