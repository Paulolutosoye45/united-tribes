import { Badge } from "@/components/ui/Badge";
import {
  STATUS,
  aiFieldLabel,
  formatKpi,
  formatTarget,
  kpiMeaning,
  kpiNote,
  kpisByNeed,
  KPI_TITLES,
  type AiField,
  type AllTargets,
  type EarlierSeason,
  type GoalRow,
  type Insight,
  type Kpi,
  type Retention,
  type TrendPoint,
} from "@/lib/dashboard/insight";
import { pct, signed } from "@/lib/dashboard/wording";
import { RetentionChart } from "./RetentionChart";
import { Sparkline } from "./Sparkline";

/** The nine objectives against their targets, retention, what the assistant got right, goals and the trend. */
export function InsightViews({ insight }: { insight: Insight }) {
  if (insight.state === "none" || !insight.kpis || !insight.season) return null;
  const s = insight.season;
  return (
    <>
      <Scorecard kpis={insight.kpis} targets={insight.targets} measured={insight.measured ?? false} />
      {insight.retention && insight.retention.cohort > 0 ? (
        <RetentionPanel retention={insight.retention} earlier={insight.earlier ?? []} weeks={s.weeks} name={s.name} state={insight.state} />
      ) : null}
      {insight.trend && insight.trend.length > 1 ? <TrendPanel trend={insight.trend} /> : null}
      {insight.goals && insight.goals.length > 0 ? <GoalsPanel goals={insight.goals} targets={insight.targets} /> : null}
      {insight.ai ? <AiPanel ai={insight.ai} targets={insight.targets} /> : null}
    </>
  );
}

function Scorecard({ kpis, targets, measured }: { kpis: Kpi[]; targets: AllTargets; measured: boolean }) {
  const ordered = kpisByNeed(kpis);
  const count = (status: Kpi["status"]) => kpis.filter((k) => k.status === status).length;
  return (
    <section aria-labelledby="objectives-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="objectives-heading" className="t-heading">
          The objectives
        </h2>
        <p className="t-small text-soft">
          {count("met")} on target, {count("close")} close, {count("behind")} behind
          {count("na") > 0 ? `, ${count("na")} too early to say` : ""}.{" "}
          {measured ? "Each row is worked out from the same records as the dashboard." : `Rates appear after ${targets.min_weeks} weeks of the season.`}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {ordered.map((k) => {
          const st = STATUS[k.status];
          const note = kpiNote(k, targets);
          return (
            <li key={k.key} className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-3.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{KPI_TITLES[k.key]}</span>
                <span className="t-small text-soft">{kpiMeaning(k, targets)}</span>
                {note ? <span className="t-small text-soft">{note}</span> : null}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <strong className="text-xl [font-variant-numeric:tabular-nums]">{formatKpi(k.value, k.unit)}</strong>
                <span className="t-small text-soft">aim: {formatTarget(k)}</span>
                <Badge tone={st.tone}>{st.text}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RetentionPanel({ retention, earlier, weeks, name, state }: { retention: Retention; earlier: EarlierSeason[]; weeks: number; name: string; state: Insight["state"] }) {
  const last = retention.points[retention.points.length - 1];
  const gone = retention.cohort - (last?.retained ?? retention.cohort);
  return (
    <section aria-labelledby="retention-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="retention-heading" className="t-heading">
          Who is still coming
        </h2>
        <p className="t-small text-soft">
          {retention.cohort} people were placed in a tribe this season.{" "}
          {last
            ? `After week ${last.week}, ${last.retained} of them (${pct(last.rate)}) ${state === "complete" ? "were" : "are"} still coming${gone > 0 ? `, and ${gone} ${gone === 1 ? "has" : "have"} gone quiet` : ""}.`
            : "The curve starts after the first week."}{" "}
          Someone counts as still coming if they came to a meeting that week or the week before.
        </p>
      </div>
      {last ? <RetentionChart weeks={weeks} current={retention} earlier={earlier} name={name} /> : null}
    </section>
  );
}

function TrendPanel({ trend }: { trend: TrendPoint[] }) {
  const series = (pick: (t: TrendPoint) => number | null | undefined) => trend.map((t) => ({ day: t.taken_on, value: pick(t) ?? null }));
  return (
    <section aria-labelledby="trend-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="trend-heading" className="t-heading">
          How it has moved
        </h2>
        <p className="t-small text-soft">One reading a day since {trend[0].taken_on}. History is kept even after a rule or a target changes.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Sparkline title="Members thriving" points={series((t) => t.belong)} />
        <Sparkline title="Came to meetings" points={series((t) => t.attendance_rate)} />
        <Sparkline title="Still coming" points={series((t) => t.retention_rate)} />
      </div>
    </section>
  );
}

function GoalsPanel({ goals, targets }: { goals: GoalRow[]; targets: AllTargets }) {
  return (
    <section aria-labelledby="goals-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="goals-heading" className="t-heading">
          Success Picture, goal by goal
        </h2>
        <p className="t-small text-soft">
          How far members have moved on the score of 3 to 15, and the share who gained {targets.gain_min} points or more. An average needs {targets.min_answers} answers.
        </p>
      </div>
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[30rem] text-left">
          <caption className="sr-only">Success Picture gain by goal and community</caption>
          <thead>
            <tr className="t-small text-soft">
              <th scope="col" className="pb-2 font-medium">Goal</th>
              <th scope="col" className="pb-2 font-medium">Community</th>
              <th scope="col" className="pb-2 text-right font-medium">Members</th>
              <th scope="col" className="pb-2 text-right font-medium">Average gain</th>
              <th scope="col" className="pb-2 text-right font-medium">Gained {targets.gain_min}+</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {goals.map((g) => (
              <tr key={`${g.goal}|${g.community}`}>
                <th scope="row" className="py-2 pr-3 font-medium leading-tight">{g.goal}</th>
                <td className="t-small py-2 pr-3 text-soft">{g.community ?? "–"}</td>
                <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{g.members}</td>
                <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{signed(g.gain_avg)}</td>
                <td className="py-2 text-right [font-variant-numeric:tabular-nums]">{pct(g.gain_share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AiPanel({ ai, targets }: { ai: { fields: AiField[]; times_shown: number; times_kept: number }; targets: AllTargets }) {
  if (ai.fields.length === 0 && ai.times_shown === 0) return null;
  return (
    <section aria-labelledby="ai-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="ai-heading" className="t-heading">
          What the assistant got right
        </h2>
        <p className="t-small text-soft">
          Of the suggestions members saw on the form, the share they kept. Aim for {pct(targets.ai_keep)} in every field; a low field is one to reword or turn off.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {ai.fields.map((f) => {
          const low = f.rate !== null && f.rate < targets.ai_keep;
          return (
            <li key={f.field} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{aiFieldLabel(f.field)}</span>
                <span className="t-small text-soft [font-variant-numeric:tabular-nums]">
                  {f.rate === null ? `${f.shown} shown, too few to rate` : `${f.kept} of ${f.shown} kept · ${pct(f.rate)}`}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
                <div className={`h-full rounded-full ${low ? "bg-flame" : "bg-gold"}`} style={{ width: `${Math.max((f.rate ?? 0) * 100, f.rate ? 2 : 0)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {ai.times_shown > 0 ? (
        <p className="t-small text-soft">
          Meeting times: {ai.times_kept} of {ai.times_shown} members kept at least one suggested time.
        </p>
      ) : null}
    </section>
  );
}
