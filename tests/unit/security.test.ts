import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, makeNonce, originOf } from "@/lib/security/csp";
import { verifyTurnstile } from "@/lib/security/turnstile";

const directive = (policy: string, name: string) => {
  const part = policy.split("; ").find((p) => p === name || p.startsWith(`${name} `));
  return part ? part.slice(name.length).trim().split(/\s+/).filter(Boolean) : null;
};

describe("the content security policy", () => {
  const base = { nonce: "abc123==", supabaseUrl: "https://abc.supabase.co/rest/v1" };

  it("lets only scripts with this request's nonce run, and what they load", () => {
    const script = directive(buildCsp(base), "script-src")!;
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("allows eval only while developing", () => {
    expect(directive(buildCsp({ ...base, dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp({ ...base, dev: false }), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("closes what a page has no business with", () => {
    const policy = buildCsp(base);
    expect(directive(policy, "default-src")).toEqual(["'self'"]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    expect(directive(policy, "form-action")).toEqual(["'self'"]);
    expect(directive(policy, "frame-src")).toEqual(["'none'"]);
    expect(directive(policy, "worker-src")).toEqual(["'self'"]);
    expect(directive(policy, "manifest-src")).toEqual(["'self'"]);
  });

  it("lets the browser talk to this site and the Supabase project, by origin only", () => {
    const connect = directive(buildCsp(base), "connect-src")!;
    expect(connect).toEqual(["'self'", "https://abc.supabase.co", "wss://abc.supabase.co"]);
    // A local stand-in over http
    expect(directive(buildCsp({ ...base, supabaseUrl: "http://127.0.0.1:54321" }), "connect-src")).toEqual(["'self'", "http://127.0.0.1:54321", "ws://127.0.0.1:54321"]);
    // Not set up yet: the browser can reach only this site
    expect(directive(buildCsp({ nonce: "n" }), "connect-src")).toEqual(["'self'"]);
    expect(directive(buildCsp({ nonce: "n", supabaseUrl: "javascript:alert(1)" }), "connect-src")).toEqual(["'self'"]);
  });

  it("opens Cloudflare's address for the bot check only when it is on", () => {
    expect(buildCsp(base)).not.toContain("cloudflare");
    const on = buildCsp({ ...base, turnstileScriptUrl: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" });
    expect(directive(on, "frame-src")).toEqual(["https://challenges.cloudflare.com"]);
    expect(directive(on, "connect-src")).toContain("https://challenges.cloudflare.com");
  });

  it("asks for https only when told the site is served over https", () => {
    expect(buildCsp(base)).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, upgradeInsecure: true })).toMatch(/; upgrade-insecure-requests$/);
  });

  it("names the origin of an address, and nothing for anything that is not http or https", () => {
    expect(originOf("https://abc.supabase.co/rest/v1?x=1")).toBe("https://abc.supabase.co");
    expect(originOf("http://localhost:3000/a")).toBe("http://localhost:3000");
    expect(originOf("ftp://example.org")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf(null)).toBeNull();
  });

  it("makes a different, unguessable value for every request", () => {
    const seen = new Set(Array.from({ length: 200 }, () => makeNonce()));
    expect(seen.size).toBe(200);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("can report instead of block, for trying a stricter policy on a staging site", () => {
    expect(cspHeaderName(false)).toBe("Content-Security-Policy");
    expect(cspHeaderName(true)).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("the bot check, on the server", () => {
  const token = "0.abcdefghijklmnopqrstuvwxyz";
  const reply = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;

  it("lets everyone through when no secret is set, so a fresh install needs no account", async () => {
    expect(await verifyTurnstile(undefined, { secret: "" })).toEqual({ ok: true });
    expect(await verifyTurnstile("", { secret: null })).toEqual({ ok: true });
  });

  it("refuses a missing, tiny or enormous token once a secret is set", async () => {
    for (const bad of [undefined, null, "", "short", 12345, "x".repeat(5000)]) {
      const out = await verifyTurnstile(bad, { secret: "s3cret", fetcher: reply({ success: true }) });
      expect(out.ok).toBe(false);
    }
  });

  it("passes only when Cloudflare says success", async () => {
    expect(await verifyTurnstile(token, { secret: "s3cret", fetcher: reply({ success: true }) })).toEqual({ ok: true });
    expect((await verifyTurnstile(token, { secret: "s3cret", fetcher: reply({ success: false, "error-codes": ["invalid-input-response"] }) })).ok).toBe(false);
    expect((await verifyTurnstile(token, { secret: "s3cret", fetcher: reply({}) })).ok).toBe(false);
  });

  it("fails closed when Cloudflare cannot be reached or answers badly", async () => {
    expect((await verifyTurnstile(token, { secret: "s3cret", fetcher: reply({ success: true }, false) })).ok).toBe(false);
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const out = await verifyTurnstile(token, { secret: "s3cret", fetcher: down });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/person/);
  });

  it("sends the secret, the token and the visitor's address, and nothing else", async () => {
    let seen: { url: string; body: string } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    await verifyTurnstile(token, { secret: "s3cret", ip: "102.89.1.2", url: "http://stub.test/verify", fetcher: spy });
    expect(seen!.url).toBe("http://stub.test/verify");
    const body = new URLSearchParams(seen!.body);
    expect([...body.keys()].sort()).toEqual(["remoteip", "response", "secret"]);
    expect(body.get("secret")).toBe("s3cret");
    expect(body.get("response")).toBe(token);
    expect(body.get("remoteip")).toBe("102.89.1.2");
  });

  it("leaves the address out when it is not known", async () => {
    let body = "";
    const spy = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    await verifyTurnstile(token, { secret: "s3cret", ip: null, fetcher: spy });
    expect(new URLSearchParams(body).has("remoteip")).toBe(false);
  });
});
