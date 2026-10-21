"use server";

import { run, plain, type Result } from "@/lib/admin/rpc";
import { NOTICE_MODES } from "@/lib/admin/notices";
import { TRY_AGAIN } from "@/lib/leaders/errors";
import { NOTICE_GROUPS } from "@/lib/messaging/templates-notices";

const PAGES = ["/admin/notifications", "/admin"];

/**
 * Switches one group of team notices Off, to Rehearsal or On. Only an admin or director may; the database checks, and records who changed what.
 * Nothing is emailed from Off or Rehearsal.
 */
export async function setNoticeModeAction(group: string, mode: string): Promise<Result> {
  if (!NOTICE_GROUPS.some((g) => g.key === group) || !(NOTICE_MODES as readonly string[]).includes(mode)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("notice_set_mode", { p_group: group, p_mode: mode }, PAGES));
}
