"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type Ref } from "react";
import { cn } from "@/lib/cn";
import { pageFor, searchPages, type MenuPage, type MenuSection } from "@/lib/admin/nav";

/** The count beside a page. Spoken as "2 waiting"; shown as the number. */
function Count({ n, active }: { n: number; active: boolean }) {
  if (n <= 0) return null;
  return (
    <>
      <span aria-hidden="true" className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", active ? "bg-gold text-on-flame" : "bg-flame text-on-flame")}>
        {n > 99 ? "99+" : n}
      </span>
      <span className="sr-only">{n} waiting</span>
    </>
  );
}

function PageLink({ page, active, onNavigate, detail = false }: { page: MenuPage; active: boolean; onNavigate?: () => void; detail?: boolean }) {
  return (
    <Link
      href={page.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      data-testid={`menu-${page.href.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "today"}`}
      className={cn(
        "press flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-[0.95rem] leading-snug transition-colors",
        active ? "bg-ink font-semibold text-page" : "text-ink hover:bg-surface",
      )}
    >
      <span className="min-w-0 flex-1">
        <span>{page.label}</span>
        {page.tag ? <span className={cn("ml-2 text-xs font-normal", active ? "text-page/80" : "text-soft")}>in {page.tag}</span> : null}
        {detail ? <span className={cn("block text-[0.82rem] font-normal", active ? "text-page/80" : "text-soft")}>{page.about}</span> : null}
      </span>
      <Count n={page.count} active={active} />
    </Link>
  );
}

/**
 * The search box and the list of pages, for the side of a computer screen and for the sheet on a phone. Typing narrows to the pages that
 * match what the person came to do ("delete account" finds Data requests); Enter opens the best match.
 */
export function MenuPanel({ menu, pathname, onNavigate, inputRef, idPrefix }: { menu: MenuSection[]; pathname: string; onNavigate?: () => void; inputRef?: Ref<HTMLInputElement>; idPrefix: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const here = pageFor(pathname)?.href;
  const all = menu.flatMap((s) => s.pages);
  const typed = query.trim().length > 0;
  const results = typed ? searchPages(query, all) : [];
  const listId = `${idPrefix}-results`;

  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-search`} className="sr-only">
          Find an Admin page
        </label>
        <input
          id={`${idPrefix}-search`}
          ref={inputRef}
          type="search"
          value={query}
          autoComplete="off"
          enterKeyHint="go"
          placeholder="Find a page"
          aria-controls={listId}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && typed) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              router.push(results[0].href);
              setQuery("");
              onNavigate?.();
            }
          }}
          className="input"
          style={{ minHeight: "2.75rem" }}
        />
        <p className="t-small px-1 text-soft">
          Type what you came to do, such as “delete account”. Press <kbd className="rounded border border-line px-1">/</kbd> from anywhere.
        </p>
      </div>

      <nav aria-label="Admin menu" id={listId}>
        {typed ? (
          <div className="flex flex-col gap-1">
            <p className="sr-only" role="status">
              {results.length === 0 ? "No page matches." : `${results.length} ${results.length === 1 ? "page" : "pages"} found.`}
            </p>
            {results.length === 0 ? (
              <p className="t-small px-3 py-2 text-soft">No page matches “{query.trim()}”. Try one word, such as “email” or “people”.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {results.map((p) => (
                  <li key={p.href}>
                    <PageLink page={p} active={p.href === here} onNavigate={() => { setQuery(""); onNavigate?.(); }} detail />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {menu.map((s) => (
              <section key={s.key} aria-labelledby={`${idPrefix}-${s.key}`} className="flex flex-col gap-0.5">
                {s.key === "today" ? null : (
                  <h2 id={`${idPrefix}-${s.key}`} className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-soft">
                    {s.label}
                  </h2>
                )}
                <ul className="flex flex-col gap-0.5">
                  {s.pages.map((p) => (
                    <li key={p.href}>
                      <PageLink page={p} active={p.href === here} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </nav>
    </div>
  );
}
