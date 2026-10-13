import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { plural } from "@/lib/dates";
import type { DashTribe, Headline } from "@/lib/dashboard/types";
import { VERDICTS, pct, signed } from "@/lib/dashboard/wording";

/** One line saying how many tribes are where, then every tribe with the one that needs help first. */
export function TribeResults({ tribes, verdicts, canOpen, complete }: { tribes: DashTribe[]; verdicts: Headline["verdicts"]; canOpen: boolean; complete: boolean }) {
  const summary = complete
    ? [
        { text: `${verdicts.effective} effective`, tone: "gold" as const },
        { text: `${verdicts.not_yet} not there yet`, tone: "flame" as const },
      ]
    : [
        { text: `${verdicts.on_course} on course`, tone: "gold" as const },
        { text: `${verdicts.close} close`, tone: "neutral" as const },
        { text: `${verdicts.at_risk} at risk`, tone: "flame" as const },
      ];

  return (
    <section aria-labelledby="tribes-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tribes-heading" className="t-heading">
          Tribes
        </h2>
        <p className="flex flex-wrap gap-2">
          {summary.map((s) => (
            <Badge key={s.text} tone={s.tone}>
              {s.text}
            </Badge>
          ))}
        </p>
      </div>
      {tribes.length === 0 ? (
        <p className="t-body text-soft">No tribes with members yet.</p>
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {tribes.map((c, i) => {
            const v = VERDICTS[c.verdict];
            const body = (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{c.name}</p>
                    <p className="t-small text-soft">
                      Led by {c.leader}
                      {c.coach ? ` · coach ${c.coach}` : " · no coach yet"}
                      {c.community ? ` · ${c.community}` : ""}
                    </p>
                  </div>
                  <Badge tone={v.tone}>{v.text}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
                  <Stat label="Members" value={`${c.members} of ${c.capacity}`} />
                  <Stat label="Came" value={pct(c.attendance_rate)} />
                  <Stat label="Thriving" value={c.thriving_rate === null ? "–" : `${c.thriving} · ${pct(c.thriving_rate)}`} />
                  <Stat label="Success Picture" value={c.gain_avg === null ? "–" : signed(c.gain_avg)} />
                  <Stat label="Steps done" value={pct(c.steps_done_rate)} />
                </dl>
                <p className="t-small text-soft">{v.line}</p>
              </div>
            );
            return (
              <li key={c.tribe_id} style={{ ["--i" as string]: Math.min(i, 8) }}>
                {canOpen ? (
                  <Link href={`/lead/progress?tribe=${c.tribe_id}`} className="card press block p-4 transition-shadow hover:shadow-[var(--shadow-pop)] sm:p-5" aria-label={`${c.name}, ${v.text}. Open its progress.`}>
                    {body}
                  </Link>
                ) : (
                  <div className="card p-4 sm:p-5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="t-small text-soft">
        {plural(tribes.length, "tribe")} shown. A tribe is effective when at least 80% of its members thrive and at least 70% gain two points or more on the Success Picture. That is judged when the season ends.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-small text-soft">{label}</dt>
      <dd className="font-semibold [font-variant-numeric:tabular-nums]">{value}</dd>
    </div>
  );
}
