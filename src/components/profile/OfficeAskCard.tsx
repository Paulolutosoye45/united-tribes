"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { myOfficeAskAction } from "@/app/(app)/my/actions";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { lagosWhen } from "@/lib/features/wording";
import type { OfficeStatus } from "@/lib/profile/types";
import { OFFICE, SAVE_FAILURES } from "@/lib/profile/wording";

/**
 * "Is your age range not right?": the way for someone whose range the list cannot fix (above all someone who is really under 18) to tell the Care Team.
 * Nothing is changed by pressing the button. Once the message is sent the card says where it stands, and, when the Care Team has looked, what they wrote.
 */
export function OfficeAskCard({ office }: { office: OfficeStatus | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await myOfficeAskAction(note);
      if (out.ok) {
        setSent(true);
        router.refresh();
      } else {
        setError(out.message ?? OFFICE.failures[out.reason] ?? SAVE_FAILURES.unknown);
      }
    } catch {
      setError("We couldn’t send that. Check your connection and try again.");
    }
    setBusy(false);
  }

  const waiting = office?.status === "open" || sent;

  return (
    <section className="card flex flex-col gap-4 p-6" aria-labelledby="my-office-h" data-testid="my-office">
      <h2 id="my-office-h" className="t-heading">
        {OFFICE.heading}
      </h2>
      <p className="t-body text-soft measure">{OFFICE.body}</p>

      {waiting ? (
        <p role="status" className="t-body rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="my-office-status">
          {sent && office?.status !== "open" ? OFFICE.sent : OFFICE.waiting}
          {office?.status === "open" && office.askedAt ? <span className="t-small block text-soft">Sent {lagosWhen(office.askedAt)}.</span> : null}
        </p>
      ) : (
        <>
          {office?.status === "done" ? (
            <p role="status" className="t-body rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="my-office-status">
              {OFFICE.looked}
              {office.note ? <span className="block">{OFFICE.note(office.note)}</span> : null}
              {office.closedAt ? <span className="t-small block text-soft">{lagosWhen(office.closedAt)}.</span> : null}
            </p>
          ) : null}
          {open ? (
            <div className="flex flex-col gap-3">
              <Textarea label={OFFICE.noteLabel} optional className="min-h-24" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint={`${note.length} of 300`} data-testid="my-office-note" />
              <div className="flex flex-wrap gap-3">
                <Button size="lg" loading={busy} disabled={busy} onClick={() => void send()} data-testid="my-office-send">
                  {OFFICE.button}
                </Button>
                <Button size="lg" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button size="lg" variant="quiet" onClick={() => setOpen(true)} data-testid="my-office-open">
                {office?.status === "done" ? "Tell them something else" : OFFICE.button}
              </Button>
            </div>
          )}
        </>
      )}

      {error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid="my-office-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
