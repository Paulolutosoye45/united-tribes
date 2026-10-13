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

/** The fields a leader can change on the card. Anything else is dropped before it reaches the database. */
const FIELDS = [
  "name",
  "track",
  "community",
  "goal",
  "tribe_type",
  "story",
  "meeting_day",
  "meeting_time",
  "mode",
  "zone",
  "place_note",
  "capacity",
  "god",
  "others",
  "life",
] as const;

export async function startCardAction(): Promise<Result<{ id: string }>> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  const { data, error } = await supabase.rpc("start_tribe_card");
  if (error || !isUuid(data)) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/tribe");
  return { ok: true, id: data };
}

export async function saveCardAction(id: string, fields: Record<string, unknown>): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id) || !fields || typeof fields !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (key in fields) clean[key] = fields[key] ?? null;
  }
  const { error } = await supabase.rpc("save_tribe_card", { p_id: id, p_fields: clean });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true };
}

export async function submitCardAction(id: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("submit_tribe_card", { p_id: id });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/tribe");
  revalidatePath("/lead/academy");
  revalidatePath("/lead");
  return { ok: true };
}

/** The leader's welcome work: the WhatsApp group link and the first meeting date. */
export async function saveOnboardingAction(tribeId: string, groupUrl: string, firstMeeting: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId)) return { ok: false, message: TRY_AGAIN };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(firstMeeting) ? firstMeeting : null;
  const { error } = await supabase.rpc("save_tribe_onboarding", {
    p_tribe: tribeId,
    p_group_url: typeof groupUrl === "string" ? groupUrl.trim().slice(0, 200) : null,
    p_first_meeting: date,
  });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/tribe");
  return { ok: true };
}

export async function markCalledAction(tribeId: string, personId: string, called: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId) || !isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("mark_member_called", { p_tribe: tribeId, p_person: personId, p_called: Boolean(called) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/tribe");
  return { ok: true };
}

/** The link an online tribe meets on, and a short place note. Both are sent in reminders. */
export async function saveMeetingAction(id: string, link: string, placeNote: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("save_tribe_meeting", {
    p_tribe: id,
    p_link: String(link ?? "").trim().slice(0, 300) || null,
    p_place_note: String(placeNote ?? "").trim().slice(0, 150) || null,
  });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead/tribe");
  return { ok: true };
}
