"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCheckinAction, saveStepAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import type { MyWeekPlaced, Outcome } from "@/lib/rhythm/types";
import { OUTCOME_HINTS, OUTCOME_LABELS, stepSentence, tidyWhen, tidyWill } from "@/lib/rhythm/wording";

const OUTCOMES: Outcome[] = ["done", "partly", "not_yet"];

/** This week's step ("When ..., I will ...") and the Friday check-in on it. */
export function StepCard({ week }: { week: MyWeekPlaced }) {
  const router = useRouter();
  const viewing = week.viewing ?? week.week ?? 1;
  const isCurrent = viewing === week.week;
  const step = week.step;
  const canCheckIn = week.check_in.week === viewing && Boolean(step) && !step?.outcome;

  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(step?.when ?? "");
  const [will, setWill] = useState(step?.will ?? "");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reflection, setReflection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveStep() {
    setBusy(true);
    setError(null);
    const result = await saveStepAction(viewing, tidyWhen(when), tidyWill(will));
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setEditing(false);
    router.refresh();
  }

  async function saveCheckin() {
    if (!outcome) return setError("Choose done, partly or not yet.");
    setBusy(true);
    setError(null);
    const result = await saveCheckinAction(viewing, outcome, reflection);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  const showForm = isCurrent && (!step || editing) && !step?.outcome;

  return (
    <section id="step" aria-labelledby="step-heading" className="card flex scroll-mt-24 flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="step-heading" className="t-heading">
            {isCurrent ? "Your step this week" : `Your step in week ${viewing}`}
          </h2>
          <p className="t-small text-soft">One small thing, tied to a moment you already have. Small enough for your worst day.</p>
        </div>
        {step?.outcome ? <Badge tone={step.outcome === "done" ? "gold" : "neutral"}>{OUTCOME_LABELS[step.outcome]}</Badge> : null}
      </div>

      {showForm ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveStep();
          }}
        >
          <Input
            label="When…"
            name="when"
            value={when}
            maxLength={140}
            autoComplete="off"
            placeholder="I get into the car in the morning"
            onChange={(e) => setWhen(e.target.value)}
          />
          <Input
            label="I will…"
            name="will"
            value={will}
            maxLength={140}
            autoComplete="off"
            placeholder="read one chapter and pray for two minutes"
            onChange={(e) => setWill(e.target.value)}
          />
          {week.guide ? (
            <p className="t-small rounded-[var(--radius-control)] bg-surface-strong p-3 text-soft">
              <span className="font-semibold text-ink">An idea for this week:</span> {week.guide.step_hint}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="md" loading={busy}>
              Save my step
            </Button>
            {editing ? (
              <Button type="button" variant="ghost" size="md" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : step ? (
        <div className="flex flex-col gap-4">
          <p className="step-sentence t-body rounded-[var(--radius-control)] border-l-4 border-gold bg-surface-strong px-4 py-3 text-lg font-medium leading-snug">
            {stepSentence(step.when, step.will)}
          </p>
          {isCurrent && !step.outcome ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Change my step
              </Button>
            </div>
          ) : null}
          {step.reflection ? <p className="t-small text-soft">Your note: {step.reflection}</p> : null}
        </div>
      ) : (
        <p className="t-body text-soft">You did not set a step this week.</p>
      )}

      {canCheckIn ? (
        <form
          id="check-in"
          noValidate
          className="flex scroll-mt-24 flex-col gap-4 border-t border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCheckin();
          }}
        >
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">How did it go?</h3>
            <p className="t-small text-soft">Be honest. “Not yet” is a fine answer, and your leader will help.</p>
          </div>
          <div role="radiogroup" aria-label="How your step went" className="grid gap-2.5 sm:grid-cols-3">
            {OUTCOMES.map((o) => (
              <label
                key={o}
                className={cn(
                  "press flex min-h-[4.25rem] cursor-pointer flex-col justify-center gap-0.5 rounded-[var(--radius-control)] border-[1.5px] px-4 py-3 transition-[background-color,border-color,box-shadow] duration-200",
                  outcome === o ? "border-ink bg-gold/30 shadow-[0_0_0_3px_color-mix(in_srgb,var(--crest-gold)_40%,transparent)]" : "border-line bg-raised hover:border-soft",
                )}
              >
                <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="sr-only" />
                <span className="font-semibold">{OUTCOME_LABELS[o]}</span>
                <span className="t-small text-soft">{OUTCOME_HINTS[o]}</span>
              </label>
            ))}
          </div>
          <Textarea
            label="A line for yourself"
            name="reflection"
            optional
            rows={3}
            maxLength={300}
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            hint="Only you can read this."
            className="!min-h-24"
          />
          {error && !showForm ? (
            <p role="alert" className="t-small text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" size="md" loading={busy}>
              Save my check-in
            </Button>
          </div>
        </form>
      ) : step && !step.outcome ? (
        <p className="t-small border-t border-line pt-4 text-soft">
          {isCurrent && week.check_in.opens_on && week.check_in.opens_on > todayIso()
            ? `Your check-in opens on ${formatDate(week.check_in.opens_on)}.`
            : isCurrent
              ? "Your check-in for this week is not open right now."
              : "The check-in for this week has closed."}
        </p>
      ) : null}
    </section>
  );
}

/** Today in Lagos, as a date string. The check-in opens on a date, so compare dates and not clock times. */
function todayIso(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
