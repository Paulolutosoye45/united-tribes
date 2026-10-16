import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ChartFrame } from "@/components/activity/ChartFrame";
import { CopyBrief } from "@/components/activity/CopyBrief";
import { HeatLegend, HeatMap, HeatTable, HourBars } from "@/components/activity/HeatMap";
import { Section, SmallGroupNote, Tile, Unavailable } from "@/components/activity/parts";
import { TrendChart, TrendLegend, TrendTable } from "@/components/activity/TrendChart";
import { buildBrief } from "@/lib/activity/brief";
import { heatCaption, trendCaption } from "@/lib/activity/captions";
import { GROUP_ORDER, GROUP_PLURAL, decisionLine, moved, num, show } from "@/lib/activity/format";
import { loadBrief, loadHeatmap, loadPulse, markViewed } from "@/lib/activity/server";
import type { Pulse } from "@/lib/activity/types";
import { ago, clock } from "@/lib/god/wording";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pulse" };

type SearchParams = Promise<{ series?: string }>;

const SERIES = [
  { key: "active", label: "Active people" },
  { key: "visits", label: "Visits" },
  { key: "registered", label: "New sign-ups" },
  { key: "form_submitted", label: "Forms submitted" },
  { key: "placed", label: "Placed in a tribe" },
] as const;

const TILES = [
  { key: "registered", label: "New sign-ups" },
  { key: "form_submitted", label: "Forms submitted" },
  { key: "placed", label: "Placed in a tribe" },
  { key: "visits", label: "Visits" },
  { key: "signins", label: "Sign-ins" },
  { key: "checkins", label: "Check-ins" },
  { key: "testimonies", label: "Testimonies shared" },
  { key: "reports", label: "Weekly reports" },
] as const;

const ZERO = { today: 0, d7: 0, p7: 0, d30: 0, p30: 0 };

