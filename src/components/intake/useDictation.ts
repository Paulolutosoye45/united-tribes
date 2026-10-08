"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { 0: { transcript: string }; isFinal: boolean; length: number };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

function getCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speak instead of type, where the phone's browser offers it (most Android
 * phones in Chrome). The browser's own speech service does the listening, so
 * nothing is sent to our servers. Nigerian English is requested first.
 */
export function useDictation(onFinalText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onFinalText);

  useEffect(() => {
    callback.current = onFinalText;
  }, [onFinalText]);

  useEffect(() => {
    // Feature detection has to wait until the browser is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getCtor() !== null);
    return () => recognition.current?.stop();
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = "en-NG";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text.trim()) callback.current(text.trim());
    };
    r.onerror = (e) => {
      setError(
        e.error === "not-allowed"
          ? "Microphone access is off. You can type instead."
          : "We couldn't hear that. Try again or type.",
      );
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }, []);

  return { supported, listening, error, start, stop };
}
