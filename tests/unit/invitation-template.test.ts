import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES } from "@/lib/auth/roles";
import { renderEmail, renderSms, renderWhatsApp } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { INVITATION_SAMPLES, INVITATION_TEMPLATES, roleWithArticle } from "@/lib/messaging/templates-invitation";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";

function message(params: Params, to: Partial<ClaimedMessage["to"]> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    template: "role_invitation",
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "new.leader@example.org", phone: null, name: null, first_name: null, ...to },
  };
}

const PRIVATE = /god mode|owner|super ?admin|faith journey|support need|score|percent|%/i;

describe("the invitation email", () => {
  it("is registered with the sender, by email only, and is the one the database queues", () => {
    expect(INVITATION_TEMPLATES.map((t) => t.key)).toEqual(["role_invitation"]);
    expect(TEMPLATES.role_invitation).toBeDefined();
    expect(TEMPLATES.role_invitation.emailOnly).toBe(true);
    expect(TEMPLATES.role_invitation.audience).toBe("invitee");
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261227000100_invitation_email.sql"), "utf8");
    expect(sql).toContain("p_template => 'role_invitation'");
    expect(sql).toContain("p_force => 'email'");
  });

  it("invites an address with no account: names the role, says to sign in with this address, and links to sign-in", () => {
    const e = renderEmail(message({ role: "leader", existing: false, days: 30 }), SITE);
    expect(e.subject).toBe("You are invited to serve on United Tribes as a tribe leader");
    expect(e.text).toContain("Hello,");
    expect(e.text).toMatch(/sign in with this email address/i);
    expect(e.text).toMatch(/nothing happens unless you sign in/i);
    expect(e.text).toContain("30 days");
    expect(e.html).toContain(`href="${SITE}/sign-in"`);
  });

  it("tells an existing account that the role is already theirs, by first name", () => {
    const e = renderEmail(message({ role: "coach", existing: true }, { first_name: "Ada" }), SITE);
    expect(e.subject).toBe("You are now a coach on United Tribes");
    expect(e.text).toContain("Hi Ada,");
    expect(e.text).toMatch(/already on your account/i);
  });

  it("gets the article right for every role someone can be invited to", () => {
    expect(roleWithArticle("admin")).toBe("an admin");
    expect(roleWithArticle("assistant_leader")).toBe("an assistant leader");
    expect(roleWithArticle("leader")).toBe("a tribe leader");
    expect(roleWithArticle("pastor")).toBe("a pastor");
    expect(roleWithArticle("nonsense")).toBe("a role");
    expect(roleWithArticle(undefined)).toBe("a role");
    for (const role of ROLES.filter((r) => r !== "member")) {
      const e = renderEmail(message({ role, existing: false, days: 30 }), SITE);
      expect(e.subject, role).toMatch(/^You are invited to serve on United Tribes as an? [a-z ]+$/);
      expect(e.subject.length).toBeLessThanOrEqual(78);
    }
  });

  it("falls back to a plain wording for a role it does not know, without a gap", () => {
    const e = renderEmail(message({ role: "something_new", existing: false }), SITE);
    expect(e.subject).toBe("You are invited to serve on United Tribes as a role");
    expect(`${e.subject}\n${e.text}\n${e.html}`).not.toMatch(/undefined|NaN|\[object|\{\{|\bnull\b/);
  });

  it("uses a footer that fits someone with no account, with no link to a profile they do not have", () => {
    const e = renderEmail(message({ role: "leader", existing: false }), SITE);
    expect(e.text).toMatch(/invited this address to United Tribes/);
    expect(e.text).not.toContain("/profile");
    expect(e.html).not.toContain("/profile");
  });

  it("carries no secret, names nobody and says nothing private", () => {
    for (const params of [{ role: "leader", existing: false, days: 30 }, { role: "pastor", existing: true }]) {
      const m = message(params, { first_name: "Ada" });
      const e = renderEmail(m, SITE);
      expect(`${e.subject}\n${e.text}`).not.toMatch(PRIVATE);
      expect(e.text).not.toMatch(/\b[a-f0-9]{32,}\b/);
      expect(e.html).not.toMatch(/\/(r|placed|reference)\/[A-Za-z0-9]{20,}/);
    }
  });

  it("renders in all three channels without a gap, and a text message stays short", () => {
    for (const params of [INVITATION_SAMPLES.role_invitation, { role: "admin", existing: true }]) {
      const m = message(params);
      const sms = renderSms(m, SITE);
      const wa = renderWhatsApp(m, SITE);
      expect(sms.length).toBeLessThanOrEqual(320);
      expect(sms).toContain(`${SITE}/sign-in`);
      for (const text of [sms, wa.vars.join("\n")]) expect(text).not.toMatch(/undefined|NaN|\[object|\{\{|\bnull\b/);
    }
  });
});
