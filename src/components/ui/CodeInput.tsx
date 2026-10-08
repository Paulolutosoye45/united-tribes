"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
};

/**
 * One real input drawn as separate slots. Keeping a single input lets phones
 * offer the emailed code from the keyboard and lets people paste it whole.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  error = false,
  disabled = false,
  label = "Six-digit code",
  autoFocus = false,
}: CodeInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function handle(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  }

  const active = Math.min(value.length, length - 1);

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <div key={error ? "err" : "ok"} className={cn("flex gap-2 sm:gap-2.5", error && "shake")} aria-hidden="true">
        {Array.from({ length }).map((_, i) => {
          const filled = i < value.length;
          const current = i === active && !disabled;
          return (
            <div
              key={i}
              className={cn(
                "t-heading grid h-16 flex-1 place-items-center rounded-[var(--radius-control)] border-[1.5px] bg-raised tabular-nums transition-[border-color,box-shadow,transform] duration-200",
                error ? "border-danger" : current ? "border-ink shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]" : filled ? "border-ink/60" : "border-line",
                filled && "scale-[1.03]",
              )}
            >
              {filled ? value[i] : ""}
            </div>
          );
        })}
      </div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => handle(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error || undefined}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0"
      />
    </div>
  );
}
