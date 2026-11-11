"use server";

import { run, text, type Result } from "@/lib/admin/rpc";
import { SEAT_ACT_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { SESSION_ENDED, TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { loadSeatHistory } from "@/lib/seat/seat-server";
import { createClient } from "@/lib/supabase/server";
import { SEAT_ROLES } from "@/lib/auth/roles";
import type { SeatEvent } from "@/lib/seat/seat";

const PAGES = ["/admin/seats", "/admin"];
const NOT_YOURS = "Only an admin, a director or a pastor can do that.";

/** Only the office acts here; the database checks the same, so this only saves a trip. */
async function canAct(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session && (session.god === "open" || hasAnyRole(session.roles, SEAT_ACT_ROLES)));
}

/** Keeps a seat out of the clock. The reason is written down. */
export async function seatKeepAction(clock: string, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(clock)) return { ok: false, message: TRY_AGAIN };
  const done = await run("seat_keep", { p_clock: clock, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** 48 hours more, once. */
export async function seatExtendAction(clock: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(clock)) return { ok: false, message: TRY_AGAIN };
  const done = await run("seat_extend", { p_clock: clock }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Lets a seat go now, for a reason, while the function is On. The database refuses anyone who must never be released. */
export async function seatReleaseNowAction(clock: string, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(clock)) return { ok: false, message: TRY_AGAIN };
  const done = await run("seat_release_now", { p_clock: clock, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Gives a released seat back to the member, while it is still free and the days given have not passed. */
export async function seatGiveBackAction(clock: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(clock)) return { ok: false, message: TRY_AGAIN };
  const done = await run("seat_give_back", { p_clock: clock }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Pauses (or resumes) every clock. Each keeps the time it had left. */
export async function seatPauseAction(paused: boolean, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (typeof paused !== "boolean") return { ok: false, message: TRY_AGAIN };
  const done = await run("seat_pause_set", { p_paused: paused, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Sends the three seat emails to the person asking, with an invented name. No member is written to. */
export async function seatTestSendAction(): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  const done = await run("seat_test_send", undefined, PAGES);
  return done.ok ? { ok: true } : done;
}

/** What happened to one clock, for the person who opened its history. */
export async function seatHistoryAction(clock: string): Promise<SeatEvent[]> {
  const session = await getSession();
  if (!session || !isUuid(clock) || !(session.god === "open" || hasAnyRole(session.roles, SEAT_ROLES))) return [];
  return loadSeatHistory(await createClient(), clock);
}

/** Places today's plan. The database checks again who may, that the plan is today's and unplaced, that every check is green, and then each person once more. */
export async function autopilotApproveAction(plan: string): Promise<{ ok: true; placed: number; skipped: number } | { ok: false; message: string }> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (!isUuid(plan)) return { ok: false, message: TRY_AGAIN };
  const done = await run<{ placed?: unknown; skipped?: unknown }>("autopilot_approve", { p_plan: plan }, PAGES);
  if (!done.ok) return done;
  const r = typeof done.data === "object" && done.data !== null ? done.data : {};
  return { ok: true, placed: typeof r.placed === "number" ? r.placed : 0, skipped: typeof r.skipped === "number" ? r.skipped : 0 };
}

/** Stops autopilot (or starts it again). Needs a reason, which is kept in the log. */
export async function autopilotPauseAction(paused: boolean, reason: string): Promise<Result> {
  if (!(await getSession())) return { ok: false, message: SESSION_ENDED };
  if (!(await canAct())) return { ok: false, message: NOT_YOURS };
  if (typeof paused !== "boolean") return { ok: false, message: TRY_AGAIN };
  const done = await run("autopilot_pause_set", { p_paused: paused, p_reason: text(reason, 300) }, PAGES);
  return done.ok ? { ok: true } : done;
}
