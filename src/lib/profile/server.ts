import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCheckStatus, parseChecks, parseLink, parseOfficeAsks, parsePage, parseReviews, parseStageStatus, parseStillRight } from "./parse";
import type { CheckStatus, CheckSummary, LinkState, OfficeAsk, PageState, StageReviews, StageStatus, StillRight } from "./types";

// Each loader returns "nothing" when the database refuses, does not have the function yet, or cannot be reached. A page treats that as
// "not available": the database has already decided who may see what, and a website deployed before the database file is applied behaves
// as it always did.

async function load(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return error ? null : data;
  } catch {
    return null;
  }
}

/** My page for the signed-in person. `enabled: false` when the function is Off for them, and for anything unreadable. */
export const loadMyPage = async (s: SupabaseClient): Promise<PageState> => parsePage(await load(s, "my_page_state"));

/** The once-a-season "Still right?" strip for Home. Not due, for anyone it is Off for and for anything unreadable. */
export const loadStillRight = async (s: SupabaseClient): Promise<StillRight> => parseStillRight(await load(s, "still_right_state"));

/** Whether My page is open for the signed-in person (the account menu uses only this). False when Off, when under 18, and when the database does not have it yet. */
export async function loadMyPageOpen(s: SupabaseClient): Promise<boolean> {
  return (await load(s, "my_page_open")) === true;
}

/** The Care Team's list of people who said their age range is not right. Null for anyone who is not on the Care Team, and when the database does not have it yet. */
export const loadOfficeAsks = async (s: SupabaseClient): Promise<OfficeAsk[] | null> => parseOfficeAsks(await load(s, "profile_office_asks_list"));

/** The pastor's list of changes waiting for a decision, and those decided in the last 30 days. */
export const loadStageReviews = async (s: SupabaseClient): Promise<StageReviews | null> => parseReviews(await load(s, "stage_reviews_list"));

/** Beside a Tribe Card: null unless the Details Check is open for that leader. */
export const loadStageStatus = async (s: SupabaseClient, tribe: string): Promise<StageStatus | null> => parseStageStatus(await load(s, "tribe_stage_status", { p_tribe: tribe }));

// The console. These begin god_only() in the database, so for anyone but the unlocked owner they are null.
export const loadDetailsChecks = async (s: SupabaseClient): Promise<CheckSummary[]> => parseChecks(await load(s, "god_details_checks"));
export const loadDetailsStatus = async (s: SupabaseClient, check: string): Promise<CheckStatus | null> => parseCheckStatus(await load(s, "god_details_status", { p_check: check }));

/** What a signed-in person is shown at a private link: one tap. For anyone not signed in, or someone else's link, nothing is said about whose it is. */
export const loadLinkSignedIn = async (s: SupabaseClient, link: string): Promise<LinkState> => parseLink(await load(s, "details_check_info", { p_link: link }));
