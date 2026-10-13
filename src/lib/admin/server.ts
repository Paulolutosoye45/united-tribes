import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminCatalogue,
  AdminSeasons,
  BiStatus,
  Champion,
  Checklist,
  ChurchSettings,
  Guide,
  GuideList,
  Layers,
  MessageRow,
  MessageStats,
  MyCentres,
  PlatformStatus,
  TargetRow,
  TokenRow,
  WriteIn,
} from "./types";

// Each loader returns null when the database refuses (the person's role does not allow it) or is unreachable.
// The page decides what to show; the database has already decided what the person may see.

async function load<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return null;
  return (data as T | null) ?? null;
}

export const loadSeasons = (s: SupabaseClient) => load<AdminSeasons>(s, "admin_seasons");
export const loadAdminCatalogue = (s: SupabaseClient) => load<AdminCatalogue>(s, "admin_catalogue");
export const loadWriteIns = (s: SupabaseClient, min = 2) => load<WriteIn[]>(s, "goal_write_ins", { p_min: min });
export const loadGuides = (s: SupabaseClient) => load<GuideList>(s, "admin_guides");
export const loadGuide = (s: SupabaseClient, week: number) => load<Guide>(s, "admin_guide", { p_week: week });
export const loadLayers = (s: SupabaseClient) => load<Layers>(s, "admin_layers");
export const loadChurchSettings = (s: SupabaseClient) => load<ChurchSettings>(s, "church_settings");
export const loadPlatformStatus = (s: SupabaseClient) => load<PlatformStatus>(s, "platform_status");
export const loadChecklist = (s: SupabaseClient) => load<Checklist>(s, "launch_checklist");
export const loadTargets = (s: SupabaseClient) => load<TargetRow[]>(s, "kpi_target_list");
export const loadChampions = (s: SupabaseClient) => load<Champion[]>(s, "community_champion_list");
export const loadBiStatus = (s: SupabaseClient) => load<BiStatus>(s, "bi_status");
export const loadMessageStats = (s: SupabaseClient, days = 7) => load<MessageStats>(s, "message_stats", { p_days: days });
export const loadMessageLog = (s: SupabaseClient, status: string | null, template: string | null, limit = 100) =>
  load<MessageRow[]>(s, "message_log", { p_status: status, p_template: template, p_limit: limit });
export const loadWorkerTokens = (s: SupabaseClient) => load<TokenRow[]>(s, "list_worker_tokens");
export const loadMyCentres = (s: SupabaseClient) => load<MyCentres>(s, "my_centres");
