import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLeaderStrip, parseSeatBoard, parseSeatHistory, parseSeatSettings, type LeaderStrip, type SeatBoard, type SeatEvent, type SeatFilter, type SeatSettings } from "./seat";

// Each loader answers nothing when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the database file is applied
// behaves exactly as it always did.

/** The Seats page: the health strip, the tiles and one page of rows. Null for anyone who may not read it, and when the database does not have Package 6 yet. */
export async function loadSeatBoard(supabase: SupabaseClient, filter: SeatFilter | null, limit: number, offset: number): Promise<SeatBoard | null> {
  try {
    const { data, error } = await supabase.rpc("seat_board", { p_filter: filter, p_limit: limit, p_offset: offset });
    return error ? null : parseSeatBoard(data);
  } catch {
    return null;
  }
}

/** What happened to one clock, newest first. Nothing a person typed, and no number. */
export async function loadSeatHistory(supabase: SupabaseClient, clock: string): Promise<SeatEvent[]> {
  try {
    const { data, error } = await supabase.rpc("seat_clock_history", { p_clock: clock });
    return error ? [] : parseSeatHistory(data);
  } catch {
    return [];
  }
}

/** The owner's numbers for the seat window. Null for anyone but the owner. */
export async function loadSeatSettings(supabase: SupabaseClient): Promise<SeatSettings | null> {
  try {
    const { data, error } = await supabase.rpc("god_seat_settings");
    return error ? null : parseSeatSettings(data);
  } catch {
    return null;
  }
}

/** The strip on a leader's page: first names and where each seat stands. Null for anyone who may not see it. */
export async function loadLeaderStrip(supabase: SupabaseClient, tribe: string): Promise<LeaderStrip | null> {
  try {
    const { data, error } = await supabase.rpc("seat_leader_strip", { p_tribe: tribe });
    return error ? null : parseLeaderStrip(data);
  } catch {
    return null;
  }
}
