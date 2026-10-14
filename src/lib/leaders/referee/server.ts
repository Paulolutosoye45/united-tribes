import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { readBatches, readCallbacks, readDirectoryPage, readOverview, readReviewReferees, readUnverified } from "./read";
import type { Batch, CallbackRow, DirectoryPage, Overview, ReviewReferee, UnverifiedRow } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const DIRECTORY_PAGE_SIZE = 25;
export const DIRECTORY_STATES = ["active", "retired", "all"] as const;
export type DirectoryState = (typeof DIRECTORY_STATES)[number];
export const isDirectoryState = (v: unknown): v is DirectoryState => typeof v === "string" && (DIRECTORY_STATES as readonly string[]).includes(v);

export type DirectoryQuery = { search: string; standing: string | null; state: DirectoryState; page: number };

/** Where the church's list stands and what is waiting on a person. Counts only. */
export async function loadRefereeOverview(supabase: Supabase): Promise<Overview | null> {
  const { data, error } = await supabase.rpc("referee_overview");
  return error ? null : readOverview(data);
}

export async function loadDirectory(supabase: Supabase, q: DirectoryQuery): Promise<DirectoryPage | null> {
  const { data, error } = await supabase.rpc("referee_directory_list", {
    p_search: q.search || null,
    p_standing: q.standing,
    p_state: q.state,
    p_limit: DIRECTORY_PAGE_SIZE,
    p_offset: (q.page - 1) * DIRECTORY_PAGE_SIZE,
  });
  return error ? null : readDirectoryPage(data);
}

export async function loadImportHistory(supabase: Supabase): Promise<Batch[]> {
  const { data, error } = await supabase.rpc("referee_import_history", { p_limit: 8 });
  return error ? [] : readBatches(data);
}

export async function loadUnverified(supabase: Supabase, page = 1): Promise<{ total: number; rows: UnverifiedRow[] }> {
  const { data, error } = await supabase.rpc("referee_unverified_list", { p_limit: 25, p_offset: (page - 1) * 25 });
  return error ? { total: 0, rows: [] } : readUnverified(data);
}

export async function loadCallbacks(supabase: Supabase): Promise<CallbackRow[] | null> {
  const { data, error } = await supabase.rpc("referee_callbacks_open");
  return error ? null : readCallbacks(data);
}

/** The referees of one application as a reviewer sees them. Null when the screen is not for this person or the data is not there yet. */
export async function loadReviewReferees(supabase: Supabase, applicationId: string): Promise<ReviewReferee[] | null> {
  const { data, error } = await supabase.rpc("referee_review", { p_app: applicationId });
  if (error) return null;
  const d = data as { referees?: unknown } | null;
  return readReviewReferees(d && typeof d === "object" && "referees" in d ? d.referees : data);
}
