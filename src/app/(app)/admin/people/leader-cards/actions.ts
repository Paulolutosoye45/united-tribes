"use server";

import { plain, run, type Done } from "@/lib/admin/rpc";
import type { Result } from "@/lib/admin/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import type { ReminderMode } from "@/lib/leader-cards/cards";

const PAGES = ["/admin/people/leader-cards", "/admin/system"];

export type Resent = { ok: boolean; queued: number; skipped: { person_id: string; name: string; reason: string }[] };

/** Sends the email with the card's link again: to one leader, or (person null) to everyone whose email did not arrive and who has not started. */
export async function resendAction(person: string | null): Promise<Done<Resent>> {
  if (person !== null && !isUuid(person)) return { ok: false, message: TRY_AGAIN };
  return run<Resent>("leader_cards_resend", { p_person: person }, PAGES);
}

/** Tags a leader with the department they serve in. An empty name clears it. */
export async function departmentAction(person: string, department: string): Promise<Result> {
  if (!isUuid(person)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("leader_card_department_set", { p_person: person, p_department: department.slice(0, 80) }, PAGES));
}

/** Moves the reminders between Off, Rehearsal and On, with the days, the hour and the reason. */
export async function remindersAction(mode: ReminderMode, days: number[], hour: number, reason: string): Promise<Result> {
  if (mode !== "off" && mode !== "rehearsal" && mode !== "on") return { ok: false, message: TRY_AGAIN };
  const clean = days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).slice(0, 7);
  return plain(await run("leader_card_reminders_set", { p_mode: mode, p_days: clean, p_hour: Math.trunc(hour), p_reason: reason.slice(0, 400) }, PAGES));
}
