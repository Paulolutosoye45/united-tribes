import { z } from "zod";
import { SYSTEM_PROMPT, userPrompt } from "./prompts";
import { anthropicProvider } from "./providers/anthropic";
import { mockProvider } from "./providers/mock";
import { openaiProvider } from "./providers/openai";
import { isAiEligible, scrubPersonalDetails } from "./sensitive";
import type { AiProvider, FallbackReason, SuggestRequest, SuggestResult, Suggestion } from "./types";

export const DEFAULT_TIMEOUT_MS = 6000;
const MIN_STORY_CHARS = 12;
const MAX_STORY_CHARS = 1500;
const MAX_REASON_CHARS = 120;

const requestSchema = z.object({
  field: z.string().min(1),
  question: z.string().min(3).max(300),
  options: z
    .array(z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), label: z.string().min(1).max(260) }))
    .min(1)
    .max(40)
    .refine((opts) => new Set(opts.map((o) => o.id)).size === opts.length, "Option ids must be unique"),
  story: z.string(),
  known: z.array(z.string().min(1).max(100)).max(8).optional(),
  max: z.number().int().min(1).max(5).optional(),
});

/**
 * Picks the provider from the environment. With no key set the form simply
 * runs on tap-only options, so the assistant is never a single point of failure.
 *   AI_PROVIDER=anthropic | openai | mock | none
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): AiProvider | null {
  const choice = (env.AI_PROVIDER ?? "").toLowerCase();
  if (choice === "none") return null;
  if (choice === "mock") return mockProvider();

  const anthropicKey = env.ANTHROPIC_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  if ((choice === "anthropic" || !choice) && anthropicKey) {
    return anthropicProvider(anthropicKey, env.ANTHROPIC_MODEL ?? "claude-haiku-5-5");
  }
  if ((choice === "openai" || !choice) && openaiKey) {
    return openaiProvider(openaiKey, env.OPENAI_MODEL ?? "gpt-4.1-mini");
  }
  return null;
}

function empty(
  provider: AiProvider | null,
  started: number,
  reason: FallbackReason,
  dropped = 0,
): SuggestResult {
  return {
    suggestions: [],
    fallback: true,
    reason,
    provider: provider?.name ?? "none",
    model: provider?.model ?? "none",
    latencyMs: Date.now() - started,
    dropped,
  };
}

/** Keeps only picks that are real options, once each, with a short reason. */
export function cleanSuggestions(
  raw: { id: string; reason?: string }[],
  validIds: Set<string>,
  max: number,
): { suggestions: Suggestion[]; dropped: number } {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item.id !== "string" || !validIds.has(item.id)) {
      dropped += 1;
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const reason = (typeof item.reason === "string" ? item.reason : "").replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS);
    out.push({ id: item.id, reason });
  }
  return { suggestions: out.slice(0, max), dropped };
}

/**
 * Suggests which options fit what the member wrote. It never throws: any
 * failure returns an empty list with fallback=true, and the form carries on
 * with plain options. The member can always tap another option or type their own.
 */
export async function suggestOptions(
  request: SuggestRequest,
  opts: { provider?: AiProvider | null; timeoutMs?: number } = {},
): Promise<SuggestResult> {
  const started = Date.now();
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;

  if (!isAiEligible(request.field)) return empty(provider, started, "not_allowed");

  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return empty(provider, started, "error");
  const req = parsed.data;

  if (!provider) return empty(null, started, "no_provider");

  const story = scrubPersonalDetails(req.story).trim().slice(0, MAX_STORY_CHARS);
  const known = (req.known ?? []).map((k) => scrubPersonalDetails(k).trim()).filter(Boolean);
  // Enough to go on: a sentence or two of their own words, or at least two things they have confirmed.
  if (story.length < MIN_STORY_CHARS && known.length < 2) return empty(provider, started, "too_short");

  const max = Math.min(req.max ?? 3, req.options.length);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const raw = await provider.suggest(
      {
        system: SYSTEM_PROMPT,
        user: userPrompt({ question: req.question, options: req.options, story, max, known }),
        optionIds: req.options.map((o) => o.id),
        max,
      },
      controller.signal,
    );
    const { suggestions, dropped } = cleanSuggestions(raw.suggestions, new Set(req.options.map((o) => o.id)), max);
    return {
      suggestions,
      fallback: false,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - started,
      dropped,
      usage: raw.usage,
    };
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
    return empty(provider, started, aborted ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}
