import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseHolds, parseItems, parseLeadersView, parseOfficeCounts, parseOfficePerson, parseOfficeTribe, parseOfficeTribes, parseOneOptions, parseOverview, parsePlaced, parseRequests, parseRunView,
  type Hold, type LeadersView, type OfficeCounts, type OfficePerson, type OfficeRequest, type OfficeTribe, type OneOption, type Overview, type PlacedState, type RunView,
} from "./types";

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

/** One person for the Admin person page: where they sit, whether they can be placed, and their last placement. Null when the database refuses. */
export const loadOfficePerson = async (s: SupabaseClient, person: string): Promise<OfficePerson | null> => parseOfficePerson(await load(s, "placement_office_person", { p_person: person }));
export const loadOfficeTribes = async (s: SupabaseClient) => parseOfficeTribes(await load(s, "placement_office_tribes"));
export const loadOfficeTribe = async (s: SupabaseClient, tribe: string): Promise<OfficeTribe | null> => parseOfficeTribe(await load(s, "placement_office_tribe", { p_tribe: tribe }));
/** The requests to the owner: all of them for the owner, one's own for an admin or a director. */
export const loadRequests = async (s: SupabaseClient, person: string | null = null): Promise<OfficeRequest[]> => parseRequests(await load(s, "placement_requests_list", { p_person: person }));
export const loadOfficeCounts = async (s: SupabaseClient): Promise<OfficeCounts | null> => parseOfficeCounts(await load(s, "placement_office_counts"));
