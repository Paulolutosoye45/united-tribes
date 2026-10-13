"use server";

import { headers } from "next/headers";
import { GUARDIAN_CONSENT_VERSION } from "@/lib/guardian/consent";
import { friendly } from "@/lib/leaders/errors";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";

export type GuardianResult = { ok: true } | { ok: false; message: string };

/**
 * A parent or guardian answering by their private link. No sign-in: the secret in the link is the key.
 * The wording version is set here, on the server, so what is recorded is what this deployment actually showed.
 */
export async function answerGuardianAction(token: string, approve: boolean, agreed: boolean, note: string, captcha = ""): Promise<GuardianResult> {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return { ok: false, message: "This link is not valid." };
  if (typeof approve !== "boolean") return { ok: false, message: "Something went wrong. Reload the page and try again." };
  if (approve && agreed !== true) return { ok: false, message: "Tick the box to confirm you have read this and agree." };
  const text = typeof note === "string" ? note.trim().slice(0, 300) : "";

  // Giving permission is the answer worth faking, so it is checked against bots (when the check is switched on).
  // Declining, and taking permission back, are never held up.
  if (approve) {
    const forwarded = (await headers()).get("x-forwarded-for");
    const human = await verifyTurnstile(captcha, { ip: forwarded?.split(",")[0]?.trim() ?? null });
    if (!human.ok) return { ok: false, message: human.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_guardian_request", {
    p_token: token,
    p_approve: approve,
    p_agree: approve ? true : null,
    p_version: approve ? GUARDIAN_CONSENT_VERSION : null,
    p_note: text || null,
  });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true };
}
