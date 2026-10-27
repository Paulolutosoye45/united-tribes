import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditMarkdown, auditMessages, scanQueued } from "@/lib/messaging/audit";
import { registerTemplates, TEMPLATES } from "@/lib/messaging/templates";
import type { TemplateDef } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

// The audit of every message the platform can send: it passes today, the file on disk is what it says, and it notices what it is for.

const ROOT = path.resolve(__dirname, "../..");
const added: string[] = [];
afterEach(() => {
  for (const k of added.splice(0)) delete TEMPLATES[k];
});

const bad = (key: string, over: Partial<TemplateDef> = {}): TemplateDef => ({
  key,
  audience: "member",
  title: "A message that is wrong",
  email: () => ({ subject: "Hello", greeting: "Hi,", paragraphs: ["A fine line."] }),
  sms: () => "A fine line.",
  whatsapp: () => ({ body: "Hello {{1}}, a fine line.", example: ["Ada"], vars: ["Ada"] }),
  ...over,
});
const problemsOf = (def: TemplateDef) => {
  registerTemplates([def]);
  added.push(def.key);
  return auditMessages(ROOT, sampleParams).rows.find((r) => r.key === def.key)!.problems;
};

describe("the audit of every message", () => {
  it("passes for every message the platform can send, and every message the database queues exists", () => {
    const audit = auditMessages(ROOT, sampleParams);
    expect(audit.rows.length).toBe(Object.keys(TEMPLATES).length);
    expect(audit.rows.filter((r) => r.problems.length > 0).map((r) => `${r.key}: ${r.problems.join("; ")}`)).toEqual([]);
    expect(audit.queuedButMissing).toEqual([]);
  });

  it("is written down in docs/MESSAGES-AUDIT.md exactly as it says (npm run messages-audit writes it)", () => {
    const file = path.join(ROOT, "docs/MESSAGES-AUDIT.md");
    expect(fs.existsSync(file), "run npm run messages-audit").toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(auditMarkdown(auditMessages(ROOT, sampleParams)));
  });

  it("includes the Details Check messages and says where each is queued", () => {
    const rows = auditMessages(ROOT, sampleParams).rows;
    const request = rows.find((r) => r.key === "details_check_request")!;
    expect(request.queuedBy).toContain("database");
    expect(request.whatsapp.reuses).toBeNull();
    expect(rows.find((r) => r.key === "details_check_reminder")!.whatsapp.reuses).toBe("details_check_request");
    expect(rows.find((r) => r.key === "details_check_code")!.whatsapp.emailOnly).toBe(true);
  });

  it("notices something left unfilled, in any channel", () => {
    expect(problemsOf(bad("zz_audit_a", { email: () => ({ subject: "Hello undefined", greeting: "Hi,", paragraphs: ["x"] }) }))).toEqual([expect.stringContaining("subject has something unfilled")]);
    expect(problemsOf(bad("zz_audit_b", { sms: () => "Hello {{name}}" }))).toEqual([expect.stringContaining("text message has something unfilled")]);
    expect(problemsOf(bad("zz_audit_c", { email: () => ({ subject: "Hello", greeting: "Hi,", paragraphs: ["Your tribe is null today."] }) }))).toEqual([expect.stringContaining("email has something unfilled")]);
  });

  it("notices a subject that is empty, a text message that runs past two messages, and a link that is not https", () => {
    expect(problemsOf(bad("zz_audit_d", { email: () => ({ subject: "  ", paragraphs: ["x"] }) }))).toEqual([expect.stringContaining("subject is empty or too short")]);
    expect(problemsOf(bad("zz_audit_e", { sms: () => "word ".repeat(70) }))).toEqual([expect.stringContaining("more than two messages")]);
    expect(problemsOf(bad("zz_audit_f", { email: () => ({ subject: "Hello there", paragraphs: ["Open http://evil.example/page now."] }) }))).toEqual([expect.stringContaining("not https")]);
  });

  it("notices WhatsApp wording Meta would refuse", () => {
    expect(problemsOf(bad("zz_audit_g", { whatsapp: () => ({ body: "Hello {{2}}, a line.", example: ["Ada"], vars: ["Ada"] }) }))).toEqual([expect.stringContaining("not numbered 1, 2, 3 in order")]);
    expect(problemsOf(bad("zz_audit_h", { whatsapp: () => ({ body: "Hello {{1}}, a line {{2}}.", example: ["Ada"], vars: ["Ada"] }) }))).toEqual([expect.stringContaining("do not match in number")]);
    expect(problemsOf(bad("zz_audit_i", { whatsapp: () => ({ body: "Hello, a line for {{1}}", example: ["Ada"], vars: ["Ada"] }) })).some((p) => p.includes("starts or ends with a variable"))).toBe(false);
    expect(problemsOf(bad("zz_audit_j", { whatsapp: () => ({ body: "x".repeat(1100), example: [], vars: [] }) }))).toEqual([expect.stringContaining("longer than Meta allows")]);
    expect(problemsOf(bad("zz_audit_k", { whatsapp: () => ({ body: "Hello {{1}}, a line.", example: ["Ada"], vars: [" "] }) }))).toEqual([expect.stringContaining("variable is empty")]);
  });

  it("finds a message the database queues that no template defines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
    fs.mkdirSync(path.join(dir, "supabase/migrations"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "supabase/migrations/20270101000001_x.sql"), "perform public.enqueue_message(r.person_id, 'ghost_message', '{}'::jsonb);\nperform public.enqueue_message(r.person_id, 'details_check_request', '{}'::jsonb);\n");
    const { byKey, found } = scanQueued(dir, Object.keys(TEMPLATES));
    expect(found.map((f) => f.key)).toEqual(["ghost_message", "details_check_request"]);
    expect([...(byKey.get("details_check_request") ?? [])]).toEqual(["database"]);
    expect(byKey.has("ghost_message")).toBe(false);
  });
});
