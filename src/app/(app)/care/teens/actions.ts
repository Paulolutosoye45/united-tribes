"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

/** "I have spoken to the parent or guardian, and it was them." Until this is recorded the young person cannot see tribes. */
export async function verifyGuardianAction(person: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(person)) return { ok: false, message: TRY_AGAIN };
  const text = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const { error } = await supabase.rpc("verify_guardian", { p_person: person, p_note: text || null });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/care/teens");
  return { ok: true };
}

/** After a "no", and a family conversation: lets the young person ask again. */
export async function reopenGuardianAction(person: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(person)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("reopen_guardian_request", { p_person: person });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/care/teens");
  return { ok: true };
}
