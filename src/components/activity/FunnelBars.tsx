import Link from "next/link";
import { cn } from "@/lib/cn";
import { HIDDEN, hoursText, isHidden, pctText, show } from "@/lib/activity/format";
import type { FunnelStage } from "@/lib/activity/types";

/**
 * Bars for how many people reached each step. Each bar opens the people who stopped there. A bar of fewer than 5 people is
 * drawn as a small hatched stub that reads "<5": the number, and the names, are not shown.
 */
export function FunnelBars({ stages, hrefFor, active }: { stages: FunnelStage[]; hrefFor: (k: number) => string; active: number | null }) {
  const first = stages[0]?.reached;
  const top = typeof first === "number" && first > 0 ? first : null;
  return (
    <ol className="flex flex-col gap-2" aria-label="Where people got to">
      {stages.map((s) => {
        const hidden = isHidden(s.reached);
        const width = hidden ? 3 : top && s.reached !== 0 ? Math.max(1.5, ((s.reached as number) / top) * 100) : 0;
        return (
          <li key={s.key}>
            <Link
              href={hrefFor(s.k)}
              aria-current={active === s.k ? "true" : undefined}
              className={cn("press grid gap-x-4 gap-y-1 rounded-2xl p-2 sm:grid-cols-[11rem_1fr_9rem] sm:items-center", active === s.k ? "bg-surface" : "hover:bg-surface")}
            >
              <span className="text-[0.92rem] font-medium">{s.label}</span>
              <span className="h-5 rounded-full bg-surface-strong" aria-hidden="true">
                <span
                  className={cn("block h-5 rounded-full", hidden ? "bg-[repeating-linear-gradient(45deg,var(--soft)_0_3px,transparent_3px_6px)] opacity-50" : "bg-flame")}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="t-small flex items-baseline justify-between gap-3 [font-variant-numeric:tabular-nums] sm:justify-end">
                <strong className="text-base">{show(s.reached)}</strong>
                <span className="text-soft">{hidden ? "" : s.pct_start === null ? "" : `${pctText(s.pct_start)} of start`}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function FunnelTable({ stages }: { stages: FunnelStage[] }) {
  return (
    <table className="t-small w-full min-w-[34rem] text-left [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">How many people reached each step</caption>
      <thead>
        <tr className="text-soft">
          {["Step", "Reached", "Of the start", "Of the step before", "Stopped here", "Typical wait before this step"].map((h) => (
            <th key={h} scope="col" className="py-1 pr-4 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stages.map((s) => (
          <tr key={s.key} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {s.label}
            </th>
            <td className="py-1 pr-4">{show(s.reached)}</td>
            <td className="py-1 pr-4">{pctText(s.pct_start)}</td>
            <td className="py-1 pr-4">{pctText(s.pct_prev)}</td>
            <td className="py-1 pr-4">{show(s.stopped)}</td>
            <td className="py-1">{s.median_hours === null ? "–" : hoursText(s.median_hours)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const HIDDEN_BAR = HIDDEN;
