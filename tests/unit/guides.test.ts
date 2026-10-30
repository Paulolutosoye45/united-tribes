import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { canOpen, doorFor, guidesFor, shelvesFor } from "@/lib/guides/access";
import { GUIDES, guideBySlug } from "@/lib/guides/catalogue";
import { labelsIn, pieces, plain } from "@/lib/guides/markup";
import { PICTURES, pictureUrl } from "@/lib/guides/pictures";
import { HELP_LINES, helpEntriesFor, helpFor, helpForAll } from "@/lib/guides/context";
import { viewOf } from "@/lib/guides/view";
import type { Guide } from "@/lib/guides/types";

const ROOT = path.resolve(__dirname, "../..");

const steps = (g: Guide) => g.parts.flatMap((p) => p.steps);

/** Everything the app can say on a screen: its source, without the guides themselves (a guide that quotes itself proves nothing). */
function appSource(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p.includes(`${path.sep}lib${path.sep}guides${path.sep}content`) || p.endsWith(`${path.sep}guides`) && p.includes(`${path.sep}components${path.sep}`)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(path.join(ROOT, "src"));
  return out.join("\n");
}

describe("the way a guide's words are marked", () => {
  it("reads bold and labels, and nothing else", () => {
    expect(pieces("Press [[Save my step]] and **wait**.")).toEqual([
      { kind: "text", text: "Press " },
      { kind: "label", text: "Save my step" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "wait" },
      { kind: "text", text: "." },
    ]);
    // A link or a script written in a guide is only words
    expect(pieces("[x](https://example.org) <script>alert(1)</script>")).toEqual([{ kind: "text", text: "[x](https://example.org) <script>alert(1)</script>" }]);
  });
  it("takes the marks off for a screen reader and for search", () => {
    expect(plain("Press [[Continue]] on **every** screen")).toBe("Press Continue on every screen");
    expect(labelsIn("Tick [[WhatsApp]], [[Email]] or [[Text message]].")).toEqual(["WhatsApp", "Email", "Text message"]);
  });
});

describe("who may open which guide", () => {
  const publicGuide = { audience: ["member"], public: true } as const;
  const memberGuide = { audience: ["member"] } as const;
  const leaderGuide = { audience: ["leader"] } as const;
  const pastorGuide = { audience: ["pastor"], seenBy: ["director"] } as const;

  it("opens a public guide for a visitor, and sends a visitor to sign in for any other", () => {
    expect(doorFor(publicGuide, null)).toBe("open");
    expect(doorFor(memberGuide, null)).toBe("sign-in");
    expect(doorFor(leaderGuide, null)).toBe("sign-in");
  });
  it("opens a member's guides for anyone with an account, a leader's only for a leader", () => {
    const member: Role[] = ["member"];
    const leader: Role[] = ["member", "leader"];
    expect(doorFor(memberGuide, member)).toBe("open");
    expect(doorFor(leaderGuide, member)).toBe("forbidden");
    expect(doorFor(leaderGuide, leader)).toBe("open");
    expect(doorFor(memberGuide, leader)).toBe("open");
  });
  it("does not open a pastor's guide for a leader, and opens it for the people who see it as 'what others see'", () => {
    expect(doorFor(pastorGuide, ["member", "leader"])).toBe("forbidden");
    expect(doorFor(pastorGuide, ["member", "director"])).toBe("open");
    expect(doorFor(pastorGuide, ["member", "pastor"])).toBe("open");
  });
  it("is the same rule for every role: a role never opens a guide that is for roles it does not hold", () => {
    for (const g of GUIDES) {
      for (const role of ROLES) {
        const held: Role[] = role === "member" ? ["member"] : ["member", role];
        const mayRead = g.public || g.audience.some((a) => held.includes(a)) || (g.seenBy ?? []).some((a) => held.includes(a));
        expect(canOpen(g, held), `${g.code} for ${role}`).toBe(mayRead);
      }
    }
  });
});

