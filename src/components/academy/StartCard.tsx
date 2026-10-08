"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { startCardAction } from "@/app/(app)/lead/circle/actions";
import { Button } from "@/components/ui/Button";

const PARTS = [
  "Your circle’s name, and who it is for",
  "The tribe and Season Goal it is built on, taken from your application",
  "Your own story with that goal, in two lines",
  "The day, time and zone you meet",
  "A draft Success Picture: Loving God, Loving Others, Loving Life",
];

export function StartCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const result = await startCardAction();
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <section className="card flex flex-col gap-5 p-6 sm:p-8">
      <div className="flex flex-col gap-2">
        <h2 className="t-heading">The page members choose you from</h2>
        <p className="t-body measure text-soft">
          Your Circle Card is how a member decides on your circle. It takes about twenty minutes and saves as you type. You can start now and finish after the Success Picture module.
        </p>
      </div>
      <ul className="t-body flex flex-col gap-2">
        {PARTS.map((p) => (
          <li key={p} className="flex gap-3">
            <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-flame" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button size="lg" loading={busy} onClick={() => void start()} className="sm:px-10">
          Start my Circle Card
        </Button>
      </div>
    </section>
  );
}
