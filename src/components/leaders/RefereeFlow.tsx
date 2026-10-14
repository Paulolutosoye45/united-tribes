"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { askCodeAction, checkCodeAction, reverifyAction } from "@/app/(public)/reference/[token]/actions";
import { ReferenceForm } from "@/components/leaders/ReferenceForm";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import { standingLabel } from "@/lib/leaders/referee/labels";
import type { RefereeOpen } from "@/lib/leaders/referee/types";
import { salutation } from "@/lib/leaders/status";

type Info = RefereeOpen;

const DEAD = {
  invalid: { title: "This link isn’t valid.", body: "Check you copied the whole link. If it still doesn’t open, ask the person who sent it to send you a new request." },
  answered: { title: "Already sent. Thank you.", body: "Your reference has reached the review panel. You don’t need to do anything else." },
  closed: { title: "This reference is no longer needed.", body: "The application has been closed. Thank you for being willing to help." },
  expired: { title: "This link has expired.", body: "Links last 30 days. Ask the applicant to send you a new request." },
} as const;

export function RefereeFlow({ token, info }: { token: string; info: Info }) {
  if (info.state !== "open") {
    const copy = DEAD[info.state];
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" data-testid={`referee-${info.state}`}>
        <h2 className="t-heading">{copy.title}</h2>
        <p className="t-body text-soft">{info.state === "expired" && info.applicant !== "the applicant" ? `Links last 30 days. Ask ${info.applicant} to send you a new request.` : copy.body}</p>
      </div>
    );
  }
  if (!info.verified) return <ConfirmYou token={token} info={info} />;
  return info.mode === "reverify" ? <Reverify token={token} info={info} /> : (
    <div className="flex flex-col gap-6">
      <Confirmed info={info} />
      <ReferenceForm token={token} applicant={info.applicant} referee={info.referee} relationship={info.relationship} />
    </div>
  );
}

const WHERE = { phone: "phone", email: "email address" } as const;

/** A quiet banner once the code has been right: what we now know, and nothing about the applicant's side. */
function Confirmed({ info }: { info: Extract<Info, { state: "open" | "answered" | "closed" | "expired" }> }) {
  return (
    <div role="status" className="rise-in flex items-start gap-3 rounded-[var(--radius-control)] bg-gold/20 px-4 py-3" data-testid="referee-confirmed">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
        <path d="m7.5 12.5 3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="t-small text-ink">
        <strong className="font-semibold">Thank you, it’s you.</strong>{" "}
        {info.who ? `We know you as ${info.who.name}${info.who.unit ? `, ${info.who.unit}` : ""} (${standingLabel(info.who.standing).toLowerCase()}).` : `You have shown you hold this ${WHERE[info.kind]}.`}
      </p>
    </div>
  );
}

/**
 * Step one for every referee: a code to the same phone or email the link came to. It goes only where the applicant said, never to
 * anything typed here, so a person who got hold of the link still cannot answer without the phone.
 */
