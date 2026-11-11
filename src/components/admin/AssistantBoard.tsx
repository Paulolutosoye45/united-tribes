"use client";

import Link from "next/link";
import { useState } from "react";
import { decideAssistantAction } from "@/app/(app)/admin/assistants/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import { STATUS_WORDS, type AssistantRow } from "@/lib/placement/assistants";

/** The recommendations waiting for the office, and the last few answered. Nothing is decided until someone here presses a button. */
export function AssistantBoard({ open, recent }: { open: AssistantRow[]; recent: AssistantRow[] }) {
  // What the last answer did is said up here, not inside the row: once an answer is saved the page refreshes and the row moves down to "Recently answered",
  // and a message kept in the row would be gone before anyone could read it.
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-8" data-testid="assistant-board">
      {said ? (
        <div data-testid="assistant-said">
          <Notice error={null} saved={said} />
        </div>
      ) : null}
      <section aria-labelledby="open-heading" className="flex flex-col gap-3">
        <h2 id="open-heading" className="t-heading">
          Waiting for a decision
        </h2>
        {open.length === 0 ? <p className="card t-body p-5 text-soft">Nothing is waiting.</p> : null}
        <ul className="flex flex-col gap-3">
          {open.map((r) => (
            <Row key={r.id} row={r} onSaid={setSaid} />
          ))}
        </ul>
      </section>
      {recent.length > 0 ? (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
          <h2 id="recent-heading" className="t-heading">
            Recently answered
          </h2>
          <ul className="flex flex-col gap-2">
            {recent.map((r) => (
              <li key={r.id} className="card t-small flex flex-wrap items-center justify-between gap-2 p-4">
                <span>
                  <strong>{r.nominee.name ?? r.nominee.email ?? "Someone"}</strong> for {r.tribe.name} · recommended by {r.tribe.leader}
                </span>
                <Badge tone="outline">{STATUS_WORDS[r.status] ?? r.status}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Row({ row: r, onSaid }: { row: AssistantRow; onSaid: (said: string) => void }) {
  const d = useDo();
  const [note, setNote] = useState("");
  const hasOne = r.tribe.assistant !== null;
  const invited = r.status === "invited";

  async function decide(approve: boolean, replace: boolean, key: string) {
    await d.go(key, async () => {
      const x = await decideAssistantAction(r.id, approve, note, replace);
      if (x.ok) onSaid(x.status === "paired" ? "They are now the assistant." : x.status === "invited" ? "Accepted. They are invited to apply." : "Declined.");
      return x.ok ? { ok: true as const } : x;
    });
  }

  return (
    <li className="card flex flex-col gap-3 p-5" data-testid={`assistant-${r.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">
            {r.nominee.name ?? r.nominee.email ?? "Someone"} for{" "}
            <Link href={`/god/tribes/${r.tribe.id}`} className="underline underline-offset-4">
              {r.tribe.name}
            </Link>
          </p>
          <p className="t-small text-soft">
            Recommended by {r.tribe.leader}
            {r.createdAt ? ` on ${formatShortDate(r.createdAt)}` : ""}
            {r.nominee.email ? ` · ${r.nominee.email}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={invited ? "gold" : "neutral"}>{STATUS_WORDS[r.status] ?? r.status}</Badge>
          {r.young ? <Badge tone="charcoal">Young members: a pastor or director decides</Badge> : null}
        </div>
      </div>
      {r.reason ? <p className="t-body">“{r.reason}”</p> : null}
      <ul className="t-small flex flex-wrap gap-x-4 gap-y-1 text-soft">
        <li>{r.nominee.hasAccount ? "Has an account" : "No account yet"}</li>
        <li>{r.nominee.isAssistant ? "Approved assistant leader" : "Not yet an approved assistant leader"}</li>
        {r.nominee.isAssistant ? <li>{r.nominee.certified ? "Certified" : "Not yet certified"}</li> : null}
        {r.nominee.pairedElsewhere ? <li>Already the assistant of another tribe</li> : null}
        {hasOne ? <li>Current assistant: {r.tribe.assistant}</li> : <li>No assistant now</li>}
      </ul>
      <Notice error={d.error} />
      {invited ? (
        <p className="t-small text-soft">Accepted. They are paired by itself when they are approved as an assistant leader.</p>
      ) : r.canDecide ? (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">A note for yourself (optional, not sent to the leader)</span>
            <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-3">
            {hasOne ? (
              <Button size="md" variant="solid" loading={d.busy === "replace"} disabled={r.nominee.pairedElsewhere} onClick={() => void decide(true, true, "replace")}>
                Replace {r.tribe.assistant}
              </Button>
            ) : (
              <Button size="md" variant="solid" loading={d.busy === "approve"} disabled={r.nominee.pairedElsewhere} onClick={() => void decide(true, false, "approve")}>
                Approve
              </Button>
            )}
            <Button size="md" variant="ghost" loading={d.busy === "decline"} onClick={() => void decide(false, false, "decline")}>
              Decline
            </Button>
          </div>
        </>
      ) : (
        <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3">This tribe has young members, so a pastor or a director decides. You can see it here, but not answer it.</p>
      )}
    </li>
  );
}
