"use server";

import { plain, run, text, type Done, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { STANDINGS } from "@/lib/leaders/referee/labels";

const PAGES = ["/admin/referees", "/admin", "/review"];

export type PersonFields = { name: string; standing: string; unit: string; note: string; contacts: string[] };

/** Adds one person to the church's list, or changes one. The database reads each contact and says which one it cannot. */
export async function savePersonAction(id: string | null, fields: PersonFields): Promise<Result> {
  if (id !== null && !isUuid(id)) return { ok: false, message: TRY_AGAIN };
  if (!fields || typeof fields !== "object" || !(STANDINGS as readonly string[]).includes(fields.standing)) return { ok: false, message: "Choose Pastor, Unit head or Ministry leader." };
  const contacts = Array.isArray(fields.contacts) ? fields.contacts.map((c) => text(c, 160).trim()).filter(Boolean).slice(0, 12) : [];
  const clean = { name: text(fields.name, 120), standing: fields.standing, unit: text(fields.unit, 120), note: text(fields.note, 300), contacts };
  return plain(await run("referee_directory_save", { p_id: id, p_fields: clean }, PAGES));
}

/** Takes a person off the list, or puts them back. Nobody is deleted, so what was proved about them stays proved. */
export async function setPersonActiveAction(id: string, active: boolean): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("referee_directory_set_active", { p_id: id, p_active: active === true }, PAGES));
}

/** Removes a person who was added by mistake. To stop counting someone who has left, take them off the list instead: that keeps the record. */
export async function deletePersonAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("referee_directory_delete", { p_id: id }, PAGES));
}

/** What counts as a pastor or unit head, how many references get a call-back, and how fast is too fast. */
export async function saveSettingsAction(changes: { gate_standings?: string[]; callback_pct?: number; min_seconds?: number }): Promise<Result> {
  const clean: Record<string, unknown> = {};
  if (changes?.gate_standings !== undefined) {
    if (!Array.isArray(changes.gate_standings)) return { ok: false, message: TRY_AGAIN };
    clean.gate_standings = changes.gate_standings.filter((s) => (STANDINGS as readonly string[]).includes(s));
  }
  for (const key of ["callback_pct", "min_seconds"] as const) {
    const v = changes?.[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, message: TRY_AGAIN };
    clean[key] = Math.round(v);
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to change." };
  return plain(await run("referee_settings_save", { p_changes: clean }, PAGES));
}

/** Asks one referee, who answered before referees were checked, to confirm the reference was theirs. */
export async function askToConfirmAction(referenceId: string): Promise<Result & { note?: string }> {
  if (!isUuid(referenceId)) return { ok: false, message: TRY_AGAIN };
  const done = (await run("referee_reverify_send", { p_reference: referenceId }, PAGES)) as Done<{ ok?: boolean; reason?: string } | null>;
  if (!done.ok) return done;
  if (done.data?.ok === false) {
    const why: Record<string, string> = {
      "not needed": "That reference doesn’t need confirming.",
      closed: "That application is closed.",
      "no contact": "We have no phone number or email we can read for that referee.",
      recent: "We asked them in the last three days. Give them a little longer.",
    };
    return { ok: false, message: why[String(done.data.reason)] ?? TRY_AGAIN };
  }
  return { ok: true };
}

/** Asks every referee who still needs to confirm. Says how many were asked and how many were left out. */
export async function askAllToConfirmAction(): Promise<Result & { sent?: number; skipped?: number }> {
  const done = (await run("referee_reverify_all", undefined, PAGES)) as Done<{ sent?: number; skipped?: number } | null>;
  if (!done.ok) return done;
  return { ok: true, sent: Number(done.data?.sent ?? 0), skipped: Number(done.data?.skipped ?? 0) };
}
