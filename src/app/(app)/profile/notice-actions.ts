"use server";

import { run, plain, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN } from "@/lib/leaders/errors";

/** How a team member wants to hear about one group of notices: right away, in a daily summary, or in a weekly one. Their own choice, for themselves only. */
export async function saveNoticePrefAction(group: string, delivery: string): Promise<Result> {
  if (!["admin", "pastors", "directors", "care", "coaches"].includes(group) || !["instant", "daily", "weekly"].includes(delivery)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("save_notice_pref", { p_group: group, p_delivery: delivery }, ["/profile"]));
}
