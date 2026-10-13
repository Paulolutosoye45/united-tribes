import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { FeedEvent, GodTribe, GodTribeRow, GodLogEntry, GodOverview, GodPeople, GodPerson } from "./types";

// Each loader returns null when the database refuses (the person is not the owner, or is locked) or is unreachable.
// The pages treat null as "not available": the database has already decided.

async function load<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return null;
  return (data as T | null) ?? null;
}

export const loadOverview = (s: SupabaseClient) => load<GodOverview>(s, "god_overview");
/** The overview, read once per request (the layout and the page both need it). */
export const getOverview = cache(async () => loadOverview(await createClient()));
export const loadFeed = (s: SupabaseClient, opts: { limit?: number; before?: number | null; search?: string | null } = {}) =>
  load<FeedEvent[]>(s, "god_feed", { p_limit: opts.limit ?? 60, p_before: opts.before ?? null, p_search: opts.search ?? null });
export const loadPeople = (s: SupabaseClient, query: string | null, limit = 60) => load<GodPeople>(s, "god_people", { p_query: query, p_limit: limit });
export const loadPerson = (s: SupabaseClient, id: string) => load<GodPerson>(s, "god_person", { p_person: id });
export const loadTribes = (s: SupabaseClient, status: string | null = null) => load<GodTribeRow[]>(s, "god_tribes", { p_status: status });
export const loadTribe = (s: SupabaseClient, id: string) => load<GodTribe>(s, "god_tribe", { p_tribe: id });
export const loadRecord = (s: SupabaseClient, before: number | null = null, limit = 80) => load<GodLogEntry[]>(s, "god_log_list", { p_limit: limit, p_before: before });
