"use client";

import { useState } from "react";
import { closeCallbackAction } from "@/app/(app)/care/referees/actions";
import { Notice } from "@/components/admin/Notice";
import { showContact } from "@/components/admin/referees/PreviewList";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import type { CallbackRow } from "@/lib/leaders/referee/types";

const WHY: Record<CallbackRow["reason"], string> = {
  flagged: "Held back for a look",
  sample: "Picked at random",
  disowned: "Said it wasn’t theirs",
};

/** The care team's calls. Each one ends in one of three answers; "not reached" keeps it open for another try, three in all. */
export function CallbackQueue({ rows }: { rows: CallbackRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="card t-body p-6 text-soft" data-testid="callbacks-empty">
        No call-backs are waiting. They appear here when a reference is held back or picked at random.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="callbacks">
      {rows.map((r) => (
        <Callback key={r.id} row={r} />
      ))}
    </ul>
  );
}

function Callback({ row }: { row: CallbackRow }) {
  const run = useDo();
  const [note, setNote] = useState("");
  const phone = row.kind === "phone" ? normaliseWhatsapp(row.contact) : null;

  const finish = (outcome: "confirmed" | "not_reached" | "not_them", saved: string) => run.go(outcome, () => closeCallbackAction(row.id, outcome, note), { saved });

  return (
    <li className="card flex flex-col gap-4 p-5" data-testid="callback">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold">{row.referee}</p>
          <p className="t-small text-soft">
            {row.relationship} of {row.applicant}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{WHY[row.reason]}</Badge>
          {row.overdue ? <Badge tone="flame">Late</Badge> : <span className="t-small text-soft">Due {formatShortDate(row.dueOn)}</span>}
        </div>
      </div>
      <p className="t-small">
        {row.kind === "email" ? "Email" : "Phone"}:{" "}
        {row.kind === "email" ? (
          <a className="font-semibold text-accent underline underline-offset-4" href={`mailto:${row.contact}`}>
            {row.contact}
          </a>
        ) : (
          <>
            <strong className="font-semibold">{showContact(row.contact)}</strong>
            {phone ? (
              <>
                {" · "}
                <a className="font-semibold text-accent underline underline-offset-4" href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
                  Open WhatsApp
                </a>
              </>
            ) : null}
          </>
        )}
        {row.attempts > 0 ? <span className="text-soft"> · tried {row.attempts} {row.attempts === 1 ? "time" : "times"}</span> : null}
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`cb-note-${row.id}`} className="t-small font-medium">
          A note, if it helps <span className="font-normal text-soft">(optional)</span>
        </label>
        <input
          id={`cb-note-${row.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          className="h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-4 text-base focus:border-ink focus:outline-none"
        />
      </div>
      <Notice error={run.error} saved={run.saved} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="md" loading={run.busy === "confirmed"} disabled={run.busy !== null} onClick={() => void finish("confirmed", "Recorded: they confirmed it.")} data-testid="cb-confirmed">
          They said it was theirs
        </Button>
        <Button size="md" variant="quiet" loading={run.busy === "not_reached"} disabled={run.busy !== null} onClick={() => void finish("not_reached", "Recorded. It stays on the list for another try.")} data-testid="cb-not-reached">
          Couldn’t reach them
        </Button>
        <Button size="md" variant="ghost" className="text-danger" loading={run.busy === "not_them"} disabled={run.busy !== null} onClick={() => void finish("not_them", "Recorded. The reference is left out and a pastor is told.")} data-testid="cb-not-them">
          They said it wasn’t them
        </Button>
      </div>
    </li>
  );
}
