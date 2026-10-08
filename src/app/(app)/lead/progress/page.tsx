import type { Metadata } from "next";
import Link from "next/link";
import { LeaderProgress } from "@/components/dashboard/LeaderProgress";
import { buttonClasses } from "@/components/ui/Button";
import { loadMyCircle } from "@/lib/academy/server";
import { requireRole } from "@/lib/auth/session";
import { loadCircleProgress } from "@/lib/dashboard/server";
import { isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your circle’s season" };

type SearchParams = Promise<{ circle?: string }>;

export default async function LeadProgressPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["leader", "assistant_leader", "coach", "pastor", "director"], "/lead/progress");
  const { circle } = await searchParams;
  const supabase = await createClient();

  const own = await loadMyCircle(supabase);
  const circleId = isUuid(circle) ? circle : own?.id;
  const p = circleId ? await loadCircleProgress(supabase, circleId) : null;

  if (!circleId || !p) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="t-title">Your circle’s season</h1>
        <p className="t-body measure text-soft">
          {circleId ? "We could not open that circle. You may not have access to it." : "This page opens once your Circle Card is approved and members have joined."}
        </p>
        <div>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Back to Lead</span>
          </Link>
        </div>
      </div>
    );
  }

  const weekHref = circle && isUuid(circle) ? `/lead/week?circle=${circle}` : "/lead/week";
  return <LeaderProgress p={p} weekHref={weekHref} />;
}
