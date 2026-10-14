"use client";

import { useState } from "react";
import { Notice } from "@/components/admin/Notice";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { useRouter } from "next/navigation";
import type { Batch } from "@/lib/leaders/referee/types";

/** The recent uploads. The latest can be undone, which puts the list back exactly as it was; older ones are a record. */
export function ImportHistory({ batches }: { batches: Batch[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (batches.length === 0) return null;

  async function undo(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/referees/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch: id }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !body?.ok) setError(body?.message ?? "We couldn’t undo that. Try again in a moment.");
      else router.refresh();
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    }
    setBusy(null);
  }

  return (
    <section aria-labelledby="history-h" className="flex flex-col gap-3" data-testid="history">
      <h2 id="history-h" className="t-heading">
        Earlier uploads
      </h2>
      <Notice error={error} />
      <ul className="flex flex-col gap-2">
        {batches.map((b) => (
          <li key={b.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="break-words font-semibold">{b.filename ?? "A file"}</p>
              <p className="t-small text-soft">
                {formatLagosDay(b.at)}, {formatLagosTime(b.at)}
                {b.by ? ` · ${b.by}` : ""} · {b.mode === "replace" ? "replaced the list" : "added and updated"}
              </p>
              <p className="t-small text-soft">
                {b.added} added · {b.updated} updated · {b.retired} taken off{b.errors ? ` · ${b.errors} left out` : ""}
              </p>
            </div>
            {b.status === "undone" ? (
              <Badge tone="outline">Undone</Badge>
            ) : b.canUndo ? (
              <Button size="sm" variant="quiet" loading={busy === b.id} onClick={() => void undo(b.id)}>
                Undo
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
