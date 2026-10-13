import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leaderNoteContext, open } from "@/lib/crypto/seal";
import type { MatchStats, MyMatch, RawRosterMember, Roster } from "./types";

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

/**
 * The people in a tribe. A member's private note to their leader comes back from the database sealed;
 * it is opened here, on the server, and only the opened text goes on to the page. The ciphertext never does.
 */
export async function loadRoster(supabase: SupabaseClient, tribeId: string): Promise<Roster | null> {
  const { data } = await supabase.rpc("tribe_roster", { p_tribe: tribeId });
  if (!data) return null;
  const raw = data as { tribe: Roster["tribe"]; members: RawRosterMember[] };
  return {
    tribe: raw.tribe,
    members: raw.members.map(({ note_enc, ...member }) => {
      const note = open(note_enc, leaderNoteContext(member.person_id));
      return { ...member, roles: member.roles ?? [], note, note_locked: Boolean(note_enc) && note === null };
    }),
  };
}

export async function loadMatchStats(supabase: SupabaseClient): Promise<MatchStats | null> {
  const { data } = await supabase.rpc("match_stats");
  return (data as MatchStats | null) ?? null;
}
