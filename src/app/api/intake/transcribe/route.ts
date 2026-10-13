import { NextResponse } from "next/server";
import { NO_STORE, guard, logCall, refuse } from "@/lib/ai/route";
import { MAX_AUDIO_BYTES, isAcceptedAudio, speechFromEnv, tidyTranscript } from "@/lib/ai/stt";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 20_000;

/**
 * Turns a voice note (up to about a minute) into words for the season story. The recording lives in memory for
 * the length of this request and is never written anywhere. Only people who agreed to the assistant may use it,
 * and the same rate limit applies as for suggestions. If transcription is not set up or fails, the form carries on
 * with typing (or the phone's own dictation).
 */
export async function POST(request: Request) {
  const speech = speechFromEnv();
  if (!speech) return NextResponse.json({ text: "", fallback: true, reason: "no_provider" }, { headers: NO_STORE });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 4096) return refuse("too large", 413);

  const checked = await guard(request, "multipart");
  if (!checked.ok) return checked.response;
  const { supabase, personId } = checked;

  let audio: Uint8Array;
  let mime: string;
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) return refuse("bad request", 400);
    mime = file.type;
    if (!isAcceptedAudio(mime)) return refuse("unsupported", 415);
    if (file.size < 200 || file.size > MAX_AUDIO_BYTES) return refuse(file.size < 200 ? "too short" : "too large", file.size < 200 ? 400 : 413);
    audio = new Uint8Array(await file.arrayBuffer());
  } catch {
    return refuse("bad request", 400);
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await speech.transcribe(audio, mime, controller.signal);
    const text = tidyTranscript(raw);
    await logCall(supabase, personId, "voice", {
      provider: speech.name,
      model: speech.model,
      latencyMs: Date.now() - started,
      fallback: !text,
      reason: text ? undefined : "empty",
      suggested: text ? 1 : 0,
    });
    if (!text) return NextResponse.json({ text: "", fallback: true, reason: "empty" }, { headers: NO_STORE });
    return NextResponse.json({ text, fallback: false }, { headers: NO_STORE });
  } catch (error) {
    const aborted = controller.signal.aborted || (error as { name?: string })?.name === "AbortError";
    await logCall(supabase, personId, "voice", {
      provider: speech.name,
      model: speech.model,
      latencyMs: Date.now() - started,
      fallback: true,
      reason: aborted ? "timeout" : "error",
    });
    return NextResponse.json({ text: "", fallback: true, reason: aborted ? "timeout" : "error" }, { headers: NO_STORE });
  } finally {
    clearTimeout(timer);
    audio = new Uint8Array(0);
  }
}
