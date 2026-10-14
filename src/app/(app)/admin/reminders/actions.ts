"use server";

import { run, plain, type Done, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import type { ReminderSettings, VersionRow } from "@/lib/outreach/types";

const PAGES = ["/admin/reminders", "/admin"];
const KEYS = ["member_form", "leader_application", "no_tribe", "in_tribe"];

export async function setJourneyModeAction(key: string, mode: string): Promise<Result> {
  if (!KEYS.includes(key) || !["off", "rehearsal", "on"].includes(mode)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("journey_set_mode", { p_key: key, p_mode: mode }, [...PAGES, `/admin/reminders/${key}`]));
}

/** The master switch: off, and nothing automatic is started or sent, whatever each journey says. */
export async function setMasterAction(on: boolean): Promise<Result> {
  if (typeof on !== "boolean") return { ok: false, message: TRY_AGAIN };
  return plain(await run("reminders_master", { p_on: on }, PAGES));
}

export async function setDaysAction(key: string, days: number[]): Promise<Result> {
  if (!KEYS.includes(key) || !Array.isArray(days) || days.length !== 4 || !days.every((d) => Number.isInteger(d))) return { ok: false, message: TRY_AGAIN };
  return plain(await run("journey_set_days", { p_key: key, p_days: days }, [...PAGES, `/admin/reminders/${key}`]));
}

const SETTING_KEYS: (keyof ReminderSettings)[] = [
  "holdout_pct", "applications_close_on", "joining_closes_days", "cap_gap_days", "cap_reminders_week", "cap_nonessential_week",
  "bulk_per_minute", "approval_threshold", "church_name", "church_address",
];

/** The numbers, hours and church details. The database checks every range and says in words which one is outside it. */
export async function saveSettingsAction(changes: Partial<ReminderSettings>): Promise<Result> {
  if (!changes || typeof changes !== "object") return { ok: false, message: TRY_AGAIN };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    if (!(SETTING_KEYS as string[]).includes(k)) return { ok: false, message: TRY_AGAIN };
    clean[k] = typeof v === "string" ? v.slice(0, 200) : v;
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." };
  return plain(await run("reminder_settings_save", { p_fields: clean }, PAGES));
}

/** Changes the wording of one email. A pastor’s change goes live at once; anyone else’s waits for a pastor. */
export async function editEmailAction(id: string, subject: string, paragraphs: string[], button: string | null, key: string): Promise<Done<string>> {
  if (!isUuid(id) || !Array.isArray(paragraphs)) return { ok: false, message: TRY_AGAIN };
  return run<string>(
    "journey_email_edit",
    { p_id: id, p_subject: String(subject ?? "").slice(0, 160), p_paragraphs: paragraphs.map((p) => String(p).slice(0, 1200)).slice(0, 6), p_button: button ? String(button).slice(0, 40) : null },
    [...PAGES, `/admin/reminders/${key}`],
  );
}

export async function approveEmailAction(id: string, key: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("journey_email_approve", { p_id: id }, [...PAGES, `/admin/reminders/${key}`]));
}

export async function discardEmailAction(id: string, key: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("journey_email_discard", { p_id: id }, [...PAGES, `/admin/reminders/${key}`]));
}

export async function emailHistoryAction(id: string): Promise<Done<VersionRow[]>> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  const done = await run<VersionRow[] | null>("journey_email_history", { p_id: id });
  return done.ok ? { ok: true, data: Array.isArray(done.data) ? done.data : [] } : done;
}
