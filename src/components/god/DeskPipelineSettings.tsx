"use client";

import { useState } from "react";
import { saveLimitsAction } from "@/app/(app)/god/leader-desk/open-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { PIPELINE_WORDS as P, checkSettings, type PipelineSettings } from "@/lib/god/desk-open";

const INPUT = "h-12 w-24 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-right text-base focus:border-ink focus:outline-none";

function Row({ id, label, help, value, onChange }: { id: string; label: string; help: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        <p className="t-small text-soft">{help}</p>
      </div>
      <input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
    </div>
  );
}

/** The offer window, the backups per group and the two pipeline limits. Each change needs a reason, which goes in the log; the numbers are checked here and again by the database. */
export function DeskPipelineSettings({ settings }: { settings: PipelineSettings }) {
  const d = useDo();
  const [offerHours, setOfferHours] = useState(String(settings.offerHours));
  const [backups, setBackups] = useState(String(settings.backups));
  const [saidYesDays, setSaidYesDays] = useState(String(settings.saidYesDays));
  const [cardDays, setCardDays] = useState(String(settings.cardDays));
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const F = P.fields;
  const changed = offerHours !== String(settings.offerHours) || backups !== String(settings.backups) || saidYesDays !== String(settings.saidYesDays) || cardDays !== String(settings.cardDays);

  function save() {
    const checked = checkSettings({ offerHours, backups, saidYesDays, cardDays, reason });
    if (!checked.ok) return setProblem(checked.message);
    setProblem(null);
    const v = checked.value;
    void d.go("limits", () => saveLimitsAction(v.offerHours, v.backups, v.saidYesDays, v.cardDays, v.reason), { saved: P.saved, after: () => setReason("") });
  }

  return (
    <section aria-labelledby="pipeline-limits-title" className="flex flex-col gap-3" data-testid="desk-pipeline-settings">
      <div>
        <h2 id="pipeline-limits-title" className="t-heading">
          {P.settingsTitle}
        </h2>
        <p className="t-small measure text-soft">{P.settingsIntro}</p>
      </div>
      <form
        noValidate
        className="card flex flex-col divide-y divide-line p-0"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Row id="dl-offer-hours" label={F.offerHours.label} help={F.offerHours.help} value={offerHours} onChange={(v) => { setOfferHours(v); setProblem(null); }} />
        <Row id="dl-backups" label={F.backups.label} help={F.backups.help} value={backups} onChange={(v) => { setBackups(v); setProblem(null); }} />
        <Row id="dl-said-yes" label={F.saidYesDays.label} help={F.saidYesDays.help} value={saidYesDays} onChange={(v) => { setSaidYesDays(v); setProblem(null); }} />
        <Row id="dl-card" label={F.cardDays.label} help={F.cardDays.help} value={cardDays} onChange={(v) => { setCardDays(v); setProblem(null); }} />
        <div className="flex flex-col gap-2 px-5 py-4">
          <label htmlFor="dl-reason" className="font-semibold">
            {F.reason.label}
          </label>
          <input
            id="dl-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => { setReason(e.target.value); setProblem(null); }}
            className="h-12 w-full rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base focus:border-ink focus:outline-none"
          />
          <p className="t-small text-soft">{F.reason.help}</p>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <div>
            <Button type="submit" size="sm" variant="solid" loading={d.busy === "limits"} disabled={!changed}>
              {P.save}
            </Button>
          </div>
          <Notice error={problem ?? d.error} saved={d.saved} />
        </div>
      </form>
    </section>
  );
}