export default async function PulsePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { series: asked } = await searchParams;
  const series = SERIES.find((s) => s.key === asked) ?? SERIES[0];
  const supabase = await createClient();
  const [pulse, brief, heat] = await Promise.all([loadPulse(supabase), loadBrief(supabase), loadHeatmap(supabase, 28)]);
  if (!pulse) return <Unavailable />;
  await markViewed(supabase, "pulse");

  const now = clock();
  const line: Pulse["trend"]["series"][string] | undefined = pulse.trend.series[series.key];
  const text = brief ? buildBrief(brief) : null;

  return (
    <div className="flex flex-col gap-10">
      <p className="t-small text-soft" data-testid="activity-status">
        {pulse.status.recording_since ? `Recording since ${formatShortDate(pulse.status.recording_since)}. Screens and sign-ins are counted from that day; earlier numbers come from what people did.` : "Nothing recorded yet."}{" "}
        {pulse.status.last_refresh ? `Summaries updated ${ago(pulse.status.last_refresh, now) || formatShortDate(pulse.status.last_refresh)}.` : "Summaries have not been built yet."}
      </p>

      {!pulse.status.recording ? (
        <p role="status" className="card t-body border-l-4 border-l-flame p-4">
          <span className="font-semibold">Recording is switched off.</span> Nothing new is being counted until you switch it back on in{" "}
          <Link href="/god/activity/settings" className="underline">
            Settings
          </Link>
          .
        </p>
      ) : null}

      <Section id="decide" title="Needs a decision" intro="Each item appears only when its number passes the flag you set. Change a flag in Settings.">
        {pulse.decisions.length === 0 ? (
          <p className="card t-body p-5 text-soft">Nothing needs a decision right now.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pulse.decisions.map((d) => (
              <li key={d.key} data-decision={d.key}>
                <Link href={d.href} className="card press flex flex-col gap-1 border-l-4 border-l-flame p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <span className="min-w-0">
                    <span className="block font-semibold">{decisionLine(d)}</span>
                    <span className="t-small block text-soft">{d.action}</span>
                  </span>
                  <span className="t-small shrink-0 underline">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="week" title="This week at a glance" intro="The last seven days, against the seven before.">
        <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="People active"
            value={num(pulse.active.d7)}
            move={moved(pulse.active.d7, pulse.active.p7)}
            note={`${num(pulse.active.today)} today · ${num(pulse.active.d30)} in 30 days`}
          />
          {TILES.map((t) => {
            const m = pulse.metrics[t.key] ?? ZERO;
            return <Tile key={t.key} label={t.label} value={num(m.d7)} move={moved(m.d7, m.p7)} />;
          })}
        </div>
      </Section>

      <Section id="trend" title="Over 30 days" intro="One line a day, with the same days a month earlier dashed behind it.">
        <nav aria-label="Which line" className="flex flex-wrap gap-2">
          {SERIES.map((s) => (
            <Link
              key={s.key}
              href={s.key === "active" ? "/god/activity" : `/god/activity?series=${s.key}`}
              aria-current={s.key === series.key ? "true" : undefined}
              className={`press rounded-full px-4 py-1.5 text-[0.88rem] font-medium ${s.key === series.key ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
        {line ? (
          <ChartFrame
            title={series.label}
            caption={series.key === "active" ? trendCaption(pulse) : undefined}
            chart={
              <div className="flex flex-col gap-3">
                <TrendChart days={pulse.trend.days} now={line.now} prev={line.prev} label={series.label} />
                <TrendLegend />
              </div>
            }
            table={<TrendTable days={pulse.trend.days} now={line.now} prev={line.prev} label={series.label} />}
          />
        ) : (
          <p className="card t-body p-5 text-soft">No numbers for this line yet.</p>
        )}
      </Section>

      <Section id="groups" title="Who is active" intro="Different people who did something in the last 7 and 30 days, by group.">
        <div className="card overflow-x-auto p-4 sm:p-5">
          <table className="t-small w-full min-w-[18rem] text-left [font-variant-numeric:tabular-nums]">
            <caption className="sr-only">People active, by group</caption>
            <thead>
              <tr className="text-soft">
                <th scope="col" className="py-1 pr-4 font-medium">
                  Group
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  7 days
                </th>
                <th scope="col" className="py-1 font-medium">
                  30 days
                </th>
              </tr>
            </thead>
            <tbody>
              {GROUP_ORDER.map((g) => (
                <tr key={g} className="border-t border-line">
                  <th scope="row" className="py-1.5 pr-4 font-normal">
                    {GROUP_PLURAL[g]}
                  </th>
                  <td className="py-1.5 pr-4">{show(pulse.groups[g]?.d7 ?? 0)}</td>
                  <td className="py-1.5">{show(pulse.groups[g]?.d30 ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SmallGroupNote />
      </Section>

      <Section id="when" title="When people are active" intro="The last 28 days, in Lagos time.">
        {heat ? (
          <>
            <ChartFrame
              title="Weekday and hour"
              caption={heatCaption(heat)}
              chart={
                <div className="flex flex-col gap-3">
                  <HeatMap cells={heat.cells} days={heat.days} />
                  <HeatLegend />
                </div>
              }
              table={<HeatTable cells={heat.cells} />}
            />
            <div className="card flex flex-col gap-4 p-5 sm:p-6">
              <h3 className="t-heading">Each group, hour by hour</h3>
              <HourBars groups={heat.groups} />
            </div>
          </>
        ) : (
          <Unavailable />
        )}
      </Section>

      {brief && text ? (
        <Section id="brief" title="The weekly brief" intro="Written by fixed rules from the counts above, for you to read or copy. It is never sent by WhatsApp or email.">
          <div className="card flex flex-col gap-4 p-5 sm:p-6">
            <p className="t-body whitespace-pre-line" data-testid="weekly-brief">
              {text}
            </p>
            <CopyBrief text={text} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}
