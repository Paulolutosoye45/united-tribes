import { renderEmail } from "../render";
import { brief, isTransient, readJson, retryDelay, type ChannelProvider, type Fetcher, type SendResult } from "./types";
import type { ClaimedMessage } from "../types";

type Options = {
  apiKey: string;
  /** "United Tribes <hello@your-domain.org>", on a domain verified with the provider. */
  from: string;
  replyTo?: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
};

/** Sends email through Resend. The message id doubles as the idempotency key, so a retry never sends twice. */
export class ResendEmailSender implements ChannelProvider {
  readonly channel = "email" as const;
  readonly name = "resend";
  constructor(private readonly o: Options) {}

  payload(msg: ClaimedMessage, site: string) {
    const email = renderEmail(msg, site);
    return {
      from: this.o.from,
      to: [msg.to.email as string],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(this.o.replyTo ? { reply_to: this.o.replyTo } : {}),
      ...(msg.urgency === "urgent" ? { headers: { Importance: "high", "X-Priority": "1" } } : {}),
    };
  }

  async send(msg: ClaimedMessage, site: string): Promise<SendResult> {
    const to = (msg.to.email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, kind: "rejected", error: "no email address" };

    const doFetch = this.o.fetcher ?? fetch;
    const base = (this.o.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");
    let response: Response;
    try {
      response = await doFetch(`${base}/emails`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.o.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `ut-${msg.id}-${msg.attempts}`,
        },
        body: JSON.stringify(this.payload(msg, site)),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch {
      return { ok: false, kind: "retry", error: "email unreachable", retryMinutes: retryDelay(null, msg.attempts) };
    }
    const body = await readJson(response);
    if (response.ok) return { ok: true, providerId: typeof body?.id === "string" ? body.id : null };

    const label = `resend ${response.status}${typeof body?.message === "string" ? `: ${brief(body.message)}` : ""}`;
    if (isTransient(response.status)) return { ok: false, kind: "retry", error: label, retryMinutes: retryDelay(response, msg.attempts) };
    // 401/403 are about our own set-up, not this person; the next channel still gets a chance.
    return { ok: false, kind: "rejected", error: label };
  }
}
