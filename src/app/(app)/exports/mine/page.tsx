import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { MyExportsList } from "@/components/exports/MyExportsList";
import { requireSession } from "@/lib/auth/session";
import { loadMyExports } from "@/lib/exports/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My files" };

/** The files this person made in the last 30 days: when, what, how many rows and why. Never what was in them. */
export default async function MyExportsPage() {
  await connection();
  await requireSession("/exports/mine");
  const items = await loadMyExports(await createClient());
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/exports" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Exports
        </Link>
        <h1 className="t-title">My files</h1>
        <p className="t-body measure text-soft">
          Files are made when you ask and are not kept by us: the link works for 24 hours, only for you, and you can delete it now. This list is only a note of what you made.
        </p>
      </header>
      <MyExportsList items={items} />
    </div>
  );
}
