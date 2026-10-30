import { renderWhatsApp } from "../render";
import { brief, isTransient, readJson, retryDelay, type ChannelProvider, type Fetcher, type SendResult } from "./types";
import type { ClaimedMessage } from "../types";

type Options = {
  phoneNumberId: string;
  token: string;
  language: string;
  graphVersion: string;
  /** Where the Graph API lives. Only changed to point tests at a stand-in. */
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
};

/**
 * Meta error codes that mean this message cannot reach this person on WhatsApp, or
 * that the template is not usable, or that the church's own account is refused (an
 * expired token, a locked or blocked account). Trying again would give the same answer,
 * so the message moves on to the next channel instead; the database counts the
 * account-level ones and pauses WhatsApp when there are too many (WhatsApp safety net).
 */
const GIVE_UP_CODES = new Set([
  10, // the access token is missing a permission
  190, // the access token has expired or is wrong
  200, // the access token is missing a permission
  368, // the account is temporarily blocked for a policy reason
  131031, // the account is locked
  131037, // the display name needs approval
  131026, // the number is not on WhatsApp, or has not accepted the terms
  131030, // not in the allowed list (a test number)
  131021, // sent to itself
  131042, // payment problem on the business account
  131045, // sender not registered
  132000, // wrong number of variables
  132001, // template does not exist or is not approved
  132005, // translated text too long
  132007, // content policy
  132012, // variable format mismatch
  132015, // template paused
  132016, // template disabled
]);
const RETRY_CODES = new Set([4, 80007, 130429, 131016, 131048, 131056, 133004, 133016]);

/** Meta's own code decides when it is one of the known ones; otherwise the HTTP status does. */
export function classify(code: number | undefined, status: number): "retry" | "rejected" {
  if (code !== undefined) {
    if (RETRY_CODES.has(code)) return "retry";
    if (GIVE_UP_CODES.has(code)) return "rejected";
  }
  return isTransient(status) ? "retry" : "rejected";
}

/**
 * Sends the approved message templates through the WhatsApp Business Cloud API.
 * Every message in this platform is business-started, so each goes out as a
 * template (see `npm run templates`).
 */
export class WhatsAppTemplateSender implements ChannelProvider {
  readonly channel = "whatsapp" as const;
  readonly name = "meta";
  constructor(private readonly o: Options) {}

  /** The request body, exposed so tests can check it without a network. */
  payload(msg: ClaimedMessage, site: string, to: string) {
    const rendered = renderWhatsApp(msg, site);
    const components: unknown[] = [
      { type: "body", parameters: rendered.vars.map((text) => ({ type: "text", text })) },
    ];
    rendered.quickReplyPayloads.forEach((payload, index) => {
      components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
    });
    if (rendered.urlButton) {
      components.push({ type: "button", sub_type: "url", index: String(rendered.urlButton.index), parameters: [{ type: "text", text: rendered.urlButton.token }] });
    }
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: rendered.name, language: { code: this.o.language }, components },
    };
  }

  async send(msg: ClaimedMessage, site: string): Promise<SendResult> {
    const digits = (msg.to.phone ?? "").replace(/\D/g, "");
    if (digits.length < 8) return { ok: false, kind: "rejected", error: "no phone number" };

    const doFetch = this.o.fetcher ?? fetch;
    const base = (this.o.baseUrl ?? "https://graph.facebook.com").replace(/\/+$/, "");
    let response: Response;
    try {
      response = await doFetch(`${base}/${this.o.graphVersion}/${this.o.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" },
        body: JSON.stringify(this.payload(msg, site, digits)),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch {
      return { ok: false, kind: "retry", error: "whatsapp unreachable", retryMinutes: retryDelay(null, msg.attempts) };
    }

    const body = await readJson(response);
    if (response.ok) {
      const messages = body?.messages;
      const id = Array.isArray(messages) && messages[0] && typeof messages[0] === "object" ? (messages[0] as { id?: unknown }).id : null;
      return { ok: true, providerId: typeof id === "string" ? id : null };
    }

    const err = (body?.error ?? {}) as { code?: number; error_subcode?: number; message?: string };
    const code = typeof err.code === "number" ? err.code : undefined;
    const label = code !== undefined ? `meta ${code}${err.error_subcode ? `/${err.error_subcode}` : ""}${err.message ? `: ${brief(err.message)}` : ""}` : `http ${response.status}`;
    if (classify(code, response.status) === "retry") {
      return { ok: false, kind: "retry", error: label, retryMinutes: retryDelay(response, msg.attempts) };
    }
    return { ok: false, kind: "rejected", error: label };
  }
}
