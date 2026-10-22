import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

// Adding a part to the shared email layout must not change any email that already exists. This renders every template that existed before
// the part was added (the web page and the plain text, from the shared sample fields) and compares a fingerprint of each with the one taken
// before the change. A new template is not in the list, so it is not compared; a changed or missing old one fails.
//
// To take the fingerprints again on purpose (after a deliberate change to an old email): UPDATE_GOLDEN=1 npx vitest run tests/unit/email-layout-unchanged.test.ts

const GOLDEN = join(__dirname, "fixtures/email-golden.json");
const SITE = "https://unitedtribes.example";

function message(template: string): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    template,
    channel: "email",
    params: sampleParams(template),
    urgency: "normal",
    attempts: 1,
    reply_token: "ab".repeat(32),
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
  };
}

const fingerprint = (template: string) => {
  const e = renderEmail(message(template), SITE);
  return createHash("sha256").update(JSON.stringify([e.subject, e.html, e.text, e.headers ?? null])).digest("hex").slice(0, 24);
};

describe("emails that existed before the steps layout", () => {
  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the fingerprints", () => {
      const out: Record<string, string> = {};
      for (const key of Object.keys(TEMPLATES).sort()) out[key] = fingerprint(key);
      writeFileSync(GOLDEN, `${JSON.stringify(out, null, 1)}\n`);
      expect(Object.keys(out).length).toBeGreaterThan(80);
    });
    return;
  }

  const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {};

  it("has the fingerprints to compare with", () => {
    expect(Object.keys(golden).length).toBeGreaterThan(80);
  });

  it("still renders every one of them exactly as before, subject, web page and plain text", () => {
    const changed = Object.keys(golden).filter((key) => !TEMPLATES[key] || fingerprint(key) !== golden[key]);
    expect(changed).toEqual([]);
  });

  it("renders the same twice, so the comparison is not luck", () => {
    for (const key of Object.keys(golden).slice(0, 20)) expect(fingerprint(key)).toBe(fingerprint(key));
  });
});
