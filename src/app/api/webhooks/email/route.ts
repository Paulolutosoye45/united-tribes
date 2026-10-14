import { parseEmailEvent } from "@/lib/messaging/inbound";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { verifyWebhook } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_BODY = 128 * 1024;

/**
 * Delivery receipts from the email provider (Resend signs them with Svix:
 * `svix-id`, `svix-timestamp`, `svix-signature`, the same scheme as other
 * "Standard Webhooks"). A bounce lets the database try the next channel; a spam
 * complaint also stops further email to that address.
 */
export async function POST(request: Request) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET?.trim();
  const token = workerToken();
  if (!secret || !token) return Response.json({ error: "not set up" }, { status: 503, headers: NO_STORE });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "too large" }, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "too large" }, { status: 413, headers: NO_STORE });

  const h = request.headers;
  const trusted = verifyWebhook({
    secret,
    id: h.get("svix-id") ?? h.get("webhook-id"),
    timestamp: h.get("svix-timestamp") ?? h.get("webhook-timestamp"),
    signature: h.get("svix-signature") ?? h.get("webhook-signature"),
    body: raw,
  });
  if (!trusted) return Response.json({ error: "not allowed" }, { status: 401, headers: NO_STORE });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "unreadable" }, { status: 400, headers: NO_STORE });
  }

  const event = parseEmailEvent(json);
  if (!event) return Response.json({ ok: true, ignored: true }, { headers: NO_STORE });

  const rpc = workerRpc(token);
  const first = await rpc("worker_provider_event", { p_provider_id: event.providerId, p_status: event.status, p_error: event.error ?? null });
  let failed = Boolean(first.error);
  // Hard bounces and complaints are kept as signals: two bad addresses are left out of reminders and announcements,
  // and a complaint ends them for that person and counts toward a journey pausing itself.
  if (event.signal) {
    const signal = await rpc("worker_email_signal", { p_provider_id: event.providerId, p_kind: event.signal });
    failed = failed || Boolean(signal.error);
  }
  if (event.optOutEmail) {
    const stop = await rpc("worker_opt_out", { p_phone: null, p_email: event.optOutEmail, p_channel: "email" });
    failed = failed || Boolean(stop.error);
  }
  if (failed) return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  return Response.json({ ok: true }, { headers: NO_STORE });
}
