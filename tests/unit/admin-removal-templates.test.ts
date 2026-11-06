import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail, renderSms } from "@/lib/messaging/render";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// The two things Admin → Remove changes in the removal emails: the member's email has no appeal sentence when the office took the place (the database sends
// appeal_days 0), and the leader has a fifth message, "removed". Every other wording is covered by removal-templates.test.ts and is untouched.

const SITE = "https://unitedtribes.example";
const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270112000100_admin_remove.sql"), "utf8");

function message(template: string, params: Params): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000005",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
  };
}

const told = { tribe: "Builders Tribe", contact_first: "Grace" };
const NEVER_TO_A_MEMBER = /reason|conduct|safety|absence|conflict|not a fit|asked the church|the leader|removed|kicked|expelled|banned|punish|your fault|misbehav/i;

describe("the member's email when the office changed the place", () => {
  it("leaves out the appeal sentence when the database sends 0 days, and says nothing about why or who", () => {
    const mail = renderEmail(message("removal_member_told", { ...told, appeal_days: 0 }), SITE);
    expect(mail.subject).toBe("Your place in Builders Tribe has changed");
    expect(mail.text).toMatch(/Grace is the person to speak to/);
    expect(mail.text).toMatch(/Other tribes are open to you/);
    expect(mail.text).not.toMatch(/mistake|again|within \d+ days|appeal/i);
    expect(mail.text).not.toMatch(NEVER_TO_A_MEMBER);
    expect(mail.text).toContain(`${SITE}/tribe`);
  });

  it("keeps the 14 days (and the sentence) for a leader's request, however the field arrives", () => {
    for (const appeal_days of [14, "14", undefined, null, 7]) {
      const params: Params = { ...told };
      if (appeal_days !== undefined) params.appeal_days = appeal_days;
      const mail = renderEmail(message("removal_member_told", params), SITE);
      const days = appeal_days === 7 ? 7 : 14;
      expect(mail.text, String(appeal_days)).toMatch(new RegExp(`within ${days} days`));
      expect(mail.text, String(appeal_days)).toMatch(/If you feel a mistake has been made/);
    }
  });

  it("treats a negative number like 0, and never prints a number it cannot read", () => {
    expect(renderEmail(message("removal_member_told", { ...told, appeal_days: -3 }), SITE).text).not.toMatch(/within/);
    const odd = renderEmail(message("removal_member_told", { ...told, appeal_days: "soon" }), SITE);
    expect(odd.text).toMatch(/within 14 days/);
    expect(odd.text).not.toMatch(/NaN|undefined|null/);
  });
});

describe("the leader's email when the office removed a member", () => {
  const read = (over: Params = {}) => renderEmail(message("removal_leader_decided", { decision: "removed", member_first: "Bola", tribe: "Builders Tribe", ...over }), SITE);

  it("names the member by first name only, reminds the leader about any WhatsApp group, and gives no reason or office name", () => {
    const mail = read();
    expect(mail.subject).toBe("Bola’s place in your tribe has changed");
    expect(mail.text).toMatch(/The church has changed Bola’s place in Builders Tribe/);
    expect(mail.text).toMatch(/WhatsApp group/);
    expect(mail.text).toMatch(/take them out of it yourself/);
    expect(mail.text).toContain(`${SITE}/lead/tribe`);
    expect(mail.text + mail.subject).not.toMatch(/your request|approved|declined|admin|director|reason:/i);
  });

  it("does not repeat a reason or a note the database might put in the fields", () => {
    const mail = read({ reason: "TOPSECRETREASON about them", note: "SECRETNOTE", removed_by: "Ngozi Okafor" });
    expect(mail.text + mail.html + mail.subject).not.toMatch(/TOPSECRET|SECRETNOTE|Ngozi/);
  });

  it("fits a phone's lock screen and has a one-line text version", () => {
    expect(read().subject.length).toBeLessThan(60);
    const sms = renderSms(message("removal_leader_decided", { decision: "removed", member_first: "Bola", tribe: "Builders Tribe" }), SITE);
    expect(sms).toMatch(/^United Tribes: Bola’s place in your tribe has changed\./);
    expect(sms).toContain(SITE);
  });

  it("is still the only message that falls back to a question for an unknown word", () => {
    expect(read({ decision: "something else" }).subject).toBe("A question about your request for Bola");
  });
});

describe("what the migration queues", () => {
  it("sends only email, to the member and the leader, with dedupe keys that one removal cannot repeat", () => {
    const calls = [...sql.matchAll(/perform public\.enqueue_message\([\s\S]*?;\n/g)].map((m) => m[0]);
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call, call).toMatch(/'normal', 'email'\);/);
    for (const key of ["':member'", "':leader'", "':back:member'", "':back:leader'"]) expect(sql).toContain(key);
    expect(sql).toContain("'appeal_days', 0");
    expect(sql).toContain("'decision', 'removed'");
  });

  it("never puts the reason into a message or the event log", () => {
    const calls = [...sql.matchAll(/perform public\.enqueue_message\([\s\S]*?;\n/g)].map((m) => m[0]).join("\n");
    expect(calls).not.toMatch(/reason/);
    const events = [...sql.matchAll(/perform public\.write_event\([\s\S]*?;\n/g)].map((m) => m[0]).join("\n");
    expect(events).not.toMatch(/reason|v_reason|name/);
  });
});
