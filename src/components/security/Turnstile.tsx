"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { turnstileScriptUrl, turnstileSiteKey } from "@/lib/security/turnstile";

type Api = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: Api;
  }
}

let loading: Promise<Api> | null = null;

/** Loads Cloudflare's script once. Added from our own script, so the page's policy lets it run. */
function loadApi(): Promise<Api> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Api>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = turnstileScriptUrl();
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type TurnstileHandle = { reset: () => void };

/**
 * The bot check. Mostly invisible: it asks the visitor to do something only when it is unsure. Gives the page a one-time
 * token through onToken, and null when the token has been used up, has expired or could not be made.
 */
export function Turnstile({ onToken, ref }: { onToken: (token: string | null) => void; ref?: Ref<TurnstileHandle> }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const report = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
    },
  }));

  useEffect(() => {
    const siteKey = turnstileSiteKey();
    const el = box.current;
    if (!siteKey || !el) return;
    let cancelled = false;
    loadApi()
      .then((api) => {
        if (cancelled) return;
        widget.current = api.render(el, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token: string) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => {
            report.current(null);
            setFailed(true);
          },
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  return (
    <div>
      <div ref={box} data-testid="bot-check" />
      {failed ? (
        <p role="status" className="t-small text-soft">
          We couldn’t check that you are a person. Reload the page, or try again in a moment.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Everything a form needs: whether the check is on, the latest token, the element to place, and `spent()` to call after the
 * token has been used (each token works once).
 */
export function useTurnstile() {
  const enabled = turnstileSiteKey() !== null;
  const [token, setToken] = useState<string | null>(null);
  const handle = useRef<TurnstileHandle>(null);
  const spent = useCallback(() => {
    setToken(null);
    handle.current?.reset();
  }, []);
  const widget = enabled ? <Turnstile ref={handle} onToken={setToken} /> : null;
  return { enabled, token, ready: !enabled || token !== null, widget, spent };
}
