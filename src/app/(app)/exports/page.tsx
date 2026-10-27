import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { ExportStudio } from "@/components/exports/ExportStudio";
import { requireSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { loadExportOptions } from "@/lib/exports/server";
import { NOT_YET } from "@/lib/exports/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Exports" };

type SearchParams = Promise<{ pack?: string; tribe?: string; community?: string; season?: string }>;

/**
 * Exports and reports. What this page offers is decided by the database for the person signed in: a file the church has not opened to
 * their role is not listed, and while everything is Off the page says so and nothing else. There is no switch on this page.
 */
export default async function ExportsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  await requireSession("/exports");
  const q = await searchParams;
  const supabase = await createClient();
  const options = await loadExportOptions(supabase);
  const open = !!options && options.open && options.packs.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Exports</h1>
        <p className="t-body measure text-soft">Take a spreadsheet or a printed page with you. You choose it, check it, and get it, and the church keeps a note of who made which file and why, never what was in it.</p>
      </header>
      {open && options ? (
        <ExportStudio
          options={options}
          initial={{ pack: q.pack ?? null, tribe: isUuid(q.tribe) ? q.tribe : null, community: isUuid(q.community) ? q.community : null, season: isUuid(q.season) ? q.season : null }}
          canFeeds={options.packs.some((p) => p.id === "insight_feeds")}
        />
      ) : (
        <section className="card flex flex-col gap-3 p-6" data-testid="exports-closed">
          <h2 className="t-heading">Nothing to export yet</h2>
          <p className="t-body measure text-soft">{options ? NOT_YET : "Exports are not available right now. Try again in a moment."}</p>
          <Link href="/exports/mine" className="press inline-flex min-h-11 w-fit items-center text-[0.95rem] font-medium text-soft hover:text-ink">
            My files
          </Link>
        </section>
      )}
    </div>
  );
}
