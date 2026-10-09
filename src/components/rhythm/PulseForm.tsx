"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { savePulseAction } from "@/app/(app)/rhythm/actions";
import { SuccessPicture } from "@/components/matching/SuccessPicture";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type { Picture } from "@/lib/rhythm/types";
import { PROGRESS_LABELS, PULSE_PRIVACY, PULSE_QUESTIONS, SCALE_LABELS } from "@/lib/rhythm/wording";

type Key = "belonging" | "god" | "others" | "life";

function Scale({ name, label, value, labels, onChange }: { name: string; label: string; value: number | null; labels: readonly string[]; onChange: (n: number) => void }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="font-medium leading-snug">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className={cn(
              "press grid min-h-12 cursor-pointer place-items-center rounded-[var(--radius-control)] border-[1.5px] text-lg font-semibold transition-[background-color,border-color,box-shadow] duration-200",
              value === n ? "border-ink bg-gold/40 shadow-[0_0_0_3px_color-mix(in_srgb,var(--crest-gold)_40%,transparent)]" : "border-line bg-raised hover:border-soft",
            )}
          >
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
            <span aria-hidden="true">{n}</span>
            <span className="sr-only">
              {n}, {labels[n - 1]}
            </span>
          </label>
        ))}
      </div>
      <div className="t-small flex justify-between text-soft" aria-hidden="true">
        <span>{labels[0]}</span>
        <span>{labels[4]}</span>
      </div>
    </fieldset>
  );
}

/** The three short check-ins (weeks 1, 6 and 12): belonging, then how close the circle is to each line of its Success Picture. */
export function PulseForm({ week, weeks, picture, onDone }: { week: number; weeks: number; picture: Picture; onDone: (week: number) => void }) {
  const router = useRouter();
  const [a, setA] = useState<Record<Key, number | null>>({ belonging: null, god: null, others: null, life: null });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = week === 1 ? "Where are you starting?" : week === weeks ? "How did the season end?" : "Halfway check-in";

  async function save() {
    if (!a.belonging || !a.god || !a.others || !a.life) return setError("Answer all four questions, from 1 to 5.");
    setBusy(true);
    setError(null);
    const result = await savePulseAction(week, { belonging: a.belonging, god: a.god, others: a.others, life: a.life }, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    // The page stops offering the check-in once it is answered, so the thanks lives one level up (PulseSlot).
    onDone(week);
    router.refresh();
  }

  return (
    <section id="pulse" aria-labelledby="pulse-heading" className="card flex scroll-mt-24 flex-col gap-6 p-5 sm:p-8">
      <div className="flex flex-col gap-2">
        <h2 id="pulse-heading" className="t-heading">
          {title}
        </h2>
        <p className="t-small text-soft">{PULSE_QUESTIONS.intro}</p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Scale name="belonging" label={PULSE_QUESTIONS.belonging} value={a.belonging} labels={SCALE_LABELS} onChange={(n) => setA({ ...a, belonging: n })} />
        <div className="flex flex-col gap-1">
          <p className="t-small text-soft">Your Tribe’s Success Picture. How close are you to each line today?</p>
          <SuccessPicture god={picture.god} others={picture.others} life={picture.life} tone="light" />
        </div>
        <Scale name="god" label="Loving God" value={a.god} labels={PROGRESS_LABELS} onChange={(n) => setA({ ...a, god: n })} />
        <Scale name="others" label="Loving Others" value={a.others} labels={PROGRESS_LABELS} onChange={(n) => setA({ ...a, others: n })} />
        <Scale name="life" label="Loving Life" value={a.life} labels={PROGRESS_LABELS} onChange={(n) => setA({ ...a, life: n })} />
        <Textarea label="Anything you want your leader to know?" name="note" optional rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="!min-h-24" />
        <p className="t-small text-soft">{PULSE_PRIVACY}</p>
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" size="md" loading={busy}>
            Send my answers
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Holds the check-in and, once it is answered and the page no longer offers it, a short thank-you in its place. */
export function PulseSlot({ pulseWeek, weeks, picture }: { pulseWeek: number | null; weeks: number; picture: Picture }) {
  const [answered, setAnswered] = useState(false);
  if (pulseWeek !== null) return <PulseForm key={pulseWeek} week={pulseWeek} weeks={weeks} picture={picture} onDone={() => setAnswered(true)} />;
  if (!answered) return null;
  return (
    <section id="pulse" className="card flex scroll-mt-24 flex-col gap-2 p-5 sm:p-7" aria-live="polite">
      <h2 className="t-heading">Thank you.</h2>
      <p className="t-body text-soft">Your answers are saved. They help your leader care for the Tribe.</p>
    </section>
  );
}
