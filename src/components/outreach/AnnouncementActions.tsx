"use client";

import { useState } from "react";
import { approveBroadcastAction, controlBroadcastAction, rejectBroadcastAction } from "@/app/(app)/admin/announcements/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";

/** Pause, resume or cancel an announcement that is on its way. Anyone not yet sent to is left out if it is cancelled. */
export function SendControls({ id, status, canControl }: { id: string; status: string; canControl: boolean }) {
  const d = useDo();
  const [confirm, setConfirm] = useState(false);
  if (!canControl || !["scheduled", "sending", "paused", "awaiting_approval"].includes(status)) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {status === "paused" ? (
          <Button size="md" loading={d.busy === "resume"} onClick={() => void d.go("resume", () => controlBroadcastAction(id, "resume"), { saved: "It will carry on." })}>
            Carry on sending
          </Button>
        ) : status === "scheduled" || status === "sending" ? (
          <Button variant="quiet" size="md" loading={d.busy === "pause"} onClick={() => void d.go("pause", () => controlBroadcastAction(id, "pause"), { saved: "Paused. Nobody else will be sent to until you carry on." })}>
            Pause
          </Button>
        ) : null}
        {confirm ? (
          <>
            <Button variant="solid" size="md" loading={d.busy === "cancel"} onClick={() => void d.go("cancel", () => controlBroadcastAction(id, "cancel"), { saved: "Cancelled. Nobody not yet sent to will get it." })}>
              Yes, cancel it
            </Button>
            <Button variant="ghost" size="md" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
            Cancel
          </Button>
        )}
      </div>
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}

/** Another person reads what will be sent, then says yes or sends it back with a reason. Never the writer. */
export function ApproveControls({ id, mine }: { id: string; mine: boolean }) {
  const d = useDo();
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  if (mine) return <p className="t-small rounded-[var(--radius-control)] bg-surface px-4 py-3 text-soft">You wrote this one, so someone else has to approve it.</p>;
  return (
    <div className="flex flex-col gap-3">
      {asking ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="t-small font-medium">What should change? The writer will see this.</span>
            <textarea
              className="min-h-[6rem] w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 py-3 text-base focus:border-ink focus:outline-none"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button variant="solid" size="md" disabled={reason.trim().length < 3} loading={d.busy === "reject"} onClick={() => void d.go("reject", () => rejectBroadcastAction(id, reason), { saved: "Sent back with your note." })}>
              Send it back
            </Button>
            <Button variant="ghost" size="md" onClick={() => setAsking(false)}>
              Not yet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button size="lg" loading={d.busy === "approve"} onClick={() => void d.go("approve", () => approveBroadcastAction(id), { saved: "Approved. The people are fixed now and it will go out in the sending hours." })}>
            Approve and send
          </Button>
          <Button variant="quiet" size="lg" onClick={() => setAsking(true)}>
            Send back with a note
          </Button>
        </div>
      )}
      <Notice error={d.error} saved={d.saved} />
    </div>
  );
}
