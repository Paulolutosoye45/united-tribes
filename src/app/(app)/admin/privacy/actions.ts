"use server";

import { plain, run, text, type Result } from "@/lib/admin/rpc";

const PAGES = ["/admin/privacy", "/admin/people", "/admin"];

/** Writes down a request someone made another way (an email, in person), so it goes through the same checks. */
export async function recordErasureAction(email: string, note: string): Promise<Result> {
  return plain(await run("record_erasure_request", { p_email: text(email, 254), p_note: text(note, 600) }, PAGES));
}

/** Says no, with a reason the member will read on their profile. */
export async function declineErasureAction(person: string, reason: string): Promise<Result> {
  return plain(await run("decline_erasure", { p_person: person, p_note: text(reason, 600) }, PAGES));
}

/** Deletes the person's account and everything in it. The database refuses what must not be deleted. */
export async function erasePersonAction(person: string): Promise<Result> {
  return plain(await run("erase_person", { p_person: person }, PAGES));
}
