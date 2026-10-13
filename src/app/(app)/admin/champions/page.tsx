import type { Metadata } from "next";
import { ChampionBoard } from "@/components/admin/ChampionBoard";
import { PageHead } from "@/components/admin/PageHead";
import { OFFICE_ROLES, PROGRAMME_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadAdminCatalogue, loadChampions } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Community champions" };

export default async function ChampionsPage() {
  const session = await requireRole(OFFICE_ROLES, "/admin/champions");
  const supabase = await createClient();
  const [catalogue, champions] = await Promise.all([loadAdminCatalogue(supabase), loadChampions(supabase)]);
  const communities = (catalogue?.communities ?? []).filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Community champions">
        A community champion looks after one community: they see how its tribes are doing and read its reports. Appointing someone gives them the champion role; taking them off a community removes it only if they champion no other.
      </PageHead>
      {catalogue && champions ? (
        <ChampionBoard communities={communities} champions={champions} canEdit={hasAnyRole(session.roles, PROGRAMME_ROLES)} />
      ) : (
        <p className="card t-body p-6 text-soft">We couldn’t load the champions. Try again in a moment.</p>
      )}
    </div>
  );
}
