"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveWordDaysAction } from "@/app/(app)/rhythm/actions";
import { Chip } from "@/components/ui/Chip";
import type { WordDays } from "@/lib/dashboard/insight";

const DAYS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * "How many days did you open the Word this week?" One tap, once a week, never shown to anyone as a name.
 * The programme counts how many members keep the habit; the leader sees nothing about it.
 */
export function WordDaysCard({ week, words }: { week: number; words: WordDays }) {
  const router = useRouter();
  const saved = words.weeks.find((w) => w.week === week)?.days ?? null;
  const [days, setDays] = useState<number | null>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const earlier = words.weeks.filter((w) => w.week < week).slice(-3);

  async function save(next: number) {
    setDays(next);
    setBusy(true);
    setError(null);
    setDone(false);
    const result = await saveWordDaysAction(week, next);
    setBusy(false);
    if (!result.ok) {
      setDays(saved);
      return setError(result.message);
    }
    setDone(true);
    router.refresh();
  }

  return (
    <section id="word" aria-labelledby="word-heading" className="card flex scroll-mt-24 flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="word-heading" className="t-heading">
          In the Word this week
        </h2>
        <p className="t-small text-soft">On how many days did you read, listen to or pray with the Word? Be honest: only the programme’s totals use it, never your name.</p>
      </div>
      <div role="group" aria-label="Days in the Word this week" className="flex flex-wrap gap-2">
        {DAYS.map((d) => (
          <Chip key={d} selected={days === d} disabled={busy} onClick={() => void save(d)} className="min-w-11 justify-center" aria-label={`${d} ${d === 1 ? "day" : "days"}`}>
            {d}
          </Chip>
        ))}
      </div>
      <p className="t-small text-soft" aria-live="polite">
        {error ? (
          <span role="alert" className="text-danger">{error}</span>
        ) : busy ? (
          "Saving…"
        ) : days !== null && (done || saved === days) ? (
          `Saved: ${days} ${days === 1 ? "day" : "days"} this week. Tap another number to change it.`
        ) : (
          "Tap a number to save it."
        )}
        {earlier.length > 0 ? ` Earlier weeks: ${earlier.map((w) => `${w.days}`).join(", ")}.` : ""}
      </p>
    </section>
  );
}
