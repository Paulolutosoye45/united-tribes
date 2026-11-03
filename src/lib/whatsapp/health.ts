import { whatsappTemplateName } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { ACCOUNT_FAULT_CODES, faultCause, faultFix } from "./faults";
import { keysForTemplateNames } from "./names";

/**
 * The checks behind the WhatsApp health page: ask Meta whether the church's WhatsApp account is set up the way the site needs, and say what is wrong
 * in plain words, with the one thing to do about it.
 *
 * The questions are read-only. Nothing here sends a message, changes a setting at Meta or keeps a token: the access token is read from the
 * environment, used for the questions, and never part of the answer. The answer is a plain list, saved by the database for everyone in the office
 * to read (whatsapp_check_save), so a page load costs Meta nothing.
 */

export type HealthState = "good" | "warn" | "bad" | "unknown";
export type HealthItem = { key: string; title: string; state: HealthState; words: string; fix?: string; list?: string[] };
/** What WhatsApp mode keeps from a check: the message types Meta has filed as Marketing, how Meta rates the number, and how many people it may start talking to in a day. */
export type HealthFacts = { marketing: string[]; quality: string | null; limit: number | null };
export type HealthReport = {
  ok: boolean;
  items: HealthItem[];
  sender: { number: string | null; name: string | null; quality: string | null; tier: string | null; test: boolean } | null;
  facts?: HealthFacts;
};

type Env = Record<string, string | undefined>;
const clean = (v: string | undefined) => (v ?? "").trim();

const NUMBER_FIELDS = "display_phone_number,verified_name,quality_rating,name_status,status,messaging_limit_tier,account_mode";
const NUMBER_FIELDS_PLAIN = "display_phone_number,verified_name,quality_rating";

type Graph = { ok: true; body: Record<string, unknown> } | { ok: false; code?: number; subcode?: number; message: string; status?: number; unreachable?: boolean };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

