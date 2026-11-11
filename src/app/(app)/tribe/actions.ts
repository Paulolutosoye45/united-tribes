"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SWAP_REASONS } from "@/lib/growth/types";
import { normaliseWhatsapp } from "@/lib/intake/answers";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { isLeaveReason } from "@/lib/seat/seat";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

function refresh() {
  revalidatePath("/tribe");
  revalidatePath("/home");
}

/** Looks again, now. Used when a member wants fresh results or tribes were added. */
export async function refreshMatchesAction(): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("match_me", { p_refresh: true });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** Commits to one tribe. The database re-checks the seat, the agreement and that the tribe was shown. */
export async function chooseTribeAction(tribeId: string, agreed: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || typeof agreed !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("choose_tribe", { p_tribe: tribeId, p_agree: agreed, p_version: AGREEMENT_VERSION });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function releaseSeatAction(reason: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("release_my_seat", { p_reason: typeof reason === "string" ? reason.slice(0, 300) : null });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function starterListAction(join: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("join_starter_list", { p_join: Boolean(join) });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Changing tribe, in the first weeks
// ---------------------------------------------------------------------------

/** Asks the coach for a different tribe. The coach (or the Care Lead) offers one; the member says yes or no. */
export async function requestSwapAction(reason: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!(SWAP_REASONS as readonly string[]).includes(reason)) return { ok: false, message: "Choose the main reason." };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const { error } = await supabase.rpc("request_swap", { p_reason: reason, p_note: text || null, p_wants: null });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

export async function cancelSwapAction(): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { error } = await supabase.rpc("cancel_swap");
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** Yes moves the member and agrees the new tribe's Covenant; no keeps them where they are. */
export async function answerSwapAction(accept: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (typeof accept !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("answer_swap", { p_accept: accept, p_version: accept ? AGREEMENT_VERSION : null });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// A young person asks their parent or guardian
// ---------------------------------------------------------------------------

const RELATIONSHIP_IDS = ["mother", "father", "guardian", "other"];

/**
 * Sends the private link to the parent or guardian's own email or phone. The young person never sees the link:
 * it goes to the person it is for, and the database keeps only its fingerprint.
 */
export async function requestGuardianAction(name: string, relationship: string, email: string, phone: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (typeof name !== "string" || name.trim().length < 2) return { ok: false, message: "Give the name of your parent or guardian." };
  if (!RELATIONSHIP_IDS.includes(relationship)) return { ok: false, message: "Say who they are to you." };
  const mail = typeof email === "string" ? email.trim() : "";
  const number = typeof phone === "string" ? phone.trim() : "";
  if (!mail && !number) return { ok: false, message: "Give an email address or a phone number for your parent or guardian." };
  const { error } = await supabase.rpc("request_guardian_consent", {
    p_name: name.trim().slice(0, 80),
    p_relationship: relationship,
    p_email: mail || null,
    p_phone: number ? (normaliseWhatsapp(number) ?? number) : null,
  });
  if (error) return { ok: false, message: friendly(error) };
  refresh();
  return { ok: true };
}

/** "Yes, I'm in", for a member the church placed. The seat was already theirs; this is their agreement to the covenant. */
export async function confirmPlacementAction(): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { data, error } = await supabase.rpc("placement_my_confirm", { p_version: AGREEMENT_VERSION });
  if (error) return { ok: false, message: friendly(error) };
  if ((data as { ok?: boolean } | null)?.ok !== true) return { ok: false, message: "That place is no longer yours to confirm." };
  refresh();
  return { ok: true };
}

/** "Don't share my details", for a member the church placed. If the leader has already been told, the answer says so. */
export async function withholdPlacementAction(): Promise<{ ok: true; late: boolean } | { ok: false; message: string }> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { data, error } = await supabase.rpc("placement_my_withhold");
  if (error) return { ok: false, message: friendly(error) };
  const d = (data ?? {}) as { ok?: boolean; late?: boolean };
  if (d.ok !== true) return { ok: false, message: "That place is no longer yours to change." };
  refresh();
  return { ok: true, late: d.late === true };
}

/** The member leaves their tribe, in the first two weeks of the season. The reason is optional and is one of a short list. The database checks that the seat is theirs and that the two weeks are not over. */
export async function leaveTribeAction(why: string | null): Promise<{ ok: true; tribe: string } | { ok: false; message: string; later?: boolean }> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (why !== null && !isLeaveReason(why)) return { ok: false, message: TRY_AGAIN };
  const { data, error } = await supabase.rpc("my_tribe_leave", { p_why: why });
  if (error) return { ok: false, message: friendly(error) };
  const r = (typeof data === "object" && data !== null ? data : {}) as { ok?: boolean; reason?: string; tribe?: string };
  if (r.ok !== true) return { ok: false, message: r.reason === "later" ? "later" : TRY_AGAIN, later: r.reason === "later" };
  refresh();
  return { ok: true, tribe: typeof r.tribe === "string" ? r.tribe : "your tribe" };
}
