import { SMTPServer, type SMTPServerSession } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { providersFromEnv, SmtpEmailSender } from "@/lib/messaging/providers";
import { classifySmtpError } from "@/lib/messaging/providers/smtp";
import type { ClaimedMessage } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

// These talk to a real SMTP server (the `smtp-server` package) on this computer, so the mail library, the login, the reply codes and the
// way each one is read are exercised for real, not guessed at.

const SITE = "https://unitedtribes.example";
const FROM = "United Tribes <hello@unitedtribes.example>";

function msg(template = "welcome", over: Partial<ClaimedMessage> = {}): ClaimedMessage {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    template,
    channel: "email",
    params: sampleParams(template),
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
    ...over,
  };
}

type Received = { from: string; to: string[]; raw: string; user: string | null };

let server: SMTPServer;
let port = 0;
let closedPort = 0;
const received: Received[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    // A plain server on this computer: no encryption offered, so login is allowed over it for the test.
    secure: false,
    disabledCommands: ["STARTTLS"],
    allowInsecureAuth: true,
    authOptional: false,
    logger: false,
    onAuth(auth, _session, callback) {
      if (auth.username === "platform" && auth.password === "correct horse") callback(null, { user: auth.username });
      else callback(new Error("Invalid login"));
    },
    onRcptTo(address, _session, callback) {
      if (address.address.startsWith("nobody@")) {
        const e = Object.assign(new Error("550 5.1.1 No such mailbox"), { responseCode: 550 });
        return callback(e);
      }
      if (address.address.startsWith("busy@")) {
        const e = Object.assign(new Error("451 4.7.1 Greylisted, please try again later"), { responseCode: 451 });
        return callback(e);
      }
      callback();
    },
    onData(stream, session: SMTPServerSession, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString("utf8"),
          user: (session.user as string | undefined) ?? null,
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.server.address() as { port: number }).port;

  // A port nothing listens on: open one and close it.
  const probe = new SMTPServer({ logger: false });
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  closedPort = (probe.server.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(resolve));
});

const sender = (over: Partial<ConstructorParameters<typeof SmtpEmailSender>[0]> = {}) =>
  new SmtpEmailSender({ host: "127.0.0.1", port, security: "none", user: "platform", password: "correct horse", from: FROM, ...over });

const header = (raw: string, name: string) => new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(raw.replace(/\r\n[ \t]+/g, " "))?.[1]?.trim();

