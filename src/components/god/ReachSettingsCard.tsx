"use client";

import { useState } from "react";
import { reachSettingsAction } from "@/app/(app)/god/features/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SETTINGS_WORDS as W, type ReachSettings } from "@/lib/reach/series";

/**
 * The numbers behind the contact series. Only the unlocked owner reaches this page, and the database refuses anyone else again. Changing a number needs a
 * reason, which is kept in the log, and it applies to people who join the series afterwards: a series already running keeps the days it started with.
 */
export function ReachSettingsCard({ settings }: { settings: ReachSettings }) {
  const d = useDo();
  const [firstGo, setFirstGo] = useState(String(settings.firstGoHours));
  const [release, setRelease] = useState(String(settings.releaseAfterDays));
  const [notes, setNotes] = useState(String(settings.notePerWeek));
  const [reason, setReason] = useState("");
  const changed = firstGo !== String(settings.firstGoHours) || release !== String(settings.releaseAfterDays) || notes !== String(settings.notePerWeek);
  return (
    <section aria-labelledby="reach-settings-h" className="card flex flex-col gap-4 p-5" data-testid="reach-settings">
      <div className="flex flex-col gap-1">
        <h2 id="reach-settings-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.line}</p>
        <p className="t-small text-soft">{W.days(settings.emailDays)}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label={W.firstGo} type="number" inputMode="numeric" min={0} max={72} value={firstGo} onChange={(e) => setFirstGo(e.target.value)} />
        <Input label={W.length} type="number" inputMode="numeric" min={4} max={10} value={release} onChange={(e) => setRelease(e.target.value)} />
        <Input label={W.notes} type="number" inputMode="numeric" min={1} max={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Input label={W.why} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      <div>
        <Button
          size="md"
          loading={d.busy === "save"}
          disabled={!changed || reason.trim().length < 5}
          onClick={() =>
            void d.go(
              "save",
              () => reachSettingsAction({ firstGo: Number(firstGo), release: Number(release), endMode: settings.endMode, notes: Number(notes), reason }),
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
