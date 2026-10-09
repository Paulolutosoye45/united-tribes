import { daysUntil, formatDate, plural } from "@/lib/dates";

const STATUS_COPY: Record<string, string> = {
  planning: "Dates are being confirmed.",
  open: "Applications are open.",
  running: "Tribes are meeting now.",
  closed: "This season has ended.",
};

type Season = { name: string; starts_on: string; ends_on: string; weeks: number; status: string };

/** Which week of the season it is today: 0 before it starts, up to `weeks`. */
export function currentWeek(season: Pick<Season, "starts_on" | "weeks">, now = new Date()): number {
  const elapsed = -daysUntil(season.starts_on, now);
  if (elapsed < 0) return 0;
  return Math.min(season.weeks, Math.floor(elapsed / 7) + 1);
}

/** The season at a glance: a countdown, and one bar for each week. */
export function SeasonCard({ season }: { season: Season }) {
  const days = daysUntil(season.starts_on);
  const week = currentWeek(season);
  return (
    <section aria-labelledby="season-heading" className="card overflow-hidden">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-8">
        <div className="flex flex-col gap-2">
          <h2 id="season-heading" className="t-heading">
            {season.name}
          </h2>
          <p className="t-body max-w-[38ch] text-soft">
            {plural(season.weeks, "week")} of Tribes, starting {formatDate(season.starts_on)}. {STATUS_COPY[season.status]}
          </p>
        </div>
        {days > 0 ? (
          <p className="t-figure shrink-0" aria-label={`${plural(days, "day")} to go`}>
            {days}
            <span className="t-small ml-2 font-medium tracking-normal text-soft" style={{ fontStretch: "100%", letterSpacing: 0 }}>
              {days === 1 ? "day to go" : "days to go"}
            </span>
          </p>
        ) : week > 0 ? (
          <p className="t-figure shrink-0" aria-label={`Week ${week} of ${season.weeks}`}>
            {week}
            <span className="t-small ml-2 font-medium text-soft" style={{ fontStretch: "100%", letterSpacing: 0 }}>
              of {season.weeks}
            </span>
          </p>
        ) : null}
      </div>
      <div className="px-6 pb-6 sm:px-8 sm:pb-8">
        <ol className="flex gap-1.5" aria-label={`The ${season.weeks} weeks`}>
          {Array.from({ length: season.weeks }, (_, i) => {
            const lit = i < week;
            return (
              <li key={i} className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-strong">
                <span
                  className="draw-line block h-full rounded-full"
                  style={{
                    width: lit ? "100%" : "0%",
                    background: "linear-gradient(90deg, var(--crest-gold), var(--crest-flame))",
                    animationDelay: `${300 + i * 50}ms`,
                  }}
                />
              </li>
            );
          })}
        </ol>
        <p className="t-small mt-3 flex justify-between text-soft">
          <span>{formatDate(season.starts_on)}</span>
          <span>{formatDate(season.ends_on)}</span>
        </p>
      </div>
    </section>
  );
}
