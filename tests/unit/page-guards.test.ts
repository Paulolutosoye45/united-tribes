import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every screen behind sign-in checks who is asking, and names itself as the place to come back to (so a person who is turned away, or has to sign in, is brought back to this
// screen and not to another one by a copied line).

const APP = path.resolve(__dirname, "../../src/app");

const pages = (dir: string, out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
};
/** "(app)/admin/seats/page.tsx" -> "/admin/seats"; a dynamic segment stays as [name]. */
const routeOf = (root: string, file: string) => {
  const rel = path.relative(path.join(APP, root), path.dirname(file)).split(path.sep).filter(Boolean);
  const base = root.replace(/^\([a-z]+\)\/?/, "");
  return "/" + [base, ...rel].filter(Boolean).join("/");
};
const read = (f: string) => fs.readFileSync(f, "utf8");

/** The screens for the office, where each one must name the roles it lets in. */
const OFFICE = pages(path.join(APP, "(app)/admin"));

describe("the Admin screens check who is asking", () => {
  it("finds the screens", () => {
    expect(OFFICE.length).toBeGreaterThan(35);
  });

  it("asks requireRole on every one, and never lets a screen rely on being signed in alone", () => {
    expect(OFFICE.filter((f) => !/\brequireRole\(/.test(read(f))).map((f) => routeOf("(app)", f))).toEqual([]);
  });

  it("names the screen itself as the place to come back to, wherever the address is fixed", () => {
    const wrong: string[] = [];
    for (const f of OFFICE) {
      const route = routeOf("(app)", f);
      if (route.includes("[")) continue;
      for (const m of read(f).matchAll(/requireRole\([^)]*?,\s*"([^"]+)"\s*\)/g)) {
        // A screen may come back to its own address with a query, or to the parent it is a part of.
        const back = m[1].split("?")[0];
        if (back !== route) wrong.push(`${route} comes back to ${m[1]}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the other screens behind sign-in", () => {
  const groups: [string, string][] = [
    ["(app)", "lead"],
    ["(focus)", "lead"],
    ["(app)", "care"],
    ["(app)", "reports"],
    ["(app)", "exports"],
    ["(focus)", "exports"],
  ];
  for (const [group, dir] of groups) {
    it(`checks the person on every screen under /${dir} (${group})`, () => {
      const list = pages(path.join(APP, group, dir));
      // A printed page has no role check of its own: it opens the person's link in the database (export_open), which checks the person, the link's life and the pack again.
      const guarded = (src: string) => /\brequire(Role|Session|[A-Z][A-Za-z]*)\(/.test(src) || /rpc\("export_open"/.test(src);
      expect(list.filter((f) => !guarded(read(f))).map((f) => routeOf(group, f))).toEqual([]);
    });
  }

  it("keeps God Mode behind the unlock in its layout, so no screen under it opens without it", () => {
    const layout = read(path.join(APP, "(app)/god/layout.tsx"));
    expect(layout).toMatch(/requireSession\("\/god"\)/);
    expect(layout).toMatch(/redirect\(/);
  });
});
