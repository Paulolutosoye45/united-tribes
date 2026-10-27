"use server";

import { run } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** A pastor decides a change to a leader's stage of life. The database lets only a pastor of the person's centre do this, and says why when it cannot. */
export async function decideStageAction(id: string, approve: boolean, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isUuid(id) || typeof approve !== "boolean") return { ok: false, message: TRY_AGAIN };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";
  const done = await run("stage_review_decide", { p_id: id, p_approve: approve, p_note: text || null }, ["/review/stages", "/review/cards", "/lead", "/my"]);
  return done.ok ? { ok: true } : done;
}
