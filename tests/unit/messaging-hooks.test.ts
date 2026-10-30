import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearerMatches, sameSecret } from "@/lib/messaging/auth";
import { parseEmailEvent, parseWhatsAppEvents, signMeta, verifyMetaSignature } from "@/lib/messaging/inbound";
import { parseContactForm, readContact } from "@/lib/messaging/contact";
import { signWebhook } from "@/lib/whatsapp/webhook";

const rpc = vi.fn();
vi.mock("@/lib/messaging/worker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/messaging/worker")>();
  return { ...real, workerRpc: () => rpc };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: async () => ({ data: { ok: true }, error: null }) }) }));

const TOKEN = "w".repeat(68);
const TOKEN_HEADER = { authorization: `Bearer ${TOKEN}` };
const ENV_KEYS = ["WORKER_TOKEN", "CRON_SECRET", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "EMAIL_WEBHOOK_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "MESSAGING_MODE"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("secrets", () => {
  it("compares in a way that does not depend on how much matched", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("", "abc")).toBe(false);
  });
  it("reads a bearer header, and ignores secrets that are too short to be real", () => {
    const req = (h: string) => new Request("https://x.test", { headers: { authorization: h } });
    expect(bearerMatches(req(`Bearer ${TOKEN}`), [undefined, TOKEN])).toBe(true);
    expect(bearerMatches(req(`bearer ${TOKEN}`), [TOKEN])).toBe(true);
    expect(bearerMatches(req(`Bearer nope`), [TOKEN])).toBe(false);
    expect(bearerMatches(req(`Basic ${TOKEN}`), [TOKEN])).toBe(false);
    expect(bearerMatches(req("Bearer short"), ["short"])).toBe(false);
    expect(bearerMatches(new Request("https://x.test"), [TOKEN])).toBe(false);
  });
});

describe("reading what WhatsApp sends", () => {
  const wrap = (value: object) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] });

  it("reads delivery receipts and failures", () => {
    const e = parseWhatsAppEvents(wrap({
      statuses: [
        { id: "wamid.1", status: "sent" },
        { id: "wamid.2", status: "delivered" },
        { id: "wamid.3", status: "read" },
        { id: "wamid.4", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
      ],
    }));
    expect(e.statuses).toEqual([
      { providerId: "wamid.2", status: "delivered" },
      { providerId: "wamid.3", status: "read" },
      { providerId: "wamid.4", status: "failed", error: "meta 131026: Message undeliverable" },
    ]);
  });

  it("reads a tap on a quick-reply button, from a template or an interactive message", () => {
    const token = "c".repeat(64);
    const e = parseWhatsAppEvents(wrap({
      messages: [
        { from: "2348031234567", type: "button", button: { payload: `ck:${token}:partly`, text: "Partly" } },
        { from: "2348031234567", type: "interactive", interactive: { button_reply: { id: `ck:${token}:done` } } },
        { from: "2348031234567", type: "button", button: { payload: "ck:short:done" } },
        { from: "2348031234567", type: "button", button: { payload: `ck:${token}:maybe` } },
      ],
    }));
    expect(e.replies).toEqual([{ replyToken: token, outcome: "partly" }, { replyToken: token, outcome: "done" }]);
  });

  it("reads STOP in any case, and nothing else typed", () => {
    const e = parseWhatsAppEvents(wrap({
      messages: [
        { from: "2348031234567", type: "text", text: { body: " Stop. " } },
        { from: "2348039999999", type: "text", text: { body: "UNSUBSCRIBE" } },
        { from: "2348038888888", type: "text", text: { body: "please stop calling me at night" } },
        { from: "2348037777777", type: "text", text: { body: "thanks!" } },
      ],
    }));
    expect(e.stops).toEqual([{ phone: "2348031234567" }, { phone: "2348039999999" }]);
  });

  it("ignores anything it does not understand", () => {
    for (const junk of [null, 3, "x", [], {}, { entry: "no" }, { entry: [null, { changes: [3] }] }, wrap({ statuses: [null, { id: 1 }] }), wrap({ messages: [null] })]) {
      expect(parseWhatsAppEvents(junk)).toEqual({ statuses: [], replies: [], stops: [], signals: [] });
    }
  });

  it("checks the signature Meta puts on the exact bytes it sends", () => {
    const body = JSON.stringify({ a: 1 });
    const good = signMeta("appsecret", body);
    expect(verifyMetaSignature("appsecret", body, good)).toBe(true);
    expect(verifyMetaSignature("appsecret", `${body} `, good)).toBe(false);
    expect(verifyMetaSignature("other", body, good)).toBe(false);
    expect(verifyMetaSignature("appsecret", body, good.replace("sha256=", "sha1="))).toBe(false);
    expect(verifyMetaSignature("appsecret", body, "sha256=zz")).toBe(false);
    expect(verifyMetaSignature("appsecret", body, null)).toBe(false);
    expect(verifyMetaSignature("", body, good)).toBe(false);
  });
});

