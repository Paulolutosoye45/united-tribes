import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks a request signed the way Supabase signs its auth hooks (the
 * "Standard Webhooks" scheme): an id, a timestamp and one or more signatures
 * over `id.timestamp.body`, made with a shared secret.
 *
 * The secret is the value Supabase shows when the hook is created, such as
 * `v1,whsec_…`. Nothing is trusted until the signature matches and the
 * timestamp is recent, so an old request cannot be replayed.
 */
export function verifyWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  /** Milliseconds since 1970. A parameter so tests need not wait. */
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  const { secret, id, timestamp, signature, body } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  const sent = Number(timestamp);
  if (!Number.isInteger(sent)) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - sent) > (input.toleranceSeconds ?? 300)) return false;

  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  // The header holds one or more space-separated "v1,<base64>" entries.
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** Signs a body the same way, for tests and for trying the hook by hand. */
export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
