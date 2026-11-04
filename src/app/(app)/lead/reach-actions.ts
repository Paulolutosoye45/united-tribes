"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, friendly, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

/**
 * A leader asks one person in their own tribe, by email, to add a number or to say yes to WhatsApp. The database decides everything:
 * that this person is in the leader's tribe, that there is something to ask, that they were not asked in the last two weeks or three times
 * already, and that they can be emailed at all. What it refuses is said back in its own words.
 */
export async function askToAddNumberAction(personId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("contact_ask_send", { p_person: personId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The contact series and the tribe note (seats and contacts, Package 5)
// ---------------------------------------------------------------------------
type Sent = { ok: true; sent: number } | { ok: false; message: string };

const sentOf = (data: unknown): number => {
  const n = (data as { sent?: unknown } | null)?.sent;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/**
 * “Ask my members”: email 1 goes now, in the leader’s name, with their own line, to everyone in the tribe who has a gap and has not been asked. The
 * database decides everything: that this is the leader’s tribe, that the series is On, that the tribe was not asked in the last three days, and that
 * the line is short and has no link in it. What it refuses is said back in its own words.
 */
export async function askTribeAction(tribeId: string, line: string): Promise<Sent> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reach_ask_tribe", { p_tribe: tribeId, p_line: typeof line === "string" && line.trim() ? line.slice(0, 400) : null });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true, sent: sentOf(data) };
}

/** “I’ll follow this up myself”: the emails to that person wait three days. Once for a person. */
export async function followUpAction(personId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reach_follow_up", { p_person: personId });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true };
}

/** The tribe note: one email in the leader’s name to everyone in the tribe who may be written to. In Rehearsal it is only kept. */
export async function tribeNoteAction(tribeId: string, body: string): Promise<Sent & { rehearsal?: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_ENDED };
  if (!isUuid(tribeId)) return { ok: false, message: TRY_AGAIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tribe_note_send", { p_tribe: tribeId, p_body: typeof body === "string" ? body.slice(0, 1200) : "" });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/lead");
  return { ok: true, sent: sentOf(data), rehearsal: (data as { rehearsal?: boolean } | null)?.rehearsal === true };
}
