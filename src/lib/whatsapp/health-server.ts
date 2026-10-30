import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHealthView, type HealthView } from "./health-view";

/** The health page's data, or null when the page is Off, the database does not have it yet, refuses, or cannot be reached. */
export async function loadWhatsappHealth(supabase: SupabaseClient): Promise<HealthView | null> {
  try {
    const { data, error } = await supabase.rpc("whatsapp_health_overview");
    return error ? null : parseHealthView(data);
  } catch {
    return null;
  }
}
