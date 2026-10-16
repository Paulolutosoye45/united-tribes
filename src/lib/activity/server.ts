import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivitySettings,
  Audit,
  AuditArea,
  Brief,
  Compare,
  Funnel,
  FunnelPeople,
  Heatmap,
  Integrity,
  Messages,
  Pulse,
  Retention,
  Stakeholders,
  Tab,
} from "./types";

// Every loader returns null when the database refuses (the person is not the owner, or the console is locked) or cannot be
// reached. The pages treat null as "not available": the database has already decided, and says nothing more.

async function load<T>(supabase: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return null;
  return (data as T | null) ?? null;
}

export const loadPulse = (s: SupabaseClient) => load<Pulse>(s, "activity_pulse");
export const loadBrief = (s: SupabaseClient) => load<Brief>(s, "activity_brief");

export const loadFunnel = (s: SupabaseClient, o: { which: "member" | "leader"; from?: string | null; to?: string | null; split?: string | null }) =>
  load<Funnel>(s, "activity_funnels", { p_which: o.which, p_from: o.from ?? null, p_to: o.to ?? null, p_split: o.split ?? null });

export const loadFunnelPeople = (
  s: SupabaseClient,
  o: { which: "member" | "leader"; stage: number; mode: "stopped" | "reached"; from?: string | null; to?: string | null; limit?: number },
) => load<FunnelPeople>(s, "activity_funnel_people", { p_which: o.which, p_stage: o.stage, p_mode: o.mode, p_from: o.from ?? null, p_to: o.to ?? null, p_limit: o.limit ?? 100 });

export const loadCompare = (s: SupabaseClient, by: "community" | "zone" | "tribe") => load<Compare>(s, "activity_compare", { p_by: by });
export const loadRetention = (s: SupabaseClient, weeks = 12) => load<Retention>(s, "activity_retention", { p_weeks: weeks });
export const loadHeatmap = (s: SupabaseClient, days = 28) => load<Heatmap>(s, "activity_heatmap", { p_days: days });
export const loadStakeholders = (s: SupabaseClient) => load<Stakeholders>(s, "activity_stakeholders");
export const loadIntegrity = (s: SupabaseClient) => load<Integrity>(s, "activity_integrity");
export const loadMessages = (s: SupabaseClient) => load<Messages>(s, "activity_messages");

export type AuditFilter = { group?: string | null; area?: string | null; person?: string | null; from?: string | null; to?: string | null; before?: string | null; limit?: number };
export const loadAudit = (s: SupabaseClient, f: AuditFilter = {}) =>
  load<Audit>(s, "activity_audit", {
    p_group: f.group ?? null,
    p_area: f.area ?? null,
    p_person: f.person ?? null,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_before: f.before ?? null,
    p_limit: f.limit ?? 100,
  });
export const loadAuditAreas = (s: SupabaseClient) => load<AuditArea[]>(s, "activity_audit_areas");
export const loadSettings = (s: SupabaseClient) => load<ActivitySettings>(s, "activity_settings_get");

/** The owner's own look at a tab goes in their record (and the audit trail, as "You"). At most one entry a minute per tab. */
export async function markViewed(s: SupabaseClient, tab: Tab, what: "viewed" | "exported" = "viewed"): Promise<void> {
  try {
    await s.rpc("activity_viewed", { p_tab: tab, p_what: what });
  } catch {
    // The look is not recorded this time; the page still opens.
  }
}
