import type { Metadata } from "next";
import Link from "next/link";
import { RemovalBoard } from "@/components/removal/RemovalBoard";
import { REMOVAL_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { REMOVAL_WORDS } from "@/lib/removal/removal";
import { loadRemovalBoard } from "@/lib/removal/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Removal requests" };

export default async function RemovalsPage() {
  await requireRole(REMOVAL_ROLES, "/growth/removals");
  const board = await loadRemovalBoard(await createClient());

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link href="/growth" className="press -ml-1 inline-flex min-h-10 w-fit items-center rounded-lg px-1 text-[0.95rem] font-medium text-soft hover:text-ink">
          ← Growth
        </Link>
        <h1 className="t-title">{REMOVAL_WORDS.boardTitle}</h1>
        <p className="t-body measure text-soft">{REMOVAL_WORDS.boardIntro}</p>
      </header>
      <RemovalBoard board={board} />
    </div>
  );
}
