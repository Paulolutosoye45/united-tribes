import type { Channel } from "../types";
import { ResendEmailSender } from "./email";
import { SmtpEmailSender, type SmtpSecurity } from "./smtp";
import { LogProvider } from "./log";
import { TermiiSmsSender, TwilioSmsSender } from "./sms";
import type { ChannelProvider, Fetcher } from "./types";
import { WhatsAppTemplateSender } from "./whatsapp";

export type Providers = Record<Channel, ChannelProvider | null>;

const clean = (value: string | undefined) => (value ?? "").trim();

/**
 * Chooses the provider for each channel from the environment.
 *
 *   MESSAGING_MODE=log          every channel only logs; nothing leaves the server
 *   WHATSAPP_PROVIDER=meta      (the same credentials the sign-in code uses)
 *   EMAIL_PROVIDER=resend       RESEND_API_KEY, EMAIL_FROM
 *   EMAIL_PROVIDER=smtp         SMTP_HOST, EMAIL_FROM, and usually SMTP_USER, SMTP_PASSWORD, SMTP_PORT, SMTP_SECURITY (your own mail server)
 *   SMS_PROVIDER=termii|twilio  TERMII_API_KEY, TERMII_SENDER_ID  |  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *
 * A channel with no provider is `null`. A message for that channel is turned back
 * by the sender, and the database tries the person's next channel.
 */
export function providersFromEnv(env: Record<string, string | undefined> = process.env, fetcher?: Fetcher): Providers {
  if (clean(env.MESSAGING_MODE).toLowerCase() === "log") {
    return { whatsapp: new LogProvider("whatsapp"), email: new LogProvider("email"), sms: new LogProvider("sms") };
  }
  return { whatsapp: whatsapp(env, fetcher), email: email(env, fetcher), sms: sms(env, fetcher) };
}

function whatsapp(env: Record<string, string | undefined>, fetcher?: Fetcher): ChannelProvider | null {
  const which = clean(env.WHATSAPP_PROVIDER).toLowerCase();
  if (which === "log") return new LogProvider("whatsapp");
  if (which !== "meta") return null;
  const phoneNumberId = clean(env.WHATSAPP_PHONE_NUMBER_ID);
  const token = clean(env.WHATSAPP_ACCESS_TOKEN);
  if (!phoneNumberId || !token) return null;
  return new WhatsAppTemplateSender({
    phoneNumberId,
    token,
    language: clean(env.WHATSAPP_TEMPLATE_LANGUAGE) || "en",
    graphVersion: clean(env.WHATSAPP_GRAPH_VERSION) || "v23.0",
    baseUrl: clean(env.WHATSAPP_API_BASE) || undefined,
    fetcher,
  });
}

function email(env: Record<string, string | undefined>, fetcher?: Fetcher): ChannelProvider | null {
  const which = clean(env.EMAIL_PROVIDER).toLowerCase();
  if (which === "log") return new LogProvider("email");
  if (which === "smtp") return smtp(env);
  if (which !== "resend") return null;
  const apiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM);
  if (!apiKey || !from) return null;
  return new ResendEmailSender({ apiKey, from, replyTo: clean(env.EMAIL_REPLY_TO) || undefined, baseUrl: clean(env.RESEND_API_BASE) || undefined, fetcher });
}

/** Your own mail server. Anything missing or unreadable gives no email provider, which /api/health shows as `email: null`. */
function smtp(env: Record<string, string | undefined>): ChannelProvider | null {
  const host = clean(env.SMTP_HOST);
  const from = clean(env.EMAIL_FROM);
  if (!host || !from) return null;
  const said = clean(env.SMTP_SECURITY).toLowerCase();
  const rawPort = clean(env.SMTP_PORT);
  // Port 465 has always meant "encrypted from the first byte"; everything else starts plain and upgrades. Say so explicitly to override.
  const security: SmtpSecurity = said === "tls" || said === "starttls" || said === "none" ? said : rawPort === "465" ? "tls" : "starttls";
  const port = rawPort ? Number(rawPort) : security === "tls" ? 465 : security === "none" ? 25 : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const user = clean(env.SMTP_USER);
  // A login needs a password; one without the other is a mistake, not a server that wants no login.
  if (user && !env.SMTP_PASSWORD) return null;
  return new SmtpEmailSender({
    host,
    port,
    security,
    user: user || undefined,
    password: user ? (env.SMTP_PASSWORD as string) : undefined,
    from,
    replyTo: clean(env.EMAIL_REPLY_TO) || undefined,
    bounceTo: clean(env.SMTP_BOUNCE_ADDRESS) || undefined,
    helloName: clean(env.SMTP_HELO_NAME) || undefined,
  });
}

function sms(env: Record<string, string | undefined>, fetcher?: Fetcher): ChannelProvider | null {
  const which = clean(env.SMS_PROVIDER).toLowerCase();
  if (which === "log") return new LogProvider("sms");
  if (which === "termii") {
    const apiKey = clean(env.TERMII_API_KEY);
    const senderId = clean(env.TERMII_SENDER_ID);
    if (!apiKey || !senderId) return null;
    const route = clean(env.TERMII_ROUTE).toLowerCase();
    return new TermiiSmsSender({ apiKey, senderId, route: route === "generic" ? "generic" : "dnd", baseUrl: clean(env.TERMII_BASE_URL) || undefined, fetcher });
  }
  if (which === "twilio") {
    const accountSid = clean(env.TWILIO_ACCOUNT_SID);
    const authToken = clean(env.TWILIO_AUTH_TOKEN);
    const from = clean(env.TWILIO_FROM);
    const messagingServiceSid = clean(env.TWILIO_MESSAGING_SERVICE_SID);
    if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
    return new TwilioSmsSender({ accountSid, authToken, from: from || undefined, messagingServiceSid: messagingServiceSid || undefined, baseUrl: clean(env.TWILIO_API_BASE) || undefined, fetcher });
  }
  return null;
}

export { LogProvider, ResendEmailSender, SmtpEmailSender, TermiiSmsSender, TwilioSmsSender, WhatsAppTemplateSender };
export type { ChannelProvider };
export * from "./types";
