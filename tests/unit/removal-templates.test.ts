import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail, renderSms } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { REMOVAL_SAMPLES, REMOVAL_TEMPLATES } from "@/lib/messaging/templates-removal";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";
const keys = REMOVAL_TEMPLATES.map((t) => t.key);
const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270103000400_removal_requests.sql"), "utf8");

function message(template: string, params: Params): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
  };
}

// What a member must never be told, however the database's fields change: who asked, the reason, the leader's words, or anything that reads as a verdict.
const NEVER_TO_A_MEMBER = /reason|conduct|safety|absence|conflict|not a fit|asked the church|the leader|removed|kicked|expelled|banned|punish|your fault|misbehav/i;

describe("the three removal emails", () => {
  it("are exactly the ones the database queues, each registered with the sender and email only", () => {
    expect(keys).toEqual(["removal_member_told", "removal_leader_decided", "removal_member_reinstated"]);
    for (const key of keys) {
      expect(TEMPLATES[key], key).toBeDefined();
      expect(TEMPLATES[key].emailOnly, key).toBe(true);
      expect(sql, key).toContain(`'${key}'`);
    }
    // and the database queues them by email only, never WhatsApp
    const calls = [...sql.matchAll(/perform public\.enqueue_message\([\s\S]*?;\n/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    for (const call of calls) expect(call, call).toMatch(/'normal', 'email'\);/);
    expect(Object.keys(REMOVAL_SAMPLES).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s renders from the fields the database gives: a short subject, one button on our own site, no stray words", (key) => {
    const mail = renderEmail(message(key, REMOVAL_SAMPLES[key]), SITE);
    expect(mail.subject.length).toBeGreaterThan(8);
    expect(mail.subject.length).toBeLessThan(80);
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).not.toMatch(/undefined|null|NaN|\[object/);
    expect(mail.html).not.toMatch(/undefined|NaN|\[object/);
    for (const url of mail.text.match(/https?:\/\/\S+/g) ?? []) expect(url.startsWith(SITE)).toBe(true);
    expect(mail.html).toMatch(/border-radius:999px;color:#ffffff/);
    expect(mail.text.length).toBeLessThan(1500);
  });

  it.each(keys)("%s still renders when the database sends nothing at all", (key) => {
    const mail = renderEmail(message(key, {}), SITE);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.subject + mail.text).not.toMatch(/undefined|null|NaN|\[object/);
  });

  it("tells the member kindly: which tribe, other tribes, a named person, the days to ask again, and nothing about why or who", () => {
    const mail = renderEmail(message("removal_member_told", REMOVAL_SAMPLES.removal_member_told), SITE);
    expect(mail.subject).toBe("Your place in Builders Tribe has changed");
    expect(mail.text).toMatch(/Other tribes are open to you/);
    expect(mail.text).toMatch(/Grace is the person to speak to/);
    expect(mail.text).toMatch(/within 14 days/);
    expect(mail.text).toContain(`${SITE}/tribe`);
    expect(mail.text).not.toMatch(NEVER_TO_A_MEMBER);
  });

  it("does not repeat anything extra the database might put in the fields, such as a reason or a note", () => {
    const leaky = { ...REMOVAL_SAMPLES.removal_member_told, reason: "conflict", note: "TOPSECRETNOTE about them", leader: "Ngozi Okafor", decision_note: "SECRETDECISION" };
    for (const key of ["removal_member_told", "removal_member_reinstated"]) {
      const mail = renderEmail(message(key, leaky), SITE);
      expect(mail.text + mail.html + mail.subject, key).not.toMatch(/TOPSECRET|SECRETDECISION|Ngozi|conflict/);
    }
    const lead = renderEmail(message("removal_leader_decided", { ...REMOVAL_SAMPLES.removal_leader_decided, ...leaky }), SITE);
    expect(lead.text + lead.html).not.toMatch(/TOPSECRET|SECRETDECISION/);
  });

  it("tells the leader each of the four things, by the member's first name only, and the group reminder only when approved", () => {
    const base = REMOVAL_SAMPLES.removal_leader_decided;
    const read = (decision: string) => renderEmail(message("removal_leader_decided", { ...base, decision }), SITE);
    const approved = read("approved");
    expect(approved.subject).toBe("Your request about Bola was approved");
    expect(approved.text).toMatch(/WhatsApp group/);
    expect(approved.text).toMatch(/take them out of it yourself/);
    const declined = read("declined");
    expect(declined.subject).toBe("Your request about Bola was not approved");
    expect(declined.text).toMatch(/has not been told anything/);
    expect(declined.text).not.toMatch(/WhatsApp group/);
    const question = read("question");
    expect(question.subject).toBe("A question about your request for Bola");
    expect(question.text).toMatch(/Nothing happens to the member/);
    expect(question.text).not.toMatch(/WhatsApp group/);
    const back = read("reinstated");
    expect(back.subject).toBe("Bola is back in your tribe");
    expect(back.text).not.toMatch(/WhatsApp group/);
    for (const m of [approved, declined, question, back]) expect(m.text).toContain(`${SITE}/lead/tribe`);
    // an unknown word from the database falls back to the question, the one thing that decides nothing
    expect(read("something else").subject).toBe("A question about your request for Bola");
  });

  it("has a one-line text version for each, in case a text is ever used, that names the church and a link", () => {
    for (const key of keys) {
      const sms = renderSms(message(key, REMOVAL_SAMPLES[key]), SITE);
      expect(sms, key).toMatch(/^United Tribes: /);
      expect(sms.length, key).toBeLessThan(320);
      expect(sms, key).toContain(SITE);
    }
  });
});
