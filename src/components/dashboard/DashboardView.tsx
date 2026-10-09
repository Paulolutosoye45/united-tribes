import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { formatDate } from "@/lib/dates";
import type { Dashboard } from "@/lib/dashboard/types";
import { AccuracyPanel, CareAndTestimonies, Funnel, SupplyMap, Tribes } from "./ChurchViews";
import { CircleResults } from "./CircleResults";
import { Headline } from "./Headline";
import { WeekBars } from "./WeekBars";

/** The dashboard: the church's numbers for a pastor or director, a coach's own circles for a coach. */
export function DashboardView({ d, canOpen }: { d: Dashboard; canOpen: boolean }) {
  if (d.state === "none" || !d.season || !d.headline) {
    return <p className="t-body measure text-soft">No season has been set up yet, so there is nothing to measure. The dashboard fills in as soon as one is.</p>;
  }
  const church = d.scope === "church";
  const s = d.season;
  const h = d.headline;
  const where = d.state === "before" ? `starts ${formatDate(s.starts_on)}` : d.state === "complete" ? "the season has ended" : `week ${s.current_week} of ${s.weeks}`;

  const bars = (d.weeks ?? []).map((w) => ({
    week: w.week,
    current: w.current,
    attendance: w.possible > 0 ? w.present / w.possible : null,
    steps: w.steps_checked > 0 ? w.steps_done / w.steps_checked : null,
  }));
  const pace = d.targets.attend_share;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-body text-soft">
          {s.name}: {where}.{church ? "" : " Your Tribes only."}
        </p>
        {d.seasons && d.seasons.length > 1 ? (
          <nav aria-label="Seasons" className="flex flex-wrap gap-2">
            {d.seasons.map((x) => (
              <Link
                key={x.id}
                href={`/dashboard?season=${x.id}`}
                aria-current={x.id === s.id ? "page" : undefined}
                className={`press inline-flex min-h-10 items-center rounded-full border-[1.5px] px-4 text-[0.9rem] font-medium ${x.id === s.id ? "border-ink bg-ink text-page" : "border-line bg-raised text-soft hover:border-soft hover:text-ink"}`}
              >
                {x.name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <Headline h={h} season={s} targets={d.targets} scopeLabel={church ? "whole church" : "your Tribes"} state={d.state} />

      {d.state !== "before" ? <WeekBars weeks={s.weeks} rows={bars} pace={pace} title="Week by week" /> : null}

      <CircleResults circles={d.circles ?? []} verdicts={h.verdicts} canOpen={canOpen} complete={d.state === "complete"} />

      {church && d.funnel ? <Funnel steps={d.funnel} /> : null}
      {church && d.supply ? <SupplyMap supply={d.supply} /> : null}
      {church && d.tribes ? <Tribes rows={d.tribes} minCell={d.targets.min_cell} /> : null}
      {church && d.accuracy ? <AccuracyPanel a={d.accuracy} targets={d.targets} measured={h.measured} /> : null}
      {church && d.care && d.testimonies ? <CareAndTestimonies care={d.care} testimonies={d.testimonies} /> : null}

      <div className="flex flex-wrap gap-3">
        <Link href="/review/rhythm" className={buttonClasses({ variant: "quiet", size: "md" })}>
          <span className="relative">Open the weekly report</span>
        </Link>
      </div>
    </div>
  );
}
