import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeriesState } from "@/lib/reach/series";
import {
  GAP_REPORT_OFF,
  REACH_GAPS_OFF,
  REACH_OFF,
  parseGapExport,
  parseGapReport,
  parseReach,
  parseReachGaps,
  type GapCause,
  type GapExportRow,
  type GapReport,
  type Reach,
  type ReachGaps,
} from "./gaps";

// Each loader answers "Off" when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the database file
// is applied behaves exactly as it always did.

export type GapFilter = { cause?: GapCause | null; tribe?: string | null; community?: string | null; series?: SeriesState | null; limit?: number; offset?: number };

/** The office list: counts by cause, the people, and the trend. */
export async function loadGapReport(supabase: SupabaseClient, f: GapFilter = {}): Promise<GapReport> {
  try {
    const { data, error } = await supabase.rpc("contact_gaps_report", {
      p_cause: f.cause ?? null,
      p_tribe: f.tribe ?? null,
      p_community: f.community ?? null,
      p_limit: f.limit ?? 100,
      p_offset: f.offset ?? 0,
      // Sent only when a stage is chosen, so a database that has not had the series file applied still answers
      ...(f.series ? { p_series: f.series } : {}),
    });
    return error ? GAP_REPORT_OFF : parseGapReport(data);
  } catch {
    return GAP_REPORT_OFF;
  }
}

/** Everyone on the list, for the download. Empty when the person may not act or the feature is Off. */
export async function loadGapExport(supabase: SupabaseClient): Promise<GapExportRow[]> {
  try {
    const { data, error } = await supabase.rpc("contact_gaps_export");
    return error ? [] : parseGapExport(data);
  } catch {
    return [];
  }
}

/** The people of one tribe a leader cannot reach, and whether each can be asked. */
export async function loadReachGaps(supabase: SupabaseClient, tribe: string): Promise<ReachGaps> {
  try {
    const { data, error } = await supabase.rpc("tribe_reach_gaps", { p_tribe: tribe });
    return error ? REACH_GAPS_OFF : parseReachGaps(data);
  } catch {
    return REACH_GAPS_OFF;
  }
}

/** What the signed-in person can put right about how they are reached. */
export async function loadReach(supabase: SupabaseClient): Promise<Reach> {
  try {
    const { data, error } = await supabase.rpc("my_reach");
    return error ? REACH_OFF : parseReach(data);
  } catch {
    return REACH_OFF;
  }
}

/** Whether Contact gaps is On. The announcement composer offers its choice only then. */
export async function loadContactGapsOn(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("contact_gaps_state");
    return !error && data === "on";
  } catch {
    return false;
  }
}
