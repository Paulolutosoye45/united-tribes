import { formatLagosDay, formatLagosTime } from "@/lib/dates";
import { designedHtml, designedText } from "@/lib/outreach/email-design";
import { flat } from "./format";
import { TEMPLATES } from "./templates";
import type { ClaimedMessage, Context, EmailContent, Params, TemplateDef } from "./types";

/** The brand colours of The Covenant Nation, as used across the app. */
const COLOUR = { flame: "#e86838", gold: "#f4c443", charcoal: "#2e2e2b", ink: "#1a1917", paper: "#fbf8f3", rule: "#e8e1d6", soft: "#6b665e" } as const;

export class UnknownTemplate extends Error {
  constructor(readonly key: string) {
    super(`No template named "${key}"`);
  }
}

export function templateFor(key: string): TemplateDef {
  const def = TEMPLATES[key];
  if (!def) throw new UnknownTemplate(key);
  return def;
}

/** Fills in what the database leaves as raw values, such as a time that needs writing as a day and hour. */
export function prepareParams(params: Params): Params {
  const out: Params = { ...params };
  if (typeof out.starts_at === "string" && !out.starts_at_label) {
    const when = new Date(out.starts_at);
    if (!Number.isNaN(when.getTime())) out.starts_at_label = `${formatLagosDay(out.starts_at)}, ${formatLagosTime(out.starts_at)}`;
  }
  return out;
}

export function buildContext(msg: ClaimedMessage, site: string): Context {
  const base = site.replace(/\/+$/, "");
  const first = (msg.to.first_name ?? "").trim() || (msg.to.name ?? "").trim().split(/\s+/)[0] || "there";
  return {
    site: base,
    first,
    link: (path) => `${base}${path.startsWith("/") ? path : `/${path}`}`,
    reply: (outcome) => (msg.reply_token ? `${base}/r/${msg.reply_token}?o=${outcome}` : null),
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export type RenderedEmail = { subject: string; html: string; text: string; headers?: Record<string, string> };

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Turns bare web addresses in a sentence into links, after the text has been escaped. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}" style="color:${COLOUR.flame};word-break:break-all">${url}</a>`);
}

const safeUrl = (url: string) => (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(url) ? url : "");

function footerFor(def: TemplateDef, c: Context): { html: string; text: string } {
  if (def.audience === "referee") {
    const line = "You are receiving this because someone named you as a referee. We will not email you again about this.";
    return { html: escapeHtml(line), text: line };
  }
  if (def.audience === "invitee") {
    const line = "You are receiving this because someone at The Covenant Nation invited this address to United Tribes. If you were not expecting it, ignore it: nothing happens unless you sign in.";
    return { html: escapeHtml(line), text: line };
  }
  const line = "You are receiving this as part of United Tribes at The Covenant Nation.";
  const settings = c.link("/profile");
  return {
    html: `${escapeHtml(line)} <a href="${escapeHtml(settings)}" style="color:${COLOUR.soft}">Change how we reach you</a>.`,
    text: `${line}\nChange how we reach you: ${settings}`,
  };
}

