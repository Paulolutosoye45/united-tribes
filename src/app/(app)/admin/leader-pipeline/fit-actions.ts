"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";
import { BAR_KEYS, WEIGHT_KEYS, parseQuiet, quietSentence, type Weights } from "@/lib/leaders/fit-admin";

const PAGES = ["/admin/leader-pipeline", "/admin", "/lead/tribe", "/lead/apply", "/review"];
const VERSION = /^[A-Za-z0-9._-]{1,24}$/;

export type FitModelResult = { ok: true; version?: string; note?: string } | { ok: false; message: string };

/**
 * Saves a new version of the fit model. It is not used until the pastor approves it. Only the numbers that changed are sent; the
 * database starts from the latest version, checks that the five parts add to 100, and names the new version itself.
 */
export async function saveFitModelAction(changed: Partial<Weights>, note: string): Promise<FitModelResult> {
  if (!changed || typeof changed !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(changed)) {
    if (![...WEIGHT_KEYS, ...BAR_KEYS].includes(key as never) || typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) return { ok: false, message: TRY_AGAIN };
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing has changed from the version before it." };
  const why = typeof note === "string" ? note.trim().slice(0, 400) : "";
  const done = (await run("leader_fit_model_save", { p_weights: clean, p_notes: why || null }, PAGES)) as Done<{ version?: string } | null>;
  if (!done.ok) return done;
  return { ok: true, version: typeof done.data?.version === "string" ? done.data.version : undefined };
}

/** The pastor approves a version. From then on it is the one in use, and the one before it is kept for the record. */
export async function approveFitModelAction(version: string): Promise<FitModelResult> {
  if (typeof version !== "string" || !VERSION.test(version)) return { ok: false, message: TRY_AGAIN };
  const done = await run("leader_fit_model_activate", { p_version: version }, PAGES);
  return done.ok ? { ok: true, version } : done;
}

/** Looks at every leader we already have, once for this model, and files the result. Nobody is told, and nothing about them changes. */
export async function runQuietAction(): Promise<FitModelResult> {
  const done = await run("leader_fit_quiet_all", undefined, PAGES);
  if (!done.ok) return done;
  const counts = parseQuiet(done.data);
  if (!counts) return { ok: true };
  return { ok: true, note: quietSentence(counts) };
}
