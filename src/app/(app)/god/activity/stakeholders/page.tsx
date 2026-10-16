import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Unavailable } from "@/components/activity/parts";
import { metricText, moved, num } from "@/lib/activity/format";
import { loadStakeholders, markViewed } from "@/lib/activity/server";
import type { Metric } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stakeholders" };

function Movement({ m }: { m: Metric }) {
  if (m.prev === null || m.prev === undefined) return null;
  const text = m.unit === "count" ? moved(m.value, m.prev).text : "";
  if (!text) return null;
  return <span className="t-small block text-soft">30 days before: {metricText({ value: m.prev, unit: m.unit })} ({text})</span>;
}

export default async function StakeholdersPage() {
  await connection();
  const supabase = await createClient();
  const data = await loadStakeholders(supabase);
  if (!data) return <Unavailable />;
  await markViewed(supabase, "stakeholders");

  return (
    <div className="flex flex-col gap-8">
      <p className="t-body measure text-soft">
        What each group is actually doing, over the last {data.window_days} days, and which decision it should inform. Counts of fewer than 5 read “&lt;5”. Young members are counted inside Members, never named.
      </p>
      <div className="grid gap-5 lg:grid-cols-2">
        {data.panels.map((panel) => (
          <section key={panel.id} aria-labelledby={`panel-${panel.id}`} data-panel={panel.id} className="card flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex flex-col gap-1">
              <h2 id={`panel-${panel.id}`} className="t-heading">
                {panel.title}
              </h2>
              <p className="t-small text-soft">Helps you decide: {panel.informs}.</p>
            </div>
            <dl className="flex flex-col divide-y divide-line">
              {panel.metrics.map((m) => (
                <div key={m.key} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="t-body min-w-0">
                    {m.label}
                    {m.note ? <span className="t-small block text-soft">{m.note}</span> : null}
                    <Movement m={m} />
                  </dt>
                  <dd className="shrink-0 text-xl font-semibold tabular-nums" style={{ letterSpacing: "-0.01em" }}>
                    {metricText(m)}
                  </dd>
                </div>
              ))}
            </dl>
            {panel.people && panel.people.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="t-small font-semibold">Who did the most (30 days)</h3>
                <ul className="divide-y divide-line">
                  {panel.people.map((p) => (
                    <li key={p.id} className="flex items-baseline justify-between gap-3 py-1.5">
                      <Link href={`/god/people/${p.id}`} className="t-body underline">
                        {p.name}
                      </Link>
                      <span className="t-small text-soft [font-variant-numeric:tabular-nums]">{num(p.actions)} actions</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
