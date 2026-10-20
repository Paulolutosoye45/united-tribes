import { describe, expect, it } from "vitest";
import { buildContext, renderEmail, renderSms, renderWhatsApp, whatsappTemplateName } from "@/lib/messaging/render";
import { TEMPLATES, approvedNext } from "@/lib/messaging/templates";
import type { ClaimedMessage } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";

function message(template: string, params: Record<string, unknown> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params: { first_name: "Ngozi", role: "tribe leader", ...params },
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ngozi@example.org", phone: "+2348031234567", name: "Ngozi Eze", first_name: "Ngozi" },
  };
}

const KEYS = ["application_approved", "application_approved_optional", "application_approved_declaration", "application_approved_open"];

describe("the approval message, as it has always been", () => {
  it("says the same words when the Academy and the declaration are both required", () => {
    const m = message("application_approved");
    const email = TEMPLATES.application_approved.email(m.params, buildContext(m, SITE));
    expect(email.subject).toBe("Welcome: you’re approved as tribe leader");
    expect(email.paragraphs).toEqual([
      "Good news: you have been approved as tribe leader. Thank you for saying yes.",
      "Next is the Leader Academy: six short modules, a safeguarding declaration, and two workshops. Open it whenever you’re ready.",
      "Please also tell us how you’d like to be reached, so the reminders you need can find you.",
    ]);
    expect(email.cta).toEqual({ label: "Start the Academy", url: `${SITE}/lead/academy` });
    expect(renderSms(m, SITE)).toContain("You’re approved as tribe leader. Start the Academy:");
    const wa = renderWhatsApp(m, SITE);
    expect(wa.name).toBe("ut_application_approved");
    expect(wa.vars).toEqual(["Ngozi", "tribe leader", `${SITE}/lead/academy`]);
  });

  it("only drops the declaration from the sentence when the database says it is off", () => {
    expect(approvedNext({})).toContain("a safeguarding declaration");
    expect(approvedNext({ declaration: true })).toContain("a safeguarding declaration");
    expect(approvedNext({ declaration: false })).toBe("Next is the Leader Academy: six short modules and two workshops. Open it whenever you’re ready.");
  });
});

describe("the other approval messages promise only what is on", () => {
  it("are four separate WhatsApp templates, so the one Meta approved is never reworded", () => {
    const names = KEYS.map((k) => whatsappTemplateName(k));
    expect(new Set(names).size).toBe(4);
    for (const k of KEYS) {
      expect(TEMPLATES[k], k).toBeDefined();
      expect(TEMPLATES[k].audience).toBe("applicant");
    }
  });

  const text = (key: string, params: Record<string, unknown> = {}) => {
    const m = message(key, params);
    const email = renderEmail(m, SITE);
    return { all: `${email.subject}\n${email.text}`, sms: renderSms(m, SITE), wa: renderWhatsApp(m, SITE) };
  };

  it("optional: calls the Academy optional, and asks for the declaration only when it is on", () => {
    const a = text("application_approved_optional");
    expect(a.all).toMatch(/optional/i);
    expect(a.all).toContain("sign the safeguarding declaration");
    expect(a.wa.name).toBe("ut_application_approved_optional");
    const b = text("application_approved_optional", { declaration: false });
    expect(b.all).toMatch(/optional/i);
    expect(b.all).not.toContain("declaration");
  });

  it("declaration only: asks for the declaration and sends the leader to it", () => {
    const a = text("application_approved_declaration");
    expect(a.all).toContain("safeguarding declaration");
    expect(a.all).toContain(`${SITE}/lead/academy/declaration`);
    expect(a.all).not.toMatch(/six short modules|workshops|Academy/);
    expect(a.sms).toContain("/lead/academy/declaration");
    expect(a.wa.vars[2]).toBe(`${SITE}/lead/academy/declaration`);
  });

  it("nothing to complete: sends a tribe leader to the Tribe Card and an assistant to their page, and never mentions training", () => {
    const leader = text("application_approved_open");
    expect(leader.all).toContain("Tribe Card");
    expect(leader.all).toContain(`${SITE}/lead/tribe`);
    const assistant = text("application_approved_open", { role: "assistant leader" });
    expect(assistant.all).toContain("nothing to complete");
    expect(assistant.all).not.toContain("Tribe Card");
    for (const t of [leader, assistant]) {
      expect(t.all).not.toMatch(/Academy|module|workshop|declaration/i);
      expect(t.wa.vars.join(" ")).not.toMatch(/academy|declaration/i);
    }
  });

  it("every variant thanks the leader, names the role, and asks how they would like to be reached", () => {
    for (const k of KEYS) {
      const a = text(k, { role: "assistant leader" });
      expect(a.all, k).toContain("approved as assistant leader");
      expect(a.all, k).toContain("how you’d like to be reached");
    }
  });
});
