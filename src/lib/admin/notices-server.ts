import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseAttention, type Attention } from "./today";
import { parseLog, parseOverview, parsePrefs, type LogRow, type NoticeOverview, type NoticePref } from "./notices";

// Each loader returns null (or nothing) when the database refuses, which it does for a person whose role does not allow it, or is unreachable.
// The page decides what to show; the database has already decided what the person may see.

/** What is waiting for the person signed in, from all their roles. Read once per request, however many parts of the page ask. */
export const loadAttention = cache(async (): Promise<Attention | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_attention");
  return error ? null : parseAttention(data);
});

export async function loadNoticeOverview(): Promise<NoticeOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notice_overview");
  return error ? null : parseOverview(data);
}

export async function loadNoticeLog(limit = 50): Promise<LogRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notice_log", { p_limit: limit });
  return error ? [] : parseLog(data);
}

export async function loadMyNoticePrefs(): Promise<NoticePref[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_notice_prefs");
  return error ? [] : parsePrefs(data);
}
