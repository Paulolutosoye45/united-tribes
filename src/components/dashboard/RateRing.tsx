"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * A rate as a ring that fills once when it appears, with a tick where the target is.
 * The number is always written in the middle, so the ring is never the only way to read it.
 */
export function RateRing({
  value,
  target,
  size = 132,
  label,
  className,
}: {
  /** 0 to 1, or null when there is nothing to show yet. */
  value: number | null;
  /** 0 to 1 */
  target?: number;
  size?: number;
  label: string;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value ?? 0));
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const stroke = Math.max(9, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const text = value === null ? "–" : `${Math.round(value * 100)}`;
  // A tick across the ring at the target's angle
  const angle = target === undefined ? null : target * 2 * Math.PI - Math.PI / 2;
  const tick =
    angle === null
      ? null
      : {
          x1: cx + (r - stroke * 0.8) * Math.cos(angle),
          y1: cx + (r - stroke * 0.8) * Math.sin(angle),
          x2: cx + (r + stroke * 0.8) * Math.cos(angle),
          y2: cx + (r + stroke * 0.8) * Math.sin(angle),
        };

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={value === null ? `${label}: not enough weeks yet` : `${label}: ${Math.round(value * 100)} percent${target !== undefined ? `, target ${Math.round(target * 100)}` : ""}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cx} r={r} fill="none" strokeWidth={stroke} stroke="rgb(255 255 255 / 0.16)" />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="var(--crest-gold)"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: "stroke-dashoffset 1200ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
        {tick ? <line {...tick} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" /> : null}
      </svg>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center leading-none">
        <span className="font-extrabold tracking-tight [font-stretch:76%] [font-variant-numeric:tabular-nums_lining-nums]" style={{ fontSize: size * 0.34 }}>
          {text}
          {value !== null ? (
            <span style={{ fontSize: size * 0.15 }} className="ml-0.5 align-top font-semibold opacity-70">
              %
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
