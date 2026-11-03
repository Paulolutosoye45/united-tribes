"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** The leader (or assistant) ticks a person as added to, or removed from, the tribe's WhatsApp group. The database checks that they run the tribe and that the person has said yes. */
export async function markGroupAction(tribe: string, member: string, kind: "admitted" | "removed", done: boolean): Promise<Result> {
  if (!isUuid(tribe) || !isUuid(member) || (kind !== "admitted" && kind !== "removed")) return { ok: false, message: TRY_AGAIN };
  return plain(await run("tribe_group_mark", { p_tribe: tribe, p_person: member, p_kind: kind, p_done: done === true }, ["/lead/tribe"]));
}
