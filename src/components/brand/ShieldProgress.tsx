import { useId } from "react";
import { SHIELD_PATH } from "./Crest";

const QUARTERS = [
  { x: 0, y: 0, color: "var(--crest-charcoal)" },
  { x: 60, y: 0, color: "var(--crest-flame)" },
  { x: 0, y: 72, color: "var(--crest-gold)" },
  { x: 60, y: 72, color: "var(--crest-amber)" },
] as const;

/**
 * Form progress drawn as the crest. Each of the four sections of the form is
 * one quarter; it fills from the bottom as the person moves through it.
 * `fills` is four numbers from 0 to 1. `active` is the quarter being worked on.
 */
export function ShieldProgress({
  fills,
  active,
  size = 40,
  tone = "dark",
  label,
  done = false,
}: {
  fills: readonly [number, number, number, number];
  active?: number;
  size?: number;
  tone?: "dark" | "light";
  label: string;
  done?: boolean;
}) {
  const clipId = useId();
  const outline = tone === "light" ? "rgb(255 255 255 / 0.9)" : "var(--crest-ink)";
  return (
    <svg
      viewBox="0 0 120 144"
      width={size}
      height={(size * 144) / 120}
      role="img"
      aria-label={label}
      style={done ? { filter: "drop-shadow(0 0 14px rgb(244 196 67 / 0.55))" } : undefined}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {QUARTERS.map((q, i) => {
          const f = Math.max(0, Math.min(1, fills[i]));
          return (
            <g key={i}>
              <rect x={q.x} y={q.y} width="60" height="72" fill={q.color} opacity="0.16" />
              <rect
                x={q.x}
                y={q.y}
                width="60"
                height="72"
                fill={q.color}
                style={{
                  transform: `scaleY(${f})`,
                  transformBox: "fill-box",
                  transformOrigin: "bottom",
                  transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              />
              {active === i && f < 1 ? (
                <rect
                  x={q.x + 2}
                  y={q.y + 2}
                  width="56"
                  height="68"
                  fill="none"
                  stroke={outline}
                  strokeWidth="2.5"
                  strokeDasharray="5 5"
                  opacity="0.65"
                />
              ) : null}
            </g>
          );
        })}
        <path d="M60 0 V144 M0 72 H120" stroke="var(--page)" strokeWidth="3" />
      </g>
      <path d={SHIELD_PATH} fill="none" stroke={outline} strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}
