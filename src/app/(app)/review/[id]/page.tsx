import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewWorkspace } from "@/components/leaders/ReviewWorkspace";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import type { ReviewDetail } from "@/lib/leaders/review-types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review an application" };

export default async function ReviewApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireRole(REVIEW_ROLES, `/review/${id}`);
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_application", { p_id: id });
  if (error || !data) notFound();
  return <ReviewWorkspace detail={data as ReviewDetail} roles={session.roles} />;
}
