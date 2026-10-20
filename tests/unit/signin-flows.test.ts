import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { open, seal } from "@/lib/crypto/seal";
import type { RpcResult, WorkerRpc } from "@/lib/messaging/worker";
import { loadChannel } from "@/lib/signin/channel";
import { hashNetwork, hashNumber } from "@/lib/signin/hash";
import { runInbound, runReceipt } from "@/lib/signin/inbound-flow";
import { runRequestCode, type OtpResult } from "@/lib/signin/request-code";
import { runSendCode } from "@/lib/signin/send-code";
import { runSigninTick } from "@/lib/signin/tick";
import { codeMessage, STOP_REPLY } from "@/lib/signin/wording";
import { LinkedSender } from "@/lib/whatsapp/linked";
import { senderFromEnv, type CodeSender, type SendResult } from "@/lib/whatsapp/provider";

const SALT = "a-long-enough-salt-for-the-tests";
const TO = "2348031234567";
const HASH = hashNumber(TO, SALT)!;

type Call = { fn: string; args: Record<string, unknown> };
/** A database that answers each function from a table of answers, and remembers what it was asked. */
function fakeRpc(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const rpc: WorkerRpc = async (fn, args = {}) => {
    calls.push({ fn, args });
    const answer = answers[fn];
    const data = typeof answer === "function" ? (answer as (a: Record<string, unknown>) => unknown)(args) : answer;
    if (data instanceof Error) return { data: null, error: { message: data.message, code: "XX000" } } satisfies RpcResult;
    return { data: data ?? null, error: null };
  };
  return { rpc, calls };
}

function fakeSender(over: Partial<CodeSender> & { result?: SendResult } = {}) {
  const sent: { to: string; code: string }[] = [];
  const sender: CodeSender = {
    name: over.name ?? "fake",
    route: over.route ?? "official",
    send: async (to, code) => {
      sent.push({ to, code });
      return over.result ?? { ok: true };
    },
  };
  return { sender, sent };
}

const hook = { userId: "u1", to: TO, code: "123456", flow: "sign_in" as const };
const ALLOW = { decision: "allow", attempt: 42, mode: "normal" };

