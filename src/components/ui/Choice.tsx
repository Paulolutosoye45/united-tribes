import type { ChangeEventHandler, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Sparkle } from "./Chip";

type ChoiceProps = {
  type?: "radio" | "checkbox";
  name: string;
  value: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  title: string;
  description?: string;
  /** The assistant proposed this one. */
  suggested?: boolean;
  /** One line quoting or paraphrasing the person, shown when suggested. */
  reason?: string;
  leading?: ReactNode;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * One answer you can tap. Built on a real radio or checkbox, so keyboards,
 * screen readers and phone accessibility tools work without extra code.
 */
export function Choice({
  type = "radio",
  name,
  value,
  checked,
  onChange,
  title,
  description,
  suggested = false,
  reason,
  leading,
  disabled,
  className,
  style,
}: ChoiceProps) {
  return (
    <label style={style} className={cn("choice cursor-pointer", suggested && "suggested", disabled && "opacity-50", className)}>
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold leading-snug">
          {suggested ? <Sparkle size={15} selected={false} /> : null}
          <span>{title}</span>
          {suggested ? <span className="sr-only">(suggested for you)</span> : null}
        </span>
        {description ? <span className="t-small block text-soft">{description}</span> : null}
        {suggested && reason ? <span className="t-small mt-0.5 block text-accent">{reason}</span> : null}
      </span>
      <span className={cn("choice-mark", type === "checkbox" && "square")} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </label>
  );
}

type SegmentedProps<T extends string | number> = {
  name: string;
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** Short either/or answers: a pill with a sliding feel, built on radios. */
export function Segmented<T extends string | number>({ name, label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((o) => (
        <label key={String(o.value)}>
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/**
 * A this-or-that pair: two big buttons side by side. Tap one to choose it;
 * tap it again to go back to "either". Left is -1, right is 1, neither is 0.
 */
export function Pair({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: -1 | 0 | 1;
  onChange: (value: -1 | 0 | 1) => void;
}) {
  const side = (v: -1 | 1, text: string) => {
    const on = value === v;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(on ? 0 : v)}
        className={cn(
          "press min-h-[3.75rem] rounded-[var(--radius-control)] border-[1.5px] px-3 py-2 text-center text-[0.95rem] leading-snug transition-[background-color,border-color,box-shadow,transform] duration-200",
          on
            ? "border-ink bg-gold/30 font-semibold shadow-[0_0_0_3px_color-mix(in_srgb,var(--crest-gold)_40%,transparent)]"
            : "border-line bg-raised text-ink hover:border-soft",
        )}
      >
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-2.5">
      {side(-1, left)}
      {side(1, right)}
    </div>
  );
}
