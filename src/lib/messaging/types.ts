import type { DesignSpec } from "@/lib/outreach/email-design";

export type Channel = "whatsapp" | "email" | "sms";
export type Params = Record<string, unknown>;

export type Recipient = {
  email: string | null;
  phone: string | null;
  name: string | null;
  first_name: string | null;
};

/** A message handed out by the database, ready to be written and sent. */
export type ClaimedMessage = {
  id: string;
  template: string;
  channel: Channel;
  params: Params;
  urgency: "normal" | "urgent";
  attempts: number;
  reply_token: string | null;
  to: Recipient;
};

export type EmailContent = {
  subject: string;
  /** Left out when the message is to someone we only know by address. */
  greeting?: string;
  paragraphs: string[];
  /** A short block set apart (a suggested message to forward, a passage). */
  quote?: string;
  cta?: { label: string; url: string };
  /** Extra links below the button, such as the three answers to the Friday question. */
  options?: { label: string; url: string }[];
  /** Titled lists of links, one part for each thing a person looks after (the daily or weekly summary for the team). Left out in every other email. */
  sections?: { title: string; items: { label: string; url: string; note?: string }[] }[];
  /** A numbered list of steps, each with its words and, when it has one, a picture under them (the leader welcome email). The words come first, so the email is whole when a mail program hides pictures. */
  steps?: { title: string; items: { title: string; body: string; image?: { src: string; alt: string; width: number; height: number } }[] };
  /** Titled bullet lists, such as the promises that come with a role (the leader welcome email). */
  lists?: { title: string; items: string[] }[];
  /** The lines under the button: a name, then a title. */
  signoff?: string[];
  /** A fully designed email (reminders and announcements): used instead of the plain layout, with its own footer. */
  design?: DesignSpec;
  /** Extra mail headers, such as the one-click unsubscribe that mail programs show as a button. */
  headers?: Record<string, string>;
};

export type WhatsAppContent = {
  /** Fixed wording submitted to Meta for approval. {{1}}, {{2}}... are filled from `vars`. */
  body: string;
  /** What each variable looks like, so Meta (and a reader) can see how the message will read. */
  example: string[];
  vars: string[];
  /** Quick-reply buttons: the answer is sent back to us without the person typing. */
  quickReplies?: string[];
  /**
   * One button that opens a private link. Meta fixes the address when the template is approved and lets one piece of it vary: `prefix` is the
   * fixed part, `token` the part that changes for each message, `example` what it looks like for the reviewer.
   */
  urlButton?: { label: string; prefix: string; token: string; example: string };
};

export type Context = {
  /** The public address of the site, no trailing slash. */
  site: string;
  /** What to call the person: their first name, or a neutral word. */
  first: string;
  link: (path: string) => string;
  /** The page behind the one-tap links of the Friday message. */
  reply: (outcome: "done" | "partly" | "not_yet") => string | null;
  /** The private link riding on this message, when it has one (the Details Check). Left out where a context is made without a message. */
  token?: string | null;
};

export type TemplateDef = {
  key: string;
  audience: "member" | "leader" | "coach" | "care" | "applicant" | "referee" | "office" | "guardian" | "invitee";
  /** What this is, for the list of templates and the message log. */
  title: string;
  /** Only ever sent by email (a staff alert): it is never put to Meta for approval. The WhatsApp wording still exists so the type is whole. */
  emailOnly?: boolean;
  /** Sent on WhatsApp under another template's name and wording (a reminder reuses the approved one), so it is never put to Meta on its own. */
  whatsappAs?: string;
  email: (p: Params, c: Context) => EmailContent;
  sms: (p: Params, c: Context) => string;
  whatsapp: (p: Params, c: Context) => WhatsAppContent;
};
