import { cn } from "@/lib/cn";

const LINES = [
  { key: "god", label: "Loving God", color: "var(--crest-charcoal)" },
  { key: "others", label: "Loving Others", color: "var(--crest-flame)" },
  { key: "life", label: "Loving Life", color: "var(--crest-gold)" },
] as const;

/** The three lines a circle agrees to reach by week 12. */
export function SuccessPicture({ god, others, life, tone = "light" }: { god: string; others: string; life: string; tone?: "light" | "night" }) {
  const text = { god, others, life };
  return (
    <ul className="flex flex-col gap-3">
      {LINES.map((l) => (
        <li key={l.key} className="flex gap-3">
          <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: tone === "night" && l.key === "god" ? "#ffffff" : l.color }} />
          <div className="min-w-0">
            <p className={cn("t-small font-semibold", tone === "night" && "text-white")}>{l.label}</p>
            <p className={cn("t-small", tone === "night" ? "text-white/80" : "text-ink")}>{text[l.key]}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
