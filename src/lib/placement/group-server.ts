import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGroupList, type GroupList } from "./group";

/** The leader's WhatsApp group list for one tribe. Null for anyone who does not run it, and when the database cannot be reached or does not have the function yet. */
export async function loadGroupList(supabase: SupabaseClient, tribe: string): Promise<GroupList | null> {
  try {
    const { data, error } = await supabase.rpc("tribe_group_list", { p_tribe: tribe });
    return error ? null : parseGroupList(data);
  } catch {
    return null;
  }
}
