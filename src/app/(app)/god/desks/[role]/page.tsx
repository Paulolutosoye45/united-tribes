import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { deskFor } from "@/lib/god/desks";
import { loadDesks, loadRolePeople, markLooked } from "@/lib/god/server";
import { ago, clock } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A desk" };

type Params = Promise<{ role: string }>;
const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-NG");

export default async function DeskPage({ params }: { params: Params }) {
  await connection();
  const { role } = await params;
  const desk = deskFor(role);
  if (!desk) notFound();
  const supabase = await createClient();
  const [desks, holders] = await Promise.all([loadDesks(supabase), loadRolePeople(supabase, desk.role)]);
  if (!desks || !holders) return <p className="card t-body p-6 text-soft">The desk could not load. Try again in a moment.</p>;
  await markLooked(supabase, "desk", desk.role);
  const tally = desks.roles.find((r) => r.role === desk.role);
  const now = clock();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Link href="/god/desks" className="t-small text-soft hover:text-ink">
          <span aria-hidden="true">← </span>Every desk
        </Link>
        <h1 className="t-title">{desk.label}</h1>
        <p className="t-body measure text-soft">{desk.watches}</p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{n(tally?.people)} {tally?.people === 1 ? "person" : "people"}</Badge>
          <Badge tone={tally && tally.active7d > 0 ? "gold" : "outline"}>{n(tally?.active7d)} active this week</Badge>
        </div>
      </header>

      {desk.counts.length > 0 ? (
        <section aria-labelledby="numbers-heading" className="flex flex-col gap-3">
          <h2 id="numbers-heading" className="t-heading">
            The numbers they would be looking at
          </h2>
          <dl className="card flex flex-col divide-y divide-line p-5">
            {desk.counts.map((c) => (
              <div key={c.key} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="t-body">
                  {c.href ? (
                    <Link href={c.href} className="underline">
                      {c.label}
                    </Link>
                  ) : (
                    c.label
                  )}
                </dt>
                <dd className="text-xl font-semibold tabular-nums" data-count={c.key}>
                  {n(desks.counts[c.key])}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="screens-heading" className="flex flex-col gap-3">
        <h2 id="screens-heading" className="t-heading">
          The screens they work from
        </h2>
        <p className="t-small measure text-soft">You open each as the owner. What a person in this role sees of their own tribes, you see across all of them.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {desk.items.map((i) => (
            <li key={i.href + i.title}>
              <Link href={i.href} className="card press block h-full p-4" data-testid={`screen-${i.href}`}>
                <p className="font-semibold">{i.title}</p>
                <p className="t-small text-soft">{i.what}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="people-heading" className="flex flex-col gap-3">
        <h2 id="people-heading" className="t-heading">
          Who holds it
        </h2>
        {holders.people.length === 0 ? (
          <p className="card t-body p-5 text-soft">Nobody holds this role yet.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden" data-testid="desk-people">
            {holders.people.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/god/people/${p.id}`} className="flex min-w-0 items-center gap-3.5">
                  <Avatar name={p.name} size={40} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="t-small block text-soft">{p.lastSeen ? `Last active ${ago(p.lastSeen, now) || "a while ago"}` : "Has not done anything yet"}</span>
                  </span>
                </Link>
                <span className="t-small flex flex-wrap items-center gap-x-3 gap-y-1 pl-[3.25rem] text-soft sm:pl-0">
                  <span>{n(p.actions7d)} {p.actions7d === 1 ? "action" : "actions"} this week</span>
                  {p.tribes > 0 ? <span>{p.tribes} {p.tribes === 1 ? "tribe" : "tribes"}</span> : null}
                  <Link href={`/god/conversations?person=${p.id}`} className="underline">
                    Their messages
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
