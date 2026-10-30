import { describe, expect, it, vi } from "vitest";
import { whatsappTemplateName } from "@/lib/messaging/render";
import { expectedTemplates, looksLikeTestNumber, missingSettings, runHealthChecks, templateItem } from "@/lib/whatsapp/health";
import { causeWords, parseHealthView, parseReport, receiptWords, signalWords, testWords, CAUSE_WORDS } from "@/lib/whatsapp/health-view";
import { readFileSync } from "node:fs";

// The checks behind the WhatsApp health page, against a stand-in for Meta, and how the page reads what the database keeps.

const ENV = {
  WHATSAPP_PROVIDER: "meta",
  WHATSAPP_PHONE_NUMBER_ID: "1050000000001",
  WHATSAPP_ACCESS_TOKEN: "EAAG-the-secret-token-value",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "2090000000002",
  WHATSAPP_APP_SECRET: "app-secret",
  WHATSAPP_VERIFY_TOKEN: "verify",
  WORKER_TOKEN: "w".repeat(40),
};

type Reply = { status?: number; body: unknown };
/** A stand-in for Meta: answers by the end of the address, and remembers every question and the token it came with. */
function meta(over: { number?: Reply; subscribed?: Reply; templates?: Reply[]; } = {}) {
  const asked: { url: string; auth: string | null }[] = [];
  const pages = [...(over.templates ?? [{ body: { data: allApproved() } }])];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const path = url.split("?")[0];
    let r: Reply;
    if (path.endsWith("/subscribed_apps")) r = over.subscribed ?? { body: { data: [{ whatsapp_business_api_data: { id: "1", name: "App" } }] } };
    else if (path.endsWith("/message_templates")) r = pages.shift() ?? { body: { data: [] } };
    else if (url.includes("page=2")) r = pages.shift() ?? { body: { data: [] } };
    else r = over.number ?? { body: { display_phone_number: "+234 803 111 2222", verified_name: "The Covenant Nation", quality_rating: "GREEN", name_status: "APPROVED", status: "CONNECTED", messaging_limit_tier: "TIER_1K" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return { fetcher: fetcher as unknown as typeof fetch, asked };
}

const row = (name: string, over: Record<string, string | null> = {}) => ({ name, status: "APPROVED", category: "UTILITY", language: "en", reason: null as string | null, ...over });
const allApproved = () => expectedTemplates().map((n) => row(n));
const item = (r: Awaited<ReturnType<typeof runHealthChecks>>, key: string) => r.items.find((i) => i.key === key)!;

describe("the checks", () => {
  it("say everything is fine when Meta says so, and ask only read-only questions with the token in a header", async () => {
    const m = meta();
    const r = await runHealthChecks(ENV, m.fetcher);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => [i.key, i.state])).toEqual([["setup", "good"], ["token", "good"], ["number", "good"], ["quality", "good"], ["limit", "good"], ["subscription", "good"], ["templates", "good"]]);
    expect(r.sender).toMatchObject({ number: "+234 803 111 2222", name: "The Covenant Nation", quality: "GREEN", tier: "TIER_1K", test: false });
    expect(m.asked.every((q) => q.auth === `Bearer ${ENV.WHATSAPP_ACCESS_TOKEN}`)).toBe(true);
    expect(m.asked.every((q) => q.url.startsWith("https://graph.facebook.com/v23.0/"))).toBe(true);
    expect(JSON.stringify(r)).not.toContain(ENV.WHATSAPP_ACCESS_TOKEN);
    expect(JSON.stringify(r)).not.toContain(ENV.WHATSAPP_PHONE_NUMBER_ID);
    expect(JSON.stringify(r)).not.toContain(ENV.WHATSAPP_BUSINESS_ACCOUNT_ID);
  });

  it("name what is missing on the site, by name only, and do not ask Meta when sending is not set up", async () => {
    const m = meta();
    const r = await runHealthChecks({ WHATSAPP_PROVIDER: "meta" }, m.fetcher);
    expect(r.ok).toBe(false);
    expect(r.items).toHaveLength(1);
    expect(item(r, "setup")).toMatchObject({ state: "bad", list: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"] });
    expect(m.fetcher).not.toHaveBeenCalled();
    expect(item(await runHealthChecks({ ...ENV, MESSAGING_MODE: "log" }, m.fetcher), "setup").words).toContain("only written down");
    expect(item(await runHealthChecks({ ...ENV, WHATSAPP_PROVIDER: "none" }, m.fetcher), "setup").list).toEqual(["WHATSAPP_PROVIDER (should be meta)"]);
  });

  it("warn when sending is set up but checking and receipts are not", async () => {
    const { WHATSAPP_BUSINESS_ACCOUNT_ID: _a, WHATSAPP_APP_SECRET: _b, ...rest } = ENV;
    void _a;
    void _b;
    const m = meta();
    const r = await runHealthChecks(rest, m.fetcher);
    expect(item(r, "setup")).toMatchObject({ state: "warn", list: ["WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_APP_SECRET"] });
    expect(item(r, "subscription").state).toBe("unknown");
    expect(item(r, "templates").state).toBe("unknown");
    expect(item(r, "token").state).toBe("good");
  });

  it("recognise Meta's free test number, by its name and by its 555 number, and say why it fails", async () => {
    expect(looksLikeTestNumber("+1 555 025 3483", "Test Number")).toBe(true);
    expect(looksLikeTestNumber("+1 555 025 3483", null)).toBe(true);
    expect(looksLikeTestNumber(null, "test number")).toBe(true);
    expect(looksLikeTestNumber("+234 803 111 2222", "The Covenant Nation")).toBe(false);
    const r = await runHealthChecks(ENV, meta({ number: { body: { display_phone_number: "+1 555 025 3483", verified_name: "Test Number", quality_rating: "UNKNOWN", status: "CONNECTED" } } }).fetcher);
    expect(r.ok).toBe(false);
    expect(item(r, "number")).toMatchObject({ state: "bad" });
    expect(item(r, "number").words).toContain("five phones");
    expect(item(r, "number").fix).toContain("WHATSAPP_PHONE_NUMBER_ID");
    expect(r.sender?.test).toBe(true);
  });

  it("explain an expired token (190), a missing permission and a wrong ID, each with what to do", async () => {
    const expired = await runHealthChecks(ENV, meta({ number: { status: 401, body: { error: { code: 190, message: "Error validating access token: Session has expired" } } } }).fetcher);
    expect(item(expired, "token")).toMatchObject({ state: "bad" });
    expect(item(expired, "token").words).toContain("expired");
    expect(item(expired, "token").fix).toContain("system-user token");
    expect(item(expired, "number").state).toBe("unknown");
    const perm = await runHealthChecks(ENV, meta({ number: { status: 403, body: { error: { code: 200, message: "permissions" } } } }).fetcher);
    expect(item(perm, "token").words).toContain("permission");
    const wrong = await runHealthChecks(ENV, meta({ number: { status: 400, body: { error: { code: 100, error_subcode: 33, message: "Unsupported get request" } } } }).fetcher);
    expect(item(wrong, "token").words).toContain("not there");
    expect(item(wrong, "token").fix).toContain("WHATSAPP_PHONE_NUMBER_ID");
  });

  it("ask again for the plain fields when Meta does not know one of the extra ones", async () => {
    const calls: string[] = [];
    const base = meta();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("messaging_limit_tier")) return new Response(JSON.stringify({ error: { code: 100, message: "Tried accessing nonexisting field" } }), { status: 400 });
      if (url.includes("fields=display_phone_number,verified_name,quality_rating")) {
        return new Response(JSON.stringify({ display_phone_number: "+234 803 111 2222", verified_name: "The Covenant Nation", quality_rating: "GREEN" }), { status: 200 });
      }
      return (base.fetcher as typeof fetch)(input, init);
    }) as typeof fetch;
    const r = await runHealthChecks(ENV, fetcher);
    expect(item(r, "token").state).toBe("good");
    expect(item(r, "limit").state).toBe("unknown");
    expect(calls.filter((u) => u.includes("fields=display_phone_number")).length).toBe(2);
  });

  it("say when Meta cannot be reached, without calling it a fault of the account", async () => {
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const r = await runHealthChecks(ENV, down);
    expect(item(r, "token")).toMatchObject({ state: "unknown" });
    expect(item(r, "token").words).toContain("could not be reached");
    expect(r.ok).toBe(true);
  });

  it("report the number's quality and limits honestly", async () => {
    const warn = await runHealthChecks(ENV, meta({ number: { body: { display_phone_number: "+234 1", verified_name: "X", quality_rating: "YELLOW", name_status: "PENDING_REVIEW", status: "CONNECTED", messaging_limit_tier: "TIER_250" } } }).fetcher);
    expect(item(warn, "quality").state).toBe("warn");
    expect(item(warn, "number")).toMatchObject({ state: "warn" });
    expect(item(warn, "number").words).toContain("pending review");
    expect(item(warn, "limit")).toMatchObject({ state: "warn" });
    expect(item(warn, "limit").words).toContain("250");
    const red = await runHealthChecks(ENV, meta({ number: { body: { display_phone_number: "+234 1", verified_name: "X", quality_rating: "RED", status: "FLAGGED" } } }).fetcher);
    expect(item(red, "quality").state).toBe("bad");
    expect(item(red, "number")).toMatchObject({ state: "bad" });
    expect(item(red, "number").words).toContain("flagged");
    expect(red.ok).toBe(false);
  });

  it("find the app not subscribed to the account, which is why receipts never arrive", async () => {
    const r = await runHealthChecks(ENV, meta({ subscribed: { body: { data: [] } } }).fetcher);
    expect(item(r, "subscription")).toMatchObject({ state: "bad" });
    expect(item(r, "subscription").words).toContain("never tell the site");
    expect(r.ok).toBe(false);
  });

  it("read every page of templates, and only follow Meta's own paging address", async () => {
    const names = expectedTemplates();
    const half = Math.ceil(names.length / 2);
    const m = meta({ templates: [{ body: { data: names.slice(0, half).map((n) => row(n)), paging: { next: "https://graph.facebook.com/v23.0/2090000000002/message_templates?page=2" } } }, { body: { data: names.slice(half).map((n) => row(n)) } }] });
    const r = await runHealthChecks(ENV, m.fetcher);
    expect(item(r, "templates").state).toBe("good");
    expect(m.asked.some((q) => q.url.includes("page=2"))).toBe(true);
    const evil = meta({ templates: [{ body: { data: names.map((n) => row(n)), paging: { next: "https://evil.example/steal" } } }] });
    await runHealthChecks(ENV, evil.fetcher);
    expect(evil.asked.some((q) => q.url.includes("evil.example"))).toBe(false);
  });
});

