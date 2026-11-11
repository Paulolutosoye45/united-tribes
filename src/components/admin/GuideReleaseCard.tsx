"use client";

import { useState } from "react";
import { guideReleaseAction } from "@/app/(app)/admin/guides/actions";
import { Notice } from "@/components/admin/Notice";
import { useDo } from "@/components/admin/useDo";
import { Button } from "@/components/ui/Button";
import { RELEASE_MINUTES, RELEASE_WORDS as W, checkRelease, clockWords, type ReleaseSettings } from "@/lib/rhythm/release";

const FIELD = "h-12 min-w-0 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-base text-ink hover:border-soft focus:border-ink focus:outline-none";

/**
 * When leaders can read the next week. Off, a leader can open any week; On, the next week opens the day before it starts (a Saturday) at the time chosen.
 * An admin, a director and a pastor change it; a data lead only reads it. Changing it changes nothing already sent: it decides only what a leader's page shows.
 */
export function GuideReleaseCard({ settings }: { settings: ReleaseSettings }) {
  const d = useDo();
  const [weekly, setWeekly] = useState(settings.weekly);
  const [hour, setHour] = useState(String(settings.hour));
  const [minute, setMinute] = useState(String(settings.minute));
  const [problem, setProblem] = useState<string | null>(null);
  const changed = weekly !== settings.weekly || hour !== String(settings.hour) || minute !== String(settings.minute);
  return (
    <section aria-labelledby="release-h" className="card flex flex-col gap-4 p-5" data-testid="guide-release">
      <div className="flex flex-col gap-1">
        <h2 id="release-h" className="t-heading">{W.title}</h2>
        <p className="t-small max-w-[64ch] text-soft">{W.intro}</p>
      </div>
      <label className="t-body flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={weekly} disabled={!settings.canEdit} onChange={(e) => setWeekly(e.target.checked)} />
        <span>{W.label}</span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[0.95rem] font-medium">
          {W.at}
          <span className="flex items-center gap-2">
            <select aria-label="Hour" className={FIELD} value={hour} disabled={!settings.canEdit || !weekly} onChange={(e) => setHour(e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}</option>
              ))}
            </select>
            <span aria-hidden="true">:</span>
            <select aria-label="Minutes" className={FIELD} value={minute} disabled={!settings.canEdit || !weekly} onChange={(e) => setMinute(e.target.value)}>
              {RELEASE_MINUTES.map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
              ))}
            </select>
          </span>
        </label>
        <p className="t-small text-soft" data-testid="release-help">
          {weekly ? W.onHelp(Number(hour) || 0, Number(minute) || 0) : W.offHelp}
          {weekly ? ` (${clockWords(Number(hour) || 0, Number(minute) || 0)})` : ""}
        </p>
      </div>
      {settings.canEdit ? (
        <div>
          <Button
            size="md"
            loading={d.busy === "save"}
            disabled={!changed}
            onClick={() => {
              const checked = checkRelease({ weekly, hour, minute });
              if (!checked.ok) return setProblem(checked.message);
              setProblem(null);
              void d.go("save", () => guideReleaseAction(checked.value.weekly, checked.value.hour, checked.value.minute), { saved: W.saved });
            }}
          >
            {W.save}
          </Button>
        </div>
      ) : null}
      {problem ? <p role="alert" className="t-small font-medium text-danger">{problem}</p> : null}
      {settings.changedAt ? <p className="t-small text-soft">{W.lastChange(settings.changedBy, settings.changedAt)}</p> : null}
      <Notice error={d.error} saved={d.saved} />
    </section>
  );
}
