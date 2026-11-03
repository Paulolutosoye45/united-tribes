"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { chatLink } from "@/lib/whatsapp/mode-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens a chat with a leader or coach who said yes to WhatsApp. The number is given to the page only to build the link, and is not kept there. */
export async function openStaffChatAction(person: string, kind: string, text: string): Promise<Done<{ log: number; link: string; first: string }>> {
  if (!UUID.test(person) || !/^[a-z_]{2,32}$/.test(kind)) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return chat(await run<{ log: number; phone: string; first: string }>("hand_open", { p_person: person, p_tribe: null, p_kind: kind }, []), text);
}

/** The number is turned into the chat address here and goes no further: the page gets the address and the first name. */
function chat(done: Done<{ log: number; phone: string; first: string }>, text: string): Done<{ log: number; link: string; first: string }> {
  if (!done.ok) return done;
  const link = chatLink(done.data.phone, text.slice(0, 1500));
  return link ? { ok: true, data: { log: done.data.log, link, first: done.data.first } } : { ok: false, message: "That number cannot be opened in WhatsApp. Check it with the person." };
}

/** Records that the chat was sent or left. */
export async function markHandAction(log: number, outcome: "sent" | "skipped"): Promise<Done> {
  if (!Number.isInteger(log) || log < 1) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return run("hand_mark", { p_log: log, p_outcome: outcome }, ["/admin/messages/by-hand"]);
}