describe("sending a code", () => {
  it("sends it, tells the database it went, and answers with the empty success", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_gate: ALLOW, worker_signin_record: { ok: true } });
    const { sender, sent } = fakeSender();
    const out = await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: () => {} });
    expect(out).toEqual({ status: 200, body: {} });
    expect(sent).toEqual([{ to: TO, code: "123456" }]);
    expect(calls[0]).toEqual({ fn: "worker_signin_gate", args: { p_number_hash: HASH, p_flow: "sign_in", p_route: "official" } });
    expect(calls[1]).toEqual({ fn: "worker_signin_record", args: { p_attempt: 42, p_outcome: "sent", p_detail: "sent" } });
  });

  it("asks the database about the hash, never the number, and tells the route and flow", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_gate: ALLOW, worker_signin_record: { ok: true } });
    await runSendCode({ ...hook, flow: "add_number" }, { sender: fakeSender({ route: "linked", name: "linked" }).sender, rpc, salt: SALT, seal, log: () => {} });
    expect(JSON.stringify(calls)).not.toContain(TO);
    expect(JSON.stringify(calls)).not.toContain("123456");
    expect(calls[0].args).toMatchObject({ p_flow: "add_number", p_route: "linked" });
  });

  it("answers exactly as it does for a sent code when a limit says no, and sends nothing", async () => {
    const sentAnswer = await runSendCode(hook, { sender: fakeSender().sender, ...fakeRpc({ worker_signin_gate: ALLOW, worker_signin_record: { ok: true } }), salt: SALT, seal, log: () => {} });
    for (const reason of ["number_15m", "number_day", "wait", "channel_hour", "channel_day", "blocked", "paused", "off", "direct"]) {
      const { sender, sent } = fakeSender();
      const { rpc, calls } = fakeRpc({ worker_signin_gate: { decision: "decline", reason } });
      const logged: string[] = [];
      const out = await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: (l) => logged.push(l) });
      expect(out, reason).toEqual(sentAnswer);
      expect(sent, reason).toEqual([]);
      expect(calls.map((c) => c.fn), reason).toEqual(["worker_signin_gate"]);
      expect(logged.join(" ")).not.toMatch(/123456|2348031234567/);
      expect(logged.join(" ")).toContain("***4567");
    }
  });

  it("fails closed when the limits cannot be checked", async () => {
    for (const rpc of [fakeRpc({ worker_signin_gate: new Error("down") }).rpc, fakeRpc({ worker_signin_gate: { nonsense: true } }).rpc, fakeRpc({}).rpc]) {
      const { sender, sent } = fakeSender();
      const out = await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: () => {} });
      expect(out.status).toBe(503);
      expect(sent).toEqual([]);
    }
  });

  it("fails closed with no salt, because it could not count anything", async () => {
    const { sender, sent } = fakeSender();
    const out = await runSendCode(hook, { sender, rpc: fakeRpc({}).rpc, salt: null, seal, log: () => {} });
    expect(out.status).toBe(503);
    expect(sent).toEqual([]);
  });

  it("reports a failed send to the database, so the breaker sees it, and to the sign-in service", async () => {
    for (const [result, outcome] of [
      [{ ok: false, reason: "rejected", detail: "meta 131026" }, "rejected"],
      [{ ok: false, reason: "unreachable" }, "failed"],
      [{ ok: false, reason: "not_configured" }, "failed"],
    ] as [SendResult, string][]) {
      const { rpc, calls } = fakeRpc({ worker_signin_gate: ALLOW, worker_signin_record: { ok: true } });
      const logged: string[] = [];
      const out = await runSendCode(hook, { sender: fakeSender({ result }).sender, rpc, salt: SALT, seal, log: (l) => logged.push(l) });
      expect(out).toEqual({ status: 500, body: { error: { http_code: 500, message: "We couldn't send the WhatsApp message." } } });
      expect(calls[1].args).toMatchObject({ p_attempt: 42, p_outcome: outcome });
      expect(logged.join(" ")).toContain("***4567");
      expect(logged.join(" ")).not.toMatch(/123456|2348031234567/);
    }
  });

  it("still answers when the database cannot be told how it went", async () => {
    const { rpc } = fakeRpc({ worker_signin_gate: ALLOW, worker_signin_record: new Error("down") });
    const logged: string[] = [];
    const out = await runSendCode(hook, { sender: fakeSender().sender, rpc, salt: SALT, seal, log: (l) => logged.push(l) });
    expect(out).toEqual({ status: 200, body: {} });
    expect(logged.join(" ")).toMatch(/not recorded/);
  });

  describe("reply-first", () => {
    const gate = { decision: "allow", attempt: 42, mode: "reply_first" };

    it("seals the code and keeps it instead of sending, on the ordinary number only", async () => {
      const { rpc, calls } = fakeRpc({ worker_signin_gate: gate, worker_signin_hold: { ok: true } });
      const { sender, sent } = fakeSender({ route: "linked", name: "linked" });
      const out = await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: () => {} });
      expect(out).toEqual({ status: 200, body: {} });
      expect(sent).toEqual([]);
      const held = calls.find((c) => c.fn === "worker_signin_hold")!;
      const sealed = String(held.args.p_sealed);
      expect(sealed).not.toContain("123456");
      expect(open(sealed, "signin:42")).toBe("123456");
      expect(open(sealed, "signin:43")).toBeNull();
    });

    it("sends at once on the official route whatever the setting says", async () => {
      const { rpc } = fakeRpc({ worker_signin_gate: gate, worker_signin_record: { ok: true } });
      const { sender, sent } = fakeSender({ route: "official", name: "meta" });
      await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: () => {} });
      expect(sent).toHaveLength(1);
    });

    it("sends at once in normal mode on the ordinary number", async () => {
      const { rpc } = fakeRpc({ worker_signin_gate: { ...gate, mode: "normal" }, worker_signin_record: { ok: true } });
      const { sender, sent } = fakeSender({ route: "linked", name: "linked" });
      await runSendCode(hook, { sender, rpc, salt: SALT, seal, log: () => {} });
      expect(sent).toHaveLength(1);
    });

    it("fails, and says so to the database, when the code cannot be kept safe", async () => {
      const { rpc, calls } = fakeRpc({ worker_signin_gate: gate, worker_signin_hold: { ok: true }, worker_signin_record: { ok: true } });
      const out = await runSendCode(hook, { sender: fakeSender({ route: "linked" }).sender, rpc, salt: SALT, seal: () => { throw new Error("no key"); }, log: () => {} });
      expect(out.status).toBe(500);
      expect(calls.at(-1)).toMatchObject({ fn: "worker_signin_record", args: { p_outcome: "failed", p_detail: "not_held" } });
      expect(calls.some((c) => c.fn === "worker_signin_hold")).toBe(false);
    });

    it("fails when the database does not take the code", async () => {
      const { rpc, calls } = fakeRpc({ worker_signin_gate: gate, worker_signin_hold: { ok: false }, worker_signin_record: { ok: true } });
      const out = await runSendCode(hook, { sender: fakeSender({ route: "linked" }).sender, rpc, salt: SALT, seal, log: () => {} });
      expect(out.status).toBe(500);
      expect(calls.at(-1)?.args).toMatchObject({ p_outcome: "failed" });
    });
  });
});

