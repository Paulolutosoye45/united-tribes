import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplyFlow, type ApplyAi, type View } from "@/components/leaders/ApplyFlow";
import { loadAcademyModes } from "@/lib/academy/server";
import { requireSession } from "@/lib/auth/session";
import { EMPTY_ANSWERS } from "@/lib/leaders/answers";
import { LEADER_CONSENT_AI, leaderConsentFor } from "@/lib/leaders/consent";
import { WIRED } from "@/lib/leaders/pipeline";
import { loadApplyModes, loadLeaderCatalogue, loadMyApplication, loadPipeline } from "@/lib/leaders/server";
import { isStepId, resolveStep } from "@/lib/leaders/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lead a tribe" };

// The quick check on a written answer asks an AI service one short question while the person waits.
export const maxDuration = 60;

export default async function ApplyPage() {
  const session = await requireSession("/lead/apply");
  const supabase = await createClient();
  const [catalogue, { application, references }] = await Promise.all([
    loadLeaderCatalogue(supabase),
    loadMyApplication(supabase, session.person.id),
  ]);

  // The first check on written answers: whether it is on, and whether this draft agreed to the wording that allows it.
  const config = await supabase.rpc("leader_ai_public_config");
  const cfg = (config.data ?? {}) as { mode?: string; min_words?: number };
  const mode: ApplyAi["mode"] = cfg.mode === "on" || cfg.mode === "shadow" ? cfg.mode : "off";
  let needsConsent = false;
  if (mode === "on" && application?.status === "draft") {
    const status = await supabase.rpc("leader_ai_status", { p_app: application.id });
    needsConsent = (status.data as { consent_ok?: boolean } | null)?.consent_ok === false;
  }
  const ai: ApplyAi = {
    mode,
    minWords: typeof cfg.min_words === "number" ? cfg.min_words : 8,
    consentText: leaderConsentFor(mode).text,
    needsConsent,
    updatedConsentText: LEADER_CONSENT_AI,
  };

  // Which steps apply to this application, worked out by the database
  const [modes, training, pipeline] = await Promise.all([loadApplyModes(supabase, application?.id ?? null), loadAcademyModes(supabase), loadPipeline(supabase)]);
  // Find your tribe: a screen after "how you lead best". Off, or unreadable, and the form is exactly what it was.
  const fit = WIRED.tribeFit && pipeline.tribeFit;

  // Sent, decided or withdrawn applications live on the Lead page.
  if (application && application.status !== "draft" && application.status !== "ineligible") redirect("/lead");

  const referees: { 1?: { name: string; relationship: string; contact: string; head: boolean }; 2?: { name: string; relationship: string; contact: string; head: boolean } } = {};
  for (const r of references) referees[r.slot] = { name: r.name, relationship: r.relationship, contact: r.contact, head: r.head };

  let view: View = "welcome";
  if (application?.status === "ineligible") view = "ineligible";
  // A draft saved at a screen that no longer applies (a referee, when references have since been switched off) goes on to the next one
  else if (application?.status === "draft") view = resolveStep(isStepId(application.step) ? application.step : "eligibility", modes);

  const name = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "friend";

  return (
    <ApplyFlow
      personId={session.person.id}
      applicationId={application?.id ?? null}
      catalogue={catalogue}
      applicantName={name}
      ai={ai}
      modes={modes}
      training={training}
      fit={fit}
      initial={{
        view,
        answers: application?.answers ?? EMPTY_ANSWERS,
        referees,
        failed: application?.failedChecks ?? [],
      }}
    />
  );
}
