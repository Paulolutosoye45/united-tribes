import type { Row } from "./helpers";

/** Fields a template may read that the database leaves out on purpose when there is nothing to say (or, for summary, that the sender adds just before sending). */
const OPTIONAL = new Set(["group_url", "meeting_link", "place_note", "first_meeting_on", "first_meeting_by", "confession", "when", "will", "highlight", "follow_ups", "note", "pulse", "step_set", "near_end", "measure", "starts_at_label", "place", "mode", "minutes", "first_name", "summary", "refs", "refs_optional", "interview", "academy", "declaration"]);

/**
 * The database decides what to say; src/lib/messaging says how. For every queued message given,
 * writes it in all three channels from the fields the database really supplied, and reports anything
 * missing, empty or broken. An empty list means the two agree.
 */
export async function wordingProblems(rows: Row[]): Promise<string[]> {
  const { TEMPLATES } = await import("@/lib/messaging/templates");
  const { buildContext, prepareParams, renderEmail, renderSms, renderWhatsApp } = await import("@/lib/messaging/render");
  const problems: string[] = [];
  for (const row of rows) {
    const def = TEMPLATES[row.template];
    if (!def) {
      problems.push(`${row.template}: no wording written`);
      continue;
    }
    if (row.params?.scrubbed) continue;
    const msg = {
      id: row.id, template: row.template, channel: "email" as const, params: row.params ?? {}, urgency: row.urgency as "normal" | "urgent",
      attempts: 1, reply_token: row.reply_token, to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Test", first_name: "Ada" },
    };
    // Which fields does the wording read that the database did not supply?
    const prepared = prepareParams(msg.params);
    const read = new Set<string>();
    const watched = new Proxy(prepared, { get: (t, k) => (typeof k === "string" ? (read.add(k), t[k]) : undefined) });
    const ctx = buildContext(msg, "https://unitedtribes.example");
    def.email(watched, ctx);
    def.sms(watched, ctx);
    def.whatsapp(watched, ctx);
    const missing = [...read].filter((k) => !(k in prepared) && !OPTIONAL.has(k));
    if (missing.length > 0) problems.push(`${row.template}: wording reads ${missing.join(", ")} but the database did not supply it`);

    const email = renderEmail(msg, "https://unitedtribes.example");
    const sms = renderSms(msg, "https://unitedtribes.example");
    const wa = renderWhatsApp(msg, "https://unitedtribes.example");
    for (const [channel, text] of [["email", `${email.subject}\n${email.text}`], ["sms", sms], ["whatsapp", wa.vars.join("\n")]] as const) {
      const bad = /undefined|NaN|\[object|\bnull\b|\{\{/.exec(text);
      if (bad) problems.push(`${row.template} (${channel}): contains "${bad[0]}"`);
    }
    if (wa.vars.some((v) => v.trim() === "")) problems.push(`${row.template}: an empty WhatsApp variable`);
  }
  return problems;
}
