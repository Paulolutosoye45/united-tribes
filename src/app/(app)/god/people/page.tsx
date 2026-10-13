import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { loadPeople } from "@/lib/god/server";
import { ago, clock, roleWords } from "@/lib/god/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "People" };

type SearchParams = Promise<{ q?: string }>;

const FORM = { new: "No form yet", started: "Form started", complete: "Form done" } as const;

export default async function GodPeoplePage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 60) || null;
  const supabase = await createClient();
  const result = await loadPeople(supabase, query, 80);
  const now = clock();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">People</h1>
        <p className="t-body measure text-soft">Everyone who has signed in, most recently active first. Open anyone to see where they are, what they have done and what has been sent them.</p>
      </header>
      <form method="get" role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name or email"
          aria-label="Search people"
          className="h-13 w-full rounded-full border-[1.5px] border-line bg-raised px-5 text-base placeholder:text-soft/70 hover:border-soft focus:border-ink focus:outline-none"
          style={{ height: "3.25rem" }}
        />
        <button type="submit" className="btn btn-quiet rounded-full px-6 font-medium" style={{ height: "3.25rem" }}>
          Search
        </button>
      </form>
      {result ? (
        <>
          <p className="t-small text-soft" aria-live="polite">
            {query ? `${result.total} ${result.total === 1 ? "match" : "matches"} for “${query}”` : `${result.total} people`}
            {result.people.length < result.total ? `, showing ${result.people.length}` : ""}
          </p>
          {result.people.length === 0 ? (
            <p className="card t-body p-6 text-soft">Nobody matches.</p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {result.people.map((p) => (
                <li key={p.id}>
                  <Link href={`/god/people/${p.id}`} className="press flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <span className="flex min-w-0 items-center gap-3.5">
                      <Avatar name={p.name} size={42} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{p.name}</span>
                        <span className="t-small block truncate text-soft">{p.email}</span>
                      </span>
                    </span>
                    <span className="t-small flex flex-wrap items-center gap-x-2 gap-y-1 pl-[3.375rem] text-soft sm:justify-end sm:pl-0">
                      {p.roles && p.roles.length > 0 ? <Badge tone="gold">{roleWords(p.roles)}</Badge> : null}
                      <Badge tone={p.form === "complete" ? "neutral" : "outline"}>{FORM[p.form]}</Badge>
                      {p.tribe ? <span>{p.tribe}</span> : null}
                      {p.last_seen ? <span>{ago(p.last_seen, now) || "a while ago"}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="card t-body p-6 text-soft">The list could not load. Try again in a moment.</p>
      )}
    </div>
  );
}
