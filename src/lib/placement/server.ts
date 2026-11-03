import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHolds, parseItems, parseLeadersView, parseOneOptions, parseOverview, parsePlaced, parseRunView, type Hold, type LeadersView, type OneOption, type Overview, type PlacedState, type RunView } from "./types";

// Each loader returns null when the database refuses (the person is not the owner, or is locked) or is unreachable. The pages treat
// null as "not available": the database has already decided.

async function load(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  return error ? null : data;
}

export const loadPlacementOverview = async (s: SupabaseClient): Promise<Overview | null> => parseOverview(await load(s, "placement_overview"));
export const loadRunView = async (s: SupabaseClient, run: string): Promise<RunView | null> => parseRunView(await load(s, "placement_run_view", { p_run: run }));
export const loadRunItems = async (s: SupabaseClient, run: string, status: string | null, limit = 50, offset = 0) =>
  parseItems(await load(s, "placement_run_items", { p_run: run, p_status: status, p_limit: limit, p_offset: offset }));
export const loadHolds = async (s: SupabaseClient): Promise<Hold[]> => parseHolds(await load(s, "placement_holds_list"));
export const loadLeadersView = async (s: SupabaseClient, run: string | null = null): Promise<LeadersView | null> =>
  parseLeadersView(await load(s, "placement_leaders_view", { p_run: run }));

/** The signed-in member's own placement, when the church placed them. Null for everyone else. */
export const loadMyPlacement = async (s: SupabaseClient): Promise<PlacedState | null> => parsePlaced(await load(s, "my_placement"));

/** The tribes one person could be placed into, best fit first. Empty when the database refuses or has none. */
export const loadOneOptions = async (s: SupabaseClient, person: string): Promise<OneOption[]> => parseOneOptions(await load(s, "placement_one_options", { p_person: person }));
