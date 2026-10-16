import { pctText, show, showWords } from "@/lib/activity/format";
import type { Compare, CompareRow } from "@/lib/activity/types";

type Measure = { key: keyof CompareRow; label: string; shade: string };

const MEASURES: Record<Compare["by"], Measure[]> = {
  community: [
    { key: "submitted_pct", label: "Finished the form", shade: "bg-[var(--crest-gold)]" },
    { key: "placed_pct", label: "In a tribe", shade: "bg-flame" },
    { key: "active_pct", label: "Active in 30 days", shade: "bg-ink" },
  ],
  zone: [
    { key: "submitted_pct", label: "Finished the form", shade: "bg-[var(--crest-gold)]" },
    { key: "placed_pct", label: "In a tribe", shade: "bg-flame" },
    { key: "active_pct", label: "Active in 30 days", shade: "bg-ink" },
  ],
  tribe: [
    { key: "active_pct", label: "Active in 30 days", shade: "bg-ink" },
    { key: "attendance_pct", label: "Meeting attendance", shade: "bg-flame" },
  ],
};

/** Groups side by side: one block per community, zone or tribe, with a bar for each measure. A group under 5 shows no percentages. */
export function CompareBars({ by, rows }: { by: Compare["by"]; rows: CompareRow[] }) {
  const measures = MEASURES[by];
  if (rows.length === 0) return <p className="t-small text-soft">Nothing to compare yet.</p>;
  return (
    <div className="flex flex-col gap-5">
      <ul className="t-small flex flex-wrap gap-x-5 gap-y-1 text-soft">
        {measures.map((m) => (
          <li key={m.label}>
            <span aria-hidden="true" className={`mr-1.5 inline-block h-3 w-3 rounded ${m.shade} align-middle`} />
            {m.label}
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => {
          const hidden = r.members === "<5";
          return (
            <li key={r.label} className="flex flex-col gap-1.5">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-[0.92rem]">
                <span className="font-medium">{r.label}</span>
                <span className="t-small text-soft">{showWords(r.members)} people</span>
              </p>
              {hidden ? (
                <p className="t-small text-soft">Fewer than 5 people, so no percentages are shown.</p>
              ) : (
                measures.map((m) => {
                  const v = r[m.key] as number | null | undefined;
                  return (
                    <div key={m.label} className="grid grid-cols-[1fr_3.2rem] items-center gap-3">
                      <span className="h-3 rounded-full bg-surface-strong" aria-hidden="true">
                        <span className={`block h-3 rounded-full ${m.shade}`} style={{ width: `${Math.min(100, Math.max(0, v ?? 0))}%` }} />
                      </span>
                      <span className="t-small text-right [font-variant-numeric:tabular-nums]">
                        <span className="sr-only">{m.label}: </span>
                        {pctText(v)}
                      </span>
                    </div>
                  );
                })
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CompareTable({ by, rows }: { by: Compare["by"]; rows: CompareRow[] }) {
  const measures = MEASURES[by];
  return (
    <table className="t-small w-full min-w-[24rem] text-left [font-variant-numeric:tabular-nums]">
      <caption className="sr-only">Compared by {by}</caption>
      <thead>
        <tr className="text-soft">
          <th scope="col" className="py-1 pr-4 font-medium">
            {by === "community" ? "Community" : by === "zone" ? "Zone" : "Tribe"}
          </th>
          <th scope="col" className="py-1 pr-4 font-medium">
            People
          </th>
          {measures.map((m) => (
            <th key={m.label} scope="col" className="py-1 pr-4 font-medium">
              {m.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-line">
            <th scope="row" className="py-1 pr-4 font-normal">
              {r.label}
            </th>
            <td className="py-1 pr-4">{show(r.members)}</td>
            {measures.map((m) => (
              <td key={m.label} className="py-1 pr-4">
                {r.members === "<5" ? "<5" : pctText(r[m.key] as number | null | undefined)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
