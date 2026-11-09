"use client";

import { useState } from "react";
import { placedAnswersSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ANSWERS_SETTINGS_WORDS as W, type AnswersSettings } from "@/lib/placement/answers";

/**
 * The numbers behind the placed answer sequence, the board and the call desk. Only the unlocked owner reaches this page, and the database refuses anyone else
 * again. A change needs a reason, which is kept in the log, and it applies from the next step: an email already sent stays sent.
 */
export function PlacedAnswersSettingsCard({ settings }: { settings: AnswersSettings }) {
  const d = useDo();
  const [second, setSecond] = useState(String(settings.secondAfterHours));
  const [step3, setStep3] = useState(String(settings.step3Days));
  const [last, setLast] = useState(String(settings.lastCallHours));
  const [pace, setPace] = useState(String(settings.paceHours));
  const [max, setMax] = useState(String(settings.maxEmails));
  const [tries, setTries] = useState(String(settings.callTries));
  const [download, setDownload] = useState(settings.numbersDownload);
  const [reason, setReason] = useState("");
  const changed =
    second !== String(settings.secondAfterHours) || step3 !== String(settings.step3Days) || last !== String(settings.lastCallHours) ||
    pace !== String(settings.paceHours) || max !== String(settings.maxEmails) || tries !== String(settings.callTries) || download !== settings.numbersDownload;
  return (
    <section aria-labelledby="answers-settings-h" className="card flex flex-col gap-4 p-5" data-testid="placed-answers-settings">
      <div className="flex flex-col gap-1">
        <h2 id="answers-settings-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.intro}</p>
        <p className="t-small text-soft">{W.ranges}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label={W.secondAfter} type="number" inputMode="numeric" min={1} max={240} value={second} onChange={(e) => setSecond(e.target.value)} />
        <Input label={W.step3} type="number" inputMode="numeric" min={1} max={14} value={step3} onChange={(e) => setStep3(e.target.value)} />
        <Input label={W.lastCall} type="number" inputMode="numeric" min={6} max={96} value={last} onChange={(e) => setLast(e.target.value)} />
        <Input label={W.pace} type="number" inputMode="numeric" min={1} max={72} value={pace} onChange={(e) => setPace(e.target.value)} />
        <Input label={W.max} type="number" inputMode="numeric" min={2} max={10} value={max} onChange={(e) => setMax(e.target.value)} />
        <Input label={W.tries} type="number" inputMode="numeric" min={1} max={6} value={tries} onChange={(e) => setTries(e.target.value)} />
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--crest-flame)]" data-testid="answers-download-switch" />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{W.download}</span>
          <span className="t-small text-soft">{W.downloadHelp}</span>
        </span>
      </label>
      <Input label={W.reason} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() =>
            void d.go(
              "save",
              () => placedAnswersSettingsAction({ secondAfter: Number(second), step3Days: Number(step3), lastCall: Number(last), pace: Number(pace), max: Number(max), tries: Number(tries), download, reason }),
              { saved: W.saved, after: () => setReason("") },
            )
          }
        >
          {W.save}
        </Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
