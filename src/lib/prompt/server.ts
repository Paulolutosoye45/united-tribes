import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_PROMPT, parsePromptQueue, type PromptQueue } from "./prompt";

/**
 * What the signed-in person owes, once per page load. The database says whether the switch is on for them, whether this is a new visit, and which tasks are still
 * theirs; any fault at all is "no screen", so a page can never fail because of this.
 */
export async function loadPromptQueue(supabase: SupabaseClient): Promise<PromptQueue> {
  try {
    const { data, error } = await supabase.rpc("my_prompt_queue");
    return error ? NO_PROMPT : parsePromptQueue(data);
  } catch {
    return NO_PROMPT;
  }
}

/** The office's counts for the Placed members board. Null for anyone who may not read them, and when the file has not been applied. */
export async function loadPromptOverview(supabase: SupabaseClient): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc("prompt_overview", { p_days: 7 });
    return error ? null : data;
  } catch {
    return null;
  }
}

/** The owner's numbers. Null for anyone but the owner. */
export async function loadPromptSettings(supabase: SupabaseClient): Promise<unknown> {
  try {
    const { data, error } = await supabase.rpc("god_prompt_settings");
    return error ? null : data;
  } catch {
    return null;
  }
}
