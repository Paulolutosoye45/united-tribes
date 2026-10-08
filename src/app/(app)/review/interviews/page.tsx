import type { Metadata } from "next";
import { PanelTabs } from "@/components/leaders/PanelTabs";
import { SlotManager } from "@/components/leaders/SlotManager";
import { REVIEW_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import type { SlotView } from "@/lib/leaders/review-types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Interview times" };

export default async function InterviewTimesPage() {
  const session = await requireRole([...REVIEW_ROLES, "admin"], "/review/interviews");
  const supabase = await createClient();
  const { data } = await supabase.rpc("review_interviews");
  const canAdd = hasAnyRole(session.roles, ["admin", "director", "pastor"]);
  const canSeeNames = hasAnyRole(session.roles, REVIEW_ROLES);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        {canSeeNames ? <PanelTabs /> : null}
        <h1 className="t-title">Interview times</h1>
        <p className="t-body measure text-soft">
          Each time is one conversation with two panelists. An invited applicant picks one that suits them, and a time can only be booked once. Applicants are only offered times more than a day away.
        </p>
      </header>
      <SlotManager slots={(data as SlotView[] | null) ?? []} canAdd={canAdd} canSeeNames={canSeeNames} />
    </div>
  );
}
