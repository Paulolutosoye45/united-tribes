import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GuardianOverview,
  GuardianRequest,
  ModelRow,
  MultiplicationBoard,
  MyGuardian,
  MySwap,
  RetrainPreview,
  SwapQueue,
} from "./types";

/** Every matching model, newest first. The office reads them; only the admin and directors change them. */
export async function loadModels(supabase: SupabaseClient): Promise<ModelRow[]> {
  const { data } = await supabase.rpc("list_models");
  return (data as ModelRow[] | null) ?? [];
}

/** What the matching would learn from the results so far. Not for pastors (the database refuses), so null for them. */
export async function loadRetrainPreview(supabase: SupabaseClient): Promise<RetrainPreview | null> {
  const { data, error } = await supabase.rpc("retrain_preview");
  if (error) return null;
  return (data as RetrainPreview | null) ?? null;
}

export async function loadSwapQueue(supabase: SupabaseClient): Promise<SwapQueue | null> {
  const { data } = await supabase.rpc("swap_queue");
  return (data as SwapQueue | null) ?? null;
}

export async function loadMySwap(supabase: SupabaseClient): Promise<MySwap> {
  const { data } = await supabase.rpc("my_swap");
  return (data as MySwap | null) ?? { in_tribe: false };
}

export async function loadMultiplicationBoard(supabase: SupabaseClient, season?: string | null): Promise<MultiplicationBoard | null> {
  const { data } = await supabase.rpc("multiplication_board", { p_season: season ?? null });
  return (data as MultiplicationBoard | null) ?? null;
}

export async function loadGuardianOverview(supabase: SupabaseClient): Promise<GuardianOverview | null> {
  const { data } = await supabase.rpc("guardian_overview");
  return (data as GuardianOverview | null) ?? null;
}

/** Where a young person's parent or guardian permission stands. Everyone else gets `not_needed`. */
export async function loadMyGuardian(supabase: SupabaseClient): Promise<MyGuardian> {
  const { data } = await supabase.rpc("my_guardian");
  return (data as MyGuardian | null) ?? { needed: false, state: "not_needed", track_open: false };
}

/** What the parent or guardian is shown. Null for a link that does not exist. */
export async function loadGuardianRequest(supabase: SupabaseClient, token: string): Promise<GuardianRequest | null> {
  const { data } = await supabase.rpc("get_guardian_request", { p_token: token });
  return (data as GuardianRequest | null) ?? null;
}

/** Members a coach or the office can start a tribe change for. The office must give at least two letters of a name. */
export async function loadSwapMembers(supabase: SupabaseClient, search?: string | null): Promise<{ person_id: string; name: string; tribe: string }[]> {
  const { data } = await supabase.rpc("swap_members", { p_search: search ?? null });
  return (data as { person_id: string; name: string; tribe: string }[] | null) ?? [];
}
