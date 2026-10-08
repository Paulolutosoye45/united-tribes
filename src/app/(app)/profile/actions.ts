"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
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

/** Stops WhatsApp messages. The database also clears the saved number. */
export async function stopWhatsappAction() {
  await record("whatsapp", false);
}

/** Withdrawing agreement erases the saved answers and any draft (the database does this). */
export async function deleteAnswersAction() {
  await record("matching", false);
  redirect("/profile?deleted=1");
}
