import Link from "next/link";
import { cn } from "@/lib/cn";
import type { WeekRow } from "@/lib/rhythm/types";

function label(r: WeekRow): string {
  if (r.state === "future") return `Week ${r.week}, not yet`;
  if (r.state === "now") return `Week ${r.week}, this week`;
  if (r.held === false) return `Week ${r.week}, no meeting`;
  if (r.attended === "present") return `Week ${r.week}, you came`;
  if (r.attended === "absent") return `Week ${r.week}, you were away`;
  if (r.attended === "excused") return `Week ${r.week}, you were excused`;
  return `Week ${r.week}`;
}

/** The twelve weeks as twelve small marks. Tap a week that has started to read its guide. */
export function WeekStrip({ rows, viewing, attended, logged }: { rows: WeekRow[]; viewing: number; attended: number; logged: number }) {
  return (
    <section aria-labelledby="strip-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="strip-heading" className="t-heading">
          Your twelve weeks
        </h2>
        <p className="t-small text-soft">{logged === 0 ? "No meetings logged yet." : `You have been to ${attended} of ${logged} meetings.`}</p>
      </div>
      <ol className="grid grid-cols-6 gap-2 sm:grid-cols-12">
        {rows.map((r) => {
          const started = r.state !== "future";
          const cell = (
            <span
              className={cn(
                "grid h-11 w-full place-items-center rounded-xl border-[1.5px] text-[0.95rem] font-semibold transition-[background-color,border-color,transform] duration-200",
                r.state === "future" && "border-line/70 text-soft/60",
                r.state === "now" && "border-ink bg-gold/30",
                r.state === "past" && r.attended === "present" && "border-transparent bg-gold",
                r.state === "past" && r.attended !== "present" && "border-line bg-surface-strong text-soft",
                viewing === r.week && r.state !== "now" && "ring-2 ring-ink ring-offset-2 ring-offset-raised",
                started && "hover:-translate-y-0.5",
              )}
            >
              <span aria-hidden="true">{r.week}</span>
              <span className="sr-only">{label(r)}</span>
            </span>
          );
          return (
            <li key={r.week}>
              {started ? (
                <Link href={r.state === "now" ? "/circle" : `/circle?week=${r.week}`} aria-current={viewing === r.week ? "true" : undefined} className="press block rounded-xl">
                  {cell}
                </Link>
              ) : (
                cell
              )}
            </li>
          );
        })}
      </ol>
      <p className="t-small text-soft">
        <span aria-hidden="true" className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-gold align-baseline" />
        You came. <span className="ml-3">Tap a week to read its guide.</span>
      </p>
    </section>
  );
}
