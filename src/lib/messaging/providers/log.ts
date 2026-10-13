import { renderEmail, renderSms, renderWhatsApp } from "../render";
import type { Channel, ClaimedMessage } from "../types";
import type { ChannelProvider, SendResult } from "./types";

export type LoggedMessage = { id: string; channel: Channel; template: string; to: string; preview: string };

/**
 * Sends nothing. Writes what would have gone out to the server log (without the
 * full number or address) and keeps it in memory so a test can read it. This is
 * the default way to try the whole flow before any provider account exists.
 */
export class LogProvider implements ChannelProvider {
  readonly name = "log";
  readonly sent: LoggedMessage[] = [];
  constructor(readonly channel: Channel, private readonly write: (line: string) => void = (line) => console.info(line)) {}

  async send(msg: ClaimedMessage, site: string): Promise<SendResult> {
    let preview: string;
    let to: string;
    if (this.channel === "email") {
      preview = renderEmail(msg, site).subject;
      to = mask(msg.to.email ?? "");
    } else if (this.channel === "sms") {
      preview = renderSms(msg, site);
      to = mask(msg.to.phone ?? "");
    } else {
      preview = renderWhatsApp(msg, site).vars.join(" | ");
      to = mask(msg.to.phone ?? "");
    }
    this.sent.push({ id: msg.id, channel: this.channel, template: msg.template, to, preview });
    this.write(`[messaging:log] ${this.channel} ${msg.template} to ${to}: ${preview.slice(0, 120)}`);
    return { ok: true, providerId: `log-${msg.id}` };
  }
}

function mask(value: string): string {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return value.length > 4 ? `***${value.slice(-4)}` : "***";
}
