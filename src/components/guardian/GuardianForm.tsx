"use client";

import Link from "next/link";
import { useState } from "react";
import { answerGuardianAction } from "@/app/(public)/guardian/[token]/actions";
import { ShieldBurst } from "@/components/flow/Celebration";
import { useTurnstile } from "@/components/security/Turnstile";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { clockLabel, dayName } from "@/lib/academy/options";
import { cn } from "@/lib/cn";
import { GUARDIAN_AGREE_SENTENCE, GUARDIAN_STATEMENTS, relationshipLabel } from "@/lib/guardian/consent";
import type { GuardianRequest } from "@/lib/growth/types";

type Done = "approved" | "declined" | "withdrawn";

/**
 * What a parent or guardian reads and answers, by their private link. "ask" is the first visit.
 * "approved" is a later one: it shows who the young person meets with, and lets them take their permission back.
 */
export function GuardianForm({ token, request, mode }: { token: string; request: GuardianRequest; mode: "ask" | "approved" }) {
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [confirmNo, setConfirmNo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const bot = useTurnstile();
  const teen = request.teen_first;

  async function answer(approve: boolean) {
    if (busy) return;
    setBusy(approve ? "yes" : "no");
    setError(null);
    // Giving permission is checked against bots; declining or taking permission back never is.
    const result = await answerGuardianAction(token, approve, agreed, note, approve ? (bot.token ?? "") : "");
    if (approve) bot.spent();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setDone(approve ? "approved" : mode === "approved" ? "withdrawn" : "declined");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  if (done === "approved") {
    return (
      <div className="night rise-in flex flex-col items-center gap-6 rounded-[var(--radius-sheet)] px-6 py-10 text-center">
        <ShieldBurst label="Permission given" />
        <div className="flex flex-col gap-3">
          <h2 className="t-title">Thank you, {request.guardian}.</h2>
          <p className="t-body mx-auto max-w-[38ch] text-white/80">
            A member of our Care Team will contact you to check this answer is yours. {teen} can be placed in a tribe once we have spoken. You can close this page, and
            come back to this link at any time to take your permission back.
          </p>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" role="status">
        <h2 className="t-heading">{done === "withdrawn" ? "Your permission has been taken back." : "Thank you for telling us."}</h2>
        <p className="t-body text-soft">
          {done === "withdrawn"
            ? `${teen} has left their tribe and will not be placed in another. A member of our Care Team may contact you.`
            : `${teen} will not be placed in a tribe. A member of our Care Team may contact you, to make sure ${teen} is looked after.`}
        </p>
      </div>
    );
  }

  const tribe = request.tribe;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="statements" className="card flex flex-col gap-4 p-5 sm:p-7">
        <h2 id="statements" className="t-heading">
          {mode === "approved" ? "What you agreed to" : "What you are agreeing to"}
        </h2>
        <ol className="flex flex-col gap-3">
          {GUARDIAN_STATEMENTS.map((text, i) => (
            <li key={i} className="t-body flex gap-3.5">
              <span aria-hidden="true" className="t-small mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-strong font-bold">
                {i + 1}
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <p className="t-small text-soft">
          You are answering as {request.guardian}, {relationshipLabel(request.relationship).toLowerCase()} to {teen}.{" "}
          <Link href="/privacy" target="_blank" className="font-semibold underline underline-offset-4">
            Privacy notice
          </Link>
        </p>
      </section>

      {tribe ? (
        <section aria-labelledby="tribe-heading" className="card flex flex-col gap-3 p-5 sm:p-7">
          <h2 id="tribe-heading" className="t-heading">
            {teen}&rsquo;s tribe
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Tribe" value={tribe.name} />
            <Fact label="Led by" value={tribe.assistant ? `${tribe.leader} and ${tribe.assistant}` : tribe.leader} />
            <Fact label="Meets" value={`${dayName(tribe.day)}s at ${clockLabel(tribe.time)}`} />
            <Fact label="Where" value={tribe.mode === "online" ? "Online" : (tribe.place ?? "In person")} />
          </dl>
        </section>
      ) : null}

      {mode === "ask" ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (agreed) void answer(true);
          }}
        >
          <label className={cn("card flex cursor-pointer items-start gap-3.5 p-5", agreed && "border-ink")}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--crest-flame)]" />
            <span className="t-body">{GUARDIAN_AGREE_SENTENCE}</span>
          </label>
          <Textarea
            label="Anything you would like us to know"
            optional
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            hint="Seen only by the Care Team."
          />
          {error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
              {error}
            </p>
          ) : null}
          {bot.widget}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" size="lg" loading={busy === "yes"} disabled={!agreed || busy === "no" || !bot.ready} className="sm:px-10">
              Yes, I give my permission
            </Button>
            <Button type="button" variant="quiet" size="lg" loading={busy === "no"} disabled={busy === "yes"} onClick={() => void answer(false)}>
              No, I do not
            </Button>
          </div>
          <p className="t-small text-soft">You can change your mind later, using this same link.</p>
        </form>
      ) : (
        <section aria-labelledby="withdraw-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
          <h2 id="withdraw-heading" className="t-heading">
            Take your permission back
          </h2>
          <p className="t-body text-soft">{teen} will leave their tribe straight away and will not be placed in another. You can ask for this to be opened again later through the Care Team.</p>
          {confirmNo ? (
            <div className="flex flex-col gap-4">
              <Textarea label="Anything you would like us to know" optional rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="Seen only by the Care Team." />
              {error ? (
                <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button type="button" size="md" loading={busy === "no"} onClick={() => void answer(false)}>
                  Yes, take it back
                </Button>
                <Button type="button" variant="quiet" size="md" onClick={() => setConfirmNo(false)}>
                  Keep my permission
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button type="button" variant="quiet" size="md" onClick={() => setConfirmNo(true)}>
                I want to take my permission back
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-small text-soft">{label}</dt>
      <dd className="font-semibold leading-snug">{value}</dd>
    </div>
  );
}
