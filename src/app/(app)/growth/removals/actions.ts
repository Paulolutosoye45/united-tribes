"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/growth/removals", "/lead/tribe", "/growth"];

/** A person with the right to decide approves, declines, or asks the leader a question, always with a note. The database checks who may decide which. */
export async function decideRemovalAction(request: string, decision: string, note: string): Promise<Result> {
  if (!isUuid(request) || !["approve", "decline", "ask"].includes(decision)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_decide", { p_req: request, p_decision: decision, p_note: text(note, 600) }, PAGES));
}

/** The coach of the tribe says what they would do with an ordinary request. It decides nothing; the person deciding reads it first. */
export async function recommendRemovalAction(request: string, decision: string, note: string): Promise<Result> {
  if (!isUuid(request) || !["approve", "decline", "ask"].includes(decision)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_recommend", { p_req: request, p_decision: decision, p_note: text(note, 600) }, PAGES));
}

/** Puts a member's place back (the Care Lead, a director, an admin, or whoever approved it). */
export async function reinstateRemovalAction(request: string, note: string): Promise<Result> {
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_reinstate", { p_req: request, p_note: text(note, 600) }, PAGES));
}

/** Keeps the decision after a member asked for it to be looked at again. */
export async function upholdRemovalAction(request: string, note: string): Promise<Result> {
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("removal_appeal_uphold", { p_req: request, p_note: text(note, 600) }, PAGES));
}
