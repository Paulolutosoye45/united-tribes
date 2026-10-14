"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { aiConsentAction } from "@/app/(focus)/lead/apply/actions";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { FIELD_INFO } from "@/lib/leaders/quality/fields";
import { notedFields, type FirstCheckStatus } from "@/lib/leaders/quality/status";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(iso));

/**
 * What the applicant is told about the first check on their application, when it is switched on. Four plain
 * situations. It never says how anything was read, and never shows a score, a flag or a quote.
 */
export function FirstCheckPanel({ appId, status, consentText }: { appId: string; status: FirstCheckStatus; consentText: string }) {
  if (status.mode !== "on") return null;
  if (status.state === "consent_needed") return <ConsentNeeded appId={appId} text={consentText} />;
  if (status.state === "checking") {
    return (
      <section aria-labelledby="check-heading" className="card flex flex-col gap-2 p-6" data-testid="first-check-checking">
        <h2 id="check-heading" className="t-heading">
          We are reading your application
        </h2>
        <p className="t-body text-soft">This usually takes a few minutes. You can close this page. We will message you the moment it is done, and you can ask your referees then.</p>
      </section>
    );
  }
  if (status.state === "strengthen") return <Strengthen status={status} />;
  if (status.state === "with_people") {
    return (
      <section aria-labelledby="check-heading" className="card flex flex-col gap-2 p-6" data-testid="first-check-held">
        <h2 id="check-heading" className="t-heading">
          A person is reading your application
        </h2>
        <p className="t-body text-soft">A pastor or coach reads every application that needs a closer look. It can take a few days. There is nothing for you to do, and we will message you when you can ask your referees.</p>
      </section>
    );
  }
  return null;
}

function ConsentNeeded({ appId, text }: { appId: string; text: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    const result = await aiConsentAction(appId);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <section aria-labelledby="check-heading" className="card flex flex-col gap-4 p-6" data-testid="first-check-consent">
      <div className="flex flex-col gap-1">
        <h2 id="check-heading" className="t-heading">
          One sentence has changed
        </h2>
        <p className="t-small text-soft">Please read it and agree so we can carry on with your application. Nothing else about it changes.</p>
      </div>
      <Choice type="checkbox" name="consent-leader-ai" value="yes" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} title={text} description="Needed to carry on" />
      {error ? (
        <p role="alert" className="t-small text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button size="md" disabled={!agreed} loading={busy} onClick={() => void agree()}>
          I agree, carry on
        </Button>
      </div>
    </section>
  );
}

function Strengthen({ status }: { status: FirstCheckStatus }) {
  const fields = notedFields(status.notes);
  return (
    <section aria-labelledby="check-heading" className="card flex flex-col gap-4 p-6" data-testid="first-check-strengthen">
      <div className="flex flex-col gap-1">
        <h2 id="check-heading" className="t-heading">
          A little more would help
        </h2>
        <p className="t-small text-soft">Your application is with us. {fields.length === 1 ? "One answer" : "A few answers"} would be stronger with a few more words. You can ask your referees once this is done.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {fields.map((f) => (
          <li key={f} className="rounded-[var(--radius-control)] border border-line px-4 py-3">
            <p className="font-semibold">{FIELD_INFO[f].label}</p>
            <p className="t-small mt-1 text-soft">{status.notes[f]}</p>
          </li>
        ))}
      </ul>
      {status.canRewriteNow ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/lead/update" className={buttonClasses({ size: "md", className: "px-6" })}>
            <span className="relative">Add to my answers</span>
          </Link>
          <span className="t-small text-soft">Or ask for a person to read it as it is.</span>
        </div>
      ) : (
        <p className="t-small text-soft">
          {status.rewritesLeft > 0 && status.nextRewriteAt
            ? `You can add to your answers again from ${when(status.nextRewriteAt)}. Or a person can read it as it is.`
            : "A person will read your application as it is."}
        </p>
      )}
      {!status.canRewriteNow ? (
        <div>
          <Link href="/lead/update" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Hand it to a person</span>
          </Link>
        </div>
      ) : null}
    </section>
  );
}
