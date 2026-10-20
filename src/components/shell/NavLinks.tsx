"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { NavItem } from "@/lib/auth/roles";
import { NavIcon } from "./NavIcon";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Links in the header on wide screens. */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length < 2) return null;
  const index = Math.max(
    0,
    items.findIndex((item) => isActive(pathname, item.href)),
  );
  const anyActive = items.some((item) => isActive(pathname, item.href));
  return (
    <nav
      aria-label="Main"
      className="relative hidden grid-flow-col auto-cols-fr items-center rounded-full border border-line bg-raised/70 p-1 lg:grid"
      style={{ ["--n" as string]: items.length, ["--i" as string]: index }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-1 left-1 rounded-full bg-ink transition-[transform,opacity] duration-500 [transition-timing-function:var(--ease-out)]",
          anyActive ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: "calc((100% - 8px) / var(--n))",
          transform: "translateX(calc(var(--i) * 100%))",
        }}
      />
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative z-10 whitespace-nowrap rounded-full px-5 py-2 text-center text-[0.92rem] font-medium transition-colors duration-300",
              active ? "text-page" : "text-soft hover:text-ink",
            )}
            style={{ minWidth: "6.5rem" }}
          >
            {item.short ?? item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A floating dock along the bottom on phones, sized for a thumb. */
export function BottomTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length < 2) return null;
  const index = items.findIndex((item) => isActive(pathname, item.href));
  // Six or more places (a pastor, a director) leave about 50px each on a phone: tighter padding and a smaller label keep every word whole
  const crowded = items.length >= 6;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 safe-bottom lg:hidden">
      <nav
        aria-label="Main"
        className="glass pointer-events-auto relative mx-auto grid max-w-md grid-flow-col auto-cols-fr rounded-[28px] border border-line p-1.5 shadow-[var(--shadow-pop)]"
        style={{ ["--n" as string]: items.length, ["--i" as string]: Math.max(index, 0) }}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1.5 left-1.5 rounded-[22px] bg-gold shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] transition-[transform,opacity] duration-500 [transition-timing-function:var(--ease-spring)]",
            index >= 0 ? "opacity-100" : "opacity-0",
          )}
          style={{
            width: "calc((100% - 12px) / var(--n))",
            transform: "translateX(calc(var(--i) * 100%))",
          }}
        />
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "press relative z-10 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[22px] font-medium leading-tight transition-colors duration-300",
                crowded ? "px-0.5 text-[0.625rem]" : "px-2 text-[0.72rem]",
                active ? "font-semibold text-on-flame" : "text-soft",
              )}
            >
              <NavIcon name={item.icon} />
              <span className="max-w-full truncate">{item.short ?? item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
