import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLOCKED_DOMAINS, contactKind, contactProblem, isThrowawayEmail, maskContact, normaliseContact, prettyPhone } from "@/lib/leaders/referee/contact";
import { STAGE_STEPS, stageLine, stageRank } from "@/lib/leaders/referee/labels";
import { BROWSER_COOKIE, isBrowserMarker, isLinkRobot, newBrowserMarker, traceOf } from "@/lib/leaders/referee/trace";

const cases = (JSON.parse(readFileSync(new URL("../fixtures/referee-contacts.json", import.meta.url), "utf8")) as { cases: [string, string | null][] }).cases;

describe("reading contacts (the same cases the database is tested with)", () => {
  it.each(cases)("%j reads as %j", (input, expected) => {
    expect(normaliseContact(input)?.norm ?? null).toBe(expected);
  });

  it("says which kind it is", () => {
    expect(contactKind("a@b.org")).toBe("email");
    expect(contactKind("0803 123 4567")).toBe("phone");
    expect(contactKind("@nothing")).toBe("phone");
    expect(normaliseContact("ADA@Example.org")).toEqual({ kind: "email", norm: "ada@example.org" });
  });

  it("holds the same list of throwaway inboxes as the database", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261214000100_referee_trust.sql", import.meta.url), "utf8");
    const block = sql.slice(sql.indexOf("insert into public.referee_blocked_domains"), sql.indexOf(";", sql.indexOf("insert into public.referee_blocked_domains")));
    const inDb = [...block.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]).sort();
    expect([...BLOCKED_DOMAINS].sort()).toEqual(inDb);
    expect(inDb.length).toBeGreaterThan(40);
    expect(isThrowawayEmail("x@Mailinator.com")).toBe(true);
    expect(isThrowawayEmail("x@gmail.com")).toBe(false);
  });

  it("masks the way the database does", () => {
    expect(maskContact("email", "femi@gmail.com")).toBe("f•••@gmail.com");
    expect(maskContact("phone", "+2348031234567")).toBe("+234 ••• ••• 567");
    expect(maskContact("phone", null)).toBeNull();
  });

  it("writes a Nigerian number the way people read it", () => {
    expect(prettyPhone("+2348031234567")).toBe("+234 803 123 4567");
    expect(prettyPhone("+447700900123")).toBe("+447700900123");
  });

  it("tells the applicant what is wrong with what they typed, in words", () => {
    expect(contactProblem("")).toMatch(/Enter a phone number or an email/);
    expect(contactProblem("hello")).toMatch(/phone number/);
    expect(contactProblem("a@b")).toMatch(/email address/);
    expect(contactProblem("x@mailinator.com")).toMatch(/temporary/);
    expect(contactProblem("0803 123 4567", ["+2348031234567"])).toMatch(/someone else/);
    expect(contactProblem("Me@Example.org", ["me@example.org"])).toMatch(/someone else/);
    expect(contactProblem("0803 123 4567", [null, undefined, ""])).toBeNull();
    expect(contactProblem("femi@church.org")).toBeNull();
  });
});

describe("where a request came from", () => {
  const headers = (h: Record<string, string>) => new Headers(h);
  const SALT = "s".repeat(32);

  it("hashes the network and the browser marker, and gives the same answer for the same pair", () => {
    const marker = newBrowserMarker();
    expect(isBrowserMarker(marker)).toBe(true);
    const a = traceOf(headers({ "x-forwarded-for": "102.89.1.2" }), marker, SALT);
    const b = traceOf(headers({ "x-forwarded-for": "102.89.1.2" }), marker, SALT);
    expect(a).toEqual(b);
    expect(a.net).toMatch(/^[a-f0-9]{64}$/);
    expect(a.bid).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a)).not.toContain("102.89.1.2");
    expect(JSON.stringify(a)).not.toContain(marker);
  });

  it("tells two networks and two browsers apart, and a different salt gives different hashes", () => {
    const m = newBrowserMarker();
    const one = traceOf(headers({ "x-forwarded-for": "102.89.1.2" }), m, SALT);
    expect(traceOf(headers({ "x-forwarded-for": "41.58.9.9" }), m, SALT).net).not.toBe(one.net);
    expect(traceOf(headers({ "x-forwarded-for": "102.89.1.2" }), newBrowserMarker(), SALT).bid).not.toBe(one.bid);
    expect(traceOf(headers({ "x-forwarded-for": "102.89.1.2" }), m, "t".repeat(32)).net).not.toBe(one.net);
  });

  it("gives nothing, rather than something wrong, when there is no salt or no marker", () => {
    expect(traceOf(headers({ "x-forwarded-for": "1.2.3.4" }), newBrowserMarker(), null)).toEqual({ net: null, bid: null });
    expect(traceOf(headers({}), undefined, SALT).bid).toBeNull();
    expect(traceOf(headers({}), "not-a-marker", SALT).bid).toBeNull();
    expect(BROWSER_COOKIE).toBe("ut_bid");
  });

  it("knows link-preview programs from people", () => {
    for (const ua of [
      "WhatsApp/2.23.20.0 A", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0", "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Mozilla/5.0 (Windows NT 10.0) Microsoft Preview", "curl/8.4.0", "", "python-requests/2.31", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 Safelinks scan",
    ]) expect(isLinkRobot(ua), ua).toBe(true);
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 13; TECNO KG5k) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
      "Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16",
    ]) expect(isLinkRobot(ua), ua).toBe(false);
  });
});

describe("what the applicant is told", () => {
  it("counts how far a request has got", () => {
    expect(STAGE_STEPS.map((s) => s.id)).toEqual(["sent", "opened", "verified", "answered"]);
    expect(["waiting", "sending", "unreachable"].map(stageRank)).toEqual([0, 0, 0]);
    expect(["sent", "opened", "verified", "answered"].map(stageRank)).toEqual([1, 2, 3, 4]);
    expect(stageRank("nonsense")).toBe(0);
  });

  it("says it in a sentence, and never names the link", () => {
    expect(stageLine("sent", "email", "Pastor Ife")).toBe("We sent Pastor Ife a private link by email. They haven’t opened it yet.");
    expect(stageLine("unreachable", "phone", "Bola")).toMatch(/couldn’t reach Bola/);
    for (const s of ["waiting", "sending", "sent", "opened", "verified", "answered", "unreachable"]) expect(stageLine(s, "phone", "Ife")).not.toMatch(/https?:|\/reference/);
  });
});
