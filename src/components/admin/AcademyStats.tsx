import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import type { AcademyStats } from "@/lib/academy/types";
import { REQUIRED_MODES, type AcademyModes } from "@/lib/academy/modes";

/**
 * Totals for the office. No names and no scores, only counts. When the Academy is switched off, the training figures say so
 * instead of showing zeros that could be mistaken for a problem.
 */
export function AcademyStatsPanel({ stats, modes = REQUIRED_MODES }: { stats: AcademyStats; modes?: AcademyModes }) {
  const off = modes.academy === "off";
  const tiles = [
    off
      ? { label: "Academy", value: "Off", note: modes.declaration === "required" ? "Switched off; only the signed declaration is asked for" : "Switched off; certification needs only an approved Tribe Card" }
      : { label: "In training", value: String(stats.trainees - stats.certified), note: `${stats.leaders} leaders, ${stats.assistants} assistants approved` },
    { label: "Certified", value: String(stats.certified), note: `${stats.certified_leaders} leaders, ${stats.certified_assistants} assistants` },
    { label: "Tribe Cards", value: String(stats.cards_approved), note: `${stats.cards_submitted} waiting, ${stats.cards_paired} with an assistant` },
    off
      ? { label: "Workshops ahead", value: String(stats.upcoming_workshops), note: "bookings are closed while the Academy is off" }
      : { label: "Workshops ahead", value: String(stats.upcoming_workshops), note: `${stats.practice_ready} practice sessions ready` },
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>
      {!off && stats.modules.length > 0 ? (
        <div className="card flex flex-col gap-3 p-5">
          <h3 className="font-semibold">Where leaders are in the course</h3>
          <ol className="flex flex-col gap-2.5">
            {stats.modules.map((m) => {
              const pct = m.opened > 0 ? Math.round((m.passed / m.opened) * 100) : 0;
              return (
                <li key={m.number} className="flex items-center gap-3">
                  <span className="t-small w-48 shrink-0 truncate sm:w-60">
                    {m.number}. {m.title}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${m.passed} of ${m.opened} who opened it have passed`}>
                    <span className="block h-full rounded-full bg-flame" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="t-small w-16 shrink-0 text-right text-soft">
                    {m.passed}/{m.opened}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
      <div>
        <Link href="/review/academy" className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Manage workshops</span>
        </Link>
      </div>
    </div>
  );
}
