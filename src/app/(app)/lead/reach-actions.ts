"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

/**
 * A leader asks one person in their own tribe, by email, to add a number or to say yes to WhatsApp. The database decides everything:
 * that this person is in the leader's tribe, that there is something to ask, that they were not asked in the last two weeks or three times
 * already, and that they can be emailed at all. What it refuses is said back in its own words.
 */
export async function askToAddNumberAction(personId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("contact_ask_send", { p_person: personId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}
