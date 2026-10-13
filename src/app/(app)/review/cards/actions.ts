"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

export async function decideCardAction(id: string, decision: "approve" | "changes", note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || (decision !== "approve" && decision !== "changes")) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("decide_tribe_card", { p_id: id, p_decision: decision, p_note: String(note ?? "").slice(0, 600) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/cards/${id}`);
  revalidatePath("/review/cards");
  return { ok: true };
}

export async function pairAssistantAction(tribeId: string, assistantId: string | null): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || (assistantId !== null && !isUuid(assistantId))) return { ok: false, message: TRY_AGAIN };
  const { error } = assistantId
    ? await supabase.rpc("pair_assistant", { p_tribe: tribeId, p_assistant: assistantId })
    : await supabase.rpc("unpair_assistant", { p_tribe: tribeId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/cards/${tribeId}`);
  revalidatePath("/review/cards");
  return { ok: true };
}

export async function assignCoachAction(tribeId: string, coachId: string | null): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || (coachId !== null && !isUuid(coachId))) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("assign_coach", { p_tribe: tribeId, p_coach: coachId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/cards/${tribeId}`);
  revalidatePath("/review/cards");
  return { ok: true };
}