describe("reading what the email provider sends", () => {
  it("maps delivered, bounced and complaint; ignores the rest", () => {
    expect(parseEmailEvent({ type: "email.delivered", data: { email_id: "e1" } })).toEqual({ providerId: "e1", status: "delivered" });
    expect(parseEmailEvent({ type: "email.bounced", data: { email_id: "e2", bounce: { type: "Permanent" } } })).toMatchObject({ providerId: "e2", status: "failed", error: "email bounced: Permanent" });
    expect(parseEmailEvent({ type: "email.complained", data: { email_id: "e3", to: ["x@y.org"] } })).toMatchObject({ status: "failed", optOutEmail: "x@y.org" });
    expect(parseEmailEvent({ type: "email.opened", data: { email_id: "e4" } })).toBeNull();
    expect(parseEmailEvent({ type: "email.delivered", data: {} })).toBeNull();
    expect(parseEmailEvent(null)).toBeNull();
  });
});

describe("the contact form", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("turns a local number into the international form", () => {
    expect(parseContactForm(form({ phone: "0803 123 4567", whatsapp: "on", email: "on", preferred: "whatsapp" }))).toEqual({
      ok: true, value: { phone: "+2348031234567", preferred: "whatsapp", whatsapp: true, sms: false, email: true },
    });
  });
  it("asks for a number only when a phone channel is on", () => {
    expect(parseContactForm(form({ email: "on", preferred: "email" }))).toMatchObject({ ok: true, value: { phone: null } });
    expect(parseContactForm(form({ whatsapp: "on", preferred: "whatsapp" }))).toMatchObject({ ok: false, message: expect.stringContaining("phone number") });
    expect(parseContactForm(form({ phone: "12", email: "on" }))).toMatchObject({ ok: false, message: expect.stringContaining("doesn’t look right") });
  });
  it("needs at least one way to be reached, and fixes a preferred channel that is switched off", () => {
    expect(parseContactForm(form({}))).toMatchObject({ ok: false });
    expect(parseContactForm(form({ phone: "08031234567", sms: "on", email: "on", preferred: "whatsapp" }))).toMatchObject({ ok: true, value: { preferred: "email" } });
  });
  it("reads what the database gives back, with safe defaults", () => {
    expect(readContact(null)).toEqual({ email: null, phone: null, preferred: "whatsapp", whatsapp: false, sms: false, email_ok: true });
    expect(readContact({ email: "a@b.org", phone: "+2348031234567", preferred: "sms", whatsapp: true, sms: true, email_ok: false })).toMatchObject({ preferred: "sms", email_ok: false });
  });
});

