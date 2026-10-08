import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "flame" | "gold" | "charcoal" | "outline";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-strong text-ink",
  flame: "bg-flame text-on-flame",
  gold: "bg-gold text-on-flame",
  charcoal: "bg-charcoal text-white",
  outline: "border border-line text-soft",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.8rem] font-semibold leading-5",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
