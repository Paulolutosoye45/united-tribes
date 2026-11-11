import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runDispatch } from "@/lib/messaging/dispatch";
import { WhatsAppTemplateSender } from "@/lib/messaging/providers";
import type { SendResult } from "@/lib/messaging/providers/types";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { WorkerRpc } from "@/lib/messaging/worker";
import { CLASS_WORDS, DEFAULT_CLASSES, classOf } from "@/lib/whatsapp/classes";
import { expectedTemplates, marketingKeys, runHealthChecks, tierPeople } from "@/lib/whatsapp/health";
import { MetaCloudSender } from "@/lib/whatsapp/meta";
import { asker, FREE_WORDS, gateFetch, guardProvider, MetaBlockedError, metaAllowance, readAllowance, senderForMode } from "@/lib/whatsapp/mode";
import { keysForTemplateName } from "@/lib/whatsapp/names";
import { senderFromEnv, type CodeSender } from "@/lib/whatsapp/provider";
import { sampleParams } from "./fixtures/message-params";

// WhatsApp mode on the website's side. The promise that matters: in Free mode the website makes no request to Meta at all, by any road (a member
// message, a sign-in code on the official route, the account check), and when it cannot tell what the mode is it does not speak to Meta either.

const SITE = "https://unitedtribes.example";
// The table is seeded by WhatsApp mode's own migration, and added to by the later migration that put the Leader Desk on WhatsApp
const MIGRATION = ["20270105000100_whatsapp_mode.sql", "20270125000100_desk_extras.sql"].map((f) => readFileSync(path.resolve(__dirname, "../../supabase/migrations", f), "utf8")).join("\n");

/** A fetch that fails the test if anything at all asks it for anything. */
const meta = () => vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200, headers: { "content-type": "application/json" } }));
const neverMeta = () =>
  vi.fn(async (): Promise<Response> => {
    throw new Error("Meta was called");
  });

type Said = { mode: string; meta: boolean } | "missing" | "error" | "garbled";
function rigged(said: Said) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const claimed = [0];
  const rpc: WorkerRpc = async (fn, args = {}) => {
    calls.push({ fn, args });
    if (fn === "worker_whatsapp_allowed") {
      if (said === "missing") return { data: null, error: { message: "Could not find the function public.worker_whatsapp_allowed(p_token) in the schema cache", code: "PGRST202" } };
      if (said === "error") return { data: null, error: { message: "connection refused" } };
      if (said === "garbled") return { data: { hello: "there" }, error: null };
      return { data: said, error: null };
    }
    if (fn === "worker_claim") return { data: claimed[0]++ === 0 ? [row("a"), row("b", "email")] : [], error: null };
    return { data: null, error: null };
  };
  return { rpc, calls, reports: () => calls.filter((c) => c.fn === "worker_report").map((c) => c.args) };
}
const row = (id: string, channel = "whatsapp", template = "week_start") => ({
  id,
  template,
  channel,
  params: sampleParams(template),
  urgency: "normal",
  attempts: 1,
  reply_token: null,
  to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada", first_name: "Ada" },
});
const sender = (fetcher: typeof fetch) => new WhatsAppTemplateSender({ phoneNumberId: "123456", token: "tok", language: "en", graphVersion: "v23.0", fetcher });
const emailStub = () => ({ channel: "email" as const, name: "stub", sent: [] as string[], async send(m: { id: string }): Promise<SendResult> { this.sent.push(m.id); return { ok: true, providerId: "e1" }; } });