async function ask(fetcher: typeof fetch, url: string, token: string): Promise<Graph> {
  let res: Response;
  try {
    res = await fetcher(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
  } catch {
    return { ok: false, message: "Meta could not be reached", unreachable: true };
  }
  let body: Record<string, unknown> = {};
  try {
    body = obj(await res.json());
  } catch {
    // no readable body
  }
  if (res.ok) return { ok: true, body };
  const e = obj(body.error);
  return {
    ok: false,
    status: res.status,
    code: typeof e.code === "number" ? e.code : undefined,
    subcode: typeof e.error_subcode === "number" ? e.error_subcode : undefined,
    message: (str(e.message) ?? `HTTP ${res.status}`).slice(0, 200),
  };
}

/** What a refusal from Meta means for a question asked with our token, in words. */
function refusal(g: Extract<Graph, { ok: false }>, what: string): { state: HealthState; words: string; fix: string } {
  if (g.unreachable) return { state: "unknown", words: `Meta could not be reached just now, so ${what} could not be checked.`, fix: "Try again in a minute." };
  const code = g.code ?? g.status;
  if (code !== undefined && (ACCOUNT_FAULT_CODES as readonly number[]).includes(code)) return { state: "bad", words: `Meta refused the question: ${faultCause(code)}.`, fix: faultFix(code) };
  if (g.code === 100) {
    return {
      state: "bad",
      words: `Meta says ${what} is not there, or this access token is not allowed to see it.`,
      fix: "Check the number in WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_ACCOUNT_ID against WhatsApp Manager, and that the token belongs to a system user assigned to this account.",
    };
  }
  return { state: "bad", words: `Meta refused the question (${g.code ? `code ${g.code}` : `HTTP ${g.status ?? "?"}`}).`, fix: "Open WhatsApp Manager and read what it says about the account." };
}

/** The names of the settings the site needs, and which are missing. Names only, never a value. */
export function missingSettings(env: Env): { sending: string[]; checking: string[]; receipts: string[] } {
  const miss = (names: string[]) => names.filter((n) => !clean(env[n]));
  const sending = [
    ...(clean(env.WHATSAPP_PROVIDER).toLowerCase() === "meta" ? [] : ["WHATSAPP_PROVIDER (should be meta)"]),
    ...miss(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"]),
  ];
  return { sending, checking: miss(["WHATSAPP_BUSINESS_ACCOUNT_ID"]), receipts: miss(["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WORKER_TOKEN"]) };
}

/** The wording the church has to have approved at Meta: every WhatsApp template the site can send, by its Meta name. */
export function expectedTemplates(): string[] {
  return Object.values(TEMPLATES)
    .filter((def) => !def.emailOnly && !def.whatsappAs)
    .map((def) => whatsappTemplateName(def.key))
    .sort();
}

/** The number of people a tier lets the number start talking to in a day; no limit gives null. */
export function tierPeople(tier: string | null): number | null {
  const t = (tier ?? "").toUpperCase();
  const m = /^TIER_(\d+)(K)?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

const QUALITY: Record<string, { state: HealthState; words: string }> = {
  GREEN: { state: "good", words: "High quality: people are not reporting the messages." },
  YELLOW: { state: "warn", words: "Medium quality: some people are blocking or reporting the messages. If it falls to Low, Meta will limit sending." },
  RED: { state: "bad", words: "Low quality: many people are blocking or reporting the messages, and Meta may limit or stop sending." },
};

const TIERS: Record<string, { people: string; state: HealthState }> = {
  TIER_50: { people: "50", state: "warn" },
  TIER_250: { people: "250", state: "warn" },
  TIER_1K: { people: "1,000", state: "good" },
  TIER_2K: { people: "2,000", state: "good" },
  TIER_10K: { people: "10,000", state: "good" },
  TIER_100K: { people: "100,000", state: "good" },
  TIER_UNLIMITED: { people: "any number of", state: "good" },
};

/** Meta's own free test number can message five hand-picked phones and nobody else. */
export function looksLikeTestNumber(display: string | null, name: string | null): boolean {
  if (name && /^test number$/i.test(name.trim())) return true;
  const digits = (display ?? "").replace(/\D/g, "");
  return /^1555\d{7}$/.test(digits);
}

/** Asks Meta, and answers. `fetcher` is injected so a test can stand in for Meta. */
export async function runHealthChecks(env: Env = process.env, fetcher: typeof fetch = fetch): Promise<HealthReport> {
  const items: HealthItem[] = [];
  const push = (item: HealthItem) => items.push(item);
  const missing = missingSettings(env);
  const token = clean(env.WHATSAPP_ACCESS_TOKEN);
  const numberId = clean(env.WHATSAPP_PHONE_NUMBER_ID);
  const waba = clean(env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const version = clean(env.WHATSAPP_GRAPH_VERSION) || "v23.0";
  const language = clean(env.WHATSAPP_TEMPLATE_LANGUAGE) || "en";
  const base = (clean(env.WHATSAPP_API_BASE) || "https://graph.facebook.com").replace(/\/+$/, "");
  let sender: HealthReport["sender"] = null;
  const facts: HealthFacts = { marketing: [], quality: null, limit: null };

  // 1. The settings on the website
  if (clean(env.MESSAGING_MODE).toLowerCase() === "log") {
    push({ key: "setup", title: "Settings on the website", state: "bad", words: "MESSAGING_MODE is set to log, so nothing leaves the server: every message is only written down.", fix: "Remove MESSAGING_MODE from the site's settings and redeploy." });
  } else if (missing.sending.length > 0) {
    push({ key: "setup", title: "Settings on the website", state: "bad", words: "WhatsApp is not set up on this site, so every message goes by email or text.", fix: "Add these to the site's hosting settings and redeploy:", list: missing.sending });
  } else if (missing.receipts.length > 0 || missing.checking.length > 0) {
    push({
      key: "setup", title: "Settings on the website", state: "warn",
      words: "Sending is set up, but some settings that checking and receipts need are missing.",
      fix: "Add these to the site's hosting settings and redeploy:", list: [...missing.checking, ...missing.receipts],
    });
  } else {
    push({ key: "setup", title: "Settings on the website", state: "good", words: "Every setting WhatsApp needs is present." });
  }

  if (missing.sending.length > 0 || !token || !numberId) {
    return { ok: false, items, sender };
  }

  // The questions, asked together
  const numberUrl = (fields: string) => `${base}/${version}/${encodeURIComponent(numberId)}?fields=${fields}`;
  const [numberFirst, subscribed, templates] = await Promise.all([
    ask(fetcher, numberUrl(NUMBER_FIELDS), token),
    waba ? ask(fetcher, `${base}/${version}/${encodeURIComponent(waba)}/subscribed_apps`, token) : Promise.resolve(null),
    waba ? allTemplates(fetcher, `${base}/${version}/${encodeURIComponent(waba)}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`, token) : Promise.resolve(null),
  ]);
  // A field Meta does not know gives code 100; ask again for the plain ones.
  const number = !numberFirst.ok && numberFirst.code === 100 && numberFirst.subcode !== 33 ? await ask(fetcher, numberUrl(NUMBER_FIELDS_PLAIN), token) : numberFirst;

  // 2. The access token and the number
  if (!number.ok) {
    const r = refusal(number, "the sending number");
    push({ key: "token", title: "Access token", state: r.state, words: r.words, fix: r.fix });
    push({ key: "number", title: "Sending number", state: "unknown", words: "Not checked, because the question about the token failed." });
  } else {
    push({ key: "token", title: "Access token", state: "good", words: "Meta accepted the access token." });
    const b = number.body;
    const display = str(b.display_phone_number);
    const name = str(b.verified_name);
    const quality = (str(b.quality_rating) ?? "").toUpperCase();
    const nameStatus = (str(b.name_status) ?? "").toUpperCase();
    const status = (str(b.status) ?? "").toUpperCase();
    const tier = (str(b.messaging_limit_tier) ?? "").toUpperCase() || null;
    const test = looksLikeTestNumber(display, name) || (str(b.account_mode) ?? "").toUpperCase() === "SANDBOX";
    sender = { number: display, name, quality: quality || null, tier, test };
    facts.quality = quality || null;
    facts.limit = tierPeople(tier);

    if (test) {
      push({
        key: "number", title: "Sending number", state: "bad",
        words: `${display ?? "The sending number"} is Meta's free test number. It can message only the five phones listed by hand in the app, and everyone else is refused with error 131030.`,
        fix: "Register the church's own number in WhatsApp Manager, then put its Phone number ID in WHATSAPP_PHONE_NUMBER_ID and redeploy.",
      });
    } else if (status && !["CONNECTED", "ACTIVE"].includes(status)) {
      push({
        key: "number", title: "Sending number", state: "bad",
        words: `${display ?? "The sending number"} is ${status.toLowerCase().replace(/_/g, " ")}, so it cannot send.`,
        fix: "Open WhatsApp Manager → Phone numbers and follow what it says about this number.",
      });
    } else {
      const nameBad = nameStatus && !["APPROVED", "AVAILABLE_WITHOUT_REVIEW"].includes(nameStatus);
      push({
        key: "number", title: "Sending number", state: nameBad ? "warn" : "good",
        words: `${display ?? "The sending number"}${name ? ` shows as “${name}”` : ""}${nameBad ? `, but the display name is ${nameStatus.toLowerCase().replace(/_/g, " ")}` : ""}.`,
        ...(nameBad ? { fix: "Open WhatsApp Manager → Phone numbers and finish the display-name review." } : {}),
      });
    }

    const q = QUALITY[quality];
    push(
      q
        ? { key: "quality", title: "Number quality", state: q.state, words: q.words, ...(q.state !== "good" ? { fix: "Send fewer messages to people who have not asked for them, and look at Account quality in WhatsApp Manager." } : {}) }
        : { key: "quality", title: "Number quality", state: "unknown", words: "Meta has not rated this number yet. That is normal for a new number." },
    );

    const t = tier ? TIERS[tier] : undefined;
    push(
      t
        ? {
            key: "limit", title: "How many people it may start talking to a day", state: t.state,
            words: `Meta lets this number start conversations with ${t.people} people in 24 hours.`,
            ...(t.state === "warn" ? { fix: "Complete business verification in Meta Business Settings to raise it." } : {}),
          }
        : { key: "limit", title: "How many people it may start talking to a day", state: "unknown", words: "Meta did not say." },
    );
  }

  // 3. The app's subscription to the account (without it, receipts never arrive)
  if (subscribed === null) {
    push({ key: "subscription", title: "Delivery receipts from Meta", state: "unknown", words: "Not checked: the account ID is missing.", fix: "Add WHATSAPP_BUSINESS_ACCOUNT_ID (the WhatsApp Business Account ID, not the phone number ID) and redeploy." });
  } else if (!subscribed.ok) {
    const r = refusal(subscribed, "the WhatsApp Business Account");
    push({ key: "subscription", title: "Delivery receipts from Meta", state: r.state, words: r.words, fix: r.fix });
  } else if (arr(subscribed.body.data).length === 0) {
    push({
      key: "subscription", title: "Delivery receipts from Meta", state: "bad",
      words: "The app is not subscribed to this WhatsApp account, so Meta will never tell the site that a message arrived.",
      fix: "In the Meta developer dashboard, open WhatsApp → Configuration, set the webhook address and verify token, and subscribe to messages. Or POST to the account's subscribed_apps once.",
    });
  } else {
    push({ key: "subscription", title: "Delivery receipts from Meta", state: "good", words: "The app is subscribed to the account, so Meta can send delivery receipts and news." });
  }

  // 4. The wording Meta has approved
  if (templates === null) {
    push({ key: "templates", title: "Message wording approved by Meta", state: "unknown", words: "Not checked: the account ID is missing.", fix: "Add WHATSAPP_BUSINESS_ACCOUNT_ID and redeploy." });
  } else if (!templates.ok) {
    const r = refusal(templates, "the message wording");
    push({ key: "templates", title: "Message wording approved by Meta", state: r.state, words: r.words, fix: r.fix });
  } else {
    push(templateItem(templates.rows, language));
    facts.marketing = marketingKeys(templates.rows, language);
    const signin = clean(env.WHATSAPP_TEMPLATE_NAME);
    if (signin) push(signInTemplateItem(templates.rows, signin, language));
  }

  return { ok: !items.some((i) => i.state === "bad"), items, sender, facts };
}

/** The message types whose wording Meta has filed as Marketing (which costs more, and which WhatsApp mode therefore keeps off WhatsApp). */
export function marketingKeys(rows: TemplateRow[], language: string): string[] {
  const names = rows.filter((r) => r.language === language && r.status === "APPROVED" && r.category === "MARKETING").map((r) => r.name);
  return keysForTemplateNames(names);
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

type TemplateRow = { name: string; status: string; category: string; language: string; reason: string | null };

async function allTemplates(fetcher: typeof fetch, first: string, token: string): Promise<{ ok: true; rows: TemplateRow[] } | Extract<Graph, { ok: false }>> {
  const rows: TemplateRow[] = [];
  let url: string | null = first;
  for (let page = 0; url && page < 10; page += 1) {
    const g: Graph = await ask(fetcher, url, token);
    if (!g.ok) return g;
    for (const t of arr(g.body.data)) {
      const o = obj(t);
      const name = str(o.name);
      if (name) rows.push({ name, status: (str(o.status) ?? "").toUpperCase(), category: (str(o.category) ?? "").toUpperCase(), language: str(o.language) ?? "", reason: str(o.rejected_reason) });
    }
    const next: string | null = str(obj(g.body.paging).next);
    // Only ever follow a paging address on the same host we asked, so the token is never sent anywhere else.
    url = next && sameHost(next, first) ? next : null;
  }
  return { ok: true, rows };
}

/** Every template the site can send against what Meta has: approved, waiting, refused, paused, missing, or filed under the wrong category. */
export function templateItem(rows: TemplateRow[], language: string): HealthItem {
  const expected = expectedTemplates();
  const have = new Map(rows.filter((r) => r.language === language).map((r) => [r.name, r]));
  const approved: string[] = [];
  const pending: string[] = [];
  const refused: string[] = [];
  const stopped: string[] = [];
  const missing: string[] = [];
  const category: string[] = [];
  for (const name of expected) {
    const r = have.get(name);
    if (!r) missing.push(name);
    else if (r.status === "APPROVED") {
      approved.push(name);
      if (r.category && r.category !== "UTILITY") category.push(`${name} (${r.category.toLowerCase()})`);
    } else if (r.status === "REJECTED") refused.push(`${name}${r.reason && r.reason !== "NONE" ? ` (${r.reason.toLowerCase().replace(/_/g, " ")})` : ""}`);
    else if (r.status === "PAUSED" || r.status === "DISABLED") stopped.push(`${name} (${r.status.toLowerCase()})`);
    else pending.push(name);
  }
  const headline = `${approved.length} of ${expected.length} messages have approved wording.`;
  if (refused.length + stopped.length + missing.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`${missing.length} not sent to Meta yet`);
    if (refused.length) parts.push(`${refused.length} refused`);
    if (stopped.length) parts.push(`${stopped.length} paused or disabled`);
    if (pending.length) parts.push(`${pending.length} waiting for review`);
    return {
      key: "templates", title: "Message wording approved by Meta", state: "bad",
      words: `${headline} ${parts.join(", ")}. Each of those goes by email or text instead.`,
      fix: missing.length ? "Send the missing wording to Meta with: npm run templates -- --submit. Then wait for approval (minutes to a day)." : "Open WhatsApp Manager → Message templates and read why, then edit and resubmit the wording.",
      list: [...refused.map((n) => `Refused: ${n}`), ...stopped.map((n) => `Stopped: ${n}`), ...missing.slice(0, 12).map((n) => `Not sent yet: ${n}`), ...(missing.length > 12 ? [`…and ${missing.length - 12} more not sent yet`] : [])],
    };
  }
  if (pending.length > 0 || category.length > 0) {
    return {
      key: "templates", title: "Message wording approved by Meta", state: "warn",
      words: `${headline}${pending.length ? ` ${pending.length} waiting for Meta to review.` : ""}${category.length ? ` ${category.length} filed by Meta as something other than Utility, which can cost more and need the member's opt-in.` : ""}`,
      fix: pending.length ? "Approval takes minutes to a day. Check again later." : "Open WhatsApp Manager → Message templates and ask for a review of the category, or reword the message.",
      list: [...pending.slice(0, 12).map((n) => `Waiting: ${n}`), ...category.slice(0, 12).map((n) => `Category: ${n}`)],
    };
  }
  return { key: "templates", title: "Message wording approved by Meta", state: "good", words: `${headline} Every one is filed as Utility.` };
}

function signInTemplateItem(rows: TemplateRow[], name: string, language: string): HealthItem {
  const r = rows.find((t) => t.name === name && t.language === language) ?? rows.find((t) => t.name === name);
  if (!r) return { key: "signin_template", title: "Sign-in code wording", state: "bad", words: `The sign-in template “${name}” is not at Meta, so WhatsApp sign-in codes cannot go out.`, fix: "Create the authentication template in WhatsApp Manager under exactly that name, or correct WHATSAPP_TEMPLATE_NAME." };
  if (r.status !== "APPROVED") return { key: "signin_template", title: "Sign-in code wording", state: r.status === "REJECTED" || r.status === "PAUSED" || r.status === "DISABLED" ? "bad" : "warn", words: `The sign-in template “${name}” is ${r.status.toLowerCase()}.`, fix: "Open WhatsApp Manager → Message templates and look at it." };
  if (r.category !== "AUTHENTICATION") return { key: "signin_template", title: "Sign-in code wording", state: "warn", words: `The sign-in template “${name}” is approved as ${r.category.toLowerCase()}, not Authentication.`, fix: "Create it as an Authentication template; Meta fixes its wording and gives it the copy-code button." };
  return { key: "signin_template", title: "Sign-in code wording", state: "good", words: `The sign-in template “${name}” is approved.` };
}
