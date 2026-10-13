import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, ReportDetail, ReportListItem, CommunityPage, WordDays } from "./insight";
import type { TribeProgress, Dashboard, MyProgress } from "./types";

export async function loadDashboard(supabase: SupabaseClient, season?: string | null): Promise<Dashboard | null> {
  const { data } = await supabase.rpc("dashboard", { p_season: season ?? null });
  return (data as Dashboard | null) ?? null;
}

export async function loadTribeProgress(supabase: SupabaseClient, tribeId: string): Promise<TribeProgress | null> {
  const { data } = await supabase.rpc("tribe_progress", { p_tribe: tribeId });
  return (data as TribeProgress | null) ?? null;
}

export async function loadMyProgress(supabase: SupabaseClient): Promise<MyProgress> {
  const { data } = await supabase.rpc("my_progress");
  return (data as MyProgress | null) ?? { placed: false };
}

export async function loadInsight(supabase: SupabaseClient, season?: string | null): Promise<Insight | null> {
  const { data } = await supabase.rpc("insight", { p_season: season ?? null });
  return (data as Insight | null) ?? null;
}

export async function loadCommunityPage(supabase: SupabaseClient, community?: string | null, season?: string | null): Promise<CommunityPage | null> {
  const { data } = await supabase.rpc("community_dashboard", { p_community: community ?? null, p_season: season ?? null });
  return (data as CommunityPage | null) ?? null;
}

export async function loadReports(supabase: SupabaseClient): Promise<ReportListItem[]> {
  const { data } = await supabase.rpc("list_reports", { p_limit: 60 });
  return (data as ReportListItem[] | null) ?? [];
}

export async function loadReport(supabase: SupabaseClient, id: string): Promise<ReportDetail | null> {
  const { data } = await supabase.rpc("get_report", { p_report: id });
  return (data as ReportDetail | null) ?? null;
}

export async function loadWordDays(supabase: SupabaseClient): Promise<WordDays> {
  const { data } = await supabase.rpc("my_word_days");
  return (data as WordDays | null) ?? { placed: false, weeks: [] };
}
