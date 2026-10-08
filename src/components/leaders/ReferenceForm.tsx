"use client";

import Link from "next/link";
import { useState } from "react";
import { submitReferenceAction } from "@/app/(public)/reference/[token]/actions";
import { ShieldBurst } from "@/components/flow/Celebration";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Textarea } from "@/components/ui/Input";
import { ScaleInput } from "@/components/intake/ui";
import { REFEREE_NOTICE } from "@/lib/leaders/consent";
import { salutation } from "@/lib/leaders/status";
import { REFEREE_QUESTIONS, REFEREE_SCALE, type RefereeQuestionId } from "@/lib/leaders/options";

type Ratings = Partial<Record<RefereeQuestionId, 1 | 2 | 3 | 4 | 5>>;

export function ReferenceForm({ token, applicant, referee, relationship }: { token: string; applicant: string; referee: string; relationship: string }) {
  const [ratings, setRatings] = useState<Ratings>({});
  const [concern, setConcern] = useState<"yes" | "no" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const complete =
    REFEREE_QUESTIONS.every((q) => ratings[q.id]) && concern !== null && (concern === "no" || note.trim().length >= 3);

  async function send() {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    const result = await submitReferenceAction(
      token,
      {
        reliability: ratings.reliability!,
        warmth: ratings.warmth!,
        confidentiality: ratings.confidentiality!,
        maturity: ratings.maturity!,
      },
      concern === "yes",
      note,
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  if (sent) {
    return (
      <div className="night rise-in flex flex-col items-center gap-6 rounded-[var(--radius-sheet)] px-6 py-10 text-center">
        <ShieldBurst label="Reference sent" />
        <div className="flex flex-col gap-2">
          <h2 className="t-title">Thank you, {salutation(referee)}.</h2>
          <p className="t-body mx-auto max-w-[36ch] text-white/80">Your reference has gone to the review panel. You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="flex flex-col gap-8"
    >
      <p className="t-small rounded-[var(--radius-control)] bg-gold/20 px-4 py-3 text-ink">
        {REFEREE_NOTICE}{" "}
        <Link href="/privacy" target="_blank" className="font-semibold underline underline-offset-4">
          Privacy notice
        </Link>
      </p>
      <p className="t-body text-soft">
        You are answering as {referee}, {relationship.toLowerCase()}. Rate each from 1 to 5, as you have seen it in {applicant}.
      </p>

      <div className="stagger flex flex-col gap-4">
        {REFEREE_QUESTIONS.map((q, i) => (
          <fieldset key={q.id} style={{ ["--i" as string]: i }} className="card flex flex-col gap-4 p-5">
            <legend className="sr-only">{q.title}</legend>
            <div>
              <h2 className="font-semibold">{q.title}</h2>
              <p className="t-small text-soft">{q.ask}</p>
            </div>
            <ScaleInput
              name={`rate-${q.id}`}
              label={`${q.title}: ${q.ask}`}
              value={ratings[q.id]}
              onChange={(n) => setRatings((r) => ({ ...r, [q.id]: n }))}
              labels={REFEREE_SCALE}
              ends="1 is not really, 5 is always"
            />
          </fieldset>
        ))}
      </div>

      <fieldset className="card flex flex-col gap-4 p-5">
        <legend className="sr-only">Any concern</legend>
        <div>
          <h2 className="font-semibold">Any concern about {applicant} leading others?</h2>
          <p className="t-small text-soft">A yes goes to a pastor, who follows it up with care.</p>
        </div>
        <Segmented
          name="concern"
          label="Any concern about this person leading others"
          value={concern}
          options={[
            { value: "no", label: "No concern" },
            { value: "yes", label: "Yes, I have one" },
          ]}
          onChange={setConcern}
        />
        {concern === "yes" ? (
          <div className="rise-in">
            <Textarea
              label="Tell us what concerns you"
              name="note"
              rows={4}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              hint="Only the pastors and coaches on the panel will read this."
            />
          </div>
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger/10 px-4 py-3 text-[0.95rem] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" fullWidth loading={busy} disabled={!complete}>
        Send my reference
      </Button>
      <p className="t-small text-center text-soft">You can only send this once.</p>
    </form>
  );
}
