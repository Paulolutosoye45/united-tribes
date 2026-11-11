import { Badge } from "@/components/ui/Badge";
import { plural } from "@/lib/dates";
import type { LeaderGuide, TribeWeek } from "@/lib/rhythm/types";
import { THEME_LABELS, celebrationLine, percent } from "@/lib/rhythm/wording";

/** What a leader needs before the meeting: the week's idea, the 75 minutes, what to say, and who to thank. */
export function PrepPack({ week, guide: g }: { week: TribeWeek; guide: LeaderGuide }) {
  const last = week.last_report;
  return (
    <section aria-labelledby="prep-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="outline">{THEME_LABELS[g.theme]}</Badge>
          <Badge tone="neutral">{g.passage}</Badge>
        </div>
        <h2 id="prep-heading" className="t-heading">
          Prepare week {g.week}: {g.title}
        </h2>
        <p className="t-body measure">{g.big_idea}</p>
      </div>

      <ol className="card flex flex-col divide-y divide-line">
        {g.plan.map((s, i) => (
          <li key={s.title} className="flex gap-4 p-4 sm:p-5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-surface-strong text-center leading-tight" aria-label={`${s.minutes} minutes`}>
              <span>
                <span className="block text-lg font-bold">{s.minutes}</span>
                <span className="block text-[0.7rem] text-soft">min</span>
              </span>
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug">
                {i + 1}. {s.title}
              </h3>
              <p className="t-small mt-1 text-soft">{s.how}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="card flex flex-col gap-2 p-5">
          <h3 className="font-semibold">Questions for the tribe</h3>
          <p className="t-small text-soft">{g.opening_question}</p>
          <ul className="t-small flex list-disc flex-col gap-1 pl-5">
            {g.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
        <div className="night flex flex-col gap-2 rounded-[var(--radius-card)] p-5">
          <h3 className="font-semibold">A word for you as leader</h3>
          <p className="t-small text-white/85">{g.leader_tip}</p>
        </div>
      </div>

      {last ? (
        <div className="card flex flex-col gap-1.5 p-5">
          <h3 className="font-semibold">Last week</h3>
          <p className="t-small text-soft">
            {last.logged
              ? last.held
                ? `${last.present} of ${plural(last.members, "member")} came (${percent(last.attendance_rate)}), and ${last.steps_done + last.steps_partly} of them finished their step.${last.highlight ? ` Your highlight: “${last.highlight}”` : ""}`
                : `The tribe did not meet.${last.highlight ? ` You wrote: “${last.highlight}”` : ""}`
              : "No log was saved for last week."}
          </p>
        </div>
      ) : null}

      {week.celebrations.length > 0 ? (
        <div className="card flex flex-col gap-2 p-5">
          <h3 className="font-semibold">Worth celebrating</h3>
          <ul className="t-small flex flex-col gap-1.5 text-soft">
            {week.celebrations.map((c) => (
              <li key={`${c.kind}-${c.first_name}`}>{celebrationLine(c)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