describe("asking for a code on the screen", () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.7" });
  const base = { phone: "0803 123 4567", captchaToken: "tok", headers };
  const okOtp = async (): Promise<OtpResult> => ({ error: null });
  const deps = (rpc: WorkerRpc, otp: (phone: string, captchaToken: string | undefined) => Promise<OtpResult> = okOtp) => ({ available: true, rpc, salt: SALT, otp });

  it("checks the network, then asks the sign-in service with the bot-check token and the number in full", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_network_gate: { decision: "allow", attempt: 1 } });
    const otp = vi.fn(okOtp);
    const out = await runRequestCode(base, deps(rpc, otp));
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(otp).toHaveBeenCalledWith("+2348031234567", "tok");
    expect(calls[0]).toEqual({
      fn: "worker_signin_network_gate",
      args: { p_network_hash: hashNetwork("203.0.113.7", SALT), p_number_hash: HASH },
    });
    expect(JSON.stringify(calls)).not.toMatch(/203\.0\.113\.7|2348031234567/);
  });

  it("says the same thing whether or not the number has an account", async () => {
    const { rpc } = fakeRpc({ worker_signin_network_gate: { decision: "allow", attempt: 1 } });
    const known = await runRequestCode(base, deps(rpc, okOtp));
    for (const error of [{ code: "otp_disabled" }, { code: "signup_disabled" }, { message: "Signups not allowed for otp" }]) {
      expect(await runRequestCode(base, deps(rpc, async () => ({ error })))).toEqual(known);
    }
  });

  it("refuses, the same way for every number, when WhatsApp is off or paused or the network has asked too often", async () => {
    const paused = fakeRpc({ worker_signin_network_gate: { decision: "decline", reason: "paused" } }).rpc;
    const a = await runRequestCode(base, deps(paused));
    const b = await runRequestCode({ ...base, phone: "0809 999 8888" }, deps(paused));
    expect(a).toEqual(b);
    expect(a.status).toBe(503);
    expect(a.body).toMatchObject({ error: "paused", message: "WhatsApp codes are paused today. Use email." });
    const off = await runRequestCode(base, deps(fakeRpc({ worker_signin_network_gate: { decision: "decline", reason: "off" } }).rpc));
    expect(off.body).toMatchObject({ error: "paused" });
    const busy = await runRequestCode(base, deps(fakeRpc({ worker_signin_network_gate: { decision: "decline", reason: "network" } }).rpc, vi.fn(okOtp)));
    expect(busy.status).toBe(429);
    expect(busy.body).toMatchObject({ error: "network" });
    expect(JSON.stringify(busy.body)).toMatch(/use email/i);
  });

  it("never asks the sign-in service when a limit has already said no", async () => {
    const otp = vi.fn(okOtp);
    await runRequestCode(base, deps(fakeRpc({ worker_signin_network_gate: { decision: "decline", reason: "network" } }).rpc, otp));
    await runRequestCode(base, deps(fakeRpc({ worker_signin_network_gate: { decision: "decline", reason: "paused" } }).rpc, otp));
    expect(otp).not.toHaveBeenCalled();
  });

  it("turns away a number that cannot be one, before anything else", async () => {
    const { rpc, calls } = fakeRpc({});
    for (const phone of ["", "abc", "0803", "+234 803 123"]) {
      const out = await runRequestCode({ ...base, phone }, deps(rpc));
      expect(out).toMatchObject({ status: 400, body: { error: "bad_number" } });
    }
    expect(calls).toEqual([]);
  });

  it("is off when the website is not set up for it", async () => {
    expect(await runRequestCode(base, { available: false, rpc: fakeRpc({}).rpc, salt: SALT, otp: okOtp })).toMatchObject({ status: 503, body: { error: "off" } });
    expect(await runRequestCode(base, { available: true, rpc: null, salt: SALT, otp: okOtp })).toMatchObject({ status: 503 });
    expect(await runRequestCode(base, { available: true, rpc: fakeRpc({}).rpc, salt: null, otp: okOtp })).toMatchObject({ status: 503, body: { error: "unavailable" } });
  });

  it("passes on a bot-check failure, a rate limit and a plain failure in words, without the service's own text", async () => {
    const { rpc } = fakeRpc({ worker_signin_network_gate: { decision: "allow", attempt: 1 } });
    const captcha = await runRequestCode(base, deps(rpc, async () => ({ error: { code: "captcha_failed", message: "captcha verification process failed" } })));
    expect(captcha).toMatchObject({ status: 400, body: { error: "captcha_failed" } });
    expect(JSON.stringify(captcha.body)).toMatch(/confirm you are a person/);
    const limited = await runRequestCode(base, deps(rpc, async () => ({ error: { code: "over_sms_send_rate_limit", status: 429 } })));
    expect(limited.status).toBe(429);
    expect(JSON.stringify(limited.body)).toMatch(/Too many tries/);
    const odd = await runRequestCode(base, deps(rpc, async () => ({ error: { code: "x", message: "duplicate key value violates unique constraint" } })));
    expect(JSON.stringify(odd.body)).not.toMatch(/duplicate|constraint/);
    const thrown = await runRequestCode(base, deps(rpc, async () => { throw new Error("network"); }));
    expect(thrown.status).toBe(502);
  });

  it("counts every address in the same IPv6 range as one network", async () => {
    const seen: unknown[] = [];
    const { rpc } = fakeRpc({ worker_signin_network_gate: (a: Record<string, unknown>) => (seen.push(a.p_network_hash), { decision: "allow", attempt: 1 }) });
    await runRequestCode({ ...base, headers: new Headers({ "x-real-ip": "2001:db8:abcd:12::1" }) }, deps(rpc));
    await runRequestCode({ ...base, headers: new Headers({ "x-real-ip": "2001:db8:abcd:12:ffff::2" }) }, deps(rpc));
    expect(new Set(seen).size).toBe(1);
  });
});

