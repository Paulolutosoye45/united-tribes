import { gapCount, type GapCause, type GapTrend as Trend } from "@/lib/contact-gaps/gaps";

const total = (t: Trend): number => gapCount({ unreachable: 0, no_number: 0, no_yes: 0, made_up: 0, not_open: 0, withheld: 0, ...t.counts } as Record<GapCause, number>);

/** The people a leader cannot reach, day by day (the days the list was opened). Bars with the numbers in words, never a picture alone. */
export function GapTrend({ trend }: { trend: Trend[] }) {
  if (trend.length < 2) {
    return <p className="t-small text-soft">The trend appears after the list has been opened on two different days.</p>;
  }
  const values = trend.map(total);
  const max = Math.max(...values, 1);
  const first = trend[0];
  const last = trend[trend.length - 1];
  const was = values[0];
  const now = values[values.length - 1];
  const words = now === was ? `Still ${now}` : now < was ? `Down from ${was} to ${now}` : `Up from ${was} to ${now}`;
  return (
    <figure className="flex flex-col gap-2" data-testid="gap-trend">
      <figcaption className="t-small text-soft">
        {words} since {first.day}.
      </figcaption>
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`${words} between ${first.day} and ${last.day}`}>
        {trend.map((t, i) => (
          <div key={t.day} title={`${t.day}: ${values[i]}`} className="min-w-1 flex-1 rounded-sm bg-charcoal/70" style={{ height: `${Math.max(4, Math.round((values[i] / max) * 100))}%` }} />
        ))}
      </div>
    </figure>
  );
}
