"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** The care team records how a call-back went. "Not reached" keeps it open for another try; "not them" disputes the reference. */
export async function closeCallbackAction(id: string, outcome: string, note: string): Promise<Result> {
  if (!isUuid(id) || !["confirmed", "not_reached", "not_them"].includes(outcome)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("referee_callback_close", { p_id: id, p_outcome: outcome, p_note: text(note, 300) || null }, ["/care/referees", "/care", "/admin/referees"]));
}
