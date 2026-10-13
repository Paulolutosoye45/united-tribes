import { Funnel } from "@/components/dashboard/ChurchViews";
import { RetentionChart } from "@/components/dashboard/RetentionChart";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatShortDate, plural } from "@/lib/dates";
import {
  REPORT_KINDS,
  STATUS,
  KPI_TITLES,
  aiFieldLabel,
  formatKpi,
  formatTarget,
  kpiNote,
  kpisByNeed,
  reportPeriod,
  reportTitle,
  type ReportData,
  type ReportDetail,
} from "@/lib/dashboard/insight";
import type { Verdict } from "@/lib/dashboard/types";
import { VERDICTS, pct, signed } from "@/lib/dashboard/wording";
import { SummaryEditor } from "./SummaryEditor";

const num = "[font-variant-numeric:tabular-nums]";

function verdictBadge(verdict: string) {
  const v = VERDICTS[verdict as Verdict];
  if (verdict === "small") return <Badge tone="outline">Too few to rate</Badge>;
  return v ? <Badge tone={v.tone}>{v.text}</Badge> : null;
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card report-block flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="t-heading">
          {title}
        </h2>
        {note ? <p className="t-small text-soft">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card report-block flex flex-col gap-1 p-5">
      <p className="t-small text-soft">{label}</p>
      <p className="t-figure !text-[clamp(1.8rem,7vw,2.4rem)]">{value}</p>
      <p className="t-small text-soft">{note}</p>
    </div>
  );
}

