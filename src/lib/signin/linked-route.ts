import { z } from "zod";
import { open } from "@/lib/crypto/seal";
import { workerRpc, workerToken } from "@/lib/messaging/worker";
import { hashSalt } from "./hash";
import { runInbound, runReceipt } from "./inbound-flow";
import { hookFailure, respond } from "./outcome";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyLinked } from "./signing";

const MAX_BODY = 4096;

const inboundSchema = z.object({ from: z.string().min(8).max(32), text: z.string().max(1000), id: z.string().max(100).optional() });
const receiptSchema = z.object({ to: z.string().min(8).max(32), state: z.enum(["delivered", "read", "failed"]), id: z.string().max(100).optional() });

/**
 * Reads, checks the signature of, and parses a request from the sender service. Returns either a Response to send
 * straight back (anything wrong) or the parsed body.
 */
async function readSigned<T>(request: Request, schema: z.ZodType<T>): Promise<{ response: Response } | { value: T }> {
  const secret = (process.env.LINKED_SENDER_SECRET ?? "").trim();
  const token = workerToken();
  if (!secret || secret.length < 24 || !token) return { response: respond(hookFailure(503, "Not set up.")) };
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return { response: respond(hookFailure(413, "Request too large.")) };
  const body = await request.text();
  if (body.length > MAX_BODY) return { response: respond(hookFailure(413, "Request too large.")) };
  const trusted = verifyLinked(secret, { timestamp: request.headers.get(TIMESTAMP_HEADER), signature: request.headers.get(SIGNATURE_HEADER) }, body);
  if (!trusted) return { response: respond(hookFailure(401, "Not allowed.")) };
  try {
    return { value: schema.parse(JSON.parse(body)) };
  } catch {
    return { response: respond(hookFailure(400, "Unreadable request.")) };
  }
}

export async function handleInbound(request: Request): Promise<Response> {
  const read = await readSigned(request, inboundSchema);
  if ("response" in read) return read.response;
  try {
    return respond(await runInbound(read.value, { rpc: workerRpc(workerToken()!), salt: hashSalt(), open, log: (line) => console.error(line) }));
  } catch {
    return respond(hookFailure(503, "Try again."));
  }
}

export async function handleReceipt(request: Request): Promise<Response> {
  const read = await readSigned(request, receiptSchema);
  if ("response" in read) return read.response;
  try {
    return respond(await runReceipt(read.value, { rpc: workerRpc(workerToken()!), salt: hashSalt(), log: (line) => console.error(line) }));
  } catch {
    return respond(hookFailure(503, "Try again."));
  }
}
