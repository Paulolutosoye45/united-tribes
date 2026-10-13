import type { AiProvider } from "@/lib/ai/types";
import { WRITER_SYSTEM, writeText } from "@/lib/ai/write";
import { num, str } from "./format";
import type { ClaimedMessage, Params } from "./types";

type DigestTribe = { tribe?: string; leader?: string; report?: Record<string, unknown> };

const tribesOf = (p: Params): DigestTribe[] => (Array.isArray(p.tribes) ? (p.tribes as DigestTribe[]) : []);
const status = (c: DigestTribe) => str(c.report?.status);

const join = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The coach's Monday summary, written without AI from the numbers the database gave us. This is what a coach
 * reads when no AI is set up, and what is checked against when one is.
 */
export function digestFacts(p: Params): string[] {
  const tribes = tribesOf(p);
  const week = num(p.week);
  const attention = tribes.filter((c) => status(c) === "needs_attention").map((c) => str(c.tribe));
  const notLogged = tribes.filter((c) => status(c) === "no_log").map((c) => str(c.tribe));
  const watch = tribes.filter((c) => status(c) === "watch").map((c) => str(c.tribe));
  const onTrack = tribes.filter((c) => status(c) === "on_track").length;
  const lowEnergy = tribes.filter((c) => num(c.report?.energy) > 0 && num(c.report?.energy) <= 2).map((c) => str(c.tribe));
  const care = tribes.reduce((n, c) => n + num(c.report?.care_open), 0);
  const present = tribes.reduce((n, c) => n + num(c.report?.present), 0);
  const members = tribes.reduce((n, c) => n + (c.report?.held === true ? num(c.report?.members) : 0), 0);

  const lines = [`Week ${week}: ${plural(tribes.length, "tribe")} in your care.`, `${onTrack} on track.`];
  if (members > 0) lines.push(`${present} of ${members} members came across the tribes that met.`);
  if (attention.length) lines.push(`Needs attention: ${join(attention)}.`);
  if (watch.length) lines.push(`Keep an eye on: ${join(watch)}.`);
  if (notLogged.length) lines.push(`Not logged yet: ${join(notLogged)}.`);
  if (lowEnergy.length) lines.push(`Low energy at the meeting: ${join(lowEnergy)}.`);
  if (care > 0) lines.push(`${plural(care, "care task")} open across them.`);
  return lines;
}

export function digestSummary(p: Params): string {
  const tribes = tribesOf(p);
  if (tribes.length === 0) return "";
  const attention = tribes.filter((c) => status(c) === "needs_attention").map((c) => str(c.tribe));
  const notLogged = tribes.filter((c) => status(c) === "no_log").map((c) => str(c.tribe));
  const parts: string[] = [];
  const quiet = attention.length === 0 && notLogged.length === 0;
  parts.push(
    quiet
      ? `A steady week: all ${plural(tribes.length, "tribe")} look${tribes.length === 1 ? "s" : ""} on track or close to it.`
      : `${plural(attention.length + notLogged.length, "tribe")} ${attention.length + notLogged.length === 1 ? "needs" : "need"} your attention this week.`,
  );
  const rest = digestFacts(p).slice(2);
  return [parts[0], ...rest].join(" ");
}

/**
 * Fills in what the wording cannot work out for itself. Today that is the coach's summary: the plain version
 * always, and when an AI is set up, a warmer two or three sentences from the same facts.
 * It changes nothing else and never fails the message.
 */
export async function enrichMessage(msg: ClaimedMessage, provider: AiProvider | null): Promise<ClaimedMessage> {
  if (msg.template !== "coach_digest" || typeof msg.params.summary === "string") return msg;
  const draft = digestSummary(msg.params);
  if (!draft) return msg;
  const result = await writeText(
    {
      purpose: "digest_summary",
      system: `${WRITER_SYSTEM} You are writing the opening lines of a coach's Monday email about the tribes they look after. Two or three sentences, encouraging but honest about where help is needed.`,
      facts: digestFacts(msg.params).join("\n"),
      draft,
      maxChars: 420,
    },
    { provider },
  );
  return { ...msg, params: { ...msg.params, summary: result.text } };
}
