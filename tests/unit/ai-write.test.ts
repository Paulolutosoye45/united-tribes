import { describe, expect, it, vi } from "vitest";
import { mockProvider } from "@/lib/ai/providers/mock";
import { WRITER_SYSTEM, numbersAreGrounded, tidyAnswer, writeText } from "@/lib/ai/write";
import type { AiProvider } from "@/lib/ai/types";
import { digestFacts, digestSummary, enrichMessage } from "@/lib/messaging/summary";
import { TEMPLATES } from "@/lib/messaging/templates";
import { buildContext, renderEmail } from "@/lib/messaging/render";
import type { ClaimedMessage } from "@/lib/messaging/types";

const req = (draft = "Draft text for week 3.") => ({
  purpose: "digest_summary" as const,
  system: WRITER_SYSTEM,
  facts: "Week 3: 2 tribes in your care.\n1 on track.",
  draft,
  maxChars: 300,
});

const provider = (text: string | Error, spy = vi.fn()): AiProvider => ({
  name: "fake",
  model: "fake-1",
  suggest: async () => ({ suggestions: [] }),
  write: async (input) => {
    spy(input);
    if (text instanceof Error) throw text;
    return { text };
  },
});

describe("writing with and without an AI", () => {
  it("uses the plain draft when no provider is set up", async () => {
    expect(await writeText(req(), { provider: null })).toEqual({ text: "Draft text for week 3.", ai: false, reason: "no_provider" });
  });

  it("uses what the model wrote when it passes the checks", async () => {
    const out = await writeText(req(), { provider: provider("Two tribes, and one is on track in week 3.") });
    expect(out).toEqual({ text: "Two tribes, and one is on track in week 3.", ai: true });
  });

  it("falls back to the draft on an error or a timeout, and never throws", async () => {
    expect((await writeText(req(), { provider: provider(new Error("boom")) })).reason).toBe("error");
    const slow: AiProvider = { ...provider("x"), write: (_i, signal) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))) };
    const out = await writeText(req(), { provider: slow, timeoutMs: 20 });
    expect(out).toMatchObject({ ai: false, reason: "timeout", text: "Draft text for week 3." });
  });

  it("rejects an answer with a made-up number, a link or an address", async () => {
    for (const bad of ["Seven tribes are on track.", "See https://example.org for more.", "Write to ada@example.org about week 3.", "Visit www.example.org"]) {
      expect(await writeText(req(), { provider: provider(bad) })).toMatchObject({ ai: false, reason: "rejected" });
    }
    expect(await writeText(req(), { provider: provider("   ") })).toMatchObject({ ai: false, reason: "empty" });
  });

  it("removes contact details from the facts before they leave, and sends no names it was not given", async () => {
    const spy = vi.fn();
    await writeText({ ...req(), facts: "Week 3: call Ngozi on 08031234567 or ngozi@example.org." }, { provider: provider("Fine.", spy) });
    const seen = spy.mock.calls[0][0].user as string;
    expect(seen).not.toMatch(/08031234567|ngozi@example/);
    expect(seen).toContain("[number]");
    expect(spy.mock.calls[0][0].system).toContain("Use only the facts you are given");
  });

  it("flattens markdown and cuts to length at a sentence", () => {
    expect(tidyAnswer("**Good** week.\n\n\n\nKeep going.", 100)).toBe("Good week.\n\nKeep going.");
    expect(tidyAnswer("One sentence here. Another sentence that runs on and on and on", 30)).toBe("One sentence here.");
    expect(numbersAreGrounded("Two tribes are fine.", "2 tribes")).toBe(true);
    expect(numbersAreGrounded("Nine tribes are fine.", "2 tribes")).toBe(false);
    expect(numbersAreGrounded("3 of 10", "3 members of 10")).toBe(true);
    expect(numbersAreGrounded("4 of 10", "3 members of 10")).toBe(false);
    // tens written in words are caught too
    expect(numbersAreGrounded("Ninety members came.", "30 members came")).toBe(false);
    expect(numbersAreGrounded("Seventy per cent came.", "70% came")).toBe(true);
  });

  it("lets the mock provider return the draft so the whole path can be tested offline", async () => {
    expect(await writeText(req(), { provider: mockProvider() })).toMatchObject({ ai: true, text: "Draft text for week 3." });
  });
});

const tribe = (name: string, status: string, extra: Record<string, unknown> = {}) => ({
  tribe: name,
  leader: "Ngozi",
  report: { status, held: status !== "no_log", members: 10, present: 7, energy: 4, care_open: 0, follow_ups_open: 0, ...extra },
});

const digest = (tribes: ReturnType<typeof tribe>[]): ClaimedMessage => ({
  id: "m1",
  template: "coach_digest",
  channel: "email",
  params: { week: 3, weeks: 12, season: "Season 1", tribes },
  urgency: "normal",
  attempts: 1,
  reply_token: null,
  to: { email: "sade@example.org", phone: null, name: "Sade Coach", first_name: "Sade" },
});

describe("the coach's Monday summary", () => {
  it("names the tribes that need attention, and the ones not logged", () => {
    const p = digest([tribe("Builders", "on_track"), tribe("Pillars", "needs_attention", { care_open: 2 }), tribe("Lamps", "no_log")]).params;
    const text = digestSummary(p);
    expect(text).toMatch(/2 tribes need your attention/);
    expect(text).toContain("Needs attention: Pillars.");
    expect(text).toContain("Not logged yet: Lamps.");
    expect(text).toContain("2 care tasks open");
    expect(digestFacts(p)[0]).toBe("Week 3: 3 tribes in your care.");
  });

  it("says plainly when it was a steady week, and mentions low energy", () => {
    const p = digest([tribe("Builders", "on_track", { energy: 2 }), tribe("Pillars", "on_track")]).params;
    expect(digestSummary(p)).toMatch(/^A steady week: all 2 tribes/);
    expect(digestSummary(p)).toContain("Low energy at the meeting: Builders.");
  });

  it("is empty when there are no tribes", () => {
    expect(digestSummary({ week: 3, tribes: [] })).toBe("");
  });

  it("is added to the message without an AI, and from the model when one is set up", async () => {
    const msg = digest([tribe("Builders", "on_track"), tribe("Pillars", "needs_attention")]);
    const plain = await enrichMessage(msg, null);
    expect(plain.params.summary).toContain("Needs attention: Pillars.");
    const ai = await enrichMessage(msg, provider("One tribe needs attention in week 3, and the other is on track."));
    expect(ai.params.summary).toBe("One tribe needs attention in week 3, and the other is on track.");
    // a model that invents a figure is ignored
    const bad = await enrichMessage(msg, provider("Nine tribes are struggling."));
    expect(bad.params.summary).toContain("Needs attention: Pillars.");
    // other messages are left alone
    const other: ClaimedMessage = { ...msg, template: "welcome" };
    expect(await enrichMessage(other, provider("x"))).toBe(other);
  });

  it("reads well in the email, with the summary first", async () => {
    const msg = await enrichMessage(digest([tribe("Builders", "on_track"), tribe("Pillars", "needs_attention")]), null);
    const email = renderEmail(msg, "https://unitedtribes.example");
    expect(email.text.indexOf("Needs attention: Pillars.")).toBeGreaterThan(-1);
    expect(email.text.indexOf("Needs attention: Pillars.")).toBeLessThan(email.text.indexOf("• Builders"));
    expect(TEMPLATES.coach_digest.whatsapp(msg.params, buildContext(msg, "https://unitedtribes.example")).vars.join(" ")).not.toMatch(/Needs attention/);
  });
});
