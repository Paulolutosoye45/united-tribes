import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The season a person joining now is matched for. The database owns the rule (placement_season): a season still to start, or one that has
 * started and is inside its joining window. On a database that does not have the rule yet, the older reading is used, so nothing changes
 * for a church that has not applied the update.
 */
export type JoinSeason = { id: string; name: string; startsOn: string; started: boolean; week: number | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadJoinSeason(supabase: SupabaseClient): Promise<JoinSeason | null> {
  const w = await supabase.rpc("season_joining_window");
  if (!w.error) {
    const d = w.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object" || typeof d.season !== "string" || !UUID.test(d.season) || typeof d.starts_on !== "string") return null;
    return {
      id: d.season,
      name: typeof d.name === "string" ? d.name : "",
      startsOn: d.starts_on,
      started: d.started === true,
      week: typeof d.week === "number" ? d.week : null,
    };
  }
  const old = await supabase.from("seasons").select("id, name, starts_on").in("status", ["planning", "open"]).order("starts_on", { ascending: true }).limit(1).maybeSingle();
  const r = old.data as { id: string; name: string; starts_on: string } | null;
  return r ? { id: r.id, name: r.name, startsOn: r.starts_on, started: false, week: null } : null;
}
