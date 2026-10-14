import { LinkedSender } from "./linked";
import { MetaCloudSender } from "./meta";

/** Anything that can put a six-digit code on someone's WhatsApp. */
export interface CodeSender {
  readonly name: string;
  /** Which road the code takes: the official business route, or an ordinary number on the sender service. Official when not said. */
  readonly route?: "official" | "linked";
  /** `to` is digits only with the country code, such as 2348031234567. */
  send(to: string, code: string): Promise<SendResult>;
  /** Only the ordinary-number sender reports on itself. */
  health?(): Promise<SenderHealth>;
}

export type SenderHealth = "ok" | "logged_out" | "restricted" | "unreachable";

export type SendResult = { ok: true } | { ok: false; reason: "rejected" | "unreachable" | "not_configured"; detail?: string };

/**
 * Chooses the sender from the environment.
 *   SIGNIN_WHATSAPP_ROUTE=linked   sends through the sender service in /sender (an ordinary number; docs/SIGNIN-CHANNELS.md).
 *   SIGNIN_WHATSAPP_ROUTE=official sends through the WhatsApp Business Cloud API, same as WHATSAPP_PROVIDER=meta.
 *   When SIGNIN_WHATSAPP_ROUTE is not set, WHATSAPP_PROVIDER decides (meta, or none), exactly as before. The messages the
 *   site sends (not sign-in codes) keep using WHATSAPP_PROVIDER, so the two can use different roads.
 *   Neither set, or incomplete: sends nothing; the hook answers that it is not set up.
 * Another provider is one more class with the same two members.
 */
export function senderFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): CodeSender | null {
  const chosen = (env.SIGNIN_WHATSAPP_ROUTE ?? "").trim().toLowerCase() || (env.WHATSAPP_PROVIDER ?? "none").trim().toLowerCase();
  const which = chosen === "official" ? "meta" : chosen;
  if (which === "meta") {
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const token = env.WHATSAPP_ACCESS_TOKEN?.trim();
    const template = env.WHATSAPP_TEMPLATE_NAME?.trim();
    if (!phoneNumberId || !token || !template) return null;
    return new MetaCloudSender({
      phoneNumberId,
      token,
      template,
      language: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en",
      graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0",
      fetcher,
    });
  }
  if (which === "linked") {
    const url = env.LINKED_SENDER_URL?.trim().replace(/\/+$/, "");
    const secret = env.LINKED_SENDER_SECRET?.trim();
    // The code travels in the request, so it must be https (plain http only to a service on this same machine).
    if (!url || !(/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) || !secret || secret.length < 24) return null;
    return new LinkedSender({ url, secret, fetcher });
  }
  return null;
}
