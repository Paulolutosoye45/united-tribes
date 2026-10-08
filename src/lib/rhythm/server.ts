import type { SupabaseClient } from "@supabase/supabase-js";
import type { CareItem, CircleWeek, Digest, MyWeek, PendingTestimony, RhythmTestimony } from "./types";

export async function loadMyWeek(supabase: SupabaseClient, view?: number | null): Promise<MyWeek> {
  const { data } = await supabase.rpc("my_week", { p_view: view ?? null });
  return (data as MyWeek | null) ?? { placed: false };
}

export async function loadCircleWeek(supabase: SupabaseClient, circleId: string, week?: number | null): Promise<CircleWeek | null> {
  const { data } = await supabase.rpc("circle_week", { p_circle: circleId, p_week: week ?? null });
  return (data as CircleWeek | null) ?? null;
}

export async function loadTestimonies(supabase: SupabaseClient): Promise<RhythmTestimony[]> {
  const { data } = await supabase.rpc("circle_testimonies");
  return (data as RhythmTestimony[] | null) ?? [];
}

export async function loadPendingTestimonies(supabase: SupabaseClient): Promise<{ circle: PendingTestimony[]; church: PendingTestimony[] }> {
  const { data } = await supabase.rpc("pending_testimonies");
  return (data as { circle: PendingTestimony[]; church: PendingTestimony[] } | null) ?? { circle: [], church: [] };
}

export async function loadDigest(supabase: SupabaseClient, week?: number | null): Promise<Digest | null> {
  const { data } = await supabase.rpc("rhythm_digest", { p_week: week ?? null });
  return (data as Digest | null) ?? null;
}

export async function loadCareQueue(supabase: SupabaseClient): Promise<{ items: CareItem[]; open_total: number } | null> {
  const { data } = await supabase.rpc("care_queue");
  return (data as { items: CareItem[]; open_total: number } | null) ?? null;
}
