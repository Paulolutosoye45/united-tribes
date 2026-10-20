import { describe, expect, it, vi } from "vitest";
import { signHeaders } from "../../sender/src/auth";
import { SenderService, textProblem } from "../../sender/src/core";
import {
  TransportError,
  type InboundMessage,
  type ReceiptEvent,
  type SenderState,
  type Transport,
  type TransportHandlers,
} from "../../sender/src/transport";

const SECRET = "linked-sender-secret-of-some-length";
const APP = "https://app.example";
const TO = "2348031234567";
const CODE_TEXT = "United Tribes: your sign-in code is 123456. If you didn't ask for it, ignore this message.";

/** A WhatsApp that is not one: records what it was asked to send and lets a test make things happen. */
function fakeTransport() {
  let handlers!: TransportHandlers;
  const sent: { to: string; text: string }[] = [];
  const t = {
    failWith: null as TransportError | null,
    sent,
    async start(h: TransportHandlers) {
      handlers = h;
    },
    async sendText(to: string, text: string) {
      if (t.failWith) throw t.failWith;
      sent.push({ to, text });
      return { id: `m${sent.length}` };
    },
    async stop() {},
    state(s: SenderState) {
      handlers.onState(s);
    },
    message(m: Partial<InboundMessage> = {}, now = Date.now()) {
      handlers.onMessage({ id: "in1", from: TO, text: "Code", at: now, ...m });
    },
    receipt(r: Partial<ReceiptEvent> = {}) {
      handlers.onReceipt({ id: "m1", to: TO, state: "delivered", ...r });
    },
  };
  return t satisfies Transport & Record<string, unknown>;
}

type Fake = ReturnType<typeof fakeTransport>;

async function service(over: { appReply?: unknown; appStatus?: number; limits?: Record<string, number> } = {}) {
  const transport: Fake = fakeTransport();
  const logs: string[] = [];
  const posts: { path: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ path: String(url).replace(APP, ""), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(over.appReply ?? {}), { status: over.appStatus ?? 200 });
  });
  let clock = 1_800_000_000_000;
  const svc = new SenderService({
    secret: SECRET,
    appUrl: APP,
    transport,
    fetcher: fetcher as unknown as typeof fetch,
    now: () => clock,
    log: (line) => logs.push(line),
    limits: over.limits,
  });
  await svc.start();
  transport.state("open");
  return { svc, transport, logs, posts, advance: (ms: number) => (clock += ms), now: () => clock };
}

const signed = (body: string, now: number, secret = SECRET) => signHeaders(secret, body, now);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the sender service: who may ask it to send", () => {
  it("sends a short message when the website asks with a good signature", async () => {
    const { svc, transport, now } = await service();
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    const reply = await svc.handle("POST", "/send", signed(body, now()), body);
    expect(reply).toEqual({ status: 200, body: { ok: true, id: "m1" } });
    expect(transport.sent).toEqual([{ to: TO, text: CODE_TEXT }]);
  });

  it("refuses a wrong secret, a missing signature, a changed body and an old request, and sends nothing", async () => {
    const { svc, transport, now } = await service();
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    expect((await svc.handle("POST", "/send", signed(body, now(), "another-secret-of-some-length-xx"), body)).status).toBe(401);
    expect((await svc.handle("POST", "/send", {}, body)).status).toBe(401);
    expect((await svc.handle("POST", "/send", signed(body, now()), body.replace(TO, "2348099999999"))).status).toBe(401);
    expect((await svc.handle("POST", "/send", signed(body, now() - 10 * 60_000), body)).status).toBe(401);
    expect(transport.sent).toEqual([]);
  });

  it("refuses anything but a plain short message to a real-looking number, even when signed", async () => {
    const { svc, transport, now } = await service();
    const ask = async (payload: unknown) => {
      const body = JSON.stringify(payload);
      return svc.handle("POST", "/send", signed(body, now()), body);
    };
    expect((await ask({ to: "0803", text: CODE_TEXT })).status).toBe(400);
    expect((await ask({ to: TO })).status).toBe(422);
    expect((await ask({ to: TO, text: "   " })).status).toBe(422);
    expect((await ask({ to: TO, text: "x".repeat(201) })).status).toBe(422);
    expect((await ask({ to: TO, text: "Your code is 123456, see https://example.com/now" })).body).toEqual({ ok: false, reason: "bad_text_link" });
    expect((await ask({ to: TO, text: "Go to www.example.org" })).status).toBe(422);
    expect((await ask({ to: TO, text: "Visit tinyurl.ly today" })).status).toBe(422);
    const junk = "not json";
    expect((await svc.handle("POST", "/send", signed(junk, now()), junk)).status).toBe(400);
    expect(transport.sent).toEqual([]);
  });

  it("answers 404 for anything else and shows its state on /health", async () => {
    const { svc, now } = await service();
    expect((await svc.handle("GET", "/nothing", signed("", now()), "")).status).toBe(404);
    const health = await svc.handle("GET", "/health", signed("", now()), "");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, state: "open", sentLastHour: 0 });
    expect((await svc.handle("GET", "/health", {}, "")).status).toBe(401);
  });

  it("describes plain text as fine and the odd things as problems", () => {
    expect(textProblem(CODE_TEXT)).toBeNull();
    expect(textProblem("Not you? Reply STOP.")).toBeNull();
    expect(textProblem(5)).toBe("empty");
    expect(textProblem("see example.com")).toBe("link");
  });
});

