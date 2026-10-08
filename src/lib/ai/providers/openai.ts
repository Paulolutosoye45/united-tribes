import { suggestionSchema } from "../prompts";
import type { AiProvider, ProviderInput, RawSuggestions } from "../types";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** ChatGPT models through Chat Completions, using strict JSON Schema output. */
export function openaiProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "openai",
    model,
    async suggest(input: ProviderInput, signal: AbortSignal): Promise<RawSuggestions> {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 400,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "suggest_options",
              strict: true,
              schema: suggestionSchema(input.optionIds),
            },
          },
        }),
      });

      if (!res.ok) throw new Error(`openai ${res.status}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      let parsed: { suggestions?: { id: string; reason?: string }[] } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
      return {
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      };
    },
  };
}