describe("the wording at Meta", () => {
  const names = expectedTemplates();

  it("expects one approved wording for each message the site sends on WhatsApp, including the test message, and none for email-only ones", () => {
    expect(names).toContain(whatsappTemplateName("whatsapp_test"));
    expect(names).not.toContain(whatsappTemplateName("whatsapp_paused"));
    expect(names).not.toContain(whatsappTemplateName("details_check_reminder"));
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(names.length);
  });

  it("says what is refused, stopped, missing and waiting, in that order of importance", () => {
    const rows = names.slice(2).map((n) => row(n));
    rows.push(row(names[0], { status: "REJECTED", reason: "INVALID_FORMAT" }));
    rows[0] = row(names[2], { status: "PAUSED" });
    rows[1] = row(names[3], { status: "PENDING" });
    const it_ = templateItem(rows, "en");
    expect(it_.state).toBe("bad");
    expect(it_.words).toContain("1 not sent to Meta yet");
    expect(it_.words).toContain("1 refused");
    expect(it_.words).toContain("1 paused or disabled");
    expect(it_.words).toContain("1 waiting for review");
    expect(it_.list).toContain(`Refused: ${names[0]} (invalid format)`);
    expect(it_.list).toContain(`Not sent yet: ${names[1]}`);
    expect(it_.fix).toContain("npm run templates -- --submit");
  });

  it("is only a warning while the wording waits for Meta, or is filed under the wrong category", () => {
    const waiting = templateItem(names.map((n, i) => row(n, i === 0 ? { status: "PENDING" } : {})), "en");
    expect(waiting.state).toBe("warn");
    expect(waiting.words).toContain("1 waiting for Meta");
    const marketing = templateItem(names.map((n, i) => row(n, i === 1 ? { category: "MARKETING" } : {})), "en");
    expect(marketing.state).toBe("warn");
    expect(marketing.list).toEqual([`Category: ${names[1]} (marketing)`]);
  });

  it("matches the language the site sends in, so wording in another language does not count", () => {
    expect(templateItem(names.map((n) => row(n, { language: "fr" })), "en").state).toBe("bad");
    expect(templateItem(names.map((n) => row(n, { language: "fr" })), "fr").state).toBe("good");
  });

  it("checks the sign-in code wording when the site names one, and wants it filed as Authentication", async () => {
    const withSignin = (over: Record<string, string>) => meta({ templates: [{ body: { data: [...allApproved(), row("ut_signin", over)] } }] });
    const good = await runHealthChecks({ ...ENV, WHATSAPP_TEMPLATE_NAME: "ut_signin" }, withSignin({ category: "AUTHENTICATION" }).fetcher);
    expect(item(good, "signin_template").state).toBe("good");
    const wrong = await runHealthChecks({ ...ENV, WHATSAPP_TEMPLATE_NAME: "ut_signin" }, withSignin({ category: "UTILITY" }).fetcher);
    expect(item(wrong, "signin_template")).toMatchObject({ state: "warn" });
    const gone = await runHealthChecks({ ...ENV, WHATSAPP_TEMPLATE_NAME: "ut_other" }, withSignin({ category: "AUTHENTICATION" }).fetcher);
    expect(item(gone, "signin_template")).toMatchObject({ state: "bad" });
    expect(item(await runHealthChecks(ENV, meta().fetcher), "templates").state).toBe("good");
  });
});

