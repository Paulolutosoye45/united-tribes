"use server";

import { getSession } from "@/lib/auth/session";
import { parseGoalHints, type GoalHints } from "@/lib/academy/goal-choice";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * The list a leader picks their goal from, read again after a pick so the card shows what the database did (the three lines refilled, the
 * tribe's name following the community, how many are waiting now). The database gives the list only to the leader of that card, and only
 * while the church has let them choose.
 */
export async function goalHintsAction(id: string): Promise<{ ok: true; hints: GoalHints | null } | { ok: false; message: string }> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tribe_goal_hints", { p_tribe: id });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, hints: parseGoalHints(data) };
}
