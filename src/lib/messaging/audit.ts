import fs from "node:fs";
import path from "node:path";
import { buildContext, emailBody, prepareParams, whatsappTemplateName } from "./render";
import { TEMPLATES } from "./templates";
import type { ClaimedMessage, Params } from "./types";

/**
 * The audit of every message the platform can send.
 *
 * For each template it renders the email, the text message and the WhatsApp wording from believable fields (the caller supplies them), then
 * checks what a person at the church office would check by eye: nothing left unfilled, a subject that fits one line, a text message that fits two,
 * WhatsApp wording Meta can approve, every link an https address (and which ones leave the site), and which part of the platform queues it. It
 * also checks the other way: every message the database queues by name must be a message that exists.
 *
 * `npm run messages-audit` writes docs/MESSAGES-AUDIT.md from this. A test fails when a check fails or when the file on disk is not what this says.
 */

export type AuditRow = {
  key: string;
  title: string;
  audience: string;
  subject: string;
  emailWords: number;
  smsChars: number;
  whatsapp: { name: string; reuses: string | null; emailOnly: boolean; variables: number; bodyChars: number; buttons: number };
  links: { site: number; other: number };
  queuedBy: string[];
  problems: string[];
};

export type Audit = {
  rows: AuditRow[];
  /** Messages the database queues by name that no template defines. */
  queuedButMissing: { key: string; file: string }[];
  /** Templates nothing queues by name (some are queued from a generic function, and are listed so a person can look). */
  notQueuedByName: string[];
};

const SITE = "https://unitedtribes.example";
const LEFTOVER = /\{\{|\}\}|\bundefined\b|\bnull\b|\bNaN\b|\[object /;
const URL_RE = /https?:\/\/[^\s)>"'<]+/g;
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function message(template: string, params: Params, channel: ClaimedMessage["channel"]): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel,
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: "a".repeat(64),
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
  };
}