describe("a message to the sign-in number", () => {
  const deps = (rpc: WorkerRpc, log: (l: string) => void = () => {}) => ({ rpc, salt: SALT, open, log });

  it("hands over a held code, in the fixed message, to the person who asked", async () => {
    const sealed = seal("654321", "signin:7");
    const { rpc, calls } = fakeRpc({ worker_signin_release: { attempt: 7, sealed } });
    const out = await runInbound({ from: "+234 803 123 4567", text: "Send my code" }, deps(rpc));
    expect(out).toEqual({ status: 200, body: { reply: codeMessage("654321") } });
    expect(calls).toEqual([{ fn: "worker_signin_release", args: { p_number_hash: HASH } }]);
  });

  it("says nothing to someone who has not asked for a code", async () => {
    const { rpc } = fakeRpc({ worker_signin_release: null });
    expect(await runInbound({ from: TO, text: "hello" }, deps(rpc))).toEqual({ status: 200, body: { reply: null } });
  });

  it("blocks the number and replies politely to STOP and to “not me”, and never releases a code to them", async () => {
    for (const [text, kind] of [["STOP", "stop"], ["Stop please", "stop"], ["this was not me", "not_me"], ["I didn't ask", "not_me"]]) {
      const { rpc, calls } = fakeRpc({ worker_signin_stop: { ok: true } });
      const out = await runInbound({ from: TO, text }, deps(rpc));
      expect(out).toEqual({ status: 200, body: { reply: STOP_REPLY } });
      expect(calls).toEqual([{ fn: "worker_signin_stop", args: { p_number_hash: HASH, p_kind: kind } }]);
    }
  });

  it("does not reply, and says the sender should try again, when the block could not be recorded", async () => {
    const { rpc } = fakeRpc({ worker_signin_stop: new Error("down") });
    const out = await runInbound({ from: TO, text: "STOP" }, deps(rpc));
    expect(out.status).toBe(503);
    expect(out.body).toEqual({ reply: null });
  });

  it("gives up on a code it cannot open, and tells the database it failed", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_release: { attempt: 7, sealed: seal("654321", "signin:999") }, worker_signin_record: { ok: true } });
    const logged: string[] = [];
    const out = await runInbound({ from: TO, text: "code" }, deps(rpc, (l) => logged.push(l)));
    expect(out.body).toEqual({ reply: null });
    expect(calls.at(-1)).toMatchObject({ fn: "worker_signin_record", args: { p_attempt: 7, p_outcome: "failed" } });
    expect(logged.join(" ")).not.toMatch(/654321|2348031234567/);
  });

  it("ignores a sender it cannot read as a number", async () => {
    const { rpc, calls } = fakeRpc({});
    expect(await runInbound({ from: "status@broadcast", text: "hi" }, deps(rpc))).toEqual({ status: 200, body: { reply: null } });
    expect(await runInbound({ from: TO, text: "hi" }, { ...deps(rpc), salt: null })).toEqual({ status: 200, body: { reply: null } });
    expect(calls).toEqual([]);
  });

  it("passes a delivery receipt to the database by hash", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_receipt: { ok: true } });
    expect(await runReceipt({ to: TO, state: "delivered" }, { rpc, salt: SALT, log: () => {} })).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual([{ fn: "worker_signin_receipt", args: { p_number_hash: HASH, p_state: "delivered" } }]);
    expect((await runReceipt({ to: "nope", state: "failed" }, { rpc, salt: SALT, log: () => {} })).body).toEqual({ ok: false });
    const down = fakeRpc({ worker_signin_receipt: new Error("down") }).rpc;
    expect((await runReceipt({ to: TO, state: "failed" }, { rpc: down, salt: SALT, log: () => {} })).status).toBe(503);
  });
});

