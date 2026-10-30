"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Puts a message that failed back in the queue, as if it had never been tried. Only an admin or director may (the database checks). */
export async function retryMessageAction(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, message: "We couldn’t find that message. Reload the page and try again." };
  return plain(await run("retry_message", { p_id: id }, ["/admin/messages", "/admin/system"]));
}

/** Pauses every WhatsApp message (the database checks who may, that the safety net is On, and that a reason is given). */
export async function pauseWhatsappAction(reason: string): Promise<Result> {
  return plain(await run("whatsapp_pause", { p_reason: reason }, ["/admin/messages"]));
}

/** Restarts WhatsApp. Nothing does this by itself. */
export async function resumeWhatsappAction(note: string): Promise<Result> {
  return plain(await run("whatsapp_resume", { p_reason: note }, ["/admin/messages"]));
}

/** The three numbers of the automatic rule (the admin or a director; the database checks). */
export async function saveGuardSettingsAction(tripCount: number, tripMinutes: number, unconfirmedHours: number): Promise<Result> {
  const whole = (n: number) => Number.isInteger(n);
  if (!whole(tripCount) || !whole(tripMinutes) || !whole(unconfirmedHours)) return { ok: false, message: "Use whole numbers." };
  return plain(await run("whatsapp_guard_settings_save", { p_trip_count: tripCount, p_trip_minutes: tripMinutes, p_unconfirmed_hours: unconfirmedHours }, ["/admin/messages"]));
}
