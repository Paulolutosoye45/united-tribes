"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { parseItems, parseOneCheck, parseOptions, parseRunView, type OneCheck, type RunItem, type RunView, type TribeOption } from "@/lib/placement/types";

const PAGES = ["/god/placement", "/god"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

const SETTING_KEYS = ["mode", "grace_days", "seats_free", "min_tribe", "pace_per_hour", "send_from", "send_until", "hold_hours", "reminder_days", "hold_group_link"] as const;

/** Saves the switch and the church's choices. Only the fields named are sent; the database checks each. */
export async function saveSettingsAction(changes: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return bad();
  const clean: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in changes)) continue;
    const v = (changes as Record<string, unknown>)[key];
    if (key === "mode") {
      if (v !== "off" && v !== "rehearsal" && v !== "on") return { ok: false, message: "Choose Off, Rehearsal or On." };
      clean.mode = v;
    } else if (key === "hold_group_link") {
      if (typeof v !== "boolean") return { ok: false, message: "Choose On or Off." };
      clean.hold_group_link = v;
    } else {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9999) return { ok: false, message: "Use whole numbers." };
      clean[key] = v;
    }
  }
  if (Object.keys(clean).length === 0) return bad();
  const done = await run("placement_settings_save", { p_changes: clean }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Starts a plan. `scope` narrows it to one community or area, for a first small run. */
export async function newRunAction(options: { community?: string; zone?: string; pace?: number; afterCutoff?: boolean }): Promise<{ ok: true; run: string } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const o: Record<string, unknown> = {};
  if (options?.community) {
    if (!isUuid(options.community)) return bad();
    o.community = options.community;
  }
  if (options?.zone) {
    if (typeof options.zone !== "string" || options.zone.length > 40) return bad();
    o.zone = options.zone;
  }
  if (options?.pace !== undefined && options.pace !== null) {
    if (typeof options.pace !== "number" || !Number.isInteger(options.pace) || options.pace < 1 || options.pace > 1000) return { ok: false, message: "Use a whole number for the pace." };
    o.pace_per_hour = options.pace;
  }
  // Placing after joining has closed is a choice the owner makes on purpose, so it is only ever sent when it was ticked
  if (options?.afterCutoff === true) o.after_cutoff = true;
  const done = (await run("placement_run_new", { p_options: o }, PAGES)) as Done<{ run?: string } | null>;
  if (!done.ok) return done;
  const id = done.data?.run;
  return isUuid(id) ? { ok: true, run: id } : bad();
}

export type StepResult = { ok: true; status: string; phase: string; pool: number; scored: number; assigned: number } | Fail;

/** Plans the next batch. The page calls this again until the plan says it is ready. */
export async function stepRunAction(runId: string): Promise<StepResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = (await run("placement_run_step", { p_run: runId })) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { ok: true, status: String(d.status ?? ""), phase: String(d.phase ?? ""), pool: n(d.pool), scored: n(d.scored), assigned: n(d.assigned) };
}

export async function viewRunAction(runId: string): Promise<{ ok: true; view: RunView } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = await run("placement_run_view", { p_run: runId });
  if (!done.ok) return done;
  const view = parseRunView(done.data);
  return view ? { ok: true, view } : bad();
}

export async function itemsAction(runId: string, status: string | null, offset: number): Promise<{ ok: true; total: number; items: RunItem[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || (status !== null && (typeof status !== "string" || !/^[a-z_]{1,20}$/.test(status)))) return bad();
  const off = Number.isInteger(offset) && offset >= 0 && offset < 1_000_000 ? offset : 0;
  const done = await run("placement_run_items", { p_run: runId, p_status: status, p_limit: 50, p_offset: off });
  return done.ok ? { ok: true, ...parseItems(done.data) } : done;
}

export async function optionsAction(runId: string, person: string): Promise<{ ok: true; options: TribeOption[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(person)) return bad();
  const done = await run("placement_options", { p_run: runId, p_person: person });
  return done.ok ? { ok: true, options: parseOptions(done.data) } : done;
}

