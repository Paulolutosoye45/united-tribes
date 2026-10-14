"use client";

import Link from "next/link";
import { askAllToConfirmAction, askToConfirmAction } from "@/app/(app)/admin/referees/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import type { UnverifiedRow } from "@/lib/leaders/referee/types";

/**
 * References given before referees were checked. They still count, marked "not verified". Asking a referee to confirm is one message
 * to their own phone or email: they confirm it was theirs, or say it wasn't.
 */
export function ConfirmList({ total, rows }: { total: number; rows: UnverifiedRow[] }) {
  const run = useDo();
  const waiting = rows.filter((r) => !r.askedAt && r.reachable).length;
  const notAsked = total - rows.filter((r) => r.askedAt).length;

  return (
    <section aria-labelledby="confirm-h" className="flex flex-col gap-4" data-testid="confirm-list">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-[60ch]">
          <h2 id="confirm-h" className="t-heading">
            References from before the check
          </h2>
          <p className="t-small text-soft">
            {total} {total === 1 ? "reference was" : "references were"} given before referees were checked, for applications still open. They stay valid and are marked “not verified” until the referee confirms. We message them at the contact the applicant gave.
          </p>
        </div>
        {notAsked > 0 ? (
          <Button
            size="md"
            loading={run.busy === "all"}
            onClick={() =>
              void run.go(
                "all",
                async () => {
                  const r = await askAllToConfirmAction();
                  return r.ok ? { ok: true } : r;
                },
                { saved: "We’re asking everyone who hasn’t been asked. The messages go out within a few minutes." },
              )
            }
            data-testid="ask-all"
          >
            Ask everyone to confirm
          </Button>
        ) : null}
      </div>
      <Notice error={run.error} saved={run.saved} />
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4" data-testid="unverified-row">
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {r.referee} <span className="t-small font-normal text-soft">for {r.applicant}</span>
              </p>
              <p className="t-small text-soft">
                {r.relationship}
                {r.masked ? ` · ${r.masked}` : ""}
                {r.answeredAt ? ` · answered ${formatShortDate(r.answeredAt)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {r.askedAt ? <Badge tone="outline">Asked {formatShortDate(r.askedAt)}</Badge> : null}
              {!r.reachable ? <Badge tone="flame">No readable contact</Badge> : null}
              <Button
                size="sm"
                variant="quiet"
                disabled={!r.reachable}
                loading={run.busy === r.id}
                onClick={() => void run.go(r.id, async () => { const x = await askToConfirmAction(r.id); return x.ok ? { ok: true } : x; }, { saved: `We’ve asked ${r.referee}.` })}
              >
                {r.askedAt ? "Ask again" : "Ask to confirm"}
              </Button>
              <Link href={`/review/${r.applicationId}`} className="t-small font-semibold text-accent underline underline-offset-4">
                Open
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {waiting === 0 && rows.length > 0 && notAsked === 0 ? <p className="t-small text-soft">Everyone shown has been asked. They have until they next open the message.</p> : null}
      {total > rows.length ? <p className="t-small text-soft">Showing the first {rows.length} of {total}.</p> : null}
    </section>
  );
}
