import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { open, parseKeys, seal, sealedWith, sealingAvailable, SealUnavailable } from "@/lib/crypto/seal";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const KEYS = `k2:${key(2)},k1:${key(1)}`;

describe("sealing", () => {
  it("seals and opens a note, and never writes the words in the clear", () => {
    const token = seal("My marriage is hard right now.", "support:abc", KEYS);
    expect(token).not.toContain("marriage");
    expect(token.startsWith("k2.")).toBe(true);
    expect(open(token, "support:abc", KEYS)).toBe("My marriage is hard right now.");
  });

  it("seals the same words differently every time", () => {
    expect(seal("same", "x", KEYS)).not.toBe(seal("same", "x", KEYS));
  });

  it("refuses to open for another owner, with another key, or after tampering", () => {
    const token = seal("private", "support:abc", KEYS);
    expect(open(token, "support:someone-else", KEYS)).toBeNull();
    expect(open(token, "support:abc", `k2:${key(9)}`)).toBeNull();
    const [id, iv, tag, ct] = token.split(".");
    const flipped = Buffer.from(ct, "base64url");
    flipped[0] ^= 1;
    expect(open([id, iv, tag, flipped.toString("base64url")].join("."), "support:abc", KEYS)).toBeNull();
    expect(open("not a sealed note", "support:abc", KEYS)).toBeNull();
    expect(open(null, "support:abc", KEYS)).toBeNull();
  });

  it("still opens what an older key sealed after a new key is put in front", () => {
    const old = seal("from last year", "c", `k1:${key(1)}`);
    expect(sealedWith(old)).toBe("k1");
    expect(open(old, "c", KEYS)).toBe("from last year");
    expect(sealedWith(seal("new", "c", KEYS))).toBe("k2");
  });

  it("keeps words in any script intact", () => {
    const words = "Ẹ kú àárọ̀ — 我们 — مرحبا — 😊";
    expect(open(seal(words, "c", KEYS), "c", KEYS)).toBe(words);
  });

  it("will not run in production without keys, and rejects a key of the wrong size", () => {
    expect(parseKeys(undefined, true)).toBeNull();
    expect(sealingAvailable(undefined)).toBe(true); // development falls back to a throwaway key
    expect(() => seal("x", "c", "")).not.toThrow();
    expect(() => parseKeys("k1:AAAA", true)).toThrow(/32 bytes/);
    expect(() => parseKeys("nonsense", true)).toThrow(/id:base64key/);
    expect(new SealUnavailable().message).toMatch(/DATA_ENCRYPTION_KEYS/);
  });
});
