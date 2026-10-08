"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { bookInterviewAction, cancelInterviewAction } from "@/app/(app)/lead/actions";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { formatLagosDay, formatLagosTime, lagosDateKey } from "@/lib/dates";

export type Slot = { id: string; starts_at: string; minutes: number; mode: "online" | "in_person"; place: string };
export type InterviewOptions = {
  status: string;
  booked: (Slot & { can_cancel: boolean }) | null;
  open: Slot[];
};

const modeLabel = (m: Slot["mode"]) => (m === "online" ? "Online" : "In person");

export function InterviewPicker({ options }: { options: InterviewOptions }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function book() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const result = await bookInterviewAction(chosen);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setChosen(null);
      router.refresh();
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    const result = await cancelInterviewAction();
    setBusy(false);
    if (!result.ok) setError(result.message);
  }

  if (options.booked) {
    const b = options.booked;
    return (
      <section aria-labelledby="interview-heading" className="flex flex-col gap-3">
        <h2 id="interview-heading" className="t-heading">
          Your interview
        </h2>
        <div className="card flex flex-col gap-4 p-5">
          <div>
            <p className="t-title !text-[1.6rem]">{formatLagosDay(b.starts_at)}</p>
            <p className="t-body mt-1">
              {formatLagosTime(b.starts_at)}, {b.minutes} minutes, {modeLabel(b.mode).toLowerCase()}
            </p>
            <p className="t-small mt-1 break-words text-soft">{b.place}</p>
          </div>
          <p className="t-small text-soft">Two panelists will ask five questions about your story and how you would lead. Come as you are.</p>
          {options.status === "interview_booked" ? (
            b.can_cancel ? (
              <div>
                <Button variant="quiet" size="md" loading={busy} onClick={() => void cancel()}>
                  Cancel and choose another time
                </Button>
              </div>
            ) : (
              <p className="t-small text-soft">It is less than a day away. To change it, message the office.</p>
            )
          ) : null}
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  const days = new Map<string, Slot[]>();
  for (const s of options.open) {
    const key = lagosDateKey(s.starts_at);
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  return (
    <section aria-labelledby="interview-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="interview-heading" className="t-heading">
          Choose your interview time
        </h2>
        <p className="t-small text-soft">20 minutes with two panelists. Times are in Lagos time.</p>
      </div>
      {options.open.length === 0 ? (
        <p className="card t-body p-5 text-soft">No times are open right now. The office adds more soon, and you will see them here.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {[...days.entries()].map(([key, slots]) => (
            <div key={key} role="radiogroup" aria-label={formatLagosDay(slots[0].starts_at)} className="flex flex-col gap-2.5">
              <h3 className="t-small font-semibold text-soft">{formatLagosDay(slots[0].starts_at)}</h3>
              {slots.map((s) => (
                <Choice
                  key={s.id}
                  name="slot"
                  value={s.id}
                  checked={chosen === s.id}
                  onChange={() => setChosen(s.id)}
                  title={formatLagosTime(s.starts_at)}
                  description={`${s.minutes} minutes, ${modeLabel(s.mode).toLowerCase()}`}
                />
              ))}
            </div>
          ))}
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <Button size="lg" disabled={!chosen} loading={busy} onClick={() => void book()}>
            Book this time
          </Button>
        </div>
      )}
    </section>
  );
}
