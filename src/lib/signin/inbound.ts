/**
 * What a person sent to the sign-in number, read for the one thing that matters: do they want it to stop?
 *
 *   stop    "STOP", "stop please", "unsubscribe": they want no more of these.
 *   not_me  "not me", "I didn't ask", "wasn't me": a code came that they never asked for.
 *   other   anything else. If they asked for a code on the website a moment ago, this is how they collect it.
 *
 * Reading is deliberately generous in what counts as a "stop": wrongly blocking a number for a month costs one
 * email sign-in, while ignoring someone who says stop costs trust and risks the number.
 */
export type InboundKind = "stop" | "not_me" | "other";

const NOT_ME = [
  /\bnot\s+me\b/,
  /\bwas\s*n[o']?t\s+me\b/,
  /\bwasn'?t\s+me\b/,
  /\b(did\s*n[o']?t|didn'?t|did\s+not|never)\s+(ask|request|try|order)/,
  /\bi\s+(did\s*n[o']?t|didn'?t|did\s+not|never)\b.*\b(code|sign|log)/,
  /\bwrong\s+number\b/,
];

export function classifyInbound(text: string): InboundKind {
  const clean = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "other";
  const words = clean.split(" ");
  if (words.length <= 4 && /^(stop|unsubscribe|cancel|end|quit|opt out|optout)\b/.test(clean)) return "stop";
  if (words.length <= 3 && words.includes("stop")) return "stop";
  if (NOT_ME.some((re) => re.test(clean))) return "not_me";
  return "other";
}
