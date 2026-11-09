"use server";

import { run, text, type Result } from "@/lib/admin/rpc";
import { PLACED_DESK_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { isOutcome } from "@/lib/placement/answers";

const PAGES = ["/admin/placed", "/admin/placed/tribes", "/admin/placed/desk", "/admin"];

/** Only an admin or a director acts here; the database checks the same, so this only saves a trip. */
async function canAct(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session && hasAnyRole(session.roles, PLACED_DESK_ROLES));
}

const NOT_YOURS = "Only an admin or a director can do that.";

/** Pauses (or resumes) the placed answer sequence for everyone. Emails already sent stay sent. A reason is kept in the log. */
export async function placedPauseAction(paused: boolean, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (typeof paused !== "boolean") return { ok: false, message: TRY_AGAIN };
  const done = await run("placed_answers_pause_set", { p_paused: paused, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** "Hold this seat": the office is dealing with this member, so the emails wait for a few days. */
export async function placedHoldAction(tm: string, days: number, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(tm) || typeof days !== "number" || !Number.isInteger(days)) return { ok: false, message: TRY_AGAIN };
  const done = await run("placed_hold_set", { p_tm: tm, p_days: days, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function placedHoldClearAction(tm: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(tm)) return { ok: false, message: TRY_AGAIN };
  const done = await run("placed_hold_clear", { p_tm: tm }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Shows one number, and the database writes down that it was shown (never the number). Outside calling hours, or too many in an hour, it says so. */
export async function placedRevealAction(tm: string, anyway: boolean): Promise<{ ok: true; number: string } | { ok: false; message: string }> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(tm)) return { ok: false, message: TRY_AGAIN };
  const done = await run<{ ok?: boolean; number?: string | null }>("placed_desk_reveal", { p_tm: tm, p_anyway: anyway === true });
  if (!done.ok) return done;
  const number = typeof done.data?.number === "string" ? done.data.number : "";
  return number ? { ok: true, number } : { ok: false, message: "We have no usable number for that member." };
}

/** Writes down how a call went. Yes confirms the place; the rest end or pause the follow-up in the way the database explains. */
export async function placedRecordAction(tm: string, outcome: string, followup: string | null): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(tm) || !isOutcome(outcome)) return { ok: false, message: TRY_AGAIN };
  const day = typeof followup === "string" && /^\d{4}-\d{2}-\d{2}$/.test(followup) ? followup : null;
  const done = await run("placed_desk_record", { p_tm: tm, p_outcome: outcome, p_followup: day }, PAGES);
  return done.ok ? { ok: true } : done;
}
