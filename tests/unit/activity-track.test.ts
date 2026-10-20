import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  claims: { sub: "00000000-0000-4000-8000-000000000001" } as { sub?: string } | null,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  fail: null as null | "error" | "throw",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: state.claims ? { claims: state.claims } : null }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (state.fail === "throw") throw new Error("down");
      return state.fail === "error" ? { data: null, error: { message: "refused" } } : { data: null, error: null };
    },
  }),
}));

import { POST } from "@/app/api/track/route";
import { TRACK_MAX_BYTES, parseTrack } from "@/lib/activity/track-body";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.example/api/track", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "https://app.example", host: "app.example", ...headers },
    }),
  );

beforeEach(() => {
  state.claims = { sub: "00000000-0000-4000-8000-000000000001" };
  state.calls = [];
  state.fail = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon");
});
afterEach(() => vi.unstubAllEnvs());

describe("what an event may say", () => {
  it("accepts a screen, a visit and a sign-in, each with only what belongs to it", () => {
    expect(parseTrack('{"kind":"screen","screen":"home","device":"phone","speed":"ok"}')).toEqual({ kind: "screen", screen: "home", device: "phone", speed: "ok" });
    expect(parseTrack('{"kind":"visit","device":"desktop"}')).toEqual({ kind: "visit", device: "desktop" });
    expect(parseTrack('{"kind":"signin","method":"whatsapp","device":"tablet"}')).toEqual({ kind: "signin", method: "whatsapp", device: "tablet" });
  });

  it("refuses anything outside the lists, anything extra, and anything that does not fit its kind", () => {
    const bad = [
      '{"kind":"screen"}',
      '{"kind":"screen","screen":"nowhere"}',
      '{"kind":"screen","screen":"home","device":"watch"}',
      '{"kind":"screen","screen":"home","speed":"instant"}',
      '{"kind":"screen","screen":"home","method":"email"}',
      '{"kind":"visit","screen":"home"}',
      '{"kind":"visit","speed":"fast"}',
      '{"kind":"signin","method":"sms"}',
      '{"kind":"signin","screen":"home"}',
      '{"kind":"directory.opened"}',
      '{"kind":"screen","screen":"home","note":"I am struggling"}',
      '{"kind":"screen","screen":"home","path":"/tribe/choose/123"}',
      '{"kind":"screen","screen":"/home"}',
      '[]',
      'null',
      '"screen"',
      "not json",
      "",
    ];
    for (const text of bad) expect(parseTrack(text), text).toBeNull();
    expect(parseTrack(JSON.stringify({ kind: "screen", screen: "home", device: "x".repeat(TRACK_MAX_BYTES) }))).toBeNull();
  });
});

describe("POST /api/track", () => {
  it("passes a valid screen to the database as the signed-in person, and answers with nothing", async () => {
    const r = await post({ kind: "screen", screen: "tribe", device: "phone", speed: "slow" });
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(state.calls).toEqual([{ fn: "activity_track", args: { p_kind: "screen", p_screen: "tribe", p_device: "phone", p_method: null, p_speed: "slow" } }]);
  });

  it("passes a sign-in with its method", async () => {
    expect((await post({ kind: "signin", method: "email", device: "phone" })).status).toBe(204);
    expect(state.calls[0].args).toMatchObject({ p_kind: "signin", p_method: "email", p_screen: null });
  });

  it("never sends the person's identity: who it is comes from the sign-in cookie inside the database", async () => {
    await post({ kind: "visit" });
    expect(JSON.stringify(state.calls)).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(Object.keys(state.calls[0].args).sort()).toEqual(["p_device", "p_kind", "p_method", "p_screen", "p_speed"]);
  });

  it("turns away another site, the wrong content type, a bad body and a stranger, without touching the database", async () => {
    expect((await post({ kind: "visit" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ kind: "visit" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ kind: "screen", screen: "elsewhere" })).status).toBe(400);
    expect((await post("x".repeat(TRACK_MAX_BYTES + 1))).status).toBe(400);
    state.claims = null;
    expect((await post({ kind: "visit" })).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it("answers the same when the database refuses or fails, so a caller learns nothing", async () => {
    state.fail = "error";
    const refused = await post({ kind: "screen", screen: "home" });
    state.fail = "throw";
    const down = await post({ kind: "screen", screen: "home" });
    expect([refused.status, down.status]).toEqual([204, 204]);
    expect([await refused.text(), await down.text()]).toEqual(["", ""]);
  });

  it("does nothing, and says nothing, when the site is not set up", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect((await post({ kind: "visit" })).status).toBe(204);
    expect(state.calls).toHaveLength(0);
  });
});
