import { flat, num, smsLine } from "./format";
import type { Context, Params, TemplateDef } from "./types";

/**
 * The messages of the Details Check (Profiles and the Weekly Rhythm, stage 1): a short request, a reminder, and the six-digit code for a
 * person with no account.
 *
 * Rules the wording keeps, and the tests check:
 *   - no message carries a personal fact. Not the stage of life, not an age range, not what the office has down for the person. The page
 *     shows that, after the person is let in
 *   - the request and the reminder carry one private link (a button), made for this person and this run, and nothing else that opens anything
 *   - the code goes in a message of its own, never in the one that carries the link, and never over WhatsApp: the link may sit in a chat, and a
 *     code beside it would be no second check at all. It goes by email or text, and the template is never put to Meta
 *   - the reminder is sent on WhatsApp under the request's own approved wording, so Meta is asked about one template, not two
 *   - everything is short, in the voice of someone in the church office, with one thing to press
 */

/** The page the private link opens. Without a link (it has been forgotten, or the message is a preview) the person is sent to My page. */
const here = (c: Context) => (c.token ? c.link(`/details/${c.token}`) : c.link("/my"));

const facts = (p: Params) => Math.min(3, Math.max(1, Math.round(num(p.facts, 1))));
const askLine = (p: Params) =>
  facts(p) === 1
    ? "There is one thing for you to check. You press a button to say it is right, or choose another."
    : `There are ${facts(p)} things for you to check. For each, you press a button to say it is right, or choose another.`;

/** The WhatsApp wording of the request. The reminder uses exactly this, so one template is approved for both. */
const request = (p: Params, c: Context) => ({
  body: "Hello {{1}}, please check the details we hold for your tribe. It takes under a minute.",
  example: ["Ada"],
  vars: [flat(c.first)],
  urlButton: { label: "Confirm details", prefix: c.link("/details/"), token: c.token ?? "none", example: "4f9d2c71a0b8e356" },
});

const detailsRequest: TemplateDef = {
  key: "details_check_request",
  audience: "leader",
  title: "A request to check the details held for a tribe",
  email: (p, c) => ({
    subject: "Please check the details we hold for your tribe",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "The church office keeps a few details about your tribe so that it can look after it well. We would like you to check them, which takes under a minute.",
      askLine(p),
      "The button below is just for you. Nothing changes until you press a button on the page.",
    ],
    cta: { label: "Confirm your details", url: here(c) },
  }),
  sms: (_p, c) => smsLine("United Tribes: please check the details we hold for your tribe. It takes under a minute.", here(c)),
  whatsapp: request,
};

const detailsReminder: TemplateDef = {
  key: "details_check_reminder",
  audience: "leader",
  title: "A reminder to check the details held for a tribe",
  whatsappAs: "details_check_request",
  email: (p, c) => ({
    subject: "A reminder: please check the details for your tribe",
    greeting: `Hi ${c.first},`,
    paragraphs: [
      "A few days ago the church office asked you to check the details we hold for your tribe. It still takes under a minute, and the button below is a new one, just for you.",
      askLine(p),
    ],
    cta: { label: "Confirm your details", url: here(c) },
  }),
  sms: (_p, c) => smsLine("United Tribes: a reminder to check the details we hold for your tribe. It takes under a minute.", here(c)),
  whatsapp: request,
};

const detailsCode: TemplateDef = {
  key: "details_check_code",
  audience: "leader",
  title: "A six-digit code to open a private link",
  // Never put to Meta, and never sent on WhatsApp (the database chooses email or text). The wording below exists so the type is whole.
  emailOnly: true,
  email: (p) => ({
    subject: `${flat(p.code, "")} is your United Tribes code`.trim(),
    paragraphs: [
      `Your code is ${flat(p.code, "")}.`,
      `Type it on the page where you opened your private link. It works for ${num(p.minutes, 10)} minutes and only once.`,
      "If you did not ask for this, ignore it. Nobody can use the code without your private link.",
    ],
  }),
  sms: (p) => `United Tribes code: ${flat(p.code, "")}. It lasts ${num(p.minutes, 10)} minutes. Do not share it.`,
  whatsapp: (p) => ({
    body: "Your United Tribes code is {{1}}. It lasts {{2}} minutes. Please do not share it with anyone.",
    example: ["482913", "10"],
    vars: [flat(p.code), flat(num(p.minutes, 10))],
  }),
};

export const DETAILS_TEMPLATES: TemplateDef[] = [detailsRequest, detailsReminder, detailsCode];

/** Believable fields for the templates, as the database supplies them. Used by the tests. */
export const DETAILS_SAMPLES: Record<string, Params> = {
  details_check_request: { facts: 1 },
  details_check_reminder: { facts: 2 },
  details_check_code: { code: "482913", minutes: 10 },
};
