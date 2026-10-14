"use server";

import { run, type Done } from "@/lib/admin/rpc";
import { TRY_AGAIN, isUuid } from "@/lib/leaders/errors";

export type ChatOpen = { phone: string; first_name: string; text: string | null };

/**
 * Opens a WhatsApp chat on the person's own phone with a friendly first line ready to send. It works only for people who
 * agreed to WhatsApp and are this person's contact. We record that a chat was opened, never what was said.
 */
export async function openChatAction(person: string, context: string): Promise<Done<ChatOpen>> {
  if (!isUuid(person) || !/^[a-z_]{2,32}$/.test(context)) return { ok: false, message: TRY_AGAIN };
  return run<ChatOpen>("chat_open", { p_person: person, p_context: context });
}