describe("every message that can go by WhatsApp has a class", () => {
  const capable = () => Object.values(TEMPLATES).filter((def) => !def.emailOnly).map((def) => def.key).sort();

  it("covers each of them and nothing else, so a new message cannot slip in unclassified", () => {
    expect(Object.keys(DEFAULT_CLASSES).sort()).toEqual(capable());
    expect(capable()).toHaveLength(62);
  });

  it("puts only the messages that must reach in class A, and never an email-only message anywhere", () => {
    const a = Object.entries(DEFAULT_CLASSES).filter(([, c]) => c === "A").map(([k]) => k).sort();
    expect(a).toEqual(["care_task_overdue", "care_urgent", "desk_offer", "details_check_reminder", "details_check_request", "guardian_request", "referee_code", "swap_offered", "whatsapp_test"]);
    for (const key of ["placement_your_tribe", "placement_reminder", "whatsapp_paused", "whatsapp_signal", "whatsapp_mode_alert"]) expect(DEFAULT_CLASSES[key]).toBeUndefined();
    expect(classOf("no_such_message")).toBe("A");
    expect(CLASS_WORDS.A.saver).toMatch(/stays/);
  });

  it("is the same table the database starts with", () => {
    const seeded = new Map([...MIGRATION.matchAll(/^\s*\('([a-z0-9_]+)', '([ABC])'\)[,;]?\s*$/gm)].map((m) => [m[1], m[2]]));
    expect(Object.fromEntries(seeded)).toEqual(DEFAULT_CLASSES);
  });
});

describe("what the database says about speaking to Meta", () => {
  it("reads a clear answer, and Free is never allowed whatever else it says", () => {
    expect(readAllowance({ mode: "full", meta: true })).toEqual({ mode: "full", meta: true, known: true });
    expect(readAllowance({ mode: "saver", meta: true })).toMatchObject({ meta: true });
    expect(readAllowance({ mode: "free", meta: true })).toEqual({ mode: "free", meta: false, known: true });
    expect(readAllowance({ mode: "turbo", meta: true })).toBeNull();
    expect(readAllowance({ mode: "full" })).toBeNull();
    expect(readAllowance("full")).toBeNull();
  });

  it("allows an older database that does not have WhatsApp mode yet, so the site works as it did", async () => {
    expect(await metaAllowance(rigged("missing").rpc)).toEqual({ mode: "full", meta: true, known: false });
    expect(await metaAllowance(null)).toMatchObject({ meta: true });
  });

  it("does not allow it when the database cannot say", async () => {
    expect(await metaAllowance(rigged("error").rpc)).toEqual({ mode: "full", meta: false, known: false });
    expect(await metaAllowance(async () => { throw new Error("down"); })).toMatchObject({ meta: false });
  });

  it("asks once for a whole pass, and again once the time is up", async () => {
    const r = rigged({ mode: "full", meta: true });
    let t = 0;
    const ask = asker(r.rpc, 1000, () => t);
    await ask();
    await ask();
    await ask();
    expect(r.calls.filter((c) => c.fn === "worker_whatsapp_allowed")).toHaveLength(1);
    t = 5000;
    await ask();
    expect(r.calls.filter((c) => c.fn === "worker_whatsapp_allowed")).toHaveLength(2);
  });
});

