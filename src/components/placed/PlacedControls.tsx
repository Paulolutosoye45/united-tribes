"use client";

import { useEffect, useState } from "react";
import { placedHoldAction, placedHoldClearAction, placedPauseAction, placedRecordAction, placedRevealAction } from "@/app/(app)/admin/placed/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { BOARD_WORDS as W, DESK_WORDS as D, OUTCOMES, timeLeft, windowLabel, type DeskRow, type Outcome } from "@/lib/placement/answers";

const FIELD = "h-12 w-full min-w-0 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

/** Pause the sequence for everyone, or let it carry on. Needs a reason, which is kept in the log. Emails already sent stay sent. */
export function PlacedPause({ paused }: { paused: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2" data-testid="placed-pause">
      {open ? (
        <div className="flex flex-col gap-2 sm:max-w-md">
          {paused ? null : (
            <>
              <label htmlFor="placed-pause-reason" className="text-[0.95rem] font-medium">{W.pauseReason}</label>
              <input id="placed-pause-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              size="md"
              loading={d.busy === "pause"}
              disabled={!paused && reason.trim().length < 5}
              onClick={() => void d.go("pause", () => placedPauseAction(!paused, reason), { after: () => { setOpen(false); setReason(""); } })}
            >
              {paused ? W.resume : W.pause}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="md" variant="quiet" onClick={() => { d.clear(); setOpen(true); }}>{paused ? W.resume : W.pause}</Button>
        </div>
      )}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** "Hold this seat" for a few days, with a reason, or "Let the emails resume". The seat itself is never touched. */
export function HoldControl({ tm, name, held }: { tm: string; name: string; held: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("3");
  const [reason, setReason] = useState("");
  if (held) {
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="ghost" loading={d.busy === tm} onClick={() => void d.go(tm, () => placedHoldClearAction(tm))} aria-label={`${W.rowActions.unhold}: ${name}`}>
          {W.rowActions.unhold}
        </Button>
        <Notice error={d.error} />
      </div>
    );
  }
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => { d.clear(); setOpen(true); }} aria-label={`${W.rowActions.hold}: ${name}`}>
        {W.rowActions.hold}
      </Button>
    );
  }
  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      <label htmlFor={`hold-days-${tm}`} className="t-small font-medium">{W.holdDays}</label>
      <select id={`hold-days-${tm}`} value={days} onChange={(e) => setDays(e.target.value)} className={FIELD}>
        {[1, 2, 3, 5, 7, 14].map((n) => (
          <option key={n} value={n}>{n === 1 ? "1 day" : `${n} days`}</option>
        ))}
      </select>
      <label htmlFor={`hold-why-${tm}`} className="t-small font-medium">{W.holdWhy}</label>
      <input id={`hold-why-${tm}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
      <div className="flex gap-2">
        <Button size="sm" loading={d.busy === tm} disabled={reason.trim().length < 5} onClick={() => void d.go(tm, () => placedHoldAction(tm, Number(days), reason), { after: () => setOpen(false) })}>
          {W.rowActions.hold}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/**
 * One member on the call desk. The number is hidden until Show number is pressed (the database writes down that it was shown, never the number), and it
 * hides itself again after a minute and a half. Outside 8 am to 8 pm Lagos time the button is not offered. A member who chose a time of day asks for a
 * second, deliberate press when it is not that time.
 */
export function DeskCard({ row, maxTries, callsOk }: { row: DeskRow; maxTries: number; callsOk: boolean }) {
  const d = useDo();
  const [number, setNumber] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [followup, setFollowup] = useState("");

  useEffect(() => {
    if (!number) return;
    const t = window.setTimeout(() => setNumber(null), 90_000);
    return () => window.clearTimeout(t);
  }, [number]);

  async function reveal() {
    if (showing) return;
    setShowing(true);
    setProblem(null);
    try {
      const r = await placedRevealAction(row.tm, !row.inWindow);
      if (r.ok) setNumber(r.number);
      else setProblem(r.message);
    } catch {
      setProblem("We couldn’t get that number. Check your connection and try again.");
    }
    setShowing(false);
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <li className="card flex flex-col gap-3 p-4" data-testid="desk-row" data-tm={row.tm}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-semibold">{row.name}</p>
        <p className="t-small text-soft">{row.tribe}</p>
      </div>
      <p className="t-small text-soft">
        {D.tries(row.tries, maxTries)}
        {row.lastOutcome ? ` · last: ${row.lastOutcome.replace(/_/g, " ")}` : ""}
        {row.window ? ` · ${D.outsideWindow(windowLabel(row.window))}` : ""}
        {row.topic === "other_tribe" ? ` · ${D.topicOther}` : ""}
        {row.hoursLeft !== null ? ` · ${timeLeft(row.hoursLeft)} left` : ""}
        {` · ${row.opened ? D.opened : D.notOpened}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {number ? (
          <a href={`tel:${number.replace(/[^+\d]/g, "")}`} className="text-lg font-semibold underline underline-offset-4" data-testid="desk-number">
            {number}
          </a>
        ) : (
          <>
            <span className="font-mono text-[0.95rem]" data-testid="desk-mask">{row.mask ?? D.noMask}</span>
            {row.mask && callsOk ? (
              <Button size="sm" variant="quiet" loading={showing} onClick={() => void reveal()} data-testid="desk-show">
                {row.inWindow ? D.show : D.showAnyway}
              </Button>
            ) : null}
          </>
        )}
      </div>
      {problem ? <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">{problem}</p> : null}

      <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
        <legend className="t-small mb-1 font-medium">{D.record}</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <label key={o.key} className="flex min-h-11 items-start gap-3 py-1">
              <input type="radio" name={`outcome-${row.tm}`} value={o.key} checked={outcome === o.key} onChange={() => setOutcome(o.key)} className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" />
              <span className="flex flex-col">
                <span className="font-medium">{o.label}</span>
                <span className="t-small text-soft">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        {outcome === "needs_time" ? (
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor={`follow-${row.tm}`} className="t-small font-medium">{D.followup}</label>
            <input id={`follow-${row.tm}`} type="date" min={today} value={followup} onChange={(e) => setFollowup(e.target.value)} className={FIELD} />
          </div>
        ) : null}
        <div>
          <Button
            size="md"
            loading={d.busy === row.tm}
            disabled={!outcome || (outcome === "needs_time" && !followup)}
            onClick={() => void d.go(row.tm, () => placedRecordAction(row.tm, outcome, outcome === "needs_time" ? followup : null), { saved: D.saved, after: () => { setNumber(null); setOutcome(""); setFollowup(""); } })}
            data-testid="desk-save"
          >
            {D.save}
          </Button>
        </div>
        <Notice error={d.error} saved={d.saved} />
      </fieldset>
    </li>
  );
}
