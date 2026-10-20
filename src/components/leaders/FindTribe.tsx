"use client";

import { Note, StepHeading } from "@/components/intake/ui";
import { cn } from "@/lib/cn";
import {
  FIT_BACKUP_HINT,
  FIT_CHANGE_NOTE,
  FIT_FEW,
  FIT_HINT,
  FIT_NONE,
  FIT_TITLE,
  matchText,
  type FitOption,
  type FitView,
} from "@/lib/leaders/fit";

export type FindTribeProps = {
  status: "idle" | "loading" | "ready" | "failed";
  view: FitView | null;
  /** The tribe picked now (a Season Goal id), or null. */
  chosen: string | null;
  backups: string[];
  onChoose: (goalId: string) => void;
  onBackup: (goalId: string, on: boolean) => void;
  onRetry: () => void;
  error: string | null;
};

/**
 * "Find your tribe": the three tribes the leader's answers suit best, each with a match word, a percentage and a few plain reasons,
 * and every other tribe under its community. The leader chooses one and may add up to two backups. Nothing here compares anything:
 * the database did, and this shows what it was willing to show a leader.
 */
export function FindTribe({ status, view, chosen, backups, onChoose, onBackup, onRetry, error }: FindTribeProps) {
  if (status === "loading" || (status === "idle" && !view)) {
    return (
      <>
        <StepHeading title={FIT_TITLE} />
        <p role="status" className="t-body text-soft">
          Looking at the tribes that suit your answers…
        </p>
      </>
    );
  }
  if (status === "failed" || !view) {
    return (
      <>
        <StepHeading title={FIT_TITLE} />
        <div className="flex flex-col items-start gap-4">
          <p role="alert" className="t-body">
            {error ?? "We couldn’t work out your tribes just now."}
          </p>
          <button type="button" className="btn btn-quiet" onClick={onRetry}>
            Try again
          </button>
        </div>
      </>
    );
  }

  const hint = view.top.length === 0 ? FIT_NONE : view.top.length < 3 ? `${FIT_HINT} ${FIT_FEW}` : FIT_HINT;
  const canBack = chosen !== null && backups.length < 2;

  const card = (o: FitOption, opts: { reasons: boolean; i: number }) => {
    const isChosen = chosen === o.goalId;
    const isBackup = backups.includes(o.goalId);
    return (
      <div key={o.goalId} className="flex flex-col gap-1.5" style={{ ["--i" as string]: opts.i }}>
        <label className={cn("choice cursor-pointer items-start", isBackup && "opacity-90")}>
          <input type="radio" name="fitGoal" value={o.goalId} checked={isChosen} onChange={() => onChoose(o.goalId)} className="sr-only" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold leading-snug">{o.title}</span>
              <span className="cmp-tag shrink-0">{matchText(o)}</span>
            </span>
            {o.community ? <span className="t-small block text-soft">{o.community}</span> : null}
            {opts.reasons && o.reasons.length > 0 ? (
              <ul className="t-small mt-2 flex list-disc flex-col gap-0.5 pl-4 text-ink">
                {o.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            {o.note ? <span className="t-small mt-2 block text-soft">{o.note}</span> : null}
          </span>
          <span className="choice-mark mt-0.5" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        </label>
        {chosen !== null && !isChosen ? (
          <label className={cn("t-small flex items-center gap-2 pl-1", isBackup || canBack ? "cursor-pointer text-ink" : "text-soft opacity-60")}>
            <input
              type="checkbox"
              name="fitBackup"
              value={o.goalId}
              checked={isBackup}
              disabled={!isBackup && !canBack}
              onChange={(e) => onBackup(o.goalId, e.target.checked)}
              className="h-4 w-4 accent-[var(--ink)]"
            />
            <span>I would also be glad to lead this one</span>
          </label>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <StepHeading title={FIT_TITLE} hint={hint} />
      {error ? (
        <p role="alert" className="t-small mb-4 text-ink">
          {error}
        </p>
      ) : null}

      {view.top.length > 0 ? (
        <div role="radiogroup" aria-label="Your best matches" className="stagger flex flex-col gap-3">
          {view.top.map((o, i) => card(o, { reasons: true, i }))}
        </div>
      ) : null}

      {view.groups.length > 0 ? (
        <section aria-label="All the other tribes" className="mt-8 flex flex-col gap-3">
          <h2 className="t-small font-semibold text-soft">Or look at the others</h2>
          {view.groups.map((g) => (
            <details key={g.slug} open={g.mine || g.options.some((o) => o.goalId === chosen)} className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
              <summary className="-my-3 cursor-pointer py-3 font-semibold leading-snug">
                {g.community}
                <span className="t-small ml-2 font-normal text-soft">
                  {g.options.length} {g.options.length === 1 ? "tribe" : "tribes"}
                </span>
              </summary>
              <div role="radiogroup" aria-label={g.community} className="mt-3 flex flex-col gap-3">
                {g.options.map((o, i) => card(o, { reasons: false, i }))}
              </div>
            </details>
          ))}
        </section>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        {chosen !== null ? <Note tone="info">{FIT_BACKUP_HINT}</Note> : null}
        <Note>{FIT_CHANGE_NOTE}</Note>
      </div>
    </>
  );
}