describe("the shelves", () => {
  it("shows a visitor only the guides open to everyone", () => {
    const all = guidesFor(GUIDES, null);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((g) => g.public)).toBe(true);
    expect(shelvesFor(GUIDES, null)).toHaveLength(1);
  });
  it("shows a member the member guides and nothing for leaders", () => {
    const mine = guidesFor(GUIDES, ["member"]);
    expect(mine.some((g) => g.audience[0] === "member")).toBe(true);
    expect(mine.some((g) => g.audience[0] === "leader")).toBe(false);
    expect(mine.some((g) => g.audience[0] === "pastor")).toBe(false);
  });
  it("shows a tribe leader the member guides and the leader's own, each once", () => {
    const leader = guidesFor(GUIDES, ["member", "leader"]);
    const slugs = leader.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(leader.some((g) => g.audience[0] === "member")).toBe(true);
    expect(leader.some((g) => g.audience[0] === "leader")).toBe(true);
    expect(leader.some((g) => g.audience[0] === "pastor")).toBe(false);
    const shelves = shelvesFor(GUIDES, ["member", "leader"]).map((s) => s.key);
    expect(shelves.indexOf("leader")).toBeLessThan(shelves.indexOf("member"));
  });
});

describe("the shelves for the pages people reach from an email", () => {
  const emailPages = GUIDES.filter((g) => g.public && g.seenBy?.length);
  it("has the three pages: a referee's, a parent's, and a placed member's", () => {
    expect(emailPages.map((g) => g.slug).sort()).toEqual(["give-a-reference", "parent-permission", "you-have-been-placed"]);
  });
  it("opens them for anyone with the link, and lists them for a visitor", () => {
    const visitor = guidesFor(GUIDES, null).map((g) => g.slug);
    for (const g of emailPages) {
      expect(doorFor(g, null), g.code).toBe("open");
      expect(visitor, g.code).toContain(g.slug);
    }
  });
  it("keeps them off an ordinary member's shelves, and lists them as 'what other people see' for the roles that look after them", () => {
    const member = guidesFor(GUIDES, ["member"]).map((g) => g.slug);
    for (const g of emailPages) expect(member, g.code).not.toContain(g.slug);
    for (const g of emailPages) {
      for (const role of g.seenBy ?? []) {
        const shelves = shelvesFor(GUIDES, ["member", role]);
        const others = shelves.find((x) => x.key === "others");
        expect(others?.guides.map((x) => x.slug), `${g.code} for ${role}`).toContain(g.slug);
      }
    }
  });
});

describe("the sign-in guide", () => {
  it("is on a signed-in member's shelf too, not only for visitors", () => {
    expect(guidesFor(GUIDES, ["member"]).map((g) => g.slug)).toContain("sign-in");
    expect(guidesFor(GUIDES, ["member", "leader"]).map((g) => g.slug)).toContain("sign-in");
  });
});

describe("the assistant leader's shelf", () => {
  it("has their own guide on a shelf of their own, and the leader's week as what the leader sees", () => {
    const shelves = shelvesFor(GUIDES, ["member", "assistant_leader"]);
    const own = shelves.find((x) => x.key === "assistant_leader");
    expect(own?.guides.map((g) => g.slug)).toContain("assistant-leader");
    const others = shelves.find((x) => x.key === "others");
    expect(others?.guides.map((g) => g.slug)).toEqual(expect.arrayContaining(["run-your-week", "your-tribes-season"]));
  });
  it("is not offered to a member who is not an assistant", () => {
    expect(guidesFor(GUIDES, ["member"]).map((g) => g.slug)).not.toContain("assistant-leader");
    expect(doorFor(guideBySlug("assistant-leader")!, ["member"])).toBe("forbidden");
  });
  it("is shown to a leader as what their assistant reads", () => {
    const others = shelvesFor(GUIDES, ["member", "leader"]).find((x) => x.key === "others");
    expect(others?.guides.map((g) => g.slug)).toContain("assistant-leader");
  });
});

