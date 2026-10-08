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

/** A reviewer’s rubric scores for one stage. They can edit them until the decision. */
export async function saveReviewAction(appId: string, stage: "calling" | "interview", scores: Record<string, number>, notes: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || (stage !== "calling" && stage !== "interview")) return { ok: false, message: TRY_AGAIN };
  const clean = Object.fromEntries(Object.entries(scores ?? {}).map(([k, v]) => [k, Number(v)]));
  const { error } = await supabase.rpc("save_review", { p_id: appId, p_stage: stage, p_scores: clean, p_notes: String(notes ?? "").slice(0, 1000) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/${appId}`);
  revalidatePath("/review");
  return { ok: true };
}

export async function inviteToInterviewAction(appId: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("invite_to_interview", { p_id: appId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/${appId}`);
  revalidatePath("/review");
  return { ok: true };
}

/** A pastor records that they followed up a referee’s concern. */
export async function clearConcernAction(appId: string, referenceId: string, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || !isUuid(referenceId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("clear_reference_concern", { p_reference: referenceId, p_note: String(note ?? "") });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/${appId}`);
  return { ok: true };
}

/** The final decision. Approving grants the role in the same step. */
export async function decideAction(appId: string, decision: "leader" | "assistant_leader" | "not_approved", note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(appId) || !["leader", "assistant_leader", "not_approved"].includes(decision)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("decide_application", { p_id: appId, p_decision: decision, p_note: String(note ?? "").slice(0, 600) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath(`/review/${appId}`);
  revalidatePath("/review");
  return { ok: true };
}

/** Lagos has no daylight saving, so a time typed for Lagos is always UTC+1. */
function lagosToIso(local: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function addSlotAction(input: { local: string; minutes: number; mode: "online" | "in_person"; place: string; panel: string }): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const starts = lagosToIso(String(input.local ?? ""));
  if (!starts) return { ok: false, message: "Choose a date and time." };
  if (input.mode !== "online" && input.mode !== "in_person") return { ok: false, message: TRY_AGAIN };
  const minutes = Math.round(Number(input.minutes));
  if (!(minutes >= 10 && minutes <= 120)) return { ok: false, message: "A conversation runs 10 to 120 minutes." };
  const place = String(input.place ?? "").trim();
  if (place.length < 2) return { ok: false, message: input.mode === "online" ? "Add the meeting link." : "Add where it will be." };
  const { error } = await supabase.rpc("add_interview_slot", {
    p_starts: starts,
    p_minutes: minutes,
    p_mode: input.mode,
    p_place: place,
    p_panel: String(input.panel ?? "").trim().slice(0, 200),
  });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/interviews");
  return { ok: true };
}

export async function removeSlotAction(slotId: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(slotId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("remove_interview_slot", { p_slot: slotId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/interviews");
  return { ok: true };
}
