"use server";

import { run } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import {
  lockSummary,
  parseLockOutcome,
  parseSendOutcome,
  parseUnlockOutcome,
  sendSummary,
  skippedLines,
  unlockSummary,
} from "@/lib/god/goal-unlock";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { WELCOME_WORDING_VERSION } from "@/lib/messaging/templates-leader-welcome";

/**
 * "Let them choose": the owner's actions for unlocking a leader's goal, locking it again, and the welcome email.
 * Every one refuses anyone who is not the owner and unlocked before the database is asked anything, and the database checks again.
 */

const PAGES = ["/god/appointments", "/god/appointments/bulk", "/god/appointments/welcome", "/god", "/god/tribes", "/review/cards", "/lead/tribe", "/lead"];
const MAX_TRIBES = 300;

async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/** What the screen shows after an action: a sentence, and the reasons for anyone who was skipped. */
export type Said = { ok: true; message: string; lines: string[] } | Fail;

function tribeIds(tribes: unknown): string[] | null {
  if (!Array.isArray(tribes) || tribes.length === 0 || tribes.length > MAX_TRIBES) return null;
  const ids = [...new Set(tribes)];
  return ids.every(isUuid) ? (ids as string[]) : null;
}

/** Lets the leaders of these tribes choose their goal (and the community, if ticked). The welcome email goes only if ticked and approved. */
export async function unlockGoalAction(tribes: string[], communityToo: boolean, welcome: boolean, names: Record<string, string> = {}): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const ids = tribeIds(tribes);
  if (!ids) return { ok: false, message: `Choose between 1 and ${MAX_TRIBES} leaders.` };
  const done = await run(
    "god_unlock_goal",
    { p_tribes: ids, p_community: communityToo === true, p_welcome: welcome === true, p_version: welcome === true ? WELCOME_WORDING_VERSION : null },
    PAGES,
  );
  if (!done.ok) return done;
  const outcome = parseUnlockOutcome(done.data);
  if (!outcome) return bad();
  const nameOf = (tribe: string) => (typeof names?.[tribe] === "string" ? names[tribe].slice(0, 80) : "A leader");
  return { ok: true, message: unlockSummary(outcome, welcome === true), lines: skippedLines(outcome, nameOf).slice(0, 50) };
}

/** The same, for every leader a bulk run appointed. */
export async function unlockRunAction(runId: string, communityToo: boolean, welcome: boolean): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = await run(
    "god_unlock_goal_run",
    { p_run: runId, p_community: communityToo === true, p_welcome: welcome === true, p_version: welcome === true ? WELCOME_WORDING_VERSION : null },
    PAGES,
  );
  if (!done.ok) return done;
  const outcome = parseUnlockOutcome(done.data);
  if (!outcome) return bad();
  return { ok: true, message: unlockSummary(outcome, welcome === true), lines: skippedLines(outcome, () => "A leader").slice(0, 50) };
}

/** Puts the lock back. What the leaders picked stays. */
export async function lockGoalAction(tribes: string[]): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const ids = tribeIds(tribes);
  if (!ids) return { ok: false, message: `Choose between 1 and ${MAX_TRIBES} leaders.` };
  const done = await run("god_lock_goal", { p_tribes: ids }, PAGES);
  if (!done.ok) return done;
  const outcome = parseLockOutcome(done.data);
  return outcome ? { ok: true, message: lockSummary(outcome), lines: [] } : bad();
}

/** Sends the welcome email on its own. Each version goes once to a tribe; `again` sends it again. */
export async function welcomeSendAction(tribes: string[], again: boolean): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const ids = tribeIds(tribes);
  if (!ids) return { ok: false, message: `Choose between 1 and ${MAX_TRIBES} leaders.` };
  const done = await run("god_welcome_send", { p_tribes: ids, p_version: WELCOME_WORDING_VERSION, p_again: again === true }, PAGES);
  if (!done.ok) return done;
  const outcome = parseSendOutcome(done.data);
  return outcome ? { ok: true, message: sendSummary(outcome), lines: [] } : bad();
}

/** Saves the two lines under the email. A change takes the approval away. */
export async function welcomeSaveAction(name: string, title: string): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (typeof name !== "string" || typeof title !== "string") return bad();
  const done = await run<{ changed?: boolean }>("god_welcome_settings_save", { p_name: name.slice(0, 200), p_title: title.slice(0, 200) }, PAGES);
  if (!done.ok) return done;
  return {
    ok: true,
    message: done.data?.changed ? "Saved. The approval is taken away, so approve the wording again before sending." : "Nothing changed.",
    lines: [],
  };
}

/** The pastor has read this version of the wording, with this name under it. */
export async function welcomeApproveAction(): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const done = await run("god_welcome_approve", { p_version: WELCOME_WORDING_VERSION }, PAGES);
  return done.ok ? { ok: true, message: "Approved. The welcome email can now be sent.", lines: [] } : done;
}

export async function welcomeWithdrawAction(): Promise<Said> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const done = await run("god_welcome_withdraw", undefined, PAGES);
  return done.ok ? { ok: true, message: "Approval taken away. No welcome email will go until it is approved again.", lines: [] } : done;
}
