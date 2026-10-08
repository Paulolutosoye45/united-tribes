import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplyFlow, type View } from "@/components/leaders/ApplyFlow";
import { requireSession } from "@/lib/auth/session";
import { EMPTY_ANSWERS } from "@/lib/leaders/answers";
import { loadLeaderCatalogue, loadMyApplication } from "@/lib/leaders/server";
import { isStepId } from "@/lib/leaders/steps";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lead a circle" };

export default async function ApplyPage() {
  const session = await requireSession("/lead/apply");
  const supabase = await createClient();
  const [catalogue, { application, references }] = await Promise.all([
    loadLeaderCatalogue(supabase),
    loadMyApplication(supabase, session.person.id),
  ]);

  // Sent, decided or withdrawn applications live on the Lead page.
  if (application && application.status !== "draft" && application.status !== "ineligible") redirect("/lead");

  const referees: { 1?: { name: string; relationship: string; contact: string; head: boolean }; 2?: { name: string; relationship: string; contact: string; head: boolean } } = {};
  for (const r of references) referees[r.slot] = { name: r.name, relationship: r.relationship, contact: r.contact, head: r.head };

  let view: View = "welcome";
  if (application?.status === "ineligible") view = "ineligible";
  else if (application?.status === "draft") view = isStepId(application.step) ? application.step : "eligibility";

  const name = session.person.preferredName ?? session.person.fullName?.split(" ")[0] ?? "friend";

  return (
    <ApplyFlow
      personId={session.person.id}
      applicationId={application?.id ?? null}
      catalogue={catalogue}
      applicantName={name}
      initial={{
        view,
        answers: application?.answers ?? EMPTY_ANSWERS,
        referees,
        failed: application?.failedChecks ?? [],
      }}
    />
  );
}
