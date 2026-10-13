"use server";

import { plain, run, type Result } from "@/lib/admin/rpc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Puts a message that failed back in the queue, as if it had never been tried. Only an admin or director may (the database checks). */
export async function retryMessageAction(id: string): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, message: "We couldn’t find that message. Reload the page and try again." };
  return plain(await run("retry_message", { p_id: id }, ["/admin/messages", "/admin/system"]));
}
