import { describe, expect, it } from "vitest";
import { renderEmail, renderSms } from "@/lib/messaging/render";
import { TEMPLATES, waitingPhrase } from "@/lib/messaging/templates";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

// Phase 7: the offer that goes to a leader when members are waiting for a goal. It says how many are waiting, never who.

const SITE = "https://unitedtribes.example";

function message(params: Params = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    template: "leader_offer",
    channel: "email",
    params: { ...sampleParams("leader_offer"), goal: "Win my first ten paying customers", community: "Business", waiting: 9, expires_on: "3 November 2026", ...params },
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ngozi@example.org", phone: "+2348031234567", name: "Ngozi Okafor", first_name: "Ngozi" },
  };
}

describe("the leader offer", () => {
  it("is registered, for leaders, and by email first", () => {
    const t = TEMPLATES["leader_offer"];
    expect(t).toBeDefined();
    expect(t?.audience).toBe("leader");
    expect(t?.emailOnly).toBe(true);
  });

  it("says a count in words up to twelve and in figures after", () => {
    expect(waitingPhrase(1)).toBe("One person is waiting");
    expect(waitingPhrase(2)).toBe("Two people are waiting");
    expect(waitingPhrase(9)).toBe("Nine people are waiting");
    expect(waitingPhrase(12)).toBe("Twelve people are waiting");
    expect(waitingPhrase(13)).toBe("13 people are waiting");
    expect(waitingPhrase(40)).toBe("40 people are waiting");
  });

  it("never says nobody is waiting, whatever it is given", () => {
    for (const bad of [0, -3, null, undefined, "x", Number.NaN]) expect(waitingPhrase(bad)).toBe("One person is waiting");
  });

  it("names the goal and the count in the subject, the message and the text", () => {
    const m = message();
    const email = renderEmail(m, SITE);
    expect(email.subject).toBe("Would you lead Win my first ten paying customers this season?");
    expect(email.text).toContain("Nine people are waiting for Win my first ten paying customers");
    expect(email.text).toContain("Hi Ngozi,");
    expect(renderSms(m, SITE)).toContain("Nine people are waiting for Win my first ten paying customers");
  });

  it("sends the leader to their Lead page, where the answer is given", () => {
    const m = message();
    expect(renderEmail(m, SITE).text).toContain(`${SITE}/lead`);
    expect(renderSms(m, SITE)).toContain(`${SITE}/lead`);
  });

  it("promises nothing a pastor has not agreed: the card starts, and a pastor still approves it", () => {
    const text = renderEmail(message(), SITE).text;
    expect(text).toMatch(/A pastor still approves the card/);
    expect(text).toMatch(/Nothing changes for you/);
    expect(text).not.toMatch(/certified|guarantee|you have been (chosen|selected)|you must/i);
  });

  it("says when the offer closes, and still reads well without a date", () => {
    expect(renderEmail(message(), SITE).text).toContain("until 3 November 2026");
    const none = renderEmail(message({ expires_on: "" }), SITE).text;
    expect(none).not.toMatch(/until |undefined|null/);
    expect(none).toMatch(/not the right time/);
  });

  it("falls back to plain words when the goal is missing, and never prints undefined", () => {
    const m = message({ goal: "" });
    const text = [renderEmail(m, SITE).subject, renderEmail(m, SITE).text, renderSms(m, SITE)].join("\n");
    expect(text).toContain("a tribe");
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it("carries no member: nothing in it is a name, whatever the parameters hold", () => {
    const m = message({ person_first: "Chidi", member: "Chidi Okeke", note: "Chidi is struggling" });
    const text = [renderEmail(m, SITE).subject, renderEmail(m, SITE).text, renderEmail(m, SITE).html, renderSms(m, SITE)].join("\n");
    expect(text).not.toMatch(/Chidi|struggling/);
  });
});
