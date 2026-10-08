import type { MatchStats } from "@/lib/matching/types";
import { KIND_WORDS } from "./kinds";

/** Totals for the office: who is waiting, where the seats are, how well the ranking is working, and where leaders are needed. */
export function MatchStatsPanel({ stats }: { stats: MatchStats }) {
  const seatsLeft = Math.max(0, stats.seats_total - stats.seats_taken);
  const tiles = [
    { label: "Placed", value: String(stats.placed), note: `${stats.profiled} have filled the form` },
    { label: "Waiting", value: String(stats.waiting), note: `${stats.ran} have seen their circles` },
    { label: "Seats open", value: String(seatsLeft), note: `${stats.circles_open} circles, ${stats.seats_total} seats` },
    { label: "Need a leader", value: String(stats.unmet), note: `${stats.starter_list} asked for a Starter Circle` },
  ];
  const picks = [
    { label: "First card", n: stats.by_rank.first },
    { label: "Second card", n: stats.by_rank.second },
    { label: "Third card", n: stats.by_rank.third },
  ];
  const top = Math.max(1, ...picks.map((x) => x.n));
  return (
    <div className="flex flex-col gap-4">
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{t.label}</dt>
            <dd className="t-figure !text-[clamp(2rem,9vw,3rem)]">{t.value}</dd>
            <dd className="t-small text-soft">{t.note}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-3 p-5">
          <div>
            <h3 className="font-semibold">Which card members chose</h3>
            <p className="t-small text-soft">
              {stats.placed === 0 ? "Nobody has chosen yet." : `Average compatibility ${stats.average_degree ?? 0}%. ${stats.bands.excellent} excellent, ${stats.bands.strong} strong, ${stats.bands.good} good.`}
            </p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {picks.map((x) => (
              <li key={x.label} className="flex items-center gap-3">
                <span className="t-small w-28 shrink-0">{x.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-line" role="img" aria-label={`${x.n} members chose their ${x.label.toLowerCase()}`}>
                  <span className="block h-full rounded-full bg-flame" style={{ width: `${Math.round((x.n / top) * 100)}%` }} />
                </span>
                <span className="t-small w-8 shrink-0 text-right text-soft">{x.n}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card flex flex-col gap-3 p-5">
          <div>
            <h3 className="font-semibold">Where leaders are needed</h3>
            <p className="t-small text-soft">Members who could not be shown three good circles, grouped by what they asked for.</p>
          </div>
          {stats.gaps.length === 0 ? (
            <p className="t-body text-soft">No gaps yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {stats.gaps.map((g, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="t-small font-semibold">{g.goal ?? g.tribe ?? "No goal chosen"}</p>
                    <p className="t-small text-soft">
                      {[g.tribe, g.track, KIND_WORDS[g.kind]].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="t-small shrink-0 font-semibold">{g.members}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
