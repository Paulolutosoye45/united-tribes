import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FeedsPanel } from "@/components/exports/FeedsPanel";
import { requireSession } from "@/lib/auth/session";
import { loadExportOptions, loadFeedLinks } from "@/lib/exports/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Standing links" };

/**
 * Standing links for reporting tools. Only a person whose role includes the Insight feeds pack, while it is open to them, sees this page;
 * to everyone else it does not exist. Making a link also needs the church to have opened that way in, which the database checks.
 */
export default async function FeedsPage() {
  await connection();
  await requireSession("/exports/feeds");
  const supabase = await createClient();
  const options = await loadExportOptions(supabase);
  if (!options?.packs.some((p) => p.id === "insight_feeds")) notFound();
  const links = await loadFeedLinks(supabase);
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/exports" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Exports
        </Link>
        <h1 className="t-title">Standing links</h1>
        <p className="t-body measure text-soft">
          For a reporting tool such as a spreadsheet or a dashboard that reads a web address on a schedule. Each link is one coded table, with no names, read only, and ends after 90 days unless you renew it.
        </p>
      </header>
      <FeedsPanel links={links} open />
    </div>
  );
}
