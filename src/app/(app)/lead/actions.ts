"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { BROWSER_COOKIE, traceOf } from "@/lib/leaders/referee/trace";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * "Send request": the system makes the private link and sends it to the referee's own phone or email. The applicant is never given
 * it, so they cannot answer for the referee. This also notes, as scrambled codes only, where the applicant is signed in from.
 */
export async function requestRefereeAction(referenceId: string): Promise<Result<{ kind: "email" | "phone" | null }>> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(referenceId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const trace = traceOf(await headers(), (await cookies()).get(BROWSER_COOKIE)?.value);
  if (trace.net && trace.bid) await supabase.rpc("referee_note_applicant", { p_net: trace.net, p_bid: trace.bid });
  const { data, error } = await supabase.rpc("request_referee_send", { p_reference: referenceId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  const kind = (data as { kind?: unknown } | null)?.kind;
  return { ok: true, kind: kind === "email" || kind === "phone" ? kind : null };
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
