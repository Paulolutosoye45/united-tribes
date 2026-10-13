import { pct } from "@/lib/dashboard/wording";

/** A tiny line for a rate across days. Shows the latest value; the table is for screen readers. */
export function Sparkline({ title, points }: { title: string; points: { day: string; value: number | null }[] }) {
  const usable = points.filter((p) => p.value !== null) as { day: string; value: number }[];
  const W = 140;
  const H = 44;
  if (usable.length < 2) {
    return (
      <div className="flex flex-col gap-1">
        <span className="t-small text-soft">{title}</span>
        <span className="t-small text-soft">Needs two days of data</span>
      </div>
    );
  }
  const x = (i: number) => 3 + (i / (usable.length - 1)) * (W - 6);
  const lo = Math.min(...usable.map((p) => p.value), 0);
  const hi = Math.max(...usable.map((p) => p.value), 1);
  const y = (v: number) => 4 + (1 - (v - lo) / Math.max(hi - lo, 0.0001)) * (H - 8);
  const d = usable.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const latest = usable[usable.length - 1];
  const first = usable[0];
  const delta = latest.value - first.value;
  return (
    <div className="flex flex-col gap-1">
      <span className="t-small text-soft">{title}</span>
      <div className="flex items-end gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-36 shrink-0" role="img" aria-label={`${title}: ${pct(first.value)} to ${pct(latest.value)} over ${usable.length} days`}>
          <path d={d} fill="none" stroke="var(--crest-flame)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(usable.length - 1)} cy={y(latest.value)} r="3.5" fill="var(--crest-flame)" />
        </svg>
        <span className="flex flex-col leading-tight">
          <strong className="text-lg [font-variant-numeric:tabular-nums]">{pct(latest.value)}</strong>
          <span className="t-small text-soft [font-variant-numeric:tabular-nums]">{delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta * 100))} points`}</span>
        </span>
      </div>
      <table className="sr-only">
        <caption>{title} by day</caption>
        <tbody>
          {usable.map((p) => (
            <tr key={p.day}>
              <th scope="row">{p.day}</th>
              <td>{pct(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
