"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** The leader gives one member 48 hours more, once. The database checks that they lead the tribe and that the seat is still waiting on its clock; it says no again for a second time. */
export async function seatMoreTimeAction(clock: string): Promise<Result> {
  if (!isUuid(clock)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("seat_leader_more_time", { p_clock: clock }, ["/lead/tribe", "/admin/seats"]));
}
