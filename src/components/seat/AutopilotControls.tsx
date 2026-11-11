"use client";

import { useState } from "react";
import { autopilotApproveAction, autopilotPauseAction } from "@/app/(app)/admin/seats/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { AUTOPILOT_WORDS as W } from "@/lib/seat/autopilot";

const FIELD = "h-12 w-full min-w-0 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

/** The one tap that places today's plan. The database checks the plan is today's and not yet placed, that every check is green, and each person once more. */
export function AutopilotApprove({ plan, count }: { plan: string; count: number }) {
  const d = useDo();
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="autopilot-approve">
      <p className="t-body max-w-[64ch]">{W.ready(count)}</p>
      <div>
        <Button
          size="md"
          loading={d.busy === "approve"}
          onClick={() =>
            void d.go(
              "approve",
              async () => {
                const r = await autopilotApproveAction(plan);
                if (r.ok) setSaid(W.placed(r.placed, r.skipped));
                return r.ok ? { ok: true } : r;
              },
            )
          }
        >
          {d.busy === "approve" ? W.placing : W.place}
        </Button>
      </div>
      {said ? <p role="status" className="t-small font-medium">{said}</p> : null}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** Stops autopilot, or starts it again. Needs a reason, which is kept in the log. Starting again needs none. */
export function AutopilotPause({ paused }: { paused: boolean }) {
  const d = useDo();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const label = paused ? W.start : W.stop;
  return (
    <div className="flex flex-col gap-2" data-testid="autopilot-pause">
      {open ? (
        <div className="flex flex-col gap-2 sm:max-w-md">
          {paused ? null : (
            <>
              <p className="t-small text-soft">{W.stopHelp}</p>
              <label htmlFor="autopilot-pause-reason" className="text-[0.95rem] font-medium">{W.reasonLabel}</label>
              <input id="autopilot-pause-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={FIELD} />
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              size="md"
              loading={d.busy === "pause"}
              disabled={!paused && reason.trim().length < 5}
              onClick={() => void d.go("pause", () => autopilotPauseAction(!paused, reason), { after: () => { setOpen(false); setReason(""); } })}
            >
              {W.confirm}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setOpen(false)}>{W.cancel}</Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="md" variant="quiet" onClick={() => { d.clear(); setOpen(true); }}>{label}</Button>
        </div>
      )}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
