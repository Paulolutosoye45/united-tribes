import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseWhatsAppEvents, signMeta } from "@/lib/messaging/inbound";

// What Meta tells the site about the account (a template approved or refused, the number's quality, a restriction), how it is read, how it reaches
// the database, and the two actions of the health page.

const rpc = vi.fn();
vi.mock("@/lib/messaging/worker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/messaging/worker")>();
  return { ...real, workerRpc: () => rpc };
});
const run = vi.fn();
vi.mock("@/lib/admin/rpc", () => ({ run: (...a: unknown[]) => run(...a), plain: (d: { ok: boolean; message?: string }) => (d.ok ? { ok: true } : d) }));
const loadHealth = vi.fn();
vi.mock("@/lib/whatsapp/health-server", () => ({ loadWhatsappHealth: (...a: unknown[]) => loadHealth(...a) }));
const checks = vi.fn();
vi.mock("@/lib/whatsapp/health", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatsapp/health")>();
  return { ...real, runHealthChecks: (...a: unknown[]) => checks(...a) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const field = (name: string, value: object) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: name, value }] }] });
const signals = (name: string, value: object) => parseWhatsAppEvents(field(name, value)).signals;

describe("reading Meta's news about the account", () => {
  it("reads a template approved or refused, with the reason", () => {
    expect(signals("message_template_status_update", { event: "REJECTED", message_template_name: "ut_welcome", message_template_language: "en", reason: "INVALID_FORMAT" })).toEqual([
      { kind: "template", subject: "ut_welcome", status: "REJECTED", detail: "INVALID_FORMAT" },
    ]);
    expect(signals("message_template_status_update", { event: "APPROVED", message_template_name: "ut_welcome", reason: "NONE" })).toEqual([{ kind: "template", subject: "ut_welcome", status: "APPROVED" }]);
  });

  it("reads a template moved to another category", () => {
    expect(signals("message_template_category_update", { message_template_name: "ut_welcome", previous_category: "UTILITY", new_category: "MARKETING" })).toEqual([
      { kind: "template", subject: "ut_welcome", status: "CATEGORY_MARKETING", detail: "was UTILITY" },
    ]);
  });

  it("reads the number's quality, its name and the account's restrictions", () => {
    expect(signals("phone_number_quality_update", { display_phone_number: "2348031112222", event: "DOWNGRADE", current_limit: "TIER_250" })).toEqual([
      { kind: "quality", subject: "2348031112222", status: "DOWNGRADE", detail: "TIER_250" },
    ]);
    expect(signals("phone_number_name_update", { display_phone_number: "2348031112222", decision: "DECLINED", rejection_reason: "NAME_NOT_ALLOWED" })).toEqual([
      { kind: "account", subject: "2348031112222", status: "NAME_DECLINED", detail: "NAME_NOT_ALLOWED" },
    ]);
    expect(signals("account_update", { phone_number: "2348031112222", event: "ACCOUNT_RESTRICTION", restriction_info: [{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING", expiration: "2026-11-01" }] })).toEqual([
      { kind: "account", subject: "2348031112222", status: "ACCOUNT_RESTRICTION", detail: "RESTRICTED_BIZ_INITIATED_MESSAGING" },
    ]);
    expect(signals("account_update", { event: "DISABLED_UPDATE", ban_info: { waba_ban_state: "DISABLE" } })).toEqual([{ kind: "account", subject: "account", status: "DISABLED_UPDATE", detail: "DISABLE" }]);
    expect(signals("account_review_update", { decision: "REJECTED" })).toEqual([{ kind: "account", subject: "account", status: "REVIEW_REJECTED" }]);
  });

  it("ignores any other kind of change, and anything missing or the wrong shape", () => {
    expect(signals("messages", { messaging_product: "whatsapp", statuses: [] })).toEqual([]);
    expect(signals("message_template_status_update", { event: "APPROVED" })).toEqual([]);
    expect(signals("phone_number_quality_update", { display_phone_number: "x" })).toEqual([]);
    expect(signals("account_update", {})).toEqual([]);
    expect(parseWhatsAppEvents(null).signals).toEqual([]);
    expect(parseWhatsAppEvents({ entry: [{ changes: [{ field: 5, value: 7 }, null] }] }).signals).toEqual([]);
  });

  it("keeps only short, plain fields: no markup, no long text", () => {
    const [s] = signals("message_template_status_update", { event: "REJ<script>alert(1)</script>ECTED", message_template_name: "n".repeat(500), reason: "x".repeat(400) });
    expect(s.status).not.toMatch(/[<>()]/);
    expect(s.subject.length).toBe(200);
    expect(s.detail?.length).toBeLessThanOrEqual(80);
  });

  it("still reads receipts in the same request", () => {
    const e = parseWhatsAppEvents(field("messages", { statuses: [{ id: "wamid.1", status: "delivered" }] }));
    expect(e.statuses).toEqual([{ providerId: "wamid.1", status: "delivered" }]);
    expect(e.signals).toEqual([]);
  });
});

describe("/api/webhooks/whatsapp passes the news on", () => {
  const url = "https://unitedtribes.example/api/webhooks/whatsapp";
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
  });
  async function post(payload: object) {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const body = JSON.stringify(payload);
    return POST(new Request(url, { method: "POST", body, headers: { "x-hub-signature-256": signMeta("app-secret", body) } }));
  }

  it("sends a signed notice to the database", async () => {
    const r = await post(field("message_template_status_update", { event: "REJECTED", message_template_name: "ut_welcome", reason: "INVALID_FORMAT" }));
    expect(r.status).toBe(200);
    expect(rpc.mock.calls).toEqual([["worker_whatsapp_signal", { p_kind: "template", p_subject: "ut_welcome", p_status: "REJECTED", p_detail: "INVALID_FORMAT" }]]);
  });

  it("never lets a failure to keep a notice make Meta think the receipts failed, even when the database does not have the function yet", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function public.worker_whatsapp_signal does not exist" } });
    expect((await post(field("account_update", { event: "DISABLED_UPDATE" }))).status).toBe(200);
  });

  it("still asks Meta to try again when a receipt could not be kept", async () => {
    rpc.mockImplementation(async (fn: string) => (fn === "worker_provider_event" ? { data: null, error: { message: "down" } } : { data: {}, error: null }));
    expect((await post(field("messages", { statuses: [{ id: "wamid.1", status: "delivered" }] }))).status).toBe(500);
  });
});

