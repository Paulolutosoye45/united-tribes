import { useId } from "react";

export const SHIELD_PATH =
  "M6 6 H114 V68 C114 106 90 128 60 138 C30 128 6 106 6 68 Z";

type CrestProps = {
  size?: number;
  /** Quarters slide together once on load. Skipped for reduced motion. */
  animate?: boolean;
  /** "light" draws the outline in white, for use on charcoal. */
  tone?: "dark" | "light";
  className?: string;
  title?: string;
};

/**
 * The United Tribes mark: a shield quartered in the four crest colours.
 * It is drawn for this product and borrows only the palette of the
 * Covenant Nation logo.
 */
export function Crest({ size = 96, animate = false, tone = "dark", className, title }: CrestProps) {
  const clipId = useId();
  const a = (q: string) => (animate ? q : undefined);
  const outline = tone === "light" ? "rgb(255 255 255 / 0.92)" : "var(--crest-ink)";
  return (
    <svg
      viewBox="0 0 120 144"
      width={size}
      height={(size * 144) / 120}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect className={a("quarter-tl")} x="0" y="0" width="60" height="72" fill="var(--crest-charcoal)" />
        <rect className={a("quarter-tr")} x="60" y="0" width="60" height="72" fill="var(--crest-flame)" />
        <rect className={a("quarter-bl")} x="0" y="72" width="60" height="72" fill="var(--crest-gold)" />
        <rect className={a("quarter-br")} x="60" y="72" width="60" height="72" fill="var(--crest-amber)" />
        <path d="M60 0 V144 M0 72 H120" stroke={outline} strokeOpacity="0.25" strokeWidth="2" />
      </g>
      <path d={SHIELD_PATH} fill="none" stroke={outline} strokeWidth="3.5" strokeLinejoin="round" />
      <circle cx="60" cy="72" r="9" fill="var(--crest-gold)" stroke={outline} strokeWidth="3" />
    </svg>
  );
}
