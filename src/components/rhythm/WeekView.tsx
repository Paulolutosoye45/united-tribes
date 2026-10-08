import Link from "next/link";
import { ShieldProgress } from "@/components/brand/ShieldProgress";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { clockLabel, dayName } from "@/lib/academy/options";
import { formatDate, plural } from "@/lib/dates";
import type { MyWeekPlaced } from "@/lib/rhythm/types";
import { THEME_LABELS, meetingDay, nudgeLine, weekRange } from "@/lib/rhythm/wording";
import { GuideCard, PictureCard } from "./GuideCard";
import { PulseSlot } from "./PulseForm";
import { StepCard } from "./StepCard";
import { WeekStrip } from "./WeekStrip";
import { MyProgressCard } from "@/components/dashboard/MyProgressCard";
import type { MyProgress } from "@/lib/dashboard/types";

const ANCHOR: Record<string, string> = { set_step: "#step", check_in: "#check-in", pulse: "#pulse", testimony: "/circle/testimony" };

/** The member's home once the season has begun: this week's guide, step, check-in and pulse, and the twelve weeks. */
export function WeekView({ week, progress }: { week: MyWeekPlaced; progress?: MyProgress }) {
  const running = week.state === "running";
  const viewing = week.viewing ?? week.week ?? 1;
  const isCurrent = viewing === week.week;
  const guide = week.guide;
  const c = week.circle;
  const startOfViewing = running ? addDays(week.starts_on, (viewing - 1) * 7) : week.starts_on;
  // The shield fills as the season goes: three weeks to a quarter
  const done = running ? Math.max(0, (week.week ?? 1) - 1) : week.weeks;
  const q = (i: number) => Math.max(0, Math.min(1, (done / week.weeks) * 4 - i));
  const fills: [number, number, number, number] = [q(0), q(1), q(2), q(3)];

  return (
    <div className="flex flex-col gap-8">
      <section className="night rise-in flex flex-col gap-5 rounded-[var(--radius-sheet)] p-6 sm:p-10" aria-labelledby="week-heading">
        <div className="flex items-start justify-between gap-5">
          <div className="flex min-w-0 flex-col gap-3">
            {running ? (
              <p className="t-small text-white/70">
                {isCurrent ? "This week" : "Reading"} · Week {viewing} of {week.weeks} · {weekRange(startOfViewing)}
              </p>
            ) : (
              <p className="t-small text-white/70">{c.name}</p>
            )}
            <h1 id="week-heading" className="t-title">
              {running && guide ? guide.title : "Your season is complete."}
            </h1>
            <p className="t-body text-white/80">
              {running && guide ? (
                <>
                  {THEME_LABELS[guide.theme]} · {guide.passage}.{" "}
                  {isCurrent && c.meeting_date ? `Your circle meets on ${meetingDay(c.meeting_date)} at ${clockLabel(c.meeting_time)}.` : null}
                </>
              ) : (
                `You came to ${week.attended} of ${plural(week.logged, "meeting")}. Thank you for walking with ${c.leader_first_name} and your circle.`
              )}
            </p>
          </div>
          <div className="shrink-0 origin-top-right scale-[0.6] sm:scale-100">
            <ShieldProgress fills={fills} size={84} tone="light" label={running ? `Week ${week.week} of ${week.weeks}` : "Season complete"} done={!running} />
          </div>
        </div>
        {running && !isCurrent ? (
          <div>
            <Link href="/circle" className={buttonClasses({ variant: "night", size: "md" })}>
              <span className="relative">Back to this week</span>
            </Link>
          </div>
        ) : null}
        {!running ? (
          <div>
            <Link href="/circle/testimony" className={buttonClasses({ size: "md" })}>
              <span className="relative">Share a testimony</span>
            </Link>
          </div>
        ) : null}
      </section>

      {week.nudges.length > 0 && (isCurrent || !running) ? (
        <section aria-labelledby="nudge-heading" className="card flex flex-col gap-3 p-5 sm:p-6">
          <h2 id="nudge-heading" className="font-semibold">
            For you right now
          </h2>
          <ul className="flex flex-col gap-2.5">
            {week.nudges.map((n) => {
              const line = nudgeLine(n.kind, n.week, week.weeks);
              return (
                <li key={`${n.kind}-${n.week}`} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="t-body">{line.title}</span>
                  <a href={ANCHOR[n.kind]} className={buttonClasses({ variant: "solid", size: "sm" })}>
                    <span className="relative">{line.action}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <PulseSlot pulseWeek={week.pulse_week ?? null} weeks={week.weeks} picture={week.picture} />
      {running ? <StepCard key={`${viewing}-${week.step?.outcome ?? "x"}-${week.step?.when ?? ""}`} week={week} /> : null}
      {running && guide ? <GuideCard guide={guide} /> : null}
      <PictureCard picture={week.picture} />
      <WeekStrip rows={week.rows} viewing={viewing} attended={week.attended} logged={week.logged} />
      {progress ? <MyProgressCard progress={progress} /> : null}

      <section aria-labelledby="circle-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="circle-heading" className="t-heading">
            {c.name}
          </h2>
          <Badge tone="outline">Led by {c.leader_first_name}</Badge>
        </div>
        <p className="t-body text-soft">
          {dayName(c.meeting_day)}s at {clockLabel(c.meeting_time)} · {c.meeting_mode === "online" ? "Online" : "In person"} · {week.season_name}, {formatDate(week.starts_on)} to {formatDate(week.ends_on)}
        </p>
        <div className="flex flex-wrap gap-3">
          {c.group_url ? (
            <a href={c.group_url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "solid", size: "md" })}>
              <span className="relative">Open the WhatsApp group</span>
            </a>
          ) : null}
          <Link href="/circle/testimony" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Testimonies</span>
          </Link>
        </div>
      </section>
    </div>
  );
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
