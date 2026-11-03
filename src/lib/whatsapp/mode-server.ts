import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCostView, parseHandContext, parseModeView, parseStaffList, type CostView, type HandContext, type ModeView, type StaffList } from "./mode-view";

/** Each loader gives the page's data, or null when the function is Off, the database does not have it yet, refuses, or cannot be reached. */
async function ask<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> | undefined, parse: (v: unknown) => T | null): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return error ? null : parse(data);
  } catch {
    return null;
  }
}

export const loadWhatsappMode = (supabase: SupabaseClient): Promise<ModeView | null> => ask(supabase, "whatsapp_mode_overview", undefined, parseModeView);
export const loadWhatsappCost = (supabase: SupabaseClient): Promise<CostView | null> => ask(supabase, "whatsapp_cost_report", undefined, parseCostView);
export const loadHandContext = (supabase: SupabaseClient, tribe: string): Promise<HandContext | null> => ask(supabase, "hand_context", { p_tribe: tribe }, parseHandContext);
export const loadHandStaff = (supabase: SupabaseClient): Promise<StaffList | null> => ask(supabase, "hand_staff_list", undefined, parseStaffList);
