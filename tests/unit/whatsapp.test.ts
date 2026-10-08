import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/send-code/route";
import { displayPhone, isUnknownAccount, maskPhone, normalisePhone, phoneDigits, whatsappErrorMessage } from "@/lib/auth/phone";
import { whatsappSignInEnabled } from "@/lib/env";
import { MetaCloudSender } from "@/lib/whatsapp/meta";
import { readHookRequest } from "@/lib/whatsapp/payload";
import { senderFromEnv } from "@/lib/whatsapp/provider";
import { signWebhook, verifyWebhook } from "@/lib/whatsapp/webhook";

const SECRET = `v1,whsec_${Buffer.from("a-test-secret-of-some-length-1234").toString("base64")}`;

describe("phone numbers", () => {
  it("reads the ways Nigerians write a number the same way", () => {
    for (const typed of ["0803 123 4567", "+234 803 123 4567", "2348031234567", "08031234567", "00234 803 123 4567"]) {
      expect(normalisePhone(typed), typed).toBe("+2348031234567");
    }
  });

  it("keeps other countries as typed and refuses nonsense", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("+447700900123");
    for (const bad of ["", "abc", "0803", "803 123 4567", "+234 803 123"]) expect(normalisePhone(bad), bad).toBeNull();
  });

  it("shows enough to recognise a number, not to read it", () => {
    expect(phoneDigits("+234 803 123 4567")).toBe("2348031234567");
    expect(displayPhone("+2348031234567")).toBe("+234 803 123 4567");
    expect(maskPhone("2348031234567")).toBe("+234 ••• ••• 4567");
    expect(maskPhone("+447700900123")).toBe("+447 ••• 0123");
    expect(maskPhone("123")).toBe("");
  });

  it("says what to do next, in plain words", () => {
    expect(whatsappErrorMessage({ code: "otp_expired" })).toMatch(/isn't right or has expired/);
    expect(whatsappErrorMessage({ code: "over_sms_send_rate_limit" })).toMatch(/Too many tries/);
    expect(whatsappErrorMessage({ status: 429 })).toMatch(/Too many tries/);
    expect(whatsappErrorMessage({ code: "phone_exists" })).toMatch(/already used by another account/);
    expect(whatsappErrorMessage({ code: "sms_send_failed" })).toMatch(/couldn't send the WhatsApp message/);
    expect(whatsappErrorMessage({ code: "sms_provider_disabled" })).toMatch(/isn't turned on yet/);
    expect(whatsappErrorMessage({ message: "Invalid token" })).toMatch(/isn't right/);
    expect(whatsappErrorMessage({ message: "Failed to fetch" })).toMatch(/couldn't reach the server/);
    expect(whatsappErrorMessage(null)).toMatch(/Something went wrong/);
  });

  it("never shows the service's own words", () => {
    expect(whatsappErrorMessage({ code: "weird", message: "duplicate key value violates unique constraint users_phone_key" })).not.toMatch(/duplicate|constraint/);
  });

  it("recognises 'no account for this number' so the screen can treat it like a sent code", () => {
    expect(isUnknownAccount({ code: "otp_disabled" })).toBe(true);
    expect(isUnknownAccount({ code: "signup_disabled" })).toBe(true);
    expect(isUnknownAccount({ message: "Signups not allowed for otp" })).toBe(true);
    expect(isUnknownAccount({ code: "over_sms_send_rate_limit" })).toBe(false);
    expect(isUnknownAccount(null)).toBe(false);
  });
});

describe("hook signature", () => {
  const body = JSON.stringify({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123456" } });
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const sig = signWebhook(SECRET, "msg_1", ts, body);
  const base = { secret: SECRET, id: "msg_1", timestamp: ts, signature: sig, body, now };

  it("accepts a request signed with the secret", () => {
    expect(verifyWebhook(base)).toBe(true);
  });

  it("accepts the secret with or without its prefixes", () => {
    const bare = SECRET.replace("v1,whsec_", "");
    expect(verifyWebhook({ ...base, secret: bare })).toBe(true);
    expect(verifyWebhook({ ...base, secret: SECRET.replace("v1,", "") })).toBe(true);
  });

  it("refuses a changed body, id, timestamp or secret", () => {
    expect(verifyWebhook({ ...base, body: body.replace("123456", "654321") })).toBe(false);
    expect(verifyWebhook({ ...base, id: "msg_2" })).toBe(false);
    expect(verifyWebhook({ ...base, timestamp: String(Number(ts) + 1) })).toBe(false);
    expect(verifyWebhook({ ...base, secret: `v1,whsec_${Buffer.from("another-secret-another-secret-12").toString("base64")}` })).toBe(false);
  });

  it("refuses a request that is too old or from the future", () => {
    const old = String(Number(ts) - 301);
    expect(verifyWebhook({ ...base, timestamp: old, signature: signWebhook(SECRET, "msg_1", old, body) })).toBe(false);
    const ahead = String(Number(ts) + 301);
    expect(verifyWebhook({ ...base, timestamp: ahead, signature: signWebhook(SECRET, "msg_1", ahead, body) })).toBe(false);
    const edge = String(Number(ts) - 300);
    expect(verifyWebhook({ ...base, timestamp: edge, signature: signWebhook(SECRET, "msg_1", edge, body) })).toBe(true);
  });

  it("refuses anything missing or malformed", () => {
    expect(verifyWebhook({ ...base, id: null })).toBe(false);
    expect(verifyWebhook({ ...base, timestamp: null })).toBe(false);
    expect(verifyWebhook({ ...base, signature: null })).toBe(false);
    expect(verifyWebhook({ ...base, timestamp: "soon" })).toBe(false);
    expect(verifyWebhook({ ...base, signature: "v2," + sig.slice(3) })).toBe(false);
    expect(verifyWebhook({ ...base, signature: "v1," })).toBe(false);
    expect(verifyWebhook({ ...base, signature: "v1,AAAA" })).toBe(false);
    expect(verifyWebhook({ ...base, secret: "" })).toBe(false);
  });

  it("accepts when one of several signatures matches", () => {
    expect(verifyWebhook({ ...base, signature: `v1,AAAAAAAA ${sig}` })).toBe(true);
  });
});

describe("hook request", () => {
  it("sends a sign-in code to the number on the account", () => {
    expect(readHookRequest({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123456" } })).toEqual({
      userId: "u1",
      to: "2348031234567",
      code: "123456",
    });
  });

  it("accepts a plus sign and spaces", () => {
    expect(readHookRequest({ user: { id: "u1", phone: "+234 803 123 4567" }, sms: { otp: "123456" } })?.to).toBe("2348031234567");
  });

  it("sends a number-change code to the NEW number, never the old one", () => {
    const read = readHookRequest({ user: { id: "u1", phone: "2348031234567", new_phone: "2348099999999" }, sms: { otp: "000123" } });
    expect(read?.to).toBe("2348099999999");
    expect(read?.code).toBe("000123");
  });

  it("works when the account has no number yet", () => {
    expect(readHookRequest({ user: { id: "u1", phone: "", new_phone: "2348031234567" }, sms: { otp: "123456" } })?.to).toBe("2348031234567");
  });

  it("refuses what it cannot use", () => {
    expect(readHookRequest(null)).toBeNull();
    expect(readHookRequest({})).toBeNull();
    expect(readHookRequest({ user: { id: "u1" }, sms: { otp: "123456" } })).toBeNull();
    expect(readHookRequest({ user: { id: "u1", phone: "12345" }, sms: { otp: "123456" } })).toBeNull();
    expect(readHookRequest({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "12ab56" } })).toBeNull();
    expect(readHookRequest({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123" } })).toBeNull();
    expect(readHookRequest({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123456789" } })).toBeNull();
    expect(readHookRequest({ user: { id: "u1", phone: "0803123456789012345" }, sms: { otp: "123456" } })).toBeNull();
  });
});

describe("Meta sender", () => {
  const opts = { phoneNumberId: "1234567890", token: "TOKEN", template: "sign_in_code", language: "en", graphVersion: "v23.0" };

  it("builds an authentication template message with the code in the body and the copy-code button", () => {
    const body = new MetaCloudSender(opts).payload("2348031234567", "123456");
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      to: "2348031234567",
      type: "template",
      template: { name: "sign_in_code", language: { code: "en" } },
    });
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
    ]);
  });

  it("posts to the right address with the token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const result = await new MetaCloudSender({ ...opts, fetcher: fetcher as unknown as typeof fetch }).send("2348031234567", "123456");
    expect(result).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(init.body as string).to).toBe("2348031234567");
  });

  it("reports Meta's numeric reason and nothing else", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 131026, message: "Message undeliverable for 2348031234567 code 123456" } }), { status: 400 }));
    const result = await new MetaCloudSender({ ...opts, fetcher: fetcher as unknown as typeof fetch }).send("2348031234567", "123456");
    expect(result).toEqual({ ok: false, reason: "rejected", detail: "meta 131026" });
  });

  it("copes with an unreadable error and with no network", async () => {
    const odd = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await new MetaCloudSender({ ...opts, fetcher: odd as unknown as typeof fetch }).send("2348031234567", "123456")).toEqual({ ok: false, reason: "rejected", detail: "http 502" });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await new MetaCloudSender({ ...opts, fetcher: down as unknown as typeof fetch }).send("2348031234567", "123456")).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("choosing a sender", () => {
  const full = {
    WHATSAPP_PROVIDER: "meta",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_ACCESS_TOKEN: "t",
    WHATSAPP_TEMPLATE_NAME: "sign_in_code",
  } as unknown as NodeJS.ProcessEnv;

  it("sends nothing unless a provider is chosen and complete", () => {
    expect(senderFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(senderFromEnv({ WHATSAPP_PROVIDER: "none" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(senderFromEnv({ WHATSAPP_PROVIDER: "meta" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(senderFromEnv({ ...full, WHATSAPP_ACCESS_TOKEN: " " })).toBeNull();
    expect(senderFromEnv({ WHATSAPP_PROVIDER: "carrier-pigeon" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("builds the Meta sender from the environment", () => {
    expect(senderFromEnv(full)?.name).toBe("meta");
  });
});

describe("the send-code hook", () => {
  const body = JSON.stringify({ user: { id: "u1", phone: "2348031234567" }, sms: { otp: "123456" } });

  function signed(payload = body, overrides: Record<string, string> = {}) {
    const id = "msg_abc";
    const timestamp = String(Math.floor(Date.now() / 1000));
    return new Request("https://app.example/api/auth/send-code", {
      method: "POST",
      body: payload,
      headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(SECRET, id, timestamp, payload), ...overrides },
    });
  }

  beforeEach(() => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "TOKEN");
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "sign_in_code");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers a correctly signed code and answers with an empty success", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(signed());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.to).toBe("2348031234567");
    expect(sent.template.components[0].parameters[0].text).toBe("123456");
  });

  it("does nothing for a bad signature, a missing one, or an old one", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(signed(body, { "webhook-signature": "v1,AAAA" }))).status).toBe(401);
    expect((await POST(new Request("https://app.example/api/auth/send-code", { method: "POST", body }))).status).toBe(401);
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await POST(signed(body, { "webhook-timestamp": stale, "webhook-signature": signWebhook(SECRET, "msg_abc", stale, body) }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("answers in the shape the sign-in service expects when it refuses", async () => {
    const response = await POST(signed(body, { "webhook-signature": "v1,AAAA" }));
    expect(await response.json()).toEqual({ error: { http_code: 401, message: "Not allowed." } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is switched off until the secret and a provider are set", async () => {
    vi.stubEnv("SEND_SMS_HOOK_SECRET", "");
    expect((await POST(signed())).status).toBe(503);
    vi.stubEnv("SEND_SMS_HOOK_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_PROVIDER", "none");
    expect((await POST(signed())).status).toBe(503);
  });

  it("refuses a body that is too large, unreadable, or has no number", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await POST(signed("x".repeat(5000)))).status).toBe(413);
    expect((await POST(signed("not json"))).status).toBe(400);
    expect((await POST(signed(JSON.stringify({ user: { id: "u1" }, sms: { otp: "123456" } })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fails cleanly, without echoing the code or the number, when WhatsApp refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 })));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(signed());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toMatch(/123456|2348031234567/);
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toMatch(/131026/);
    expect(logged).toMatch(/\*\*\*4567/);
    expect(logged).not.toMatch(/123456|2348031234567/);
  });
});

describe("the switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless set to on", () => {
    vi.stubEnv("WHATSAPP_SIGNIN", "");
    expect(whatsappSignInEnabled()).toBe(false);
    vi.stubEnv("WHATSAPP_SIGNIN", "true");
    expect(whatsappSignInEnabled()).toBe(false);
    vi.stubEnv("WHATSAPP_SIGNIN", " ON ");
    expect(whatsappSignInEnabled()).toBe(true);
  });
});
