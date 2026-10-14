import type { Metadata } from "next";
import { PageHead } from "@/components/admin/PageHead";
import { ApprovalCard } from "@/components/outreach/ApprovalCard";
import { APPROVE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadAnnounceContext, loadApprovals } from "@/lib/outreach/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function ApprovalsPage() {
  const session = await requireRole(APPROVE_ROLES, "/admin/announcements/approvals");
  const supabase = await createClient();
  const [rows, ctx] = await Promise.all([loadApprovals(supabase), loadAnnounceContext(supabase, session)]);
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Waiting for approval" back={{ href: "/admin/announcements", label: "Announcements" }}>
        Read each one as the person will. Approving fixes the list of people at that moment. You can never approve your own.
      </PageHead>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-8">{rows.map((r) => <ApprovalCard key={r.id} row={r} site={ctx.site} church={ctx.church} />)}</div>
      ) : (
        <p className="card t-body p-6 text-soft">Nothing is waiting. When someone sends an announcement for approval, you will get an email and it will appear here.</p>
      )}
    </div>
  );
}
