import { suggestionSchema } from "../prompts";
import type { AiProvider, JudgeInput, ProviderInput, RawJudgement, RawSuggestions, RawText, WriteInput } from "../types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

/** Claude through the Messages API, using a forced tool call for structured output. */
export function anthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "anthropic",
    model,
    async suggest(input: ProviderInput, signal: AbortSignal): Promise<RawSuggestions> {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system: input.system,
          tools: [
            {
              name: "suggest_options",
              description: "Return the options that best fit what the person wrote.",
              input_schema: suggestionSchema(input.optionIds),
            },
          ],
          tool_choice: { type: "tool", name: "suggest_options" },
          messages: [{ role: "user", content: input.user }],
        }),
      });

      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const data = (await res.json()) as {
        content?: { type: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const block = data.content?.find((b) => b.type === "tool_use");
      const parsed = block?.input as { suggestions?: { id: string; reason?: string }[] } | undefined;
      return {
        suggestions: Array.isArray(parsed?.suggestions) ? parsed.suggestions : [],
        usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      };
    },
    async write(input: WriteInput, signal: AbortSignal): Promise<RawText> {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": VERSION },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        text: (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""),
        usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      };
    },
    async judge(input: JudgeInput, signal: AbortSignal): Promise<RawJudgement> {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": VERSION },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens,
          system: input.system,
          tools: [{ name: input.schemaName, description: "Give your judgement in exactly this shape.", input_schema: input.schema }],
          tool_choice: { type: "tool", name: input.schemaName },
          messages: [{ role: "user", content: input.user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const data = (await res.json()) as {
        content?: { type: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const block = data.content?.find((b) => b.type === "tool_use");
      return { json: block?.input ?? null, usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
    },
  };
}
