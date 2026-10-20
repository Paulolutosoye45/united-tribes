import { describe, expect, it } from "vitest";
import { breakerVerdict, DEFAULT_BREAKER } from "@/lib/signin/breaker";
import { DEFAULT_LIMITS, limitsVerdict, resendWaitSeconds } from "@/lib/signin/caps";
import { hashNetwork, hashNumber, hashSalt, networkKey, normaliseAddress } from "@/lib/signin/hash";
import { classifyInbound } from "@/lib/signin/inbound";
import { linkedHeaders, signLinked, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyLinked } from "@/lib/signin/signing";
import { ASK_TEXT, codeMessage, openWhatsAppLink, STOP_REPLY } from "@/lib/signin/wording";
import { signHeaders, verify } from "../../sender/src/auth";

const SALT = "a-long-enough-salt-for-the-tests";

describe("hashes", () => {
  it("hashes a number the same way every time, differently for different numbers and salts", () => {
    const a = hashNumber("2348031234567", SALT);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashNumber("2348031234567", SALT)).toBe(a);
    expect(hashNumber("2348031234568", SALT)).not.toBe(a);
    expect(hashNumber("2348031234567", "another-salt-another-salt-1")).not.toBe(a);
    expect(a).not.toContain("2348031234567");
  });

  it("keeps a number and a network with the same text apart", () => {
    expect(hashNumber("2348031234567", SALT)).not.toBe(hashNetwork("2348031234567", SALT));
  });

  it("refuses what is not a number, and works without a salt only by saying no", () => {
    for (const bad of ["", "0803123456", "abc", "12345", "2348031234567890123"]) expect(hashNumber(bad, SALT), bad).toBeNull();
    expect(hashNumber("2348031234567", null)).toBeNull();
    expect(hashNetwork("1.2.3.4", null)).toBeNull();
    expect(hashNetwork("", SALT)).toBeNull();
  });

  it("gets its salt from SIGNIN_HASH_SALT, else from the sending token, else has none", () => {
    expect(hashSalt({ SIGNIN_HASH_SALT: "x".repeat(20) })).toBe("x".repeat(20));
    const derived = hashSalt({ WORKER_TOKEN: "t".repeat(40) });
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain("tttt");
    expect(hashSalt({ WORKER_TOKEN: "t".repeat(40) })).toBe(derived);
    expect(hashSalt({ SIGNIN_HASH_SALT: "short", WORKER_TOKEN: "short" })).toBeNull();
    expect(hashSalt({})).toBeNull();
  });
});

