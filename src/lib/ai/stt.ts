/**
 * Turning a short voice note into words. The recording is held in memory only while it is sent for
 * transcription and is never written anywhere, so "voice notes are deleted once transcribed" is true by
 * construction: there is nothing to delete.
 *
 *   STT_PROVIDER=openai | mock | none
 *   Unset: uses OpenAI if OPENAI_API_KEY is set, otherwise voice notes are off and the form falls back to the
 *   phone's own dictation, or typing.
 *   OPENAI_STT_MODEL (default gpt-4o-mini-transcribe; whisper-1 also works)
 *
 * Before launch, run the 100-story bake-off with real Nigerian voices and pick the model that wins.
 */
export interface SpeechProvider {
  readonly name: string;
  readonly model: string;
  transcribe(audio: Uint8Array, mime: string, signal: AbortSignal): Promise<string>;
}

/** Words that help the model with the way our members speak and the places they name. */
export const STT_PROMPT =
  "A short voice note in Nigerian English, sometimes with Pidgin or Yoruba, Igbo or Hausa words. Words such as japa, side hustle, NYSC, Yaba, Lekki, Ikorodu, Iganmu, Surulere.";

export const MAX_AUDIO_BYTES = 2_000_000;
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"] as const;

const EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

/** The base type, without parameters: "audio/webm;codecs=opus" is "audio/webm". */
export function baseType(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

export function isAcceptedAudio(mime: string): boolean {
  return (AUDIO_TYPES as readonly string[]).includes(baseType(mime));
}

export function openaiSpeech(apiKey: string, model: string, base = "https://api.openai.com"): SpeechProvider {
  return {
    name: "openai",
    model,
    async transcribe(audio, mime, signal) {
      const type = baseType(mime);
      const form = new FormData();
      form.append("file", new Blob([audio as BlobPart], { type }), `voice.${EXTENSION[type] ?? "webm"}`);
      form.append("model", model);
      form.append("language", "en");
      form.append("prompt", STT_PROMPT);
      form.append("response_format", "json");
      const res = await fetch(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`stt ${res.status}`);
      const data = (await res.json()) as { text?: string };
      return typeof data.text === "string" ? data.text : "";
    },
  };
}

/** Needs no network or key, so tests and the local stand-in run the whole path. */
export function mockSpeech(text?: string): SpeechProvider {
  return {
    name: "mock",
    model: "fixed-text",
    async transcribe() {
      return (
        text ??
        "I work in a bank on the Island. Just got promoted to lead a team of six and honestly I am still finding my feet. Married with two small kids, we live in Yaba. I want to grow but I do not want to lose my peace."
      );
    },
  };
}

export function speechFromEnv(env: Record<string, string | undefined> = process.env): SpeechProvider | null {
  const choice = (env.STT_PROVIDER ?? "").toLowerCase();
  if (choice === "none") return null;
  if (choice === "mock") return mockSpeech(env.STT_MOCK_TEXT);
  if ((choice === "openai" || !choice) && env.OPENAI_API_KEY) {
    return openaiSpeech(env.OPENAI_API_KEY, env.OPENAI_STT_MODEL ?? "gpt-4o-mini-transcribe", env.OPENAI_API_BASE ?? "https://api.openai.com");
  }
  return null;
}

/** Tidies a transcript for the text box: one line of plain text, no more than the story allows. */
export function tidyTranscript(text: string, max = 1500): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return stop > max * 0.6 ? cut.slice(0, stop + 1) : cut.trimEnd();
}
