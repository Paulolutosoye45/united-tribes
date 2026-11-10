"use client";

import { useState } from "react";
import { seatExtendAction, seatGiveBackAction, seatHistoryAction, seatKeepAction, seatPauseAction, seatReleaseNowAction, seatTestSendAction } from "@/app/(app)/admin/seats/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { SEAT_WORDS as W, kindWords, type SeatEvent } from "@/lib/seat/seat";
import { formatLagosDay } from "@/lib/dates";

const FIELD = "h-12 w-full min-w-0 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

/** The buttons on one row of the Seats page. Which ones show depends on where the seat stands; the database decides what is allowed and says why when it is not. */
export function SeatRowActions({ clock, name, flag, extended, canAct }: { clock: string | null; name: string; flag: string; extended: boolean; canAct: boolean }) {
  const d = useDo();
  const [mode, setMode] = useState<"keep" | "release" | "history" | null>(null);
  const [reason, setReason] = useState("");
  const [events, setEvents] = useState<SeatEvent[] | null>(null);
  if (!clock) return <span className="t-small text-soft">–</span>;
  const live = flag === "waiting" || flag === "blocked" || flag === "not_reached";
  const back = flag === "released" || flag === "hard";
  const close = () => {
    setMode(null);
    setReason("");
  };
  return (
    <div className="flex min-w-[13rem] flex-col gap-2" data-clock={clock}>
      <div className="flex flex-wrap gap-1">
        {canAct && live ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { d.clear(); setMode("keep"); }} aria-label={`${W.actions.keep}: ${name}`}>{W.actions.keep}</Button>
            {extended ? null : (
              <Button size="sm" variant="ghost" loading={d.busy === `x${clock}`} onClick={() => void d.go(`x${clock}`, () => seatExtendAction(clock))} aria-label={`${W.actions.extend}: ${name}`}>
                {W.actions.extend}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { d.clear(); setMode("release"); }} aria-label={`${W.actions.release}: ${name}`}>{W.actions.release}</Button>
          </>
        ) : null}
        {canAct && back ? (
          <Button size="sm" variant="ghost" loading={d.busy === `b${clock}`} onClick={() => void d.go(`b${clock}`, () => seatGiveBackAction(clock))} aria-label={`${W.actions.giveBack}: ${name}`}>
            {W.actions.giveBack}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (mode === "history") return close();
            setMode("history");
            setEvents(await seatHistoryAction(clock));
          }}
          aria-label={`${W.actions.history}: ${name}`}
        >
          {W.actions.history}
        </Button>
      </div>
      {mode === "keep" || mode === "release" ? (
        <div className="flex flex-col gap-2">
          <p className="t-small text-soft">{mode === "keep" ? W.keepHelp : W.releaseHelp}</p>
          <label htmlFor={`why-${clock}`} className="t-small font-medium">{W.reasonLabel}</label>
          <input id={`why-${clock}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={d.busy === `r${clock}`}
              disabled={reason.trim().length < 5}
              onClick={() => void d.go(`r${clock}`, () => (mode === "keep" ? seatKeepAction(clock, reason) : seatReleaseNowAction(clock, reason)), { after: close })}
            >
              {W.confirm}
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>{W.cancel}</Button>
          </div>
        </div>
      ) : null}
      {mode === "history" && events ? (
        <ol className="t-small flex flex-col gap-1 text-soft" data-testid="seat-history">
          {events.length === 0 ? <li>–</li> : events.map((e, i) => <li key={i}>{formatLagosDay(e.at)}: {kindWords(e.kind)}{e.by ? ` (${e.by})` : ""}</li>)}
        </ol>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** Pause every clock, or let them run again. Needs a reason, which is kept in the log. */
export function SeatPause({ paused }: { paused: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2" data-testid="seat-pause">
      {open ? (
        <div className="flex flex-col gap-2 sm:max-w-md">
          {paused ? null : (
            <>
              <p className="t-small text-soft">{W.pauseHelp}</p>
              <label htmlFor="seat-pause-reason" className="text-[0.95rem] font-medium">{W.reasonLabel}</label>
              <input id="seat-pause-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button size="md" loading={d.busy === "pause"} disabled={!paused && reason.trim().length < 5} onClick={() => void d.go("pause", () => seatPauseAction(!paused, reason), { after: () => { setOpen(false); setReason(""); } })}>
              {paused ? W.resume : W.pause}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setOpen(false)}>{W.cancel}</Button>
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

/** Sends the person pressing it the three seat emails, with an invented name, to see that email works before anything goes to a member. */
export function SeatTestSend() {
  const d = useDo();
  return (
    <div className="flex flex-col gap-2" data-testid="seat-test-send">
      <div>
        <Button size="md" variant="quiet" loading={d.busy === "test"} onClick={() => void d.go("test", () => seatTestSendAction(), { saved: W.testSent })}>{W.testSend}</Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
