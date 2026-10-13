"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitTestimonyAction, withdrawTestimonyAction } from "@/app/(app)/rhythm/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Choice } from "@/components/ui/Choice";
import { Textarea } from "@/components/ui/Input";
import type { RhythmTestimony } from "@/lib/rhythm/types";
import { CREDIT_OPTIONS, SHARE_OPTIONS, TESTIMONY_STATUS } from "@/lib/rhythm/wording";

/** Write a short testimony and choose who reads it and how the name appears. Nothing is shown to anyone until the leader has read it. */
export function TestimonyForm({ testimonies }: { testimonies: RhythmTestimony[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [share, setShare] = useState<"tribe" | "church">("tribe");
  const [credit, setCredit] = useState<"first_name" | "full_name" | "anonymous">("first_name");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const mine = testimonies.filter((t) => t.mine);
  const others = testimonies.filter((t) => !t.mine);

  async function submit() {
    setBusy(true);
    setError(null);
    setSent(false);
    const result = await submitTestimonyAction(body, share, credit);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setBody("");
    setSent(true);
    router.refresh();
  }

  async function withdraw(id: string) {
    setWorking(id);
    setError(null);
    const result = await withdrawTestimonyAction(id);
    setWorking(null);
    if (!result.ok) return setError(result.message);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="card flex flex-col gap-6 p-5 sm:p-8"
      >
        <Textarea
          label="What has God done in your life this season?"
          name="testimony"
          rows={6}
          maxLength={600}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSent(false);
          }}
          hint={`A few sentences is enough. ${600 - body.length} characters left. Leave out other people’s names and private details.`}
        />
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 font-medium">Who may read it?</legend>
          {SHARE_OPTIONS.map((o) => (
            <Choice key={o.value} name="share" value={o.value} checked={share === o.value} onChange={() => setShare(o.value)} title={o.title} description={o.description} />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 font-medium">How should your name appear?</legend>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {CREDIT_OPTIONS.map((o) => (
              <Choice key={o.value} name="credit" value={o.value} checked={credit === o.value} onChange={() => setCredit(o.value)} title={o.title} />
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="t-small text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="md" loading={busy}>
            Send for review
          </Button>
          {sent ? (
            <p role="status" className="t-small text-soft">
              Sent. Your leader will read it first.
            </p>
          ) : null}
        </div>
      </form>

      {mine.length > 0 ? (
        <section aria-labelledby="mine-heading" className="flex flex-col gap-3">
          <h2 id="mine-heading" className="t-heading">
            Yours
          </h2>
          <ul className="stagger flex flex-col gap-3">
            {mine.map((t, i) => (
              <li key={t.id} style={{ ["--i" as string]: Math.min(i, 6) }} className="card flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={t.status === "declined" ? "outline" : t.status === "submitted" ? "neutral" : "gold"}>{TESTIMONY_STATUS[t.status] ?? t.status}</Badge>
                  <span className="t-small text-soft">Week {t.week}</span>
                </div>
                <p className="t-body whitespace-pre-line">{t.body}</p>
                {t.decline_note ? <p className="t-small text-soft">Your leader wrote: {t.decline_note}</p> : null}
                {t.status !== "declined" ? (
                  <div>
                    <Button variant="ghost" size="sm" loading={working === t.id} onClick={() => void withdraw(t.id)}>
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section aria-labelledby="others-heading" className="flex flex-col gap-3">
          <h2 id="others-heading" className="t-heading">
            From your tribe
          </h2>
          <ul className="stagger flex flex-col gap-3">
            {others.map((t, i) => (
              <li key={t.id} style={{ ["--i" as string]: Math.min(i, 6) }} className="night rounded-[var(--radius-card)] p-5">
                <p className="t-body whitespace-pre-line text-white/90">{t.body}</p>
                <p className="t-small mt-3 text-white/70">{t.by}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
