"use client";

import { useState } from "react";
import { placedNudgeSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { NUDGE_SETTINGS_WORDS as W, type NudgeSettings } from "@/lib/placement/nudge";

/**
 * The three numbers behind the placed-member nudge. Only the unlocked owner reaches this page, and the database refuses anyone else again. A change needs a
 * reason, which is kept in the log, and it applies from the next count: a nudge already sent stays sent.
 */
export function PlacedNudgeSettingsCard({ settings }: { settings: NudgeSettings }) {
  const d = useDo();
  const [first, setFirst] = useState(String(settings.firstAfterHours));
  const [spacing, setSpacing] = useState(String(settings.spacingDays));
  const [max, setMax] = useState(String(settings.maxPerSeat));
  const [reason, setReason] = useState("");
  const changed = first !== String(settings.firstAfterHours) || spacing !== String(settings.spacingDays) || max !== String(settings.maxPerSeat);
  return (
    <section aria-labelledby="nudge-settings-h" className="card flex flex-col gap-4 p-5" data-testid="placed-nudge-settings">
      <div className="flex flex-col gap-1">
        <h2 id="nudge-settings-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.intro}</p>
        <p className="t-small text-soft">{W.ranges}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label={W.firstAfter} type="number" inputMode="numeric" min={0} max={240} value={first} onChange={(e) => setFirst(e.target.value)} />
        <Input label={W.spacing} type="number" inputMode="numeric" min={1} max={14} value={spacing} onChange={(e) => setSpacing(e.target.value)} />
        <Input label={W.max} type="number" inputMode="numeric" min={1} max={4} value={max} onChange={(e) => setMax(e.target.value)} />
      </div>
      <Input label={W.reason} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() => void d.go("save", () => placedNudgeSettingsAction({ firstAfter: Number(first), spacing: Number(spacing), max: Number(max), reason }), { saved: W.saved, after: () => setReason("") })}
        >
          {W.save}
        </Button>
      </div>
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
