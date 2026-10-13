"use server";

import { plain, run, type Done, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";
import { SETTING_INFO } from "@/lib/leaders/quality/admin";

const PAGES = ["/admin/leader-quality", "/admin", "/review"];
const NUMBER_KEYS = new Set<string>(SETTING_INFO.map((s) => s.key));

/** Off, recording only, or on. Switching on or to recording takes in the applications already waiting, and says how many. */
export async function setLeaderModeAction(mode: string): Promise<Result & { queued?: number }> {
  if (mode !== "off" && mode !== "shadow" && mode !== "on") return { ok: false, message: TRY_AGAIN };
  const done = (await run("leader_ai_set_mode", { p_mode: mode }, PAGES)) as Done<{ queued?: number } | null>;
  if (!done.ok) return done;
  return { ok: true, queued: typeof done.data?.queued === "number" ? done.data.queued : 0 };
}

/** The thresholds. The database checks every range and says in words which one is outside it. */
export async function setLeaderSettingsAction(changes: Record<string, unknown>): Promise<Result> {
  if (!changes || typeof changes !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (NUMBER_KEYS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, message: TRY_AGAIN };
      clean[key] = value;
    } else if (key === "consent_version") {
      if (typeof value !== "string") return { ok: false, message: TRY_AGAIN };
      clean[key] = value.trim().slice(0, 24);
    } else if (key === "ai_consent_covers_old") {
      if (typeof value !== "boolean") return { ok: false, message: TRY_AGAIN };
      clean[key] = value;
    } else {
      return { ok: false, message: TRY_AGAIN };
    }
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." };
  return plain(await run("leader_ai_set_settings", { p_changes: clean }, PAGES));
}