describe("Free mode: the member messages", () => {
  it("makes no request to Meta, turns each WhatsApp message back so the database moves it on, and still sends the email", async () => {
    const fetcher = neverMeta();
    const r = rigged({ mode: "free", meta: false });
    const email = emailStub();
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: sender(fetcher as unknown as typeof fetch), email, sms: null }, site: SITE });
    expect(fetcher).not.toHaveBeenCalled();
    const reports = r.reports().sort((x, y) => String(x.p_id).localeCompare(String(y.p_id)));
    expect(reports).toEqual([
      { p_id: "a", p_outcome: "rejected", p_error: FREE_WORDS, p_retry_minutes: undefined },
      { p_id: "b", p_outcome: "sent", p_provider_id: "e1" },
    ]);
    expect(summary).toMatchObject({ claimed: 2, sent: 1, rejected: 1, problems: [] });
    expect(email.sent).toEqual(["b"]);
  });

  it("asks the mode once for the pass, not once per message", async () => {
    const r = rigged({ mode: "free", meta: false });
    await runDispatch({ rpc: r.rpc, providers: { whatsapp: sender(neverMeta() as unknown as typeof fetch), email: null, sms: null }, site: SITE });
    expect(r.calls.filter((c) => c.fn === "worker_whatsapp_allowed")).toHaveLength(1);
  });

  it("sends through Meta as before in Full and Saver", async () => {
    for (const mode of ["full", "saver"]) {
      const fetcher = meta();
      const r = rigged({ mode, meta: true });
      const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: sender(fetcher as unknown as typeof fetch), email: null, sms: null }, site: SITE });
      expect(fetcher, mode).toHaveBeenCalledTimes(1);
      expect(summary.sent, mode).toBe(1);
    }
  });

  it("sends through Meta as before on a database that does not have WhatsApp mode yet", async () => {
    const fetcher = meta();
    const summary = await runDispatch({ rpc: rigged("missing").rpc, providers: { whatsapp: sender(fetcher as unknown as typeof fetch), email: null, sms: null }, site: SITE });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ sent: 1, problems: [] });
  });

  it("does not speak to Meta when the mode cannot be read, and sends the message again in ten minutes", async () => {
    for (const said of ["error", "garbled"] as const) {
      const fetcher = meta();
      const r = rigged(said);
      await runDispatch({ rpc: r.rpc, providers: { whatsapp: sender(fetcher as unknown as typeof fetch), email: null, sms: null }, site: SITE });
      if (said === "error") {
        expect(fetcher).not.toHaveBeenCalled();
        expect(r.reports().find((x) => x.p_id === "a")).toMatchObject({ p_outcome: "retry", p_retry_minutes: 10 });
      } else {
        // An answer that is not ours to read is treated as a database without the mode: as before.
        expect(fetcher).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("leaves every other provider alone, and an absent one absent", () => {
    const stub = emailStub();
    expect(guardProvider(stub, async () => ({ mode: "free", meta: false, known: true }))).toBe(stub);
    expect(guardProvider(null, async () => ({ mode: "free", meta: false, known: true }))).toBeNull();
    const log = { channel: "whatsapp" as const, name: "log", async send(): Promise<SendResult> { return { ok: true, providerId: null }; } };
    expect(guardProvider(log, async () => ({ mode: "free", meta: false, known: true }))).toBe(log);
  });

  it("runs the cost watch on every beat and reports a fault without stopping the messages; an older database is no fault", async () => {
    const calls: string[] = [];
    const rpc: WorkerRpc = async (fn) => {
      calls.push(fn);
      if (fn === "worker_whatsapp_tick") return { data: { action: "warned", pct: 82 }, error: null };
      return { data: null, error: null };
    };
    const a = await runDispatch({ rpc, providers: { whatsapp: null, email: null, sms: null }, site: SITE });
    expect(calls).toContain("worker_whatsapp_tick");
    expect(a.whatsapp).toEqual({ action: "warned", pct: 82 });
    const b = await runDispatch({ rpc: async (fn) => (fn === "worker_whatsapp_tick" ? { data: null, error: { message: "locked" } } : { data: null, error: null }), providers: { whatsapp: null, email: null, sms: null }, site: SITE });
    expect(b.problems).toEqual(["whatsapp mode: locked"]);
    const c = await runDispatch({ rpc: async (fn) => (fn === "worker_whatsapp_tick" ? { data: null, error: { message: "Could not find the function", code: "PGRST202" } } : { data: null, error: null }), providers: { whatsapp: null, email: null, sms: null }, site: SITE });
    expect(c.problems).toEqual([]);
    const quiet: string[] = [];
    await runDispatch({ rpc: async (fn) => (quiet.push(fn), { data: null, error: null }), providers: { whatsapp: null, email: null, sms: null }, site: SITE, tick: false });
    expect(quiet).not.toContain("worker_whatsapp_tick");
  });
});

describe("Free mode: the sign-in code", () => {
  const official = new MetaCloudSender({ phoneNumberId: "1", token: "t", template: "sign_in_code", language: "en", graphVersion: "v23.0", fetcher: neverMeta() as unknown as typeof fetch });
  const linked: CodeSender = { name: "linked", route: "linked", async send() { return { ok: true }; } };
  const free = async () => ({ mode: "free" as const, meta: false, known: true });
  const full = async () => ({ mode: "full" as const, meta: true, known: true });

  it("is not offered on the official road in Free mode, and is left alone on the ordinary-number road", async () => {
    expect(await senderForMode(official, free)).toBeNull();
    expect(await senderForMode(linked, free)).toBe(linked);
    expect(await senderForMode(official, full)).toBe(official);
    expect(await senderForMode(null, free)).toBeNull();
    expect(await senderForMode(official, async () => ({ mode: "full", meta: false, known: false }))).toBeNull();
  });

  it("makes no request to Meta even if a code were sent anyway, because the fetch itself is shut", async () => {
    const fetcher = neverMeta();
    const env = { WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_TEMPLATE_NAME: "sign_in_code" };
    const s = senderFromEnv(env as unknown as NodeJS.ProcessEnv, gateFetch(fetcher as unknown as typeof fetch, free));
    expect(s?.route ?? "official").toBe("official");
    expect(await s?.send("2348031234567", "123456")).toEqual({ ok: false, reason: "unreachable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Free mode: the account check", () => {
  const ENV = { WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1050000000001", WHATSAPP_ACCESS_TOKEN: "EAAG-token", WHATSAPP_BUSINESS_ACCOUNT_ID: "2090000000002", WHATSAPP_APP_SECRET: "s", WHATSAPP_VERIFY_TOKEN: "v", WORKER_TOKEN: "w".repeat(40) };

  it("asks Meta nothing", async () => {
    const fetcher = neverMeta();
    const report = await runHealthChecks(ENV, gateFetch(fetcher as unknown as typeof fetch, async () => ({ mode: "free", meta: false, known: true })));
    expect(fetcher).not.toHaveBeenCalled();
    expect(report.items.find((i) => i.key === "token")).toMatchObject({ state: "unknown" });
    expect(report.facts).toEqual({ marketing: [], quality: null, limit: null });
  });

  it("refuses the gated fetch with a name a person can read", async () => {
    await expect(gateFetch(neverMeta() as unknown as typeof fetch, async () => ({ mode: "free", meta: false, known: true }))("https://graph.facebook.com/x")).rejects.toBeInstanceOf(MetaBlockedError);
    await expect(gateFetch(neverMeta() as unknown as typeof fetch, async () => ({ mode: "free", meta: false, known: true }))("https://graph.facebook.com/x")).rejects.toThrow(/Free mode/);
  });

  it("keeps the facts WhatsApp mode needs: the types Meta filed as Marketing (a reminder that shares a wording goes with it), the rating and the daily limit", async () => {
    const names = expectedTemplates();
    const rows = names.map((name) => ({
      name,
      status: "APPROVED",
      category: name === "ut_week_start" || name === "ut_details_check_request" ? "MARKETING" : "UTILITY",
      language: "en",
      reason: null as string | null,
    }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url.split("?")[0];
      const body = path.endsWith("/subscribed_apps")
        ? { data: [{ whatsapp_business_api_data: { id: "1" } }] }
        : path.endsWith("/message_templates")
          ? { data: rows }
          : { display_phone_number: "+234 803 111 2222", verified_name: "The Covenant Nation", quality_rating: "YELLOW", name_status: "APPROVED", status: "CONNECTED", messaging_limit_tier: "TIER_1K" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    });
    const report = await runHealthChecks(ENV, fetcher as unknown as typeof fetch);
    expect(report.facts).toEqual({ marketing: ["details_check_reminder", "details_check_request", "week_start"], quality: "YELLOW", limit: 1000 });
    expect(marketingKeys(rows, "en")).toEqual(report.facts?.marketing);
    expect(marketingKeys(rows.map((r) => ({ ...r, status: "PENDING" })), "en")).toEqual([]);
  });

  it("reads the daily limit from the tier", () => {
    expect(tierPeople("TIER_50")).toBe(50);
    expect(tierPeople("TIER_250")).toBe(250);
    expect(tierPeople("TIER_1K")).toBe(1000);
    expect(tierPeople("TIER_100K")).toBe(100000);
    expect(tierPeople("TIER_UNLIMITED")).toBeNull();
    expect(tierPeople(null)).toBeNull();
  });
});

describe("Meta's names for the wording", () => {
  it("find the message types behind a name, a shared wording included", () => {
    expect(keysForTemplateName("ut_week_start")).toEqual(["week_start"]);
    expect(keysForTemplateName("ut_details_check_request")).toEqual(["details_check_reminder", "details_check_request"]);
    expect(keysForTemplateName("ut_not_a_template")).toEqual([]);
    expect(keysForTemplateName("ut_whatsapp_paused")).toEqual([]);
  });
});
