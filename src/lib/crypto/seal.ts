import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing: how the notes a member writes in private (what would help care for them, a note for their leader)
 * are protected before they reach the database. The keys live in the app's settings, never in the database,
 * so a copy of the database alone cannot read them.
 *
 *   DATA_ENCRYPTION_KEYS="k2:<base64 of 32 bytes>,k1:<base64 of 32 bytes>"
 *
 * The first key seals; every key opens, so a key can be replaced without losing what is already stored: add
 * the new one in front, and keep the old one until `npm run reseal` has been run (see the README).
 * Make a key with:  openssl rand -base64 32
 *
 * AES-256-GCM, a fresh random nonce each time, and the owner's id bound in as additional data, so a sealed
 * note copied onto someone else's row refuses to open.
 */

const KEY_ID = /^[a-z0-9]{1,8}$/;

export class SealUnavailable extends Error {
  constructor() {
    super("Sensitive notes cannot be saved because DATA_ENCRYPTION_KEYS is not set (see .env.example).");
    this.name = "SealUnavailable";
  }
}

type Keyring = { current: { id: string; key: Buffer }; all: Map<string, Buffer> };

/** A throwaway key for local development only. It is refused in production. */
const DEV_KEYS = `dev:${Buffer.alloc(32, 7).toString("base64")}`;

export function parseKeys(raw: string | undefined, production = process.env.NODE_ENV === "production"): Keyring | null {
  const source = raw?.trim() || (production ? "" : DEV_KEYS);
  if (!source) return null;
  const all = new Map<string, Buffer>();
  let current: Keyring["current"] | null = null;
  for (const part of source.split(",")) {
    const [id, b64] = part.trim().split(":");
    if (!id || !b64 || !KEY_ID.test(id)) throw new Error("DATA_ENCRYPTION_KEYS must look like id:base64key,id:base64key");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`Key "${id}" must be 32 bytes (make one with: openssl rand -base64 32)`);
    all.set(id, key);
    current ??= { id, key };
  }
  return current ? { current, all } : null;
}

export function sealingAvailable(raw: string | undefined = process.env.DATA_ENCRYPTION_KEYS): boolean {
  try {
    return parseKeys(raw) !== null;
  } catch {
    return false;
  }
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Seals `plain` for the row it belongs to. `context` is something that must be the same on the way back, like "support:<person id>". */
export function seal(plain: string, context: string, raw: string | undefined = process.env.DATA_ENCRYPTION_KEYS): string {
  const ring = parseKeys(raw);
  if (!ring) throw new SealUnavailable();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [ring.current.id, b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join(".");
}

/** Opens a sealed note. Returns null for anything that does not open (wrong key, wrong owner, tampered, not sealed): never throws. */
export function open(token: string | null | undefined, context: string, raw: string | undefined = process.env.DATA_ENCRYPTION_KEYS): string | null {
  if (!token) return null;
  try {
    const ring = parseKeys(raw);
    if (!ring) return null;
    const [id, iv, tag, ct] = token.split(".");
    const key = ring.all.get(id);
    if (!key || !iv || !tag || !ct) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Which key sealed this token, so a re-seal job knows what is out of date. */
export function sealedWith(token: string | null | undefined): string | null {
  const id = token?.split(".")[0];
  return id && KEY_ID.test(id) ? id : null;
}

/** What is sealed together for each person. */
export const supportContext = (personId: string) => `support:${personId}`;
export const leaderNoteContext = (personId: string) => `leadernote:${personId}`;
export const draftContext = (personId: string) => `draft:${personId}`;
