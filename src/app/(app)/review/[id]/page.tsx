import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewWorkspace } from "@/components/leaders/ReviewWorkspace";
import { REVIEW_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { isUuid } from "@/lib/leaders/errors";
import { parseFitPanel } from "@/lib/leaders/fit-panel";
import { loadReviewReferees } from "@/lib/leaders/referee/server";
import { loadPipeline } from "@/lib/leaders/server";
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
  // What has been proved about each referee. It is only extra: if it cannot be read, the references show as before.
  const referees = await loadReviewReferees(supabase, id);
  // Tribe fit: a separate call, so that a failure here leaves the rest of the page exactly as it was. It is shown when the application
  // has a comparison, or when Tribe fit is on and a reviewer has not yet scored (the database holds it back until they have).
  const [fitRaw, pipeline] = await Promise.all([supabase.rpc("leader_fit_panel", { p_app: id }), loadPipeline(supabase)]);
  const panel = fitRaw.error ? null : parseFitPanel(fitRaw.data);
  const tribeFit = panel && (panel.visible ? panel.run !== null : pipeline.tribeFit) ? panel : null;
  return (
    <ReviewWorkspace
      detail={data as ReviewDetail}
      roles={session.roles}
      scorecard={card.error ? null : (card.data as Scorecard | null)}
      referees={referees}
      tribeFit={tribeFit}
    />
  );
}
