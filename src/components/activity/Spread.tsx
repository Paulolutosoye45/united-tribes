import { isHidden, num, show } from "@/lib/activity/format";
import type { Funnel } from "@/lib/activity/types";

type Finish = NonNullable<Funnel["finish"]>;

const minutes = (s: number | null) => (s === null ? "–" : `${num(Math.round((s / 60) * 10) / 10)} min`);

/** How long people took to finish the member form, in bands. A band of fewer than 5 people is a stub marked "<5". */
export function Spread({ finish }: { finish: Finish }) {
  const top = Math.max(1, ...finish.bins.map((b) => (typeof b.n === "number" ? b.n : 0)));
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-6 items-end gap-2" aria-label="Forms finished, by time taken">
        {finish.bins.map((b) => {
          const hidden = isHidden(b.n);
          const h = hidden ? 6 : b.n === 0 ? 0 : Math.max(2, ((b.n as number) / top) * 100);
          return (
            <li key={b.label} className="flex flex-col items-center gap-1">
              <span className="t-small [font-variant-numeric:tabular-nums]">{show(b.n)}</span>
              <span className="flex h-28 w-full items-end" aria-hidden="true">
                <span
                  className={hidden ? "block w-full rounded-t-lg bg-[repeating-linear-gradient(45deg,var(--soft)_0_3px,transparent_3px_6px)] opacity-50" : "block w-full rounded-t-lg bg-flame"}
                  style={{ height: `${h}%` }}
                />
              </span>
              <span className="t-small text-center text-soft">{b.label}</span>
            </li>
          );
        })}
      </ul>
      <dl className="t-small flex flex-wrap gap-x-6 gap-y-1 text-soft">
        {(
          [
            ["Quarter finished within", finish.p25],
            ["Half within", finish.p50],
            ["Three quarters within", finish.p75],
            ["Nine in ten within", finish.p90],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt>{k}</dt>
            <dd className="font-medium text-ink">{minutes(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SpreadTable({ finish }: { finish: Finish }) {
  return (
    <table className="t-small w-full min-w-[16rem] text-left [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">Forms finished, by time taken</caption>
      <thead>
        <tr className="text-soft">
          <th scope="col" className="py-1 pr-4 font-medium">
            Time taken
          </th>
          <th scope="col" className="py-1 font-medium">
            Forms
          </th>
        </tr>
      </thead>
      <tbody>
        {finish.bins.map((b) => (
          <tr key={b.label} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {b.label}
            </th>
            <td className="py-1">{show(b.n)}</td>
          </tr>
        ))}
        {(
          [
            ["Quarter finished within", finish.p25],
            ["Half within", finish.p50],
            ["Three quarters within", finish.p75],
            ["Nine in ten within", finish.p90],
          ] as const
        ).map(([k, v]) => (
          <tr key={k} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {k}
            </th>
            <td className="py-1">{minutes(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