describe("the sender service: the state of the number", () => {
  it("does not send while connecting, logged out or restricted, and says why", async () => {
    const { svc, transport, now } = await service();
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    for (const state of ["connecting", "logged_out", "restricted"] as const) {
      transport.state(state);
      const reply = await svc.handle("POST", "/send", signed(body, now()), body);
      expect(reply.status, state).toBe(503);
      expect(reply.body, state).toEqual({ ok: false, reason: state });
      expect((await svc.handle("GET", "/health", signed("", now()), "")).body).toMatchObject({ ok: false, state });
    }
    expect(transport.sent).toEqual([]);
  });

  it("marks itself restricted the moment WhatsApp says so, and stops sending", async () => {
    const { svc, transport, now } = await service();
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    transport.failWith = new TransportError("restricted");
    expect((await svc.handle("POST", "/send", signed(body, now()), body)).body).toEqual({ ok: false, reason: "restricted" });
    expect(svc.currentState).toBe("restricted");
    transport.failWith = null;
    expect((await svc.handle("POST", "/send", signed(body, now()), body)).status).toBe(503);
    expect(transport.sent).toEqual([]);
  });

  it("tells apart a number that is not on WhatsApp from a number that is down", async () => {
    const { svc, transport, now } = await service();
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    transport.failWith = new TransportError("not_on_whatsapp");
    expect((await svc.handle("POST", "/send", signed(body, now()), body)).status).toBe(422);
    transport.failWith = new TransportError("disconnected");
    expect((await svc.handle("POST", "/send", signed(body, now()), body)).status).toBe(503);
  });
});

describe("the sender service: its own limits", () => {
  it("refuses past its own per-minute limit, whoever asks, and lets go again a minute later", async () => {
    const { svc, transport, advance, now } = await service({ limits: { perMinute: 2, perHour: 100 } });
    const send = async () => {
      const body = JSON.stringify({ to: TO, text: CODE_TEXT });
      return svc.handle("POST", "/send", signed(body, now()), body);
    };
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third).toEqual({ status: 429, body: { ok: false, reason: "slow_down" } });
    expect(transport.sent).toHaveLength(2);
    advance(61_000);
    expect((await send()).status).toBe(200);
  });

  it("has an hourly limit too", async () => {
    const { svc, advance, now } = await service({ limits: { perMinute: 100, perHour: 3 } });
    const send = async () => {
      const body = JSON.stringify({ to: TO, text: CODE_TEXT });
      return svc.handle("POST", "/send", signed(body, now()), body);
    };
    for (let i = 0; i < 3; i++) {
      expect((await send()).status).toBe(200);
      advance(10 * 60_000);
    }
    // three in the last 30 minutes: the fourth is refused until the first is an hour old
    expect((await send()).status).toBe(429);
    advance(31 * 60_000);
    expect((await send()).status).toBe(200);
  });
});

