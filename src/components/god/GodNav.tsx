"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/god", label: "Overview", exact: true },
  { href: "/god/desks", label: "Desks" },
  { href: "/god/people", label: "People" },
  { href: "/god/conversations", label: "Conversations" },
  { href: "/god/tribes", label: "Tribes" },
  { href: "/god/appointments", label: "Appointments" },
  { href: "/god/placement", label: "Placement" },
  { href: "/god/exports", label: "Exports" },
  { href: "/god/activity", label: "Activity" },
  { href: "/god/record", label: "Your record" },
] as const;

/** The rooms of the console. */
export function GodNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Console" className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const active = "exact" in tab && tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press rounded-full px-4 py-2 text-[0.92rem] font-medium transition-colors",
              active ? "bg-ink text-page" : "border border-line text-soft hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