function ConfirmYou({ token, info }: { token: string; info: Extract<Info, { state: "open" | "answered" | "closed" | "expired" }> }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [step, setStep] = useState<"ask" | "code">(info.code.live || info.code.lockedMinutes > 0 ? "code" : "ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"ask" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(info.code.wait);
  const [locked, setLocked] = useState(info.code.lockedMinutes);
  const [done, setDone] = useState(false);
  const [triesLeft, setTriesLeft] = useState<number | null>(null);
  const sentTo = info.masked ?? (info.kind === "email" ? "your email" : "your phone");
  const first = salutation(info.referee);

  // The "send again" countdown
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask() {
    if (busy) return;
    setBusy("ask");
    setError(null);
    let out;
    try {
      out = await askCodeAction(token);
    } catch {
      out = { ok: false as const, reason: "error", message: "We couldn’t send the code. Check your connection and try again." };
    }
    setBusy(null);
    if (out.ok) {
      setStep("code");
      setCode("");
      setWait(60);
      setTriesLeft(null);
      return;
    }
    if (out.reason === "wait" && out.seconds) {
      setStep("code");
      setWait(out.seconds);
    }
    if (out.reason === "locked" && out.minutes) {
      setStep("code");
      setLocked(out.minutes);
    }
    setError(out.message);
  }

  async function check(value: string) {
    if (busy || value.length !== 6) return;
    setBusy("check");
    setError(null);
    let out;
    try {
      out = await checkCodeAction(token, value);
    } catch {
      out = { ok: false as const, reason: "error", message: "We couldn’t check that code. Check your connection and try again." };
    }
    setBusy(null);
    if (out.ok) {
      setDone(true);
      startRefresh(() => router.refresh());
      return;
    }
    setCode("");
    if (out.reason === "locked" && out.minutes) setLocked(out.minutes);
    if (out.reason === "wrong") setTriesLeft(out.triesLeft ?? null);
    if (out.reason === "invalid" || out.reason === "closed") router.refresh();
    setError(out.message);
  }

  if (done) {
    return (
      <div className="card rise-in flex flex-col items-center gap-4 p-8 text-center" role="status" data-testid="referee-opening">
        <ShieldBurst label="Confirmed" />
        <p className="t-heading">Thank you, {first}.</p>
        <p className="t-body text-soft">{refreshing ? "Opening the questions…" : "One moment…"}</p>
      </div>
    );
  }

  if (step === "ask") {
    return (
      <section className="card rise-in flex flex-col gap-6 p-6" aria-labelledby="confirm-h" data-testid="referee-ask">
        <div className="flex flex-col gap-2">
          <h2 id="confirm-h" className="t-title">
            First, let’s make sure it’s you
          </h2>
          <p className="t-body text-soft">
            So that every reference is honest, we check that the person answering is the person {info.applicant} named. We’ll send a six-digit code to{" "}
            <strong className="font-semibold text-ink" data-testid="referee-masked">
              {sentTo}
            </strong>
            , the {WHERE[info.kind]} this link came to.
          </p>
        </div>
        {error ? (
          <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
            {error}
          </p>
        ) : null}
        <Button size="lg" fullWidth loading={busy === "ask"} onClick={ask} data-testid="referee-send-code">
          Send me the code
        </Button>
        <p className="t-small text-soft">{info.applicant} is never told what you answer. They only see that you confirmed it was you.</p>
      </section>
    );
  }

  const lockedNow = locked > 0;
  return (
    <section className="card rise-in flex flex-col gap-6 p-6" aria-labelledby="code-h" data-testid="referee-code">
      <div className="flex flex-col gap-2">
        <h2 id="code-h" className="t-title">
          {info.kind === "email" ? "Check your email" : "Check your messages"}
        </h2>
        <p className="t-body text-soft">
          We sent a six-digit code to <strong className="font-semibold text-ink">{sentTo}</strong>. Type it here. It can take a minute, and it works for {info.code.minutes} minutes.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <CodeInput value={code} onChange={setCode} onComplete={check} error={Boolean(error) && !lockedNow} disabled={busy === "check" || lockedNow} autoFocus label="Six-digit code" />
        <div aria-live="polite" className="min-h-6">
          {lockedNow ? (
            <p role="alert" className="t-small text-danger" data-testid="referee-locked">
              Too many wrong codes. Please try again in {locked === 1 ? "1 minute" : `${locked} minutes`}.
            </p>
          ) : error ? (
            <p role="alert" className="t-small text-danger" data-testid="referee-error">
              {error}
            </p>
          ) : busy === "check" ? (
            <p className="t-small text-soft">Checking your code…</p>
          ) : triesLeft === null && info.code.failed ? (
            <p className="t-small text-soft">We couldn’t send that message. You can ask for it again.</p>
          ) : null}
        </div>
      </div>

      <Button size="lg" fullWidth loading={busy === "check"} disabled={code.length !== 6 || lockedNow} onClick={() => check(code)} data-testid="referee-confirm">
        Confirm
      </Button>

      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="md" className="-ml-4" disabled={wait > 0 || busy !== null || lockedNow} loading={busy === "ask"} onClick={ask} data-testid="referee-resend">
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </Button>
        <p className="t-small text-soft">No message? Check your spam folder or your message requests, then ask again.</p>
      </div>
    </section>
  );
}

/** A reference given before referees were checked: once the code is right, one question. */
function Reverify({ token, info }: { token: string; info: Extract<Info, { state: "open" | "answered" | "closed" | "expired" }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"yes" | "no" | null>(null);
  const top = useRef<HTMLDivElement>(null);

  async function answer(mine: boolean) {
    if (busy) return;
    setBusy(mine ? "yes" : "no");
    setError(null);
    let out;
    try {
      out = await reverifyAction(token, mine);
    } catch {
      out = { ok: false as const, message: "We couldn’t save that. Check your connection and try again." };
    }
    setBusy(null);
    if (out.ok) {
      setResult(mine ? "yes" : "no");
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    setError(out.message);
    if ("restart" in out && out.restart) router.refresh();
  }

  if (result) {
    return (
      <div className="night rise-in flex flex-col items-center gap-6 rounded-[var(--radius-sheet)] px-6 py-10 text-center" data-testid="referee-reverified">
        <ShieldBurst label="Thank you" />
        <div className="flex flex-col gap-2">
          <h2 className="t-title">Thank you, {salutation(info.referee)}.</h2>
          <p className="t-body mx-auto max-w-[36ch] text-white/80">
            {result === "yes" ? "We’ve noted that this reference is yours. You can close this page." : "We’ve noted that this reference was not yours. Someone from the care team may be in touch. You can close this page."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={top} className="flex flex-col gap-6" data-testid="referee-reverify">
      <Confirmed info={info} />
      <section className="card rise-in flex flex-col gap-5 p-6">
        <h2 className="t-heading">Did you send this reference for {info.applicant}?</h2>
        <p className="t-body text-soft">It was received before we started checking who sends them. It stays with the review panel. We only need to know whether it was you.</p>
        {error ? (
          <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" fullWidth loading={busy === "yes"} disabled={busy !== null} onClick={() => answer(true)} data-testid="referee-yes">
            Yes, it was me
          </Button>
          <Button size="lg" variant="quiet" fullWidth loading={busy === "no"} disabled={busy !== null} onClick={() => answer(false)} data-testid="referee-no">
            No, it wasn’t me
          </Button>
        </div>
      </section>
    </div>
  );
}
