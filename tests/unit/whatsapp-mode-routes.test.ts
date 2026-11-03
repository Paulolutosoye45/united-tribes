import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signMeta } from "@/lib/messaging/inbound";
import { signWebhook } from "@/lib/whatsapp/webhook";

vi.mock("server-only", () => ({}));

// WhatsApp mode where the website meets the world: Meta's news about the wording's category reaches the Marketing guard; in Free mode the sign-in hook
// and the health check refuse before any request to Meta is made.

const rpc = vi.fn();
vi.mock("@/lib/messaging/worker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/messaging/worker")>();
  return { ...real, workerRpc: () => rpc };
});
const run = vi.fn();
vi.mock("@/lib/admin/rpc", () => ({ run: (...a: unknown[]) => run(...a), plain: (d: { ok: boolean; message?: string }) => (d.ok ? { ok: true } : d) }));
const loadHealth = vi.fn();
vi.mock("@/lib/whatsapp/health-server", () => ({ loadWhatsappHealth: (...a: unknown[]) => loadHealth(...a) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const field = (name: string, value: object) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: name, value }] }] });
const saved = { WORKER_TOKEN: process.env.WORKER_TOKEN, WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  process.env.WORKER_TOKEN = "w".repeat(68);
  process.env.WHATSAPP_APP_SECRET = "app-secret";
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/webhooks/whatsapp feeds the Marketing guard", () => {
  async function post(payload: object) {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const body = JSON.stringify(payload);
    return POST(new Request("https://unitedtribes.example/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": signMeta("app-secret", body) } }));
  }
  const marketing = () => rpc.mock.calls.filter((c) => c[0] === "worker_whatsapp_marketing").map((c) => c[1]);

  it("marks a message type Marketing when Meta files its wording as Marketing, and clears it when it goes back", async () => {
    expect((await post(field("message_template_category_update", { message_template_name: "ut_week_start", new_category: "MARKETING", previous_category: "UTILITY" }))).status).toBe(200);
    expect(marketing()).toEqual([{ p_key: "week_start", p_marketing: true }]);
    rpc.mockClear();
    await post(field("message_template_category_update", { message_template_name: "ut_week_start", new_category: "UTILITY", previous_category: "MARKETING" }));
    expect(marketing()).toEqual([{ p_key: "week_start", p_marketing: false }]);
  });

  it("marks every message type that shares the wording, and nothing for a name the site does not use", async () => {
    await post(field("message_template_category_update", { message_template_name: "ut_details_check_request", new_category: "MARKETING" }));
    expect(marketing()).toEqual([
      { p_key: "details_check_reminder", p_marketing: true },
      { p_key: "details_check_request", p_marketing: true },
    ]);
    rpc.mockClear();
    await post(field("message_template_category_update", { message_template_name: "somebody_elses_template", new_category: "MARKETING" }));
    expect(marketing()).toEqual([]);
  });

  it("leaves a plain approval or refusal alone, and never fails the receipts when the database lacks the function", async () => {
    await post(field("message_template_status_update", { event: "APPROVED", message_template_name: "ut_week_start" }));
    expect(marketing()).toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { message: "function public.worker_whatsapp_marketing does not exist" } });
    expect((await post(field("message_template_category_update", { message_template_name: "ut_week_start", new_category: "MARKETING" }))).status).toBe(200);
  });
});

describe("the sign-in hook in Free mode", () => {
  const SECRET = `v1,whsec_${Buffer.from("a-test-secret-of-some-length-1234").toString("base64")}`;
  const body = JSON.stringify({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123456" } });
  function signed() {
    const id = "msg_abc";
    const timestamp = String(Math.floor(Date.now() / 1000));
    return new Request("https://app.example/api/auth/send-code", {
      method: "POST",
      body,
      headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(SECRET, id, timestamp, body) },
    });
  }
  beforeEach(() => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "TOKEN");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "sign_in_code");
    vi.stubEnv("SIGNIN_WHATSAPP_ROUTE", "official");
  });

  it("makes no request to Meta, asks for no limits, burns no attempt, and says why", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    rpc.mockImplementation(async (fn: string) => ({ data: fn === "worker_whatsapp_allowed" ? { mode: "free", meta: false } : {}, error: null }));
    const { POST } = await import("@/app/api/auth/send-code/route");
    const r = await POST(signed());
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).toMatch(/Free mode/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["worker_whatsapp_allowed"]);
  });

  it("does not ask the database anything for a request that is not signed", async () => {
    const { POST } = await import("@/app/api/auth/send-code/route");
    const r = await POST(new Request("https://app.example/api/auth/send-code", { method: "POST", body, headers: { "webhook-signature": "v1,AAAA" } }));
    expect(r.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the health page's check in Free mode", () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue({ ok: true, data: { ok: true } });
    loadHealth.mockReset();
    loadHealth.mockResolvedValue({ canCheck: true });
  });

  it("asks Meta nothing and says how to check the account", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    rpc.mockImplementation(async (fn: string) => ({ data: fn === "worker_whatsapp_allowed" ? { mode: "free", meta: false } : {}, error: null }));
    const { runWhatsappChecksAction } = await import("@/app/(app)/admin/messages/whatsapp/actions");
    const r = await runWhatsappChecksAction();
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Free mode.*Saver or Full/) });
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("does not ask Meta when the mode cannot be read", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const { runWhatsappChecksAction } = await import("@/app/(app)/admin/messages/whatsapp/actions");
    expect(await runWhatsappChecksAction()).toMatchObject({ ok: false, message: expect.stringMatching(/could not be read/) });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