/** Every `enqueue_message(` in the migrations, and the names of messages written within the next few lines. */
export function scanQueued(root: string, keys: string[]): { byKey: Map<string, Set<string>>; found: { key: string; file: string }[] } {
  const known = new Set(keys);
  const byKey = new Map<string, Set<string>>();
  const found: { key: string; file: string }[] = [];
  const dir = path.join(root, "supabase/migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of text.matchAll(/enqueue_message\(\s*[\w.$()'\[\]\- ]+?,\s*'([a-z0-9_]+)'/g)) {
      found.push({ key: m[1], file: f });
      if (known.has(m[1])) byKey.set(m[1], (byKey.get(m[1]) ?? new Set()).add("database"));
    }
    // A name written in a list or a variable close after the call (the notices pick theirs from a table)
    for (const m of text.matchAll(/enqueue_message\(/g)) {
      const near = text.slice(m.index, (m.index ?? 0) + 400);
      for (const q of near.matchAll(/'([a-z][a-z0-9_]+)'/g)) if (known.has(q[1])) byKey.set(q[1], (byKey.get(q[1]) ?? new Set()).add("database"));
    }
  }
  // The application: a template named in code that is not a template's own file
  const walk = (d: string, out: string[] = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  for (const file of walk(path.join(root, "src"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel.startsWith("src/lib/messaging/templates") || rel === "src/lib/messaging/audit.ts") continue;
    const text = fs.readFileSync(file, "utf8");
    for (const key of keys) if (text.includes(`"${key}"`) || text.includes(`'${key}'`)) byKey.set(key, (byKey.get(key) ?? new Set()).add("app"));
  }
  return { byKey, found };
}

export function auditMessages(root: string, sample: (template: string) => Params): Audit {
  const keys = Object.keys(TEMPLATES).sort();
  const { byKey, found } = scanQueued(root, keys);
  const rows: AuditRow[] = [];
  for (const key of keys) {
    const def = TEMPLATES[key];
    const params = prepareParams(sample(key));
    const c = buildContext(message(key, params, "email"), SITE);
    const problems: string[] = [];

    const email = def.email(params, c);
    const { text: emailText } = emailBody(def, email, c);
    const sms = def.sms(params, c).replace(/\s+\n/g, "\n").trim();
    const wa = def.whatsapp(params, c);

    // Nothing left unfilled, in any channel
    const filledWa = wa.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => wa.vars[Number(n) - 1] ?? "");
    for (const [where, text] of [["subject", email.subject], ["email", emailText], ["text message", sms], ["WhatsApp", `${filledWa} ${wa.vars.join(" ")}`]] as const) {
      if (LEFTOVER.test(text)) problems.push(`${where} has something unfilled (${(text.match(LEFTOVER) ?? [""])[0]})`);
    }
    if (email.subject.trim().length < 5) problems.push("the subject is empty or too short");
    if (email.subject.length > 120) problems.push("the subject does not fit one line");
    if (sms.length === 0) problems.push("the text message is empty");
    if (sms.length > 320) problems.push(`the text message is ${sms.length} characters, more than two messages`);

    // WhatsApp wording Meta can approve
    const slots = [...wa.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const expected = Array.from({ length: slots.length }, (_x, i) => i + 1);
    if (JSON.stringify(slots) !== JSON.stringify(expected)) problems.push("WhatsApp variables are not numbered 1, 2, 3 in order");
    if (wa.vars.length !== slots.length || (wa.example.length !== slots.length && wa.example.length > 0)) problems.push("WhatsApp variables, examples and placeholders do not match in number");
    if (wa.vars.some((v) => v.trim() === "")) problems.push("a WhatsApp variable is empty");
    if (wa.body.length > 1024) problems.push("the WhatsApp wording is longer than Meta allows");
    // Meta refuses a body that starts or ends with a variable (every message ends with the sign-off, which is added when one would)
    if (/^\s*\{\{\d+\}\}/.test(wa.body) || /\{\{\d+\}\}[.!?]?\s*$/.test(wa.body)) problems.push("the WhatsApp wording starts or ends with a variable");

    // Links: every one https, and which leave the site
    const urls = [...new Set([...emailText.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;]+$/, "")))];
    let site = 0;
    let other = 0;
    for (const u of urls) {
      if (u.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(u)) problems.push(`a link is not https (${clip(u, 50)})`);
      if (u.startsWith(SITE)) site++;
      else other++;
    }

    rows.push({
      key,
      title: def.title,
      audience: def.audience,
      subject: email.subject,
      emailWords: emailText.split(/\s+/).filter(Boolean).length,
      smsChars: sms.length,
      whatsapp: {
        name: whatsappTemplateName(def.whatsappAs ?? def.key),
        reuses: def.whatsappAs ?? null,
        emailOnly: def.emailOnly === true,
        variables: slots.length,
        bodyChars: wa.body.length,
        buttons: (wa.quickReplies?.length ?? 0) + (wa.urlButton ? 1 : 0),
      },
      links: { site, other },
      queuedBy: [...(byKey.get(key) ?? [])].sort(),
      problems,
    });
  }
  const known = new Set(keys);
  return {
    rows,
    queuedButMissing: found.filter((f) => !known.has(f.key)).sort((a, b) => a.key.localeCompare(b.key)),
    notQueuedByName: rows.filter((r) => r.queuedBy.length === 0).map((r) => r.key),
  };
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** docs/MESSAGES-AUDIT.md */
export function auditMarkdown(a: Audit): string {
  const problems = a.rows.filter((r) => r.problems.length > 0);
  const byAudience = new Map<string, number>();
  for (const r of a.rows) byAudience.set(r.audience, (byAudience.get(r.audience) ?? 0) + 1);
  const out: string[] = [
    "# Every message the platform can send",
    "",
    "*Written by `npm run messages-audit` from the templates in `src/lib/messaging`. Do not edit it here; change the template and run the command again. A test fails when a check below fails or when this file is out of date.*",
    "",
    `**${a.rows.length} messages**, ${[...byAudience].sort().map(([k, n]) => `${n} for ${k}`).join(", ")}.`,
    "",
    "Each message is written out from believable details and checked for what the office would check by eye:",
    "",
    "1. nothing left unfilled (no `{{ }}`, `undefined`, `null` or `NaN`) in the subject, the email, the text message or the WhatsApp wording;",
    "2. a subject that fits one line, and a text message that fits two;",
    "3. WhatsApp wording Meta can approve: variables numbered in order, one example for each, under 1,024 characters;",
    "4. every link in the email an https address, and a count of how many go to another site (a meeting room, a chat group);",
    "5. which part of the platform queues it, and the other way round: every message the database queues by name must exist.",
    "",
    `**Result: ${problems.length === 0 ? "every check passes" : `${problems.length} message${problems.length === 1 ? "" : "s"} to look at`}.** Messages the database queues that have no template: ${a.queuedButMissing.length === 0 ? "none" : a.queuedButMissing.map((m) => `\`${m.key}\` (${m.file})`).join(", ")}.`,
    "",
  ];
  if (problems.length > 0) {
    out.push("## To look at", "", ...problems.flatMap((r) => r.problems.map((p) => `- \`${r.key}\`: ${p}`)), "");
  }
  const sections = [...new Set(a.rows.map((r) => r.audience))].sort();
  for (const audience of sections) {
    out.push(`## For ${audience}`, "", "| Message | What it is | Subject | Email words | Text characters | WhatsApp name | Links (site / other) | Queued by |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of a.rows.filter((x) => x.audience === audience)) {
      const w = r.whatsapp;
      const wa = w.emailOnly ? "email only" : w.reuses ? `\`${w.name}\` (reused)` : `\`${w.name}\`${w.buttons ? ` +${w.buttons} button${w.buttons > 1 ? "s" : ""}` : ""}`;
      out.push(`| \`${r.key}\` | ${esc(r.title)} | ${esc(clip(r.subject, 60))} | ${r.emailWords} | ${r.smsChars} | ${wa} | ${r.links.site} / ${r.links.other} | ${r.queuedBy.join(", ") || "—"} |`);
    }
    out.push("");
  }
  out.push(
    "## Messages nothing queues by name",
    "",
    a.notQueuedByName.length === 0
      ? "None."
      : `${a.notQueuedByName.length} of the messages are not named in any database function or application file as a quoted name. Most are queued from a generic function that builds the name (the notices, the reminders), and a person can confirm each by looking where the message log shows it: ${a.notQueuedByName.map((k) => `\`${k}\``).join(", ")}.`,
    "",
  );
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
