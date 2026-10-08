import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  selected?: boolean;
  /** Marks an option the assistant proposed, so people can tell it from their own pick. */
  suggested?: boolean;
};

export function Chip({ selected = false, suggested = false, className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "press inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-chip)] border-[1.5px] px-4 text-[0.95rem] transition-colors",
        selected
          ? "border-ink bg-ink font-semibold text-page"
          : "border-line bg-raised text-ink hover:border-soft",
        className,
      )}
      {...rest}
    >
      {suggested ? <Sparkle selected={selected} /> : null}
      {children}
      {suggested ? <span className="sr-only"> (suggested)</span> : null}
    </button>
  );
}

export function Sparkle({ selected = false, size = 14 }: { selected?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"
        fill={selected ? "var(--crest-gold)" : "var(--crest-flame)"}
      />
    </svg>
  );
}