describe("what the screen is told", () => {
  const full = { WHATSAPP_SIGNIN: "on", WHATSAPP_SIGNIN_NUMBER: "+234 803 000 1111" };
  const linked = fakeSender({ route: "linked", name: "linked" }).sender;
  const official = fakeSender({ route: "official", name: "meta" }).sender;
  const rpc = (data: unknown) => fakeRpc({ worker_signin_status: data }).rpc;

  it("is unavailable until the website is set up, so the screen shows email only", async () => {
    const off = { available: false, status: "off", mode: "normal", number: null };
    expect(await loadChannel({ env: { ...full, WHATSAPP_SIGNIN: "" }, sender: official, rpc: rpc({ status: "on", mode: "normal" }), salt: SALT })).toEqual(off);
    expect(await loadChannel({ env: full, sender: null, rpc: rpc({ status: "on", mode: "normal" }), salt: SALT })).toEqual(off);
    expect(await loadChannel({ env: full, sender: official, rpc: null, salt: SALT })).toEqual(off);
    expect(await loadChannel({ env: full, sender: official, rpc: rpc({ status: "on", mode: "normal" }), salt: null })).toEqual(off);
  });

  it("reports on, off and paused, and the number to save", async () => {
    expect(await loadChannel({ env: full, sender: linked, rpc: rpc({ status: "on", mode: "reply_first" }), salt: SALT })).toEqual({ available: true, status: "on", mode: "reply_first", number: "2348030001111" });
    expect((await loadChannel({ env: full, sender: linked, rpc: rpc({ status: "paused", mode: "reply_first" }), salt: SALT })).status).toBe("paused");
    expect((await loadChannel({ env: full, sender: linked, rpc: rpc({ status: "off", mode: "normal" }), salt: SALT })).status).toBe("off");
  });

  it("says paused when the database cannot be asked, so nobody is offered a code that cannot be sent", async () => {
    expect((await loadChannel({ env: full, sender: linked, rpc: fakeRpc({ worker_signin_status: new Error("down") }).rpc, salt: SALT })).status).toBe("paused");
    expect((await loadChannel({ env: full, sender: linked, rpc: rpc({ status: "banana" }), salt: SALT })).status).toBe("paused");
    const throwing: WorkerRpc = async () => { throw new Error("boom"); };
    expect((await loadChannel({ env: full, sender: linked, rpc: throwing, salt: SALT })).status).toBe("paused");
  });

  it("ignores the mode on the official route, which always sends the code itself", async () => {
    expect((await loadChannel({ env: full, sender: official, rpc: rpc({ status: "on", mode: "reply_first" }), salt: SALT })).mode).toBe("normal");
  });

  it("is unavailable in reply-first mode with no number to tell people to message", async () => {
    expect((await loadChannel({ env: { WHATSAPP_SIGNIN: "on" }, sender: linked, rpc: rpc({ status: "on", mode: "reply_first" }), salt: SALT })).available).toBe(false);
    expect((await loadChannel({ env: { WHATSAPP_SIGNIN: "on" }, sender: linked, rpc: rpc({ status: "on", mode: "normal" }), salt: SALT })).available).toBe(true);
  });
});

