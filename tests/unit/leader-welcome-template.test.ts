import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAFEGUARDING_PROMISES } from "@/lib/academy/declaration";
import { renderEmail, renderSms, renderWhatsApp } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import {
  GUIDE_PICTURES,
  LEADER_WELCOME_SAMPLES,
  LEADER_WELCOME_TEMPLATES,
  WELCOME_DEFAULT_SIGNATURE,
  WELCOME_PROMISES,
  WELCOME_WORDING_VERSION,
} from "@/lib/messaging/templates-leader-welcome";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

const SITE = "https://unitedtribes.example";

function message(params: Params, to: Partial<ClaimedMessage["to"]> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    template: "leader_welcome",
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "ada.example@example.org", phone: null, name: "Ada Example", first_name: "Ada", ...to },
  };
}

const base = LEADER_WELCOME_SAMPLES.leader_welcome;
const render = (over: Params = {}) => renderEmail(message({ ...base, ...over }), SITE);

/** Names of the steps, in order, as the plain-text version numbers them. */
function stepTitles(text: string): string[] {
  return [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => m[2]);
}

const COMBOS = (["required", "optional", "off"] as const).flatMap((academy) =>
  (["required", "off"] as const).flatMap((declaration) => [true, false].map((choose) => ({ academy, declaration, choose }))),
);

