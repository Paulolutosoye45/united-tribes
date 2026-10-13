import type { Metadata } from "next";
import Link from "next/link";
import { LeaderProgress } from "@/components/dashboard/LeaderProgress";
import { buttonClasses } from "@/components/ui/Button";
import { loadMyTribe } from "@/lib/academy/server";
import { requireRole } from "@/lib/auth/session";
import { loadTribeProgress } from "@/lib/dashboard/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your tribe’s season" };

type SearchParams = Promise<{ tribe?: string }>;

export default async function LeadProgressPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["leader", "assistant_leader", "coach", "pastor", "director"], "/lead/progress");
  const { tribe } = await searchParams;
  const supabase = await createClient();

  const own = await loadMyTribe(supabase);
  const tribeId = isUuid(tribe) ? tribe : own?.id;
  const p = tribeId ? await loadTribeProgress(supabase, tribeId) : null;

  if (!tribeId || !p) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="t-title">Your tribe’s season</h1>
        <p className="t-body measure text-soft">
          {tribeId ? "We could not open that tribe. You may not have access to it." : "This page opens once your Tribe Card is approved and members have joined."}
        </p>
        <div>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Back to Lead</span>
          </Link>
        </div>
      </div>
    );
  }

  const weekHref = tribe && isUuid(tribe) ? `/lead/week?tribe=${tribe}` : "/lead/week";
  return <LeaderProgress p={p} weekHref={weekHref} />;
}
