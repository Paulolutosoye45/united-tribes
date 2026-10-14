"use server";

import { run, plain, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

export async function closeAskAction(id: string): Promise<Result> {
  if (!isUuid(id)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("ask_close", { p_id: id }, ["/care/asks", "/admin/reminders"]));
}