describe("the leader welcome email", () => {
  it("is registered, by email only, and is the one the database queues with the fields it reads", () => {
    expect(LEADER_WELCOME_TEMPLATES.map((t) => t.key)).toEqual(["leader_welcome"]);
    expect(TEMPLATES.leader_welcome.emailOnly).toBe(true);
    expect(TEMPLATES.leader_welcome.audience).toBe("leader");
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261228000100_goal_unlock.sql"), "utf8");
    expect(sql).toContain("p_template => 'leader_welcome'");
    expect(sql).toContain("p_force => 'email'");
    // Every field the template reads is a field the database supplies
    for (const field of Object.keys(base)) expect(sql, field).toContain(`'${field}'`);
    expect(WELCOME_WORDING_VERSION).toMatch(/^[a-z0-9-]{3,40}$/);
  });

  it("never goes to WhatsApp or text as the long email: only a short pointer exists for the type to be whole", () => {
    const msg = message(base);
    expect(renderSms({ ...msg, channel: "sms" }, SITE)).toContain("/lead/tribe");
    const w = renderWhatsApp({ ...msg, channel: "whatsapp" }, SITE);
    expect(w.vars).toHaveLength(1);
    expect(w.vars[0]).toContain("/lead/tribe");
  });

  it("welcomes a leader who may choose, by first name, and says what they may choose", () => {
    const e = render();
    expect(e.subject).toBe("Welcome to leading a tribe");
    expect(e.text).toContain("Hi Ada,");
    expect(e.text).toMatch(/asked you to lead a tribe because it trusts you/);
    expect(e.text).toContain("The church has let you choose your goal for this season.");
    expect(e.text).toContain("“Build a steady client pipeline” in Business and entrepreneurship");
    expect(e.text).toContain("You can keep it or choose another from the same community.");
    expect(e.text).not.toMatch(/choose your community/);
  });

  it("also says so when the community is theirs to choose", () => {
    expect(render({ community_free: true }).text).toContain("choose your community and your goal");
  });

  it("tells a leader whose goal was chosen for them that it is set", () => {
    const e = render({ choose: false, community_free: false });
    expect(e.text).toContain("Your goal for this season was chosen for you");
    expect(e.text).toContain("It is set, so there is nothing for you to choose.");
    expect(e.text).not.toMatch(/let you choose/);
    expect(stepTitles(e.text)).toContain("Check your goal");
    expect(stepTitles(e.text)).not.toContain("Choose your goal");
  });

  it("copes with a goal that is not known yet", () => {
    const e = render({ goal: "", community: "" });
    expect(e.text).not.toMatch(/“”|undefined|null|\bin \./);
    expect(e.text).toContain("You can pick from the goals on your Tribe Card.");
  });

  it.each(COMBOS)("lists the right steps, numbered, for academy $academy, declaration $declaration, choose $choose", ({ academy, declaration, choose }) => {
    const e = render({ academy, declaration, choose, community_free: false });
    const titles = stepTitles(e.text);
    expect(titles[0]).toBe("Sign in");
    expect(titles[1]).toBe("Open your Tribe Card");
    expect(titles[titles.length - 1]).toBe("Send your card to the pastorate");
    const numbers = [...e.text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(titles.some((t) => /academy/i.test(t))).toBe(academy !== "off");
    expect(titles.includes("Do the Academy")).toBe(academy === "required");
    expect(titles.includes("The Academy, when you are ready")).toBe(academy === "optional");
    expect(titles.includes("Sign the safeguarding promises")).toBe(declaration === "required");
    expect(titles.length).toBe(5 + (academy === "off" ? 0 : 1) + (declaration === "off" ? 0 : 1));
    // The page shows the same steps, each with a picture and its words
    const imgs = [...e.html.matchAll(/<img src="([^"]+)" alt="([^"]+)"/g)];
    expect(imgs.length).toBe(titles.length);
    for (const [, src, alt] of imgs) {
      expect(src).toMatch(new RegExp(`^${SITE}/email/leader-guide/[a-z-]+\\.png$`));
      const name = src.split("/").pop()!.replace(".png", "") as keyof typeof GUIDE_PICTURES;
      expect(GUIDE_PICTURES[name], name).toBeDefined();
      expect(alt).toBe(GUIDE_PICTURES[name].alt);
    }
  });

  it("does not make the Academy or the declaration sound required when the switchboard has them optional or off", () => {
    const off = render({ academy: "off", declaration: "off" });
    expect(off.text).not.toMatch(/academy/i);
    expect(off.text).not.toMatch(/Sign the safeguarding promises/);
    expect(off.text).toContain("WHAT WE ASK OF EVERY LEADER");
    expect(off.text).not.toContain("THE PROMISES THAT COME WITH THIS ROLE");
    const optional = render({ academy: "optional" });
    expect(optional.text).toContain("It is not required");
    expect(optional.text).not.toMatch(/before you send your card/);
    const required = render();
    expect(required.text).toContain("THE PROMISES THAT COME WITH THIS ROLE");
  });

  it("keeps the first seven safeguarding promises word for word, and adds the one about the sign-in", () => {
    const e = render();
    for (const promise of SAFEGUARDING_PROMISES.slice(0, 7)) expect(e.text, promise).toContain(promise);
    expect(e.text).not.toContain(SAFEGUARDING_PROMISES[7]);
    expect(WELCOME_PROMISES).toHaveLength(8);
    expect(e.text).toContain("I will keep my sign-in private.");
  });

  it("is signed with the two saved lines, exactly, as the last thing before the footer", () => {
    const e = render();
    expect(WELCOME_DEFAULT_SIGNATURE).toEqual(["Wale Ekundayo", "Pastor TCN Iganmu Center"]);
    expect(e.text).toMatch(/Open my Tribe Card: https:\/\/unitedtribes\.example\/lead\/tribe\n\nWale Ekundayo\nPastor TCN Iganmu Center\n\n/);
    expect(e.html).toContain("<strong>Wale Ekundayo</strong><br>Pastor TCN Iganmu Center");
    const custom = render({ signature_name: "Ngozi Bello", signature_title: "Pastor, Lekki" });
    expect(custom.text).toContain("Ngozi Bello\nPastor, Lekki");
    expect(custom.text).not.toContain("Wale Ekundayo");
  });

  it("names no owner, no administrator and no tool: the only name in it is the signature and the leader's own first name", () => {
    for (const { academy, declaration, choose } of COMBOS) {
      const e = render({ academy, declaration, choose });
      const all = `${e.subject}\n${e.text}\n${e.html.replace(/<[^>]+>/g, " ")}`;
      expect(all, `${academy}/${declaration}/${choose}`).not.toMatch(/god mode|owner|administrator|\badmin\b|super ?admin|unlock|appointed by/i);
    }
  });

  it("carries no link that works as a key: only the site's own pages and pictures", () => {
    const e = render();
    const links = [...e.html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(8);
    for (const url of links) {
      expect(url.startsWith(SITE + "/"), url).toBe(true);
      expect(url, url).not.toMatch(/[?#]|token|code=|key=|reply/i);
    }
    expect(e.html).toContain(`href="${SITE}/lead/tribe"`);
    expect(e.text).not.toMatch(/\.png/);
  });

  it("is whole without the pictures: every step is written out in words, and the pictures have a description", () => {
    const e = render();
    const withoutPictures = e.html.replace(/<img[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    for (const [, title, body] of e.text.matchAll(/^\d+\. (.+)\n(.+)$/gm)) {
      expect(withoutPictures, title).toContain(title);
      expect(withoutPictures, title).toContain(body.replace(/\s+/g, " "));
    }
    // and the pictures that are there each say what they show
    for (const [, alt] of e.html.matchAll(/<img [^>]*alt="([^"]*)"/g)) expect(alt.length).toBeGreaterThan(20);
  });

  it("writes a leader's goal into the page safely", () => {
    const e = render({ goal: "<script>alert(1)</script>", community: "A & B" });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("A &amp; B");
  });
});

// The pastor approves THIS wording. If the words change, the version must change with them, so the database switches the welcome buttons
// off until the new wording is approved. To take the fingerprint again after a deliberate change (and a new version):
//   UPDATE_GOLDEN=1 npx vitest run tests/unit/leader-welcome-template.test.ts
const GOLDEN = join(__dirname, "fixtures/welcome-wording.json");

function wordingFingerprint(): string {
  const parts: string[] = [];
  for (const { academy, declaration, choose } of COMBOS) {
    for (const free of choose ? [false, true] : [false]) {
      const e = render({ academy, declaration, choose, community_free: free });
      parts.push(e.subject, e.text);
    }
  }
  parts.push(JSON.stringify(Object.values(GUIDE_PICTURES).map((p) => p.alt)));
  return createHash("sha256").update(parts.join("\n--\n")).digest("hex").slice(0, 24);
}

describe("the welcome wording and its version", () => {
  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the fingerprint of this version", () => {
      writeFileSync(GOLDEN, JSON.stringify({ version: WELCOME_WORDING_VERSION, fingerprint: wordingFingerprint() }, null, 2) + "\n");
    });
    return;
  }
  it("changes only together: new words need a new WELCOME_WORDING_VERSION, so the pastor approves them again", () => {
    const stored = JSON.parse(readFileSync(GOLDEN, "utf8")) as { version: string; fingerprint: string };
    const now = { version: WELCOME_WORDING_VERSION, fingerprint: wordingFingerprint() };
    if (stored.version === now.version) {
      expect(now.fingerprint, "The welcome email's words changed but WELCOME_WORDING_VERSION did not. Bump the version, then run this test with UPDATE_GOLDEN=1.").toBe(stored.fingerprint);
    } else {
      // A new version has been chosen on purpose: the stored fingerprint must be taken again for it
      expect(now, "WELCOME_WORDING_VERSION changed. Take the fingerprint again with UPDATE_GOLDEN=1.").toEqual(stored);
    }
  });
});
