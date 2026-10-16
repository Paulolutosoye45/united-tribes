import { shortDay, num } from "@/lib/activity/format";

const W = 560;
const H = 210;
const PAD = { left: 42, right: 12, top: 14, bottom: 28 };

/** A tidy top for the axis: 4, 5, 10, 20, 50, 100 and so on. */
export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 5, 10]) if (v <= step * mag) return step * mag;
  return 10 * mag;
}

/**
 * One number a day for 30 days: the strong line is now, the dashed one is the same days in the 30 days before, so a rise or a
 * dip can be told from the usual. Plain SVG; the table beside it holds the same numbers.
 */
export function TrendChart({ days, now, prev, label }: { days: string[]; now: number[]; prev: number[]; label: string }) {
  const n = Math.max(days.length, 2);
  const top = niceMax(Math.max(1, ...now, ...prev));
  const x = (i: number) => PAD.left + (i / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const path = (xs: number[]) => xs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const total = now.reduce((a, b) => a + b, 0);
  const before = prev.reduce((a, b) => a + b, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}, by day for ${days.length} days: ${num(total)} in all, against ${num(before)} in the days before`} className="h-auto w-full overflow-visible">
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(g * top)} y2={y(g * top)} stroke="var(--line)" strokeWidth={g === 0 ? 1.5 : 1} />
          <text x={PAD.left - 6} y={y(g * top) + 4} textAnchor="end" fontSize="11" fill="var(--soft)">
            {num(g * top)}
          </text>
        </g>
      ))}
      {days.map((d, i) =>
        i % 7 === 0 || i === days.length - 1 ? (
          <text key={d} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--soft)">
            {shortDay(d)}
          </text>
        ) : null,
      )}
      <path d={path(prev)} fill="none" stroke="var(--soft)" strokeOpacity="0.7" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
      <path d={path(now)} fill="none" stroke="var(--crest-flame)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {now.length > 0 ? <circle cx={x(now.length - 1)} cy={y(now[now.length - 1])} r="4" fill="var(--crest-flame)" /> : null}
    </svg>
  );
}

export function TrendLegend() {
  return (
    <p className="t-small flex flex-wrap gap-x-5 gap-y-1 text-soft">
      <span>
        <span aria-hidden="true" className="mr-1.5 inline-block h-0.5 w-5 rounded bg-flame align-middle" />
        These 30 days
      </span>
      <span>
        <span aria-hidden="true" className="mr-1.5 inline-block h-0 w-5 border-t-2 border-dashed border-soft align-middle" />
        The 30 days before
      </span>
    </p>
  );
}

export function TrendTable({ days, now, prev, label }: { days: string[]; now: number[]; prev: number[]; label: string }) {
  return (
    <table className="t-small w-full min-w-[18rem] text-left [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">{label} by day</caption>
      <thead>
        <tr className="text-soft">
          <th scope="col" className="py-1 pr-4 font-medium">
            Day
          </th>
          <th scope="col" className="py-1 pr-4 font-medium">
            These 30 days
          </th>
          <th scope="col" className="py-1 font-medium">
            The 30 days before
          </th>
        </tr>
      </thead>
      <tbody>
        {days.map((d, i) => (
          <tr key={d} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {shortDay(d)}
            </th>
            <td className="py-1 pr-4">{num(now[i] ?? 0)}</td>
            <td className="py-1">{num(prev[i] ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
