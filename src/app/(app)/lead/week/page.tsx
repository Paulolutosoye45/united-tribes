import type { Metadata } from "next";
import Link from "next/link";
import { LeaderWeek } from "@/components/rhythm/LeaderWeek";
import { buttonClasses } from "@/components/ui/Button";
import { loadMyCircle } from "@/lib/academy/server";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { loadCircleWeek, loadPendingTestimonies } from "@/lib/rhythm/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "This week" };

type SearchParams = Promise<{ circle?: string; week?: string }>;

export default async function LeadWeekPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireRole(["leader", "assistant_leader", "coach", "pastor", "director"], "/lead/week");
  const { circle, week } = await searchParams;
  const supabase = await createClient();

  const own = await loadMyCircle(supabase);
  const circleId = isUuid(circle) ? circle : own?.id;
  const wk = week && /^\d{1,2}$/.test(week) ? Number(week) : null;

  const [cw, pending] = circleId ? await Promise.all([loadCircleWeek(supabase, circleId, wk), loadPendingTestimonies(supabase)]) : [null, null];

  if (!circleId || !cw) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="t-title">This week</h1>
        <p className="t-body measure text-soft">
          {circleId ? "We could not open that circle. You may not have access to it." : "Your weekly page opens once your Circle Card is approved and members have joined."}
        </p>
        <div>
          <Link href="/lead" className={buttonClasses({ variant: "quiet", size: "md" })}>
            <span className="relative">Back to Lead</span>
          </Link>
        </div>
      </div>
    );
  }

  const callerFirst = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "your leader";
  const base = circle && isUuid(circle) ? `/lead/week?circle=${circle}` : "/lead/week";
  const mine = (pending?.circle ?? []).filter((t) => t.circle === cw.circle.name);

  return <LeaderWeek week={cw} callerFirst={callerFirst} pending={mine} base={base} />;
}
