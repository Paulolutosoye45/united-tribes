"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const BASE_TABS = [
  { href: "/review", label: "Applications", exact: true },
  { href: "/review/interviews", label: "Interviews" },
  { href: "/review/academy", label: "Academy" },
  { href: "/review/cards", label: "Tribe Cards" },
  { href: "/review/templates", label: "Ready-made cards" },
  { href: "/review/rhythm", label: "Weekly report" },
] as const;

const STAGES_TAB = { href: "/review/stages", label: "Stage changes" } as const;

/** The parts of the panel’s work, as a row that scrolls sideways on a phone. `stages` adds the tab for changes to a leader’s stage of life. */
export function PanelTabs({ stages = false }: { stages?: boolean }) {
  const pathname = usePathname();
  const TABS: readonly { href: string; label: string; exact?: true }[] = stages ? [...BASE_TABS.slice(0, 4), STAGES_TAB, ...BASE_TABS.slice(4)] : BASE_TABS;
  // An application opened from the queue (/review/<id>) belongs to the first tab.
  const active = TABS.find((t) => pathname === t.href || (!t.exact && pathname.startsWith(`${t.href}/`)))?.href ?? "/review";
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
