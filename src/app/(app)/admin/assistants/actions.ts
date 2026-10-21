"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { OVERSIGHT_ROLES, hasAnyRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

const PAGES = ["/admin/assistants", "/admin", "/lead/tribe", "/god/tribes"];

/**
 * Approve or decline an assistant-leader recommendation, or approve it as a replacement for the assistant the tribe has now.
 * The database decides who may: an admin, a director or a pastor, and only a pastor or a director for a tribe with young members.
 */
export async function decideAssistantAction(rec: string, approve: boolean, note: string, replace: boolean): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const session = await getSession();
  if (!session || !(session.god === "open" || hasAnyRole(session.roles, OVERSIGHT_ROLES))) return { ok: false, message: "That page is not available." };
  if (!isUuid(rec) || typeof approve !== "boolean") return { ok: false, message: TRY_AGAIN };
  const why = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const done = (await run("assistant_decide", { p_rec: rec, p_approve: approve, p_note: why || null, p_replace: replace === true }, PAGES)) as Done<{ status?: string } | null>;
  if (!done.ok) return done;
  return { ok: true, status: String(done.data?.status ?? "") };
}
