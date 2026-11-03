"use server";

import { run, plain, type Result } from "@/lib/admin/rpc";
import { loadWhatsappHealth } from "@/lib/whatsapp/health-server";
import { runHealthChecks } from "@/lib/whatsapp/health";
import { createClient } from "@/lib/supabase/server";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { asker, FREE_WORDS, gateFetch } from "@/lib/whatsapp/mode";

const PAGES = ["/admin/messages/whatsapp", "/admin/messages"];

/** Asks Meta about the account and keeps the answer for the office. Only the admin, a director or the data lead (the database checks), and only while the page is On. */
export async function runWhatsappChecksAction(): Promise<Result> {
  const supabase = await createClient();
  const view = await loadWhatsappHealth(supabase);
  if (!view) return { ok: false, message: "The WhatsApp health page is not switched on." };
  if (!view.canCheck) return { ok: false, message: "Only the admin, a director or the data lead can run the checks." };
  // Free mode: nothing is asked of Meta, so the check is not run. (The fetch is gated too, so no road can reach Meta by mistake.)
  const token = workerToken();
  const ask = token ? asker(workerRpc(token)) : null;
  if (ask) {
    const said = await ask();
    if (!said.meta) {
      return {
        ok: false,
        message: said.mode === "free" ? `${FREE_WORDS}, so the account is not checked. Choose Saver or Full on the WhatsApp mode page to check it.` : "WhatsApp mode could not be read just now, so the account was not checked. Try again in a minute.",
      };
    }
  }
  const report = await runHealthChecks(process.env, ask ? gateFetch(fetch, ask) : fetch);
  return plain(await run("whatsapp_check_save", { p_result: report }, PAGES));
}

/** Sends the signed-in person one test message on WhatsApp, to the number saved on their own profile. */
export async function sendWhatsappTestAction(): Promise<Result> {
  return plain(await run("whatsapp_test_send", undefined, PAGES));
}
