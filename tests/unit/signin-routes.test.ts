import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The routes themselves, with a stand-in for the database (the real limits are tested in tests/db/signin.test.ts and
 * the flows behind the routes in signin-flows.test.ts). What matters here is what comes OUT of each route:
 * who is turned away, and that a refusal for a limit looks exactly like a sent code.
 */
const db = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  answers: {} as Record<string, unknown>,
}));
vi.mock("@/lib/messaging/worker", async (original) => {
  const real = await original<typeof import("@/lib/messaging/worker")>();
  return {
    ...real,
    workerRpc: () => async (fn: string, args: Record<string, unknown> = {}) => {
      db.calls.push({ fn, args });
      const answer = db.answers[fn];
      if (answer instanceof Error) return { data: null, error: { message: answer.message, code: "XX000" } };
      return { data: answer ?? { ok: true }, error: null };
    },
  };
});

// The sign-in service the request route talks to: a stand-in that records what it was asked.
const auth = vi.hoisted(() => ({ asked: [] as unknown[], error: null as null | { code?: string; message?: string; status?: number } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async (args: unknown) => {
        auth.asked.push(args);
        return { error: auth.error };
      },
    },
  }),
}));

import { POST as hook } from "@/app/api/auth/send-code/route";
import { POST as requestCode } from "@/app/api/auth/request-code/route";
import { GET as channelStatus } from "@/app/api/auth/channel-status/route";
import { POST as inbound } from "@/app/api/auth/whatsapp-inbound/route";
import { POST as receipt } from "@/app/api/auth/whatsapp-receipt/route";
import { linkedHeaders } from "@/lib/signin/signing";
import { signWebhook } from "@/lib/whatsapp/webhook";

const HOOK_SECRET = `v1,whsec_${Buffer.from("a-test-secret-of-some-length-1234").toString("base64")}`;
const LINKED_SECRET = "linked-sender-secret-of-some-length";
const TOKEN = "w".repeat(40);
const NUMBER = "2348031234567";

function env(over: Record<string, string> = {}) {
  const base: Record<string, string> = {
    WORKER_TOKEN: TOKEN,
    SEND_SMS_HOOK_SECRET: HOOK_SECRET,
    WHATSAPP_PROVIDER: "meta",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_ACCESS_TOKEN: "TOKEN",
    WHATSAPP_TEMPLATE_NAME: "sign_in_code",
    WHATSAPP_SIGNIN: "on",
    LINKED_SENDER_SECRET: LINKED_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v);
}

const hookBody = JSON.stringify({ user: { id: "u1", phone: NUMBER }, sms: { otp: "123456" } });
function signedHook(payload = hookBody, headers: Record<string, string> = {}) {
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://app.example/api/auth/send-code", {
    method: "POST",
    body: payload,
    headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signWebhook(HOOK_SECRET, id, timestamp, payload), ...headers },
  });
}

function linked(path: string, payload: unknown, secret = LINKED_SECRET) {
  const body = JSON.stringify(payload);
  return new Request(`https://app.example${path}`, { method: "POST", body, headers: linkedHeaders(secret, body) });
}

