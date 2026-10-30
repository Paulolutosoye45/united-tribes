import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NUMBER_RULE_OFF, parseNumberGaps, parseNumberRule, type NumberGaps, type NumberRule } from "./number-rule";

// Each loader returns "Off" when the database refuses, does not have the function yet, or cannot be reached: a website deployed before the database file
// is applied behaves exactly as it always did.

/** The rule for the signed-in person: whether the number is compulsory for them, whether to show the prompt, and whether their two numbers differ. */
export async function loadNumberRule(supabase: SupabaseClient): Promise<NumberRule> {
  try {
    const { data, error } = await supabase.rpc("my_number_rule");
    return error ? NUMBER_RULE_OFF : parseNumberRule(data);
  } catch {
    return NUMBER_RULE_OFF;
  }
}

/** The people of a tribe with no phone number saved (a leader's own tribe, or the pastorate). Nobody, while the rule is Off. */
export async function loadNumberGaps(supabase: SupabaseClient, tribe: string): Promise<NumberGaps> {
  try {
    const { data, error } = await supabase.rpc("tribe_number_gaps", { p_tribe: tribe });
    return error ? { on: false, count: 0, names: [] } : parseNumberGaps(data);
  } catch {
    return { on: false, count: 0, names: [] };
  }
}
