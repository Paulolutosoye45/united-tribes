import type { Metadata } from "next";
import { Checklist } from "@/components/admin/Checklist";
import { PageHead } from "@/components/admin/PageHead";
import { SeasonBoard } from "@/components/admin/SeasonBoard";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadChecklist, loadSeasons } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Seasons" };

export default async function SeasonsPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin/seasons");
  const supabase = await createClient();
  const [data, checklist] = await Promise.all([loadSeasons(supabase), loadChecklist(supabase)]);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Seasons">A season is twelve weeks of tribes meeting. Plan the next one early: leaders draft their Tribe Cards for it, and members fill in the form for it.</PageHead>
      {checklist ? <Checklist checklist={checklist} roles={session.roles} /> : null}
      {data ? <SeasonBoard data={data} /> : <p className="card t-body p-6 text-soft">We couldn’t load the seasons. Try again in a moment.</p>}
    </div>
  );
}
