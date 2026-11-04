import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReachSettings, type ReachSettings } from "@/lib/reach/series";
import { parseBoard, parseLog, parseOverview, parseStates } from "./parse";
import type { FeatureBoard, FeatureKey, FeatureLogLine, FeatureState, FeatureStates, FeaturesOverview } from "./types";

// Each loader returns "nothing" (Off, null or an empty list) when the database refuses, does not have the function yet, or cannot be
// reached. That is the rule the whole switchboard keeps: if the settings cannot be read, every new function is Off and the platform
// behaves as it did before. The website therefore tolerates a database that has not had the Stage 1 file applied.

async function load(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return error ? null : data;
  } catch {
    return null;
  }
}

/** What every function of this release is for the signed-in person. Empty (all Off) for anyone signed out and when anything goes wrong. */
export const loadFeatureStates = async (s: SupabaseClient): Promise<FeatureStates> => parseStates(await load(s, "my_features"));

/** One function for the signed-in person. */
export async function featureState(s: SupabaseClient, key: FeatureKey): Promise<FeatureState> {
  return (await loadFeatureStates(s))[key] ?? "off";
}

// The owner's page. These begin god_only() in the database, so for anyone but the unlocked owner they are null.
export const loadFeatureBoard = async (s: SupabaseClient): Promise<FeatureBoard | null> => parseBoard(await load(s, "god_feature_board"));
export const loadFeatureLog = async (s: SupabaseClient, limit = 60): Promise<FeatureLogLine[]> => parseLog(await load(s, "god_feature_log", { p_limit: limit }));

/** For the pastor, directors and the admin: what is on, and what has changed, with the owner shown as "an administrator". */
export const loadFeaturesOverview = async (s: SupabaseClient): Promise<FeaturesOverview | null> => parseOverview(await load(s, "features_overview"));

/** The contact series settings. Null for anyone but the unlocked owner, and when the database does not have the series yet. */
export const loadReachSettings = async (s: SupabaseClient): Promise<ReachSettings | null> => parseReachSettings(await load(s, "god_reach_settings"));
