"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SAFEGUARDING_VERSION } from "@/lib/academy/declaration";
import type { QuizResult } from "@/lib/academy/types";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

const SLUG = /^[a-z0-9-]{1,48}$/;

/** Sends a quiz for scoring. The database scores it; this only passes the answers on. */
export async function submitQuizAction(slug: string, answers: (number | null)[]): Promise<Result<{ result: QuizResult }>> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!SLUG.test(slug) || !Array.isArray(answers) || answers.length > 20) return { ok: false, message: TRY_AGAIN };
  if (answers.some((a) => typeof a !== "number" || !Number.isInteger(a))) return { ok: false, message: "Answer every question first." };
  const { data, error } = await supabase.rpc("submit_quiz", { p_slug: slug, p_answers: answers });
  if (error || !data) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/academy");
  revalidatePath("/lead");
  return { ok: true, result: data as QuizResult };
}

export async function signDeclarationAction(name: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("sign_safeguarding", { p_version: SAFEGUARDING_VERSION, p_name: String(name ?? "").slice(0, 120) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/academy");
  revalidatePath("/lead");
  return { ok: true };
}

export async function bookSessionAction(sessionId: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(sessionId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("book_academy_session", { p_session: sessionId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/academy");
  return { ok: true };
}

export async function cancelBookingAction(sessionId: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(sessionId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("cancel_academy_booking", { p_session: sessionId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/academy");
  return { ok: true };
}
