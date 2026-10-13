"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 60;

type State = "idle" | "recording" | "working";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Record up to a minute of speech and turn it into words for the story box. The recording goes to our server only
 * to be transcribed and is deleted straight away (see /api/intake/transcribe). If anything goes wrong the person is
 * told in one sentence and can type, or use their phone's own dictation instead.
 */
export function useVoiceNote(options: { enabled: boolean; onText: (text: string) => void }) {
  const { enabled, onText } = options;
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunks = useRef<Blob[]>([]);
  const callback = useRef(onText);

  useEffect(() => {
    callback.current = onText;
  }, [onText]);

  useEffect(() => {
    // Feature detection has to wait until the browser is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(enabled && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
  }, [enabled]);

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      release();
    },
    [release],
  );

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = (e as { name?: string })?.name === "NotAllowedError" || (e as { name?: string })?.name === "SecurityError";
      setError(denied ? "Microphone access is off. You can type instead." : "We couldn’t reach a microphone. You can type instead.");
      return;
    }
    stream.current = media;
    chunks.current = [];
    const type = pickType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    } catch {
      release();
      setError("This browser can’t record. You can type instead.");
      return;
    }
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = async () => {
      release();
      const blob = new Blob(chunks.current, { type: rec.mimeType || type || "audio/webm" });
      chunks.current = [];
      if (blob.size < 300) {
        setState("idle");
        setError("We didn’t hear anything. Try again, or type.");
        return;
      }
      setState("working");
      try {
        const form = new FormData();
        form.append("audio", blob, "voice");
        const res = await fetch("/api/intake/transcribe", {
          method: "POST",
          body: form,
          signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(30000) : undefined,
        });
        const data = (await res.json().catch(() => ({}))) as { text?: string };
        if (res.ok && typeof data.text === "string" && data.text.trim()) callback.current(data.text.trim());
        else setError("We couldn’t turn that into words. Try again, or type.");
      } catch {
        setError("We couldn’t turn that into words. Check your connection, or type.");
      } finally {
        setState("idle");
      }
    };
    setSeconds(0);
    setState("recording");
    rec.start();
    timer.current = setInterval(() => {
      setSeconds((n) => {
        if (n + 1 >= MAX_VOICE_SECONDS) {
          if (rec.state === "recording") rec.stop();
          return MAX_VOICE_SECONDS;
        }
        return n + 1;
      });
    }, 1000);
  }, [release]);

  return { supported, state, seconds, error, start, stop };
}
