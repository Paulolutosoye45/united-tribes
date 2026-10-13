"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { PLANS, SWAP_REASONS } from "@/lib/growth/types";
import { loadSwapMembers } from "@/lib/growth/server";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

async function authed() {
  const session = await getSession();
  return session ? await createClient() : null;
}

const VERSION = /^v[0-9]{1,6}$/;

// ---------------------------------------------------------------------------
// The matching model
// ---------------------------------------------------------------------------

/** Makes the proposal a new, switched-off version. Nothing changes for members until someone switches it on. */
export async function retrainAction(notes: string, allowSmall: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const text = typeof notes === "string" ? notes.trim().slice(0, 400) : "";
  const { error } = await supabase.rpc("retrain_model", { p_notes: text || null, p_allow_small: allowSmall === true });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/model");
  return { ok: true };
}

export async function activateModelAction(version: string, confirmSmall: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (typeof version !== "string" || !VERSION.test(version)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("activate_model", { p_version: version, p_confirm_small: confirmSmall === true });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/model");
  return { ok: true };
}

export async function discardModelAction(version: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (typeof version !== "string" || !VERSION.test(version)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("discard_model", { p_version: version });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/model");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Changing tribe (the coach's side)
// ---------------------------------------------------------------------------

export async function offerSwapAction(request: string, tribe: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(request) || !isUuid(tribe)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("offer_swap", { p_request: request, p_tribe: tribe });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/swaps");
  return { ok: true };
}

export async function declineSwapAction(request: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const { error } = await supabase.rpc("decline_swap", { p_request: request, p_note: text || null });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/swaps");
  return { ok: true };
}

/** A coach asks for a move on a member's behalf, after the first weeks or when the member cannot. */
export async function startSwapForAction(person: string, reason: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(person) || !(SWAP_REASONS as readonly string[]).includes(reason)) return { ok: false, message: "Choose the main reason." };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const { error } = await supabase.rpc("start_swap_for", { p_person: person, p_reason: reason, p_note: text || null });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/swaps");
  return { ok: true };
}

/** Looks up members to start a change for. A coach sees their own; the office types a name. */
export async function findSwapMembersAction(search: string): Promise<{ ok: true; members: { person_id: string; name: string; tribe: string }[] } | { ok: false; message: string }> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const q = typeof search === "string" ? search.trim().slice(0, 60) : "";
  return { ok: true, members: await loadSwapMembers(supabase, q || null) };
}

// ---------------------------------------------------------------------------
// Multiplication
// ---------------------------------------------------------------------------

export async function planAction(tribe: string, plan: string, community: string | null, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribe)) return { ok: false, message: TRY_AGAIN };
  if (!(PLANS as readonly string[]).includes(plan)) return { ok: false, message: "Choose what happens to this tribe next." };
  if (plan === "assistant_leads" && !isUuid(community)) return { ok: false, message: "Choose the community the new tribe will belong to." };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const { error } = await supabase.rpc("plan_multiplication", {
    p_tribe: tribe,
    p_plan: plan,
    p_community: plan === "assistant_leads" ? community : null,
    p_note: text || null,
  });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/multiply");
  return { ok: true };
}

export async function clearPlanAction(tribe: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribe)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("clear_multiplication_plan", { p_tribe: tribe });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/growth/multiply");
  return { ok: true };
}