const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  db.calls.length = 0;
  db.answers = {};
  auth.asked.length = 0;
  auth.error = null;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  env();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the send-code hook and the limits", () => {
  it("turns away a wrong or missing signature before asking the database anything", async () => {
    expect((await hook(signedHook(hookBody, { "webhook-signature": "v1,AAAA" }))).status).toBe(401);
    expect((await hook(new Request("https://app.example/api/auth/send-code", { method: "POST", body: hookBody }))).status).toBe(401);
    expect(db.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers a number over its limit exactly as it answers a code that went, and sends nothing", async () => {
    db.answers = { worker_signin_gate: { decision: "allow", attempt: 1, mode: "normal" }, worker_signin_record: { ok: true } };
    const sent = await hook(signedHook());
    const sentBody = await sent.text();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockClear();
    for (const reason of ["number_15m", "number_day", "wait", "channel_hour", "channel_day", "blocked", "paused", "off", "direct"]) {
      db.answers = { worker_signin_gate: { decision: "decline", reason } };
      const declined = await hook(signedHook());
      expect(declined.status, reason).toBe(sent.status);
      expect(await declined.text(), reason).toBe(sentBody);
      expect(declined.headers.get("cache-control"), reason).toBe(sent.headers.get("cache-control"));
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still fails honestly when the limits cannot be checked, rather than sending without them", async () => {
    db.answers = { worker_signin_gate: new Error("database unreachable") };
    const response = await hook(signedHook());
    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells the database when WhatsApp refuses, so the breaker can see it", async () => {
    db.answers = { worker_signin_gate: { decision: "allow", attempt: 9, mode: "normal" } };
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await hook(signedHook());
    expect(response.status).toBe(500);
    const record = db.calls.find((c) => c.fn === "worker_signin_record");
    expect(record?.args).toMatchObject({ p_attempt: 9, p_outcome: "rejected" });
  });

  it("never puts the number or the code in the database call that asks about the limits", async () => {
    db.answers = { worker_signin_gate: { decision: "allow", attempt: 1, mode: "normal" }, worker_signin_record: { ok: true } };
    await hook(signedHook());
    const text = JSON.stringify(db.calls);
    expect(text).not.toContain(NUMBER);
    expect(text).not.toContain("123456");
  });

  it("only treats the add-number flow as such when the hook says a new number is being added", async () => {
    db.answers = { worker_signin_gate: { decision: "allow", attempt: 1, mode: "normal" }, worker_signin_record: { ok: true } };
    await hook(signedHook(JSON.stringify({ user: { id: "u1", phone: "2348000000000", new_phone: NUMBER }, sms: { otp: "654321" } })));
    expect(db.calls.find((c) => c.fn === "worker_signin_gate")?.args).toMatchObject({ p_flow: "add_number", p_route: "official" });
  });
});

