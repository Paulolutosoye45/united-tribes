import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "@/lib/messaging/providers/whatsapp";
import { buildContext, renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { WHATSAPP_SAMPLES, WHATSAPP_TEMPLATES } from "@/lib/messaging/templates-whatsapp";
import { ACCOUNT_FAULT_CODES, faultCause, faultFix } from "@/lib/whatsapp/faults";
import { guardAdvice, guardHeadline, parseGuard } from "@/lib/whatsapp/guard";

// The WhatsApp safety net, on the application side: which Meta refusals mean "the account", what each is called in words, how the answer from the database is read, and the one alert that is sent.

const SQL = readFileSync(new URL("../../supabase/migrations/20270103000100_whatsapp_safety.sql", import.meta.url), "utf8");

describe("the Meta refusals that mean the account", () => {
  it("are the same list in the database and in the application", () => {
    const body = /create function public\.whatsapp_fault_code[\s\S]*?v_code in \(([0-9, ]+)\)/.exec(SQL)?.[1] ?? "";
    const inSql = body.split(",").map((s) => Number(s.trim()));
    const http = [...SQL.matchAll(/\^http \(([0-9|]+)\)/g)].flatMap((m) => m[1].split("|").map(Number));
    expect([...inSql, ...http].sort((a, b) => a - b)).toEqual([...ACCOUNT_FAULT_CODES].sort((a, b) => a - b));
  });

  it("are all given up on at once, never retried", () => {
    for (const code of ACCOUNT_FAULT_CODES) expect(classify(code >= 1000 || code < 400 ? code : undefined, code >= 400 && code < 1000 ? code : 400), String(code)).toBe("rejected");
  });

  it("never include a refusal about one member", () => {
    for (const code of [131026, 131049, 131056]) expect((ACCOUNT_FAULT_CODES as readonly number[]).includes(code), String(code)).toBe(false);
  });

  it("each have a cause and a fix in plain words, and an unknown code gets a safe line", () => {
    for (const code of ACCOUNT_FAULT_CODES) {
      expect(faultCause(code).length, String(code)).toBeGreaterThan(10);
      expect(faultFix(code).length, String(code)).toBeGreaterThan(10);
      expect(faultCause(code)).not.toMatch(/[A-Z]{4,}_/);
    }
    expect(faultCause(999999)).toBe("WhatsApp refused the account");
    expect(faultFix(999999)).toContain("WhatsApp Manager");
    expect(faultFix(131030)).toContain("WHATSAPP_PHONE_NUMBER_ID");
  });
});

describe("the alert to the office", () => {
  it("is one email-only message that says what happened and where to look", () => {
    expect(WHATSAPP_TEMPLATES.map((t) => t.key)).toEqual(["whatsapp_paused", "whatsapp_signal", "whatsapp_mode_alert", "whatsapp_test"]);
    // only the test message is ever put to Meta: the three alarms must not depend on the channel that is failing
    expect(WHATSAPP_TEMPLATES.filter((t) => t.emailOnly).map((t) => t.key)).toEqual(["whatsapp_paused", "whatsapp_signal", "whatsapp_mode_alert"]);
    expect(TEMPLATES.whatsapp_paused).toBeDefined();
    expect(TEMPLATES.whatsapp_paused.emailOnly).toBe(true);
    const mail = renderEmail(
      { id: "00000000-0000-4000-8000-000000000001", template: "whatsapp_paused", channel: "email", params: WHATSAPP_SAMPLES.whatsapp_paused, urgency: "normal", attempts: 1, reply_token: null, to: { email: "d@example.org", phone: null, name: "Dee", first_name: "Dee" } },
      "https://unitedtribes.example",
    );
    expect(mail.subject).toBe("WhatsApp messages are paused");
    expect(mail.text).toContain("/admin/messages");
    expect(mail.text).not.toMatch(/token|secret|password/i);
    const ctx = buildContext({ id: "x", template: "whatsapp_paused", channel: "email", params: WHATSAPP_SAMPLES.whatsapp_paused, urgency: "normal", attempts: 1, reply_token: null, to: { email: null, phone: null, name: null, first_name: null } }, "https://unitedtribes.example");
    expect(ctx.site).toBe("https://unitedtribes.example");
  });
});

describe("reading what the database says about WhatsApp", () => {
  const good = {
    state: "on", paused: true, auto: true, reason: "Meta refused the account 5 times in 30 minutes (code 190).", pausedAt: "2026-10-30T10:00:00Z", pausedBy: null, wouldPauseAt: null,
    canChange: true, canSettings: false, settings: { tripCount: 5, tripMinutes: 30, unconfirmedHours: 24 }, faultsNow: 5,
    faultCodes: [{ code: 190, n: 5 }, { code: 131030, n: 2 }], unconfirmed: { count: 3, oldest: "2026-10-29T10:00:00Z" },
    log: [{ at: "2026-10-30T10:00:00Z", kind: "auto_paused", reason: "x", by: null }],
  };

  it("reads a good answer, and treats anything else as nothing", () => {
    expect(parseGuard(good)?.faultCodes[0]).toEqual({ code: 190, n: 5 });
    for (const bad of [null, undefined, 5, "on", [], {}, { state: "maybe" }]) expect(parseGuard(bad), JSON.stringify(bad)).toBeNull();
  });

  it("survives missing and wrong-shaped parts", () => {
    const g = parseGuard({ state: "rehearsal", faultCodes: "no", log: [{ nope: 1 }, 7], settings: 3, unconfirmed: null, canChange: "yes" });
    expect(g).not.toBeNull();
    expect(g?.canChange).toBe(false);
    expect(g?.settings).toEqual({ tripCount: 5, tripMinutes: 30, unconfirmedHours: 24 });
    expect(g?.faultCodes).toEqual([]);
    expect(g?.log).toEqual([]);
    expect(g?.unconfirmed).toEqual({ count: 0, oldest: null });
  });

  it("says Off, Rehearsal, Running and Paused in different words", () => {
    const words = (over: Record<string, unknown>) => guardHeadline(parseGuard({ ...good, ...over })!).word;
    expect(words({ state: "off", paused: false })).toBe("Not watched");
    expect(words({ state: "rehearsal", paused: false })).toBe("Rehearsal");
    expect(words({ state: "on", paused: false })).toBe("Running");
    expect(words({ paused: true, auto: true })).toBe("Paused by itself");
    expect(words({ paused: true, auto: false })).toBe("Paused");
  });

  it("explains the most common refusal, or nothing when there was none", () => {
    expect(guardAdvice(parseGuard(good)!)?.cause).toBe(faultCause(190));
    expect(guardAdvice(parseGuard({ ...good, faultCodes: [] })!)).toBeNull();
  });
});
