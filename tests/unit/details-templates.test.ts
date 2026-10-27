import { describe, expect, it } from "vitest";
import { buildContext, emailBody, metaTemplateDefinition, renderSms, renderWhatsApp, whatsappTemplateName } from "@/lib/messaging/render";
import { WhatsAppTemplateSender } from "@/lib/messaging/providers/whatsapp";
import { DETAILS_SAMPLES, DETAILS_TEMPLATES } from "@/lib/messaging/templates-details";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage } from "@/lib/messaging/types";

// The three messages of the Details Check: a request, a reminder and a six-digit code. What these prove:
//   * no message carries a personal fact, or anything the office holds about the person
//   * the request and the reminder carry one private link, as a button, and the code never rides with a link and never goes on WhatsApp
//   * the reminder is sent on WhatsApp under the request's own approved wording, so Meta is asked about one template, not two
//   * with no link (a preview, a forgotten one), the person is sent to My page, never to a made-up address

const SITE = "https://unitedtribes.example";
const LINK = "4f9d2c71a0b8e356c1d2a3b4f5061728394a5b6c7d8e9f00112233445566778";
const FACTS = ["builders", "stewards", "rising", "sages", "26 to 40", "41 to 50", "age range", "stage of life", "life stage", "life-stage"];

function msg(template: string, over: Partial<ClaimedMessage> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params: DETAILS_SAMPLES[template],
    urgency: "normal",
    attempts: 1,
    reply_token: LINK,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
    ...over,
  };
}

const email = (m: ClaimedMessage) => {
  const def = TEMPLATES[m.template];
  const c = buildContext(m, SITE);
  const content = def.email(m.params, c);
  return { content, ...emailBody(def, content, c) };
};

