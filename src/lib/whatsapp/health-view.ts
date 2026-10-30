import type { HealthItem, HealthReport, HealthState } from "./health";

// What the WhatsApp health page reads (whatsapp_health_overview), and every sentence it says about it. The database builds the data and checks who
// may see it; this reads it defensively and puts it in words.

export type HealthView = {
  canCheck: boolean;
  canTest: boolean;
  paused: boolean;
  unconfirmedHours: number;
  check: { at: string; by: string | null; report: HealthReport | null } | null;
  week: { reached: number; read: number; waiting: number; silent: number; inQueue: number };
  movedOn: { cause: string; n: number }[];
  countedSince: string | null;
  lastReceiptAt: string | null;
  lastSentAt: string | null;
  signals: { at: string; kind: string; subject: string; status: string; detail: string | null }[];
  test: { id: string; status: string; at: string; cause: string | null } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const STATES = new Set<string>(["good", "warn", "bad", "unknown"]);

/** The saved answer of the checks, or null when it is not in the shape the checks give. */
export function parseReport(v: unknown): HealthReport | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null;
  const items: HealthItem[] = v.items.flatMap((x): HealthItem[] => {
    if (!isObj(x) || typeof x.key !== "string" || typeof x.title !== "string" || typeof x.words !== "string" || typeof x.state !== "string" || !STATES.has(x.state)) return [];
    return [{ key: x.key, title: x.title, state: x.state as HealthState, words: x.words, ...(str(x.fix) ? { fix: str(x.fix)! } : {}), ...(Array.isArray(x.list) ? { list: x.list.filter((l): l is string => typeof l === "string") } : {}) }];
  });
  const s = isObj(v.sender) ? v.sender : null;
  return {
    ok: v.ok === true,
    items,
    sender: s ? { number: str(s.number), name: str(s.name), quality: str(s.quality), tier: str(s.tier), test: s.test === true } : null,
  };
}

/** Anything but a page that is On, or a shape not expected, is nothing: the Messages page then shows nothing new, as it does while the page is Off. */
export function parseHealthView(v: unknown): HealthView | null {
  if (!isObj(v) || v.state !== "on") return null;
  const w = isObj(v.week) ? v.week : {};
  const c = isObj(v.check) && typeof v.check.at === "string" ? v.check : null;
  const t = isObj(v.test) && typeof v.test.id === "string" && typeof v.test.status === "string" && typeof v.test.at === "string" ? v.test : null;
  return {
    canCheck: v.canCheck === true,
    canTest: v.canTest === true,
    paused: v.paused === true,
    unconfirmedHours: num(v.unconfirmedHours, 24),
    check: c ? { at: c.at as string, by: str(c.by), report: parseReport(c.result) } : null,
    week: { reached: num(w.reached), read: num(w.read), waiting: num(w.waiting), silent: num(w.silent), inQueue: num(w.inQueue) },
    movedOn: arr(v.movedOn).flatMap((x) => (isObj(x) && typeof x.cause === "string" ? [{ cause: x.cause, n: num(x.n) }] : [])),
    countedSince: str(v.countedSince),
    lastReceiptAt: str(v.lastReceiptAt),
    lastSentAt: str(v.lastSentAt),
    signals: arr(v.signals).flatMap((x) =>
      isObj(x) && typeof x.at === "string" && typeof x.kind === "string" && typeof x.subject === "string" && typeof x.status === "string"
        ? [{ at: x.at, kind: x.kind, subject: x.subject, status: x.status, detail: str(x.detail) }]
        : [],
    ),
    test: t ? { id: t.id as string, status: t.status as string, at: t.at as string, cause: str(t.cause) } : null,
  };
}