describe("POST /api/cron/tick", () => {
  async function call(method: "GET" | "POST", headers: Record<string, string> = {}) {
    const { GET, POST } = await import("@/app/api/cron/tick/route");
    return (method === "GET" ? GET : POST)(new Request("https://unitedtribes.example/api/cron/tick", { method, headers }));
  }

  it("is closed until a worker token is set", async () => {
    delete process.env.WORKER_TOKEN;
    expect((await call("GET", TOKEN_HEADER)).status).toBe(503);
  });

  it("refuses anyone without the secret", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    expect((await call("GET")).status).toBe(401);
    expect((await call("POST", { authorization: "Bearer wrong" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts the cron secret (as Vercel sends it) or the worker token, and runs a pass", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.CRON_SECRET = "cron-secret-of-sufficient-length";
    process.env.MESSAGING_MODE = "log";
    rpc.mockImplementation(async (fn: string) => (fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 2 }, error: null }));
    const a = await call("GET", { authorization: "Bearer cron-secret-of-sufficient-length" });
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ claimed: 0, calendar: { queued: 2 }, problems: [] });
    expect((await call("POST", TOKEN_HEADER)).status).toBe(200);
    expect(a.headers.get("cache-control")).toBe("no-store");
  });

  it("writes the opening paragraph of a new report after the messages, and says how many", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    const report = {
      id: "6f1c2f0e-8f36-4b1b-9a53-2d3f9f6c0a11",
      kind: "pastorate",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      community: null,
      data: {
        season: { id: "s", name: "Season 1", starts_on: "2026-08-03", ends_on: "2026-10-25", weeks: 12, current_week: 9, over: false, before: false },
        targets: { thriving_rate: 0.85, gain_min: 2, min_cell: 5 },
        headline: { members: 40, tribes: 4, measured: true, thriving: 30, thriving_rate: 0.75 },
        window: { meetings_held: 16, present: 120, possible: 160, attendance_rate: 0.75, joined: 2, left: 1, forms_finished: 3, care_opened: 4, care_closed: 3, care_open_now: 1, urgent_opened: 0, testimonies_new: 2, testimonies_to_church: 1 },
        watch: [],
        testimonies: [],
      },
    };
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_claim") return { data: [], error: null };
      if (fn === "worker_pending_summaries") return { data: [report, { nonsense: true }], error: null };
      if (fn === "worker_set_summary") return { data: true, error: null };
      return { data: { queued: 0 }, error: null };
    });
    const r = await call("POST", TOKEN_HEADER);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ summaries: 1, problems: [] });
    const set = rpc.mock.calls.find(([fn]) => fn === "worker_set_summary");
    expect(set?.[1]).toMatchObject({ p_report: report.id, p_by: "plain" });
    expect(String(set?.[1].p_summary)).toContain("30 members (75%) are thriving");
  });

  it("keeps sending when the report summaries fail", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_pending_summaries") return { data: null, error: { message: "boom" } };
      if (fn === "worker_claim") return { data: [], error: null };
      return { data: { queued: 0 }, error: null };
    });
    const r = await call("POST", TOKEN_HEADER);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.summaries).toBe(0);
    expect(body.problems.join(" ")).toContain("summaries: boom");
  });

  it("refreshes the owner's activity summaries each beat, with the worker token, and says so", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    rpc.mockImplementation(async (fn: string) => (fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 0 }, error: null }));
    const r = await call("POST", TOKEN_HEADER);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ activity: { refreshed: true }, problems: [] });
    expect(rpc.mock.calls.filter(([fn]) => fn === "worker_activity_refresh")).toHaveLength(1);
  });

  it("lists a fault in the activity summaries but keeps sending and still answers 200", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_activity_refresh") return { data: null, error: { message: "boom" } };
      if (fn === "worker_claim") return { data: [], error: null };
      return { data: { queued: 0 }, error: null };
    });
    const r = await call("POST", TOKEN_HEADER);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.activity).toEqual({ refreshed: false });
    expect(body.problems.join(" ")).toContain("activity summaries: boom");
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_activity_refresh") throw new Error("socket closed");
      if (fn === "worker_claim") return { data: [], error: null };
      return { data: { queued: 0 }, error: null };
    });
    const t = await call("POST", TOKEN_HEADER);
    expect(t.status).toBe(200);
    expect((await t.json()).problems.join(" ")).toContain("activity summaries: could not refresh");
  });

  it("runs the daily export clean-up each beat through its own door, and a fault in it never stops anything", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    rpc.mockImplementation(async (fn: string) => (fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 0 }, error: null }));
    const ok = await call("POST", TOKEN_HEADER);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ exportsSwept: true, problems: [] });
    expect(rpc.mock.calls.filter(([fn]) => fn === "worker_export_sweep")).toHaveLength(1);

    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_export_sweep") return { data: null, error: { message: "boom" } };
      if (fn === "worker_claim") return { data: [], error: null };
      return { data: { queued: 0 }, error: null };
    });
    const bad = await call("POST", TOKEN_HEADER);
    expect(bad.status).toBe(200);
    const body = await bad.json();
    expect(body.exportsSwept).toBe(false);
    expect(body.problems.join(" ")).toContain("exports: boom");

    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_export_sweep") throw new Error("socket closed");
      if (fn === "worker_claim") return { data: [], error: null };
      return { data: { queued: 0 }, error: null };
    });
    const thrown = await call("POST", TOKEN_HEADER);
    expect(thrown.status).toBe(200);
    expect((await thrown.json()).problems.join(" ")).toContain("exports: could not run");
  });

  it("runs the Details Check's reminders and clean-up each beat, before the messages go out, and a fault in it never stops anything", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    const order: string[] = [];
    rpc.mockImplementation(async (fn: string) => {
      order.push(fn);
      return fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 0 }, error: null };
    });
    const ok = await call("POST", TOKEN_HEADER);
    expect(ok.status).toBe(200);
    expect((await ok.json()).problems).toEqual([]);
    expect(rpc.mock.calls.filter(([fn]) => fn === "worker_details_tick")).toHaveLength(1);
    // a reminder it queues goes out in this same beat
    expect(order.indexOf("worker_details_tick")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("worker_details_tick")).toBeLessThan(order.indexOf("worker_claim"));

    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_details_tick") return { data: null, error: { message: "boom" } };
      return fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 0 }, error: null };
    });
    const bad = await call("POST", TOKEN_HEADER);
    expect(bad.status).toBe(200);
    expect((await bad.json()).problems.join(" ")).toContain("details check: boom");

    rpc.mockImplementation(async (fn: string) => {
      if (fn === "worker_details_tick") throw new Error("socket closed");
      return fn === "worker_claim" ? { data: [], error: null } : { data: { queued: 0 }, error: null };
    });
    const thrown = await call("POST", TOKEN_HEADER);
    expect(thrown.status).toBe(200);
    expect((await thrown.json()).problems.join(" ")).toContain("details check: could not run");
  });

  it("answers 502 when the database cannot be reached at all", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const r = await call("GET", TOKEN_HEADER);
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain(TOKEN);
  });
});

