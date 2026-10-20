"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";
import { SWITCH_IDS, type SwitchId } from "@/lib/leaders/pipeline";

const PAGES = ["/admin/leader-pipeline", "/admin", "/home", "/lead", "/lead/apply", "/lead/academy", "/lead/academy/declaration", "/lead/tribe", "/review", "/review/academy", "/review/cards"];
const VALUES = new Set(["required", "optional", "off", "on"]);

export type PipelineResult = { ok: true; note?: string; changed: number } | { ok: false; message: string };

/**
 * Moves one or more switches. The database checks who is asking, that every switch and value exists, and that Find your tribe
 * is ready if it is being turned on; it says in words what is wrong.
 */
export async function setPipelineAction(changes: Partial<Record<SwitchId, string>>, reason: string): Promise<PipelineResult> {
  if (!changes || typeof changes !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!(SWITCH_IDS as readonly string[]).includes(key) || typeof value !== "string" || !VALUES.has(value)) return { ok: false, message: TRY_AGAIN };
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." };
  const why = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  const done = (await run("leader_pipeline_set", { p_changes: clean, p_reason: why || null }, PAGES)) as Done<{ changed?: number } | null>;
  if (!done.ok) return done;
  return { ok: true, changed: typeof done.data?.changed === "number" ? done.data.changed : 0 };
}

/** Sets every switch to one of the two presets. The reply says if Find your tribe had to stay off. */
export async function applyPresetAction(preset: string): Promise<PipelineResult> {
  if (preset !== "full" && preset !== "open_door") return { ok: false, message: TRY_AGAIN };
  const done = (await run("leader_pipeline_preset", { p_preset: preset }, PAGES)) as Done<{ changed?: number; note?: string | null } | null>;
  if (!done.ok) return done;
  return {
    ok: true,
    changed: typeof done.data?.changed === "number" ? done.data.changed : 0,
    note: typeof done.data?.note === "string" && done.data.note ? done.data.note : undefined,
  };
}
