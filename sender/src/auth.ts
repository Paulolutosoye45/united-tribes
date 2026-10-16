import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How this service and the United Tribes website prove who they are to each other. Every request carries the time it
 * was made and a signature over `time.body`, made with a secret only the two of them hold. A copied, changed or old
 * request is refused. The website has its own copy of this (src/lib/signin/signing.ts); a test there checks they agree.
 */
export const SIGNATURE_HEADER = "x-ut-signature";
export const TIMESTAMP_HEADER = "x-ut-timestamp";

export function signHeaders(secret: string, body: string, now = Date.now()): Record<string, string> {
  const timestamp = String(now);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature };
}

export function verify(secret: string, headers: Record<string, string | string[] | undefined>, body: string, now = Date.now(), toleranceMs = 5 * 60_000): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const timestamp = one(headers[TIMESTAMP_HEADER]);
  const signature = one(headers[SIGNATURE_HEADER]);
  if (!secret || !timestamp || !signature) return false;
  const at = Number(timestamp);
  if (!Number.isFinite(at) || Math.abs(now - at) > toleranceMs) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const got = Buffer.from(signature, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
