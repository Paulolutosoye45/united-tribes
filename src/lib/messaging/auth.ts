import { createHash, timingSafeEqual } from "node:crypto";

/** Compares two secrets without revealing, by timing, how many characters matched. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Whether the request carries `Authorization: Bearer <secret>` for any of the secrets. */
export function bearerMatches(request: Request, secrets: (string | undefined | null)[]): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const given = match[1].trim();
  let ok = false;
  for (const secret of secrets) {
    if (secret && secret.length >= 16 && sameSecret(given, secret)) ok = true;
  }
  return ok;
}
