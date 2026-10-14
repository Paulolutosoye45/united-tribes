import type { Metadata } from "next";
import { CallbackQueue } from "@/components/care/CallbackQueue";
import { PageHead } from "@/components/admin/PageHead";
import { REFEREE_CARE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadCallbacks } from "@/lib/leaders/referee/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Referee call-backs" };

export default async function CallbacksPage() {
  await requireRole(REFEREE_CARE_ROLES, "/care/referees");
  const rows = await loadCallbacks(await createClient());
  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Referee call-backs" back={{ href: "/care", label: "Care tasks" }}>
        A short call, or a message, to a referee whose reference was held back or picked at random. Ask only this: “Did you give a reference for this person?” Their answer is all we need. Be kind, and don’t say what the reference said.
      </PageHead>
      {rows ? <CallbackQueue rows={rows} /> : <p className="card t-body p-6 text-soft">We couldn’t load the call-backs. Try again in a moment.</p>}
    </div>
  );
}
