import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareItem, CareStats, CareTaskOption, TribeWeek, Digest, LogExtras, MyCareTasks, MyWeek, PendingTestimony, RhythmTestimony, TestimonyTheme, TestimonyWall, WeekLayer } from "./types";

export async function loadMyWeek(supabase: SupabaseClient, view?: number | null): Promise<MyWeek> {
  const { data } = await supabase.rpc("my_week", { p_view: view ?? null });
  return (data as MyWeek | null) ?? { placed: false };
}

export async function loadTribeWeek(supabase: SupabaseClient, tribeId: string, week?: number | null): Promise<TribeWeek | null> {
  const { data } = await supabase.rpc("tribe_week_marked", { p_tribe: tribeId, p_week: week ?? null });
  return (data as TribeWeek | null) ?? null;
}

export async function loadTestimonies(supabase: SupabaseClient): Promise<RhythmTestimony[]> {
  const { data } = await supabase.rpc("tribe_testimonies");
  return (data as RhythmTestimony[] | null) ?? [];
}

export async function loadPendingTestimonies(supabase: SupabaseClient): Promise<{ tribe: PendingTestimony[]; church: PendingTestimony[] }> {
  const { data } = await supabase.rpc("pending_testimonies");
  return (data as { tribe: PendingTestimony[]; church: PendingTestimony[] } | null) ?? { tribe: [], church: [] };
}

export async function loadDigest(supabase: SupabaseClient, week?: number | null): Promise<Digest | null> {
  const { data } = await supabase.rpc("rhythm_digest", { p_week: week ?? null });
  return (data as Digest | null) ?? null;
}

export async function loadCareQueue(supabase: SupabaseClient): Promise<{ items: CareItem[]; open_total: number } | null> {
  const { data } = await supabase.rpc("care_queue");
  return (data as { items: CareItem[]; open_total: number } | null) ?? null;
}

export async function loadWeekLayer(supabase: SupabaseClient, tribeId: string, week?: number | null): Promise<WeekLayer | null> {
  const { data } = await supabase.rpc("week_layer", { p_tribe: tribeId, p_week: week ?? null });
  return (data as WeekLayer | null) ?? null;
}

export async function loadLogExtras(supabase: SupabaseClient, tribeId: string, week?: number | null): Promise<LogExtras | null> {
  const { data } = await supabase.rpc("tribe_log_extras", { p_tribe: tribeId, p_week: week ?? null });
  return (data as LogExtras | null) ?? null;
}

export async function loadMyCareTasks(supabase: SupabaseClient): Promise<MyCareTasks> {
  const { data } = await supabase.rpc("my_care_tasks");
  return (data as MyCareTasks | null) ?? { today: "", mine: [], queue: [], others: [], raised: [] };
}

export async function loadCareTaskOptions(supabase: SupabaseClient, id: string): Promise<CareTaskOption[]> {
  const { data } = await supabase.rpc("care_task_options", { p_id: id });
  return (data as CareTaskOption[] | null) ?? [];
}

export async function loadTestimonyWall(
  supabase: SupabaseClient,
  filter: { community?: string | null; goal?: string | null; theme?: TestimonyTheme | null; limit?: number; offset?: number } = {},
): Promise<TestimonyWall> {
  const { data } = await supabase.rpc("testimony_wall", {
    p_community: filter.community ?? null,
    p_goal: filter.goal ?? null,
    p_theme: filter.theme ?? null,
    p_limit: filter.limit ?? 20,
    p_offset: filter.offset ?? 0,
  });
  return (data as TestimonyWall | null) ?? { items: [], total: 0, has_more: false, facets: { communities: [], themes: [] } };
}

export async function loadCareStats(supabase: SupabaseClient, days = 90): Promise<CareStats | null> {
  const { data } = await supabase.rpc("care_task_stats", { p_days: days });
  return (data as CareStats | null) ?? null;
}
