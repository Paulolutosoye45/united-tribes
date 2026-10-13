import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { Accuracy, CareStats, FunnelStep, Supply, Targets, TestimonyStats, CommunityRow } from "@/lib/dashboard/types";
import { pct, signed } from "@/lib/dashboard/wording";

/** From a started form to a thriving member: where people fall away. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = Math.max(steps[0]?.count ?? 0, 1);
  return (
    <section aria-labelledby="funnel-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="funnel-heading" className="t-heading">
          The journey
        </h2>
        <p className="t-small text-soft">How many people reached each step, and what share of the step before.</p>
      </div>
      <ol className="flex flex-col gap-3.5">
        {steps.map((s, i) => {
          const prev = i === 0 ? null : steps[i - 1].count;
          const share = prev && prev > 0 ? s.count / prev : null;
          return (
            <li key={s.key} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{s.label}</span>
                  {share !== null && share <= 1 ? <span className="t-small text-soft">{pct(share)} of the step before</span> : null}
                </span>
                <strong className="text-lg [font-variant-numeric:tabular-nums]">{s.count}</strong>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
                <div className="bar-right h-full rounded-full bg-gradient-to-r from-gold via-amber to-flame" style={{ width: `${Math.max((s.count / top) * 100, s.count > 0 ? 2 : 0)}%`, ["--i" as string]: i }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Who asked for a tribe, against the seats there are, community by life stage. Red means short of seats. */