describe("/api/webhooks/whatsapp", () => {
  const url = "https://unitedtribes.example/api/webhooks/whatsapp";

  it("answers Meta’s one-time check only with the right verify token", async () => {
    const { GET } = await import("@/app/api/webhooks/whatsapp/route");
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me-please-123";
    const ok = await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=verify-me-please-123&hub.challenge=1158201444`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect((await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`))).status).toBe(403);
    expect((await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=verify-me-please-123&hub.challenge=<script>`))).status).toBe(403);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    expect((await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`))).status).toBe(403);
  });

  async function post(body: string, signature: string | null) {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    return POST(new Request(url, { method: "POST", body, headers: signature ? { "x-hub-signature-256": signature } : {} }));
  }
  const events = JSON.stringify({
    entry: [{ changes: [{ value: {
      statuses: [{ id: "wamid.9", status: "delivered" }],
      messages: [
        { from: "2348031234567", type: "button", button: { payload: `ck:${"d".repeat(64)}:done` } },
        { from: "2348031234567", type: "text", text: { body: "STOP" } },
      ],
    } }] }],
  });

  it("does nothing until it is set up, and nothing for a request that is not from Meta", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await post(events, "sha256=" + "0".repeat(64))).status).toBe(503);
    process.env.WORKER_TOKEN = TOKEN;
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    expect((await post(events, null)).status).toBe(401);
    expect((await post(events, signMeta("not-the-secret", events))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes a signed request to the database: the receipt, the tap and the STOP", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const r = await post(events, signMeta("app-secret", events));
    expect(r.status).toBe(200);
    expect(rpc.mock.calls).toEqual([
      ["worker_provider_event", { p_provider_id: "wamid.9", p_status: "delivered", p_error: null }],
      ["worker_checkin_reply", { p_reply_token: "d".repeat(64), p_outcome: "done" }],
      ["worker_opt_out", { p_phone: "2348031234567", p_email: null, p_channel: "whatsapp" }],
    ]);
  });

  it("asks Meta to try again if the database was unreachable, and rejects a body that is not JSON", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await post(events, signMeta("app-secret", events))).status).toBe(500);
    expect((await post("not json", signMeta("app-secret", "not json"))).status).toBe(400);
  });
});