describe("the two actions of the health page", () => {
  beforeEach(() => {
    run.mockReset();
    run.mockResolvedValue({ ok: true, data: { ok: true } });
    loadHealth.mockReset();
    checks.mockReset();
    checks.mockResolvedValue({ ok: true, items: [], sender: null });
  });

  it("does not ask Meta when the page is Off or the person may not run the checks", async () => {
    const { runWhatsappChecksAction } = await import("@/app/(app)/admin/messages/whatsapp/actions");
    loadHealth.mockResolvedValue(null);
    expect(await runWhatsappChecksAction()).toMatchObject({ ok: false });
    loadHealth.mockResolvedValue({ canCheck: false });
    expect(await runWhatsappChecksAction()).toMatchObject({ ok: false, message: expect.stringContaining("admin") });
    expect(checks).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("asks Meta once, and keeps the answer through the database", async () => {
    const { runWhatsappChecksAction } = await import("@/app/(app)/admin/messages/whatsapp/actions");
    loadHealth.mockResolvedValue({ canCheck: true });
    expect(await runWhatsappChecksAction()).toEqual({ ok: true });
    expect(checks).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("whatsapp_check_save", { p_result: { ok: true, items: [], sender: null } }, ["/admin/messages/whatsapp", "/admin/messages"]);
  });

  it("sends the test through the database, which checks who may and that there is a number", async () => {
    const { sendWhatsappTestAction } = await import("@/app/(app)/admin/messages/whatsapp/actions");
    expect(await sendWhatsappTestAction()).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("whatsapp_test_send", undefined, ["/admin/messages/whatsapp", "/admin/messages"]);
    run.mockResolvedValue({ ok: false, message: "Save your own phone number on your profile first" });
    expect(await sendWhatsappTestAction()).toEqual({ ok: false, message: "Save your own phone number on your profile first" });
  });
});
