import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { formatShortDate } from "@/lib/dates";
import { loadTribe } from "@/lib/god/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "A tribe" };

export default async function GodTribePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const c = await loadTribe(supabase, id);
  if (!c) notFound();
  const active = c.members.filter((m) => m.status === "active");
  const gone = c.members.filter((m) => m.status !== "active");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/god/tribes" className="t-small text-soft hover:text-ink">
          <span aria-hidden="true">← </span>Tribes
        </Link>
        <h1 className="t-title">{c.tribe.name}</h1>
        <p className="t-small flex flex-wrap items-center gap-x-3 gap-y-1 text-soft">
          <Badge tone={c.tribe.status === "approved" ? "gold" : "outline"}>{c.tribe.status.replace(/_/g, " ")}</Badge>
          {c.tribe.community ? <span>{c.tribe.community}</span> : null}
          {c.tribe.season ? <span>{c.tribe.season}</span> : null}
          {c.tribe.zone ? <span>{c.tribe.zone}</span> : null}
          {c.tribe.mode ? <span>{c.tribe.mode.replace(/_/g, " ")}</span> : null}
        </p>
        <p className="t-body">
          Leader{" "}
          {c.tribe.leader_id ? (
            <Link href={`/god/people/${c.tribe.leader_id}`} className="font-semibold underline">
              {c.tribe.leader}
            </Link>
          ) : (
            "none"
          )}
          {c.tribe.assistant ? <> · Assistant {c.tribe.assistant}</> : null}
          {c.tribe.coach ? <> · Coach {c.tribe.coach}</> : null}
        </p>
        <p className="t-small flex flex-wrap gap-x-4 text-soft">
          <Link href={`/review/cards/${c.tribe.id}`} className="underline">
            Open the tribe card
          </Link>
          {c.care_open > 0 ? (
            <Link href="/care" className="underline">
              {c.care_open} care {c.care_open === 1 ? "task" : "tasks"} open
            </Link>
          ) : null}
        </p>
      </header>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="t-heading">
          Members ({active.length}
          {c.tribe.capacity ? ` of ${c.tribe.capacity}` : ""})
        </h2>
        {active.length === 0 ? (
          <p className="card t-body p-5 text-soft">Nobody is seated yet.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {active.map((m) => (
              <li key={m.id}>
                <Link href={`/god/people/${m.id}`} className="press flex items-center justify-between gap-4 p-4">
                  <span className="font-semibold">{m.name}</span>
                  <span className="t-small text-soft">
                    {m.present} present{m.missed > 0 ? ` · ${m.missed} missed` : ""}
                    {m.joined_at ? ` · joined ${formatShortDate(m.joined_at)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {gone.length > 0 ? <p className="t-small text-soft">{gone.length} left this tribe.</p> : null}
      </section>

      <section aria-labelledby="weeks-heading" className="flex flex-col gap-3">
        <h2 id="weeks-heading" className="t-heading">
          The weeks
        </h2>
        {c.weeks.length === 0 ? (
          <p className="card t-body p-5 text-soft">No meeting has been logged yet.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {c.weeks.map((w) => (
              <li key={w.week} className="flex flex-col gap-1 p-4">
                <p className="t-body flex flex-wrap items-center justify-between gap-x-4">
                  <span className="font-semibold">Week {w.week}</span>
                  <span className="t-small text-soft">
                    {w.held ? "Met" : "Did not meet"}
                    {w.energy ? ` · energy ${w.energy} of 5` : ""}
                    {w.need_coach ? " · asked for the coach" : ""}
                  </span>
                </p>
                {w.highlight ? <p className="t-small text-soft">{w.highlight}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