/** Why a WhatsApp message was given up on, in words, and what (if anything) to do. */
export const CAUSE_WORDS: Record<string, { label: string; fix: string }> = {
  token: { label: "The access token is expired or not allowed", fix: "Make a new system-user token, put it in WHATSAPP_ACCESS_TOKEN and redeploy." },
  test_number: { label: "Sent from Meta’s test number to a phone not on its list", fix: "Register the church’s own number in WhatsApp Manager and use its Phone number ID in WHATSAPP_PHONE_NUMBER_ID." },
  locked: { label: "The WhatsApp account is locked or blocked", fix: "Open WhatsApp Manager and follow what it says." },
  payment: { label: "A payment problem on the WhatsApp account", fix: "Open WhatsApp Manager → Payment settings." },
  not_registered: { label: "The sending number is not registered", fix: "Finish registering the number on the app’s API Setup page." },
  display_name: { label: "The display name is waiting for approval", fix: "Open WhatsApp Manager → Phone numbers and finish the review." },
  not_on_whatsapp: { label: "The person’s number is not on WhatsApp", fix: "Nothing to fix: they get the message by email or text." },
  held_back: { label: "Meta chose not to deliver it, to protect the person", fix: "Nothing to fix on the site. Meta does this when a person has had many messages." },
  person_limit: { label: "Too many messages to that person in a day", fix: "Nothing to fix: they get it by email or text." },
  rate_limit: { label: "Meta asked the site to slow down", fix: "It sorts itself out. If it keeps happening, send fewer messages at once." },
  to_itself: { label: "Sent to the sending number itself", fix: "Check the number saved on that person’s profile." },
  template_missing: { label: "The wording is not approved at Meta, or the name differs", fix: "Run npm run templates -- --status, then --submit for what is missing." },
  template_wrong: { label: "The wording and what the site sends do not match", fix: "Compare the template at Meta with the one in the site; resubmit under a new name if the wording changed." },
  template_paused: { label: "Meta has paused or disabled the wording", fix: "Open WhatsApp Manager → Message templates and read why." },
  unreachable: { label: "Meta could not be reached", fix: "Usually a passing fault. If it persists, check the site’s outbound network." },
  no_number: { label: "The person has no phone number saved", fix: "Nothing to fix: they get it by email." },
  other: { label: "Another reason", fix: "Open the message log: it shows the exact words from Meta." },
  unknown: { label: "No reason was kept", fix: "Open the message log." },
};

export const causeWords = (cause: string | null) => CAUSE_WORDS[cause ?? "unknown"] ?? CAUSE_WORDS.other;

/** How the test message is getting on, in words. */
export function testWords(t: NonNullable<HealthView["test"]>): { state: HealthState; words: string } {
  switch (t.status) {
    case "queued":
      return { state: "unknown", words: "Waiting to go out. Messages leave on the next run, within a few minutes." };
    case "sending":
      return { state: "unknown", words: "Being sent to Meta now." };
    case "sent":
      return { state: "warn", words: "Meta accepted it. Waiting for WhatsApp to confirm it arrived. Look at your phone." };
    case "delivered":
    case "read":
      return { state: "good", words: "It arrived on your phone. WhatsApp is working." };
    case "failed":
    case "skipped":
      return { state: "bad", words: `It did not go: ${causeWords(t.cause).label.toLowerCase()}. ${causeWords(t.cause).fix}` };
    default:
      return { state: "unknown", words: "Waiting." };
  }
}

/** Are Meta’s delivery receipts coming back? From when the last message went out and when the last receipt came in. */
export function receiptWords(v: HealthView, now = Date.now()): { state: HealthState; words: string; fix?: string } {
  const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const sent = ms(v.lastSentAt);
  const got = ms(v.lastReceiptAt);
  const limit = v.unconfirmedHours * 3_600_000;
  if (Number.isNaN(sent)) return { state: "unknown", words: "No WhatsApp message has gone out in the last 30 days, so there is nothing to confirm yet." };
  if (Number.isNaN(got)) {
    return now - sent > limit
      ? { state: "bad", words: "WhatsApp messages have gone out, but no delivery receipt has ever come back.", fix: "Meta cannot reach the site’s webhook. Check the webhook address, the verify token and WHATSAPP_APP_SECRET, and that the app is subscribed." }
      : { state: "warn", words: "WhatsApp messages have gone out, but no receipt has come back yet. It is too early to tell." };
  }
  if (now - got > limit && sent > got) {
    return { state: "bad", words: "Messages are going out, but receipts stopped coming back.", fix: "Check the webhook address and the app’s subscription in the Meta developer dashboard." };
  }
  return { state: "good", words: "Delivery receipts are coming back." };
}

/** One piece of news from Meta, in a line. */
export function signalWords(s: HealthView["signals"][number]): string {
  const status = s.status.toLowerCase().replace(/_/g, " ");
  if (s.kind === "template") return s.status.startsWith("CATEGORY_") ? `${s.subject} is now filed as ${s.status.slice(9).toLowerCase()}${s.detail ? ` (${s.detail})` : ""}` : `${s.subject} is ${status}${s.detail ? ` (${s.detail.toLowerCase().replace(/_/g, " ")})` : ""}`;
  if (s.kind === "quality") return `The number ${s.subject}: ${status}${s.detail ? `, now ${s.detail.toLowerCase().replace(/_/g, " ")}` : ""}`;
  return `${s.subject === "account" ? "The account" : s.subject}: ${status}${s.detail ? ` (${s.detail.toLowerCase().replace(/_/g, " ")})` : ""}`;
}
