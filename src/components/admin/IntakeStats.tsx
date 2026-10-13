import { plural } from "@/lib/dates";

export type Stats = {
  members: number;
  started: number;
  completed: number;
  median_seconds: number | null;
  within_six_minutes: number;
  by_track: { label: string; count: number }[];
  by_community: { label: string; count: number }[];
  assistant: { calls: number; fallbacks: number; p95_ms: number | null };
};

function mmss(seconds: number | null) {
  if (seconds === null) return "–";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card flex flex-col gap-4 p-5 sm:p-6">
      <h3 className="t-heading">{title}</h3>
      {rows.length === 0 ? (
        <p className="t-small text-soft">Nobody has finished the form yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, 6).map((r) => (
            <li key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[0.92rem]">
                <span className="truncate">{r.label}</span>
                <span className="font-semibold tabular-nums">{r.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-strong">
                <div
                  className="draw-line h-full rounded-full"
                  style={{ width: `${(r.count / max) * 100}%`, background: "linear-gradient(90deg, var(--crest-gold), var(--crest-flame))" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Totals for the office. No names and no answers, only counts. */
export function IntakeStats({ stats }: { stats: Stats }) {
  const completion = stats.started > 0 ? Math.round((stats.completed / stats.started) * 100) : null;
  const quick = stats.completed > 0 ? Math.round((stats.within_six_minutes / stats.completed) * 100) : null;
  const tiles = [
    { label: "Signed in", value: String(stats.members), note: "members" },
    { label: "Finished the form", value: String(stats.completed), note: completion === null ? "none started" : `${completion}% of ${plural(stats.started, "start")}` },
    { label: "Typical time", value: mmss(stats.median_seconds), note: "minutes, goal under 6:00" },
    { label: "Under six minutes", value: quick === null ? "–" : `${quick}%`, note: "of finished forms" },
  ];
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
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Who is joining, by stage of life" rows={stats.by_track} />
        <Bars title="Who is joining, by community" rows={stats.by_community} />
      </div>
      {stats.assistant.calls > 0 ? (
        <p className="t-small text-soft">
          Assistant: {plural(stats.assistant.calls, "request")}, {stats.assistant.fallbacks} without suggestions
          {stats.assistant.p95_ms !== null ? `, slowest 1 in 20 took ${(stats.assistant.p95_ms / 1000).toFixed(1)} seconds` : ""}.
        </p>
      ) : null}
    </div>
  );
}
