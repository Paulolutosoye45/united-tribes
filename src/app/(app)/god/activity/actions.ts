"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

export type SettingState = { status: "idle" | "ok" | "error"; message: string };
const NOT_AVAILABLE: SettingState = { status: "error", message: "That page is not available." };
const PAGES = ["/god/activity", "/god/activity/settings"];

const outcome = (done: Result, saved: string): SettingState => (done.ok ? { status: "ok", message: saved } : { status: "error", message: done.message });

/** Changes when a decision is flagged. The database keeps it between 1 and 365 and writes the change in the owner's record. */
export async function setThresholdAction(_prev: SettingState, formData: FormData): Promise<SettingState> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const key = String(formData.get("key") ?? "");
  const value = Number(String(formData.get("value") ?? "").trim());
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return { status: "error", message: "That flag could not be changed." };
  if (!Number.isFinite(value) || value < 1 || value > 365) return { status: "error", message: "Choose a number between 1 and 365." };
  return outcome(plain(await run("activity_threshold_set", { p_key: key, p_value: value }, PAGES)), "Saved.");
}

/** Switches recording on or off. Off means nothing new is counted; what is already there stays until its time is up. */
export async function setRecordingAction(_prev: SettingState, formData: FormData): Promise<SettingState> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const on = String(formData.get("recording") ?? "") === "on";
  return outcome(plain(await run("activity_settings_set", { p_recording: on, p_retention: null }, PAGES)), on ? "Recording is on." : "Recording is off.");
}

/** How many months the detailed events are kept (3 to 36). Older detail is deleted by the daily clean-up; daily counts stay. */
export async function setRetentionAction(_prev: SettingState, formData: FormData): Promise<SettingState> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  const months = Number(String(formData.get("months") ?? "").trim());
  if (!Number.isInteger(months) || months < 3 || months > 36) return { status: "error", message: "Choose between 3 and 36 months." };
  return outcome(plain(await run("activity_settings_set", { p_recording: null, p_retention: months }, PAGES)), `Detail is kept for ${months} months.`);
}
