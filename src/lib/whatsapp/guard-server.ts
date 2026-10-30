import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGuard, type GuardView } from "./guard";

/** How WhatsApp stands, or null when the database does not have the safety net yet, refuses, or cannot be reached: the page then shows nothing new. */
export async function loadWhatsappGuard(supabase: SupabaseClient): Promise<GuardView | null> {
  try {
    const { data, error } = await supabase.rpc("whatsapp_guard_overview");
    return error ? null : parseGuard(data);
  } catch {
    return null;
  }
}
