"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { answerAction, askCodeAction, checkCodeAction } from "@/app/(public)/details/[token]/actions";
import { FactQuestion } from "@/components/profile/FactQuestion";
import { Button } from "@/components/ui/Button";
import { CodeInput } from "@/components/ui/CodeInput";
import type { FactKey, FactOption } from "@/lib/profile/types";
import { CODE_WORDS } from "@/lib/profile/wording";

export type DetailsView =
  | { mode: "ended" }
  | { mode: "problem" }
  | { mode: "code" }
  | { mode: "ask"; first: string; key: FactKey; label: string; question: string; valueLabel: string; options: FactOption[]; left: number }
  | { mode: "done"; first: string; waiting: boolean };

/** The page behind "Confirm your details". Nothing about the person is shown until it is clearly them. */
export function DetailsFlow({ token, view }: { token: string; view: DetailsView }) {
  if (view.mode === "ended") {
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" data-testid="details-ended">
        <h2 className="t-heading">This link isn’t working.</h2>
        <p className="t-body text-soft">It may have ended, or it may not have been copied in full. If you are signed in, open My page: what the church holds is there too. Otherwise ask the church office to send you a fresh one.</p>
      </div>
    );
  }
  if (view.mode === "problem") {
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" data-testid="details-problem">
        <h2 className="t-heading">We could not open this just now.</h2>
        <p className="t-body text-soft">Please try again in a moment.</p>
      </div>
    );
  }
  if (view.mode === "code") return <Code token={token} />;
  if (view.mode === "done") {
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" role="status" data-testid="details-done">
        <h2 className="t-heading">Thank you{view.first ? `, ${view.first}` : ""}. That is all.</h2>
        <p className="t-body text-soft">{view.waiting ? "A pastor will look at the change you asked for. Until then everything stays as it is." : "There is nothing else to check. You can close this page."}</p>
      </div>
    );
  }
  return <Ask token={token} view={view} />;
}

function Ask({ token, view }: { token: string; view: Extract<DetailsView, { mode: "ask" }> }) {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  const [answered, setAnswered] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {view.left > 1 && !answered ? <p className="t-small text-soft">{view.left} things to check.</p> : null}
      <FactQuestion
        key={view.key}
        testId="details-question"
        label={view.label}
        question={view.question}
        valueLabel={view.valueLabel}
        options={view.options}
        onAnswer={(action, value) => answerAction(token, view.key, action, value)}
        onDone={() => setAnswered(true)}
      />
      {answered ? (
        <div>
          <Button size="lg" variant="quiet" loading={pending} onClick={() => startRefresh(() => router.refresh())} data-testid="details-next">
            {view.left > 1 ? "Next" : "Finish"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Step one for someone with no account: a code to the contact the church holds, never to anything typed here. */
function Code({ token }: { token: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [step, setStep] = useState<"ask" | "code">("ask");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"ask" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [wait, setWait] = useState(0);
  const [locked, setLocked] = useState(0);
  const [triesLeft, setTriesLeft] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearInterval(id);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask() {
    if (busy) return;
    setBusy("ask");
    setError(null);
    const out = await askCodeAction(token).catch(() => null);
    setBusy(null);
    if (out?.ok) {
      setSentTo(out.to);
      setStep("code");
      setCode("");
      setWait(60);
      setTriesLeft(null);
      return;
    }
    if (out && !out.ok) {
      if (out.reason === "locked") setLocked(out.minutes ?? 30);
      setError(out.reason === "locked" ? CODE_WORDS.locked(out.minutes) : CODE_WORDS[out.reason]);
      if (out.reason === "invalid") router.refresh();
      return;
    }
    setError("We couldn’t send the code. Check your connection and try again.");
  }

  async function check(value: string) {
    if (busy || value.length !== 6) return;
    setBusy("check");
    setError(null);
    const out = await checkCodeAction(token, value).catch(() => null);
    setBusy(null);
    if (out?.ok) {
      setDone(true);
      startRefresh(() => router.refresh());
      return;
    }
    setCode("");
    if (!out) {
      setError("We couldn’t check that code. Check your connection and try again.");
      return;
    }
    if (out.reason === "locked") setLocked(out.minutes ?? 30);
    setTriesLeft(out.reason === "wrong" ? out.triesLeft : null);
    setError(out.reason === "locked" ? CODE_WORDS.locked(out.minutes) : out.reason === "wrong" ? CODE_WORDS.wrong(out.triesLeft) : CODE_WORDS[out.reason]);
    if (out.reason === "invalid") router.refresh();
  }

  if (done) {
    return (
      <div className="card rise-in flex flex-col gap-2 p-6" role="status" data-testid="details-opening">
        <h2 className="t-heading">Thank you.</h2>
        <p className="t-body text-soft">{refreshing ? "Opening your details…" : "One moment…"}</p>
      </div>
    );
  }

  if (step === "ask") {
    return (
      <section className="card rise-in flex flex-col gap-5 p-6" aria-labelledby="dc-h" data-testid="details-code-ask">
        <div className="flex flex-col gap-2">
          <h2 id="dc-h" className="t-title">
            First, let’s make sure it’s you
          </h2>
          <p className="t-body text-soft">To keep your details private, we send a six-digit code to the email address or phone the church already has for you. It never goes anywhere you type here.</p>
        </div>
        {error ? (
          <p role="alert" className="t-small rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-danger" data-testid="details-code-error">
            {error}
          </p>
        ) : null}
        <Button size="lg" fullWidth loading={busy === "ask"} onClick={() => void ask()} data-testid="details-send-code">
          Send me the code
        </Button>
      </section>
    );
  }

  const lockedNow = locked > 0 && error !== null && /Too many tries/.test(error);
  return (
    <section className="card rise-in flex flex-col gap-5 p-6" aria-labelledby="dc-code-h" data-testid="details-code">
      <div className="flex flex-col gap-2">
        <h2 id="dc-code-h" className="t-title">
          Check your messages
        </h2>
        <p className="t-body text-soft">
          We sent a six-digit code to <strong className="font-semibold text-ink">{sentTo}</strong>. Type it here. It works for 10 minutes.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <CodeInput value={code} onChange={setCode} onComplete={(v) => void check(v)} error={Boolean(error) && !lockedNow} disabled={busy === "check" || lockedNow} autoFocus label="Six-digit code" />
        <div aria-live="polite" className="min-h-6">
          {error ? (
            <p role="alert" className="t-small text-danger" data-testid="details-code-error">
              {error}
            </p>
          ) : busy === "check" ? (
            <p className="t-small text-soft">Checking your code…</p>
          ) : null}
        </div>
      </div>
      <Button size="lg" fullWidth loading={busy === "check"} disabled={code.length !== 6 || lockedNow} onClick={() => void check(code)} data-testid="details-confirm-code">
        Confirm
      </Button>
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="md" className="-ml-4" disabled={wait > 0 || busy !== null || lockedNow} loading={busy === "ask"} onClick={() => void ask()} data-testid="details-resend">
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </Button>
        <p className="t-small text-soft">No message? Check your spam folder, then ask again.</p>
        {triesLeft === 0 ? null : null}
      </div>
    </section>
  );
}
