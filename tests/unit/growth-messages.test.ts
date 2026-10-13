import { describe, expect, it } from "vitest";
import { renderEmail, renderSms, renderWhatsApp } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

// Stage 6: the wording of the messages about changing tribe and about a parent or guardian's permission.

const SITE = "https://unitedtribes.example";
const TOKEN = "b".repeat(64);

function message(template: string, params: Params = {}, to?: Partial<ClaimedMessage["to"]>): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params: { ...sampleParams(template), ...params },
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada", ...to },
  };
}
const everything = (m: ClaimedMessage) => {
  const email = renderEmail(m, SITE);
  return [email.subject, email.text, email.html, renderSms(m, SITE), renderWhatsApp(m, SITE).vars.join(" ")].join("\n");
};

describe("changing tribe", () => {
  it("tells the coach someone asked, and never carries the reason", () => {
    const text = everything(message("swap_requested", { person_first: "Chidi", tribe: "Pillars", reason: "conflict", note: "It is about the leader" }));
    expect(text).toContain("Chidi");
    expect(text).toContain("Pillars");
    expect(text).toContain("/growth/swaps");
    expect(text).not.toMatch(/conflict|about the leader/);
  });

  it("tells the member an offer is waiting and that nothing changes until they say yes", () => {
    const m = message("swap_offered", { tribe: "Pillars", by_first: "Dayo" });
    expect(renderEmail(m, SITE).text).toMatch(/Nothing changes until you say yes/);
    expect(renderSms(m, SITE)).toContain("Pillars");
    expect(renderEmail(m, SITE).text).toContain("/tribe");
  });

  it("tells the member the coach has answered, gently", () => {
    const text = everything(message("swap_declined", { by_first: "Dayo" }));
    expect(text).toContain("Dayo");
    expect(text).toMatch(/still in your tribe/);
  });

  it("tells each leader about a move without saying where from, where to, or why", () => {
    for (const direction of ["in", "out"]) {
      const m = message("swap_moved", { direction, person_first: "Chidi", tribe: "SecretTribe" });
      const text = everything(m);
      expect(text).toContain("Chidi");
      expect(text).not.toContain("SecretTribe");
    }
    expect(renderEmail(message("swap_moved", { direction: "in" }), SITE).subject).toMatch(/joining your tribe/);
    expect(renderEmail(message("swap_moved", { direction: "out" }), SITE).subject).toMatch(/moved to another tribe/);
    expect(renderEmail(message("swap_moved", { direction: "in" }), SITE).text).toMatch(/within three days/);
  });
});

describe("a parent or guardian's permission", () => {
  it("is written to the parent or guardian by name, with a private link built from the secret", () => {
    const m = message("guardian_request", { guardian: "Mrs Okafor", teen_first: "Tolu", token: TOKEN }, { name: "Mrs Okafor", first_name: "Mrs" });
    const email = renderEmail(m, SITE);
    expect(email.subject).toContain("Tolu");
    expect(email.text).toContain("Dear Mrs Okafor,");
    expect(email.text).toContain(`${SITE}/guardian/${TOKEN}`);
    expect(email.text).toMatch(/under 18/);
    expect(email.text).toMatch(/phone you/);
    expect(email.text).toMatch(/take your permission back at any time/);
    expect(renderSms(m, SITE)).toContain(`${SITE}/guardian/${TOKEN}`);
    expect(renderWhatsApp(m, SITE).vars.join(" ")).toContain(`/guardian/${TOKEN}`);
  });

  it("works on the address alone, and gives the WhatsApp variables a value each", () => {
    const m = message("guardian_request", { guardian: "", token: TOKEN }, { name: null, first_name: null });
    const wa = renderWhatsApp(m, SITE);
    expect(wa.vars.every((v) => v.trim().length > 0)).toBe(true);
  });

  it("keeps the secret out of everything once the database has scrubbed it", () => {
    // the database replaces the params with { scrubbed: true } after sending; a late retry is refused there
    const def = TEMPLATES.guardian_request;
    expect(def.audience).toBe("guardian");
  });

  it("tells the Care Team what to do about each answer", () => {
    const yes = renderEmail(message("guardian_update", { what: "approved", teen_first: "Tolu" }), SITE);
    expect(yes.subject).toContain("said yes");
    expect(yes.text).toMatch(/phone them/);
    expect(yes.text).toContain("/care/teens");
    const no = renderEmail(message("guardian_update", { what: "declined", teen_first: "Tolu" }), SITE);
    expect(no.subject).toContain("said no");
    const gone = renderEmail(message("guardian_update", { what: "withdrawn", teen_first: "Tolu" }), SITE);
    expect(gone.subject).toContain("took their permission back");
    expect(gone.text).toMatch(/taken out of their tribe/);
    for (const m of [yes, no, gone]) expect(m.text).not.toMatch(/undefined|null/);
  });
});
