"use client";

import Link from "next/link";
import { useState } from "react";
import { leaveTribeAction } from "@/app/(app)/tribe/actions";
import { Notice } from "@/components/admin/Notice";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { LEAVE_REASONS, LEAVE_WORDS as W, type LeaveReason, type LeaveState } from "@/lib/seat/seat";

/**
 * "I need to leave this tribe", for the first two weeks of the season. It is deliberately quiet: a link at the foot of the page that opens one question, with a
 * reason that is optional and chosen from a short list. Leaving is the member's own right, so nothing here argues with them or asks them to be sure twice.
 */
export function LeaveTribeCard({ leave }: { leave: LeaveState }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState<LeaveReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!leave.can && !done) return null;

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await leaveTribeAction(why);
    setBusy(false);
    if (!r.ok) return setError(r.later ? W.later : r.message);
    setDone(r.tribe);
  }

  if (done) {
    return (
      <section aria-live="polite" className="card flex flex-col gap-3 p-5" data-testid="left-tribe">
        <p className="t-body">{W.done(done)}</p>
        <div>
          <Link href="/tribe" className={buttonClasses({ size: "md" })}>{W.look}</Link>
        </div>
      </section>
    );
  }
  if (!open) {
    return (
      <p className="t-small text-soft">
        <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)} data-testid="leave-open">{W.open}</button>
      </p>
    );
  }
  return (
    <section aria-labelledby="leave-h" className="card flex flex-col gap-4 p-5" data-testid="leave-card">
      <div className="flex flex-col gap-1">
        <h2 id="leave-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.intro(leave.tribe, leave.until)}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="t-small font-medium">{W.ask}</legend>
        {LEAVE_REASONS.map((r) => (
          <Choice key={r.key} name="why" value={r.key} checked={why === r.key} onChange={() => setWhy(why === r.key ? null : r.key)} title={r.label} />
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button size="md" loading={busy} onClick={() => void go()}>{W.confirm}</Button>
        <Button size="md" variant="quiet" onClick={() => setOpen(false)}>{W.keep}</Button>
      </div>
      <Notice error={error} saved={null} />
    </section>
  );
}
