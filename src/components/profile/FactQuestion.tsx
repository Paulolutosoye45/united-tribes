"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import type { AnswerAction, Answered, FactOption, Outcome } from "@/lib/profile/types";
import { OUTCOME_WORDS, SPECIAL_ROUTE, WAITING_LINE } from "@/lib/profile/wording";

/** What to say when an answer could not be taken. The database's own words are used when it gave some. */
const FAILURES: Record<string, string> = {
  invalid: "This confirmation has run out. Reload the page to start again.",
  not_asked: "That has already been answered. Thank you.",
  not_applicable: "That does not apply to you.",
  nothing: "We have nothing to confirm there.",
  bad_value: "Choose one of the options.",
  waiting: WAITING_LINE,
  special_route: SPECIAL_ROUTE,
  off: "This is not open yet.",
};

export const failureText = (a: Extract<Answered, { ok: false }>): string => a.message ?? FAILURES[a.reason] ?? "We couldn’t save that. Please try again in a moment.";

type Props = {
  testId: string;
  label: string;
  question: string;
  valueLabel: string;
  options: FactOption[];
  /** Takes one answer to the database. */
  onAnswer: (action: AnswerAction, value: string | null) => Promise<Answered>;
  /** Called after an answer was taken, with how it went. */
  onDone?: (outcome: Outcome) => void;
  /** A change is already waiting for a pastor. */
  waiting?: boolean;
  /** Show the card with its answer buttons greyed out (a rehearsal view). */
  disabled?: boolean;
  /** Where the current value came from, in words ("The church office suggested this. Please check it."). */
  standing?: string;
  /** The person has already confirmed this one: the card offers only "Change it". */
  confirmed?: boolean;
};

/**
 * One question about one fact: is this right? The same card is used behind the private link and on My page. Four answers, and nothing is
 * saved until one is pressed: yes, no (then pick the right one), that is not me, ask me later.
 */
export function FactQuestion({ testId, label, question, valueLabel, options, onAnswer, onDone, waiting, disabled, standing, confirmed }: Props) {
  const [changing, setChanging] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<AnswerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function send(action: AnswerAction, value: string | null) {
    if (busy) return;
    setBusy(action);
    setError(null);
    let out: Answered;
    try {
      out = await onAnswer(action, value);
    } catch {
      out = { ok: false, reason: "unknown", message: "We couldn’t save that. Check your connection and try again." };
    }
    setBusy(null);
    if (out.ok) {
      setOutcome(out.outcome);
      onDone?.(out.outcome);
      return;
    }
    setError(failureText(out));
  }

  if (outcome) {
    const words = OUTCOME_WORDS[outcome];
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" role="status" data-testid={`${testId}-outcome`} data-outcome={outcome}>
        <h2 className="t-heading">{words.title}</h2>
        <p className="t-body text-soft">{words.body}</p>
      </div>
    );
  }

  return (
    <section className="card rise-in flex flex-col gap-5 p-6" aria-labelledby={`${testId}-h`} data-testid={testId}>
      <div className="flex flex-col gap-2">
        <p className="t-small font-semibold uppercase tracking-wide text-soft">{label}</p>
        <h2 id={`${testId}-h`} className="t-heading">
          {question}
        </h2>
        {standing ? <p className="t-small text-soft">{standing}</p> : null}
        {waiting ? (
          <p role="note" className="t-small rounded-[var(--radius-control)] bg-gold/25 px-4 py-3" data-testid={`${testId}-waiting`}>
            {WAITING_LINE}
          </p>
        ) : null}
      </div>

      {changing ? (
        <fieldset className="flex flex-col gap-2" data-testid={`${testId}-options`}>
          <legend className="mb-1 text-[0.95rem] font-medium">Which is right?</legend>
          {options.map((o) => (
            <Choice key={o.value} name={`${testId}-pick`} value={o.value} checked={pick === o.value} onChange={() => setPick(o.value)} title={o.label} description={o.detail ?? undefined} badge={o.label === valueLabel ? "What we have" : undefined} />
          ))}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="lg" loading={busy === "change"} disabled={pick === null || busy !== null || disabled} onClick={() => void send("change", pick)} data-testid={`${testId}-save`}>
              Save this
            </Button>
            <Button size="lg" variant="ghost" disabled={busy !== null} onClick={() => { setChanging(false); setPick(null); setError(null); }}>
              Back
            </Button>
          </div>
        </fieldset>
      ) : confirmed ? (
        <div>
          <Button size="lg" variant="quiet" disabled={busy !== null || disabled || waiting} onClick={() => setChanging(true)} data-testid={`${testId}-change`}>
            Change it
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" fullWidth loading={busy === "yes"} disabled={busy !== null || disabled} onClick={() => void send("yes", null)} data-testid={`${testId}-yes`}>
            Yes, that is right
          </Button>
          <Button size="lg" fullWidth variant="quiet" disabled={busy !== null || disabled} onClick={() => setChanging(true)} data-testid={`${testId}-change`}>
            No, I want to change it
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button size="md" variant="ghost" loading={busy === "not_me"} disabled={busy !== null || disabled} onClick={() => void send("not_me", null)} data-testid={`${testId}-notme`}>
              This is not about me
            </Button>
            <Button size="md" variant="ghost" loading={busy === "later"} disabled={busy !== null || disabled} onClick={() => void send("later", null)} data-testid={`${testId}-later`}>
              Ask me later
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
