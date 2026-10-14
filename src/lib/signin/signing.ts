import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How this website and the optional sender service (the ordinary-number WhatsApp sender in /sender) prove who they
 * are to each other. Every request carries the time it was made and a signature made with a secret only the two
 * of them hold (LINKED_SENDER_SECRET), so a request that was copied or changed is refused, and so is an old one.
 *
 * The sender service has its own copy of this (sender/src/auth.ts); a test makes sure the two agree.
 */
export const SIGNATURE_HEADER = "x-ut-signature";
export const TIMESTAMP_HEADER = "x-ut-timestamp";

export function signLinked(secret: string, body: string, now = Date.now()): { timestamp: string; signature: string } {
  const timestamp = String(now);
  return { timestamp, signature: createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex") };
}

export function verifyLinked(
  secret: string,
  given: { timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
  toleranceMs = 5 * 60_000,
): boolean {
  if (!secret || !given.timestamp || !given.signature) return false;
  const at = Number(given.timestamp);
  if (!Number.isFinite(at) || Math.abs(now - at) > toleranceMs) return false;
  const expected = createHmac("sha256", secret).update(`${given.timestamp}.${body}`).digest();
  const got = Buffer.from(given.signature, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function linkedHeaders(secret: string, body: string, now = Date.now()): Record<string, string> {
  const { timestamp, signature } = signLinked(secret, body, now);
  return { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature };
}
