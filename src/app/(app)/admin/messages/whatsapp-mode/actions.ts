"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";

const PAGES = ["/admin/messages/whatsapp-mode", "/admin/messages/whatsapp-cost", "/admin/messages"];

/** Chooses Full, Saver or Free, with the reason kept in the log. Only the admin, a director or the data lead (the database checks). */
export async function setWhatsappModeAction(mode: string, reason: string): Promise<Result> {
  if (mode !== "full" && mode !== "saver" && mode !== "free") return { ok: false, message: "Choose Full, Saver or Free." };
  return plain(await run("whatsapp_mode_set", { p_mode: mode, p_reason: reason }, PAGES));
}

export type ModeSettingsInput = {
  ceilingUsd: number | null;
  warnPct: number;
  pacePerHour: number;
  reachPct: number;
  weeklyCap: number;
  windowFrom: number;
  windowTo: number;
  qualityGuard: boolean;
};

/** The numbers: ceiling, warning, pace, reach, weekly cap, sending window and the quality guard. The database checks every one and says what is wrong. */
export async function saveWhatsappSettingsAction(s: ModeSettingsInput): Promise<Result> {
  const whole = (n: number) => Number.isInteger(n);
  if (![s.warnPct, s.pacePerHour, s.reachPct, s.weeklyCap, s.windowFrom, s.windowTo].every(whole)) return { ok: false, message: "Use whole numbers." };
  if (s.ceilingUsd !== null && !(Number.isFinite(s.ceilingUsd) && s.ceilingUsd > 0)) return { ok: false, message: "The ceiling must be more than zero, or empty for none." };
  return plain(await run("whatsapp_mode_settings", { p_settings: s }, PAGES));
}

/** Moves one message type to class A, B or C. */
export async function setMessageClassAction(template: string, cls: string): Promise<Result> {
  if (!/^[a-z0-9_]{2,48}$/.test(template) || (cls !== "A" && cls !== "B" && cls !== "C")) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return plain(await run("whatsapp_class_set", { p_template: template, p_class: cls }, PAGES));
}

/** Enters what Meta charges for a category from a date, from the rate card the church has. These figures are the church's, never taken from Meta. */
export async function addWhatsappRateAction(category: string, usd: number, effectiveOn: string, source: string): Promise<Result> {
  if (category !== "utility" && category !== "marketing") return { ok: false, message: "Choose Utility or Marketing." };
  if (!Number.isFinite(usd) || usd <= 0) return { ok: false, message: "Enter the price in US dollars, such as 0.0101." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) return { ok: false, message: "Choose the date it starts." };
  return plain(await run("whatsapp_rate_add", { p_category: category, p_usd: usd, p_effective: effectiveOn, p_source: source.trim() || null }, PAGES));
}
