"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { plain, run, text, type Result } from "@/lib/admin/rpc";
import { friendly } from "@/lib/leaders/errors";
import { parseContactForm } from "@/lib/messaging/contact";
import { loadNumberRule } from "@/lib/messaging/number-rule-server";
import { CONSENT_VERSION } from "@/lib/intake/consent";
import { createClient } from "@/lib/supabase/server";

async function record(purpose: "matching" | "ai_assist" | "whatsapp", granted: boolean) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile");
  const supabase = await createClient();
  await supabase
    .from("consents")
    .insert({ person_id: session.person.id, purpose, granted, version: CONSENT_VERSION });
  revalidatePath("/", "layout");
}

/** Turns the assistant on or off for the person's own writing. */
export async function setAssistantAction(formData: FormData) {
  await record("ai_assist", formData.get("granted") === "yes");
}

export type ContactState = { status: "idle" | "ok" | "error"; message: string };

/** Saves how and where the person is reached. Each yes or no is written to the consent ledger by the database. */
export async function saveContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/profile");
  const supabase = await createClient();
  // Compulsory for an adult member while the church has switched the rule On; Off, this is exactly what it was
  const rule = await loadNumberRule(supabase);
  const parsed = parseContactForm(formData, { required: rule.required });
  if (!parsed.ok) return { status: "error", message: parsed.message };

  const { error } = await supabase.rpc("save_contact", {
    p_phone: parsed.value.phone,
    p_preferred: parsed.value.preferred,
    p_whatsapp: parsed.value.whatsapp,
    p_sms: parsed.value.sms,
    p_email: parsed.value.email,
    p_version: CONSENT_VERSION,
  });
  if (error) return { status: "error", message: friendly(error) };
  revalidatePath("/profile");
  return { status: "ok", message: "Saved. We’ll use these from now on." };
}

/** "Not now" on the prompt to add a phone number: it stays away for a week. Nothing is asked of the person, and nothing is sent to anyone. */
export async function dismissNumberPromptAction(): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("number_prompt_dismiss");
  if (error) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Withdrawing agreement erases the saved answers and any draft (the database does this). */
export async function deleteAnswersAction() {
  await record("matching", false);
  redirect("/profile?deleted=1");
}

export type PhotoResult = { ok: true; updatedAt: string | null } | { ok: false; message: string };

/**
 * Saves the portrait. The browser has already shrunk it; the database checks size, type and the first bytes
 * again, so nothing but a small picture can be stored.
 */
export async function savePhotoAction(base64: string, mime: string): Promise<PhotoResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  if (typeof base64 !== "string" || base64.length > 210000 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { ok: false, message: "That picture could not be read. Try another." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_my_photo", { p_data: base64, p_mime: mime });
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/profile");
  return { ok: true, updatedAt: ((data as { updated_at?: string } | null)?.updated_at ?? null) };
}

export async function removePhotoAction(): Promise<PhotoResult> {
  const session = await getSession();
  if (!session) return { ok: false, message: "Your session ended. Sign in again to continue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_my_photo");
  if (error) return { ok: false, message: friendly(error) };
  revalidatePath("/profile");
  return { ok: true, updatedAt: null };
}

/** Asks the church office to delete the account and everything in it. The office answers; nothing is deleted here. */
export async function requestErasureAction(note: string): Promise<Result> {
  return plain(await run("request_erasure", { p_note: text(note, 600) }, ["/profile"]));
}

/** Takes the request back (or clears a "not yet" from the office). */
export async function withdrawErasureAction(): Promise<Result> {
  return plain(await run("withdraw_erasure_request", undefined, ["/profile"]));
}

/** The three email switches: reminders, announcements, and everything about my tribe. Each yes or no is written to the consent ledger. */
export async function saveEmailSwitchesAction(reminders: boolean, announcements: boolean, tribe: boolean): Promise<Result> {
  if ([reminders, announcements, tribe].some((v) => typeof v !== "boolean")) return { ok: false, message: "Something went wrong. Reload the page and try again." };
  return plain(await run("save_email_switches", { p_reminders: reminders, p_announcements: announcements, p_tribe: tribe }, ["/profile"]));
}
