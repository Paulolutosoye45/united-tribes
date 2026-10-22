import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseUnlockViews, parseWelcomeSettings, type UnlockView, type WelcomeSettings } from "@/lib/god/goal-unlock";
import { WELCOME_WORDING_VERSION } from "@/lib/messaging/templates-leader-welcome";

/**
 * What the owner's screens need to show "Let them choose". Each reads the database as the signed-in owner, and each returns null when it
 * cannot (the function is not there yet, or the caller is not the owner), so the page it sits on still works without it.
 */

export type ChooseData = {
  views: Record<string, UnlockView>;
  /** The wording this code sends is approved, with the name and title as they are now. */
  approved: boolean;
};

const MAX_ASK = 600;

export async function loadWelcomeSettings(supabase: SupabaseClient): Promise<WelcomeSettings | null> {
  const { data, error } = await supabase.rpc("god_welcome_settings_get", { p_version: WELCOME_WORDING_VERSION });
  return error ? null : parseWelcomeSettings(data);
}

export async function loadChooseData(supabase: SupabaseClient, tribes: string[]): Promise<ChooseData | null> {
  const ids = [...new Set(tribes)].slice(0, MAX_ASK);
  const [views, settings] = await Promise.all([
    ids.length > 0 ? supabase.rpc("god_goal_unlock_view", { p_tribes: ids }) : Promise.resolve({ data: [], error: null }),
    loadWelcomeSettings(supabase),
  ]);
  if (views.error) return null;
  return { views: parseUnlockViews(views.data), approved: settings?.approved === true };
}