describe("the Details Check messages", () => {
  it("are three templates, registered with the others", () => {
    expect(DETAILS_TEMPLATES.map((t) => t.key)).toEqual(["details_check_request", "details_check_reminder", "details_check_code"]);
    for (const t of DETAILS_TEMPLATES) expect(TEMPLATES[t.key], t.key).toBeDefined();
  });

  it("carry no personal fact: not a stage of life, not an age range, not what the office has down", () => {
    for (const key of Object.keys(DETAILS_SAMPLES)) {
      const e = email(msg(key));
      const wa = TEMPLATES[key].whatsapp(DETAILS_SAMPLES[key], buildContext(msg(key), SITE));
      const all = [e.content.subject, e.text, renderSms(msg(key), SITE), wa.body, ...wa.vars].join("\n").toLowerCase();
      for (const f of FACTS) expect(all, `${key} mentions "${f}"`).not.toContain(f.toLowerCase());
    }
  });

  it("have a request that says how many things there are to check, with one button to press", () => {
    const one = email(msg("details_check_request", { params: { facts: 1 } }));
    expect(one.text).toContain("There is one thing for you to check.");
    const three = email(msg("details_check_request", { params: { facts: 3 } }));
    expect(three.text).toContain("There are 3 things for you to check.");
    expect(email(msg("details_check_request", { params: { facts: 99 } })).text).toContain("There are 3 things");
    expect(email(msg("details_check_request", { params: {} })).text).toContain("There is one thing");
    expect(one.content.cta).toEqual({ label: "Confirm your details", url: `${SITE}/details/${LINK}` });
    expect(one.content.options).toBeUndefined();
  });

  it("send a person with no private link to My page, never to a made-up address", () => {
    for (const key of ["details_check_request", "details_check_reminder"]) {
      expect(email(msg(key, { reply_token: null })).content.cta?.url, key).toBe(`${SITE}/my`);
      expect(renderSms(msg(key, { reply_token: null }), SITE), key).toContain(`${SITE}/my`);
    }
  });

  it("put the private link in the text message too, and keep it short enough for one or two messages", () => {
    for (const key of ["details_check_request", "details_check_reminder"]) {
      const sms = renderSms(msg(key), SITE);
      expect(sms, key).toContain(`${SITE}/details/${LINK}`);
      expect(sms.length, key).toBeLessThanOrEqual(320);
    }
  });

  it("have a reminder that is a new message with a new link, in other words than the request", () => {
    const e = email(msg("details_check_reminder", { params: { facts: 2 }, reply_token: "b".repeat(64) }));
    expect(e.content.subject).toMatch(/reminder/i);
    expect(e.content.cta?.url).toBe(`${SITE}/details/${"b".repeat(64)}`);
    expect(e.text).toContain("the button below is a new one");
  });

  it("send the WhatsApp request as an approved template with a private link on a button, whose address Meta fixes up to the token", () => {
    const def = metaTemplateDefinition(TEMPLATES.details_check_request, "en", buildContext(msg("details_check_request"), SITE));
    expect(def.name).toBe("ut_details_check_request");
    expect(def.category).toBe("UTILITY");
    const body = (def.components as { type: string; text?: string; example?: { body_text: string[][] } }[]).find((c) => c.type === "BODY")!;
    expect(body.text).toMatch(/^Hello \{\{1\}\}, please check the details we hold for your tribe\. It takes under a minute\./);
    expect(body.example?.body_text).toEqual([["Ada"]]);
    const buttons = (def.components as { type: string; buttons?: { type: string; text: string; url?: string; example?: string[] }[] }[]).find((c) => c.type === "BUTTONS")!.buttons!;
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ type: "URL", text: "Confirm details", url: `${SITE}/details/{{1}}` });
    expect(buttons[0].example?.[0]).toMatch(new RegExp(`^${SITE}/details/[0-9a-f]+$`));
  });

  it("fill the WhatsApp button with this message's private link and nothing else", () => {
    const sender = new WhatsAppTemplateSender({ phoneNumberId: "1", token: "t", language: "en", graphVersion: "v23.0" });
    const p = sender.payload(msg("details_check_request", { channel: "whatsapp" }), SITE, "+2348031234567");
    const components = p.template.components as { type: string; sub_type?: string; index?: string; parameters: { type: string; text?: string }[] }[];
    expect(p.template.name).toBe("ut_details_check_request");
    expect(components[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "Ada" }] });
    expect(components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: LINK }] });
    expect(JSON.stringify(p)).not.toContain(SITE);
  });

  it("send the reminder on WhatsApp under the request's approved name and wording, so Meta is asked about one template", () => {
    const rendered = renderWhatsApp(msg("details_check_reminder", { channel: "whatsapp", reply_token: "c".repeat(64) }), SITE);
    expect(rendered.name).toBe(whatsappTemplateName("details_check_request"));
    expect(rendered.urlButton).toEqual({ index: 0, token: "c".repeat(64) });
    expect(TEMPLATES.details_check_reminder.whatsappAs).toBe("details_check_request");
    const a = TEMPLATES.details_check_request.whatsapp({}, buildContext(msg("details_check_request"), SITE));
    const b = TEMPLATES.details_check_reminder.whatsapp({}, buildContext(msg("details_check_reminder"), SITE));
    expect(b.body).toBe(a.body);
    expect(b.urlButton?.label).toBe(a.urlButton?.label);
  });

  it("keep the six-digit code in a message of its own, by email or text only, and out of what is put to Meta", () => {
    const code = TEMPLATES.details_check_code;
    expect(code.emailOnly).toBe(true);
    const e = email(msg("details_check_code"));
    expect(e.content.subject).toBe("482913 is your United Tribes code");
    expect(e.content.cta).toBeUndefined();
    expect(e.text).not.toContain("/details/");
    expect(e.text).toContain("It works for 10 minutes and only once.");
    expect(renderSms(msg("details_check_code"), SITE)).toBe("United Tribes code: 482913. It lasts 10 minutes. Do not share it.");
  });

  it("never put a template to Meta that is a reminder under another name or a code", () => {
    const listed = Object.values(TEMPLATES).filter((d) => !d.emailOnly && !d.whatsappAs).map((d) => d.key);
    expect(listed).toContain("details_check_request");
    expect(listed).not.toContain("details_check_reminder");
    expect(listed).not.toContain("details_check_code");
  });
});