describe("SMTP sender, against a real server", () => {
  it("delivers the message with the login, the right envelope and the right headers", async () => {
    received.length = 0;
    const result = await sender({ replyTo: "pastoral@unitedtribes.example" }).send(msg(), SITE);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.providerId).toBe("<ut-11111111-1111-4111-8111-111111111111-1@unitedtribes.example>");
    expect(received).toHaveLength(1);
    const got = received[0];
    expect(got.user).toBe("platform");
    expect(got.to).toEqual(["ada@example.org"]);
    expect(got.from).toBe("hello@unitedtribes.example");
    expect(header(got.raw, "From")).toBe(FROM);
    expect(header(got.raw, "To")).toContain("ada@example.org");
    expect(header(got.raw, "Reply-To")).toBe("pastoral@unitedtribes.example");
    expect(header(got.raw, "Message-ID")).toBe("<ut-11111111-1111-4111-8111-111111111111-1@unitedtribes.example>");
    expect(header(got.raw, "Auto-Submitted")).toBe("auto-generated");
    expect(header(got.raw, "Subject")).toBeTruthy();
    expect(header(got.raw, "X-Priority")).toBeUndefined();
    // Both a plain-text and a designed version go out
    expect(got.raw).toMatch(/Content-Type: multipart\/alternative/i);
    expect(got.raw).toMatch(/Content-Type: text\/plain/i);
    expect(got.raw).toMatch(/Content-Type: text\/html/i);
  });

  it("sends bounces to the bounce address when one is set, and keeps a different Message-ID for a later attempt", async () => {
    received.length = 0;
    const result = await sender({ bounceTo: "bounces@unitedtribes.example" }).send(msg("welcome", { attempts: 2 }), SITE);
    expect(result.ok && result.providerId).toBe("<ut-11111111-1111-4111-8111-111111111111-2@unitedtribes.example>");
    expect(received[0].from).toBe("bounces@unitedtribes.example");
    expect(header(received[0].raw, "From")).toBe(FROM);
  });

  it("marks an urgent care alert high priority", async () => {
    received.length = 0;
    await sender().send(msg("care_urgent", { urgency: "urgent" }), SITE);
    expect(header(received[0].raw, "Importance")).toBe("high");
    expect(header(received[0].raw, "X-Priority")).toBe("1");
  });

  it("carries the one-click unsubscribe headers on a reminder, and none on an ordinary message", async () => {
    const stop = "ab".repeat(32);
    const reminder = msg("reminder_email", {
      params: { kind: "reminder", copy: { journey: "member_form", step: 1, tone: "warm", subject: "Hello {first_name}", paragraphs: ["Hi."], button_label: "Go", actions: [] }, data: { first_name: "Ada", step: "story" }, links: { go: "cd".repeat(32), stop, prefs: "ef".repeat(32) }, church: { name: "The Covenant Nation", address: "Ota" } },
    });
    received.length = 0;
    await sender().send(reminder, SITE);
    await sender().send(msg("welcome"), SITE);
    expect(header(received[0].raw, "List-Unsubscribe")).toBe(`<${SITE}/api/email/unsubscribe?t=${stop}>`);
    expect(header(received[0].raw, "List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
    expect(header(received[1].raw, "List-Unsubscribe")).toBeUndefined();
  });

  it("keeps a non-ASCII name and subject readable", async () => {
    received.length = 0;
    await sender({ from: "Ìjọ̀ United Tribes <hello@unitedtribes.example>" }).send(msg("welcome", { to: { email: "ada@example.org", phone: null, name: "Adé Ọkafọ́r", first_name: "Adé" } }), SITE);
    expect(received).toHaveLength(1);
    expect(received[0].raw).toMatch(/=\?UTF-8\?/i);
  });

  it("is turned back, not retried, when the login is wrong", async () => {
    const result = await sender({ password: "wrong" }).send(msg(), SITE);
    expect(result).toEqual({ ok: false, kind: "rejected", error: expect.stringContaining("smtp login refused") });
    expect(JSON.stringify(result)).not.toContain("wrong");
  });

  it("is turned back when the server says there is no such mailbox", async () => {
    const result = await sender().send(msg("welcome", { to: { email: "nobody@example.org", phone: null, name: "N", first_name: "N" } }), SITE);
    expect(result).toMatchObject({ ok: false, kind: "rejected" });
    expect(!result.ok && result.error).toContain("550");
  });

  it("tries again later when the server says not now (greylisting, 451)", async () => {
    const result = await sender().send(msg("welcome", { to: { email: "busy@example.org", phone: null, name: "B", first_name: "B" } }), SITE);
    expect(result).toMatchObject({ ok: false, kind: "retry" });
    expect(!result.ok && result.kind === "retry" && result.retryMinutes).toBeGreaterThan(0);
    expect(!result.ok && result.error).toContain("451");
  });

  it("tries again later when the server cannot be reached", async () => {
    const result = await sender({ port: closedPort, connectionTimeoutMs: 2000 }).send(msg(), SITE);
    expect(result).toMatchObject({ ok: false, kind: "retry", error: "email server unreachable" });
  });

  it("sends nothing when the connection cannot be encrypted", async () => {
    received.length = 0;
    // This test server offers no encryption. With starttls required, the message must not go out in the clear.
    const result = await sender({ security: "starttls" }).send(msg(), SITE);
    expect(result.ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("does not connect for an address that cannot be one", async () => {
    const result = await sender({ port: closedPort }).send(msg("welcome", { to: { email: "not an address", phone: null, name: "X", first_name: "X" } }), SITE);
    expect(result).toEqual({ ok: false, kind: "rejected", error: "no email address" });
  });
});

describe("SMTP sender, with a server that offers encryption but a certificate that cannot be trusted", () => {
  let secured: SMTPServer;
  let securedPort = 0;
  const got: string[] = [];
  beforeAll(async () => {
    // smtp-server ships a self-signed certificate for "localhost": exactly the kind a visitor must not trust.
    secured = new SMTPServer({ logger: false, authOptional: true, onData: (stream, _s, cb) => { stream.on("data", (c: Buffer) => got.push(String(c))); stream.on("end", () => cb()); } });
    await new Promise<void>((resolve) => secured.listen(0, "127.0.0.1", resolve));
    securedPort = (secured.server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => secured.close(resolve));
  });

  it("refuses the connection, tries again later, and nothing is sent", async () => {
    const result = await new SmtpEmailSender({ host: "127.0.0.1", port: securedPort, security: "starttls", from: FROM }).send(msg(), SITE);
    expect(result).toMatchObject({ ok: false, kind: "retry" });
    expect(got).toHaveLength(0);
  });
});

describe("how a failure is read", () => {
  const err = (over: Record<string, unknown>) => Object.assign(new Error(String(over.message ?? "x")), over);
  it("treats 4xx as try again and 5xx as turned back", () => {
    expect(classifySmtpError(err({ responseCode: 421, response: "421 Too many connections" }), 1)).toMatchObject({ kind: "retry" });
    expect(classifySmtpError(err({ responseCode: 452, response: "452 Mailbox full" }), 1)).toMatchObject({ kind: "retry" });
    expect(classifySmtpError(err({ responseCode: 554, response: "554 Rejected as spam" }), 1)).toMatchObject({ kind: "rejected" });
    expect(classifySmtpError(err({ responseCode: 552, response: "552 Message too large" }), 1)).toMatchObject({ kind: "rejected" });
  });
  it("tries again after a temporary login fault, but not after a wrong password", () => {
    expect(classifySmtpError(err({ code: "EAUTH", responseCode: 454, response: "454 Temporary authentication failure" }), 1)).toMatchObject({ kind: "retry" });
    expect(classifySmtpError(err({ code: "EAUTH", responseCode: 535, response: "535 Authentication failed" }), 1)).toMatchObject({ kind: "rejected" });
  });
  it("tries again after a dropped, refused or timed-out connection", () => {
    for (const code of ["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "EDNS"]) expect(classifySmtpError(err({ code }), 1)).toMatchObject({ kind: "retry" });
  });
  it("waits longer after each attempt", () => {
    const a = classifySmtpError(err({ code: "ETIMEDOUT" }), 1);
    const b = classifySmtpError(err({ code: "ETIMEDOUT" }), 3);
    expect(!a.ok && a.kind === "retry" && b.ok === false && b.kind === "retry" && (b.retryMinutes ?? 0) > (a.retryMinutes ?? 0)).toBe(true);
  });
  it("keeps secrets out of what is stored", () => {
    const r = classifySmtpError(err({ responseCode: 550, response: "550 password=hunter2hunter2 refused" }), 1);
    expect(JSON.stringify(r)).not.toContain("hunter2hunter2");
  });
});

describe("choosing SMTP from the settings", () => {
  const base = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "mail.unitedtribes.example", EMAIL_FROM: FROM };

  it("uses the server, the port and the encryption that were given", () => {
    const email = providersFromEnv({ ...base, SMTP_USER: "platform", SMTP_PASSWORD: "pw" }).email;
    expect(email?.name).toBe("smtp");
    expect(email?.channel).toBe("email");
  });
  it("needs a host and a From address", () => {
    expect(providersFromEnv({ ...base, SMTP_HOST: "" }).email).toBeNull();
    expect(providersFromEnv({ ...base, EMAIL_FROM: "" }).email).toBeNull();
  });
  it("needs a password when there is a login name", () => {
    expect(providersFromEnv({ ...base, SMTP_USER: "platform" }).email).toBeNull();
    expect(providersFromEnv({ ...base, SMTP_USER: "platform", SMTP_PASSWORD: "pw" }).email).not.toBeNull();
  });
  it("accepts a server that needs no login", () => {
    expect(providersFromEnv(base).email?.name).toBe("smtp");
  });
  it("refuses a port that is not a port", () => {
    expect(providersFromEnv({ ...base, SMTP_PORT: "abc" }).email).toBeNull();
    expect(providersFromEnv({ ...base, SMTP_PORT: "70000" }).email).toBeNull();
    expect(providersFromEnv({ ...base, SMTP_PORT: "587" }).email).not.toBeNull();
  });
  it("leaves Resend and the log alone", () => {
    expect(providersFromEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k", EMAIL_FROM: FROM }).email?.name).toBe("resend");
    expect(providersFromEnv({ EMAIL_PROVIDER: "log" }).email?.name).toBe("log");
    expect(providersFromEnv({ MESSAGING_MODE: "log", ...base }).email?.name).toBe("log");
    expect(providersFromEnv({}).email).toBeNull();
  });
  it("sets the encryption from the port unless told otherwise", () => {
    const security = (env: Record<string, string>) => (providersFromEnv({ ...base, ...env }).email as unknown as { o: { security: string; port: number } }).o;
    expect(security({})).toMatchObject({ security: "starttls", port: 587 });
    expect(security({ SMTP_PORT: "465" })).toMatchObject({ security: "tls", port: 465 });
    expect(security({ SMTP_PORT: "2525" })).toMatchObject({ security: "starttls", port: 2525 });
    expect(security({ SMTP_SECURITY: "tls" })).toMatchObject({ security: "tls", port: 465 });
    expect(security({ SMTP_SECURITY: "none" })).toMatchObject({ security: "none", port: 25 });
    expect(security({ SMTP_PORT: "465", SMTP_SECURITY: "starttls" })).toMatchObject({ security: "starttls", port: 465 });
  });
});
