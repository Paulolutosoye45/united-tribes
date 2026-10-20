import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseAnnouncements, parseChatOpens, parseDesks, parseMessages, parseRolePeople } from "./oversight";
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

// Oversight: the desks, the people who hold each role, the messages, the chats staff opened and the announcements.
export const loadDesks = async (s: SupabaseClient) => parseDesks(await load<unknown>(s, "god_desks"));
export const loadRolePeople = async (s: SupabaseClient, role: string) => parseRolePeople(await load<unknown>(s, "god_role_people", { p_role: role, p_limit: 200 }));
export const loadMessages = async (s: SupabaseClient, opts: { person?: string | null; status?: string | null; before?: string | null; limit?: number } = {}) =>
  parseMessages(await load<unknown>(s, "god_messages", { p_person: opts.person ?? null, p_status: opts.status ?? null, p_before: opts.before ?? null, p_limit: opts.limit ?? 40 }));
export const loadChatOpens = async (s: SupabaseClient, person: string | null = null) => parseChatOpens(await load<unknown>(s, "god_chat_opens", { p_person: person, p_limit: 100 }));
export const loadAnnouncements = async (s: SupabaseClient) => parseAnnouncements(await load<unknown>(s, "god_announcements", { p_limit: 40 }));
/** A note in the owner’s own record that these screens were opened. Never blocks the page. */
export async function markLooked(s: SupabaseClient, what: "desks" | "desk" | "conversations" | "person_conversation" | "chat_opens", ref: string | null = null) {
  await s.rpc("god_looked", { p_what: what, p_ref: ref });
}
