import { createHmac, timingSafeEqual } from "node:crypto";

export type DeliveryStatus = "delivered" | "read" | "failed";
export type StatusEvent = { providerId: string; status: DeliveryStatus; error?: string };
export type ReplyEvent = { replyToken: string; outcome: "done" | "partly" | "not_yet" };
export type StopEvent = { phone: string };
/** News from Meta about the account rather than a message: a template approved or rejected, the number's quality, a restriction (WhatsApp health). */
export type SignalEvent = { kind: "template" | "quality" | "account"; subject: string; status: string; detail?: string };
export type WhatsAppEvents = { statuses: StatusEvent[]; replies: ReplyEvent[]; stops: StopEvent[]; signals: SignalEvent[] };

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
  const out: WhatsAppEvents = { statuses: [], replies: [], stops: [], signals: [] };
  const root = asObject(payload);
  if (!root) return out;

  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asObject(entry)?.changes)) {
      const value = asObject(asObject(change)?.value);
      if (!value) continue;
      const signal = readSignal(asString(asObject(change)?.field), value);
      if (signal) out.signals.push(signal);

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

const clip = (v: string | null, n: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const code = (v: unknown) => clip(asString(v), 80).replace(/[^A-Za-z0-9_ .:+-]/g, "");

/**
 * What Meta says about the account itself, from the five kinds of change that matter: a template's approval, its category, the number's quality,
 * the display name and a restriction on the account. A change of any other kind is ignored. Only short, plain fields are kept (never a message).
 */
function readSignal(field: string | null, v: Record<string, unknown>): SignalEvent | null {
  if (field === "message_template_status_update") {
    const name = clip(asString(v.message_template_name), 200);
    const event = code(v.event);
    const reason = code(v.reason);
    return name && event ? { kind: "template", subject: name, status: event, ...(reason && reason !== "NONE" ? { detail: reason } : {}) } : null;
  }
  if (field === "message_template_category_update") {
    const name = clip(asString(v.message_template_name), 200);
    const next = code(v.new_category);
    const was = code(v.previous_category);
    return name && next ? { kind: "template", subject: name, status: `CATEGORY_${next}`, ...(was ? { detail: `was ${was}` } : {}) } : null;
  }
  if (field === "phone_number_quality_update") {
    const number = clip(asString(v.display_phone_number), 200);
    const event = code(v.event);
    const limit = code(v.current_limit);
    return number && event ? { kind: "quality", subject: number, status: event, ...(limit ? { detail: limit } : {}) } : null;
  }
  if (field === "phone_number_name_update") {
    const number = clip(asString(v.display_phone_number), 200);
    const decision = code(v.decision);
    const why = code(v.rejection_reason);
    return number && decision ? { kind: "account", subject: number, status: `NAME_${decision}`, ...(why ? { detail: why } : {}) } : null;
  }
  if (field === "account_update" || field === "account_review_update") {
    const number = clip(asString(v.phone_number), 200) || "account";
    const event = field === "account_review_update" ? (code(v.decision) ? `REVIEW_${code(v.decision)}` : "") : code(v.event);
    const first = asObject(asArray(v.restriction_info)[0]);
    const detail = code(first?.restriction_type) || code(asObject(v.violation_info)?.violation_type) || code(asObject(v.ban_info)?.waba_ban_state);
    return event ? { kind: "account", subject: number, status: event, ...(detail ? { detail } : {}) } : null;
  }
  return null;
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
