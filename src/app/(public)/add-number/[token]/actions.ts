"use server";

import { redirect } from "next/navigation";
import { isReachLink } from "@/lib/reach/series";
import { workerRpc, workerToken } from "@/lib/messaging/worker";

const INTENTS = ["save", "signin", "email", "link"] as const;
type Intent = (typeof INTENTS)[number];

/**
 * The buttons on the page behind “Add your WhatsApp number”. Opening the link records nothing but a count (a mail scanner or a link preview opens
 * links too); the member presses a button, and only then is anything saved. The link is the only credential, so it is checked as 64 hex characters
 * here and again, hashed, in the database. The tick is never pre-ticked: a yes to WhatsApp is only ever the member’s own.
 */
export async function addNumberAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const intent = String(formData.get("intent") ?? "");
  if (!isReachLink(token) || !(INTENTS as readonly string[]).includes(intent)) redirect("/");
  const secret = workerToken();
  const here = `/add-number/${token}`;
  if (!secret) redirect(`${here}?problem=1`);
  const rpc = workerRpc(secret);

  let result: { data: unknown; error: { message: string; code?: string } | null };
  switch (intent as Intent) {
    case "email":
      result = await rpc("worker_reach_email_instead", { p_link: token });
      break;
    case "link":
      result = await rpc("worker_reach_new_link", { p_link: token });
      break;
    default:
      result = await rpc("worker_reach_save", {
        p_link: token,
        p_phone: intent === "signin" ? "" : String(formData.get("phone") ?? "").slice(0, 40),
        p_whatsapp: formData.get("whatsapp") === "on",
        p_use_signin: intent === "signin",
      });
  }
  if (result.error) redirect(`${here}?${result.error.code === "22023" ? (intent === "signin" ? "bad=signin" : "bad=number") : "problem=1"}`);
  const data = (result.data ?? {}) as { ok?: boolean; reason?: string; done?: boolean };
  if (data.ok === false) redirect(`${here}?${data.reason === "expired" ? "expired=1" : "invalid=1"}`);
  if (intent === "email") redirect(`${here}?done=email`);
  if (intent === "link") redirect(`${here}?done=link`);
  redirect(`${here}?done=${data.done ? "saved" : "partial"}`);
}
