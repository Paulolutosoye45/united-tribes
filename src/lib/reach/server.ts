import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STRIP_OFF, parseTribeStrip, type TribeStrip } from "./series";

// Answers "Off" when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the database file is
// applied behaves exactly as it always did.

/** The strip for one tribe: who can be messaged on WhatsApp, who is being asked, and what the leader can do about it. */
export async function loadTribeStrip(supabase: SupabaseClient, tribe: string): Promise<TribeStrip> {
  try {
    const { data, error } = await supabase.rpc("tribe_reach", { p_tribe: tribe });
    return error ? STRIP_OFF : parseTribeStrip(data);
  } catch {
    return STRIP_OFF;
  }
}
