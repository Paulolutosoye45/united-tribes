import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseClusters,
  parseGroups,
  parseLeaders,
  parseOverview,
  parseWaiting,
  type Chip,
  type Cluster,
  type Group,
  type LeadersPage,
  type Overview,
  type Pool,
  type WaitingPage,
} from "./desk";

// Each loader answers nothing when the database refuses (the desk is switched off, or the person is not the unlocked owner), does not have the function yet, or cannot
// be reached: a website deployed before the database file is applied behaves exactly as it always did.

/** The numbers at the top of the desk. Null when the desk is closed to this person or switched off. */
export async function loadDeskOverview(supabase: SupabaseClient): Promise<Overview | null> {
  try {
    const { data, error } = await supabase.rpc("desk_overview");
    return error ? null : parseOverview(data);
  } catch {
    return null;
  }
}

/** One page of the members still waiting for a tribe. Never a full phone number. */
export async function loadDeskWaiting(supabase: SupabaseClient, chip: Chip | null, limit: number, offset: number): Promise<WaitingPage> {
  try {
    const { data, error } = await supabase.rpc("desk_waiting", { p_chip: chip, p_limit: limit, p_offset: offset });
    return error ? { total: 0, rows: [] } : parseWaiting(data);
  } catch {
    return { total: 0, rows: [] };
  }
}

/** One page of members by leadership signal, for one pool. */
export async function loadDeskLeaders(supabase: SupabaseClient, pool: Pool, limit: number, offset: number): Promise<LeadersPage> {
  try {
    const { data, error } = await supabase.rpc("desk_leaders", { p_pool: pool, p_limit: limit, p_offset: offset });
    return error ? { total: 0, rows: [] } : parseLeaders(data);
  } catch {
    return { total: 0, rows: [] };
  }
}

/** The draft groups, each with its members, scores and checks. */
export async function loadDeskGroups(supabase: SupabaseClient): Promise<Group[]> {
  try {
    const { data, error } = await supabase.rpc("desk_groups_list");
    return error ? [] : parseGroups(data);
  } catch {
    return [];
  }
}

/** The groups the waiting members could already fill. */
export async function loadDeskClusters(supabase: SupabaseClient): Promise<Cluster[]> {
  try {
    const { data, error } = await supabase.rpc("desk_clusters");
    return error ? [] : parseClusters(data);
  } catch {
    return [];
  }
}

export type DeskChoices = {
  tracks: { id: string; name: string }[];
  communities: { id: string; name: string }[];
  goals: { id: string; title: string; communityId: string }[];
};

/** The short lists a draft group is made from. */
export async function loadDeskChoices(supabase: SupabaseClient): Promise<DeskChoices> {
  try {
    const [tracks, communities, goals] = await Promise.all([
      supabase.from("tracks").select("id, name").eq("active", true).order("sort"),
      supabase.from("communities").select("id, name").eq("active", true).order("sort"),
      supabase.from("season_goals").select("id, title, community_id").eq("active", true).order("sort"),
    ]);
    const rows = <T,>(r: { data: unknown }): T[] => (Array.isArray(r.data) ? (r.data as T[]) : []);
    return {
      tracks: rows<{ id: string; name: string }>(tracks).map((t) => ({ id: String(t.id), name: String(t.name) })),
      communities: rows<{ id: string; name: string }>(communities).map((c) => ({ id: String(c.id), name: String(c.name) })),
      goals: rows<{ id: string; title: string; community_id: string }>(goals).map((g) => ({ id: String(g.id), title: String(g.title), communityId: String(g.community_id) })),
    };
  } catch {
    return { tracks: [], communities: [], goals: [] };
  }
}
