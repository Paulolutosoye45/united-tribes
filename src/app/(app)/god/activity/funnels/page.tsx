import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ChartFrame } from "@/components/activity/ChartFrame";
import { CompareBars, CompareTable } from "@/components/activity/CompareBars";
import { FunnelBars, FunnelTable } from "@/components/activity/FunnelBars";
import { Section, SmallGroupNote, Unavailable } from "@/components/activity/parts";
import { RetentionGrid } from "@/components/activity/RetentionGrid";
import { Spread, SpreadTable } from "@/components/activity/Spread";
import { compareCaption, finishCaption, funnelCaption, retentionCaption } from "@/lib/activity/captions";
import { addDays, isDay, lagosToday, longDay, show, showWords } from "@/lib/activity/format";
import { loadCompare, loadFunnel, loadFunnelPeople, loadRetention, markViewed } from "@/lib/activity/server";
import { clock } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Funnels" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null);

function link(params: Record<string, string | number | null | undefined>, hash = ""): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return `/god/activity/funnels${s ? `?${s}` : ""}${hash}`;
}

const PRESETS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "A year" },
] as const;

export default async function FunnelsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const q = await searchParams;
  const which = pick(one(q.which), ["member", "leader"] as const) ?? "member";
  const today = lagosToday(clock());
  const to = isDay(one(q.to)) && one(q.to)! <= today ? one(q.to)! : today;
  const fromAsked = isDay(one(q.from)) ? one(q.from)! : null;
  const from = fromAsked && fromAsked <= to ? fromAsked : addDays(to, -89);
  const split = which === "member" ? pick(one(q.split), ["community", "zone", "season"] as const) : null;
  const by = pick(one(q.by), ["community", "zone", "tribe"] as const) ?? "community";
  const stageRaw = Number(one(q.stage));
  const stage = Number.isInteger(stageRaw) && stageRaw >= 1 && stageRaw <= 40 ? stageRaw : null;
  const mode = pick(one(q.mode), ["stopped", "reached"] as const) ?? "stopped";

  const supabase = await createClient();
  const [funnel, people, compare, retention] = await Promise.all([
    loadFunnel(supabase, { which, from, to, split }),
    stage ? loadFunnelPeople(supabase, { which, stage, mode, from, to, limit: 100 }) : Promise.resolve(null),
    which === "member" ? loadCompare(supabase, by) : Promise.resolve(null),
    which === "member" ? loadRetention(supabase, 12) : Promise.resolve(null),
  ]);
  if (!funnel) return <Unavailable />;
  await markViewed(supabase, "funnels");

  const base = { which, from, to, split };
  const picked = stage ? funnel.stages.find((s) => s.k === stage) : null;
  const rangeIs = (days: number) => to === today && from === addDays(today, -(days - 1));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <nav aria-label="Which journey" className="flex flex-wrap gap-2">
          {(
            [
              ["member", "Members"],
              ["leader", "Leader applicants"],
            ] as const
          ).map(([k, label]) => (
            <Link
              key={k}
              href={link({ which: k, from, to })}
              aria-current={which === k ? "true" : undefined}
              className={`press rounded-full px-4 py-1.5 text-[0.88rem] font-medium ${which === k ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <nav aria-label="Period" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Link
                key={p.days}
                href={link({ which, split, from: addDays(today, -(p.days - 1)), to: today })}
                aria-current={rangeIs(p.days) ? "true" : undefined}
                className={`press rounded-full px-3.5 py-1.5 text-[0.85rem] font-medium ${rangeIs(p.days) ? "bg-surface-strong text-ink" : "border border-line text-soft hover:text-ink"}`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
          <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Choose dates">
            <input type="hidden" name="which" value={which} />
            {split ? <input type="hidden" name="split" value={split} /> : null}
            <label className="t-small flex flex-col gap-1 text-soft">
              From
              <input type="date" name="from" defaultValue={from} max={today} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink" />
            </label>
            <label className="t-small flex flex-col gap-1 text-soft">
              To
              <input type="date" name="to" defaultValue={to} max={today} className="h-10 rounded-[var(--radius-control)] border-[1.5px] border-line bg-raised px-3 text-ink" />
            </label>
            <button type="submit" className="btn btn-quiet h-10 rounded-full px-5 text-[0.9rem] font-medium">
              Show
            </button>
          </form>
        </div>
        <p className="t-small text-soft">
          {which === "member" ? "People who registered" : "Applications started"} from {longDay(from)} to {longDay(to)}. Press a bar to see who stopped there.
        </p>
        {which === "member" ? (
          <nav aria-label="Split by" className="flex flex-wrap items-center gap-2">
            <span className="t-small text-soft">Split by</span>
            {(
              [
                [null, "Nothing"],
                ["community", "Community"],
                ["zone", "Zone"],
                ["season", "Season"],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={label}
                href={link({ which, from, to, split: k })}
                aria-current={split === k ? "true" : undefined}
                className={`press rounded-full px-3.5 py-1 text-[0.85rem] font-medium ${split === k ? "bg-surface-strong text-ink" : "border border-line text-soft hover:text-ink"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <Section id="funnel" title={which === "member" ? "From registering to week 12" : "From starting to leading"}>
        <ChartFrame
          title={which === "member" ? "The member journey" : "The leader application"}
          caption={funnelCaption(funnel)}
          chart={<FunnelBars stages={funnel.stages} active={stage} hrefFor={(k) => link({ ...base, stage: k, mode: "stopped" }, "#people")} />}
          table={<FunnelTable stages={funnel.stages} />}
        />
        <SmallGroupNote />
      </Section>

      {stage && picked ? (
        <section id="people" aria-labelledby="people-heading" className="card flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="people-heading" className="t-heading">
              {mode === "stopped" ? `Who stopped at “${picked.label}”` : `Who reached “${picked.label}”`}
            </h2>
            <div className="flex gap-2">
              {(["stopped", "reached"] as const).map((m) => (
                <Link
                  key={m}
                  href={link({ ...base, stage, mode: m }, "#people")}
                  aria-current={mode === m ? "true" : undefined}
                  className={`press rounded-full px-3.5 py-1 text-[0.85rem] font-medium ${mode === m ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
                >
                  {m === "stopped" ? "Stopped here" : "Got this far"}
                </Link>
              ))}
              <Link href={link(base)} className="press rounded-full border border-line px-3.5 py-1 text-[0.85rem] font-medium text-soft hover:text-ink">
                Close
              </Link>
            </div>
          </div>
          {!people ? (
            <Unavailable />
          ) : people.hidden ? (
            <p className="t-body text-soft">{people.total === 0 ? "No one is in this group." : "Fewer than 5 people are in this group, so no names are shown."}</p>
          ) : (
            <>
              <p className="t-small text-soft">
                {show(people.total)} {mode === "stopped" ? "stopped here" : "got this far"}
                {people.young === 0 ? "." : `, including ${showWords(people.young)} young members, who are counted but never named.`}
              </p>
              <ul className="divide-y divide-line" aria-label="People">
                {people.people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <Link href={`/god/people/${p.id}`} className="font-medium underline">
                      {p.name}
                    </Link>
                    <span className="t-small text-soft">joined {longDay(p.since.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
              {people.people.length >= 100 ? <p className="t-small text-soft">The first 100 are shown.</p> : null}
            </>
          )}
        </section>
      ) : null}

      {funnel.split && funnel.split.length > 0 ? (
        <Section id="split" title={`Split by ${split}`} intro="How many in each group reached each step. A group of fewer than 5 reads “<5”.">
          <div className="card overflow-x-auto p-4 sm:p-5">
            <table className="t-small w-full min-w-[34rem] text-left [font-variant-numeric:tabular-nums]">
              <caption className="sr-only">Reached each step, by {split}</caption>
              <thead>
                <tr className="text-soft">
                  <th scope="col" className="py-1 pr-4 font-medium">
                    {split === "community" ? "Community" : split === "zone" ? "Zone" : "Season"}
                  </th>
                  <th scope="col" className="py-1 pr-4 font-medium">
                    Registered
                  </th>
                  {funnel.stages.slice(1).map((s) => (
                    <th key={s.key} scope="col" className="py-1 pr-4 font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnel.split.map((row) => (
                  <tr key={row.value} className="border-t border-line">
                    <th scope="row" className="py-1.5 pr-4 font-normal">
                      {row.value}
                    </th>
                    <td className="py-1.5 pr-4">{show(row.total)}</td>
                    {row.reached.slice(1).map((c, i) => (
                      <td key={i} className="py-1.5 pr-4">
                        {show(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {funnel.finish ? (
        <Section id="finish" title="How long the form takes" intro="Time from opening the member form to sending it, for forms sent in this period.">
          <ChartFrame title="Time to finish" caption={finishCaption(funnel)} chart={<Spread finish={funnel.finish} />} table={<SpreadTable finish={funnel.finish} />} />
        </Section>
      ) : null}

      {which === "member" ? (
        <Section id="compare" title="Side by side" intro="Communities, zones or tribes, compared on the same measures. A group of fewer than 5 shows no percentages.">
          <nav aria-label="Compare by" className="flex flex-wrap gap-2">
            {(
              [
                ["community", "Communities"],
                ["zone", "Zones"],
                ["tribe", "Tribes"],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={k}
                href={link({ ...base, by: k }, "#compare")}
                aria-current={by === k ? "true" : undefined}
                className={`press rounded-full px-3.5 py-1 text-[0.85rem] font-medium ${by === k ? "bg-ink text-page" : "border border-line text-soft hover:text-ink"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          {compare ? (
            <ChartFrame title={`By ${by}`} caption={compareCaption(compare.rows)} chart={<CompareBars by={compare.by} rows={compare.rows} />} table={<CompareTable by={compare.by} rows={compare.rows} />} />
          ) : (
            <Unavailable />
          )}
        </Section>
      ) : null}

      {retention ? (
        <Section id="retention" title="Do people come back?" intro="Each row is the people who joined in one week. Each column is how many of them were active that week and the weeks after.">
          <ChartFrame
            title="Weekly retention"
            caption={retentionCaption(retention)}
            chart={<RetentionGrid weeks={retention.weeks} />}
            table={<RetentionGrid weeks={retention.weeks} shaded={false} />}
          />
        </Section>
      ) : null}
    </div>
  );
}
