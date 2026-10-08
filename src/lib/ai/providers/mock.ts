import type { AiProvider, ProviderInput, RawSuggestions } from "../types";

const STOP = new Set(
  "a an and the of to in on at for with my i me we our is am are was be been it its this that as by from or but not so very just want need like get have has had do does did into about more most some any can will would could should you your they them their there here what when where who how up out over than then also".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * A simple word-overlap matcher. It needs no network or key, so tests and the
 * comparison script's dry run work anywhere. It is deliberately modest: it
 * shows the plumbing works, not what a real model can do.
 */
export function mockProvider(): AiProvider {
  return {
    name: "mock",
    model: "word-overlap-v1",
    async suggest(input: ProviderInput): Promise<RawSuggestions> {
      const story = new Set(words(input.user.split("<story>")[1] ?? ""));
      const optionBlock = input.user.split("Options:")[1]?.split("Return up to")[0] ?? "";
      const scored: { id: string; hits: string[] }[] = [];
      for (const line of optionBlock.split("\n")) {
        const match = line.match(/^- ([a-z0-9-]+): (.*)$/);
        if (!match) continue;
        const hits = [...new Set(words(match[2]))].filter((w) => story.has(w));
        if (hits.length > 0) scored.push({ id: match[1], hits });
      }
      scored.sort((a, b) => b.hits.length - a.hits.length);
      return {
        suggestions: scored.slice(0, input.max).map((s) => ({
          id: s.id,
          reason: `You mentioned “${s.hits[0]}”`,
        })),
      };
    },
  };
}
