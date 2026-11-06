import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseConfirmedCounts,
  parseConfirmedFor,
  parseNudgeMarks,
  parseNudgeOverview,
  parseNudgeSettings,
  parseNudgeState,
  type ConfirmedCounts,
  type NudgeMark,
  type NudgeOverview,
  type NudgeSettings,
  type NudgeState,
} from "./nudge";

// Each loader answers "Off" (or nothing) when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the
// database file is applied behaves exactly as it always did.

/** Off, Rehearsal or On for the person asking. Off for anyone who may not use it. */
export async function loadNudgeState(supabase: SupabaseClient): Promise<NudgeState> {
  try {
    const { data, error } = await supabase.rpc("placed_nudge_state");
    return error ? "off" : parseNudgeState(data);
  } catch {
    return "off";
  }
}

/** The Admin home card: how many placed members wait. */
export async function loadNudgeOverview(supabase: SupabaseClient): Promise<NudgeOverview> {
  try {
    const { data, error } = await supabase.rpc("placed_nudge_overview");
    return error ? { state: "off", waiting: 0, waitedTwoDays: 0 } : parseNudgeOverview(data);
  } catch {
    return { state: "off", waiting: 0, waitedTwoDays: 0 };
  }
}

/** For a tribe's leader: who was reminded and when, and whose number is confirmed. Empty when the function is Off. */
export async function loadNudgeMarks(supabase: SupabaseClient, tribe: string): Promise<NudgeMark[]> {
  try {
    const { data, error } = await supabase.rpc("tribe_nudge_marks", { p_tribe: tribe });
    return error ? [] : parseNudgeMarks(data);
  } catch {
    return [];
  }
}

/** Contact gaps: who has a number that reaches them (by person id). */
export async function loadConfirmedFor(supabase: SupabaseClient, people: string[]): Promise<Record<string, string>> {
  if (people.length === 0 || people.length > 500) return {};
  try {
    const { data, error } = await supabase.rpc("number_confirmed_for", { p_people: people });
    return error ? {} : parseConfirmedFor(data);
  } catch {
    return {};
  }
}

/** Contact gaps: "Confirmed on WhatsApp: 18 of 40". Null when it cannot be read. */
export async function loadConfirmedCounts(supabase: SupabaseClient): Promise<ConfirmedCounts | null> {
  try {
    const { data, error } = await supabase.rpc("whatsapp_confirmed_counts");
    return error ? null : parseConfirmedCounts(data);
  } catch {
    return null;
  }
}

/** God Mode: the three numbers. Null for anyone but the unlocked owner, and when the database does not have the nudge yet. */
export async function loadPlacedNudgeSettings(supabase: SupabaseClient): Promise<NudgeSettings | null> {
  try {
    const { data, error } = await supabase.rpc("god_placed_nudge_settings");
    return error ? null : parseNudgeSettings(data);
  } catch {
    return null;
  }
}
