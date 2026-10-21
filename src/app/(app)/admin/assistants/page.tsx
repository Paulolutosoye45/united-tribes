import type { Metadata } from "next";
import { AssistantBoard } from "@/components/admin/AssistantBoard";
import { PageHead } from "@/components/admin/PageHead";
import { OVERSIGHT_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { parseAssistantRequests } from "@/lib/placement/assistants";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Assistant leaders" };

export default async function AssistantsPage() {
  await requireRole(OVERSIGHT_ROLES, "/admin/assistants");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assistant_requests");
  const { open, recent } = error ? { open: [], recent: [] } : parseAssistantRequests(data);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Assistant leaders">
        A leader can recommend one person as their tribe’s assistant. Approve it and, if the person is already an approved assistant leader, they are paired at once. If not, they are invited to apply and paired when a pastor approves them. A tribe has one assistant: Replace swaps them in one step.
      </PageHead>
      <AssistantBoard open={open} recent={recent} />
    </div>
  );
}
