import "server-only";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage } from "@/lib/messaging/types";
import { siteUrl } from "@/lib/messaging/worker";
import type { SentMessage } from "./oversight";

/** What a template is for, in the platform’s own words; an unknown or retired one is shown as it is written. */
export function templateTitle(key: string): string {
  return TEMPLATES[key]?.title ?? key.replace(/_/g, " ");
}

/**
 * The wording of a message, as the email version reads (the text and WhatsApp versions say the same in fewer words). Null where the
 * message is held back, where it has no wording we can write now, or where the template has since been retired.
 */
export function wordingOf(m: SentMessage): { subject: string; text: string } | null {
  if (m.held || !m.params || !TEMPLATES[m.template]) return null;
  const first = m.name.split(/\s+/)[0] || null;
  const claimed: ClaimedMessage = {
    id: m.id,
    template: m.template,
    channel: m.channel === "whatsapp" || m.channel === "sms" ? m.channel : "email",
    params: m.params,
    urgency: m.urgent ? "urgent" : "normal",
    attempts: 0,
    reply_token: null,
    to: { email: "recipient@example.invalid", phone: null, name: m.name, first_name: first },
  };
  try {
    const email = renderEmail(claimed, siteUrl());
    // The footer carries a private unsubscribe address; only the message itself is shown
    const text = email.text.split(/\n\s*\n/).filter((part) => !/unsubscribe|Change how we reach you|You are receiving this/i.test(part)).join("\n\n");
    return { subject: email.subject, text };
  } catch {
    return null;
  }
}
