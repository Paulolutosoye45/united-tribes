"use client";

import { useState } from "react";
import { decideStageAction } from "@/app/(app)/review/stages/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { lagosWhen } from "@/lib/features/wording";
import type { StageReview } from "@/lib/profile/types";

/** The changes waiting for a pastor, and those decided in the last 30 days. Only a pastor can decide; everyone else who can open this page reads it. */
export function StageReviewList({ reviews, canDecide }: { reviews: StageReview[]; canDecide: boolean }) {
  if (reviews.length === 0) {
    return (
      <p className="card t-body p-5 text-soft" data-testid="stage-reviews-empty">
        Nothing is waiting. When a leader whose tribe has members asks to change their stage of life, it will be here.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="stage-reviews">
      {reviews.map((r) => (
        <Review key={r.id} r={r} canDecide={canDecide} />
      ))}
    </ul>
  );
}

function Review({ r, canDecide }: { r: StageReview; canDecide: boolean }) {
  const d = useDo();
  const [note, setNote] = useState("");
  const pending = r.status === "pending";
  return (
    <li className="card flex flex-col gap-3 p-5" data-testid={`stage-review-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{r.person}</h2>
        <Badge tone={pending ? (r.overdue ? "flame" : "gold") : "outline"}>{pending ? (r.overdue ? "Overdue" : "Waiting") : r.status === "approved" ? "Approved" : "Declined"}</Badge>
      </div>
      <p className="t-body">
        {r.first} asked to change their {r.fact.toLowerCase()} from <strong>{r.oldLabel ?? "what we have"}</strong> to <strong>{r.newLabel ?? "another"}</strong>.
      </p>
      <p className="t-small text-soft">
        {r.tribe ? `${r.tribe}, ${r.members} ${r.members === 1 ? "member" : "members"}. ` : "No tribe started. "}Asked {lagosWhen(r.requestedAt)}
        {pending ? `, to be decided by ${r.dueOn}` : r.decidedAt ? `, decided ${lagosWhen(r.decidedAt)}` : ""}.
      </p>
      {r.note && !pending ? <p className="t-small text-soft">Note: “{r.note}”</p> : null}
      {pending && canDecide ? (
        <div className="flex flex-col gap-3">
          <Input label="A note for the leader (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <Button size="md" variant="solid" loading={d.busy === "yes"} disabled={d.busy !== null} onClick={() => void d.go("yes", () => decideStageAction(r.id, true, note), { saved: "Approved. The tribe’s stage is updated; nobody was moved." })} data-testid={`stage-approve-${r.id}`}>
              Approve
            </Button>
            <Button size="md" variant="quiet" loading={d.busy === "no"} disabled={d.busy !== null} onClick={() => void d.go("no", () => decideStageAction(r.id, false, note), { saved: "Declined. Everything stays as it was." })} data-testid={`stage-decline-${r.id}`}>
              Keep as it is
            </Button>
          </div>
        </div>
      ) : pending ? (
        <p className="t-small text-soft">Only a pastor decides this.</p>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </li>
  );
}
