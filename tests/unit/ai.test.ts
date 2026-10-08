import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanSuggestions, providerFromEnv, suggestOptions } from "@/lib/ai/suggest";
import { mockProvider } from "@/lib/ai/providers/mock";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import { openaiProvider } from "@/lib/ai/providers/openai";
import { SYSTEM_PROMPT, suggestionSchema } from "@/lib/ai/prompts";
import { isAiEligible, scrubPersonalDetails } from "@/lib/ai/sensitive";
import type { AiProvider, SuggestRequest } from "@/lib/ai/types";

const options = [
  { id: "professionals", label: "Professionals" },
  { id: "education", label: "Education" },
  { id: "medical-healthcare", label: "Medical & Healthcare" },
];

const base: SuggestRequest = {
  field: "tribe",
  question: "Which tribe do you feel you belong to?",
  options,
  story: "I am a nurse at a teaching hospital and the night shifts are heavy on me.",
};

afterEach(() => vi.unstubAllGlobals());

function fake(handler: AiProvider["suggest"]): AiProvider {
  return { name: "fake", model: "fake-1", suggest: handler };
}

describe("what the assistant may see", () => {
  it("allows only listed fields", () => {
    expect(isAiEligible("tribe")).toBe(true);
    expect(isAiEligible("support_needs")).toBe(false);
    expect(isAiEligible("notes_to_leader")).toBe(false);
    expect(isAiEligible("anything_new")).toBe(false);
  });

  it("refuses to send a sensitive field and never calls the provider", async () => {
    const spy = vi.fn();
    const res = await suggestOptions({ ...base, field: "support_needs" }, { provider: fake(spy) });
    expect(spy).not.toHaveBeenCalled();
    expect(res).toMatchObject({ fallback: true, reason: "not_allowed", suggestions: [] });
  });

  it("removes emails and phone numbers before sending", async () => {
    expect(scrubPersonalDetails("Mail ada@example.org or call +234 803 123 4567 / 08031234567")).toBe(
      "Mail [email] or call [number] / [number]",
    );
    let seen = "";
    await suggestOptions(
      { ...base, story: "I'm a nurse. Reach me on 08031234567 or ada@example.org please." },
      { provider: fake(async (input) => ((seen = input.user), { suggestions: [] })) },
    );
    expect(seen).not.toMatch(/08031234567|ada@example/);
    expect(seen).toContain("[number]");
  });
});

describe("keeping suggestions inside the list", () => {
  it("drops invented ids, repeats and over-long reasons", () => {
    const { suggestions, dropped } = cleanSuggestions(
      [
        { id: "education", reason: "x".repeat(500) },
        { id: "made-up", reason: "nope" },
        { id: "education", reason: "again" },
        { id: "professionals" },
      ],
      new Set(options.map((o) => o.id)),
      3,
    );
    expect(suggestions.map((s) => s.id)).toEqual(["education", "professionals"]);
    expect(suggestions[0].reason.length).toBe(120);
    expect(suggestions[1].reason).toBe("");
    expect(dropped).toBe(1);
  });

  it("respects the maximum", async () => {
    const res = await suggestOptions(
      { ...base, max: 1 },
      { provider: fake(async () => ({ suggestions: options.map((o) => ({ id: o.id, reason: "r" })) })) },
    );
    expect(res.suggestions).toHaveLength(1);
  });

  it("puts every valid id in the schema enum", () => {
    const schema = suggestionSchema(["a", "b"]);
    expect(schema.properties.suggestions.items.properties.id.enum).toEqual(["a", "b"]);
  });

  it("tells the model the story is data, not instructions", () => {
    expect(SYSTEM_PROMPT).toMatch(/<story>/);
    expect(SYSTEM_PROMPT).toMatch(/not instructions/);
  });
});

