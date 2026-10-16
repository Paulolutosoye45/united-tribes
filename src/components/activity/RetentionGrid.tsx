import { cn } from "@/lib/cn";
import { longDay, num, show } from "@/lib/activity/format";
import type { Retention } from "@/lib/activity/types";

/**
 * Of the people who joined in a week (down the side), how many were active that week and each week after (across).
 * A cell of fewer than 5 people reads "<5". With `shaded` off it is the same table with no colour.
 */
export function RetentionGrid({ weeks, shaded = true }: { weeks: Retention["weeks"]; shaded?: boolean }) {
  const columns = Math.max(0, ...weeks.map((w) => w.cells.length));
  return (
    <table className="t-small w-full min-w-[30rem] border-separate border-spacing-1 text-center [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">Percent of each week’s new people who were active in each week after they joined</caption>
      <thead>
        <tr className="text-soft">
          <th scope="col" className="pr-2 text-left font-medium">
            Joined week of
          </th>
          <th scope="col" className="px-1 font-medium">
            People
          </th>
          {Array.from({ length: columns }, (_, k) => (
            <th key={k} scope="col" className="px-1 font-medium">
              {k === 0 ? "That week" : `+${k}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w.start}>
            <th scope="row" className="whitespace-nowrap pr-2 text-left font-normal">
              {longDay(w.start)}
            </th>
            <td className="px-1 text-soft">{show(w.size)}</td>
            {Array.from({ length: columns }, (_, k) => {
              const v = w.cells[k];
              if (v === undefined) return <td key={k} />;
              if (v === null) return <td key={k} className="px-1 py-1 text-soft">–</td>;
              const hidden = v === "<5";
              return (
                <td
                  key={k}
                  className={cn("rounded-lg px-1 py-1", hidden && "bg-surface-strong text-soft")}
                  style={!hidden && shaded ? { backgroundColor: `color-mix(in srgb, var(--crest-flame) ${Math.round((v as number) * 0.85)}%, transparent)` } : undefined}
                >
                  {hidden ? "<5" : `${num(v as number)}%`}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
