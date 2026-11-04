"use server";

import { run, text, type Result } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { CONTACT_GAP_ACT_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { SESSION_ENDED, TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/people/contact-gaps", "/lead"];

async function canAct(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session && hasAnyRole(session.roles, CONTACT_GAP_ACT_ROLES));
}

/** Pauses (or resumes) the contact series for everyone. Emails already running keep the days they had left. A reason is kept in the log. */
export async function seriesPauseAction(paused: boolean, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct()) || typeof paused !== "boolean") return { ok: false, message: "Only the office can do that." };
  const done = await run("reach_series_pause", { p_paused: paused, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Ends the series for one person (they asked us to leave them be, or a pastoral reason). The reason is kept in the log. */
export async function seriesStopAction(personId: string, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: "Only the office can do that." };
  if (!isUuid(personId)) return { ok: false, message: TRY_AGAIN };
  const done = await run("reach_series_stop", { p_person: personId, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}
