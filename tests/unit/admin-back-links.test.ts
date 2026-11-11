import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every Admin screen has a way back, the way back goes to a screen that exists, and following it from any screen always reaches the Admin hub (never round in a circle).

const ROOT = path.resolve(__dirname, "../../src/app/(app)/admin");

const pages = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
};
const route = (file: string) => "/admin" + path.dirname(path.relative(ROOT, file)).replace(/^\.$/, "").replace(/^(?=.)/, "/");
const fileOf = (r: string) => path.join(ROOT, r.replace(/^\/admin\/?/, ""), "page.tsx");
const text = (r: string) => fs.readFileSync(fileOf(r), "utf8");

/** The screen a page's way back leads to: its own literal back link (or the BACK it names), else the Admin hub the heading defaults to. */
const backOf = (src: string): string | null => {
  if (!/PageHead/.test(src)) return null;
  const literal = src.match(/back=\{\{\s*href:\s*"([^"]+)"/);
  if (literal) return literal[1];
  const named = src.match(/const BACK\s*=\s*\{\s*href:\s*"([^"]+)"/);
  if (named && /back=\{BACK\}/.test(src)) return named[1];
  return "/admin";
};

const all = pages(ROOT).map((f) => route(f));

describe("the way back on every Admin screen", () => {
  it("finds the screens (so the test cannot pass by looking at nothing)", () => {
    expect(all.length).toBeGreaterThan(35);
    expect(all).toContain("/admin");
    expect(all).toContain("/admin/people/leader-cards/reconcile");
    expect(all).toContain("/admin/seats");
  });

  it("gives every screen but the hub a heading with a way back (or sends the person on at once)", () => {
    const bare = all.filter((r) => r !== "/admin" && !/PageHead|redirect\(/.test(text(r)));
    expect(bare).toEqual([]);
  });

  it("leads each way back to a screen that exists, and never to a screen that has no page", () => {
    const broken: string[] = [];
    for (const r of all) {
      const back = backOf(text(r));
      if (back && !fs.existsSync(fileOf(back))) broken.push(`${r} -> ${back}`);
    }
    expect(broken).toEqual([]);
  });

  it("reaches the Admin hub from every screen, in a few steps, without going round in a circle", () => {
    const lost: string[] = [];
    for (const r of all) {
      let at = r;
      const seen = new Set<string>();
      for (let i = 0; i < 8 && at !== "/admin"; i++) {
        if (seen.has(at)) break;
        seen.add(at);
        const next = backOf(text(at));
        if (!next) break;
        at = next;
      }
      if (at !== "/admin" && !/redirect\(/.test(text(r))) lost.push(r);
    }
    expect(lost).toEqual([]);
  });

  it("never sends a screen back to itself", () => {
    expect(all.filter((r) => backOf(text(r)) === r)).toEqual([]);
  });
});
