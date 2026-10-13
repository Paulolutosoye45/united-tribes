import { afterEach, describe, expect, it } from "vitest";
import { buildContext, emailBody, metaTemplateDefinition, prepareParams, renderEmail, renderSms, renderWhatsApp, templateFor, UnknownTemplate, whatsappTemplateName } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

const SITE = "https://unitedtribes.example";

function message(template: string, over: Partial<ClaimedMessage> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params: sampleParams(template),
    urgency: "normal",
    attempts: 1,
    reply_token: template === "friday_checkin" ? "a".repeat(64) : null,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
    ...over,
  };
}

const keys = Object.keys(TEMPLATES);

describe("the templates", () => {
  it("covers the messages the blueprint asks for", () => {
    for (const key of [
      "welcome", "week_start", "triad_prompt", "meeting_reminder", "friday_checkin", "member_missed_two", "leader_prep", "leader_log_link",
      "weekly_report", "leader_missed_one", "birthday_today", "coach_digest", "coach_missed_three", "coach_low_pulse", "care_urgent",
      "application_approved", "application_not_approved", "referee_request",
    ]) {
      expect(TEMPLATES[key], key).toBeDefined();
    }
    expect(keys.length).toBeGreaterThanOrEqual(30);
  });

  it.each(keys)("%s has a key that matches its name, a title, and an audience", (key) => {
    const def = TEMPLATES[key];
    expect(def.key).toBe(key);
    expect(def.title.length).toBeGreaterThan(5);
    expect(def.audience).toBeTruthy();
    expect(whatsappTemplateName(key)).toMatch(/^ut_[a-z0-9_]+$/);
  });

  describe("WhatsApp template names (approved by Meta under their original names)", () => {
    const original = process.env.WHATSAPP_TEMPLATE_SUFFIX;
    afterEach(() => {
      if (original === undefined) delete process.env.WHATSAPP_TEMPLATE_SUFFIX;
      else process.env.WHATSAPP_TEMPLATE_SUFFIX = original;
    });

    it("keeps the names that are already approved while nothing is set", () => {
      delete process.env.WHATSAPP_TEMPLATE_SUFFIX;
      expect(whatsappTemplateName("welcome")).toBe("ut_welcome");
      expect(whatsappTemplateName("season_start")).toBe("ut_season_start");
    });

    it("lets a reworded set be switched on later by adding a suffix, and cleans the name up for Meta", () => {
      process.env.WHATSAPP_TEMPLATE_SUFFIX = "_V2";
      expect(whatsappTemplateName("welcome")).toBe("ut_welcome_v2");
      expect(renderWhatsApp(message("welcome"), SITE).name).toBe("ut_welcome_v2");
      expect(metaTemplateDefinition(TEMPLATES.welcome, "en", buildContext(message("welcome"), SITE)).name).toBe("ut_welcome_v2");
      process.env.WHATSAPP_TEMPLATE_SUFFIX = " bad-suffix";
      expect(whatsappTemplateName("welcome")).toMatch(/^ut_[a-z0-9_]+$/);
    });
  });

  it.each(keys)("%s renders in all three channels without leaving a gap", (key) => {
    const msg = message(key);
    const email = renderEmail(msg, SITE);
    const sms = renderSms(msg, SITE);
    const wa = renderWhatsApp(msg, SITE);
    for (const [where, text] of [["subject", email.subject], ["text", email.text], ["html", email.html], ["sms", sms], ["whatsapp", wa.vars.join("\n")]]) {
      expect(text, `${key} ${where}`).not.toMatch(/undefined|NaN|\[object|\{\{|\bnull\b/);
    }
    expect(email.subject.length).toBeGreaterThan(3);
    expect(email.subject.length).toBeLessThanOrEqual(150);
    expect(email.subject).not.toMatch(/[\r\n]/);
    // a text message is short: at most two segments, and never cut a link in half
    expect(sms.length).toBeLessThanOrEqual(320);
    for (const url of sms.match(/https?:\/\/\S+/g) ?? []) expect(url).toMatch(/^https?:\/\/[\w./:?=&%-]+$/);
  });

  it.each(keys)("%s survives missing fields (a half-filled message must not crash the queue)", (key) => {
    const msg = message(key, { params: {}, reply_token: null });
    expect(() => renderEmail(msg, SITE)).not.toThrow();
    expect(() => renderSms(msg, SITE)).not.toThrow();
    expect(() => renderWhatsApp(msg, SITE)).not.toThrow();
  });

  it("calls the person by first name, or by something neutral when there is none", () => {
    const named = renderEmail(message("welcome"), SITE);
    expect(named.text.startsWith("Hi Ada,")).toBe(true);
    const anon = renderEmail(message("welcome", { to: { email: "x@y.org", phone: null, name: null, first_name: null } }), SITE);
    expect(anon.text.startsWith("Hi there,")).toBe(true);
    expect(buildContext(message("welcome", { to: { email: null, phone: null, name: "Pastor Femi Ade", first_name: null } }), SITE).first).toBe("Pastor");
  });
});

describe("WhatsApp templates follow Meta’s rules, so they can be approved", () => {
  it.each(keys)("%s", (key) => {
    const def = TEMPLATES[key];
    const content = def.whatsapp(sampleParams(key), buildContext(message(key), SITE));
    const placeholders = [...content.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

    // variables are numbered 1..n in order, each once, and we supply exactly that many
    expect(placeholders).toEqual(placeholders.map((_, i) => i + 1));
    expect(content.vars).toHaveLength(placeholders.length);
    expect(content.example).toHaveLength(placeholders.length);
    // Meta refuses a template that begins or ends with a variable
    expect(content.body.trim(), `${key} starts with a variable`).not.toMatch(/^\{\{/);
    expect(content.body.trim(), `${key} ends with a variable`).not.toMatch(/\{\{\d+\}\}[.!?]?$/);
    // and one made of nothing but variables, or with too many for its length
    const words = content.body.replace(/\{\{\d+\}\}/g, "").trim().split(/\s+/).length;
    expect(words, `${key} has too many variables for its length`).toBeGreaterThanOrEqual(placeholders.length * 2);
    expect(content.body.length).toBeLessThanOrEqual(1024);
    expect(content.body).not.toMatch(/\n{3,}|\t/);
    // variables themselves: one line, no long runs of spaces, never empty, not enormous
    for (const v of content.vars) {
      expect(v).not.toMatch(/[\r\n\t]| {5,}/);
      expect(v.trim().length).toBeGreaterThan(0);
    }
    if (content.quickReplies) {
      expect(content.quickReplies.length).toBeLessThanOrEqual(3);
      for (const label of content.quickReplies) expect(label.length).toBeLessThanOrEqual(25);
    }
  });

  it("describes each template for submission with its examples and buttons", () => {
    const def = TEMPLATES.friday_checkin;
    const meta = metaTemplateDefinition(def, "en", buildContext(message("friday_checkin"), SITE));
    expect(meta).toMatchObject({ name: "ut_friday_checkin", language: "en", category: "UTILITY" });
    const [body, buttons] = meta.components as { type: string; example?: { body_text: string[][] }; buttons?: { type: string; text: string }[] }[];
    expect(body.type).toBe("BODY");
    expect(body.example?.body_text[0]).toHaveLength(3);
    expect(buttons.buttons?.map((b) => b.text)).toEqual(["Done", "Partly", "Not yet"]);
  });

  it("puts the tapped answer into the button payload, bound to this message", () => {
    const wa = renderWhatsApp(message("friday_checkin"), SITE);
    expect(wa.quickReplyPayloads).toEqual([`ck:${"a".repeat(64)}:done`, `ck:${"a".repeat(64)}:partly`, `ck:${"a".repeat(64)}:not_yet`]);
    expect(wa.quickReplyPayloads.every((p) => p.length <= 128)).toBe(true);
  });
});

describe("email", () => {
  it("escapes anything a person typed, so a name cannot inject markup", () => {
    const msg = message("welcome", { params: { ...sampleParams("welcome"), tribe: "<img src=x onerror=alert(1)> & Co", leader_first: "\"><script>x</script>" } });
    const { html } = renderEmail(msg, SITE);
    expect(html).not.toMatch(/<img src=x|<script>x/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; Co");
  });

  it("only links to https addresses (or local ones in development)", () => {
    const def = TEMPLATES.welcome;
    const ctx = buildContext(message("welcome"), SITE);
    const out = emailBody(def, { subject: "s", paragraphs: ["x"], cta: { label: "Click", url: "javascript:alert(1)" }, options: [{ label: "Bad", url: "data:text/html,x" }, { label: "Good", url: "https://ok.example/a" }] }, ctx);
    expect(out.html).not.toMatch(/javascript:|data:text/);
    expect(out.html).toContain('href="https://ok.example/a"');
    expect(out.text).not.toMatch(/javascript:/);
  });

  it("makes web addresses in the text clickable, and keeps the plain version readable", () => {
    const { html, text } = renderEmail(message("welcome"), SITE);
    expect(html).toContain('<a href="https://chat.whatsapp.com/abcdef"');
    expect(text).toContain("See my tribe: https://unitedtribes.example/tribe");
    expect(text).toContain("Change how we reach you: https://unitedtribes.example/profile");
  });

  it("gives the Friday message three one-tap answers, and a referee no settings link", () => {
    const friday = renderEmail(message("friday_checkin"), SITE);
    for (const o of ["done", "partly", "not_yet"]) expect(friday.html).toContain(`${SITE}/r/${"a".repeat(64)}?o=${o}`);
    const referee = renderEmail(message("referee_request"), SITE);
    expect(referee.text).not.toContain("/profile");
    expect(referee.html).toContain("named you as a referee");
  });

  it("is branded, mobile-friendly and declares its language", () => {
    const { html } = renderEmail(message("welcome"), SITE);
    expect(html).toContain('lang="en"');
    expect(html).toContain("viewport");
    expect(html).toContain("#e86838");
  });
});

describe("rendering details", () => {
  it("writes an interview time in Lagos time from the raw timestamp", () => {
    // 15:00 UTC is 4:00 pm in Lagos
    expect(prepareParams({ starts_at: "2027-03-09T15:00:00+00:00" }).starts_at_label).toBe("Tue 9 Mar, 4:00 pm");
    const booked = renderEmail(message("application_interview_booked"), SITE);
    expect(booked.text).toContain("Tue 9 Mar, 4:00 pm");
    expect(prepareParams({ starts_at: "nonsense" }).starts_at_label).toBeUndefined();
  });

  it("refuses an unknown template with a clear error", () => {
    expect(() => templateFor("nope")).toThrow(UnknownTemplate);
  });

  it("builds links from the site address without doubling slashes", () => {
    const ctx = buildContext(message("welcome"), `${SITE}///`);
    expect(ctx.link("/tribe")).toBe(`${SITE}/tribe`);
    expect(ctx.link("tribe")).toBe(`${SITE}/tribe`);
    expect(ctx.reply("done")).toBeNull();
  });
});
