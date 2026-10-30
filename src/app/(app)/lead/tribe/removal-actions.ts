"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";
import { REASONS } from "@/lib/removal/removal";

const PAGES = ["/lead/tribe", "/growth/removals"];

/** A leader asks the church about a member's place in their tribe. The database checks who they are, the reason, the note and the word that they have spoken. */
export async function askRemovalAction(tribe: string, member: string, reason: string, note: string, spoken: boolean, urgent: boolean): Promise<Result & { rehearsal?: boolean }> {
  if (!isUuid(tribe) || !isUuid(member) || !REASONS.some((r) => r.id === reason)) return { ok: false, message: TRY_AGAIN };
  const done = await run<{ rehearsal?: boolean }>("removal_ask", { p_tribe: tribe, p_member: member, p_reason: reason, p_note: text(note, 600), p_spoken: spoken === true, p_urgent: urgent === true }, PAGES);
  return done.ok ? { ok: true, rehearsal: done.data?.rehearsal === true } : done;
}

/** The leader's answer to a question the church asked them. */
export async function answerRemovalAction(request: string, body: string): Promise<Result> {
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_answer", { p_req: request, p_body: text(body, 600) }, PAGES));
}

/** The leader takes a request back before it is decided. */
export async function withdrawRemovalAction(request: string): Promise<Result> {
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_withdraw", { p_req: request }, PAGES));
}
