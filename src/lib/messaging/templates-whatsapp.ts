import { flat, num, smsLine } from "./format";
import { faultCause } from "@/lib/whatsapp/faults";
import type { Params, TemplateDef } from "./types";

/**
 * The messages that belong to WhatsApp reliability: the alarm for the people who run it. Email only, never WhatsApp (the alarm must not depend on the
 * channel that is failing), and never a member's name, number or message.
 */

const whatsappPaused: TemplateDef = {
  key: "whatsapp_paused",
  audience: "office",
  emailOnly: true,
  title: "WhatsApp messages have paused themselves",
  email: (p, c) => ({
    subject: "WhatsApp messages are paused",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `WhatsApp refused the church's account ${num(p.count, 5)} times in ${num(p.minutes, 30)} minutes because ${faultCause(num(p.code, 0))} (Meta code ${num(p.code, 0)}), so every WhatsApp message has paused itself.`,
      "Nobody is left out: each message goes to the member's next channel, email or text, as they agreed. Nothing turns WhatsApp back on by itself.",
      "Open the page below, read what to do, and restart WhatsApp once it is fixed.",
    ],
    cta: { label: "Open the message log", url: c.link("/admin/messages") },
  }),
  sms: (_p, c) => smsLine("WhatsApp messages have paused themselves. Members are reached by email and text instead. Look into it here:", c.link("/admin/messages")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, WhatsApp messages have paused themselves and members are being reached by email and text instead. Please look into it here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/messages"],
    vars: [flat(c.first), flat(c.link("/admin/messages"))],
  }),
};

const whatsappSignal: TemplateDef = {
  key: "whatsapp_signal",
  audience: "office",
  emailOnly: true,
  title: "Meta has sent news about the church's WhatsApp",
  email: (p, c) => ({
    subject: "Meta has sent news about WhatsApp",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `Meta has told the site something about the church's WhatsApp that needs a person to look: ${flat(p.what, "something changed")}.`,
      "Nothing has been paused by this notice. The health page says what each setting is now and what to do about it.",
    ],
    cta: { label: "Open WhatsApp health", url: c.link("/admin/messages/whatsapp") },
  }),
  sms: (_p, c) => smsLine("Meta has sent news about the church's WhatsApp. Please look at it here:", c.link("/admin/messages/whatsapp")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, Meta has sent news about the church's WhatsApp that needs a person to look. Please open it here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/messages/whatsapp"],
    vars: [flat(c.first), flat(c.link("/admin/messages/whatsapp"))],
  }),
};

const whatsappModeAlert: TemplateDef = {
  key: "whatsapp_mode_alert",
  audience: "office",
  emailOnly: true,
  title: "WhatsApp mode has changed by itself, or the month's cost is near its ceiling",
  email: (p, c) => ({
    subject: "WhatsApp mode needs a look",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      `${flat(p.what, "WhatsApp mode changed")}.`.replace(/\.+$/, "."),
      "Nobody is left out: members are reached by the next channel they agreed to, and anything that cannot be sent is listed for a leader to send by hand.",
      "Open the page below to see what changed, why, and how to put it back.",
    ],
    cta: { label: "Open WhatsApp mode", url: c.link("/admin/messages/whatsapp-mode") },
  }),
  sms: (_p, c) => smsLine("WhatsApp mode has changed. Please look at it here:", c.link("/admin/messages/whatsapp-mode")),
  whatsapp: (_p, c) => ({
    body: "Hi {{1}}, WhatsApp mode has changed and needs a look. Please open it here: {{2}}",
    example: ["Ngozi", "https://unitedtribes.example/admin/messages/whatsapp-mode"],
    vars: [flat(c.first), flat(c.link("/admin/messages/whatsapp-mode"))],
  }),
};

/** The one message sent to try the account: to the person who asked, on WhatsApp only, saying nothing but that it arrived. */
const whatsappTest: TemplateDef = {
  key: "whatsapp_test",
  audience: "office",
  title: "A test message, sent by a person in the office to themselves",
  email: (_p, c) => ({
    subject: "A test message from United Tribes",
    greeting: `Hi ${c.first},`,
    paragraphs: ["This is the test message you asked for. If you can read it, messages from United Tribes are reaching you. You do not need to do anything."],
  }),
  sms: () => "United Tribes: this is the test message you asked for. If you can read it, messages are reaching you.",
  whatsapp: (_p, c) => ({
    body: "Hello {{1}}, this is the test message you asked for from United Tribes. If you can read it, WhatsApp is working. You do not need to do anything.",
    example: ["Ngozi"],
    vars: [flat(c.first)],
  }),
};

export const WHATSAPP_TEMPLATES: TemplateDef[] = [whatsappPaused, whatsappSignal, whatsappModeAlert, whatsappTest];

/** Believable fields for the templates, as the database supplies them. Used by the tests. */
export const WHATSAPP_SAMPLES: Record<string, Params> = {
  whatsapp_paused: { code: 131030, count: 5, minutes: 30 },
  whatsapp_signal: { what: "The message wording ut_welcome is now REJECTED (INVALID_FORMAT)" },
  whatsapp_mode_alert: { what: "WhatsApp mode dropped from Full to Saver: the month's estimate reached US$100" },
  whatsapp_test: {},
};
