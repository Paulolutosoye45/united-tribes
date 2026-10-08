import { readHookRequest } from "@/lib/whatsapp/payload";
import { senderFromEnv } from "@/lib/whatsapp/provider";
import { verifyWebhook } from "@/lib/whatsapp/webhook";

const MAX_BODY = 4096;
const NO_STORE = { "cache-control": "no-store" } as const;

/** What the sign-in service expects back when something goes wrong. */
function failure(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status, headers: NO_STORE });
}

/**
 * Supabase calls this instead of sending a text message, every time it has a
 * sign-in or number-change code to deliver. We put the code on WhatsApp.
 *
 * It is open to the internet by necessity, so nothing happens unless the
 * request carries a valid signature made with the hook secret. The code and
 * the full number are never written to a log.
 */
export async function POST(request: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  const sender = senderFromEnv();
  if (!secret || !sender) return failure(503, "WhatsApp sign-in is not set up.");

  // Refuse a large request before reading it.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return failure(413, "Request too large.");
  const body = await request.text();
  if (body.length > MAX_BODY) return failure(413, "Request too large.");

  const trusted = verifyWebhook({
    secret,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body,
  });
  if (!trusted) return failure(401, "Not allowed.");

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return failure(400, "Unreadable request.");
  }
  const hook = readHookRequest(json);
  if (!hook) return failure(400, "No number to send to.");

  const result = await sender.send(hook.to, hook.code);
  if (!result.ok) {
    // Enough to find the cause in the logs, nothing that identifies the person or the code.
    console.error(`whatsapp code not sent: ${result.reason}${result.detail ? ` (${result.detail})` : ""} to ***${hook.to.slice(-4)}`);
    return failure(500, "We couldn't send the WhatsApp message.");
  }
  return Response.json({}, { status: 200, headers: NO_STORE });
}
