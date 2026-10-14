"use client";

import { useEffect, useRef, useState } from "react";
import { previewDocument } from "@/lib/outreach/compose";
import type { DesignSpec } from "@/lib/outreach/email-design";

type Props = { spec: DesignSpec; label?: string; initialDevice?: "phone" | "desktop" };

/**
 * An email exactly as it will arrive: the real design, in a frame the width of a phone or a desktop mail window,
 * in light or dark. Links in it are switched off. The frame has no scripts and cannot reach the page around it.
 */
export function EmailFrame({ spec, label = "Email preview", initialDevice = "phone" }: Props) {
  const [device, setDevice] = useState<"phone" | "desktop">(initialDevice);
  const [dark, setDark] = useState(false);
  const [height, setHeight] = useState(520);
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = previewDocument(spec, dark);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const measure = () => {
      const h = frame.contentDocument?.documentElement?.scrollHeight;
      if (h) setHeight(Math.min(Math.max(h, 320), 1400));
    };
    frame.addEventListener("load", measure);
    const t = setTimeout(measure, 150);
    return () => {
      frame.removeEventListener("load", measure);
      clearTimeout(t);
    };
  }, [doc, device]);

  const pill = (active: boolean) =>
    `press min-h-9 rounded-full px-3.5 text-[0.85rem] font-semibold transition-colors ${active ? "bg-ink text-page" : "bg-surface text-ink hover:bg-surface-strong"}`;

  return (
    <figure className="flex flex-col gap-3" aria-label={label} data-testid="email-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Screen size">
          <button type="button" className={pill(device === "phone")} aria-pressed={device === "phone"} onClick={() => setDevice("phone")}>
            Phone
          </button>
          <button type="button" className={pill(device === "desktop")} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>
            Computer
          </button>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Light or dark">
          <button type="button" className={pill(!dark)} aria-pressed={!dark} onClick={() => setDark(false)}>
            Light
          </button>
          <button type="button" className={pill(dark)} aria-pressed={dark} onClick={() => setDark(true)}>
            Dark
          </button>
        </div>
      </div>
      <div className="flex justify-center rounded-[var(--radius-card)] bg-surface-strong/60 p-3 sm:p-5">
        <div
          className={`overflow-hidden bg-white shadow-lg transition-[width] duration-300 ${device === "phone" ? "w-[375px] max-w-full rounded-[28px] border-[6px] border-ink" : "w-full max-w-[640px] rounded-[10px] border border-line"}`}
        >
          <div className="border-b border-line bg-surface px-4 py-2.5 text-left">
            <p className="t-small truncate font-semibold" data-testid="preview-subject">
              {spec.subject}
            </p>
            <p className="t-small truncate text-soft">{spec.preheader}</p>
          </div>
          <iframe
            ref={ref}
            title={label}
            sandbox="allow-same-origin"
            srcDoc={doc}
            style={{ height, width: "100%", border: 0, display: "block", colorScheme: dark ? "dark" : "light" }}
          />
        </div>
      </div>
    </figure>
  );
}
