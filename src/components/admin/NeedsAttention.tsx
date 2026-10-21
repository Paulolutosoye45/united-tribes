"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { Role } from "@/lib/auth/roles";
import { ageText, hatLabel, hatsOf, rememberedHat, rowText, rowsFor, type AttentionRow, type Hat } from "@/lib/admin/today";

// The hat a person last chose, kept on this device. If the browser will not keep it, it is kept for as long as the page is open.
const KEY = "ut-admin-hat";
const listeners = new Set<() => void>();
let memory: string | null = null;

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}
function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}
function write(value: string) {
  memory = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // kept in memory only
  }
  listeners.forEach((l) => l());
}

/**
 * What is waiting, one row for each kind of work, most urgent first. Someone who holds more than one role sees one list with a small tag
 * for the role each row belongs to, and a row of chips ("Everything · Admin · Pastor") to look at one hat at a time.
 */
export function NeedsAttention({ rows, roles }: { rows: AttentionRow[]; roles: Role[] }) {
  const hats = hatsOf(roles);
  const remembered = useSyncExternalStore(subscribe, read, () => null);
  const hat: Hat = rememberedHat(remembered, roles);
  const shown = rowsFor(rows, hat);
  const several = hats.length > 1;

  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-4" data-testid="needs-attention">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="attention-heading" className="t-heading">
          Needs attention
        </h2>
        {several ? (
          <div role="group" aria-label="Show the work of" className="flex flex-wrap gap-2">
            {(["all", ...hats] as Hat[]).map((h) => {
              const on = h === hat;
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={on}
                  data-testid={`hat-${h}`}
                  onClick={() => write(h)}
                  className={cn(
                    "press inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[0.95rem] transition-colors",
                    on ? "border-ink bg-ink font-semibold text-page" : "border-line bg-raised text-ink hover:border-soft",
                  )}
                >
                  {h === "all" ? "Everything" : hatLabel(h)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="card t-body p-6" data-testid="nothing-waiting">
          Nothing is waiting for you.
        </p>
      ) : shown.length === 0 ? (
        <p className="card t-body p-6" data-testid="nothing-waiting-hat">
          Nothing is waiting for you as {hat === "all" ? "" : hatLabel(hat as Role).toLowerCase()}. Choose Everything to see the rest.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => {
            const age = ageText(r.oldestDays);
            return (
              <li
                key={r.key}
                data-testid={`attention-${r.key}`}
                className={cn("card flex flex-wrap items-center gap-x-4 gap-y-3 p-4", r.urgent && "border-l-4 border-l-flame")}
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold">{rowText(r)}</p>
                  <p className="t-small flex flex-wrap items-center gap-x-2 gap-y-1 text-soft">
                    {r.urgent ? <Badge tone="flame">Urgent</Badge> : null}
                    {age ? <span>{age}</span> : null}
                    {several
                      ? r.roles.map((role) => (
                          <Badge key={role} tone="outline" className="text-soft">
                            {hatLabel(role)}
                          </Badge>
                        ))
                      : null}
                  </p>
                </div>
                <Link href={r.href} className={buttonClasses({ variant: r.urgent ? "primary" : "quiet", size: "sm" })} style={{ minHeight: "2.75rem" }}>
                  Open<span className="sr-only">: {rowText(r)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
