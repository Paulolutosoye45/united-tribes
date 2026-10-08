import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-gold",
        "bg-[radial-gradient(120%_120%_at_20%_0%,#4a4a45,var(--crest-charcoal))] shadow-[inset_0_0_0_1.5px_rgb(244_196_67/0.55)]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export { initials };