describe("the sign-in part of the heartbeat", () => {
  it("tells the database how the sending number is, then lets it tidy up", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_sender_signal: { ok: true }, worker_signin_tick: { status: "on" } });
    const sender: CodeSender = { name: "linked", route: "linked", send: async () => ({ ok: true }), health: async () => "logged_out" };
    const out = await runSigninTick({ rpc, sender });
    expect(out).toEqual({ problems: [], status: "on", signal: "logged_out" });
    expect(calls.map((c) => c.fn)).toEqual(["worker_signin_sender_signal", "worker_signin_tick"]);
    expect(calls[0].args).toEqual({ p_signal: "logged_out" });
  });

  it("has no one to ask on the official route, and still tidies up", async () => {
    const { rpc, calls } = fakeRpc({ worker_signin_tick: { status: "paused" } });
    expect(await runSigninTick({ rpc, sender: fakeSender().sender })).toEqual({ problems: [], status: "paused", signal: null });
    expect(calls.map((c) => c.fn)).toEqual(["worker_signin_tick"]);
  });

  it("reports a fault and carries on", async () => {
    const sender: CodeSender = { name: "linked", send: async () => ({ ok: true }), health: async () => { throw new Error("x"); } };
    const out = await runSigninTick({ rpc: fakeRpc({ worker_signin_tick: new Error("down") }).rpc, sender });
    expect(out.problems).toHaveLength(2);
    expect(out.status).toBeNull();
  });
});

