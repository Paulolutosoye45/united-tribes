import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewTabs } from "@/components/leaders/ReviewTabs";
import { StageReviewList } from "@/components/profile/StageReviewList";
import { requireRole } from "@/lib/auth/session";
import { loadStageReviews } from "@/lib/profile/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review: stage changes" };

/**
 * Changes to a leader's stage of life that a pastor decides. A change comes here only when it touches others (the leader's tribe has members, or
 * its card has been approved); nothing is moved by it, and nobody is moved when it is approved. Directors and the admin can read the list.
 */
export default async function ReviewStagesPage() {
  await requireRole(["pastor", "director", "admin"], "/review/stages");
  const data = await loadStageReviews(await createClient());
  if (!data) notFound();
  const pending = data.reviews.filter((r) => r.status === "pending").length;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="t-title">Review leaders</h1>
          <p className="t-body measure text-soft">
            A leader asked to change their stage of life, and their tribe has members. Until a pastor decides, nothing changes and nobody is moved.
            {pending > 0 ? ` ${pending} ${pending === 1 ? "change is" : "changes are"} waiting.` : ""}
          </p>
        </div>
        <ReviewTabs />
      </header>
      <StageReviewList reviews={data.reviews} canDecide={data.canDecide} />
    </div>
  );
}
