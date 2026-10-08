import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchStats, MyMatch, Roster } from "./types";

/** Runs the engine if the member has no recent run, then reads the result. Everything stays in the database. */
export async function loadMatches(supabase: SupabaseClient): Promise<MyMatch | null> {
  const { data, error } = await supabase.rpc("match_me", { p_refresh: false });
  if (error) {
    // Not finished the form yet: read what there is (it says profile: false).
    const read = await supabase.rpc("my_match");
    return (read.data as MyMatch | null) ?? null;
  }
  return data as MyMatch;
}

/** Read only. Home uses it, and runs the engine itself only the first time a finished profile has no result yet. */
export async function readMatch(supabase: SupabaseClient): Promise<MyMatch | null> {
  const { data } = await supabase.rpc("my_match");
  return (data as MyMatch | null) ?? null;
}

export async function loadRoster(supabase: SupabaseClient, circleId: string): Promise<Roster | null> {
  const { data } = await supabase.rpc("circle_roster", { p_circle: circleId });
  return (data as Roster | null) ?? null;
}

export async function loadMatchStats(supabase: SupabaseClient): Promise<MatchStats | null> {
  const { data } = await supabase.rpc("match_stats");
  return (data as MatchStats | null) ?? null;
}
