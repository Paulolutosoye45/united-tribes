import { renderSms } from "../render";
import { brief, isTransient, readJson, retryDelay, type ChannelProvider, type Fetcher, type SendResult } from "./types";
import type { ClaimedMessage } from "../types";

type Common = { fetcher?: Fetcher; timeoutMs?: number; baseUrl?: string };

/** Nigerian numbers on the Do-Not-Disturb list only receive messages sent on the "dnd" route. */
type TermiiOptions = Common & { apiKey: string; senderId: string; route?: "generic" | "dnd" };

/** Sends text messages through Termii, a provider with routes into Nigerian networks. */
export class TermiiSmsSender implements ChannelProvider {
  readonly channel = "sms" as const;
  readonly name = "termii";
  constructor(private readonly o: TermiiOptions) {}

  payload(msg: ClaimedMessage, site: string, to: string) {
    return {
      to,
      from: this.o.senderId,
      sms: renderSms(msg, site),
      type: "plain",
      channel: this.o.route ?? "dnd",
      api_key: this.o.apiKey,
    };
  }

  async send(msg: ClaimedMessage, site: string): Promise<SendResult> {
    const to = (msg.to.phone ?? "").replace(/\D/g, "");
    if (to.length < 8) return { ok: false, kind: "rejected", error: "no phone number" };
    const doFetch = this.o.fetcher ?? fetch;
    const base = (this.o.baseUrl ?? "https://api.ng.termii.com").replace(/\/+$/, "");
    let response: Response;
    try {
      response = await doFetch(`${base}/api/sms/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.payload(msg, site, to)),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch {
      return { ok: false, kind: "retry", error: "sms unreachable", retryMinutes: retryDelay(null, msg.attempts) };
    }
    const body = await readJson(response);
    if (response.ok && (body?.code === "ok" || typeof body?.message_id === "string")) {
      return { ok: true, providerId: typeof body?.message_id === "string" ? body.message_id : null };
    }
    const label = `termii ${response.status}${typeof body?.message === "string" ? `: ${brief(body.message)}` : ""}`;
    if (isTransient(response.status)) return { ok: false, kind: "retry", error: label, retryMinutes: retryDelay(response, msg.attempts) };
    return { ok: false, kind: "rejected", error: label };
  }
}

type TwilioOptions = Common & { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string };

/** Sends text messages through Twilio. Use it when the team already has a Twilio account. */
export class TwilioSmsSender implements ChannelProvider {
  readonly channel = "sms" as const;
  readonly name = "twilio";
  constructor(private readonly o: TwilioOptions) {}

  form(msg: ClaimedMessage, site: string, to: string) {
    const form = new URLSearchParams({ To: `+${to}`, Body: renderSms(msg, site) });
    if (this.o.messagingServiceSid) form.set("MessagingServiceSid", this.o.messagingServiceSid);
    else if (this.o.from) form.set("From", this.o.from);
    return form;
  }

  async send(msg: ClaimedMessage, site: string): Promise<SendResult> {
    const to = (msg.to.phone ?? "").replace(/\D/g, "");
    if (to.length < 8) return { ok: false, kind: "rejected", error: "no phone number" };
    const doFetch = this.o.fetcher ?? fetch;
    const base = (this.o.baseUrl ?? "https://api.twilio.com").replace(/\/+$/, "");
    let response: Response;
    try {
      response = await doFetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(this.o.accountSid)}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${this.o.accountSid}:${this.o.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: this.form(msg, site, to).toString(),
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
      });
    } catch {
      return { ok: false, kind: "retry", error: "sms unreachable", retryMinutes: retryDelay(null, msg.attempts) };
    }
    const body = await readJson(response);
    if (response.ok) return { ok: true, providerId: typeof body?.sid === "string" ? body.sid : null };
    const label = `twilio ${response.status}${typeof body?.code === "number" ? `/${body.code}` : ""}${typeof body?.message === "string" ? `: ${brief(body.message)}` : ""}`;
    if (isTransient(response.status)) return { ok: false, kind: "retry", error: label, retryMinutes: retryDelay(response, msg.attempts) };
    return { ok: false, kind: "rejected", error: label };
  }
}
