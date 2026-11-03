"use client";

import Link from "next/link";
import { useState } from "react";
import { decideRequestAction, requestCheckAction, withdrawRequestAction } from "@/app/(app)/admin/tribes/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { formatShortDate } from "@/lib/dates";
import type { OfficeRequest, OneCheck } from "@/lib/placement/types";

const STATUS_WORDS: Record<OfficeRequest["status"], string> = {
  open: "Waiting for the owner",
  approved: "Approved: placed",
  declined: "Declined",
  withdrawn: "Taken back",
  lapsed: "Lapsed after 7 days",
};

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

/**
 * The requests an admin or a director made to the owner. The owner reads each one, looks again with today's facts (every check is run again),
 * and approves (which places the person as the one who asked) or declines. The person who asked sees only their own, and can take one back.
 */
export function OfficeRequests({ requests, owner, person }: { requests: OfficeRequest[]; owner: boolean; person?: string }) {
  if (requests.length === 0) return <p className="t-body text-soft" data-testid="requests-none">{owner ? "No requests are waiting." : "You have not asked the owner about anyone lately."}</p>;
  return (
    <ul className="flex flex-col gap-4" data-testid="requests">
      {requests.map((r) => (
        <li key={r.id} className="card flex flex-col gap-3 p-4" data-testid={`request-${r.id}`}>
          <Row r={r} owner={owner} person={person} />
        </li>
      ))}
    </ul>
  );
}

function Row({ r, owner, person }: { r: OfficeRequest; owner: boolean; person?: string }) {
  const d = useDo();
  const [look, setLook] = useState<OneCheck | null>(null);
  const [note, setNote] = useState("");
  const open = r.status === "open";

  async function lookAgain() {
    await d.go("look", async () => {
      const x = await requestCheckAction(r.id);
      if (x.ok) setLook(x.check);
      return x.ok ? { ok: true as const } : x;
    });
  }
  async function decide(decision: "approve" | "decline") {
    await d.go(
      decision,
      () => decideRequestAction({ request: r.id, person: r.person, decision, accept: look?.warnings.map((w) => w.code) ?? [], note }).then((x) => (x.ok ? { ok: true as const } : x)),
      { saved: decision === "approve" ? `${r.name} is placed. ${r.askedBy} has been told.` : `Declined. ${r.askedBy} has been told.` },
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-body">
          {owner ? (
            <Link href={`/god/people/${r.person}`} className="font-semibold underline underline-offset-4">
              {r.name}
            </Link>
          ) : (
            <span className="font-semibold">{r.name}</span>
          )}{" "}
          {r.move ? "to move to" : "to place in"} <span className="font-semibold">{r.tribeName}</span>
        </p>
        <Badge tone={open ? "gold" : "neutral"}>{STATUS_WORDS[r.status]}</Badge>
      </div>
      <p className="t-small text-soft">
        {owner ? `Asked by ${r.askedBy} (${r.askedRole}) on ${formatShortDate(r.askedAt)}. ` : `Asked on ${formatShortDate(r.askedAt)}. `}
        {open ? `${daysLeft(r.expiresAt)} ${daysLeft(r.expiresAt) === 1 ? "day" : "days"} left to answer.` : r.decidedAt ? `Answered on ${formatShortDate(r.decidedAt)}.` : ""}
      </p>
      <p className="t-body">“{r.reason}”</p>
      {r.told ? <p className="t-small text-soft">{r.askedBy} says {r.name} told them they agree to be matched and placed.</p> : null}
      {r.decisionNote ? <p className="t-small">The owner wrote: {r.decisionNote}</p> : null}
      {owner && open ? (
        <div className="flex flex-col gap-3">
          {look === null ? (
            <div>
              <Button size="md" variant="solid" loading={d.busy === "look"} onClick={() => void lookAgain()} data-testid={`request-look-${r.id}`}>
                Look again before you answer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-surface p-4" data-testid={`request-check-${r.id}`}>
              <p className="t-body">
                Checked just now. {look.tribe.active} of {look.tribe.capacity} seats in {look.tribe.name} are taken.
              </p>
              {look.blockers.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-danger" role="alert">
                  {look.blockers.map((b) => (
                    <li key={b.code}>{b.text}. Approving is not possible now.</li>
                  ))}
                </ul>
              ) : null}
              {look.warnings.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {look.warnings.map((w) => (
                    <li key={w.code}>{w.text}</li>
                  ))}
                </ul>
              ) : (
                <p className="t-body">Nothing in the way now.</p>
              )}
              <Textarea label="A word for them (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} rows={2} data-testid={`request-note-${r.id}`} />
              <div className="flex flex-wrap gap-3">
                <Button size="md" variant="solid" loading={d.busy === "approve"} disabled={look.blockers.length > 0} onClick={() => void decide("approve")} data-testid={`request-approve-${r.id}`}>
                  Approve and place
                </Button>
                <Button size="md" variant="quiet" loading={d.busy === "decline"} onClick={() => void decide("decline")} data-testid={`request-decline-${r.id}`}>
                  Decline
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {!owner && open && r.mine ? (
        <div>
          <Button size="md" variant="quiet" loading={d.busy === "withdraw"} onClick={() => void d.go("withdraw", () => withdrawRequestAction(r.id, person ?? r.person), { saved: "Taken back." })} data-testid={`request-withdraw-${r.id}`}>
            Take it back
          </Button>
        </div>
      ) : null}
      <Notice error={d.error} saved={d.saved} />
    </>
  );
}
