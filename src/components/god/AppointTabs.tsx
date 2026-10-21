import Link from "next/link";
import { cn } from "@/lib/cn";

/** The two ways to appoint: one person at a time, or many at once. */
export function AppointTabs({ current }: { current: "one" | "bulk" }) {
  const tabs = [
    { id: "one", href: "/god/appointments", label: "One at a time" },
    { id: "bulk", href: "/god/appointments/bulk", label: "Bulk" },
  ] as const;
  return (
    <nav aria-label="Ways to appoint" className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === current ? "page" : undefined}
          className={cn("press rounded-full px-4 py-2 text-[0.92rem] font-medium", t.id === current ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
