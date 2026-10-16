import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Method } from "./screens";

/**
 * Right after a verified sign-in on the server (Google, or the link in the email), tell the activity log how the person
 * came in. Once per session: the database ignores a second one. It must never stop a sign-in, so a fault is swallowed.
 */
export async function recordSignIn(supabase: SupabaseClient, method: Extract<Method, "google" | "link">) {
  try {
    await supabase.rpc("activity_track", { p_kind: "signin", p_screen: null, p_device: null, p_method: method, p_speed: null });
  } catch {
    // Not recorded this time.
  }
}
