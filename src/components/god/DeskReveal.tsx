"use client";

import { useEffect, useState } from "react";
import { revealNumberAction } from "@/app/(app)/god/leader-desk/actions";
import { Button } from "@/components/ui/Button";
import { DESK_WORDS as W } from "@/lib/god/desk";

/**
 * A phone number with its middle hidden, and a button that opens the full number for this one person. The full number is held only in this screen's memory, hides
 * itself after a minute, and is never put in the address or in any list.
 */
export function DeskReveal({ person, masked, hasNumber }: { person: string; masked: string | null; hasNumber: boolean }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => setFull(null), 60_000);
    return () => clearTimeout(t);
  }, [full]);

  if (!hasNumber) return <span className="t-small text-soft">{W.noNumber}</span>;

  async function show() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await revealNumberAction(person);
      if (!r.ok) setError(r.message);
      else if (r.number) setFull(r.number);
      else setError(W.noNumber);
    } catch {
      setError("We couldn’t open that number. Try again.");
    }
    setBusy(false);
  }

  return (
    <span className="flex flex-col items-start gap-1" data-testid="desk-number">
      {full ? (
        <span className="flex flex-wrap items-center gap-2">
          <a href={`tel:${full}`} className="font-semibold tabular-nums underline" data-testid="desk-number-full">
            {full}
          </a>
          <Button type="button" size="sm" variant="quiet" onClick={() => setFull(null)}>
            {W.hideNumber}
          </Button>
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-soft" aria-label={W.numberHidden}>
            {masked ?? W.numberHidden}
          </span>
          <Button type="button" size="sm" variant="quiet" loading={busy} onClick={() => void show()}>
            {W.showNumber}
          </Button>
        </span>
      )}
      {error ? (
        <span role="alert" className="t-small text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
