import { seal } from "@/lib/crypto/seal";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { hashSalt } from "@/lib/signin/hash";
import { hookFailure, respond } from "@/lib/signin/outcome";
import { runSendCode } from "@/lib/signin/send-code";
import { readHookRequest } from "@/lib/whatsapp/payload";
import { senderFromEnv } from "@/lib/whatsapp/provider";
import { verifyWebhook } from "@/lib/whatsapp/webhook";

const MAX_BODY = 4096;

/**
 * Supabase calls this instead of sending a text message, every time it has a
 * sign-in or number-change code to deliver. We put the code on WhatsApp, after
 * the limits (src/lib/signin/send-code.ts) have said it may go.
 *
 * It is open to the internet by necessity, so nothing happens unless the
 * request carries a valid signature made with the hook secret. The code and
 * the full number are never written to a log.
 */
export async function POST(request: Request) {
  const secret = process.env.SEND_SMS_HOOK_SECRET;
  const sender = senderFromEnv();
  const token = workerToken();
  if (!secret || !sender || !token) return respond(hookFailure(503, "WhatsApp sign-in is not set up."));

  // Refuse a large request before reading it.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return respond(hookFailure(413, "Request too large."));
  const body = await request.text();
  if (body.length > MAX_BODY) return respond(hookFailure(413, "Request too large."));

  const trusted = verifyWebhook({
    secret,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body,
  });
  if (!trusted) return respond(hookFailure(401, "Not allowed."));

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return respond(hookFailure(400, "Unreadable request."));
  }
  const hook = readHookRequest(json);
  if (!hook) return respond(hookFailure(400, "No number to send to."));

  try {
    return respond(await runSendCode(hook, { sender, rpc: workerRpc(token), salt: hashSalt(), seal, log: (line) => console.error(line) }));
  } catch {
    return respond(hookFailure(503, "We couldn't send the WhatsApp message."));
  }
}