/** Moves a member to another tribe in the plan, takes them out of it, or sets them aside. Only before the plan is approved. */
export async function adjustAction(runId: string, person: string, action: "move" | "remove" | "hold", tribe: string | null): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(person) || !["move", "remove", "hold"].includes(action)) return bad();
  if (action === "move" && !isUuid(tribe)) return bad();
  const done = await run("placement_adjust", { p_run: runId, p_person: person, p_action: action, p_tribe: action === "move" ? tribe : null }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function resolveSmallAction(runId: string, tribe: string, action: "keep" | "hold" | "retry"): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(tribe) || !["keep", "hold", "retry"].includes(action)) return bad();
  const done = await run("placement_resolve_small", { p_run: runId, p_tribe: tribe, p_action: action }, PAGES);
  return done.ok ? { ok: true } : done;
}

export async function cancelRunAction(runId: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = await run("placement_run_cancel", { p_run: runId }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** `expected` is the number of members on the page you read, so a plan that changed under you is refused. */
export async function approveRunAction(runId: string, expected: number): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !Number.isInteger(expected) || expected < 0) return bad();
  const done = await run("placement_run_approve", { p_run: runId, p_expected: expected }, PAGES);
  return done.ok ? { ok: true } : done;
}

export type PlaceResult = { ok: true; status: string; done: number; skipped: number; left: number } | Fail;

/** Places the next batch. The page keeps pressing it until nothing is left; the heartbeat finishes the job if the page is closed. */
export async function placeRunAction(runId: string): Promise<PlaceResult> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = (await run("placement_run_place", { p_run: runId }, PAGES)) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { ok: true, status: String(d.status ?? ""), done: n(d.done), skipped: n(d.skipped), left: n(d.left) };
}

export async function undoRunAction(runId: string): Promise<{ ok: true; released: number; keptConfirmed: number; keptTold: number } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = (await run("placement_undo", { p_run: runId }, PAGES)) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { ok: true, released: n(d.released), keptConfirmed: n(d.kept_confirmed), keptTold: n(d.kept_leader_told) };
}

export async function holdClearAction(person: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person)) return bad();
  const done = await run("placement_hold_clear", { p_person: person }, PAGES);
  return done.ok ? { ok: true } : done;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/**
 * Opens one tribe's details to its leader now, and emails the leader their team. Members who said "don't share my details" stay withheld.
 * `shared` is how many members who had not answered had their email and WhatsApp number given to the leader; `already` means the leader
 * had been told before.
 */
export async function openNowAction(runId: string, tribe: string): Promise<{ ok: true; shared: number; already: boolean } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId) || !isUuid(tribe)) return bad();
  const done = (await run("placement_open_now", { p_run: runId, p_tribe: tribe }, PAGES)) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  return { ok: true, shared: count(d.shared), already: d.already === true };
}

/** The same for every tribe of the run whose team is fully placed and whose leader has not been told. */
export async function openAllAction(runId: string): Promise<{ ok: true; tribes: number; shared: number } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(runId)) return bad();
  const done = (await run("placement_open_all", { p_run: runId }, PAGES)) as Done<Record<string, unknown> | null>;
  if (!done.ok) return done;
  const d = done.data ?? {};
  return { ok: true, tribes: count(d.tribes), shared: count(d.shared) };
}


/** Asks the database what would stop placing this person in this tribe, and what would need a reason. Changes nothing. */
export async function placeOneCheckAction(person: string, tribe: string): Promise<{ ok: true; check: OneCheck } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || !isUuid(tribe)) return bad();
  const done = (await run("placement_one_check", { p_person: person, p_tribe: tribe })) as Done<unknown>;
  if (!done.ok) return done;
  const check = parseOneCheck(done.data);
  return check ? { ok: true, check } : bad();
}

/** Places one person. Every warning the check gave must be ticked (sent as `accept`) and explained; the database checks it all again. */
export async function placeOneAction(input: {
  person: string;
  tribe: string;
  accept: string[];
  reason: string;
  agreed: boolean;
}): Promise<{ ok: true; run: string } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || !isUuid(input.person) || !isUuid(input.tribe)) return bad();
  if (!Array.isArray(input.accept) || input.accept.length > 20 || input.accept.some((c) => typeof c !== "string" || !/^[a-z_]{2,30}$/.test(c))) return bad();
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length > 200) return { ok: false, message: "Keep the reason under 200 characters." };
  const done = (await run(
    "placement_one_place",
    { p_person: input.person, p_tribe: input.tribe, p_accept: input.accept, p_reason: reason || null, p_agreed: input.agreed === true },
    [...PAGES, `/god/people/${input.person}`],
  )) as Done<{ run?: string } | null>;
  if (!done.ok) return done;
  const id = done.data?.run;
  return isUuid(id) ? { ok: true, run: id } : bad();
}
