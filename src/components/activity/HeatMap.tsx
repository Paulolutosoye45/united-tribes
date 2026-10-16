import { GROUP_ORDER, GROUP_PLURAL, WEEKDAY_NAMES, hourLabel, num, show } from "@/lib/activity/format";
import type { Cell, Heatmap } from "@/lib/activity/types";

const CELL = 20;
const LEFT = 36;
const TOP = 4;

type Slot = { dow: number; hour: number; people: Cell };

/** When people are active: weekday down the side, hour of the Lagos day across. A cell of fewer than 5 people is pale and reads "<5". */
export function HeatMap({ cells, days }: { cells: Heatmap["cells"]; days: number }) {
  const grid = new Map<string, Cell>();
  let max = 0;
  for (const c of cells) {
    grid.set(`${c.dow}-${c.hour}`, c.people);
    if (typeof c.people === "number") max = Math.max(max, c.people);
  }
  const W = LEFT + 24 * CELL;
  const H = TOP + 7 * CELL + 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Different people active, by weekday and hour, over the last ${days} days`} className="h-auto w-full">
      {WEEKDAY_NAMES.map((name, r) => (
        <text key={name} x={LEFT - 6} y={TOP + r * CELL + 14} textAnchor="end" fontSize="11" fill="var(--soft)">
          {name}
        </text>
      ))}
      {Array.from({ length: 24 }, (_, h) =>
        h % 3 === 0 ? (
          <text key={h} x={LEFT + h * CELL + CELL / 2} y={TOP + 7 * CELL + 15} textAnchor="middle" fontSize="10" fill="var(--soft)">
            {String(h).padStart(2, "0")}
          </text>
        ) : null,
      )}
      {WEEKDAY_NAMES.map((name, r) =>
        Array.from({ length: 24 }, (_, h) => {
          const v = grid.get(`${r + 1}-${h}`);
          const hidden = v === "<5";
          const level = typeof v === "number" && max > 0 ? v / max : 0;
          return (
            <rect
              key={`${r}-${h}`}
              x={LEFT + h * CELL + 1}
              y={TOP + r * CELL + 1}
              width={CELL - 2}
              height={CELL - 2}
              rx={4}
              fill={hidden ? "var(--surface-strong)" : level > 0 ? "var(--crest-flame)" : "var(--surface)"}
              fillOpacity={hidden || level === 0 ? 1 : 0.15 + 0.85 * level}
            >
              <title>{`${name} ${hourLabel(h)}: ${v === undefined ? "no one" : hidden ? "fewer than 5 people" : `${num(v as number)} ${v === 1 ? "person" : "people"}`}`}</title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}

export function HeatLegend() {
  return (
    <p className="t-small flex flex-wrap items-center gap-x-4 gap-y-1 text-soft">
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded bg-flame opacity-20" />
        few
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded bg-flame" />
        many people
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-3 w-3 rounded bg-surface-strong" />
        “&lt;5” fewer than 5 people
      </span>
    </p>
  );
}

/** The busiest times, as a short table. */
export function HeatTable({ cells }: { cells: Heatmap["cells"] }) {
  const slots: Slot[] = cells
    .map((c) => ({ dow: c.dow, hour: c.hour, people: c.people }))
    .sort((a, b) => (typeof b.people === "number" ? b.people : 0) - (typeof a.people === "number" ? a.people : 0))
    .slice(0, 14);
  return (
    <table className="t-small w-full min-w-[16rem] text-left [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">The busiest times of the week</caption>
      <thead>
        <tr className="text-soft">
          <th scope="col" className="py-1 pr-4 font-medium">
            Day
          </th>
          <th scope="col" className="py-1 pr-4 font-medium">
            Hour (Lagos)
          </th>
          <th scope="col" className="py-1 font-medium">
            Different people
          </th>
        </tr>
      </thead>
      <tbody>
        {slots.map((s) => (
          <tr key={`${s.dow}-${s.hour}`} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {WEEKDAY_NAMES[s.dow - 1]}
            </th>
            <td className="py-1 pr-4">{hourLabel(s.hour)}</td>
            <td className="py-1">{show(s.people)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** For each group large enough to show, the share of its activity at each hour of the day. */
export function HourBars({ groups }: { groups: Heatmap["groups"] }) {
  const keys = [...GROUP_ORDER, ...Object.keys(groups).filter((k) => !(GROUP_ORDER as readonly string[]).includes(k))].filter((k) => groups[k]);
  if (keys.length === 0) return <p className="t-small text-soft">No group is large enough to show on its own yet.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {keys.map((k) => {
        const hours = groups[k];
        const total = hours.reduce((a, b) => a + b, 0) || 1;
        const peak = Math.max(...hours, 1);
        const best = hours.indexOf(Math.max(...hours));
        return (
          <li key={k} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:items-center">
            <span className="text-[0.92rem] font-medium">
              {GROUP_PLURAL[k] ?? k}
              <span className="t-small block font-normal text-soft">busiest around {hourLabel(best)}</span>
            </span>
            <svg viewBox="0 0 240 36" className="h-9 w-full" role="img" aria-label={`${GROUP_PLURAL[k] ?? k}: share of activity by hour of the day, busiest around ${hourLabel(best)}`}>
              {hours.map((v, h) => (
                <rect key={h} x={h * 10 + 1} y={34 - (v / peak) * 32} width={8} height={Math.max(1, (v / peak) * 32)} rx={2} fill="var(--crest-flame)" fillOpacity={h === best ? 1 : 0.5}>
                  <title>{`${hourLabel(h)}: ${Math.round((v / total) * 100)}% of the activity`}</title>
                </rect>
              ))}
            </svg>
          </li>
        );
      })}
    </ul>
  );
}
