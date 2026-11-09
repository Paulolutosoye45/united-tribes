"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

/** The leader's one line for the emails to members placed in the tribe. The database checks that they lead it and that the line is one plain sentence with no links, numbers or symbols. An empty line clears it. */
export async function seatLineAction(tribe: string, line: string): Promise<Result> {
  if (!isUuid(tribe)) return { ok: false, message: TRY_AGAIN };
  return plain(await run("tribe_seat_line_set", { p_tribe: tribe, p_line: text(line, 400) }, ["/lead/tribe"]));
}
