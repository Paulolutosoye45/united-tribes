import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/redirect";

// Signing in: the pages meant for people with no account stay open, the pages behind sign-in never become open by a slip, and the page a person was heading to is kept.

const SRC = path.resolve(__dirname, "../../src");
const APP = path.join(SRC, "app");
const proxy = fs.readFileSync(path.join(SRC, "proxy.ts"), "utf8");

const prefixes = (): string[] => {
  const m = proxy.match(/const PUBLIC_PREFIXES = \[([^\]]*)\]/);
  expect(m, "PUBLIC_PREFIXES not found").toBeTruthy();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const dirs = (group: string) =>
  fs
    .readdirSync(path.join(APP, group), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => `/${e.name}`)
    .sort();
const open = (p: string) => prefixes().some((x) => p === x || p.startsWith(`${x}/`));

describe("which pages need no sign-in", () => {
  it("opens every page in the public group, so a visitor is never sent to sign in for a page meant for them", () => {
    const list = dirs("(public)");
    expect(list.length).toBeGreaterThan(8);
    expect(list.filter((p) => !open(p))).toEqual([]);
  });

  it("opens nothing in the app or the focused screens (admin, leader, God Mode, joining, a member's own pages)", () => {
    const behind = [...dirs("(app)"), ...dirs("(focus)")].filter((p) => !p.startsWith("/(") && p !== "/layout.tsx");
    expect(behind.length).toBeGreaterThan(10);
    expect(behind.filter((p) => open(p))).toEqual([]);
    for (const p of ["/admin", "/lead", "/god", "/home", "/my", "/profile", "/tribe", "/join", "/care", "/exports", "/reports"]) expect(open(p), p).toBe(false);
  });

  it("opens a prefix only as itself or below it, never by a shared first letter (so /r does not open /reports, and /e does not open /exports)", () => {
    for (const p of ["/reports", "/exports", "/dashboard", "/onboarding", "/details-private", "/seats", "/placed-admin"]) expect(open(p), p).toBe(false);
    for (const p of ["/r/abc", "/e/abc", "/d/abc", "/o/abc", "/placed/abc", "/seat/abc", "/details", "/add-number/abc"]) expect(open(p), p).toBe(true);
  });

  it("has no prefix that points at nothing, so a typing slip cannot leave the real page behind sign-in", () => {
    const known = new Set([...dirs("(public)"), ...dirs("(app)"), ...dirs("(focus)"), ...fs.readdirSync(APP).map((n) => `/${n}`)].map((p) => p.replace(/\.[a-z]+$/, "")));
    const files = new Set(["/manifest.webmanifest", "/sw.js"]);
    const unknown = prefixes().filter((p) => !known.has(p) && !files.has(p) && !fs.existsSync(path.join(SRC, "..", "public", p.slice(1))));
    expect(unknown).toEqual([]);
  });
});

describe("keeping the page a person was heading to", () => {
  it("sends a signed-out visitor to sign in with the page and its query as the destination, for pages and not for background requests", () => {
    expect(proxy).toMatch(/url\.searchParams\.set\("next", `\$\{pathname\}\$\{search\}`\)/);
    expect(proxy).toMatch(/pathname\.startsWith\("\/api\/"\)[\s\S]{0,120}status: 401/);
  });

  it("keeps a page and its query, and never an address elsewhere or the sign-in screen itself", () => {
    expect(safeNext("/lead/tribe")).toBe("/lead/tribe");
    expect(safeNext("/admin/seats?tab=autopilot")).toBe("/admin/seats?tab=autopilot");
    expect(safeNext("/admin/people/leader-cards/reconcile?run=1")).toBe("/admin/people/leader-cards/reconcile?run=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/sign-in?next=/x", "/auth/callback", "javascript:alert(1)", "/a\nb", "/a\tb"]) expect(safeNext(bad), bad).toBe("/home");
  });

  it("sends a person who is already signed in from the sign-in screen to Home, never back to itself", () => {
    expect(proxy).toMatch(/signedIn && pathname === "\/sign-in"[\s\S]{0,120}url\.pathname = "\/home"/);
  });
});
