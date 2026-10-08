import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Right after a verified sign-in, turn any pending invitation for this email
 * into a role. The database only does this for a verified email address, and
 * a failure here must never block sign-in.
 */
export async function claimInvitations(supabase: SupabaseClient) {
  try {
    await supabase.rpc("claim_invitations");
  } catch {
    // Roles can be claimed on the next sign-in.
  }
}
