import type { EarlierSeason, Retention } from "@/lib/dashboard/insight";
import { pct } from "@/lib/dashboard/wording";

const W = 360;
const H = 190;
const PAD = { left: 38, right: 14, top: 14, bottom: 28 };

/**
 * The share of a season's members who were still coming, week by week. The current season is the strong line;
 * earlier seasons are faint, so a drop can be compared with last time. Drawn as plain SVG, with the same numbers
 * in a table for screen readers.
 */
export function RetentionChart({ weeks, current, earlier, name }: { weeks: number; current: Retention; earlier: EarlierSeason[]; name: string }) {
  const x = (week: number) => PAD.left + ((week - 1) / Math.max(weeks - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (rate: number) => PAD.top + (1 - rate) * (H - PAD.top - PAD.bottom);
  const line = (points: { week: number; rate: number | null }[]) =>
    points
      .filter((p) => p.rate !== null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.week).toFixed(1)} ${y(p.rate as number).toFixed(1)}`)
      .join(" ");
  const last = current.points[current.points.length - 1];
  const slots = Array.from({ length: weeks }, (_, i) => i + 1);
  const label = last ? `${name}: ${pct(last.rate)} still coming after week ${last.week}` : `${name}: no meetings yet`;

  return (
    <figure className="flex flex-col gap-3" aria-label="Retention by week">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full max-w-[34rem] overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={g === 0 ? 1.5 : 1} />
            <text x={PAD.left - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="var(--soft)">
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        {slots.map((w) => (
          <text key={w} x={x(w)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--soft)">
            {w}
          </text>
        ))}
        {earlier.map((s) => (
          <path key={s.season_id} d={line(s.points)} fill="none" stroke="var(--soft)" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        <path d={line(current.points)} fill="none" stroke="var(--crest-flame)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
        {current.points.map((p) =>
          p.rate === null ? null : <circle key={p.week} cx={x(p.week)} cy={y(p.rate)} r="3.5" fill="var(--raised)" stroke="var(--crest-flame)" strokeWidth="2" />,
        )}
        {last && last.rate !== null ? (
          <text x={Math.min(x(last.week) + 2, W - PAD.right)} y={y(last.rate) - 10} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--ink)">
            {pct(last.rate)}
          </text>
        ) : null}
      </svg>
      <figcaption className="t-small flex flex-wrap gap-x-5 gap-y-1 text-soft">
        <span>
          <span aria-hidden="true" className="mr-1.5 inline-block h-0.5 w-5 rounded bg-flame align-middle" />
          {name}
        </span>
        {earlier.map((s) => (
          <span key={s.season_id}>
            <span aria-hidden="true" className="mr-1.5 inline-block w-5 border-t-2 border-dashed border-soft align-middle" />
            {s.name}
          </span>
        ))}
        <span>Week of the season</span>
      </figcaption>
      <table className="sr-only">
        <caption>Share of members still coming, by week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">{name}</th>
            {earlier.map((s) => (
              <th key={s.season_id} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((w) => (
            <tr key={w}>
              <th scope="row">{w}</th>
              <td>{pct(current.points.find((p) => p.week === w)?.rate ?? null)}</td>
              {earlier.map((s) => (
                <td key={s.season_id}>{pct(s.points.find((p) => p.week === w)?.rate ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
