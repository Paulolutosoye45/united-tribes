"use client";

import { useState } from "react";
import { saveSettingsAction } from "@/app/(app)/god/leader-desk/send-actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SEND_WORDS as S, type SendState } from "@/lib/god/desk-send";

/** The four limits on the Desk's email. Every change needs a reason; the database checks the ranges again and says in words what is wrong. */
export function DeskSettings({ state }: { state: SendState }) {
  const d = useDo();
  const [daily, setDaily] = useState(String(state.dailyCap));
  const [gap, setGap] = useState(String(state.gapDays));
  const [season, setSeason] = useState(String(state.seasonCap));
  const [hours, setHours] = useState(String(state.interestHours));
  const [reason, setReason] = useState("");
  const f = S.fields;
  return (
    <form
      className="card flex flex-col gap-4 p-5"
      data-testid="desk-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void d.go("save", () => saveSettingsAction({ daily: Number(daily), gap: Number(gap), season: Number(season), hours: Number(hours), reason }), {
          saved: "Saved. The new limits apply from the next email.",
          after: () => setReason(""),
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="t-heading">{S.limitsTitle}</h3>
        <p className="t-small measure text-soft">{S.limitsHelp}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={f.daily.label} hint={f.daily.hint} type="number" inputMode="numeric" min={1} max={300} value={daily} onChange={(e) => setDaily(e.target.value)} />
        <Input label={f.gap.label} hint={f.gap.hint} type="number" inputMode="numeric" min={1} max={60} value={gap} onChange={(e) => setGap(e.target.value)} />
        <Input label={f.season.label} hint={f.season.hint} type="number" inputMode="numeric" min={1} max={10} value={season} onChange={(e) => setSeason(e.target.value)} />
        <Input label={f.hours.label} hint={f.hours.hint} type="number" inputMode="numeric" min={12} max={240} value={hours} onChange={(e) => setHours(e.target.value)} />
      </div>
      <Input label={f.reason.label} hint={f.reason.hint} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <Notice error={d.error} saved={d.saved} />
      <div>
        <Button type="submit" size="md" loading={d.busy === "save"} disabled={reason.trim().length < 3}>
          Save the limits
        </Button>
      </div>
    </form>
  );
}
