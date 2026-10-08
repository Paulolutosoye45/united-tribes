"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Sparkle } from "@/components/ui/Chip";
import { cn } from "@/lib/cn";
import { BASELINES } from "@/lib/intake/options";

/** The question. It takes focus when the screen changes so screen readers announce it. */
export function StepHeading({ title, hint }: { title: string; hint?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="mb-7 flex flex-col gap-3 sm:mb-9">
      <h1 ref={ref} tabIndex={-1} className="t-question outline-none">
        {title}
      </h1>
      {hint ? <p className="t-body max-w-[46ch] text-soft">{hint}</p> : null}
    </header>
  );
}

/** Holds the place for suggestions while they load, then makes way for them. */
export function SuggestionLabel({ loading, children }: { loading?: boolean; children: ReactNode }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-[0.95rem] font-semibold">
      <Sparkle size={16} />
      <span>{children}</span>
      {loading ? (
        <span className="ml-1 flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-flame"
              style={{ animationDelay: `${i * 140}ms` }}
            />
          ))}
        </span>
      ) : null}
    </p>
  );
}

export function SkeletonChoice() {
  return <div className="skeleton h-[4.25rem] w-full rounded-[var(--radius-control)]" />;
}

/** Five big tap targets for a 1 to 5 answer, with the meaning spelled out. */
export function ScaleInput({
  value,
  onChange,
  label,
  labels,
  ends = "1 is just starting, 5 is almost there",
  name = "baseline",
}: {
  value: number | undefined;
  onChange: (n: 1 | 2 | 3 | 4 | 5) => void;
  label: string;
  /** What each number means, lowest first. Defaults to the goal-progress words. */
  labels?: readonly string[];
  /** A hint for the two ends, shown on wider screens. */
  ends?: string;
  name?: string;
}) {
  const scale = labels ? labels.map((text, i) => ({ value: (i + 1) as 1 | 2 | 3 | 4 | 5, label: text })) : BASELINES;
  const current = scale.find((b) => b.value === value);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-2">
        {scale.map((b) => {
          const on = value !== undefined && b.value <= value;
          const exact = b.value === value;
          return (
            <label
              key={b.value}
              className={cn(
                "press grid h-14 cursor-pointer place-items-center rounded-[var(--radius-control)] border-[1.5px] text-lg font-semibold transition-all duration-300 has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-ink",
                on ? "border-ink bg-gold text-on-flame" : "border-line bg-raised text-soft hover:border-soft",
                exact && "scale-[1.06] shadow-[0_8px_18px_-8px_rgb(0_0_0/0.45)]",
              )}
            >
              <input
                type="radio"
                name={name}
                value={b.value}
                checked={exact}
                onChange={() => onChange(b.value)}
                className="sr-only"
              />
              <span aria-hidden="true">{b.value}</span>
              <span className="sr-only">
                {b.value} of 5, {b.label}
              </span>
            </label>
          );
        })}
      </div>
      <p className="t-small flex justify-between text-soft" aria-live="polite">
        <span>{current ? <strong className="font-semibold text-ink">{current.label}</strong> : "Tap a number"}</span>
        {ends ? <span className="hidden sm:inline">{ends}</span> : null}
      </p>
    </div>
  );
}

export function MicButton({
  listening,
  onClick,
  label = "Speak your answer",
}: {
  listening: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : label}
      className={cn(
        "press absolute bottom-3 right-3 grid h-11 w-11 place-items-center rounded-full border transition-colors",
        listening ? "ring-pulse border-flame bg-flame text-on-flame" : "border-line bg-raised text-ink hover:border-soft",
      )}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}

export function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "info" }) {
  return (
    <p
      className={cn(
        "t-small rounded-[var(--radius-control)] px-4 py-3",
        tone === "info" ? "bg-gold/20 text-ink" : "text-soft",
      )}
    >
      {children}
    </p>
  );
}
