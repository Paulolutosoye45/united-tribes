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
};

export type Context = {
  /** The public address of the site, no trailing slash. */
  site: string;
  /** What to call the person: their first name, or a neutral word. */
  first: string;
  link: (path: string) => string;
  /** The page behind the one-tap links of the Friday message. */
  reply: (outcome: "done" | "partly" | "not_yet") => string | null;
};

export type TemplateDef = {
  key: string;
  audience: "member" | "leader" | "coach" | "care" | "applicant" | "referee" | "office" | "guardian";
  /** What this is, for the list of templates and the message log. */
  title: string;
  /** Only ever sent by email (a staff alert): it is never put to Meta for approval. The WhatsApp wording still exists so the type is whole. */
  emailOnly?: boolean;
  email: (p: Params, c: Context) => EmailContent;
  sms: (p: Params, c: Context) => string;
  whatsapp: (p: Params, c: Context) => WhatsAppContent;
};
