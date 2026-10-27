import { PanelTabs } from "@/components/leaders/PanelTabs";
import { getSession } from "@/lib/auth/session";
import { hasAnyRole } from "@/lib/auth/roles";
import { loadFeaturesOverview } from "@/lib/features/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The tabs of the review panel. "Stage changes" appears only for a pastor or director, and only once My page or the Details check has been
 * opened by the owner (the database tells them, read-only), so with both Off the panel looks exactly as it did.
 */
export async function ReviewTabs() {
  const session = await getSession();
  let stages = false;
  if (session && hasAnyRole(session.roles, ["pastor", "director"])) {
    const overview = await loadFeaturesOverview(await createClient());
    stages = Boolean(overview?.features.some((f) => (f.key === "my_page" || f.key === "details_check") && f.summary !== "off"));
  }
  return <PanelTabs stages={stages} />;
}
