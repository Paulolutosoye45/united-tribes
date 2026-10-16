"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";
import { BREAKER_LIMITS, LIMITS } from "@/lib/signin/admin";

const PAGES = ["/admin/signin", "/admin"];
const NUMBER_KEYS = new Set<string>([...LIMITS, ...BREAKER_LIMITS].map((l) => l.key));

/** The kill switch. Off: no WhatsApp codes at all, straight away. Email is never affected. */
export async function setSigninSwitchAction(on: boolean): Promise<Result> {
  if (typeof on !== "boolean") return { ok: false, message: TRY_AGAIN };
  return plain(await run("signin_admin_update", { p_changes: { whatsapp_on: on } }, PAGES));
}

/** Reply first, or send at once (the ordinary number only). */
export async function setSigninModeAction(mode: string): Promise<Result> {
  if (mode !== "normal" && mode !== "reply_first") return { ok: false, message: TRY_AGAIN };
  return plain(await run("signin_admin_update", { p_changes: { mode } }, PAGES));
}

/** The limits and the breaker's thresholds. The database checks every range and says in words which one is outside it. */
export async function setSigninLimitsAction(changes: Record<string, unknown>): Promise<Result> {
  if (!changes || typeof changes !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!NUMBER_KEYS.has(key) || typeof value !== "number" || !Number.isInteger(value)) return { ok: false, message: TRY_AGAIN };
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." };
  return plain(await run("signin_admin_update", { p_changes: clean }, PAGES));
}

/** Starts WhatsApp again after the breaker paused it. Only a person can, and the note is kept with their name. */
export async function resetSigninBreakerAction(note: string): Promise<Result> {
  const clean = typeof note === "string" ? note.trim().slice(0, 200) : "";
  return plain(await run("signin_admin_reset", { p_note: clean || null }, PAGES));
}
