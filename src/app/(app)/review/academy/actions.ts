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

/** Lagos has no daylight saving, so a time typed for Lagos is always UTC+1. */
function lagosToIso(local: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00+01:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function addSessionAction(input: {
  kind: string;
  local: string;
  minutes: number;
  mode: string;
  place: string;
  capacity: number;
}): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (input.kind !== "practice_workshop" && input.kind !== "commissioning_workshop") return { ok: false, message: "Choose which workshop this is." };
  const starts = lagosToIso(String(input.local ?? ""));
  if (!starts) return { ok: false, message: "Choose a date and time." };
  if (input.mode !== "online" && input.mode !== "in_person") return { ok: false, message: TRY_AGAIN };
  const minutes = Math.round(Number(input.minutes));
  if (!(minutes >= 30 && minutes <= 300)) return { ok: false, message: "A workshop runs 30 minutes to 5 hours." };
  const capacity = Math.round(Number(input.capacity));
  if (!(capacity >= 2 && capacity <= 200)) return { ok: false, message: "Seats can be 2 to 200." };
  const place = String(input.place ?? "").trim();
  if (place.length < 2) return { ok: false, message: input.mode === "online" ? "Add the meeting link." : "Add where it will be." };
  const { error } = await supabase.rpc("add_academy_session", {
    p_kind: input.kind,
    p_starts: starts,
    p_minutes: minutes,
    p_mode: input.mode,
    p_place: place.slice(0, 200),
    p_capacity: capacity,
  });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/academy");
  return { ok: true };
}

export async function removeSessionAction(sessionId: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(sessionId)) return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("remove_academy_session", { p_session: sessionId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/academy");
  return { ok: true };
}

export async function markAttendanceAction(sessionId: string, personId: string, attended: boolean): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(sessionId) || !isUuid(personId) || typeof attended !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("mark_attendance", { p_session: sessionId, p_person: personId, p_attended: attended });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/academy");
  return { ok: true };
}

export async function recordPracticeAction(personId: string, format: string, ready: boolean, note: string): Promise<Result> {
  const supabase = await authed();
  if (!supabase) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(personId) || (format !== "co_lead" && format !== "recorded") || typeof ready !== "boolean") return { ok: false, message: TRY_AGAIN };
  const { error } = await supabase.rpc("record_practice", { p_person: personId, p_format: format, p_ready: ready, p_note: String(note ?? "").slice(0, 600) });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/review/academy");
  revalidatePath("/review/cards");
  return { ok: true };
}
