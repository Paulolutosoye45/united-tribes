"use client";

import { useState } from "react";
import { seriesPauseAction, seriesStopAction } from "@/app/(app)/admin/people/contact-gaps/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { OFFICE_SERIES_WORDS as W } from "@/lib/reach/series";

const FIELD = "h-12 w-full min-w-0 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

/** Pause the series for everyone, or let it carry on. Needs a reason, which is kept in the log. */
export function SeriesPause({ paused }: { paused: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-2" data-testid="series-pause">
      {paused ? <p className="t-small font-medium" role="status">{W.paused}</p> : null}
      {open ? (
        <div className="flex flex-col gap-2 sm:max-w-md">
          {paused ? null : (
            <>
              <label htmlFor="pause-reason" className="text-[0.95rem] font-medium">Why? (kept in the log)</label>
              <input id="pause-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              size="md"
              loading={d.busy === "pause"}
              disabled={!paused && reason.trim().length < 5}
              onClick={() => void d.go("pause", () => seriesPauseAction(!paused, reason), { after: () => { setOpen(false); setReason(""); } })}
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

/** Ends the series for one person. */
export function SeriesStop({ personId, name }: { personId: string; name: string }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => { d.clear(); setOpen(true); }} aria-label={`${W.stop}: ${name}`}>
        Stop
      </Button>
    );
  }
  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      <label htmlFor={`stop-${personId}`} className="t-small font-medium">{W.stopReason}</label>
      <input id={`stop-${personId}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
      <div className="flex gap-2">
        <Button size="sm" loading={d.busy === personId} disabled={reason.trim().length < 5} onClick={() => void d.go(personId, () => seriesStopAction(personId, reason), { after: () => setOpen(false) })}>
          {W.stop}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
