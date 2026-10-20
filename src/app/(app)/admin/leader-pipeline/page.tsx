import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { PipelineSwitchboard } from "@/components/admin/PipelineSwitchboard";
import { TribeFitBoard } from "@/components/admin/TribeFitBoard";
import { FIT_APPROVE_ROLES, PIPELINE_EDIT_ROLES, PIPELINE_VIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { parseFitModels, parseFitStatus } from "@/lib/leaders/fit-admin";
import { parsePipelineLog } from "@/lib/leaders/pipeline";
import { loadPipeline } from "@/lib/leaders/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leader pipeline" };

export default async function LeaderPipelinePage() {
  const session = await requireRole(PIPELINE_VIEW_ROLES, "/admin/leader-pipeline");
  const supabase = await createClient();
  const [pipeline, log, fitStatus, fitModels] = await Promise.all([
    loadPipeline(supabase),
    supabase.rpc("leader_pipeline_log_list", { p_limit: 50 }),
    supabase.rpc("leader_fit_status"),
    supabase.rpc("leader_fit_models_list"),
  ]);
  const canEdit = hasAnyRole(session.roles, PIPELINE_EDIT_ROLES);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Leader pipeline">
        The steps a person goes through to become a leader. Each can be required, optional or off. A pastor still decides every application, and a change here never alters an application that was already sent.
      </PageHead>
      <PipelineSwitchboard pipeline={pipeline} canEdit={canEdit} log={parsePipelineLog(log.data)} />
      <TribeFitBoard
        status={fitStatus.error ? null : parseFitStatus(fitStatus.data)}
        models={fitModels.error ? [] : parseFitModels(fitModels.data)}
        canApprove={hasAnyRole(session.roles, FIT_APPROVE_ROLES)}
      />
    </div>
  );
}