describe("/api/webhooks/email", () => {
  const SECRET = `whsec_${Buffer.from("email-hook-secret-bytes").toString("base64")}`;
  async function post(body: string, headers: Record<string, string>) {
    const { POST } = await import("@/app/api/webhooks/email/route");
    return POST(new Request("https://unitedtribes.example/api/webhooks/email", { method: "POST", body, headers }));
  }
  const signed = (body: string, id = "msg_1", ts = String(Math.floor(Date.now() / 1000))) => ({
    "svix-id": id, "svix-timestamp": ts, "svix-signature": signWebhook(SECRET, id, ts, body),
  });

  it("is closed until set up, and refuses an unsigned or stale request", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });
    delete process.env.EMAIL_WEBHOOK_SECRET;
    expect((await post(body, signed(body))).status).toBe(503);
    process.env.WORKER_TOKEN = TOKEN;
    process.env.EMAIL_WEBHOOK_SECRET = SECRET;
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, signed(body, "msg_1", String(Math.floor(Date.now() / 1000) - 3600)))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records a delivery, and a complaint also stops email to that address", async () => {
    process.env.WORKER_TOKEN = TOKEN;
    process.env.EMAIL_WEBHOOK_SECRET = SECRET;
    const delivered = JSON.stringify({ type: "email.delivered", data: { email_id: "e1" } });
    expect((await post(delivered, signed(delivered))).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("worker_provider_event", { p_provider_id: "e1", p_status: "delivered", p_error: null });

    const complaint = JSON.stringify({ type: "email.complained", data: { email_id: "e2", to: ["x@y.org"] } });
    rpc.mockClear();
    expect((await post(complaint, signed(complaint))).status).toBe(200);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["worker_provider_event", "worker_email_signal", "worker_opt_out"]);
    expect(rpc.mock.calls[1][1]).toEqual({ p_provider_id: "e2", p_kind: "complaint" });
    expect(rpc.mock.calls[2][1]).toEqual({ p_phone: null, p_email: "x@y.org", p_channel: "email" });

    // an address that does not work is kept as a signal (two of them take it off every list); a full inbox is not
    const bounced = JSON.stringify({ type: "email.bounced", data: { email_id: "e4", bounce: { type: "Permanent" } } });
    rpc.mockClear();
    expect((await post(bounced, signed(bounced))).status).toBe(200);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["worker_provider_event", "worker_email_signal"]);
    expect(rpc.mock.calls[1][1]).toEqual({ p_provider_id: "e4", p_kind: "hard_bounce" });
    const soft = JSON.stringify({ type: "email.bounced", data: { email_id: "e5", bounce: { type: "Transient" } } });
    rpc.mockClear();
    expect((await post(soft, signed(soft))).status).toBe(200);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["worker_provider_event"]);

    const opened = JSON.stringify({ type: "email.opened", data: { email_id: "e3" } });
    rpc.mockClear();
    const r = await post(opened, signed(opened));
    expect(await r.json()).toMatchObject({ ignored: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  async function call(headers: Record<string, string> = {}) {
    const { GET } = await import("@/app/api/health/route");
    return GET(new Request("https://unitedtribes.example/api/health", { headers }));
  }

  it("tells anyone whether the database is up, and nothing more", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.WORKER_TOKEN = TOKEN;
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, database: true });
  });

  it("gives the queue and the channels to a caller with the secret, and goes red when sending is stuck", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.WORKER_TOKEN = TOKEN;
    process.env.MESSAGING_MODE = "log";
    rpc.mockResolvedValue({ data: { due: 0, stuck: 0, oldest_due_minutes: 0, failed_24h: 1 }, error: null });
    const ok = await (await call(TOKEN_HEADER)).json();
    expect(ok).toMatchObject({ ok: true, channels: { whatsapp: "log", email: "log", sms: "log" }, queue: { failed_24h: 1 } });

    rpc.mockResolvedValue({ data: { due: 9, stuck: 2, oldest_due_minutes: 15 }, error: null });
    const bad = await call(TOKEN_HEADER);
    expect(bad.status).toBe(503);
    rpc.mockResolvedValue({ data: { due: 9, stuck: 0, oldest_due_minutes: 120 }, error: null });
    expect((await call(TOKEN_HEADER)).status).toBe(503);
  });

  it("is red when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const r = await call();
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ ok: false, database: false });
  });
});
