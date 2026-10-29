"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

/** "I have looked at this." Closes the message and leaves a short note the person reads on their page. It changes nothing about their age range. */
export async function closeOfficeAskAction(id: string, note: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const { error } = await supabase.rpc("profile_office_ask_close", { p_id: id, p_note: text || null });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/care/teens");
  return { ok: true };
}