describe("asking for a code from the sign-in screen", () => {
  const ask = (body: unknown, headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9" }) =>
    requestCode(new Request("https://app.example/api/auth/request-code", { method: "POST", body: JSON.stringify(body), headers }));

  it("counts the network, then asks the sign-in service, passing the bot-check token straight on", async () => {
    db.answers = { worker_signin_network_gate: { decision: "allow" } };
    const response = await ask({ phone: "0803 123 4567", captchaToken: "tok" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.calls.map((c) => c.fn)).toContain("worker_signin_network_gate");
    expect(auth.asked).toEqual([{ phone: "+2348031234567", options: { channel: "whatsapp", shouldCreateUser: false, captchaToken: "tok" } }]);
  });

  it("stores only hashes: no number and no network address reach the database", async () => {
    db.answers = { worker_signin_network_gate: { decision: "allow" } };
    await ask({ phone: "08031234567" });
    const text = JSON.stringify(db.calls);
    expect(text).not.toMatch(/2348031234567|8031234567|203\.0\.113\.9/);
    const gate = db.calls.find((c) => c.fn === "worker_signin_network_gate");
    expect(gate?.args.p_network_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(gate?.args.p_number_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says the same thing whether or not the number has an account", async () => {
    db.answers = { worker_signin_network_gate: { decision: "allow" } };
    const known = await ask({ phone: "08031234567" });
    auth.error = { code: "otp_disabled", message: "Signups not allowed for otp" };
    const unknown = await ask({ phone: "08099999999" });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("turns away a network that asks too often, and a paused channel, before the sign-in service is asked", async () => {
    db.answers = { worker_signin_network_gate: { decision: "decline", reason: "network" } };
    const busy = await ask({ phone: "08031234567" });
    expect(busy.status).toBe(429);
    expect((await busy.json()).message).toMatch(/Too many|try again/i);
    db.answers = { worker_signin_network_gate: { decision: "decline", reason: "paused" } };
    const paused = await ask({ phone: "08031234567" });
    expect(paused.status).toBe(503);
    expect((await paused.json()).message).toMatch(/paused/i);
    expect(auth.asked).toEqual([]);
  });

  it("refuses a number that is not a number, and a request that is not a request", async () => {
    expect((await ask({ phone: "abc" })).status).toBe(400);
    const odd = await requestCode(new Request("https://app.example/api/auth/request-code", { method: "POST", body: "nope" }));
    expect(odd.status).toBe(400);
    const big = await requestCode(new Request("https://app.example/api/auth/request-code", { method: "POST", body: JSON.stringify({ phone: "0803", captchaToken: "x".repeat(7000) }) }));
    expect(big.status).toBe(413);
    expect(auth.asked).toEqual([]);
  });

  it("is off when WhatsApp sign-in is not switched on", async () => {
    vi.stubEnv("WHATSAPP_SIGNIN", "");
    const response = await ask({ phone: "08031234567" });
    expect(response.status).toBe(503);
    expect(auth.asked).toEqual([]);
  });
});

describe("the channel status", () => {
  it("shows whether it is on, paused or off, and nothing about why", async () => {
    db.answers = { worker_signin_status: { status: "on", mode: "normal" } };
    const on = await (await channelStatus()).json();
    expect(on).toMatchObject({ available: true, status: "on" });
    db.answers = { worker_signin_status: { status: "paused", mode: "normal" } };
    const paused = await (await channelStatus()).json();
    expect(paused.status).toBe("paused");
    expect(Object.keys(paused).sort()).toEqual(["available", "mode", "number", "status"]);
  });
});

describe("what the sender service tells the website", () => {
  it("refuses a request with the wrong secret, none, or an old time", async () => {
    expect((await inbound(linked("/api/auth/whatsapp-inbound", { from: NUMBER, text: "Code" }, "some-other-secret-of-some-length"))).status).toBe(401);
    expect((await inbound(new Request("https://app.example/api/auth/whatsapp-inbound", { method: "POST", body: JSON.stringify({ from: NUMBER, text: "Code" }) }))).status).toBe(401);
    const body = JSON.stringify({ from: NUMBER, text: "Code" });
    const old = new Request("https://app.example/api/auth/whatsapp-inbound", { method: "POST", body, headers: linkedHeaders(LINKED_SECRET, body, Date.now() - 20 * 60_000) });
    expect((await inbound(old)).status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it("is off until the shared secret is long enough", async () => {
    vi.stubEnv("LINKED_SENDER_SECRET", "short");
    expect((await inbound(linked("/api/auth/whatsapp-inbound", { from: NUMBER, text: "Code" }, "short"))).status).toBe(503);
    expect((await receipt(linked("/api/auth/whatsapp-receipt", { to: NUMBER, state: "delivered" }, "short"))).status).toBe(503);
  });

  it("passes a signed STOP to the database as a block, by hash", async () => {
    db.answers = { worker_signin_stop: { ok: true } };
    const response = await inbound(linked("/api/auth/whatsapp-inbound", { from: NUMBER, text: "STOP" }));
    expect(response.status).toBe(200);
    const stop = db.calls.find((c) => c.fn === "worker_signin_stop");
    expect(stop?.args.p_kind).toBe("stop");
    expect(JSON.stringify(db.calls)).not.toContain(NUMBER);
    // And the answer lets the number reply with something short and plain.
    const body = await response.json();
    expect(typeof body.reply === "string" || body.reply === undefined).toBe(true);
  });

  it("reads a receipt, and refuses one with an unknown state", async () => {
    db.answers = { worker_signin_receipt: { ok: true } };
    expect((await receipt(linked("/api/auth/whatsapp-receipt", { to: NUMBER, state: "delivered" }))).status).toBe(200);
    expect(db.calls.some((c) => c.fn === "worker_signin_receipt")).toBe(true);
    db.calls.length = 0;
    expect((await receipt(linked("/api/auth/whatsapp-receipt", { to: NUMBER, state: "exploded" }))).status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it("refuses a request that is too large or unreadable", async () => {
    const body = "x".repeat(5000);
    const big = new Request("https://app.example/api/auth/whatsapp-inbound", { method: "POST", body, headers: linkedHeaders(LINKED_SECRET, body) });
    expect((await inbound(big)).status).toBe(413);
    const junk = "not json";
    const odd = new Request("https://app.example/api/auth/whatsapp-inbound", { method: "POST", body: junk, headers: linkedHeaders(LINKED_SECRET, junk) });
    expect((await inbound(odd)).status).toBe(400);
  });
});
