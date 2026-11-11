"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { isPromptKind, type PromptKind } from "@/lib/prompt/prompt";
import { createClient } from "@/lib/supabase/server";

// The sign-in prompt's buttons. None of them decides anything itself: each calls the function the site already uses for that answer (or, for "Not this season" and
// "Call me", the one that does the private page's steps for a signed-in person), then writes down that the task was answered. The database is the only judge of
// whether the task was still owed, so an answer given a second time, by email or on another device, is told it is already recorded.

export type PromptResult = { ok: true; already?: boolean } | { ok: false; message: string; reason?: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

/** Writes down that a task was answered. The log is only a record: if it cannot be written, the answer still stands. */
async function answered(supabase: NonNullable<Awaited<ReturnType<typeof authed>>>, kind: PromptKind) {
  try {
    await supabase.rpc("prompt_log_set", { p_kind: kind, p_outcome: "answered" });
  } catch {
    /* the answer is recorded; the record of the prompt is not worth failing for */
  }
  // The banners and boards on every page read the same state
  revalidatePath("/", "layout");
}

const reasonOf = (data: unknown): string | null => {
  const d = typeof data === "object" && data !== null ? (data as { ok?: unknown; reason?: unknown }) : {};
  return d.ok === true ? null : typeof d.reason === "string" ? d.reason : "failed";
};

const WORDS: Record<string, string> = {
  off: "That answer isn’t open yet. Please use your tribe page.",
  not_available: "That answer isn’t available to you.",
  not_active: "That place is no longer yours to answer for.",
  started: "The season has already started.",
};

/** "Yes, I’m in" (the function the tribe page uses), or "Not this season" and "Call me". */
export async function promptPlacementAction(kind: "yes" | "not_season" | "call", opts?: { window?: string | null; phone?: string | null }): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (kind !== "yes" && kind !== "not_season" && kind !== "call") return { ok: false, message: TRY_AGAIN };
  let data: unknown;
  if (kind === "yes") {
    const r = await supabase.rpc("placement_my_confirm", { p_version: AGREEMENT_VERSION });
    if (r.error) return { ok: false, message: friendly(r.error) };
    data = r.data;
  } else {
    const window = opts?.window === "morning" || opts?.window === "afternoon" || opts?.window === "evening" ? opts.window : null;
    const typed = typeof opts?.phone === "string" ? opts.phone.trim() : "";
    const phone = typed ? (normaliseWhatsapp(typed) ?? typed) : null;
    const r = await supabase.rpc("prompt_placement_answer", { p_kind: kind, p_window: window, p_phone: phone });
    if (r.error) return { ok: false, message: friendly(r.error) };
    data = r.data;
  }
  const why = reasonOf(data);
  if (why === "not_active") {
    // Someone (the member by email, the office, another device) got there first: the seat has an answer already
    await answered(supabase, "placement");
    return { ok: true, already: true };
  }
  if (why) return { ok: false, message: WORDS[why] ?? TRY_AGAIN, reason: why };
  await answered(supabase, "placement");
  return { ok: true };
}

/** Saves a WhatsApp number, typed or the one they sign in with. The yes to WhatsApp is its own tick and is never ticked for anyone. */
export async function promptNumberAction(input: { phone: string; useSignin: boolean; whatsapp: boolean }): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!input || typeof input.useSignin !== "boolean" || typeof input.whatsapp !== "boolean") return { ok: false, message: TRY_AGAIN };
  const typed = typeof input.phone === "string" ? input.phone.trim() : "";
  if (!input.useSignin && !typed) return { ok: false, message: "Write your number with its country code, like +2348031234567." };
  const phone = input.useSignin ? null : (normaliseWhatsapp(typed) ?? typed);
  const { data, error } = await supabase.rpc("prompt_save_number", { p_phone: phone, p_use_signin: input.useSignin, p_whatsapp: input.whatsapp });
  if (error) return { ok: false, message: friendly(error) };
  const why = reasonOf(data);
  if (why) return { ok: false, message: WORDS[why] ?? TRY_AGAIN, reason: why };
  await answered(supabase, "number");
  return { ok: true, already: (data as { again?: boolean } | null)?.again === true };
}

/** Yes or No to WhatsApp. A No is final. */
export async function promptWhatsappAction(yes: boolean): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (typeof yes !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { data, error } = await supabase.rpc("prompt_whatsapp_answer", { p_yes: yes });
  if (error) return { ok: false, message: friendly(error) };
  const why = reasonOf(data);
  if (why) return { ok: false, message: WORDS[why] ?? TRY_AGAIN, reason: why };
  await answered(supabase, "whatsapp");
  return { ok: true, already: (data as { again?: boolean } | null)?.again === true };
}

/** A leader answers an offer to lead a group: the leader board's own function. */
export async function promptOfferAction(offerId: string, accept: boolean): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(offerId) || typeof accept !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("leader_offer_respond", { p_offer: offerId, p_accept: accept });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  revalidatePath("/lead/tribe");
  await answered(supabase, "leader_offer");
  return { ok: true };
}

/** A prospective leader books an interview time: the function the application page uses. */
export async function promptInterviewAction(slot: string): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(slot)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("book_interview_slot", { p_slot: slot });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  await answered(supabase, "interview");
  return { ok: true };
}

/** "Not now" (closed for this visit) or "Open it" (they went to the page to do it). Neither is an answer. */
export async function promptLaterAction(kind: string, outcome: "not_now" | "opened"): Promise<PromptResult> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isPromptKind(kind) || (outcome !== "not_now" && outcome !== "opened")) return { ok: false, message: TRY_AGAIN };
  const { data, error } = await supabase.rpc("prompt_log_set", { p_kind: kind, p_outcome: outcome });
  if (error) return { ok: false, message: friendly(error) };
  const why = reasonOf(data);
  // No visit on record means there is nothing to close; the screen simply moves on
  if (why === "no_visit") return { ok: true };
  if (why) return { ok: false, message: why === "no_skip" ? "This one can’t be put off now. You can still choose any of the answers." : TRY_AGAIN, reason: why };
  return { ok: true };
}