export function SupplyMap({ supply }: { supply: Supply }) {
  const cell = new Map(supply.cells.map((c) => [`${c.community}|${c.track}`, c]));
  const active = supply.communities.filter((t) => supply.cells.some((c) => c.community === t));
  const quiet = supply.communities.length - active.length;
  const tracks = supply.tracks.filter((t) => supply.cells.some((c) => c.track === t));
  const worst = Math.max(1, ...supply.cells.map((c) => c.wants - c.seats));
  const short = supply.cells.filter((c) => c.wants > c.seats).reduce((a, c) => a + (c.wants - c.seats), 0);

  return (
    <section aria-labelledby="supply-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="supply-heading" className="t-heading">
          Seats and demand
        </h2>
        <p className="t-small text-soft">
          {supply.wants} members asked for a tribe and there are {supply.seats} seats in approved tribes with a certified leader.{" "}
          {short > 0 ? `${short} more seats are needed where the map is red. ` : "Every group has enough seats. "}
          {supply.unmet > 0 ? `${supply.unmet} members could not be shown three good tribes.` : ""}
        </p>
      </div>
      {active.length === 0 ? (
        <p className="t-body text-soft">No member has finished the form yet, and no tribe has been approved.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className={`w-full ${tracks.length > 2 ? "min-w-[34rem]" : ""} border-separate border-spacing-1.5 text-left`}>
            <caption className="sr-only">Members who asked for a tribe and seats available, by community and life stage</caption>
            <thead>
              <tr>
                <th scope="col" className="t-small w-[30%] pb-1 font-medium text-soft">
                  Community
                </th>
                {tracks.map((t) => (
                  <th key={t} scope="col" className="t-small pb-1 text-center font-medium text-soft">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((community) => (
                <tr key={community}>
                  <th scope="row" className="t-small py-1 pr-2 font-medium leading-tight">
                    {community}
                  </th>
                  {tracks.map((track) => {
                    const c = cell.get(`${community}|${track}`);
                    if (!c) {
                      return (
                        <td key={track} className="rounded-lg bg-surface text-center text-soft">
                          <span aria-hidden="true">·</span>
                          <span className="sr-only">No one yet</span>
                        </td>
                      );
                    }
                    const gap = c.wants - c.seats;
                    const strength = gap > 0 ? Math.round(18 + (gap / worst) * 62) : 0;
                    return (
                      <td
                        key={track}
                        className="rounded-lg p-1.5 text-center leading-tight"
                        style={{ background: gap > 0 ? `color-mix(in srgb, var(--crest-flame) ${strength}%, var(--raised))` : "var(--surface-strong)" }}
                      >
                        <span className="block text-lg font-bold [font-variant-numeric:tabular-nums]">{c.wants}</span>
                        <span className="t-small block text-soft [font-variant-numeric:tabular-nums]">{c.seats} seats</span>
                        <span className="t-small block font-semibold">{gap > 0 ? `${gap} short` : gap < 0 ? `${-gap} spare` : "even"}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="t-small text-soft">
        Each box: members who asked, seats, and the difference.{quiet > 0 ? ` ${quiet} communities${supply.tracks.length - tracks.length > 0 ? ` and ${supply.tracks.length - tracks.length} life stages` : ""} have no members or tribes yet.` : ""} Seats count tribes with a certified leader; the Starter Tribe is not counted.
      </p>
    </section>
  );
}

export function Communities({ rows, minCell }: { rows: CommunityRow[]; minCell: number }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="communities-heading" className="card flex flex-col gap-4 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="communities-heading" className="t-heading">
          By community
        </h2>
        <p className="t-small text-soft">A rate is shown only for communities with at least {minCell} members placed, so nobody can be picked out.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.community} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{r.community}</span>
              <span className="t-small text-soft [font-variant-numeric:tabular-nums]">
                {r.members} placed · {r.thriving_rate === null ? "too few to show a rate" : `${pct(r.thriving_rate)} thriving`}
                {r.gain_avg !== null ? ` · ${signed(r.gain_avg)} Success Picture` : ""}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
              {r.thriving_rate !== null ? (
                <div className="bar-right h-full rounded-full bg-flame" style={{ width: `${Math.max(r.thriving_rate * 100, 2)}%`, ["--i" as string]: i }} />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RateRows({ rows, minCell, measured }: { rows: { label: string; n: number; thriving_rate: number | null }[]; minCell: number; measured: boolean }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <li key={r.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{r.label}</span>
            <span className="t-small text-soft [font-variant-numeric:tabular-nums]">
              {r.n} placed · {r.thriving_rate === null ? (r.n < minCell ? `needs ${minCell}` : measured ? "–" : "after week 3") : `${pct(r.thriving_rate)} thriving`}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-strong" aria-hidden="true">
            {r.thriving_rate !== null ? <div className="bar-right h-full rounded-full bg-charcoal" style={{ width: `${Math.max(r.thriving_rate * 100, 2)}%`, ["--i" as string]: i }} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Does a higher compatibility score really predict a member who thrives? */
export function AccuracyPanel({ a, targets, measured }: { a: Accuracy; targets: Targets; measured: boolean }) {
  const best = a.bands.find((b) => b.key === "excellent");
  const good = a.bands.find((b) => b.key === "good");
  const strong = a.bands.find((b) => b.key === "strong");
  const compare =
    best?.thriving_rate != null && (good?.thriving_rate != null || strong?.thriving_rate != null)
      ? `Excellent matches thrive at ${pct(best.thriving_rate)}, against ${pct((good?.thriving_rate ?? strong?.thriving_rate) as number)} for ${good?.thriving_rate != null ? "Good" : "Strong"} ones.`
      : null;
  const progress = Math.min(1, a.completed / a.retrain_after);

  return (
    <section aria-labelledby="accuracy-heading" className="card flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <h2 id="accuracy-heading" className="t-heading">
          How well the matching works
        </h2>
        <p className="t-small text-soft">
          {a.average_degree === null ? "Nobody has been placed yet." : `Members were placed at an average of ${a.average_degree}% compatibility. Does a higher score mean a member who thrives?`}
        </p>
      </div>
      {compare ? <p className="t-body font-medium">{compare}</p> : <p className="t-small text-soft">There is not enough yet to say whether a higher score predicts thriving. It needs {targets.min_cell} people in a group and three weeks of the season.</p>}
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">By compatibility</h3>
          <RateRows rows={a.bands} minCell={targets.min_cell} measured={measured} />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">By the card they chose</h3>
          <RateRows rows={a.ranks} minCell={targets.min_cell} measured={measured} />
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-semibold">Ready to retrain the weights?</h3>
          <span className="t-small [font-variant-numeric:tabular-nums]">
            {a.completed} of {a.retrain_after} finished placements
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-strong" role="progressbar" aria-valuemin={0} aria-valuemax={a.retrain_after} aria-valuenow={Math.min(a.completed, a.retrain_after)} aria-label="Finished placements">
          <div className="bar-right h-full rounded-full bg-gradient-to-r from-gold to-flame" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="t-small text-soft">The weights are a first version chosen by judgement. Retrain them from these results only after about {a.retrain_after} placements have finished: before that, a better formula cannot be told from a lucky one.</p>
      </div>
    </section>
  );
}

export function CareAndTestimonies({ care, testimonies }: { care: CareStats; testimonies: TestimonyStats }) {
  const tiles = [
    { label: "Follow-ups open", value: care.open + care.escalated, note: care.escalated > 0 ? `${care.escalated} with the care team` : "none with the care team" },
    { label: "Longest wait", value: care.oldest_open_days === null ? "–" : `${care.oldest_open_days} d`, note: "oldest open follow-up" },
    { label: "Typical time to close", value: care.median_days_to_close === null ? "–" : `${care.median_days_to_close} d`, note: `${care.closed_7d} closed this week` },
    { label: "Testimonies", value: testimonies.tribe + testimonies.church, note: `${testimonies.waiting} waiting for a leader or pastor` },
  ];
  return (
    <section aria-labelledby="care-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="care-heading" className="t-heading">
          Care and testimonies
        </h2>
        <Link href="/review/rhythm#care" className="press t-small rounded-lg px-2 py-1 font-medium text-accent underline underline-offset-4">
          Open the care queue
        </Link>
      </div>
      <dl className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x, i) => (
          <div key={x.label} style={{ ["--i" as string]: i }} className="card flex flex-col gap-1 p-4 sm:p-5">
            <dt className="t-small text-soft">{x.label}</dt>
            <dd className="t-figure !text-[clamp(1.75rem,8vw,2.6rem)]">{x.value}</dd>
            <dd className="t-small text-soft">{x.note}</dd>
          </div>
        ))}
      </dl>
      <p className="t-small text-soft">
        <Badge tone="outline">Private by design</Badge> <span className="ml-1">No member’s name, step or answer appears on this page.</span>
      </p>
    </section>
  );
}
