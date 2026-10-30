"use server";

import { run, plain, type Result } from "@/lib/admin/rpc";
import { loadWhatsappHealth } from "@/lib/whatsapp/health-server";
import { runHealthChecks } from "@/lib/whatsapp/health";
import { createClient } from "@/lib/supabase/server";

const PAGES = ["/admin/messages/whatsapp", "/admin/messages"];

/** Asks Meta about the account and keeps the answer for the office. Only the admin, a director or the data lead (the database checks), and only while the page is On. */
export async function runWhatsappChecksAction(): Promise<Result> {
  const supabase = await createClient();
  const view = await loadWhatsappHealth(supabase);
  if (!view) return { ok: false, message: "The WhatsApp health page is not switched on." };
  if (!view.canCheck) return { ok: false, message: "Only the admin, a director or the data lead can run the checks." };
  const report = await runHealthChecks();
  return plain(await run("whatsapp_check_save", { p_result: report }, PAGES));
}

/** Sends the signed-in person one test message on WhatsApp, to the number saved on their own profile. */
export async function sendWhatsappTestAction(): Promise<Result> {
  return plain(await run("whatsapp_test_send", undefined, PAGES));
}
