"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** The member whose place changed asks the Care Lead to look again (once, within 14 days). The note is optional. */
export async function appealRemovalAction(request: string, note: string): Promise<Result> {
  if (!isUuid(request)) return { ok: false, message: TRY_AGAIN };
  const body = text(note, 600).trim();
  return plain(await run("removal_appeal", { p_req: request, p_note: body === "" ? null : body }, ["/home", "/growth/removals"]));
}
