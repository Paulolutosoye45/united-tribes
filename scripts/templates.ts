/**
 * WhatsApp message templates.
 *
 * Meta must approve the exact wording of every message that starts a conversation
 * on WhatsApp. The wording lives in src/lib/messaging/templates.ts; this script
 * shows it, and sends it to Meta for approval.
 *
 *   npm run templates                       list every template, with an example of how it reads
 *   npm run templates -- --json             the same, as JSON (what Meta receives)
 *   npm run templates -- --submit           send every template that is not yet registered
 *   npm run templates -- --submit welcome   send just one (by key)
 *   npm run templates -- --status           ask Meta which are approved, pending or rejected
 *
 * --submit and --status need, in the environment or .env.local:
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   (the WhatsApp Business Account id, not the phone number id)
 *   WHATSAPP_ACCESS_TOKEN          (a system-user token with whatsapp_business_management)
 *   WHATSAPP_TEMPLATE_LANGUAGE     (default en)    WHATSAPP_GRAPH_VERSION (default v23.0)
 *
 * Approval takes minutes to a day. A template whose wording changes must be sent again
 * under a new name (Meta does not let an approved template be edited freely): bump the
 * suffix in `whatsappTemplateName` or edit it in Meta's Business Manager.
 */
import fs from "node:fs";
import path from "node:path";
import { buildContext, metaTemplateDefinition, whatsappTemplateName } from "../src/lib/messaging/render";
import { TEMPLATES } from "../src/lib/messaging/templates";

function loadEnvFile() {
  const file = path.resolve(__dirname, "../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en";
  const graph = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v23.0";
  const sample = buildContext(
    { id: "x", template: "x", channel: "whatsapp", params: {}, urgency: "normal", attempts: 1, reply_token: null, to: { email: null, phone: null, name: null, first_name: "Ada" } },
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://unitedtribes.example",
  );
  const definitions = Object.values(TEMPLATES).map((def) => ({ def, meta: metaTemplateDefinition(def, language, sample) }));

  if (args.includes("--json")) {
    console.log(JSON.stringify(definitions.map((d) => d.meta), null, 2));
    return;
  }

  if (args.includes("--status") || args.includes("--submit")) {
    const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
    const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    if (!waba || !token) {
      console.error("Set WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN first (see .env.example).");
      process.exit(1);
    }
    const base = `https://graph.facebook.com/${graph}/${waba}/message_templates`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const existing = new Map<string, string>();
    for (let url: string | null = `${base}?fields=name,status,language&limit=200`; url; ) {
      const res: Response = await fetch(url, { headers });
      const body = (await res.json()) as { data?: { name: string; status: string; language: string }[]; paging?: { next?: string }; error?: { message?: string } };
      if (!res.ok) {
        console.error(`Meta said no (${res.status}): ${body.error?.message ?? "no detail"}`);
        process.exit(1);
      }
      for (const t of body.data ?? []) existing.set(`${t.name}:${t.language}`, t.status);
      url = body.paging?.next ?? null;
    }

    if (args.includes("--status")) {
      for (const { def } of definitions) {
        const status = existing.get(`${whatsappTemplateName(def.key)}:${language}`) ?? "NOT SUBMITTED";
        console.log(`${status.padEnd(14)} ${whatsappTemplateName(def.key)}`);
      }
      return;
    }

    const only = args[args.indexOf("--submit") + 1];
    const wanted = only && !only.startsWith("--") ? definitions.filter((d) => d.def.key === only) : definitions;
    if (wanted.length === 0) {
      console.error(`No template called "${only}".`);
      process.exit(1);
    }
    let failed = 0;
    for (const { def, meta } of wanted) {
      const name = whatsappTemplateName(def.key);
      if (existing.has(`${name}:${language}`)) {
        console.log(`skip     ${name} (already ${existing.get(`${name}:${language}`)})`);
        continue;
      }
      const res = await fetch(base, { method: "POST", headers, body: JSON.stringify(meta) });
      const body = (await res.json()) as { status?: string; error?: { message?: string; error_user_msg?: string } };
      if (res.ok) console.log(`sent     ${name} → ${body.status ?? "PENDING"}`);
      else {
        failed++;
        console.log(`FAILED   ${name}: ${body.error?.error_user_msg ?? body.error?.message ?? res.status}`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  }

  // Default: show them.
  for (const { def, meta } of definitions) {
    const body = (meta.components[0] as { text: string; example?: { body_text: string[][] } });
    const example = body.example?.body_text[0] ?? [];
    const filled = body.text.replace(/\{\{(\d+)\}\}/g, (_, n) => example[Number(n) - 1] ?? `{{${n}}}`);
    const buttons = (meta.components[1] as { buttons?: { text: string }[] } | undefined)?.buttons?.map((b) => `[${b.text}]`).join(" ");
    console.log(`\n${whatsappTemplateName(def.key)}   (${def.audience}) ${def.title}\n  ${filled}${buttons ? `\n  ${buttons}` : ""}`);
  }
  console.log(`\n${definitions.length} templates. Use --submit to send them to Meta for approval.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