describe("which network a request came from", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("uses the platform's own address header, then the proxy's, then the first forwarded address", () => {
    expect(networkKey(headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "9.9.9.9" }))).toBe("203.0.113.7");
    expect(networkKey(headers({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(networkKey(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(networkKey(headers({}))).toBe("unknown");
  });

  it("tidies ports and mapped addresses, and counts a whole IPv6 range as one network", () => {
    expect(normaliseAddress("203.0.113.7:5555")).toBe("203.0.113.7");
    expect(normaliseAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normaliseAddress("[2001:db8:abcd:12::1]:443")).toBe("2001:0db8:abcd:0012");
    expect(normaliseAddress("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:abcd:0012");
    expect(normaliseAddress("2001:db8:abcd:12::1")).toBe(normaliseAddress("2001:db8:abcd:12:ffff::2"));
    expect(normaliseAddress("")).toBe("");
  });
});

describe("requests between the website and the sender", () => {
  const secret = "s".repeat(32);
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ to: "2348031234567", text: "hello" });

  it("accepts a request signed with the secret and nothing else", () => {
    const { timestamp, signature } = signLinked(secret, body, now);
    expect(verifyLinked(secret, { timestamp, signature }, body, now)).toBe(true);
    expect(verifyLinked(secret, { timestamp, signature }, body + " ", now)).toBe(false);
    expect(verifyLinked("t".repeat(32), { timestamp, signature }, body, now)).toBe(false);
    expect(verifyLinked(secret, { timestamp: String(now + 1), signature }, body, now)).toBe(false);
    expect(verifyLinked(secret, { timestamp, signature: "00" }, body, now)).toBe(false);
    expect(verifyLinked(secret, { timestamp: null, signature }, body, now)).toBe(false);
    expect(verifyLinked(secret, { timestamp, signature: null }, body, now)).toBe(false);
    expect(verifyLinked("", { timestamp, signature }, body, now)).toBe(false);
  });

  it("refuses an old request and one from the future", () => {
    const { timestamp, signature } = signLinked(secret, body, now);
    expect(verifyLinked(secret, { timestamp, signature }, body, now + 6 * 60_000)).toBe(false);
    expect(verifyLinked(secret, { timestamp, signature }, body, now - 6 * 60_000)).toBe(false);
    expect(verifyLinked(secret, { timestamp, signature }, body, now + 4 * 60_000)).toBe(true);
  });

  it("is the same signature the sender service makes and checks", () => {
    const fromSite = linkedHeaders(secret, body, now);
    expect(verify(secret, fromSite, body, now)).toBe(true);
    const fromSender = signHeaders(secret, body, now);
    expect(fromSender[SIGNATURE_HEADER]).toBe(fromSite[SIGNATURE_HEADER]);
    expect(fromSender[TIMESTAMP_HEADER]).toBe(fromSite[TIMESTAMP_HEADER]);
    expect(verifyLinked(secret, { timestamp: fromSender[TIMESTAMP_HEADER], signature: fromSender[SIGNATURE_HEADER] }, body, now)).toBe(true);
    expect(verify(secret, fromSite, body + "x", now)).toBe(false);
  });
});

describe("what a reply to the sign-in number means", () => {
  it.each([
    "STOP", "stop", "Stop.", "stop please", "STOP!!", "Stop it", "unsubscribe", "Unsubscribe me", "cancel", "opt out", "quit",
  ])("%s is a request to stop", (text) => {
    expect(classifyInbound(text)).toBe("stop");
  });

  it.each([
    "not me", "Not me!", "This was not me", "wasn't me", "It wasn't me", "I didn't ask for this", "I did not request a code", "never asked for this",
    "wrong number", "I didn’t ask",
  ])("%s says the code was not asked for", (text) => {
    expect(classifyInbound(text)).toBe("not_me");
  });

  it.each(["Send my code", "send my code", "code", "hi", "Hello, I need to sign in", "please send it", "", "   ", "stopwatch"])("%j is an ordinary message", (text) => {
    expect(classifyInbound(text)).toBe("other");
  });

  it("does not take a long message that happens to contain the word as a request to stop", () => {
    expect(classifyInbound("I want to sign in but the bus will stop at the church so please send my code now")).toBe("other");
  });
});

describe("what the number says", () => {
  it("sends one short message: who it is from, the code, how to stop it, and no link", () => {
    const text = codeMessage("123456");
    expect(text).toContain("United Tribes");
    expect(text).toContain("123456");
    expect(text).toContain("Ignore this if you did not ask. Reply STOP to stop these.");
    expect(text).not.toMatch(/https?:|www\.|\.com/i);
    expect(text.length).toBeLessThanOrEqual(120);
  });

  it("answers STOP with one polite line and no link", () => {
    expect(STOP_REPLY).toMatch(/30 days/);
    expect(STOP_REPLY).not.toMatch(/https?:/);
  });

  it("opens WhatsApp with the message ready", () => {
    expect(openWhatsAppLink("2348031234567")).toBe(`https://wa.me/2348031234567?text=${encodeURIComponent(ASK_TEXT)}`);
    expect(classifyInbound(ASK_TEXT)).toBe("other");
  });
});

describe("the limits in code", () => {
  const now = 1_800_000_000_000;
  const MIN = 60_000;
  const at = (...minutesAgo: number[]) => minutesAgo.map((m) => now - m * MIN);

  it("allows a first code, then makes people wait 1, 2 and 5 minutes", () => {
    expect(limitsVerdict([], [], now)).toBe("ok");
    expect(limitsVerdict(at(0.5), at(0.5), now)).toBe("wait");
    expect(limitsVerdict(at(1.5), at(1.5), now)).toBe("ok");
    expect(limitsVerdict(at(10, 1.5), at(10, 1.5), now)).toBe("wait");
    expect(limitsVerdict(at(10, 2.5), at(10, 2.5), now)).toBe("ok");
    expect(limitsVerdict(at(40, 30, 4), at(40, 30, 4), now)).toBe("wait");
    expect(limitsVerdict(at(40, 30, 6), at(40, 30, 6), now)).toBe("ok");
  });

  it("stops at 3 in 15 minutes, 8 in a day, 20 an hour and 150 a day", () => {
    expect(limitsVerdict(at(12, 8, 6), at(12, 8, 6), now)).toBe("number_15m");
    expect(limitsVerdict(at(900, 800, 700, 600, 500, 400, 300, 200), at(900, 800, 700, 600, 500, 400, 300, 200), now)).toBe("number_day");
    expect(limitsVerdict([], Array.from({ length: 20 }, (_, i) => now - (i + 1) * MIN), now)).toBe("channel_hour");
    expect(limitsVerdict([], Array.from({ length: 19 }, (_, i) => now - (i + 1) * MIN), now)).toBe("ok");
    expect(limitsVerdict([], Array.from({ length: 150 }, (_, i) => now - (61 + i * 9) * MIN), now)).toBe("channel_day");
  });

  it("tells the screen how long to make a person wait, matching the database", () => {
    expect(resendWaitSeconds(1)).toBe(60);
    expect(resendWaitSeconds(2)).toBe(120);
    expect(resendWaitSeconds(3)).toBe(300);
    expect(resendWaitSeconds(9)).toBe(300);
    expect(resendWaitSeconds(0)).toBe(60);
    expect(DEFAULT_LIMITS.gaps).toEqual([60, 120, 300]);
  });
});

describe("when the breaker trips, in code", () => {
  const none = { sends: 0, failed: 0, rejected: 0, linkedSent: 0, noReceipt: 0, stops: 0 };

  it("needs enough sends to judge before failures count", () => {
    expect(breakerVerdict({ ...none, sends: 4, failed: 4 })).toBeNull();
    expect(breakerVerdict({ ...none, sends: 5, failed: 2 })).toBeNull();
    expect(breakerVerdict({ ...none, sends: 5, failed: 3 })).toBe("failed_sends");
  });

  it("trips on refusals, missing receipts and a run of STOP, in that order of worry", () => {
    expect(breakerVerdict({ ...none, sends: 10, rejected: 5 })).toBe("rejections");
    expect(breakerVerdict({ ...none, linkedSent: 10, noReceipt: 7 })).toBe("no_receipts");
    expect(breakerVerdict({ ...none, linkedSent: 10, noReceipt: 6 })).toBeNull();
    expect(breakerVerdict({ ...none, stops: 3 })).toBe("stop_spike");
    expect(breakerVerdict({ ...none, stops: 2 })).toBeNull();
    expect(breakerVerdict({ ...none, sends: 10, failed: 5, stops: 3 })).toBe("failed_sends");
    expect(DEFAULT_BREAKER).toEqual({ minSends: 5, failPct: 50, noReceiptPct: 70, stopCount: 3 });
  });
});
