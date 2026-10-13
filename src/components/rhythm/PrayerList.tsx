"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { answerPrayerAction, removePrayerAction } from "@/app/(app)/rhythm/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { LogExtras } from "@/lib/rhythm/types";

/** The tribe's private prayer list: pray through it before the meeting, and mark what God has answered. */
export function PrayerList({ extras, canEdit }: { extras: LogExtras; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, job: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(id);
    setError(null);
    const result = await job();
    setBusy(null);
    if (!result.ok) return setError(result.message ?? "Something went wrong. Please try again.");
    setOpen(null);
    setNote("");
    router.refresh();
  }

  if (extras.prayer_list.length === 0 && extras.answered.length === 0) return null;

  return (
    <section aria-labelledby="prayer-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="prayer-heading" className="t-heading">
          Your tribe’s prayer list
        </h2>
        <p className="t-small text-soft">Only you, your assistant and your coach can see this. Pray through it before the meeting.</p>
      </div>

      {extras.prayer_list.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {extras.prayer_list.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="t-body break-words">{p.body}</p>
                  <p className="t-small text-soft">Week {p.week}</p>
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="solid" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                      Answered
                    </Button>
                    <Button size="sm" variant="ghost" loading={busy === `rm-${p.id}`} onClick={() => void run(`rm-${p.id}`, () => removePrayerAction(p.id))}>
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
              {open === p.id ? (
                <form
                  noValidate
                  className="flex flex-col gap-3 border-t border-line pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(p.id, () => answerPrayerAction(p.id, note));
                  }}
                >
                  <Input label="What happened?" name={`answer-${p.id}`} optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} hint="This is shared as a celebration with your team." />
                  <div>
                    <Button type="submit" size="sm" loading={busy === p.id}>
                      Mark as answered
                    </Button>
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-body text-soft">Nothing is on the list right now.</p>
      )}

      {extras.answered.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h3 className="font-semibold">Answered recently</h3>
          <ul className="t-small flex flex-col gap-1.5 text-soft">
            {extras.answered.map((a) => (
              <li key={a.id}>
                {a.body}
                {a.note ? <> — <span className="text-ink">{a.note}</span></> : null} <span>({formatShortDate(a.answered_at)})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
