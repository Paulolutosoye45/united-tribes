import { createHmac, timingSafeEqual } from "node:crypto";

export type DeliveryStatus = "delivered" | "read" | "failed";
export type StatusEvent = { providerId: string; status: DeliveryStatus; error?: string };
export type ReplyEvent = { replyToken: string; outcome: "done" | "partly" | "not_yet" };
export type StopEvent = { phone: string };
export type WhatsAppEvents = { statuses: StatusEvent[]; replies: ReplyEvent[]; stops: StopEvent[] };

const PAYLOAD = /^ck:([a-f0-9]{32,128}):(done|partly|not_yet)$/;
const STOP_WORDS = new Set(["stop", "stop all", "unsubscribe", "cancel", "opt out", "optout", "end"]);

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyMetaSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signMeta(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/**
 * Reads what Meta tells us: delivery receipts, a tap on a quick-reply button, and
 * a word like STOP. Anything unrecognised is ignored, never an error: Meta sends
 * many kinds of events and expects a quick "ok" to every one.
 */
export function parseWhatsAppEvents(payload: unknown): WhatsAppEvents {
  const out: WhatsAppEvents = { statuses: [], replies: [], stops: [] };
  const root = asObject(payload);
  if (!root) return out;

  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asObject(entry)?.changes)) {
      const value = asObject(asObject(change)?.value);
      if (!value) continue;

      for (const raw of asArray(value.statuses)) {
        const s = asObject(raw);
        const id = asString(s?.id);
        const status = asString(s?.status);
        if (!id || !status || !["delivered", "read", "failed"].includes(status)) continue;
        const first = asObject(asArray(s?.errors)[0]);
        const code = typeof first?.code === "number" ? first.code : undefined;
        out.statuses.push({
          providerId: id,
          status: status as DeliveryStatus,
          ...(status === "failed" ? { error: `meta ${code ?? "?"}${asString(first?.title) ? `: ${String(first?.title).slice(0, 120)}` : ""}` } : {}),
        });
      }

      for (const raw of asArray(value.messages)) {
        const m = asObject(raw);
        if (!m) continue;
        const from = asString(m.from);
        // A tap on a quick-reply button of a template arrives as type "button"; interactive messages as "interactive".
        const payloadText =
          asString(asObject(m.button)?.payload) ?? asString(asObject(asObject(m.interactive)?.button_reply)?.id);
        const parsed = payloadText ? PAYLOAD.exec(payloadText) : null;
        if (parsed) {
          out.replies.push({ replyToken: parsed[1], outcome: parsed[2] as ReplyEvent["outcome"] });
          continue;
        }
        const text = asString(asObject(m.text)?.body);
        if (from && text && STOP_WORDS.has(text.trim().toLowerCase().replace(/[.!]+$/, ""))) out.stops.push({ phone: from });
      }
    }
  }
  return out;
}

export type EmailEvent = { providerId: string; status: "delivered" | "failed"; error?: string; optOutEmail?: string; signal?: "hard_bounce" | "complaint" };

/** Reads a Resend webhook event (delivered, bounced, complained). Others are ignored. */
export function parseEmailEvent(payload: unknown): EmailEvent | null {
  const root = asObject(payload);
  const type = asString(root?.type);
  const data = asObject(root?.data);
  const id = asString(data?.email_id);
  if (!type || !id) return null;
  if (type === "email.delivered") return { providerId: id, status: "delivered" };
  if (type === "email.bounced" || type === "email.failed") {
    const reason = asString(asObject(data?.bounce)?.type) ?? asString(data?.reason);
    // "Permanent" means the address does not work. A full inbox or a passing fault is not held against it.
    const permanent = /^permanent$/i.test(asString(asObject(data?.bounce)?.type) ?? "");
    return {
      providerId: id, status: "failed", error: `email ${type.replace("email.", "")}${reason ? `: ${reason.slice(0, 80)}` : ""}`,
      ...(permanent ? { signal: "hard_bounce" as const } : {}),
    };
  }
  if (type === "email.complained") {
    const to = asArray(data?.to).map(asString).find(Boolean) ?? null;
    return { providerId: id, status: "failed", error: "email complaint", signal: "complaint", ...(to ? { optOutEmail: to } : {}) };
  }
  return null;
}
