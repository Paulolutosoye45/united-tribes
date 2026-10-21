"use client";

import { useState } from "react";
import { recommendAssistantAction, withdrawAssistantAction } from "@/app/(app)/lead/tribe/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatShortDate } from "@/lib/dates";
import { STATUS_WORDS, type MyAssistantState } from "@/lib/placement/assistants";

/**
 * A leader's page: the assistant they have, or the one person they would like. The office decides; the leader is told the outcome in a
 * line. The reason an application was or was not approved stays with the office.
 */
export function AssistantRecommend({ tribeId, state }: { tribeId: string; state: MyAssistantState }) {
  const d = useDo();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  if (state.closed) return null;

  return (
    <section aria-labelledby="assistant-heading" className="card flex flex-col gap-4 p-5 sm:p-6" data-testid="assistant-recommend">
      <div>
        <h2 id="assistant-heading" className="t-heading">
          Your assistant leader
        </h2>
        <p className="t-small text-soft">A tribe has one assistant. You can recommend someone you trust; the church office decides and tells you.</p>
      </div>

      {state.assistant ? (
        <p className="t-body">
          <strong>{state.assistant.name}</strong> is your assistant leader.
        </p>
      ) : null}

      {state.open ? (
        <div className="flex flex-col gap-3">
          <p className="t-body">
            You recommended <strong>{state.open.name}</strong>
            {state.open.since ? ` on ${formatShortDate(state.open.since)}` : ""}. <Badge tone="gold">{STATUS_WORDS[state.open.status] ?? state.open.status}</Badge>
          </p>
          <Notice error={d.error} saved={said ?? d.saved} />
          <div>
            <Button
              size="sm"
              variant="quiet"
              loading={d.busy === "withdraw"}
              onClick={() => void d.go("withdraw", () => withdrawAssistantAction(state.open!.id), { after: () => setSaid("Withdrawn.") })}
            >
              Withdraw it
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void d.go("recommend", () => recommendAssistantAction(tribeId, email, reason), {
              saved: "Sent to the church office. We will tell you what they decide.",
              after: () => (setEmail(""), setReason("")),
            });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">Their email address</span>
            <input className="input" type="email" value={email} maxLength={254} required autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.95rem] font-medium">Why them? (optional)</span>
            <textarea className="input min-h-24 py-3" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} />
            <span className="t-small text-soft">A sentence or two. Please don’t write anything private about them.</span>
          </label>
          <Notice error={d.error} saved={d.saved} />
          <div>
            <Button type="submit" size="md" variant="solid" loading={d.busy === "recommend"} disabled={email.trim().length < 5}>
              {state.assistant ? "Recommend a different assistant" : "Recommend an assistant"}
            </Button>
          </div>
        </form>
      )}

      {state.last && !state.open ? (
        <p className="t-small text-soft">
          Last time: {state.last.name} · {STATUS_WORDS[state.last.status] ?? state.last.status}
          {state.last.at ? ` · ${formatShortDate(state.last.at)}` : ""}
        </p>
      ) : null}
    </section>
  );
}
