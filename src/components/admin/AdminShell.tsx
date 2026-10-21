"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { barText, crumbsFor, pageFor, type MenuSection } from "@/lib/admin/nav";
import { MenuPanel } from "./MenuPanel";

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/**
 * Every Admin page sits in this: a menu down the left on a computer; on a phone, a bar with the section and page that opens the whole menu
 * as a sheet from the bottom. The pages inside are exactly the ones they always were. Their own back link is hidden, because the
 * breadcrumbs say where they are and the menu goes anywhere.
 */
export function AdminShell({ menu, children }: { menu: MenuSection[]; children: ReactNode }) {
  const pathname = usePathname();
  // The sheet is open for the page it was opened on, so moving to another page closes it without anything having to say so.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const dialog = useRef<HTMLDialogElement>(null);
  const sideSearch = useRef<HTMLInputElement>(null);
  const sheetSearch = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 1024px)").matches) sideSearch.current?.focus();
      else {
        setOpenOn(pathname);
        window.setTimeout(() => sheetSearch.current?.focus(), 30);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  // Someone who may open nothing here (the platform owner before the passphrase, say) sees the page as it is.
  if (menu.length === 0) return <>{children}</>;

  const page = pageFor(pathname);
  const crumbs = crumbsFor(pathname);
  const deeper = Boolean(page) && pathname.replace(/\/+$/, "") !== page?.href;

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8" data-testid="admin-shell">
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1" aria-label="Admin">
        <h2 className="t-heading px-3 pb-2">Admin</h2>
        <MenuPanel menu={menu} pathname={pathname} inputRef={sideSearch} idPrefix="side" />
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-1 lg:hidden">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpenOn(pathname)}
            data-testid="admin-bar"
            className="press flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] border border-line bg-raised px-4 text-left"
          >
            <MenuIcon />
            <span className="min-w-0 flex-1 truncate font-semibold">{barText(pathname)}</span>
            <span className="t-small text-soft">Menu</span>
          </button>
          {deeper && page ? (
            <Link href={page.href} className="t-small inline-flex min-h-11 w-fit items-center px-1 text-soft hover:text-ink">
              <span aria-hidden="true">← </span>
              {page.label}
            </Link>
          ) : null}
        </div>

        <nav aria-label="Breadcrumb" className="t-small hidden lg:block">
          <p className="flex flex-wrap items-center gap-x-2 text-soft">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true">›</span> : null}
                {c.href ? (
                  <Link href={c.href} className="hover:text-ink hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className={i === crumbs.length - 1 ? "font-medium text-ink" : undefined}>
                    {c.label}
                  </span>
                )}
              </span>
            ))}
          </p>
        </nav>

        <div className="min-w-0 [&_[data-back-link]]:hidden">{children}</div>
      </div>

      <dialog
        ref={dialog}
        aria-label="Admin menu"
        onClose={() => setOpenOn(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpenOn(null);
        }}
        className="m-0 mt-auto max-h-[88dvh] w-full max-w-none rounded-b-none rounded-t-[var(--radius-sheet)] border border-line bg-raised p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-black/40 lg:hidden"
        data-testid="admin-sheet"
      >
        {open ? (
          <div className="safe-bottom flex max-h-[88dvh] flex-col gap-2 overflow-y-auto px-4 pb-6 pt-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="t-heading">Admin</h2>
              <button type="button" onClick={() => setOpenOn(null)} className="press inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 font-semibold hover:bg-surface">
                Close
              </button>
            </div>
            <MenuPanel menu={menu} pathname={pathname} inputRef={sheetSearch} idPrefix="sheet" onNavigate={() => setOpenOn(null)} />
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
