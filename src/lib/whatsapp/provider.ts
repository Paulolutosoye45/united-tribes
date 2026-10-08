import { MetaCloudSender } from "./meta";

/** Anything that can put a six-digit code on someone's WhatsApp. */
export interface CodeSender {
  readonly name: string;
  /** `to` is digits only with the country code, such as 2348031234567. */
  send(to: string, code: string): Promise<SendResult>;
}

export type SendResult = { ok: true } | { ok: false; reason: "rejected" | "unreachable" | "not_configured"; detail?: string };

/**
 * Chooses the sender from the environment.
 *   WHATSAPP_PROVIDER=meta  sends through the WhatsApp Business Cloud API.
 *   unset or none           sends nothing; the hook answers that it is not set up.
 * Another provider is one more class with the same two members.
 */
export function senderFromEnv(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): CodeSender | null {
  const which = (env.WHATSAPP_PROVIDER ?? "none").trim().toLowerCase();
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
  return null;
}