describe("the sender service: what people send to the number", () => {
  it("passes a message to the website, signed, and sends the short reply the website asks for", async () => {
    const { transport, posts, svc, now } = await service({ appReply: { reply: "Got it. Your code is on its way." } });
    transport.message({ text: "Code", id: "a1" }, now());
    await settle();
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe("/api/auth/whatsapp-inbound");
    expect(posts[0].body).toEqual({ from: TO, text: "Code", id: "a1" });
    expect(posts[0].headers.get("x-ut-signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(transport.sent).toEqual([{ to: TO, text: "Got it. Your code is on its way." }]);
    expect(svc.currentState).toBe("open");
  });

  it("sends nothing when the website has nothing to say, or says something it may not send", async () => {
    for (const appReply of [{}, { reply: "" }, { reply: "Open https://evil.example now" }, { reply: 42 }]) {
      const { transport, now } = await service({ appReply });
      transport.message({}, now());
      await settle();
      expect(transport.sent, JSON.stringify(appReply)).toEqual([]);
    }
  });

  it("sends nothing when the website cannot be reached or refuses", async () => {
    const down = await service({ appStatus: 503, appReply: { reply: "ignored" } });
    down.transport.message({}, down.now());
    await settle();
    expect(down.transport.sent).toEqual([]);
    expect(down.logs.join("\n")).toMatch(/website said 503/);
  });

  it("handles the same message once", async () => {
    const { transport, posts, now } = await service({ appReply: { reply: "ok" } });
    transport.message({ id: "dup" }, now());
    transport.message({ id: "dup" }, now());
    await settle();
    expect(posts).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it("ignores messages that are old (history catching up) or from something that is not a number", async () => {
    const { transport, posts, now } = await service({ appReply: { reply: "ok" } });
    transport.message({ id: "old" }, now() - 10 * 60_000);
    transport.message({ id: "grp", from: "120363041234567890-1600000000" }, now());
    transport.message({ id: "blank", text: "   " }, now());
    await settle();
    expect(posts).toEqual([]);
    expect(transport.sent).toEqual([]);
  });

  it("will not keep talking to one person: a few replies a minute, then quiet", async () => {
    const { transport, now } = await service({ appReply: { reply: "ok" }, limits: { replyPerPersonPerMinute: 2 } });
    for (let i = 0; i < 5; i++) transport.message({ id: `n${i}` }, now());
    await settle();
    expect(transport.sent).toHaveLength(2);
  });

  it("tells the website when a reply could not be sent, so the breaker can count it", async () => {
    const { transport, posts, now } = await service({ appReply: { reply: "ok" } });
    transport.failWith = new TransportError("failed");
    transport.message({}, now());
    await settle();
    expect(posts.map((p) => p.path)).toEqual(["/api/auth/whatsapp-inbound", "/api/auth/whatsapp-receipt"]);
    expect(posts[1].body).toEqual({ to: TO, state: "failed" });
  });
});

describe("the sender service: delivery receipts", () => {
  it("passes a receipt on, once, and ignores a receipt for something that is not a number", async () => {
    const { transport, posts } = await service();
    transport.receipt({ id: "m1", state: "delivered" });
    transport.receipt({ id: "m1", state: "delivered" });
    transport.receipt({ id: "m1", state: "read" });
    transport.receipt({ id: "m2", to: "status@broadcast" });
    await settle();
    expect(posts.map((p) => p.body)).toEqual([
      { to: TO, state: "delivered", id: "m1" },
      { to: TO, state: "read", id: "m1" },
    ]);
    expect(posts.every((p) => p.path === "/api/auth/whatsapp-receipt")).toBe(true);
  });
});

describe("the sender service: what it never writes down", () => {
  it("keeps codes, messages and full numbers out of the log, even when things go wrong", async () => {
    const { svc, transport, logs, now } = await service({ appReply: { reply: "Your code is 654321" }, limits: { perMinute: 1 } });
    const body = JSON.stringify({ to: TO, text: CODE_TEXT });
    await svc.handle("POST", "/send", signed(body, now()), body);
    await svc.handle("POST", "/send", signed(body, now()), body); // over the limit
    transport.failWith = new TransportError("restricted");
    transport.message({ text: "STOP" }, now());
    transport.state("logged_out");
    await settle();
    const log = logs.join("\n");
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(TO);
    expect(log).not.toContain("123456");
    expect(log).not.toContain("654321");
    expect(log).not.toContain("sign-in code");
  });
});
