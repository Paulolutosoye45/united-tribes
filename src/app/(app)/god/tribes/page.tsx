import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Badge } from "@/components/ui/Badge";
import { loadTribes } from "@/lib/god/server";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tribes" };

type SearchParams = Promise<{ status?: string }>;

const STATUSES = [
  { id: "", label: "All" },
  { id: "approved", label: "Running" },
  { id: "submitted", label: "Waiting for review" },
  { id: "changes_requested", label: "Changes asked" },
  { id: "draft", label: "Drafts" },
  { id: "closed", label: "Closed" },
] as const;

export default async function GodTribesPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { status } = await searchParams;
  const chosen = STATUSES.find((s) => s.id === (status ?? ""))?.id ?? "";
  const supabase = await createClient();
  const tribes = await loadTribes(supabase, chosen || null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Tribes</h1>
        <p className="t-body measure text-soft">Every tribe in every season, with who leads it and how full it is.</p>
      </header>
      <nav aria-label="Filter tribes" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.id}
            href={s.id ? `/god/tribes?status=${s.id}` : "/god/tribes"}
            aria-current={s.id === chosen ? "page" : undefined}
            className={cn("press rounded-full px-4 py-2 text-[0.9rem] font-medium", s.id === chosen ? "bg-ink text-page" : "border border-line text-soft hover:text-ink")}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      {!tribes ? (
        <p className="card t-body p-6 text-soft">The tribes could not load. Try again in a moment.</p>
      ) : tribes.length === 0 ? (
        <p className="card t-body p-6 text-soft">No tribes here yet.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {tribes.map((c) => (
            <li key={c.id}>
              <Link href={`/god/tribes/${c.id}`} className="press flex flex-col gap-1.5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="t-small block text-soft">
                    Led by {c.leader ?? "no one yet"}
                    {c.community ? ` · ${c.community}` : ""}
                    {c.season ? ` · ${c.season}` : ""}
                  </span>
                </span>
                <span className="t-small flex flex-wrap items-center gap-2 text-soft">
                  <Badge tone={c.status === "approved" ? "gold" : "outline"}>{c.status.replace(/_/g, " ")}</Badge>
                  <span>
                    {c.members}
                    {c.capacity ? ` of ${c.capacity}` : ""} {c.members === 1 ? "member" : "members"}
                  </span>
                  {c.last_week_held ? <span>last met week {c.last_week_held}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
