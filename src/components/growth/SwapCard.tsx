"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { answerSwapAction, cancelSwapAction, requestSwapAction } from "@/app/(app)/tribe/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Textarea } from "@/components/ui/Input";
import { SWAP_REASONS, type MySwap, type SwapReason } from "@/lib/growth/types";
import { SWAP_REASON_LABELS, SWAP_STATUS } from "@/lib/growth/wording";
import { AGREEMENT_SENTENCE, COVENANT_PROMISES, LABELS, whenLine, whereLine } from "@/lib/matching/wording";
import { SuccessPicture } from "@/components/matching/SuccessPicture";
import { cn } from "@/lib/cn";

type InTribe = Extract<MySwap, { in_tribe: true }>;

/**
 * "This isn't the right tribe for me." Shown on a member's tribe page. In the first weeks of a season they can ask
 * their coach for a different one; the reason goes to the coach and the Care Lead and never to their leader.
 */
export function SwapCard({ swap }: { swap: InTribe }) {
  const { request, window } = swap;

  // An open request is always shown. So is the answer to one, for a while.
  if (request && (request.status === "requested" || request.status === "offered")) return <Open swap={swap} />;
  const answered = request && (request.status === "moved" || request.status === "declined");
  // After a move there is nothing more to ask; after a "not this time" they can ask again while the first weeks last
  const canAsk = window.open && request?.status !== "moved";
  if (!answered && !canAsk) return null;
  return (
    <div className="flex flex-col gap-4">
      {answered ? <Answered swap={swap} /> : null}
      {canAsk ? <Ask swap={swap} /> : null}
    </div>
  );
}

function Ask({ swap }: { swap: InTribe }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SwapReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const result = await requestSwapAction(reason, note);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!open) {
    return (
      <section aria-labelledby="swap-heading" className="card flex flex-col gap-2 p-5">
        <h2 id="swap-heading" className="font-semibold">
          Not the right tribe for you?
        </h2>
        <p className="t-small text-soft">
          In the first {swap.window.weeks} weeks you can ask your coach for a different one. Your leader won&rsquo;t be told why.
        </p>
        <div>
          <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
            Ask for a different tribe
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-labelledby="swap-heading"
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div>
        <h2 id="swap-heading" className="font-semibold">
          Ask for a different tribe
        </h2>
        <p className="t-small text-soft">Your coach and the Care Lead will see this. Your leader and your tribe will not.</p>
      </div>
      <div role="radiogroup" aria-label="Main reason" className="flex flex-col gap-2">
        {SWAP_REASONS.map((r) => (
          <Choice key={r} name="swap-reason" value={r} checked={reason === r} onChange={() => setReason(r)} title={SWAP_REASON_LABELS[r].label} description={SWAP_REASON_LABELS[r].hint} />
        ))}
      </div>
      <Textarea label="Anything you would like your coach to know" optional rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="md" loading={busy} disabled={!reason}>
          Send to my coach
        </Button>
        <Button type="button" variant="quiet" size="md" onClick={() => setOpen(false)} disabled={busy}>
          Never mind
        </Button>
      </div>
    </form>
  );
}

function Open({ swap }: { swap: InTribe }) {
  const router = useRouter();
  const request = swap.request!;
  const [busy, setBusy] = useState<"yes" | "no" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const offered = request.status === "offered" ? request.offered : null;

  async function answer(accept: boolean) {
    if (busy) return;
    setBusy(accept ? "yes" : "no");
    setError(null);
    const result = await answerSwapAction(accept);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  async function cancel() {
    if (busy) return;
    setBusy("cancel");
    setError(null);
    const result = await cancelSwapAction();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  if (!offered) {
    return (
      <section aria-labelledby="swap-heading" className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="swap-heading" className="font-semibold">
            You asked for a different tribe
          </h2>
          <Badge tone={SWAP_STATUS.requested.tone}>{SWAP_STATUS.requested.label}</Badge>
        </div>
        <p className="t-body text-soft">
          {request.by_coach ? "Your coach started this for you. " : ""}Your coach will look for a tribe that fits, and tell you here and by message. Until you say yes to one, you stay in{" "}
          {swap.tribe.name}.
        </p>
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button variant="ghost" size="sm" loading={busy === "cancel"} onClick={() => void cancel()}>
            Withdraw my request
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="swap-heading" className="card flex flex-col gap-5 border-flame p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="swap-heading" className="t-heading">
            {offered.name} is offered to you
          </h2>
          <Badge tone="flame">{request.offered_degree}% compatible</Badge>
        </div>
        <p className="t-body text-soft">
          {request.offered_label ? `${LABELS[request.offered_label].text}. ` : ""}
          {offered.leader_first_name} leads it, meeting {whenLine(offered)}. {whereLine(offered)}.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="t-small font-semibold text-soft">Its Success Picture</h3>
        <SuccessPicture god={offered.god} others={offered.others} life={offered.life} />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="t-small font-semibold text-soft">The Tribe Covenant</h3>
        <ol className="flex flex-col gap-2">
          {COVENANT_PROMISES.map((p, i) => (
            <li key={p} className="t-small flex gap-2.5">
              <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-strong text-[0.7rem] font-bold">
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </div>

      <label className={cn("card flex cursor-pointer items-start gap-3.5 p-4", agreed && "border-ink")}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--crest-flame)]" />
        <span className="t-body">{AGREEMENT_SENTENCE}</span>
      </label>

      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="md" loading={busy === "yes"} disabled={!agreed || busy === "no"} onClick={() => void answer(true)}>
          Yes, move me to {offered.name}
        </Button>
        <Button variant="quiet" size="md" loading={busy === "no"} disabled={busy === "yes"} onClick={() => void answer(false)}>
          No, I&rsquo;ll stay in {swap.tribe.name}
        </Button>
      </div>
      <p className="t-small text-soft">You stay in {swap.tribe.name} until you say yes.</p>
    </section>
  );
}

function Answered({ swap }: { swap: InTribe }) {
  const request = swap.request!;
  return (
    <section aria-labelledby="swap-heading" className="card flex flex-col gap-2 p-5" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="swap-heading" className="font-semibold">
          {request.status === "moved" ? `You are now in ${swap.tribe.name}` : "Your coach could not move you this time"}
        </h2>
        <Badge tone={SWAP_STATUS[request.status].tone}>{SWAP_STATUS[request.status].label}</Badge>
      </div>
      {request.status === "declined" ? (
        <p className="t-body text-soft">{request.decision_note ?? "You stay in your tribe. You can ask again, or speak to your coach."}</p>
      ) : (
        <p className="t-body text-soft">Welcome. Your leader has been told you are joining.</p>
      )}
    </section>
  );
}