/** A report: the figures as they stood on the day it was made, laid out to read on a phone and to print on A4. */
export function ReportView({ report }: { report: ReportDetail }) {
  const d = report.data;
  const h = d.headline;
  const w = d.window;
  const t = d.targets;
  const period = reportPeriod({ kind: report.kind, period_start: report.period_start, season: report.season });
  const where = d.season.before ? "before the season begins" : d.season.over ? "the season has ended" : `week ${d.season.current_week} of ${d.season.weeks}`;
  const hiddenRate = h.members > 0 && h.thriving_rate == null && h.measured !== false;
  const communitySupply = Array.isArray(d.supply) ? d.supply : null;
  const wholeSupply = d.supply && !Array.isArray(d.supply) ? d.supply : null;

  return (
    <article className="flex flex-col gap-6 report">
      <header className="flex flex-col gap-2">
        <p className="t-small text-soft">{REPORT_KINDS[report.kind].title}</p>
        <h1 className="t-title">
          {reportTitle(report)} · {period}
        </h1>
        <p className="t-body text-soft">
          {d.season.name}, {where}. Figures as of {formatDate(d.as_of)}.
        </p>
      </header>

      <SummaryEditor id={report.id} summary={report.summary} by={report.summary_by} />

      <section aria-labelledby="numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="numbers" className="sr-only">
          The numbers
        </h2>
        <Tile label="Members" value={String(h.members)} note={h.tribes !== undefined ? plural(h.tribes, "tribe") : d.tribes ? plural(d.tribes.length, "tribe") : ""} />
        <Tile
          label="Thriving"
          value={h.thriving_rate != null ? pct(h.thriving_rate) : "–"}
          note={
            h.thriving_rate != null
              ? `${h.thriving} of ${h.members}. The goal is ${pct(t.thriving_rate)}.`
              : hiddenRate
                ? `Shown when there are ${t.min_cell} members (now ${h.members}).`
                : `Shown after ${plural(t.min_weeks, "week")} of the season.`
          }
        />
        <Tile
          label="Came to meetings"
          value={pct(h.attendance_rate ?? w.attendance_rate)}
          note={h.attendance_rate == null && w.attendance_rate == null ? "No meetings logged yet." : "Of the places at meetings held so far."}
        />
        <Tile
          label="Success Picture"
          value={h.gain_avg != null ? signed(h.gain_avg) : "–"}
          note={h.gain_avg != null ? `${pct(h.gain_share ?? null)} gained ${t.gain_min} points or more.` : "Shown once enough members have answered."}
        />
      </section>

      <Section id="window" title={report.kind === "season" ? "The season" : `In ${period}`}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Fact label="Meetings held" value={w.meetings_held} />
          <Fact label="Came to meetings" value={pct(w.attendance_rate)} />
          <Fact label="Joined a tribe" value={w.joined} />
          <Fact label="Left a tribe" value={w.left} />
          <Fact label="Forms finished" value={w.forms_finished} />
          <Fact label="Care needs opened" value={w.care_opened} />
          <Fact label="Care needs closed" value={w.care_closed} />
          <Fact label="Still open" value={w.care_open_now} />
          <Fact label="Testimonies shared" value={w.testimonies_new} />
          <Fact label="Reached the church" value={w.testimonies_to_church} />
        </dl>
      </Section>

      {d.kpis && d.kpis.length > 0 ? <Objectives data={d} /> : null}

      {d.movement ? <Movement data={d} /> : null}

      {d.watch.length > 0 ? (
        <Section id="watch" title="Tribes to look at" note="The tribes furthest from the goal, worst first. A call to the leader is the first step.">
          <ul className="flex flex-col divide-y divide-line">
            {d.watch.map((c) => (
              <li key={`${c.name}|${c.leader}`} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium leading-snug">{c.name}</p>
                  <p className="t-small text-soft">
                    Led by {c.leader}
                    {c.community ? ` · ${c.community}` : ""} · {plural(c.members, "member")}
                    {c.attendance_rate != null ? ` · ${pct(c.attendance_rate)} came` : ""}
                    {c.thriving_rate != null ? ` · ${pct(c.thriving_rate)} thriving` : ""}
                  </p>
                </div>
                {verdictBadge(c.verdict)}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {d.tribes && d.tribes.length > 0 ? <Tribes data={d} title={report.kind === "community" ? `Tribes in ${d.community?.name ?? report.community ?? "the community"}` : "Every tribe"} /> : null}

      {communitySupply && communitySupply.length > 0 ? (
        <Section id="seats" title="Seats and demand" note="Who asked for a tribe in this community, against the seats certified leaders can offer.">
          <ul className="flex flex-col divide-y divide-line">
            {communitySupply.map((s) => {
              const short = Math.max(s.wants - s.seats, 0);
              return (
                <li key={s.track ?? "all"} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="font-medium">{s.track ?? "All ages"}</span>
                  <span className={`t-small text-soft ${num}`}>
                    {s.wants} want a tribe · {s.seats} seats{short > 0 ? ` · ${short} short` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {d.communities && d.communities.length > 0 ? (
        <Section id="communities" title="Community by community">
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[24rem] text-left">
              <caption className="sr-only">Members, thriving rate and Success Picture gain by community</caption>
              <thead>
                <tr className="t-small text-soft">
                  <th scope="col" className="pb-2 font-medium">Community</th>
                  <th scope="col" className="pb-2 text-right font-medium">Members</th>
                  <th scope="col" className="pb-2 text-right font-medium">Thriving</th>
                  <th scope="col" className="pb-2 text-right font-medium">Average gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.communities.map((r) => (
                  <tr key={r.community}>
                    <th scope="row" className="py-2 pr-3 font-medium">{r.community}</th>
                    <td className={`py-2 text-right ${num}`}>{r.members}</td>
                    <td className={`py-2 text-right ${num}`}>{pct(r.thriving_rate)}</td>
                    <td className={`py-2 text-right ${num}`}>{signed(r.gain_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {d.funnel && d.funnel.length > 0 ? <Funnel steps={d.funnel} /> : null}

      {d.retention && d.retention.cohort > 0 && d.retention.points.length > 0 ? (
        <Section id="retention" title="Who is still coming" note={`${d.retention.cohort} people were placed in a tribe this season. Someone counts as still coming if they came that week or the week before.`}>
          <RetentionChart weeks={d.season.weeks} current={d.retention} earlier={d.earlier ?? []} name={d.season.name} />
        </Section>
      ) : null}

      {d.goals && d.goals.length > 0 ? (
        <Section id="goals" title="Success Picture, goal by goal" note={`The average gain on the score of 3 to 15, and the share who gained ${t.gain_min} points or more.`}>
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[28rem] text-left">
              <caption className="sr-only">Success Picture gain by goal and community</caption>
              <thead>
                <tr className="t-small text-soft">
                  <th scope="col" className="pb-2 font-medium">Goal</th>
                  <th scope="col" className="pb-2 font-medium">Community</th>
                  <th scope="col" className="pb-2 text-right font-medium">Members</th>
                  <th scope="col" className="pb-2 text-right font-medium">Average gain</th>
                  <th scope="col" className="pb-2 text-right font-medium">Gained {t.gain_min}+</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.goals.map((g) => (
                  <tr key={`${g.goal}|${g.community}`}>
                    <th scope="row" className="py-2 pr-3 font-medium leading-tight">{g.goal}</th>
                    <td className="t-small py-2 pr-3 text-soft">{g.community ?? "–"}</td>
                    <td className={`py-2 text-right ${num}`}>{g.members}</td>
                    <td className={`py-2 text-right ${num}`}>{signed(g.gain_avg)}</td>
                    <td className={`py-2 text-right ${num}`}>{pct(g.gain_share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {d.ai && d.ai.fields.length > 0 ? (
        <Section id="ai" title="What the assistant got right" note={`Of the suggestions members saw on the form, the share they kept. The aim is ${pct(t.ai_keep)}.`}>
          <ul className="flex flex-col divide-y divide-line">
            {d.ai.fields.map((f) => (
              <li key={f.field} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="font-medium">{aiFieldLabel(f.field)}</span>
                <span className={`t-small text-soft ${num}`}>{f.rate === null ? `${f.shown} shown, too few to rate` : `${f.kept} of ${f.shown} kept · ${pct(f.rate)}`}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {d.care || wholeSupply ? (
        <Section id="people" title="Care and seats">
          <ul className="flex flex-col gap-2 t-body">
            {d.care ? (
              <li>
                {plural(d.care.open, "care need")} open
                {d.care.escalated ? `, ${d.care.escalated} passed to the pastors` : ""}
                {d.care.oldest_open_days != null ? `. The oldest has waited ${plural(d.care.oldest_open_days, "day")}` : ""}
                {d.care.median_days_to_close != null ? `. Needs are closed in ${plural(Math.round(d.care.median_days_to_close * 10) / 10, "day")} at the middle` : ""}.
              </li>
            ) : null}
            {wholeSupply ? (
              <li>
                {wholeSupply.wants} members asked for a tribe; {wholeSupply.seats} seats are open in approved tribes with a certified leader; {wholeSupply.placed} are placed
                {wholeSupply.unmet > 0 ? `; ${wholeSupply.unmet} could not be shown three good tribes` : ""}.
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      {d.testimonies.length > 0 ? (
        <Section id="testimonies" title="What God did" note="Testimonies the church has approved, shared with the person’s permission.">
          <ul className="flex flex-col gap-4">
            {d.testimonies.map((x, i) => (
              <li key={i} className="report-block border-l-[3px] border-gold pl-4">
                <p className="t-body measure whitespace-pre-line">“{x.body}”</p>
                <p className="t-small mt-1 text-soft">
                  {x.who}
                  {x.community ? ` · ${x.community}` : ""}
                  {x.goal ? ` · ${x.goal}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="t-small text-soft">
        Made on {formatShortDate(report.generated_at)} from the programme’s records. The figures do not change afterwards; a new report for the same month replaces them.
      </footer>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <dt className="t-small text-soft">{label}</dt>
      <dd className={`text-xl font-semibold ${num}`}>{value}</dd>
    </div>
  );
}

function Objectives({ data }: { data: ReportData }) {
  const kpis = kpisByNeed(data.kpis ?? []);
  const count = (s: string) => kpis.filter((k) => k.status === s).length;
  return (
    <Section
      id="objectives"
      title="The objectives"
      note={`${count("met")} on target, ${count("close")} close, ${count("behind")} behind${count("na") > 0 ? `, ${count("na")} too early to say` : ""}.`}
    >
      <ul className="flex flex-col divide-y divide-line">
        {kpis.map((k) => {
          const st = STATUS[k.status];
          const note = kpiNote(k, data.targets);
          return (
            <li key={k.key} className="report-block grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{KPI_TITLES[k.key]}</span>
                {note ? <span className="t-small text-soft">{note}</span> : null}
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                <strong className={`text-lg ${num}`}>{formatKpi(k.value, k.unit)}</strong>
                <span className="t-small text-soft">aim: {formatTarget(k)}</span>
                <Badge tone={st.tone}>{st.text}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Movement({ data }: { data: ReportData }) {
  const m = data.movement;
  if (!m) return null;
  const rows: { label: string; from: string; to: string }[] = [
    { label: "Members", from: String(m.from.members ?? "–"), to: String(m.to.members ?? "–") },
    { label: "Thriving", from: pct(m.from.belong), to: pct(m.to.belong) },
    { label: "Came to meetings", from: pct(m.from.attendance_rate), to: pct(m.to.attendance_rate) },
    { label: "Still coming", from: pct(m.from.retention_rate), to: pct(m.to.retention_rate) },
    { label: "Care needs open", from: String(m.from.open_care ?? "–"), to: String(m.to.open_care ?? "–") },
  ];
  return (
    <Section id="movement" title="How it moved" note={`From ${formatDate(m.from.taken_on)} to ${formatDate(m.to.taken_on)}.`}>
      <table className="w-full text-left">
        <caption className="sr-only">Change over the period</caption>
        <thead>
          <tr className="t-small text-soft">
            <th scope="col" className="pb-2 font-medium">Measure</th>
            <th scope="col" className="pb-2 text-right font-medium">Start</th>
            <th scope="col" className="pb-2 text-right font-medium">End</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-2 pr-3 font-medium">{r.label}</th>
              <td className={`py-2 text-right ${num}`}>{r.from}</td>
              <td className={`py-2 text-right ${num}`}>{r.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Tribes({ data, title }: { data: ReportData; title: string }) {
  const rows = data.tribes ?? [];
  return (
    <Section id="tribes" title={title}>
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[32rem] text-left">
          <caption className="sr-only">Tribes, their leaders, attendance and thriving rate</caption>
          <thead>
            <tr className="t-small text-soft">
              <th scope="col" className="pb-2 font-medium">Tribe</th>
              <th scope="col" className="pb-2 text-right font-medium">Members</th>
              <th scope="col" className="pb-2 text-right font-medium">Came</th>
              <th scope="col" className="pb-2 text-right font-medium">Thriving</th>
              <th scope="col" className="pb-2 pl-3 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => (
              <tr key={`${c.name}|${c.leader}`} className="report-block">
                <th scope="row" className="py-2 pr-3 font-medium leading-tight">
                  {c.name}
                  <span className="t-small block font-normal text-soft">Led by {c.leader}</span>
                </th>
                <td className={`py-2 text-right ${num}`}>
                  {c.members}/{c.capacity}
                </td>
                <td className={`py-2 text-right ${num}`}>{pct(c.attendance_rate)}</td>
                <td className={`py-2 text-right ${num}`}>{pct(c.thriving_rate ?? null)}</td>
                <td className="py-2 pl-3">{verdictBadge(c.verdict)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
