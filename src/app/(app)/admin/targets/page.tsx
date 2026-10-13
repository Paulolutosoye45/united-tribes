import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { TargetBoard } from "@/components/admin/TargetBoard";
import { DATA_ROLES, OFFICE_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadTargets } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin/targets");
  const supabase = await createClient();
  const targets = await loadTargets(supabase);
  const canEdit = hasAnyRole(session.roles, DATA_ROLES);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Targets">
        The numbers the dashboards, the reports and each tribe&rsquo;s verdict are measured against. The usual settings come from the programme&rsquo;s plan: 85% of members thriving, eight meetings of twelve, and so on. Change one only when the church has decided to, and the dashboards
        change the next time they are opened.
      </PageHead>
      {targets ? <TargetBoard targets={targets} canEdit={canEdit} /> : <p className="card t-body p-6 text-soft">We couldn’t load the targets. Try again in a moment.</p>}
    </div>
  );
}
