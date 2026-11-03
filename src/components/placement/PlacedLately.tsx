"use client";

import Link from "next/link";
import { undoOneAction } from "@/app/(app)/admin/tribes/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import type { OfficePlacement } from "@/lib/placement/types";

/**
 * What the office placed or moved lately, each with Undo while it can still be undone (until the tribe's leader has been told).
 * `person` fixes the page's person; a tribe's page lists several people and links to each.
 */
export function PlacedLately({ items, person, tribe, empty }: { items: (OfficePlacement & { person?: string })[]; person?: string; tribe?: string; empty: string }) {
  const d = useDo();
  if (items.length === 0) return <p className="t-body text-soft" data-testid="placed-lately-none">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3" data-testid="placed-lately">
        {items.map((p) => {
          const who = p.person ?? person ?? "";
          return (
            <li key={p.run} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={`placed-lately-${p.run}`}>
              <p className="t-body">
                {p.person ? (
                  <Link href={`/admin/people/${p.person}`} className="font-semibold underline underline-offset-4">
                    {p.name}
                  </Link>
                ) : null}
                {p.person ? " " : ""}
                {p.moved ? "moved to" : "placed in"} {p.tribe}
                {p.by ? ` by ${p.by}` : ""}
                {p.at ? <span className="text-soft"> · {formatLagosDay(p.at)}, {formatLagosTime(p.at)}</span> : null}
              </p>
              {p.undoable ? (
                <Button size="md" variant="quiet" loading={d.busy === p.run} onClick={() => void d.go(p.run, () => undoOneAction(p.run, who, tribe), { saved: p.moved ? "Undone. Their old seat is back." : "Undone." })} data-testid={`undo-${p.run}`}>
                  Undo
                </Button>
              ) : (
                <span className="t-small text-soft">The leader has been told, so this can no longer be undone here.</span>
              )}
            </li>
          );
        })}
      </ul>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
