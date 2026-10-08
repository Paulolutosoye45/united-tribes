import { pct } from "@/lib/dashboard/wording";

export type BarWeek = { week: number; attendance: number | null; steps: number | null; current?: boolean };

/**
 * Week by week: how many came, and how many finished their step. Two bars a week, so a phone shows all twelve.
 * The dashed line is the pace that reaches the thriving bar (8 of 12 meetings).
 */
export function WeekBars({ weeks, rows, pace, title }: { weeks: number; rows: BarWeek[]; pace: number; title: string }) {
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  const slots = Array.from({ length: weeks }, (_, i) => i + 1);
  const H = 132;
  return (
    <figure className="card flex flex-col gap-4 p-5 sm:p-7" aria-label={title}>
      <figcaption className="flex flex-col gap-1">
        <span className="t-heading">{title}</span>
        <span className="t-small text-soft">
          <span aria-hidden="true" className="mr-1.5 inline-block size-2.5 rounded-sm bg-flame align-middle" />
          Came to the meeting
          <span aria-hidden="true" className="ml-4 mr-1.5 inline-block size-2.5 rounded-sm bg-charcoal align-middle" />
          Finished their step
        </span>
      </figcaption>
      <div className="relative" style={{ height: H + 26 }}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-flame-deep/50" style={{ top: H * (1 - pace) }} aria-hidden="true" />
        <span className="t-small absolute right-0 rounded bg-raised px-1 text-flame-deep" style={{ top: H * (1 - pace) - 20 }} aria-hidden="true">
          on pace
        </span>
        <ol className="absolute inset-x-0 top-0 grid h-full items-end gap-1" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
          {slots.map((w) => {
            const r = byWeek.get(w);
            return (
              <li key={w} className="flex h-full flex-col items-center justify-end gap-1.5">
                <div className="flex w-full items-end justify-center gap-[3px]" style={{ height: H }}>
                  <span
                    className="bar-up w-[38%] max-w-3.5 rounded-t-[5px] bg-flame"
                    style={{ height: `${Math.max(r?.attendance != null ? r.attendance * 100 : 0, r?.attendance != null ? 3 : 0)}%`, ["--i" as string]: w }}
                    title={r?.attendance != null ? `Week ${w}: ${pct(r.attendance)} came` : `Week ${w}: no meeting logged`}
                  />
                  <span
                    className="bar-up w-[38%] max-w-3.5 rounded-t-[5px] bg-charcoal"
                    style={{ height: `${Math.max(r?.steps != null ? r.steps * 100 : 0, r?.steps != null ? 3 : 0)}%`, ["--i" as string]: w }}
                    title={r?.steps != null ? `Week ${w}: ${pct(r.steps)} finished their step` : `Week ${w}: no step check-ins`}
                  />
                </div>
                <span className={`t-small ${r?.current ? "font-bold text-ink" : "text-soft"}`} aria-hidden="true">
                  {w}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Came</th>
            <th scope="col">Finished their step</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((w) => (
            <tr key={w}>
              <th scope="row">{w}</th>
              <td>{pct(byWeek.get(w)?.attendance ?? null)}</td>
              <td>{pct(byWeek.get(w)?.steps ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
