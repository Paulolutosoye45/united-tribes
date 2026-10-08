import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/redirect";
import { isEmail, normaliseEmail, signInErrorMessage } from "@/lib/auth/errors";

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/admin")).toBe("/admin");
    expect(safeNext("/home?tab=1")).toBe("/home?tab=1");
  });

  it("refuses anything that could leave the app", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil",
      "/ok\nSet-Cookie: x=1",
    ]) {
      expect(safeNext(bad), bad).toBe("/home");
    }
  });

  it("never loops back into sign-in", () => {
    expect(safeNext("/sign-in")).toBe("/home");
    expect(safeNext("/auth/callback?code=1")).toBe("/home");
  });

  it("falls back when there is nothing", () => {
    expect(safeNext(null)).toBe("/home");
    expect(safeNext("")).toBe("/home");
    expect(safeNext(undefined, "/x")).toBe("/x");
  });
});

describe("sign-in messages", () => {
  it("explains expired and wrong codes in plain words", () => {
    expect(signInErrorMessage({ code: "otp_expired" })).toMatch(/isn't right or has expired/);
    expect(signInErrorMessage({ message: "Token has expired or is invalid" })).toMatch(/send a new code/);
    expect(signInErrorMessage({ message: "Invalid token" })).toMatch(/isn't right/);
  });

  it("explains rate limits", () => {
    expect(signInErrorMessage({ code: "over_email_send_rate_limit" })).toMatch(/Wait a minute/);
    expect(signInErrorMessage({ status: 429 })).toMatch(/Wait a minute/);
  });

  it("never shows raw server text", () => {
    const text = signInErrorMessage({ message: "pg: relation auth.users does not exist" });
    expect(text).not.toMatch(/relation|pg:/);
    expect(signInErrorMessage(null)).toMatch(/Something went wrong/);
  });
});

describe("email", () => {
  it("normalises and validates", () => {
    expect(normaliseEmail("  Ada@Example.ORG ")).toBe("ada@example.org");
    expect(isEmail("ada@example.org")).toBe(true);
    expect(isEmail(" ada@example.org ")).toBe(true);
    expect(isEmail("ada@")).toBe(false);
    expect(isEmail("ada example@x.co")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});