describe("the ordinary-number sender, from the website's side", () => {
  const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  const env = { SIGNIN_WHATSAPP_ROUTE: "linked", LINKED_SENDER_URL: "https://sender.example.org/", LINKED_SENDER_SECRET: "s".repeat(32) };

  it("is chosen with SIGNIN_WHATSAPP_ROUTE, and leaves the site's other WhatsApp messages alone", () => {
    const sender = senderFromEnv(asEnv({ ...env, WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_TEMPLATE_NAME: "x" }));
    expect(sender?.name).toBe("linked");
    expect(sender?.route).toBe("linked");
    expect(senderFromEnv(asEnv({ SIGNIN_WHATSAPP_ROUTE: "official", WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_TEMPLATE_NAME: "x" }))?.name).toBe("meta");
    expect(senderFromEnv(asEnv({ WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_TEMPLATE_NAME: "x" }))?.route).toBe("official");
  });

  it("needs a secure address and a real secret", () => {
    expect(senderFromEnv(asEnv({ ...env, LINKED_SENDER_URL: "http://sender.example.org" }))).toBeNull();
    expect(senderFromEnv(asEnv({ ...env, LINKED_SENDER_URL: "" }))).toBeNull();
    expect(senderFromEnv(asEnv({ ...env, LINKED_SENDER_SECRET: "short" }))).toBeNull();
    expect(senderFromEnv(asEnv({ ...env, LINKED_SENDER_URL: "http://127.0.0.1:8080" }))?.name).toBe("linked");
    expect(senderFromEnv(asEnv({ ...env, LINKED_SENDER_URL: "http://localhost:8080" }))?.name).toBe("linked");
  });

  it("sends the fixed message, signed, and nothing else", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sender = new LinkedSender({ url: "https://sender.example.org", secret: "s".repeat(32), fetcher });
    expect(await sender.send(TO, "123456")).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sender.example.org/send");
    expect(JSON.parse(init.body as string)).toEqual({ to: TO, text: codeMessage("123456") });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-ut-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers["x-ut-timestamp"]).toMatch(/^\d+$/);
  });

  it("tells a number that is not on WhatsApp from a service that is down", async () => {
    const reply = (status: number, body: unknown) => new LinkedSender({ url: "https://s.example", secret: "s".repeat(32), fetcher: async () => new Response(JSON.stringify(body), { status }) });
    expect(await reply(422, { reason: "not_on_whatsapp" }).send(TO, "123456")).toMatchObject({ ok: false, reason: "rejected" });
    expect(await reply(503, { reason: "logged_out" }).send(TO, "123456")).toMatchObject({ ok: false, reason: "unreachable", detail: "logged_out" });
    expect(await reply(500, "garbage").send(TO, "123456")).toMatchObject({ ok: false, reason: "unreachable" });
    const gone = new LinkedSender({ url: "https://s.example", secret: "s".repeat(32), fetcher: async () => { throw new Error("offline"); } });
    expect(await gone.send(TO, "123456")).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("asks the sender how it is, and reads logged out and restricted", async () => {
    const health = (status: number, body: unknown) => new LinkedSender({ url: "https://s.example", secret: "s".repeat(32), fetcher: async () => new Response(JSON.stringify(body), { status }) }).health();
    expect(await health(200, { state: "open" })).toBe("ok");
    expect(await health(200, { state: "logged_out" })).toBe("logged_out");
    expect(await health(200, { state: "restricted" })).toBe("restricted");
    expect(await health(200, { state: "connecting" })).toBe("unreachable");
    expect(await health(401, {})).toBe("unreachable");
    expect(await new LinkedSender({ url: "https://s.example", secret: "s".repeat(32), fetcher: async () => { throw new Error("x"); } }).health()).toBe("unreachable");
  });
});