describe("every guide", () => {
  it("has its own code and its own address", () => {
    expect(new Set(GUIDES.map((g) => g.code)).size).toBe(GUIDES.length);
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    for (const g of GUIDES) expect(g.slug, g.code).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("points 'next' only at guides that exist", () => {
    for (const g of GUIDES) for (const n of g.next ?? []) expect(guideBySlug(n) ?? { slug: n === "tutorial" ? n : undefined }, `${g.code} -> ${n}`).toBeTruthy();
  });
  it("has steps with their own names, short lines to do, and at most four things to have ready", () => {
    for (const g of GUIDES) {
      const ids = steps(g).map((s) => s.id);
      expect(new Set(ids).size, `${g.code} step names`).toBe(ids.length);
      expect(g.ready.length, `${g.code} ready`).toBeLessThanOrEqual(4);
      for (const s of steps(g)) {
        expect(s.id, `${g.code} ${s.id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(s.do.length, `${g.code} ${s.id} lines`).toBeLessThanOrEqual(3);
        if (!s.timeline) expect(s.do.length, `${g.code} ${s.id} lines`).toBeGreaterThanOrEqual(1);
        for (const line of s.do) expect(plain(line).length, `${g.code} ${s.id} line length`).toBeLessThanOrEqual(220);
      }
    }
  });
  it("names the shortcut's step, if it has one", () => {
    for (const g of GUIDES) if (g.shortcut) expect(steps(g).map((s) => s.id), g.code).toContain(g.shortcut.toStep);
  });
  it("is built into a view without anything missing", () => {
    for (const g of GUIDES) {
      const v = viewOf(g, []);
      expect(v.steps.length, g.code).toBe(steps(g).length);
    }
  });
});

describe("the words a guide quotes from the screen", () => {
  it("every [[Label]] in a step is spelled somewhere in the app", () => {
    const source = appSource();
    const missing: string[] = [];
    for (const g of GUIDES) {
      for (const s of steps(g)) {
        for (const line of [...s.do, s.tip ?? "", s.why ?? "", s.careful ?? ""]) {
          for (const label of labelsIn(line)) if (!source.includes(label)) missing.push(`${g.code} ${s.id}: [[${label}]]`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the pictures", () => {
  const withShots = GUIDES.flatMap((g) => steps(g).filter((s) => s.shot).map((s) => ({ g, s })));

  it("every step that shows a screen has its picture, and the file is the size the page was told", async () => {
    const problems: string[] = [];
    for (const { g, s } of withShots) {
      const info = PICTURES[g.slug]?.pictures[s.id];
      if (!info) {
        problems.push(`${g.code} ${s.id}: no picture was made`);
        continue;
      }
      const file = path.join(ROOT, "content/guides/pictures", g.slug, `${s.id}.webp`);
      if (!fs.existsSync(file)) {
        problems.push(`${g.code} ${s.id}: the file is missing`);
        continue;
      }
      const meta = await sharp(file).metadata();
      if (meta.width !== info.width || meta.height !== info.height) problems.push(`${g.code} ${s.id}: file is ${meta.width}x${meta.height}, page was told ${info.width}x${info.height}`);
      if (info.rings.length === 0) problems.push(`${g.code} ${s.id}: nothing is ringed`);
      for (const r of info.rings) if (r.x < 0 || r.y < 0 || r.x + r.w > 100.5 || r.y + r.h > 100.5 || r.w <= 0 || r.h <= 0) problems.push(`${g.code} ${s.id}: a ring falls outside its picture`);
    }
    expect(problems).toEqual([]);
  });

  it("no picture is left over for a step that has gone", () => {
    const left: string[] = [];
    const dir = path.join(ROOT, "content/guides/pictures");
    if (!fs.existsSync(dir)) return;
    for (const slug of fs.readdirSync(dir)) {
      const g = guideBySlug(slug);
      if (!g) {
        left.push(`${slug}: no such guide`);
        continue;
      }
      const have = new Set(steps(g).filter((s) => s.shot).map((s) => s.id));
      for (const f of fs.readdirSync(path.join(dir, slug))) if (!have.has(f.replace(/\.webp$/, ""))) left.push(`${slug}/${f}`);
    }
    expect(left).toEqual([]);
  });

  it("a picture's address changes when the picture does", () => {
    const a = pictureUrl("x", { id: "one", hash: "aaaa" });
    const b = pictureUrl("x", { id: "one", hash: "bbbb" });
    expect(a).not.toBe(b);
    expect(a).toBe("/guides/p/x/one?v=aaaa");
  });

  it("is under a kilobyte budget a phone can bear: no picture over 250 KB", () => {
    const dir = path.join(ROOT, "content/guides/pictures");
    if (!fs.existsSync(dir)) return;
    const big: string[] = [];
    for (const slug of fs.readdirSync(dir)) for (const f of fs.readdirSync(path.join(dir, slug))) {
      const size = fs.statSync(path.join(dir, slug, f)).size;
      if (size > 250 * 1024) big.push(`${slug}/${f} ${(size / 1024).toFixed(0)} KB`);
    }
    expect(big).toEqual([]);
  });
});

describe("what the pictures must never show", () => {
  it("no guide's words or alt text names a real person or the church's staff", () => {
    const banned = /Ogedengbe|Cerebre|\bMary\b/i;
    for (const g of GUIDES) {
      const text = [g.title, g.lede, ...g.ready, g.ifDifferent, ...steps(g).flatMap((s) => [s.title, ...s.do, s.tip ?? "", s.why ?? "", s.careful ?? "", s.example ?? "", s.shot?.alt ?? ""])].join("\n");
      expect(banned.test(text), g.code).toBe(false);
    }
  });
});

describe("which guide belongs to which page", () => {
  const slugOf = (roles: Role[], path: string) => helpFor(helpEntriesFor(roles), path)?.slug ?? null;
  it("only ever points at guides that exist", () => {
    for (const line of HELP_LINES) expect(guideBySlug(line.slug), `${line.prefix} -> ${line.slug}`).toBeTruthy();
  });
  it("takes a leader and an assistant leader, on the same page, each to their own guide", () => {
    expect(slugOf(["member", "leader"], "/lead/week")).toBe("run-your-week");
    expect(slugOf(["member", "assistant_leader"], "/lead/week")).toBe("assistant-leader");
    expect(slugOf(["member", "assistant_leader"], "/care")).toBe("assistant-leader");
  });
  it("takes a member to the member's guides and never to one that is not theirs", () => {
    expect(slugOf(["member"], "/join")).toBe("find-your-tribe");
    expect(slugOf(["member"], "/tribe/testimony")).toBe("share-a-testimony");
    expect(slugOf(["member"], "/tribe")).toBe("join-your-tribe");
    expect(slugOf(["member"], "/profile")).toBe("your-information");
    expect(slugOf(["member"], "/lead")).toBe("apply-to-lead");
    expect(slugOf(["member"], "/lead/week")).toBeNull();
    expect(slugOf(["member"], "/lead/academy")).toBeNull();
    for (const role of ROLES) {
      const held: Role[] = role === "member" ? ["member"] : ["member", role];
      for (const e of helpEntriesFor(held)) expect(canOpen(guideBySlug(e.slug)!, held), `${role} ${e.prefix}`).toBe(true);
    }
  });
  it("takes the people who look after WhatsApp, leaders who ask about a place, and coaches who decide, to their own guides", () => {
    expect(slugOf(["member", "admin"], "/admin/messages")).toBe("whatsapp-health");
    expect(slugOf(["member", "admin"], "/admin/messages/whatsapp")).toBe("whatsapp-health");
    expect(slugOf(["member", "data_lead"], "/admin/messages")).toBe("whatsapp-health");
    expect(slugOf(["member", "coach"], "/growth/removals")).toBe("decide-a-place-change");
    expect(slugOf(["member", "care_lead"], "/growth/removals")).toBe("decide-a-place-change");
    expect(slugOf(["member"], "/growth/removals")).toBeNull();
    expect(slugOf(["member"], "/admin/messages")).toBeNull();
    // On the leader's Tribe Card both the appointed leader's guide and the one about asking apply; a member sees neither
    expect(helpForAll(helpEntriesFor(["member", "leader"]), "/lead/tribe").map((e) => e.slug)).toEqual(["appointed-to-lead", "ask-about-a-place"]);
    expect(helpForAll(helpEntriesFor(["member"]), "/lead/tribe").map((e) => e.slug)).not.toContain("ask-about-a-place");
  });
  it("matches a page and the pages under it, but not a page that only starts with the same letters", () => {
    expect(slugOf(["member", "leader"], "/lead")).toBe("appointed-to-lead");
    expect(slugOf(["member", "leader"], "/lead/tribe")).toBe("appointed-to-lead");
    expect(slugOf(["member", "leader"], "/lead/academy/declaration")).toBe("leader-academy");
    expect(slugOf(["member"], "/tribes")).toBeNull();
    expect(slugOf(["member"], "/home")).toBeNull();
  });
});
