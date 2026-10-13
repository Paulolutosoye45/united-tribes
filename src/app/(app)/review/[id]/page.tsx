import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewWorkspace } from "@/components/leaders/ReviewWorkspace";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import type { ReviewDetail, Scorecard } from "@/lib/leaders/review-types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review an application" };

export default async function ReviewApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(REVIEW_ROLES, `/review/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_application", { p_id: id });
  if (error || !data) notFound();
  // The first check's reading. It is only extra: if it cannot be read, the page works as before.
  const card = await supabase.rpc("leader_ai_scorecard", { p_id: id });
  return <ReviewWorkspace detail={data as ReviewDetail} roles={session.roles} scorecard={card.error ? null : (card.data as Scorecard | null)} />;
}
