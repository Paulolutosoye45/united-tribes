import { parseWhatsAppEvents, verifyMetaSignature } from "@/lib/messaging/inbound";
import { sameSecret } from "@/lib/messaging/auth";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { keysForTemplateName } from "@/lib/whatsapp/names";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_BODY = 512 * 1024;

/** Meta checks the address once, when the webhook is saved: echo the challenge if the verify token matches. */
export async function GET(request: Request) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const given = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (expected && mode === "subscribe" && sameSecret(given, expected) && /^[\w-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain", ...NO_STORE } });
  }
  return new Response("forbidden", { status: 403, headers: NO_STORE });
}

/**
 * Delivery receipts and replies from WhatsApp. Nothing is believed until the
 * signature (made with the app secret) matches the exact bytes received.
 */
export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  const token = workerToken();
  if (!secret || !token) return Response.json({ error: "not set up" }, { status: 503, headers: NO_STORE });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too large" }, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too large" }, { status: 413, headers: NO_STORE });
  if (!verifyMetaSignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return Response.json({ error: "not allowed" }, { status: 401, headers: NO_STORE });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "unreadable" }, { status: 400, headers: NO_STORE });
  }

  const events = parseWhatsAppEvents(json);
  const rpc = workerRpc(token);
  let failures = 0;

  for (const s of events.statuses) {
    const r = await rpc("worker_provider_event", { p_provider_id: s.providerId, p_status: s.status, p_error: s.error ?? null });
    if (r.error) failures++;
  }
  for (const reply of events.replies) {
    const r = await rpc("worker_checkin_reply", { p_reply_token: reply.replyToken, p_outcome: reply.outcome });
    if (r.error) failures++;
  }
  for (const stop of events.stops) {
    const r = await rpc("worker_opt_out", { p_phone: stop.phone, p_email: null, p_channel: "whatsapp" });
    if (r.error) failures++;
  }
  // News about the account (WhatsApp health). Optional: the database keeps it only while the health page is switched On, and a failure here, even a
  // database that does not have the function yet, never makes Meta think the receipts failed.
  for (const sig of events.signals) {
    await rpc("worker_whatsapp_signal", { p_kind: sig.kind, p_subject: sig.subject, p_status: sig.status, p_detail: sig.detail ?? null });
    // WhatsApp mode: when Meta files a wording as Marketing (which costs more), the message types that use it are kept off WhatsApp until it is Utility again.
    // Optional like the line above: a database without WhatsApp mode answers with an error that is ignored.
    if (sig.kind === "template" && sig.status.startsWith("CATEGORY_")) {
      for (const key of keysForTemplateName(sig.subject)) await rpc("worker_whatsapp_marketing", { p_key: key, p_marketing: sig.status === "CATEGORY_MARKETING" });
    }
  }
  // A 5xx makes Meta try again later; every handler above is safe to repeat.
  if (failures > 0) return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
