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
  { href: "/god/leader-desk", label: "Leader Desk" },
  { href: "/god/exports", label: "Exports" },
  { href: "/god/features", label: "Features" },
  { href: "/god/details", label: "Details check" },
  { href: "/god/activity", label: "Activity" },
  { href: "/god/record", label: "Your record" },
] as const;

/** The rooms of the console. `requestsWaiting` is how many requests from Admin are waiting for the owner; it shows as a count on Placement. */
export function GodNav({ requestsWaiting = 0 }: { requestsWaiting?: number }) {
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
            {tab.href === "/god/placement" && requestsWaiting > 0 ? (
              <span
                className={cn("ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-[0.78rem] font-semibold tabular-nums", active ? "bg-page text-ink" : "bg-ink text-page")}
                data-testid="placement-waiting-count"
                aria-label={`${requestsWaiting} ${requestsWaiting === 1 ? "request is" : "requests are"} waiting for you`}
              >
                {requestsWaiting}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