describe("the settings the site needs", () => {
  it("lists names and never values", () => {
    expect(missingSettings({})).toEqual({
      sending: ["WHATSAPP_PROVIDER (should be meta)", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"],
      checking: ["WHATSAPP_BUSINESS_ACCOUNT_ID"],
      receipts: ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WORKER_TOKEN"],
    });
    expect(missingSettings(ENV)).toEqual({ sending: [], checking: [], receipts: [] });
    expect(missingSettings({ ...ENV, WHATSAPP_ACCESS_TOKEN: "   " }).sending).toEqual(["WHATSAPP_ACCESS_TOKEN"]);
  });
});

describe("reading what the database keeps", () => {
  const good = {
    state: "on", canCheck: true, canTest: true, paused: false, unconfirmedHours: 24,
    check: { at: "2026-10-30T10:00:00Z", by: "Mary", result: { ok: false, items: [{ key: "token", title: "Access token", state: "bad", words: "It expired", fix: "Make a new one" }, { nope: 1 }], sender: null } },
    week: { reached: 5, read: 2, waiting: 1, silent: 1, inQueue: 0 },
    movedOn: [{ cause: "token", n: 3 }, { cause: 5 }], countedSince: "2026-10-29T10:00:00Z",
    lastReceiptAt: "2026-10-30T09:00:00Z", lastSentAt: "2026-10-30T09:30:00Z",
    signals: [{ at: "2026-10-30T08:00:00Z", kind: "template", subject: "ut_welcome", status: "REJECTED", detail: "INVALID_FORMAT" }, { bad: true }],
    test: { id: "abc", status: "delivered", at: "2026-10-30T10:30:00Z", cause: null },
  };

  it("reads a good answer, drops what is the wrong shape, and treats Off or anything else as nothing", () => {
    const v = parseHealthView(good)!;
    expect(v.check?.report?.items).toHaveLength(1);
    expect(v.movedOn).toEqual([{ cause: "token", n: 3 }]);
    expect(v.signals).toHaveLength(1);
    expect(v.test?.status).toBe("delivered");
    for (const bad of [null, undefined, 4, "on", [], {}, { state: "off" }, { state: "maybe" }]) expect(parseHealthView(bad), JSON.stringify(bad)).toBeNull();
    expect(parseHealthView({ state: "on", check: { at: 5 }, week: 3, test: {} })).toMatchObject({ check: null, test: null, week: { reached: 0 }, canCheck: false });
    expect(parseReport("x")).toBeNull();
    expect(parseReport({ items: "no" })).toBeNull();
  });

  it("has words for every cause the database can give, and a safe line for any other", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20270103000200_whatsapp_health.sql", import.meta.url), "utf8");
    const body = /create function public\.whatsapp_cause[\s\S]*?\n\$\$;/.exec(sql)?.[0] ?? "";
    const causes = new Set([...body.matchAll(/(?:then|return) '([a-z_]+)'/g)].map((m) => m[1]));
    expect(causes.size).toBeGreaterThan(15);
    for (const c of causes) expect(CAUSE_WORDS[c], c).toBeDefined();
    expect(causeWords("made_up").label).toBe("Another reason");
    expect(causeWords(null).label).toBe("No reason was kept");
    for (const w of Object.values(CAUSE_WORDS)) {
      expect(w.label.length).toBeGreaterThan(8);
      expect(w.fix.length).toBeGreaterThan(8);
    }
  });

  it("says how the test message is getting on", () => {
    const at = "2026-10-30T10:30:00Z";
    expect(testWords({ id: "a", status: "queued", at, cause: null }).state).toBe("unknown");
    expect(testWords({ id: "a", status: "sent", at, cause: null }).state).toBe("warn");
    expect(testWords({ id: "a", status: "read", at, cause: null })).toMatchObject({ state: "good" });
    const failed = testWords({ id: "a", status: "failed", at, cause: "test_number" });
    expect(failed.state).toBe("bad");
    expect(failed.words).toContain("test number");
    expect(failed.words).toContain("WHATSAPP_PHONE_NUMBER_ID");
  });

  it("works out whether receipts are coming back from the last send and the last receipt", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const base = parseHealthView(good)!;
    expect(receiptWords(base, now).state).toBe("good");
    expect(receiptWords({ ...base, lastSentAt: null, lastReceiptAt: null }, now).state).toBe("unknown");
    expect(receiptWords({ ...base, lastReceiptAt: null, lastSentAt: "2026-10-30T11:00:00Z" }, now).state).toBe("warn");
    expect(receiptWords({ ...base, lastReceiptAt: null, lastSentAt: "2026-10-28T11:00:00Z" }, now)).toMatchObject({ state: "bad" });
    expect(receiptWords({ ...base, lastReceiptAt: "2026-10-27T00:00:00Z", lastSentAt: "2026-10-30T11:00:00Z" }, now).state).toBe("bad");
    expect(receiptWords({ ...base, lastReceiptAt: "2026-10-27T00:00:00Z", lastSentAt: "2026-10-26T11:00:00Z" }, now).state).toBe("good");
  });

  it("puts Meta's news in a line", () => {
    expect(signalWords({ at: "x", kind: "template", subject: "ut_welcome", status: "REJECTED", detail: "INVALID_FORMAT" })).toBe("ut_welcome is rejected (invalid format)");
    expect(signalWords({ at: "x", kind: "template", subject: "ut_welcome", status: "CATEGORY_MARKETING", detail: "was UTILITY" })).toBe("ut_welcome is now filed as marketing (was UTILITY)");
    expect(signalWords({ at: "x", kind: "quality", subject: "+234 803", status: "DOWNGRADE", detail: "TIER_250" })).toBe("The number +234 803: downgrade, now tier 250");
    expect(signalWords({ at: "x", kind: "account", subject: "account", status: "ACCOUNT_RESTRICTION", detail: null })).toBe("The account: account restriction");
  });
});
