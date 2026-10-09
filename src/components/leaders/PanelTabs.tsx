"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/review", label: "Applications", exact: true },
  { href: "/review/interviews", label: "Interviews" },
  { href: "/review/academy", label: "Academy" },
  { href: "/review/cards", label: "Tribe Cards" },
  { href: "/review/rhythm", label: "Weekly report" },
] as const;

/** The parts of the panel’s work, as a row that scrolls sideways on a phone. */
export function PanelTabs() {
  const pathname = usePathname();
  // An application opened from the queue (/review/<id>) belongs to the first tab.
  const active = TABS.find((t) => pathname === t.href || (!("exact" in t) && pathname.startsWith(`${t.href}/`)))?.href ?? "/review";
  return (
    <nav aria-label="Review sections" className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active === t.href ? "page" : undefined}
              className={cn(
                "press inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.95rem] font-medium transition-colors",
                active === t.href ? "border-ink bg-ink text-page" : "border-line bg-raised text-soft hover:border-soft hover:text-ink",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
