"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { siteOrigin } from "@/lib/leaders/origin";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * Makes a new private link for one referee. The secret is returned once and is
 * not stored, so the old link stops working and a lost link is simply replaced.
 */
export async function makeRefereeLinkAction(referenceId: string): Promise<Result<{ url: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(referenceId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renew_referee_link", { p_reference: referenceId });
  if (error || typeof data !== "string") return { ok: false, message: friendly(error) };
  return { ok: true, url: `${await siteOrigin()}/reference/${data}` };
}

export async function bookInterviewAction(slotId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(slotId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("book_interview_slot", { p_slot: slotId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}

export async function cancelInterviewAction(): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_interview_booking");
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}

/** Deletes the person’s application and everything attached to it, until they are approved. */
export async function withdrawApplicationAction(appId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.from("leader_applications").delete().eq("id", appId).eq("person_id", session.person.id).select("id");
  if (error) return { ok: false, message: TRY_AGAIN };
  if (!data || data.length === 0) return { ok: false, message: "This application can no longer be withdrawn here. Message the office." };
  revalidatePath("/lead");
  revalidatePath("/home");
  return { ok: true };
}
