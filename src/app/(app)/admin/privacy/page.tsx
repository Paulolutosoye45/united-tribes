import type { Metadata } from "next";
import { ErasureBoard } from "@/components/admin/ErasureBoard";
import { PageHead } from "@/components/admin/PageHead";
import { requireRole } from "@/lib/auth/session";
import { PRIVACY_ROLES } from "@/lib/auth/roles";
import { readQueue } from "@/lib/privacy/wording";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Data requests" };

export default async function PrivacyPage() {
  const session = await requireRole(PRIVACY_ROLES, "/admin/privacy");
  const supabase = await createClient();
  const { data } = await supabase.rpc("erasure_queue");
  const queue = readQueue(data);

  return (
    <div className="flex flex-col gap-10">
      <PageHead title="Data requests">
        Members can ask for their account and everything in it to be deleted. Each request waits here until an admin or director answers it. Deleting cannot be undone. Saying no needs a reason, which the member reads on their profile.
      </PageHead>
      <ErasureBoard queue={queue} me={session.person.id} />
    </div>
  );
}