export function emailBody(def: TemplateDef, content: EmailContent, c: Context): { html: string; text: string } {
  if (content.design) return { html: designedHtml(content.design), text: designedText(content.design) };
  const footer = footerFor(def, c);
  const paragraphs = content.paragraphs.map((p) => p.trim()).filter(Boolean);
  const cta = content.cta && safeUrl(content.cta.url) ? content.cta : undefined;
  const options = (content.options ?? []).filter((o) => safeUrl(o.url));
  const sections = (content.sections ?? [])
    .map((s) => ({ title: s.title, items: s.items.filter((i) => safeUrl(i.url)) }))
    .filter((s) => s.items.length > 0);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:${COLOUR.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOUR.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOUR.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${COLOUR.charcoal}"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLOUR.flame};margin-right:8px"></span>United Tribes</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${COLOUR.rule};border-radius:16px;padding:28px 26px;border-top:4px solid ${COLOUR.flame}">
${content.greeting ? `<p style="margin:0 0 16px;font-size:17px;line-height:1.5;font-weight:600">${escapeHtml(content.greeting)}</p>` : ""}
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6">${linkify(escapeHtml(p))}</p>`).join("\n")}
${sections.map((s) => `<p style="margin:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${COLOUR.soft}">${escapeHtml(s.title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px">${s.items.map((i) => `<tr><td style="padding:9px 0;border-top:1px solid ${COLOUR.rule};font-size:15px;line-height:1.45"><a href="${escapeHtml(i.url)}" style="color:${COLOUR.ink};text-decoration:none;font-weight:600">${escapeHtml(i.label)}</a>${i.note ? `<span style="color:${COLOUR.soft}"> · ${escapeHtml(i.note)}</span>` : ""}</td></tr>`).join("")}</table>`).join("\n")}
${content.quote ? `<blockquote style="margin:6px 0 18px;padding:12px 16px;border-left:4px solid ${COLOUR.gold};background:${COLOUR.paper};font-size:15px;line-height:1.6;white-space:pre-line">${linkify(escapeHtml(content.quote))}</blockquote>` : ""}
${options.length > 0 ? `<p style="margin:6px 0 18px">${options.map((o) => `<a href="${escapeHtml(o.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border:2px solid ${COLOUR.charcoal};border-radius:999px;color:${COLOUR.charcoal};text-decoration:none;font-weight:700;font-size:15px">${escapeHtml(o.label)}</a>`).join("")}</p>` : ""}
${cta ? `<p style="margin:8px 0 4px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 24px;background:${COLOUR.flame};border-radius:999px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px">${escapeHtml(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.6;color:${COLOUR.soft}">${footer.html}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    content.greeting,
    ...paragraphs,
    ...sections.map((s) => [s.title.toUpperCase(), ...s.items.map((i) => `- ${i.label}${i.note ? ` (${i.note})` : ""}: ${i.url}`)].join("\n")),
    content.quote ? `---\n${content.quote}\n---` : undefined,
    ...options.map((o) => `${o.label}: ${o.url}`),
    cta ? `${cta.label}: ${cta.url}` : undefined,
    `\n${footer.text}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return { html, text };
}

export function renderEmail(msg: ClaimedMessage, site: string): RenderedEmail {
  const def = templateFor(msg.template);
  const c = buildContext(msg, site);
  const content = def.email(prepareParams(msg.params), c);
  const { html, text } = emailBody(def, content, c);
  // A subject is one short line.
  return { subject: flat(content.subject, "United Tribes").slice(0, 150), html, text, ...(content.headers ? { headers: content.headers } : {}) };
}

// ---------------------------------------------------------------------------
// Text message
// ---------------------------------------------------------------------------

export function renderSms(msg: ClaimedMessage, site: string): string {
  const def = templateFor(msg.template);
  const c = buildContext(msg, site);
  // The sender name is added by the provider; keep the text itself plain and short.
  return def.sms(prepareParams(msg.params), c).replace(/\s+\n/g, "\n").trim();
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * The name a template is registered under at Meta: lowercase letters, digits and underscores only. WHATSAPP_TEMPLATE_SUFFIX (for example "_v2") lets a reworded set be
 * registered and approved beside the current one, then switched on by changing the setting. Left empty, the names are
 * exactly what they have always been, so WhatsApp keeps working while new wording waits for approval.
 */
export const whatsappTemplateName = (key: string) => `ut_${key}${process.env.WHATSAPP_TEMPLATE_SUFFIX ?? ""}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

export const QUICK_REPLY_OUTCOMES = ["done", "partly", "not_yet"] as const;

export type RenderedWhatsApp = {
  name: string;
  vars: string[];
  /** One entry per quick-reply button, in order: what comes back to us when the person taps it. */
  quickReplyPayloads: string[];
};

export function renderWhatsApp(msg: ClaimedMessage, site: string): RenderedWhatsApp {
  const def = templateFor(msg.template);
  const c = buildContext(msg, site);
  const content = def.whatsapp(prepareParams(msg.params), c);
  const quick = content.quickReplies ?? [];
  const payloads = quick.map((_label, index) =>
    msg.reply_token ? `ck:${msg.reply_token}:${QUICK_REPLY_OUTCOMES[index] ?? "done"}` : `noop:${index}`,
  );
  // Meta rejects a variable with line breaks, tabs, or more than four spaces in a row, and any empty one.
  return {
    name: whatsappTemplateName(def.key),
    vars: content.vars.map((v) => flat(v).slice(0, 600)),
    quickReplyPayloads: payloads,
  };
}

/** What `npm run templates` submits to Meta for approval, one per template. */
export function metaTemplateDefinition(def: TemplateDef, language: string, sample: Context) {
  const content = def.whatsapp({}, sample);
  const components: unknown[] = [
    {
      type: "BODY",
      text: content.body,
      ...(content.example.length > 0 ? { example: { body_text: [content.example] } } : {}),
    },
  ];
  if (content.quickReplies?.length) {
    components.push({ type: "BUTTONS", buttons: content.quickReplies.map((text) => ({ type: "QUICK_REPLY", text })) });
  }
  return {
    name: whatsappTemplateName(def.key),
    language,
    category: "UTILITY",
    components,
  };
}
