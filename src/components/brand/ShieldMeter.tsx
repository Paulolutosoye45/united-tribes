import { useId } from "react";
import { SHIELD_PATH } from "./Crest";

export type MeterPart = {
  key: string;
  /** Plain-words name shown in the legend and read by screen readers. */
  label: string;
  /** 0 to 1: how much of this quarter is filled. */
  score: number;
};

const QUARTERS = [
  { x: 0, y: 0, w: 60, h: 72, color: "var(--crest-charcoal)" },
  { x: 60, y: 0, w: 60, h: 72, color: "var(--crest-flame)" },
  { x: 0, y: 72, w: 60, h: 72, color: "var(--crest-gold)" },
  { x: 60, y: 72, w: 60, h: 72, color: "var(--crest-amber)" },
] as const;

/**
 * The Degree of Compatibility shield. Four quarters, one per group of
 * matching factors; each fills from the bottom in proportion to its score.
 * Groups map to the matching weights: Goal 30, Season of life and tribe 35,
 * Place and rhythm 20, Fit and balance 15.
 */
export function ShieldMeter({
  parts,
  size = 88,
  animate = true,
}: {
  parts: [MeterPart, MeterPart, MeterPart, MeterPart];
  size?: number;
  animate?: boolean;
}) {
  const clipId = useId();
  const summary = parts.map((p) => `${p.label} ${Math.round(p.score * 100)}%`).join(", ");
  return (
    <svg
      viewBox="0 0 120 144"
      width={size}
      height={(size * 144) / 120}
      role="img"
      aria-label={summary}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {QUARTERS.map((q, i) => {
          const s = Math.max(0, Math.min(1, parts[i].score));
          const fillH = q.h * s;
          return (
            <g key={parts[i].key}>
              <rect x={q.x} y={q.y} width={q.w} height={q.h} fill={q.color} opacity="0.16" />
              <rect
                className={animate ? "meter-fill" : undefined}
                x={q.x}
                y={q.y + q.h - fillH}
                width={q.w}
                height={fillH}
                fill={q.color}
              />
            </g>
          );
        })}
        <path d="M60 0 V144 M0 72 H120" stroke="var(--page)" strokeWidth="3" />
      </g>
      <path d={SHIELD_PATH} fill="none" stroke="var(--crest-ink)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

export const METER_COLORS = QUARTERS.map((q) => q.color);
