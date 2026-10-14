import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const FIELD =
  "w-full rounded-[var(--radius-control)] border-[1.5px] bg-raised px-4 text-base text-ink " +
  "placeholder:text-soft/70 transition-[border-color,box-shadow] duration-200 " +
  "focus:outline-none focus:border-ink focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--crest-gold)_45%,transparent)]";

type Common = { label: string; hint?: string; error?: string | null; optional?: boolean };

function Wrap({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: Common & { id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-[0.95rem] font-medium">
        <span>{label}</span>
        {optional ? <span className="t-small font-normal text-soft">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="t-small text-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** `prefix` is a few characters drawn inside the box before what is typed, such as "+234". Decoration only: it is not part of the value. */
export type InputProps = InputHTMLAttributes<HTMLInputElement> & Common & { prefix?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, className, id, prefix, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const field = (
    <input
      ref={ref}
      id={inputId}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      className={cn(FIELD, "h-14", prefix && "pl-[4.5rem]", error ? "border-danger" : "border-line hover:border-soft", className)}
      {...rest}
    />
  );
  return (
    <Wrap id={inputId} label={label} hint={hint} error={error} optional={optional}>
      {prefix ? (
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-medium tabular-nums text-soft">
            {prefix}
          </span>
          {field}
        </div>
      ) : (
        field
      )}
    </Wrap>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Common;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, optional, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Wrap id={inputId} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={cn(FIELD, "min-h-32 resize-none py-3.5 leading-relaxed", error ? "border-danger" : "border-line hover:border-soft", className)}
        {...rest}
      />
    </Wrap>
  );
});

/** Native select, styled. Native keeps the phone's own picker, which is the fastest way to choose. */
export function Select({
  label,
  children,
  className,
  id,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[0.95rem] font-medium">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={cn(FIELD, "h-14 appearance-none border-line pr-11 hover:border-soft", className)}
          {...rest}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-soft"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
