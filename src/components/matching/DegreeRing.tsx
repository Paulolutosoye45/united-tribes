"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** The Degree of Compatibility as a ring that fills once when it appears. The number is always in the text. */
export function DegreeRing({ value, size = 92, tone = "light", className }: { value: number; size?: number; tone?: "light" | "night"; className?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const stroke = Math.max(7, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={`${value} percent compatible`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={tone === "night" ? "rgb(255 255 255 / 0.16)" : "var(--line)"} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={tone === "night" ? "var(--crest-gold)" : "var(--crest-flame)"}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1100ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center leading-none">
        <span className="font-extrabold tracking-tight [font-stretch:76%] [font-variant-numeric:tabular-nums_lining-nums]" style={{ fontSize: size * 0.36 }}>
          {value}
          <span style={{ fontSize: size * 0.17 }} className="ml-0.5 align-top font-semibold opacity-70">
            %
          </span>
        </span>
      </span>
    </div>
  );
}
