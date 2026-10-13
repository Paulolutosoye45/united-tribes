import type { z } from "zod";
import { providerFromEnv } from "./suggest";
import type { AiProvider, JudgeInput, RawSuggestions } from "./types";

export const JUDGE_TIMEOUT_MS = 20_000;

export type JudgeResult<T> =
  | { ok: true; data: T; provider: string; model: string; latencyMs: number; usage?: RawSuggestions["usage"] }
  | { ok: false; reason: "no_provider" | "unsupported" | "timeout" | "error" | "invalid"; provider: string; model: string; latencyMs: number };

/**
 * Asks the model for a structured judgement and checks the answer against a schema. Never throws: a missing key,
 * a slow reply, a malformed reply all come back as { ok: false }, and the caller decides what that means (for the
 * leader application, it means a person looks, never that the application passes).
 */
export async function judgeJson<T>(
  input: JudgeInput,
  schema: z.ZodType<T>,
  opts: { provider?: AiProvider | null; timeoutMs?: number } = {},
): Promise<JudgeResult<T>> {
  const started = Date.now();
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const fail = (reason: "no_provider" | "unsupported" | "timeout" | "error" | "invalid"): JudgeResult<T> => ({
    ok: false,
    reason,
    provider: provider?.name ?? "none",
    model: provider?.model ?? "none",
    latencyMs: Date.now() - started,
  });
  if (!provider) return fail("no_provider");
  if (!provider.judge) return fail("unsupported");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? JUDGE_TIMEOUT_MS);
  try {
    const raw = await provider.judge(input, controller.signal);
    const parsed = schema.safeParse(raw.json);
    if (!parsed.success) return fail("invalid");
    return { ok: true, data: parsed.data, provider: provider.name, model: provider.model, latencyMs: Date.now() - started, usage: raw.usage };
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
    return fail(aborted ? "timeout" : "error");
  } finally {
    clearTimeout(timer);
  }
}
