"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { isRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { isPackId, parseLog } from "@/lib/exports/parse";
import type { LogLine } from "@/lib/exports/types";
import { loadPeople } from "@/lib/god/server";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { createClient } from "@/lib/supabase/server";

const PAGES = ["/god/exports"];

/**
 * Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything, and the database
 * refuses again (every function behind them begins god_only()). Nobody else can move any switch of the exports: not an admin, not
 * a director, not a pastor.
 */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

const POSITIONS = ["off", "rehearsal", "limited", "on"];
const reasonOf = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 300) : null);
const uuids = (v: unknown): string[] | null => (v === undefined ? [] : Array.isArray(v) && v.length <= 400 && v.every(isUuid) ? (v as string[]) : null);

type Limits = { roles: string[]; communities: string[]; tribes: string[] };
function limitsOf(input: { roles?: unknown; communities?: unknown; tribes?: unknown }): Limits | null {
  const roles = input.roles === undefined ? [] : Array.isArray(input.roles) && input.roles.length <= 20 && input.roles.every(isRole) ? (input.roles as string[]) : null;
  const communities = uuids(input.communities);
  const tribes = uuids(input.tribes);
  return roles && communities && tribes ? { roles, communities, tribes } : null;
}

type PackInput = { pack: string; position: string; roles?: string[]; communities?: string[]; tribes?: string[]; reason?: string };

/** Moves one pack. Opening it beyond the testers needs a reason; a People pack must have been in Rehearsal and the impact assessment recorded. */
export async function packSetAction(input: PackInput): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || !isPackId(input.pack) || !POSITIONS.includes(input.position)) return bad();
  const limits = limitsOf(input);
  if (!limits) return bad();
  const done = await run("export_pack_set", { p_pack: input.pack, p_position: input.position, p_limits: limits, p_reason: reasonOf(input.reason) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** How many people a position would reach, so the owner sees the number before saving. */
export async function packPreviewAction(input: PackInput): Promise<{ ok: true; people: number } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || !isPackId(input.pack) || !POSITIONS.includes(input.position)) return bad();
  const limits = limitsOf(input);
  if (!limits) return bad();
  const done = (await run("export_pack_preview", { p_pack: input.pack, p_position: input.position, p_limits: limits })) as Done<{ people?: unknown } | null>;
  if (!done.ok) return done;
  const n = done.data?.people;
  return typeof n === "number" && Number.isFinite(n) ? { ok: true, people: n } : bad();
}

const LISTS: Record<string, readonly string[]> = {
  formats: ["xlsx", "csv", "pdf"],
  deliveries: ["download"],
  doors: ["open_data_pack", "standing_link"],
};

/** The church-wide switches. Only the settings named are sent, each checked here and again by the database. */
export async function settingsSaveAction(changes: Record<string, unknown>, reason?: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return bad();
  const clean: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(changes)) {
    if (key === "paused" || key === "people_stopped") {
      if (typeof v !== "boolean") return bad();
      clean[key] = v;
    } else if (key === "unusual_per_hour") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) return { ok: false, message: "Use a whole number from 1 to 100." };
      clean[key] = v;
    } else if (key in LISTS) {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && LISTS[key].includes(x))) return bad();
      clean[key] = [...new Set(v as string[])];
    } else if (key === "people_cleared_on") {
      if (v !== null && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return { ok: false, message: "Give the day as year, month and day." };
      clean[key] = v;
    } else {
      return bad();
    }
  }
  if (Object.keys(clean).length === 0) return bad();
  const done = await run("export_settings_save", { p_changes: clean, p_reason: reasonOf(reason) }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Adds or removes someone who may make a file while a pack is in Rehearsal. */
export async function testerSetAction(person: string, on: boolean): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || typeof on !== "boolean") return bad();
  const done = await run("export_tester_set", { p_person: person, p_on: on }, PAGES);
  return done.ok ? { ok: true } : done;
}

export type FoundPerson = { id: string; name: string; roles: string[] };

/** Finds people by name or email to add as testers. */
export async function searchPeopleAction(query: string): Promise<{ ok: true; people: FoundPerson[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const q = typeof query === "string" ? query.trim().slice(0, 80) : "";
  if (q.length < 2) return { ok: true, people: [] };
  const found = await loadPeople(await createClient(), q, 8);
  if (!found) return bad();
  return { ok: true, people: found.people.map((p) => ({ id: p.id, name: p.name, roles: (p.roles ?? []).filter((r) => r !== "member") })) };
}

/** The log, from a point on, for one pack or all. Names who made each file, never what was in it. */
export async function logAction(before: string | null, pack: string | null): Promise<{ ok: true; lines: LogLine[] } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (pack !== null && !isPackId(pack)) return bad();
  if (before !== null && (typeof before !== "string" || Number.isNaN(Date.parse(before)))) return bad();
  const done = await run("export_log_list", { p_limit: 40, p_before: before, p_pack: pack });
  return done.ok ? { ok: true, lines: parseLog(done.data) } : done;
}
