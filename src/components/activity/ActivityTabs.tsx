"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const ACTIVITY_TABS = [
  { href: "/god/activity", label: "Pulse", exact: true },
  { href: "/god/activity/funnels", label: "Funnels" },
  { href: "/god/activity/stakeholders", label: "Stakeholders" },
  { href: "/god/activity/quality", label: "Quality and integrity" },
  { href: "/god/activity/messages", label: "Messages and sign-in" },
  { href: "/god/activity/audit", label: "Audit trail" },
  { href: "/god/activity/settings", label: "Settings" },
] as const;

/** The tabs of the activity dashboard. Only the owner's console ever draws them. */
export function ActivityTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Activity" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {ACTIVITY_TABS.map((tab) => {
        const active = "exact" in tab && tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press shrink-0 rounded-full px-4 py-2 text-[0.88rem] font-medium transition-colors",
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
