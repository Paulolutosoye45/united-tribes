import { describe, expect, it, vi } from "vitest";
import { dailyJobFaults, runDispatch, readClaimed } from "@/lib/messaging/dispatch";
import { LogProvider, providersFromEnv, ResendEmailSender, TermiiSmsSender, TwilioSmsSender, WhatsAppTemplateSender } from "@/lib/messaging/providers";
import { classify } from "@/lib/messaging/providers/whatsapp";
import type { SendResult } from "@/lib/messaging/providers/types";
import type { ClaimedMessage } from "@/lib/messaging/types";
import type { RpcResult, WorkerRpc } from "@/lib/messaging/worker";
import { sampleParams } from "./fixtures/message-params";

const SITE = "https://unitedtribes.example";

function msg(template = "welcome", over: Partial<ClaimedMessage> = {}): ClaimedMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    template,
    channel: "whatsapp",
    params: sampleParams(template),
    urgency: "normal",
    attempts: 1,
    reply_token: template === "friday_checkin" ? "b".repeat(64) : null,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
    ...over,
  };
}

type Call = { url: string; init: RequestInit; body: unknown };
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const text = typeof init?.body === "string" ? init.body : "";
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // form-encoded or empty
    }
    calls.push({ url: String(url), init: init ?? {}, body });
    const next = responses.shift() ?? new Response("{}", { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetcher, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("WhatsApp sender", () => {
  const make = (fetcher: typeof fetch) =>
    new WhatsAppTemplateSender({ phoneNumberId: "123456", token: "tok", language: "en", graphVersion: "v23.0", fetcher });

  it("sends the approved template with its variables, to digits only", async () => {
    const { fetcher, calls } = fakeFetch([json(200, { messages: [{ id: "wamid.ABC" }] })]);
    const result = await make(fetcher).send(msg(), SITE);
    expect(result).toEqual({ ok: true, providerId: "wamid.ABC" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/123456/messages");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = calls[0].body as { to: string; template: { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] } };
    expect(body.to).toBe("2348031234567");
    expect(body.template.name).toBe("ut_welcome");
    expect(body.template.language.code).toBe("en");
    expect(body.template.components[0].parameters.map((p) => p.text)[0]).toBe("Ada");
    expect(body.template.components).toHaveLength(1);
  });

  it("adds the quick-reply buttons for the Friday check-in, each carrying its own answer", async () => {
    const { fetcher, calls } = fakeFetch([json(200, { messages: [{ id: "wamid.X" }] })]);
    await make(fetcher).send(msg("friday_checkin"), SITE);
    const comps = (calls[0].body as { template: { components: { type: string; sub_type?: string; index?: string; parameters: { payload?: string }[] }[] } }).template.components;
    expect(comps.slice(1).map((c) => [c.type, c.sub_type, c.index, c.parameters[0].payload])).toEqual([
      ["button", "quick_reply", "0", `ck:${"b".repeat(64)}:done`],
      ["button", "quick_reply", "1", `ck:${"b".repeat(64)}:partly`],
      ["button", "quick_reply", "2", `ck:${"b".repeat(64)}:not_yet`],
    ]);
  });

  it("gives up on this channel when there is no number, without calling Meta", async () => {
    const { fetcher, calls } = fakeFetch([]);
    const r = await make(fetcher).send(msg("welcome", { to: { email: "a@b.org", phone: null, name: null, first_name: null } }), SITE);
    expect(r).toMatchObject({ ok: false, kind: "rejected" });
    expect(calls).toHaveLength(0);
  });

  it("tells a hiccup from a dead end", async () => {
    const send = async (res: Response | Error, attempts = 1) => make(fakeFetch([res]).fetcher).send(msg("welcome", { attempts }), SITE);
    // not on WhatsApp / template missing: the next channel should be tried
    expect(await send(json(400, { error: { code: 131026, message: "Message undeliverable" } }))).toMatchObject({ ok: false, kind: "rejected", error: expect.stringContaining("131026") });
    expect(await send(json(404, { error: { code: 132001, message: "Template does not exist" } }))).toMatchObject({ kind: "rejected" });
    // rate limit, server trouble, network: try again later
    expect(await send(json(429, { error: { code: 130429 } }, { "retry-after": "120" }))).toMatchObject({ kind: "retry", retryMinutes: 2 });
    expect(await send(json(503, {}))).toMatchObject({ kind: "retry" });
    expect(await send(new Error("socket hang up"))).toMatchObject({ kind: "retry", error: "whatsapp unreachable" });
    // the pause grows with each attempt
    const first = (await send(new Error("x"), 1)) as Extract<SendResult, { ok: false }>;
    const third = (await send(new Error("x"), 3)) as Extract<SendResult, { ok: false }>;
    expect(third.retryMinutes!).toBeGreaterThan(first.retryMinutes!);
    expect(classify(undefined, 400)).toBe("rejected");
    expect(classify(190, 401)).toBe("rejected");
  });

  it("never puts the phone number or message text in an error", async () => {
    const r = await make(fakeFetch([json(400, { error: { code: 100, message: "Invalid parameter +2348031234567 secret=abcdefghijklmnop" } })]).fetcher).send(msg(), SITE);
    expect(JSON.stringify(r)).not.toContain("2348031234567");
    expect(JSON.stringify(r)).not.toContain("abcdefghijklmnop");
  });
});

describe("email sender", () => {
  const make = (fetcher: typeof fetch) => new ResendEmailSender({ apiKey: "re_key", from: "United Tribes <hello@unitedtribes.example>", fetcher });

  it("sends html and plain text, with a key that stops a double send", async () => {
    const { fetcher, calls } = fakeFetch([json(200, { id: "em_1" })]);
    const r = await make(fetcher).send(msg("welcome", { channel: "email" }), SITE);
    expect(r).toEqual({ ok: true, providerId: "em_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_key");
    expect(headers["idempotency-key"]).toContain("11111111-1111-4111-8111-111111111111");
    const body = calls[0].body as { to: string[]; subject: string; html: string; text: string; from: string };
    expect(body).toMatchObject({ to: ["ada@example.org"], from: "United Tribes <hello@unitedtribes.example>" });
    expect(body.html).toContain("<html");
    expect(body.text).toContain("Hi Ada,");
  });

  it("sends the one-click unsubscribe headers with a reminder or an announcement, and none with an ordinary message", async () => {
    const stop = "ab".repeat(32);
    const reminder = msg("reminder_email", {
      channel: "email",
      params: { kind: "reminder", copy: { journey: "member_form", step: 1, tone: "warm", subject: "Hello {first_name}", paragraphs: ["Hi."], button_label: "Go", actions: [] }, data: { first_name: "Ada", step: "story" }, links: { go: "cd".repeat(32), stop, prefs: "ef".repeat(32) }, church: { name: "The Covenant Nation", address: "Ota" } },
    });
    const { fetcher, calls } = fakeFetch([json(200, { id: "em_3" }), json(200, { id: "em_4" })]);
    await make(fetcher).send(reminder, SITE);
    await make(fetcher).send(msg("welcome", { channel: "email" }), SITE);
    expect((calls[0].body as { headers: Record<string, string> }).headers).toEqual({
      "List-Unsubscribe": `<${SITE}/api/email/unsubscribe?t=${stop}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect((calls[1].body as { headers?: unknown }).headers).toBeUndefined();
  });

  it("marks an urgent care alert high priority", async () => {
    const { fetcher, calls } = fakeFetch([json(200, { id: "em_2" })]);
    await make(fetcher).send(msg("care_urgent", { channel: "email", urgency: "urgent" }), SITE);
    expect((calls[0].body as { headers: Record<string, string> }).headers).toMatchObject({ Importance: "high" });
  });

  it("rejects a bad address, retries a server error, and rejects a refusal", async () => {
    expect(await make(fakeFetch([]).fetcher).send(msg("welcome", { channel: "email", to: { email: "nope", phone: null, name: null, first_name: null } }), SITE)).toMatchObject({ kind: "rejected" });
    expect(await make(fakeFetch([json(500, {})]).fetcher).send(msg("welcome", { channel: "email" }), SITE)).toMatchObject({ kind: "retry" });
    expect(await make(fakeFetch([json(422, { message: "Invalid `to` field" })]).fetcher).send(msg("welcome", { channel: "email" }), SITE)).toMatchObject({ kind: "rejected" });
    expect(await make(fakeFetch([new Error("down")]).fetcher).send(msg("welcome", { channel: "email" }), SITE)).toMatchObject({ kind: "retry" });
  });
});

describe("text message senders", () => {
  it("Termii: sends on the do-not-disturb route by default, to digits only", async () => {
    const { fetcher, calls } = fakeFetch([json(200, { code: "ok", message_id: "tm_1", message: "Successfully Sent" })]);
    const r = await new TermiiSmsSender({ apiKey: "k", senderId: "UnitedTribes", fetcher }).send(msg("welcome", { channel: "sms" }), SITE);
    expect(r).toEqual({ ok: true, providerId: "tm_1" });
    expect(calls[0].url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(calls[0].body).toMatchObject({ to: "2348031234567", from: "UnitedTribes", channel: "dnd", type: "plain" });
    expect((calls[0].body as { sms: string }).sms).toContain("Welcome to Builders Tribe");
  });

  it("Termii: tells a refusal from a hiccup", async () => {
    const t = (res: Response | Error) => new TermiiSmsSender({ apiKey: "k", senderId: "X", fetcher: fakeFetch([res]).fetcher }).send(msg("welcome", { channel: "sms" }), SITE);
    expect(await t(json(400, { message: "Invalid sender" }))).toMatchObject({ kind: "rejected" });
    expect(await t(json(502, {}))).toMatchObject({ kind: "retry" });
    expect(await t(new Error("x"))).toMatchObject({ kind: "retry" });
  });

  it("Twilio: sends a form with basic auth, from a number or a messaging service", async () => {
    const { fetcher, calls } = fakeFetch([json(201, { sid: "SM1" }), json(201, { sid: "SM2" })]);
    const a = new TwilioSmsSender({ accountSid: "AC1", authToken: "secret", from: "+15005550006", fetcher });
    expect(await a.send(msg("welcome", { channel: "sms" }), SITE)).toEqual({ ok: true, providerId: "SM1" });
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("To")).toBe("+2348031234567");
    expect(form.get("From")).toBe("+15005550006");
    const b = new TwilioSmsSender({ accountSid: "AC1", authToken: "secret", messagingServiceSid: "MG1", fetcher });
    await b.send(msg("welcome", { channel: "sms" }), SITE);
    expect(new URLSearchParams(String(calls[1].init.body)).get("MessagingServiceSid")).toBe("MG1");
  });

  it("Twilio: a number that cannot receive is a dead end", async () => {
    const r = await new TwilioSmsSender({ accountSid: "AC1", authToken: "s", from: "+1", fetcher: fakeFetch([json(400, { code: 21211, message: "Invalid 'To' Phone Number" })]).fetcher }).send(msg("welcome", { channel: "sms" }), SITE);
    expect(r).toMatchObject({ ok: false, kind: "rejected", error: expect.stringContaining("21211") });
  });
});

describe("choosing providers from the environment", () => {
  it("has none by default, so a message for a channel that is not set up is turned back", () => {
    expect(providersFromEnv({})).toEqual({ whatsapp: null, email: null, sms: null });
  });

  it("builds each from its own settings, and ignores one that is half set up", () => {
    const p = providersFromEnv({
      WHATSAPP_PROVIDER: "meta", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t",
      EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.org",
      SMS_PROVIDER: "termii", TERMII_API_KEY: "k",
    });
    expect(p.whatsapp?.name).toBe("meta");
    expect(p.email?.name).toBe("resend");
    expect(p.sms).toBeNull(); // no sender id
    expect(providersFromEnv({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "a", TWILIO_AUTH_TOKEN: "b", TWILIO_FROM: "+1" }).sms?.name).toBe("twilio");
    expect(providersFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }).email).toBeNull(); // no from address
  });

  it("MESSAGING_MODE=log sends nothing anywhere", async () => {
    const p = providersFromEnv({ MESSAGING_MODE: "log", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.org" });
    expect(p.email).toBeInstanceOf(LogProvider);
    expect(p.whatsapp).toBeInstanceOf(LogProvider);
    expect(p.sms).toBeInstanceOf(LogProvider);
  });

  it("the log provider masks who it would have written to", async () => {
    const lines: string[] = [];
    const log = new LogProvider("email", (l) => lines.push(l));
    const r = await log.send(msg("welcome", { channel: "email" }), SITE);
    expect(r).toMatchObject({ ok: true });
    expect(lines[0]).toContain("a***@example.org");
    expect(lines[0]).not.toContain("ada@example.org");
    const sms = new LogProvider("sms", (l) => lines.push(l));
    await sms.send(msg("welcome", { channel: "sms" }), SITE);
    expect(lines[1]).toContain("***4567");
    expect(lines[1]).not.toContain("2348031234567");
  });
});

describe("the dispatcher", () => {
  function rig(batches: unknown[][], opts: { reportFailsFor?: string; tickError?: boolean } = {}) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const queue = [...batches];
    const rpc: WorkerRpc = async (fn, args = {}) => {
      calls.push({ fn, args });
      if (fn === "worker_tick") return opts.tickError ? { data: null, error: { message: "boom" } } : { data: { queued: 3 }, error: null };
      if (fn === "worker_claim") return { data: queue.shift() ?? [], error: null };
      if (fn === "worker_report") {
        if (opts.reportFailsFor && args.p_id === opts.reportFailsFor) return { data: null, error: { message: "down" } };
        return { data: null, error: null };
      }
      return { data: null, error: null } satisfies RpcResult;
    };
    return { rpc, calls, reports: () => calls.filter((c) => c.fn === "worker_report").map((c) => c.args) };
  }
  const row = (id: string, channel = "whatsapp", template = "welcome") => ({
    id, template, channel, params: sampleParams(template), urgency: "normal", attempts: 1, reply_token: null,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada", first_name: "Ada" },
  });
  const ok = (id = "p1"): SendResult => ({ ok: true, providerId: id });
  const provider = (channel: "whatsapp" | "email" | "sms", results: SendResult[]) => ({
    channel, name: "stub", sent: [] as ClaimedMessage[],
    async send(m: ClaimedMessage) { this.sent.push(m); return results.shift() ?? ok(); },
  });

  it("runs the calendar, sends what the database hands out, and reports each result", async () => {
    const r = rig([[row("a"), row("b", "email"), row("c", "sms")]]);
    const wa = provider("whatsapp", [ok("wamid.1")]);
    const em = provider("email", [{ ok: false, kind: "retry", error: "down", retryMinutes: 7 }]);
    const sm = provider("sms", [{ ok: false, kind: "rejected", error: "invalid number" }]);
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: wa, email: em, sms: sm }, site: SITE });
    expect(summary).toMatchObject({ claimed: 3, sent: 1, retried: 1, rejected: 1, problems: [], calendar: { queued: 3 } });
    expect(r.calls[0].fn).toBe("worker_tick");
    expect(r.reports()).toEqual([
      { p_id: "a", p_outcome: "sent", p_provider_id: "wamid.1" },
      { p_id: "b", p_outcome: "retry", p_error: "down", p_retry_minutes: 7 },
      { p_id: "c", p_outcome: "rejected", p_error: "invalid number", p_retry_minutes: undefined },
    ]);
  });

  it("tidies the referee check each time, and reports a fault without stopping the messages", async () => {
    const calls: string[] = [];
    const rpc: WorkerRpc = async (fn) => {
      calls.push(fn);
      if (fn === "worker_referee_tick") return { data: null, error: { message: "locked" } };
      if (fn === "worker_claim") return { data: calls.filter((c) => c === "worker_claim").length === 1 ? [row("a")] : [], error: null };
      return { data: null, error: null };
    };
    const wa = provider("whatsapp", [ok("wamid.9")]);
    const summary = await runDispatch({ rpc, providers: { whatsapp: wa, email: null, sms: null }, site: SITE });
    expect(calls).toContain("worker_referee_tick");
    expect(summary.problems).toEqual(["referees: locked"]);
    expect(summary.sent).toBe(1);
  });

  it("turns a message back when its channel is not set up, so the database tries the next", async () => {
    const r = rig([[row("a", "sms")]]);
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: null, email: null, sms: null }, site: SITE });
    expect(summary.rejected).toBe(1);
    expect(r.reports()[0]).toMatchObject({ p_id: "a", p_outcome: "rejected", p_error: "sms is not set up" });
  });

  it("does not let one broken message stop the rest", async () => {
    const r = rig([[row("bad", "whatsapp", "no_such_template"), row("good")]]);
    const wa = { channel: "whatsapp" as const, name: "real", async send(m: ClaimedMessage, site: string) {
      const { renderWhatsApp } = await import("@/lib/messaging/render");
      renderWhatsApp(m, site); // throws for an unknown template, as a real sender would
      return ok("fine");
    } };
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: wa, email: null, sms: null }, site: SITE });
    expect(summary).toMatchObject({ sent: 1, rejected: 1 });
    expect(r.reports()[0]).toMatchObject({ p_id: "bad", p_outcome: "rejected", p_error: expect.stringContaining("could not prepare") });
  });

  it("keeps going in batches until the queue is empty, within a limit", async () => {
    const full = Array.from({ length: 3 }, (_, i) => row(`m${i}`));
    const r = rig([full, full.map((m) => ({ ...m, id: `n${m.id}` })), [row("last")]]);
    const wa = provider("whatsapp", []);
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: wa, email: null, sms: null }, site: SITE, batchSize: 3 });
    expect(summary.claimed).toBe(7);
    expect(wa.sent).toHaveLength(7);
    expect(r.calls.filter((c) => c.fn === "worker_claim")).toHaveLength(3);

    const r2 = rig([full, full, full, full]);
    await runDispatch({ rpc: r2.rpc, providers: { whatsapp: provider("whatsapp", []), email: null, sms: null }, site: SITE, batchSize: 3, maxBatches: 2 });
    expect(r2.calls.filter((c) => c.fn === "worker_claim")).toHaveLength(2);
  });

  it("stops starting new batches when the time budget is spent", async () => {
    let t = 0;
    const r = rig([[row("a"), row("b")], [row("c"), row("d")]]);
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: provider("whatsapp", []), email: null, sms: null }, site: SITE, batchSize: 2, budgetMs: 1000, now: () => (t += 800) });
    expect(summary.claimed).toBe(2);
  });

  it("reports calendar and claim failures instead of throwing", async () => {
    const a = await runDispatch({ ...{ rpc: rig([], { tickError: true }).rpc, providers: { whatsapp: null, email: null, sms: null }, site: SITE } });
    expect(a.problems).toEqual(["calendar: boom"]);
    const failing: WorkerRpc = async (fn) => (fn === "worker_claim" ? { data: null, error: { message: "nope" } } : { data: {}, error: null });
    const b = await runDispatch({ rpc: failing, providers: { whatsapp: null, email: null, sms: null }, site: SITE });
    expect(b.problems).toContain("claim: nope");
  });

  it("tries a report twice, because a message that went out but is not marked would go out again", async () => {
    const attempts: number[] = [];
    const rpc: WorkerRpc = async (fn, args) => {
      if (fn === "worker_claim") return { data: attempts.length === 0 ? [row("x")] : [], error: null };
      if (fn === "worker_report") {
        attempts.push(1);
        return attempts.length === 1 ? { data: null, error: { message: "blip" } } : { data: null, error: null };
      }
      void args;
      return { data: {}, error: null };
    };
    const summary = await runDispatch({ rpc, providers: { whatsapp: provider("whatsapp", []), email: null, sms: null }, site: SITE, tick: false });
    expect(attempts).toHaveLength(2);
    expect(summary.problems).toEqual([]);
  });

  it("flags a message it could not report on", async () => {
    const r = rig([[row("x")]], { reportFailsFor: "x" });
    const summary = await runDispatch({ rpc: r.rpc, providers: { whatsapp: provider("whatsapp", []), email: null, sms: null }, site: SITE, tick: false });
    expect(summary.problems).toEqual(["report failed for welcome"]);
    expect(JSON.stringify(summary)).not.toMatch(/ada@|2348031234567/);
  });

  it("reads the database’s answer defensively", () => {
    expect(readClaimed(null)).toEqual([]);
    expect(readClaimed([null, 3, { id: 1 }, { id: "a", template: "welcome", channel: "pigeon" }])).toEqual([]);
    const [m] = readClaimed([{ id: "a", template: "welcome", channel: "email", params: [1], urgency: "urgent", to: { email: " a@b.org ", phone: "", name: null } }]);
    expect(m).toMatchObject({ id: "a", urgency: "urgent", params: {}, attempts: 1, to: { email: "a@b.org", phone: null, name: null } });
  });

  it("calls nothing when asked not to run the calendar", async () => {
    const r = rig([[]]);
    await runDispatch({ rpc: r.rpc, providers: { whatsapp: null, email: null, sms: null }, site: SITE, tick: false });
    expect(r.calls.map((c) => c.fn)).toEqual(["worker_claim"]);
  });
});

void vi;

describe("the daily jobs inside the heartbeat", () => {
  it("lists a job that failed, by name, and never the database's own words", () => {
    const faults = dailyJobFaults({ retention_error: 'relation "public.secret_table" does not exist', insight_error: "boom ada@example.org", queued: 3 });
    expect(faults).toHaveLength(2);
    expect(faults.join(" ")).toMatch(/insight/);
    expect(faults.join(" ")).toMatch(/retention/);
    expect(faults.join(" ")).not.toMatch(/secret_table|ada@example|boom/);
  });

  it("says nothing when they ran, or when the tick gave nothing back", () => {
    expect(dailyJobFaults({ retention_ran: true, queued: 0 })).toEqual([]);
    expect(dailyJobFaults(null)).toEqual([]);
    expect(dailyJobFaults("nope")).toEqual([]);
    expect(dailyJobFaults({ retention_error: 5 })).toEqual([]);
  });
});
