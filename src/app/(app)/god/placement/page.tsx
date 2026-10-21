import type { Metadata } from "next";
import { connection } from "next/server";
import { PlacementHome } from "@/components/god/PlacementHome";
import { loadHolds, loadPlacementOverview } from "@/lib/placement/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Placement" };

export default async function GodPlacementPage() {
  await connection();
  const supabase = await createClient();
  const [overview, holds, communities] = await Promise.all([
    loadPlacementOverview(supabase),
    loadHolds(supabase),
    supabase.from("communities").select("id, name").eq("active", true).order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="t-title">Placement</h1>
        <p className="t-body measure text-soft">
          Place members in tribes for them, by the same Degree of Compatibility they see themselves. You read every plan before anyone is told, and you can undo a run until a tribe’s leader has been told.
        </p>
      </header>
      {overview ? (
        <PlacementHome
          overview={overview}
          communities={((communities.data as { id: string; name: string }[] | null) ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))}
          holds={holds}
        />
      ) : (
        <p className="card t-body p-5 text-soft">Placement is not available right now. Reload the page, or unlock the console again.</p>
      )}
    </div>
  );
}
