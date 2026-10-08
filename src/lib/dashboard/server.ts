import type { SupabaseClient } from "@supabase/supabase-js";
import type { CircleProgress, Dashboard, MyProgress } from "./types";

export async function loadDashboard(supabase: SupabaseClient, season?: string | null): Promise<Dashboard | null> {
  const { data } = await supabase.rpc("dashboard", { p_season: season ?? null });
  return (data as Dashboard | null) ?? null;
}

export async function loadCircleProgress(supabase: SupabaseClient, circleId: string): Promise<CircleProgress | null> {
  const { data } = await supabase.rpc("circle_progress", { p_circle: circleId });
  return (data as CircleProgress | null) ?? null;
}

export async function loadMyProgress(supabase: SupabaseClient): Promise<MyProgress> {
  const { data } = await supabase.rpc("my_progress");
  return (data as MyProgress | null) ?? { placed: false };
}
