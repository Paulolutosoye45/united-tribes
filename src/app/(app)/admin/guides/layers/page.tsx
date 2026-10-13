import type { Metadata } from "next";
import { LayersBoard } from "@/components/admin/LayersBoard";
import { PageHead } from "@/components/admin/PageHead";
import { OFFICE_ROLES } from "@/lib/auth/roles";
import { requireRole } from "@/lib/auth/session";
import { loadLayers } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Community and goal layer" };

export default async function LayersPage() {
  await requireRole(OFFICE_ROLES, "/admin/guides/layers");
  const supabase = await createClient();
  const layers = await loadLayers(supabase);

  return (
    <div className="flex flex-col gap-8">
      <PageHead title="Community and goal layer" back={{ href: "/admin/guides", label: "Weekly guides" }}>
        On top of the shared guide, each community has a skill-share prompt and each goal has ideas for the weekly step. There is one for each third of the season: weeks 1 to 4, 5 to 8 and 9 to 12.
      </PageHead>
      {layers ? <LayersBoard layers={layers} /> : <p className="card t-body p-6 text-soft">We couldn’t load this. Try again in a moment.</p>}
    </div>
  );
}
