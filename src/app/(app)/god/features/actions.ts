"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { isFeatureKey, isPosition, isScope, parseFound } from "@/lib/features/parse";
import { isPromptKind } from "@/lib/prompt/prompt";
import { ROLE_FILTERS } from "@/lib/features/wording";
import type { Found } from "@/lib/features/types";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/god/features"];

/**
 * Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything, and the database
 * refuses again (every function behind them begins god_only()). Nobody else can move any switch of Profiles and the Weekly Rhythm:
 * not an admin, not a director, not a pastor.
 */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

const reasonOf = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 300) : null);
const dayOf = (v: unknown): string | null | undefined => (v === null || v === undefined || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export type SetInput = { feature: string; scope: string; scopeId: string | null; position: string; roles?: string[]; reason?: string; holdoutUntil?: string | null };

/** Moves one function at one place. The database says why when it cannot (a function that is not built yet, one that needs another open first). */
export async function featureSetAction(input: SetInput): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || !isFeatureKey(input.feature) || !isScope(input.scope) || !isPosition(input.position)) return bad();
  if ((input.scope === "platform") !== (input.scopeId === null)) return bad();
  if (input.scopeId !== null && !isUuid(input.scopeId)) return bad();
  const roles = input.roles ?? [];
  if (!Array.isArray(roles) || roles.length > 12 || !roles.every((r) => (ROLE_FILTERS as readonly string[]).includes(r))) return bad();
  const holdout = dayOf(input.holdoutUntil);
  if (holdout === undefined) return { ok: false, message: "Give the day as year, month and day." };
  const done = await run(
    "god_feature_set",
    { p_feature: input.feature, p_scope: input.scope, p_scope_id: input.scopeId, p_position: input.position, p_roles: roles, p_reason: reasonOf(input.reason), p_holdout_until: holdout },
    PAGES,
  );
  return done.ok ? { ok: true } : done;
}

/** Takes one rule away, so the function goes back to what the wider rule (or its own start) says. */
export async function featureRemoveAction(rule: string, reason?: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(rule)) return bad();
  const done = await run("god_feature_remove", { p_rule: rule, p_reason: reasonOf(reason) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** The Master pause: every new function acts as Off at once, and one more press puts everything back. */
export async function masterAction(paused: boolean, reason?: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (typeof paused !== "boolean") return bad();
  const done = await run("god_feature_master", { p_paused: paused, p_reason: reasonOf(reason) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Finds the centre, community, tribe or person a rule is for. */
export async function featureFindAction(scope: string, query: string): Promise<{ ok: true; found: Found[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isScope(scope) || scope === "platform") return bad();
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  const done = (await run("god_feature_find", { p_scope: scope, p_q: q })) as Done;
  return done.ok ? { ok: true, found: parseFound(done.data) } : done;
}

/** The contact series settings: the leader's first go, the length of the series, and the notes a tribe may send a week. */
export async function reachSettingsAction(input: { firstGo: number; release: number; endMode: string; notes: number; reason: string }): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || !whole(input.firstGo) || !whole(input.release) || !whole(input.notes) || !["silent", "everyone", "list"].includes(input.endMode)) return bad();
  const done = await run(
    "god_reach_settings_set",
    { p_first_go: input.firstGo, p_release: input.release, p_end_mode: input.endMode, p_note_per_week: input.notes, p_reason: reasonOf(input.reason) },
    PAGES,
  );
  return done.ok ? { ok: true } : done;
}

/** The placed nudge's three numbers: hours before the first nudge, days between nudges, and the most for one seat. */
export async function placedNudgeSettingsAction(input: { firstAfter: number; spacing: number; max: number; reason: string }): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || !whole(input.firstAfter) || !whole(input.spacing) || !whole(input.max)) return bad();
  const done = await run("god_placed_nudge_settings_set", { p_first_after: input.firstAfter, p_spacing: input.spacing, p_max: input.max, p_reason: reasonOf(input.reason) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** The placed answer sequence's numbers: when the second email goes, how often "Still held" goes, when "Last call" goes, the pace, the most emails and phone tries, and whether the call desk may be downloaded with numbers. */
export async function placedAnswersSettingsAction(input: {
  secondAfter: number; step3Days: number; lastCall: number; pace: number; max: number; tries: number; download: boolean; reason: string;
}): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || ![input.secondAfter, input.step3Days, input.lastCall, input.pace, input.max, input.tries].every(whole) || typeof input.download !== "boolean") return bad();
  const done = await run(
    "god_placed_answers_settings_set",
    {
      p_second_after: input.secondAfter, p_step3_days: input.step3Days, p_last_call: input.lastCall, p_pace: input.pace, p_max: input.max, p_tries: input.tries,
      p_download: input.download, p_reason: reasonOf(input.reason),
    },
    [...PAGES, "/admin/placed", "/admin/placed/desk"],
  );
  return done.ok ? { ok: true } : done;
}

/** The seat window's numbers: the window, when the reminder and the last call go, the days to take a seat back, offers in a row, the day's limit and the bar. Optionally counts seats placed in the last few days too. */
export async function seatSettingsAction(input: {
  window: number; remind: number; lastCall: number; takeBack: number; offers: number; dayCap: number; bar: number; includeDays: number | null; reason: string;
}): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || ![input.window, input.remind, input.lastCall, input.takeBack, input.offers, input.dayCap, input.bar].every(whole) || (input.includeDays !== null && !whole(input.includeDays))) return bad();
  const done = await run(
    "god_seat_settings_set",
    {
      p_window: input.window, p_remind: input.remind, p_last_call: input.lastCall, p_take_back: input.takeBack, p_offers: input.offers, p_day_cap: input.dayCap, p_bar: input.bar,
      p_include_days: input.includeDays, p_reason: reasonOf(input.reason),
    },
    [...PAGES, "/admin/seats"],
  );
  return done.ok ? { ok: true } : done;
}

/** The autopilot's numbers: Suggest or Auto, the bar, new members to one tribe in a day, placements in a day, the days it keeps placing after joining closes, and when a tribe is called small. */
export async function autopilotSettingsAction(input: {
  mode: string; bar: number; perTribe: number; dayCap: number; extra: number; small: number; reason: string;
}): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || (input.mode !== "suggest" && input.mode !== "auto") || ![input.bar, input.perTribe, input.dayCap, input.extra, input.small].every(whole)) return bad();
  const done = await run(
    "god_autopilot_settings_set",
    { p_mode: input.mode, p_bar: input.bar, p_per_tribe: input.perTribe, p_day_cap: input.dayCap, p_extra: input.extra, p_small: input.small, p_reason: reasonOf(input.reason) },
    [...PAGES, "/admin/seats"],
  );
  return done.ok ? { ok: true } : done;
}

/** The sign-in prompt's numbers: hours away that start a new visit, tasks in a visit, hours before release with no Not now, Not nows before a call is worth it, and the kinds turned off. */
export async function promptSettingsAction(input: { visit: number; tasks: number; last: number; worth: number; kindsOff: string[]; reason: string }): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  if (!input || ![input.visit, input.tasks, input.last, input.worth].every(whole) || !Array.isArray(input.kindsOff) || input.kindsOff.length > 20 || !input.kindsOff.every(isPromptKind)) return bad();
  const done = await run(
    "god_prompt_settings_set",
    { p_visit_hours: input.visit, p_max_tasks: input.tasks, p_last_hours: input.last, p_worth: input.worth, p_kinds_off: input.kindsOff, p_reason: reasonOf(input.reason) },
    [...PAGES, "/admin/placed"],
  );
  return done.ok ? { ok: true } : done;
}
