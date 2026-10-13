import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARD_FIELDS, FIELD_SPECS, settleSuggested, specFor } from "@/lib/intake/heard";
import { SUCCESS_MAX, SUCCESS_WRITER_SYSTEM, plainSuccessDraft, successFacts, successOutcome } from "@/lib/intake/success";
import { MAX_AUDIO_BYTES, baseType, isAcceptedAudio, mockSpeech, openaiSpeech, speechFromEnv, tidyTranscript } from "@/lib/ai/stt";

describe("the week-12 sentence", () => {
  it("builds a plain draft from a catalogue goal", () => {
    expect(plainSuccessDraft({ title: "Strengthen our marriage." })).toBe("By week 12, I want to strengthen our marriage.");
  });

  it("quotes a goal in the person's own words rather than bending it", () => {
    expect(plainSuccessDraft({ own: "Peace with my in-laws" })).toBe("By week 12, I have made real progress on this: peace with my in-laws.");
  });

  it("gives nothing when there is no goal, and never runs past the limit", () => {
    expect(plainSuccessDraft({})).toBe("");
    expect(plainSuccessDraft({ title: "x".repeat(500) }).length).toBeLessThanOrEqual(SUCCESS_MAX);
  });

  it("hands the writer only the goal and the story", () => {
    const facts = successFacts({ goalTitle: "Grow in prayer", story: " I work nights. " });
    expect(facts).toContain("Grow in prayer");
    expect(facts).toContain("I work nights.");
    expect(facts.split("\n")).toHaveLength(2);
    expect(SUCCESS_WRITER_SYSTEM).toMatch(/Do not add facts/);
  });

  it("tells kept, edited and replaced apart", () => {
    const draft = "By week 12, I want to grow in prayer.";
    expect(successOutcome(draft, draft)).toBe("kept");
    expect(successOutcome(draft, "By week 12, I want to grow in prayer and fasting.")).toBe("edited");
    expect(successOutcome(draft, "A completely different sentence about money matters")).toBe("replaced");
    expect(successOutcome(draft, "")).toBe("replaced");
    expect(successOutcome(draft, undefined)).toBe("replaced");
  });
});

describe("the 'We heard' questions", () => {
  it("never offers the assistant a choice marked as not for it", () => {
    for (const field of Object.keys(FIELD_SPECS) as (keyof typeof FIELD_SPECS)[]) {
      const spec = specFor(field);
      expect(spec.options.length, field).toBeGreaterThan(1);
      expect(spec.max, field).toBeGreaterThan(0);
    }
    const ids = specFor("relationship").options.map((o) => o.id);
    expect(ids).toContain("married");
    expect(ids).not.toContain("widowed");
    expect(ids).not.toContain("separated");
  });

  it("never pre-ticks “no children” beside another answer about children", () => {
    expect(settleSuggested("children", ["under_12", "none"])).toEqual(["under_12"]);
    expect(settleSuggested("children", ["none", "teens"])).toEqual(["teens"]);
    expect(settleSuggested("children", ["none"])).toEqual(["none"]);
    expect(settleSuggested("children", ["under_12", "teens", "under_12"])).toEqual(["under_12", "teens"]);
    expect(settleSuggested("work_status", ["employed", "student"])).toEqual(["employed"]);
  });

  it("covers the four profile questions", () => {
    expect([...HEARD_FIELDS].sort()).toEqual(["children", "relationship", "work_field", "work_status"]);
  });
});

describe("voice notes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the recordings phones make and nothing else", () => {
    expect(baseType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(isAcceptedAudio("audio/webm;codecs=opus")).toBe(true);
    expect(isAcceptedAudio("audio/mp4")).toBe(true);
    expect(isAcceptedAudio("video/mp4")).toBe(false);
    expect(isAcceptedAudio("application/octet-stream")).toBe(false);
    expect(MAX_AUDIO_BYTES).toBeLessThanOrEqual(2_000_000);
  });

  it("picks the provider from the environment", () => {
    expect(speechFromEnv({})).toBeNull();
    expect(speechFromEnv({ STT_PROVIDER: "none", OPENAI_API_KEY: "k" })).toBeNull();
    expect(speechFromEnv({ STT_PROVIDER: "mock" })?.name).toBe("mock");
    expect(speechFromEnv({ OPENAI_API_KEY: "k" })?.name).toBe("openai");
    expect(speechFromEnv({ OPENAI_API_KEY: "k", OPENAI_STT_MODEL: "whisper-1" })?.model).toBe("whisper-1");
  });

  it("the stand-in returns a fixed story, or the one it is given", async () => {
    const signal = new AbortController().signal;
    expect(await mockSpeech().transcribe(new Uint8Array(1), "audio/webm", signal)).toMatch(/Yaba/);
    expect(await mockSpeech("Hello there").transcribe(new Uint8Array(1), "audio/webm", signal)).toBe("Hello there");
  });

  it("sends the recording to the transcription service as a file, with the language and prompt", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ text: "I live in Lekki." }), { status: 200 });
      }),
    );
    const text = await openaiSpeech("sk-test", "gpt-4o-mini-transcribe", "https://example.test").transcribe(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus", new AbortController().signal);
    expect(text).toBe("I live in Lekki.");
    expect(calls[0].url).toBe("https://example.test/v1/audio/transcriptions");
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("en");
    expect(String(form.get("prompt"))).toMatch(/Pidgin/);
    expect((form.get("file") as File).name).toBe("voice.webm");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("raises when the service refuses, so the form can say so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 429 })));
    await expect(openaiSpeech("k", "m").transcribe(new Uint8Array(1), "audio/webm", new AbortController().signal)).rejects.toThrow("stt 429");
  });

  it("tidies a transcript to one clean line within the limit", () => {
    expect(tidyTranscript("  one\n\n two\t three ")).toBe("one two three");
    const long = "A sentence goes here. ".repeat(100);
    const out = tidyTranscript(long, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(".")).toBe(true);
  });
});
