"use client";

import { withdrawAction } from "@/app/(app)/exports/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FORMAT_NAMES } from "@/lib/exports/registry";
import { PURPOSES } from "@/lib/exports/purposes";
import type { MyExport } from "@/lib/exports/types";
import { STATUS_WORDS, lagosWhen } from "@/lib/exports/wording";

/** The person's own files of the last 30 days. A link still open can be deleted now; nothing else is kept to delete. */
export function MyExportsList({ items }: { items: MyExport[] }) {
  const d = useDo();
  const open = items.filter((i) => i.active);
  const earlier = items.filter((i) => !i.active);

  function Row({ e }: { e: MyExport }) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid="my-export">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{e.name}</span>
            <Badge tone="outline">{FORMAT_NAMES[e.format]}</Badge>
            {e.lane === "people" ? <Badge tone="neutral">People</Badge> : null}
            {e.rehearsal ? <Badge tone="gold">Rehearsal</Badge> : null}
          </div>
          <p className="t-small text-soft">
            {lagosWhen(e.at)}
            {e.purpose ? ` · ${PURPOSES[e.purpose]}` : ""}
            {e.status === "delivered" && e.rows !== null ? ` · ${e.rows.toLocaleString("en")} ${e.rows === 1 ? "row" : "rows"}` : ""}
            {` · ${e.active && e.status !== "delivered" ? "Link still open" : STATUS_WORDS[e.status] ?? e.status}`}
            {e.active && e.expires_at ? ` · link ends ${lagosWhen(e.expires_at)}` : ""}
          </p>
        </div>
        {e.active ? (
          <Button size="sm" variant="ghost" loading={d.busy === e.id} disabled={d.busy !== null} onClick={() => void d.go(e.id, () => withdrawAction(e.id), { saved: "Deleted. The link no longer works." })}>
            Delete now
          </Button>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-8" data-testid="my-exports">
      <Notice error={d.error} saved={d.saved} />
      {items.length === 0 ? (
        <p className="card t-body p-6 text-soft" data-testid="my-exports-empty">
          You have not made a file in the last 30 days.
        </p>
      ) : null}
      {open.length > 0 ? (
        <section aria-labelledby="open-heading" className="flex flex-col gap-3">
          <h2 id="open-heading" className="t-heading">
            Links still open
          </h2>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {open.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ) : null}
      {earlier.length > 0 ? (
        <section aria-labelledby="earlier-heading" className="flex flex-col gap-3">
          <h2 id="earlier-heading" className="t-heading">
            Earlier
          </h2>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {earlier.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
