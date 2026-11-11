"use server";

import { run } from "@/lib/admin/rpc";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { checkSummary, parseCheck, parsePreview, type Preview } from "@/lib/god/desk-send";

const PAGES = ["/god/leader-desk"];

/** Every action here refuses anyone who is not the owner and unlocked, before the database is asked anything. The database refuses them again. */
async function ownerOnly(): Promise<boolean> {
  const session = await getSession();
  return session?.god === "open";
}

const NOT_AVAILABLE = { ok: false as const, message: "That page is not available." };
type Fail = { ok: false; message: string };
const bad = (): Fail => ({ ok: false, message: TRY_AGAIN });

/** What "Email a proposed group" would send to this member: the best tribe for them and why. Sends nothing. */
export async function previewProposalAction(person: string): Promise<{ ok: true; preview: Preview } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person)) return bad();
  const done = await run("desk_propose_preview", { p_person: person }, []);
  if (!done.ok) return done;
  const preview = parsePreview(done.data);
  return preview ? { ok: true, preview } : bad();
}

/** Emails one waiting member one open tribe (or, in Rehearsal, only writes it down). The database checks every rule again at this moment. */
export async function sendProposalAction(person: string, tribe: string): Promise<{ ok: true; sent: boolean } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(person) || !isUuid(tribe)) return bad();
  const done = await run<{ status?: string }>("desk_propose_tribe", { p_person: person, p_tribe: tribe }, PAGES);
  if (!done.ok) return done;
  return { ok: true, sent: done.data?.status === "sent" };
}

/** Asks the members of a draft group whether they are interested (or, in Rehearsal, only writes it down). Gives back a sentence saying what happened. */
export async function interestCheckAction(group: string): Promise<{ ok: true; summary: string } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(group)) return bad();
  const done = await run("desk_interest_check", { p_group: group }, PAGES);
  if (!done.ok) return done;
  const result = parseCheck(done.data);
  return result ? { ok: true, summary: checkSummary(result) } : bad();
}

/** Withdraws an email that has not been answered. */
export async function cancelProposalAction(id: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!isUuid(id)) return bad();
  const done = await run("desk_proposal_cancel", { p_id: id }, PAGES);
  return done.ok ? { ok: true } : done;
}

export type SettingsInput = { daily: number; gap: number; season: number; hours: number; reason: string };

/** Saves the Desk's limits, with the reason. The database checks the ranges again and says in words what is wrong. */
export async function saveSettingsAction(input: SettingsInput): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (!input || typeof input !== "object") return bad();
  for (const k of ["daily", "gap", "season", "hours"] as const) if (typeof input[k] !== "number" || !Number.isInteger(input[k])) return { ok: false, message: "Use whole numbers." };
  if (typeof input.reason !== "string" || input.reason.length > 600) return bad();
  const done = await run("desk_settings_set", { p_daily: input.daily, p_gap: input.gap, p_season: input.season, p_hours: input.hours, p_reason: input.reason }, PAGES);
  return done.ok ? { ok: true } : done;
}

/** Turns WhatsApp on or off for the Desk, with the reason. Off sends anything waiting back to email. The database checks the reason again. */
export async function whatsappSwitchAction(on: boolean, reason: string): Promise<{ ok: true } | Fail> {
  if (!(await ownerOnly())) return NOT_AVAILABLE;
  if (typeof on !== "boolean" || typeof reason !== "string" || reason.length > 600) return bad();
  const done = await run("desk_whatsapp_set", { p_on: on, p_reason: reason }, PAGES);
  return done.ok ? { ok: true } : done;
}
