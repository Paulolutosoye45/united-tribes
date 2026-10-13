"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reopenGuardianAction, verifyGuardianAction } from "@/app/(app)/care/teens/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatShortDate, plural } from "@/lib/dates";
import { relationshipLabel } from "@/lib/guardian/consent";
import type { GuardianOverview } from "@/lib/growth/types";

export function TeenDesk({ overview }: { overview: GuardianOverview }) {
  const { to_call, waiting, said_no, tribes_short } = overview;

  return (
    <div className="flex flex-col gap-8">
      {!overview.track_open ? (
        <p role="status" className="t-body rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">
          Tribes for young people are not open yet. Nothing here can happen until the church has settled its safeguarding policy and the track has been opened.
          The steps are in the handbook under Teens.
        </p>
      ) : null}

      <section aria-labelledby="call-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="call-heading" className="t-heading">
            To phone
          </h2>
          <p className="t-small text-soft">The parent or guardian said yes. Phone them on the number or email below, check it was really them, then record that you did.</p>
        </div>
        {to_call.length === 0 ? (
          <p className="t-body text-soft">Nobody is waiting for a call.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {to_call.map((r) => (
              <li key={r.person_id}>
                <CallCard row={r} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
        <h2 id="waiting-heading" className="t-heading">
          Waiting for a parent or guardian
        </h2>
        {waiting.length === 0 ? (
          <p className="t-body text-soft">No link is waiting for an answer.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line p-0">
            {waiting.map((w) => (
              <li key={w.person_id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{w.teen}</span>
                  <span className="t-small text-soft">
                    Asked {w.guardian}, {relationshipLabel(w.relationship).toLowerCase()} · {formatShortDate(w.requested_at)}
                  </span>
                </span>
                {w.expired ? <Badge tone="outline">Link expired</Badge> : <Badge tone="neutral">Waiting</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {said_no.length > 0 ? (
        <section aria-labelledby="no-heading" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="no-heading" className="t-heading">
              Said no
            </h2>
            <p className="t-small text-soft">The young person cannot ask again by themselves. If the family has talked and the parent or guardian wants to start again, open it up here.</p>
          </div>
          <ul className="card flex flex-col divide-y divide-line p-0">
            {said_no.map((n) => (
              <NoRow key={n.person_id} row={n} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="short-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="short-heading" className="t-heading">
            Tribes that need a second adult
          </h2>
          <p className="t-small text-soft">A tribe with a young person in it must always have two adults. These have only one.</p>
        </div>
        {tribes_short.length === 0 ? (
          <p className="t-body text-soft">Every tribe with young people in it has two adults.</p>
        ) : (
          <ul className="card flex flex-col divide-y divide-line p-0">
            {tribes_short.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span className="font-medium">{c.name}</span>
                <Badge tone="flame">{plural(c.members, "young person", "young people")}, one adult</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="t-small text-soft">{plural(overview.ready, "young person", "young people")} cleared to be placed.</p>
    </div>
  );
}

function CallCard({ row }: { row: GuardianOverview["to_call"][number] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await verifyGuardianAction(row.person_id, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <article className="card flex flex-col gap-4 p-5" aria-label={row.teen}>
      <div>
        <h3 className="font-semibold">{row.teen}</h3>
        <p className="t-small text-soft">
          {row.guardian}, {relationshipLabel(row.relationship).toLowerCase()} · said yes {formatShortDate(row.answered_at)}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        {row.phone ? (
          <div>
            <dt className="t-small text-soft">Phone</dt>
            <dd className="font-semibold">
              <a href={`tel:${row.phone}`} className="underline underline-offset-4">
                {row.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {row.email ? (
          <div>
            <dt className="t-small text-soft">Email</dt>
            <dd className="break-all font-semibold">{row.email}</dd>
          </div>
        ) : null}
      </dl>
      {row.note ? (
        <p className="t-body rounded-[var(--radius-control)] bg-surface px-4 py-3">
          <span className="t-small block text-soft">They wrote</span>
          {row.note}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Input label="Note about the call" optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} hint="For example, who you spoke to and when. Kept on the record." />
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="sm" loading={busy}>
            I have spoken to them, and it was them
          </Button>
        </div>
      </form>
    </article>
  );
}

function NoRow({ row }: { row: GuardianOverview["said_no"][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await reopenGuardianAction(row.person_id);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{row.teen}</span>
        <span className="t-small text-soft">
          {row.status === "withdrawn" ? "Took permission back" : "Said no"} · {formatShortDate(row.answered_at)}
        </span>
        {error ? (
          <span role="alert" className="t-small text-danger">
            {error}
          </span>
        ) : null}
      </span>
      <Button size="sm" variant="quiet" loading={busy} onClick={() => void reopen()}>
        Let them ask again
      </Button>
    </li>
  );
}
