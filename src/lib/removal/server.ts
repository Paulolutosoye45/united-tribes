import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BOARD_OFF, MINE_OFF, parseBoard, parseMine, parseMyRemoval, type Board, type Mine, type MyRemoval } from "./removal";

// Each loader returns "Off" (or nothing) when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the
// database file is applied behaves exactly as it always did.

/** A leader's own requests about one of their tribes. Nothing for anyone else, and nothing while the switch is Off. */
export async function loadRemovalMine(supabase: SupabaseClient, tribe: string): Promise<Mine> {
  try {
    const { data, error } = await supabase.rpc("removal_mine", { p_tribe: tribe });
    return error ? MINE_OFF : parseMine(data);
  } catch {
    return MINE_OFF;
  }
}

/** The requests the signed-in person may read: a coach their own tribes' ordinary ones, the Care Team, directors, admins and pastors all. */
export async function loadRemovalBoard(supabase: SupabaseClient): Promise<Board> {
  try {
    const { data, error } = await supabase.rpc("removal_board");
    return error ? BOARD_OFF : parseBoard(data);
  } catch {
    return BOARD_OFF;
  }
}

/** The signed-in member's own notice that a place has changed, for 30 days. Nothing for a young person, a rehearsal or a declined request. */
export async function loadMyRemoval(supabase: SupabaseClient): Promise<MyRemoval | null> {
  try {
    const { data, error } = await supabase.rpc("my_removal");
    return error ? null : parseMyRemoval(data);
  } catch {
    return null;
  }
}
