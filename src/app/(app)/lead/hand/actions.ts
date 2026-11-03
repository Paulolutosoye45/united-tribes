"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { chatLink } from "@/lib/whatsapp/mode-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Logs that the leader opened the group to post, and returns the group's address. Only a leader, assistant or coach of the tribe, or the office (the database checks). */
export async function openGroupAction(tribe: string, kind: string): Promise<Done<{ log: number; groupUrl: string | null }>> {
  if (!UUID.test(tribe)) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return run<{ log: number; groupUrl: string | null }>("hand_group", { p_tribe: tribe, p_kind: kind }, []);
}

/** Opens a chat with one member who said yes to WhatsApp and whose details are open to the leader. The number is used only to make the link. */
export async function openMemberChatAction(person: string, tribe: string, kind: string, text: string): Promise<Done<{ log: number; link: string; first: string }>> {
  if (!UUID.test(person) || !UUID.test(tribe) || !/^[a-z_]{2,32}$/.test(kind)) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  const done = await run<{ log: number; phone: string; first: string }>("hand_open", { p_person: person, p_tribe: tribe, p_kind: kind }, []);
  // The number is turned into the chat address here and goes no further: the page gets the address and the first name.
  if (!done.ok) return done;
  const link = chatLink(done.data.phone, text.slice(0, 1500));
  return link ? { ok: true, data: { log: done.data.log, link, first: done.data.first } } : { ok: false, message: "That number cannot be opened in WhatsApp. Check it with the person." };
}

/** The leader says whether they sent it or left it. */
export async function markHandAction(log: number, outcome: "sent" | "skipped"): Promise<Done> {
  if (!Number.isInteger(log) || log < 1) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return run("hand_mark", { p_log: log, p_outcome: outcome }, ["/lead/hand"]);
}
