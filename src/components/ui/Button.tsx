import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "solid" | "quiet" | "ghost" | "night";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "btn-primary font-semibold",
  solid: "btn-solid font-semibold",
  quiet: "btn-quiet font-medium",
  ghost: "btn-ghost font-medium",
  night: "btn-night font-medium",
};

const SIZES: Record<Size, string> = {
  sm: "h-10 px-4 text-[0.9rem]",
  md: "h-12 px-5 text-[0.95rem]",
  lg: "h-14 px-6 text-base",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
};

/** Class names for anything that should look like a button, such as a link. */
export function buttonClasses({
  variant = "primary",
  size = "lg",
  fullWidth = false,
  className,
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  return cn(
    "btn inline-flex items-center justify-center gap-2.5 rounded-[var(--radius-control)] select-none",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "lg",
  loading = false,
  fullWidth = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      <span className="relative">{children}</span>
    </button>
  );
}
