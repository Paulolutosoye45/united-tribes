"use server";

import { redirect } from "next/navigation";
import { AGREEMENT_VERSION } from "@/lib/matching/wording";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

const FUNCTIONS = { confirm: "worker_placed_confirm", withhold: "worker_placed_withhold", change: "worker_placed_change" } as const;
type Choice = keyof typeof FUNCTIONS;

/**
 * The three buttons on the page behind "Your tribe". Opening the link records nothing (a mail scanner or a link preview opens links
 * too); the member presses a button, and only then is it saved. The link is the only credential, so it is checked as 64 hex characters
 * here and again, hashed, in the database.
 */
export async function placedAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token) || !(choice in FUNCTIONS)) redirect("/");
  const secret = workerToken();
  if (!secret) redirect(`/placed/${token}?problem=1`);

  const rpc = workerRpc(secret);
  // "Yes, I’m in" may carry a number and the tick for WhatsApp (the contact series, when it is On). They are saved first, so a number that does not
  // look right stops here with the place still waiting; a member who left the boxes empty goes straight on.
  if (choice === "confirm") {
    const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
    const whatsapp = formData.get("whatsapp") === "on";
    const signin = formData.get("signin") === "on";
    if (phone || whatsapp || signin) {
      const saved = await rpc("worker_placed_reach_save", { p_link: token, p_phone: phone, p_whatsapp: whatsapp, p_use_signin: signin });
      if (saved.error) redirect(`/placed/${token}?${saved.error.code === "22023" ? "number=1" : "problem=1"}`);
    }
  }
  const args: Record<string, unknown> = { p_link: token };
  if (choice === "confirm") args.p_version = AGREEMENT_VERSION;
  const { data, error } = await rpc(FUNCTIONS[choice as Choice], args);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; late?: boolean };
  if (error) redirect(`/placed/${token}?problem=1`);
  if (!result.ok) {
    redirect(`/placed/${token}?${result.reason === "started" ? "started=1" : result.reason === "invalid" || result.reason === "not_active" ? "invalid=1" : "problem=1"}`);
  }
  redirect(`/placed/${token}?done=${choice}${result.late ? "&late=1" : ""}`);
}
