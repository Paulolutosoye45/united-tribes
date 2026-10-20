import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { ANALYSIS, DESK_LIST } from "@/lib/god/desks";
import { loadDesks, markLooked } from "@/lib/god/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Desks" };

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-NG");

export default async function DesksPage() {
  await connection();
  const supabase = await createClient();
  const desks = await loadDesks(supabase);
  if (!desks) return <p className="card t-body p-6 text-soft">The desks could not load. Try again in a moment.</p>;
  await markLooked(supabase, "desks");

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Every desk</h1>
        <p className="t-body measure text-soft">
          Each kind of person on the platform: how many hold the role, how many were active this week, and the numbers they would be looking at.
          Open a desk to see the screens they work from and the people who hold it. You open every screen as the owner and see all of it: a coach sees only their own tribes, you see every tribe.
        </p>
        {desks.season ? <p className="t-small text-soft">Season in preparation: {desks.season.name}.</p> : <p className="t-small text-soft">No season is open for preparation.</p>}
      </header>

      <ul className="grid gap-5 lg:grid-cols-2" aria-label="Desks">
        {DESK_LIST.map((d) => {
          const tally = desks.roles.find((r) => r.role === d.role);
          return (
            <li key={d.role} data-desk={d.role}>
              <section aria-labelledby={`desk-${d.role}`} className="card flex h-full flex-col gap-4 p-5 sm:p-6">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id={`desk-${d.role}`} className="t-heading">
                      {d.label}
                    </h2>
                    <Badge tone="neutral">{n(tally?.people)} {tally?.people === 1 ? "person" : "people"}</Badge>
                    <Badge tone={tally && tally.active7d > 0 ? "gold" : "outline"}>{n(tally?.active7d)} active this week</Badge>
                  </div>
                  <p className="t-small text-soft">{d.watches}</p>
                </div>
                {d.counts.length > 0 ? (
                  <dl className="flex flex-col divide-y divide-line">
                    {d.counts.map((c) => (
                      <div key={c.key} className="flex items-baseline justify-between gap-4 py-2">
                        <dt className="t-body min-w-0">
                          {c.href ? (
                            <Link href={c.href} className="underline">
                              {c.label}
                            </Link>
                          ) : (
                            c.label
                          )}
                        </dt>
                        <dd className="shrink-0 text-xl font-semibold tabular-nums" data-count={c.key}>
                          {n(desks.counts[c.key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <div className="mt-auto">
                  <Link href={`/god/desks/${d.role}`} className="btn btn-quiet inline-flex h-10 items-center rounded-[var(--radius-control)] px-4 text-[0.9rem] font-medium" data-testid={`open-desk-${d.role}`}>
                    Open this desk
                  </Link>
                </div>
              </section>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="analysis-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="analysis-heading" className="t-heading">
            Where the analysis lives
          </h2>
          <p className="t-small measure text-soft">Nothing new is counted here. These are the places the platform analyses itself, in one list.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ANALYSIS.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="card press block h-full p-4">
                <p className="font-semibold">{a.title}</p>
                <p className="t-small text-soft">{a.what}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="t-small measure text-soft">
        What the platform has said to people, and the chats staff opened, are under{" "}
        <Link href="/god/conversations" className="underline">
          Conversations
        </Link>
        .
      </p>
    </div>
  );
}