describe("never getting in the way", () => {
  it("returns nothing, quickly, when the story is too short", async () => {
    const spy = vi.fn();
    const res = await suggestOptions({ ...base, story: "hi" }, { provider: fake(spy) });
    expect(spy).not.toHaveBeenCalled();
    expect(res).toMatchObject({ fallback: true, reason: "too_short" });
  });

  it("falls back when there is no provider", async () => {
    const res = await suggestOptions(base, { provider: null });
    expect(res).toMatchObject({ fallback: true, reason: "no_provider", provider: "none" });
  });

  it("falls back on a provider error", async () => {
    const res = await suggestOptions(base, {
      provider: fake(async () => {
        throw new Error("boom");
      }),
    });
    expect(res).toMatchObject({ fallback: true, reason: "error", suggestions: [] });
  });

  it("falls back on a timeout", async () => {
    const res = await suggestOptions(base, {
      timeoutMs: 30,
      provider: fake(
        (_input, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          }),
      ),
    });
    expect(res).toMatchObject({ fallback: true, reason: "timeout" });
    expect(res.latencyMs).toBeLessThan(1000);
  });

  it("rejects malformed requests without throwing", async () => {
    const res = await suggestOptions({ ...base, options: [] }, { provider: mockProvider() });
    expect(res).toMatchObject({ fallback: true, reason: "error" });
    const dup = await suggestOptions({ ...base, options: [options[0], options[0]] }, { provider: mockProvider() });
    expect(dup.fallback).toBe(true);
  });
});

describe("mock provider", () => {
  it("matches on the person's own words", async () => {
    const res = await suggestOptions(
      { ...base, story: "I teach physics at a secondary school and want to grow as an education leader." },
      { provider: mockProvider() },
    );
    expect(res.suggestions[0]?.id).toBe("education");
    expect(res.fallback).toBe(false);
  });

  it("returns nothing when no words overlap", async () => {
    const res = await suggestOptions({ ...base, story: "Just looking around, nothing in mind really." }, { provider: mockProvider() });
    expect(res.suggestions).toEqual([]);
  });
});

describe("provider selection", () => {
  it("uses no provider when no keys are set", () => {
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ AI_PROVIDER: "none", ANTHROPIC_API_KEY: "k" })).toBeNull();
  });

  it("follows AI_PROVIDER, then falls back to whichever key exists", () => {
    expect(providerFromEnv({ AI_PROVIDER: "mock" })?.name).toBe("mock");
    expect(providerFromEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" })?.name).toBe("openai");
    expect(providerFromEnv({ ANTHROPIC_API_KEY: "k" })?.name).toBe("anthropic");
    expect(providerFromEnv({ OPENAI_API_KEY: "k" })?.name).toBe("openai");
    expect(providerFromEnv({ AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" })).toBeNull();
  });

  it("reads models from the environment", () => {
    expect(providerFromEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-test" })?.model).toBe("claude-test");
    expect(providerFromEnv({ OPENAI_API_KEY: "k", OPENAI_MODEL: "gpt-test" })?.model).toBe("gpt-test");
  });
});

describe("provider requests", () => {
  const input = {
    system: "sys",
    user: "usr",
    optionIds: ["professionals", "education"],
    max: 2,
  };

  it("sends Claude a forced tool call and reads the tool result", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tool_choice).toEqual({ type: "tool", name: "suggest_options" });
      expect(body.tools[0].input_schema.properties.suggestions.items.properties.id.enum).toEqual(input.optionIds);
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("key");
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", input: { suggestions: [{ id: "education", reason: "You teach" }] } }],
          usage: { input_tokens: 120, output_tokens: 30 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await anthropicProvider("key", "claude-test").suggest(input, new AbortController().signal);
    expect(out.suggestions).toEqual([{ id: "education", reason: "You teach" }]);
    expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it("sends ChatGPT a strict JSON schema and parses the reply", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format.type).toBe("json_schema");
      expect(body.response_format.json_schema.strict).toBe(true);
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer key");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ suggestions: [{ id: "professionals", reason: "Your promotion" }] }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await openaiProvider("key", "gpt-test").suggest(input, new AbortController().signal);
    expect(out.suggestions[0].id).toBe("professionals");
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("treats a malformed reply as no suggestions, and an HTTP error as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })));
    const out = await openaiProvider("key", "m").suggest(input, new AbortController().signal);
    expect(out.suggestions).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(anthropicProvider("key", "m").suggest(input, new AbortController().signal)).rejects.toThrow(/429/);
    const res = await suggestOptions(base, { provider: anthropicProvider("key", "m") });
    expect(res).toMatchObject({ fallback: true, reason: "error" });
  });
});
