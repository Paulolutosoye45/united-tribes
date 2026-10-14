"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { saveRefereeAction } from "@/app/(focus)/lead/apply/actions";
import { requestRefereeAction } from "@/app/(app)/lead/actions";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { refereeProblem, type RefereeInput } from "@/lib/leaders/answers";
import { MAX_CHANGES, STAGE_STEPS, stageLine, stageRank } from "@/lib/leaders/referee/labels";
import { refereeHeadsUp, salutation, whatsappLink } from "@/lib/leaders/status";
import type { ReferenceRecord } from "@/lib/leaders/server";

const LIVE = new Set(["sending", "sent", "opened", "verified"]);

/**
 * The applicant's side of the referee check. They name two people and press "Send request"; the system sends each person a private
 * link and a code at their own phone or email. The applicant sees how each request is going and nothing more: not the link, not the
 * code, not whether the person is on the church's list. So an applicant has no way to answer for someone else.
 */
export function RefereeLinks({ appId, applicant, references }: { appId: string; applicant: string; references: ReferenceRecord[] }) {
  const router = useRouter();
  const answered = references.filter((r) => r.answered).length;

  // While a request is on its way, keep the chips honest without asking anyone to reload
  const watching = references.some((r) => !r.answered && LIVE.has(r.stage));
  useEffect(() => {
    if (!watching) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [watching, router]);

  return (
    <section aria-labelledby="referees-heading" className="flex flex-col gap-3" data-testid="referees">
      <div className="flex flex-col gap-1">
        <h2 id="referees-heading" className="t-heading">
          Your referees
        </h2>
        <p className="t-small text-soft">
          {answered === references.length && references.length > 0
            ? "Both have answered. Thank you."
            : "We send each person a private link and a code, straight to their own phone or email. You don’t see them, and nor does anyone else, so their answer is theirs alone. You’ll see here how each one is going."}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {references.map((r) => (
          <RefereeRow key={r.id} appId={appId} applicant={applicant} reference={r} />
        ))}
      </ul>
    </section>
  );
}

/** Four steps, filled in as the referee goes through them. The words are there for everyone, not only the colour. */
function Track({ stage }: { stage: string }) {
  const done = stageRank(stage);
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Progress">
      {STAGE_STEPS.map((step, i) => {
        const on = i < done;
        const now = i === done - 1;
        return (
          <li key={step.id} className="flex flex-col gap-1.5" aria-current={now ? "step" : undefined}>
            <span className={cn("h-1.5 rounded-full transition-colors duration-500", on ? "bg-gold" : "bg-surface-strong")} />
            <span className={cn("text-[0.75rem] leading-4", on ? "font-semibold text-ink" : "text-soft")}>
              {step.label}
              <span className="sr-only">{on ? ", done" : ", not yet"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RefereeRow({ appId, applicant, reference }: { appId: string; applicant: string; reference: ReferenceRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const first = salutation(reference.name);
  const stage = justSent && (reference.stage === "waiting" || reference.stage === "unreachable") ? "sending" : reference.stage;
  const started = stage !== "waiting" && stage !== "unreachable";
  const left = Math.max(0, MAX_CHANGES - reference.changes);
  const canChange = !reference.answered && (reference.requests === 0 || left > 0);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await requestRefereeAction(reference.id);
    } catch {
      result = { ok: false as const, message: "We couldn’t send that. Check your connection and try again." };
    }
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setJustSent(true);
    router.refresh();
  }

  const phone = reference.kind === "phone" ? normaliseWhatsapp(reference.contact) : null;
  const headsUp = refereeHeadsUp(reference.name, applicant);
  const headsUpHref = reference.kind === "email" ? `mailto:${encodeURIComponent(reference.contact)}?subject=${encodeURIComponent("A reference for me")}&body=${encodeURIComponent(headsUp)}` : whatsappLink(phone, headsUp);

  const badge = reference.answered ? <Badge tone="gold">Answered</Badge> : stage === "unreachable" ? <Badge tone="flame">Not reached</Badge> : started ? <Badge tone="neutral">{STAGE_STEPS[Math.max(0, stageRank(stage) - 1)]?.label ?? "Sending"}</Badge> : <Badge tone="outline">Not sent</Badge>;

  return (
    <li className="card flex flex-col gap-4 p-5" data-testid={`referee-${reference.slot}`} data-stage={stage}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{reference.name}</p>
          <p className="t-small text-soft">
            {reference.relationship}
            {reference.head ? ", pastor or unit head" : ""}
          </p>
          <p className="t-small truncate text-soft">{reference.kind === "email" ? "Email" : "Phone"}: {reference.contact}</p>
        </div>
        <span data-testid={`referee-badge-${reference.slot}`}>{badge}</span>
      </div>

      {started || reference.answered ? <Track stage={reference.answered ? "answered" : stage} /> : null}
      <p className="t-small" role="status" data-testid={`referee-line-${reference.slot}`}>
        {stageLine(reference.answered ? "answered" : stage, reference.kind, first)}
      </p>

      {reference.answered ? null : changing ? (
        <ChangeReferee
          appId={appId}
          slot={reference.slot}
          after={reference.requests > 0}
          left={left}
          current={{ name: reference.name, relationship: reference.relationship, contact: reference.contact, head: reference.head }}
          onDone={() => {
            setChanging(false);
            setJustSent(false);
            router.refresh();
          }}
          onCancel={() => setChanging(false)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="md" variant={started ? "quiet" : "primary"} loading={busy} onClick={() => void send()} data-testid={`referee-send-${reference.slot}`}>
              {started ? "Send again" : stage === "unreachable" ? "Try again" : `Send request to ${first}`}
            </Button>
            {canChange ? (
              <Button variant="ghost" size="md" onClick={() => setChanging(true)} data-testid={`referee-change-${reference.slot}`}>
                Change this person
              </Button>
            ) : null}
            {started ? (
              <a href={headsUpHref} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "ghost", size: "md" })}>
                <span className="relative">Give {first} a heads-up</span>
              </a>
            ) : null}
          </div>
          {started ? <p className="t-small text-soft">A heads-up is a short note from you, with no link in it, so {first} knows to expect ours.</p> : null}
          {!canChange && reference.requests > 0 ? <p className="t-small text-soft">This person has been changed {MAX_CHANGES} times already. If something has gone wrong, message the pastorate.</p> : null}
          {error ? (
            <p role="alert" className="t-small text-danger" data-testid={`referee-error-${reference.slot}`}>
              {error}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

function ChangeReferee({
  appId,
  slot,
  after,
  left,
  current,
  onDone,
  onCancel,
}: {
  appId: string;
  slot: 1 | 2;
  after: boolean;
  left: number;
  current: RefereeInput;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<RefereeInput>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const problem = refereeProblem(value);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const result = await saveRefereeAction(appId, slot, value);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onDone();
  }

  return (
    <div className="pop-in flex flex-col gap-4">
      <Input label="Their name" value={value.name} maxLength={80} onChange={(e) => setValue({ ...value, name: e.target.value })} />
      <Input label="How do you know them?" value={value.relationship} maxLength={80} onChange={(e) => setValue({ ...value, relationship: e.target.value })} />
      <Input label="Their phone number or email" value={value.contact} maxLength={120} onChange={(e) => setValue({ ...value, contact: e.target.value })} hint="We send the request here, to them. It has to be theirs." />
      <Choice
        type="checkbox"
        name={`change-head-${slot}`}
        value="yes"
        checked={value.head}
        onChange={(e) => setValue({ ...value, head: e.target.checked })}
        title="This person is a pastor or unit head"
      />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button size="md" loading={busy} onClick={() => void save()}>
          Save
        </Button>
        <Button variant="ghost" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="t-small text-soft">
        {after
          ? `Choosing a different phone or email cancels the request already sent. You can do this ${left === 1 ? "one more time" : `${left} more times`} for this referee. Each change is recorded.`
          : "Choosing a different phone or email lets you send a fresh request to them."}
      </p>
    </div>
  );
}
