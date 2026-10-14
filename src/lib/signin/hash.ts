import { createHash, createHmac } from "node:crypto";

/**
 * Numbers and networks are never written to the database. Only a salted hash of each is, so the sign-in log can
 * count "the same number" or "the same network" without ever being able to say which number or network it was.
 *
 *   SIGNIN_HASH_SALT   a long random text (openssl rand -hex 32). Without it, a salt is derived from WORKER_TOKEN,
 *                      so nothing extra needs setting. Changing it only forgets the recent past (limits start fresh).
 */
export function hashSalt(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = (env.SIGNIN_HASH_SALT ?? "").trim();
  if (explicit.length >= 16) return explicit;
  const token = (env.WORKER_TOKEN ?? "").trim();
  return token.length >= 32 ? createHash("sha256").update(`signin-salt:${token}`).digest("hex") : null;
}

/** `digits` is the number with its country code and nothing else, such as 2348031234567. Null if it is not one, or there is no salt. */
export function hashNumber(digits: string, salt: string | null = hashSalt()): string | null {
  if (!salt || !/^[1-9]\d{7,14}$/.test(digits)) return null;
  return createHmac("sha256", salt).update(`number:${digits}`).digest("hex");
}

export function hashNetwork(key: string, salt: string | null = hashSalt()): string | null {
  if (!salt || !key) return null;
  return createHmac("sha256", salt).update(`network:${key}`).digest("hex");
}

/**
 * Which network a request came from, as plain text (it is hashed straight away and never stored).
 * An IPv4 address is used whole. An IPv6 address is cut to its first 64 bits, because one home or phone has a whole
 * range of them and counting each separately would make the limit meaningless. When no address is given, everything
 * lands in one bucket called "unknown", which errs on the side of caution.
 *
 * The platform in front of the site (Vercel) sets these headers itself; a request cannot choose its own.
 */
export function networkKey(headers: Headers): string {
  const raw =
    headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "";
  return normaliseAddress(raw) || "unknown";
}

export function normaliseAddress(input: string): string {
  let a = input.trim().toLowerCase();
  if (!a) return "";
  // [::1]:443 and 1.2.3.4:5678
  if (a.startsWith("[")) a = a.slice(1, a.indexOf("]") > 0 ? a.indexOf("]") : undefined);
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(":"));
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return a;
  if (a.includes(":")) {
    const [head, tail = ""] = a.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    const groups = a.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
    if (groups.length !== 8) return a;
    return groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":");
  }
  return a;
}
