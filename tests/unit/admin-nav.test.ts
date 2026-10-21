import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import * as ROLE_LISTS from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/roles";
import { PAGES, SECTIONS, barText, crumbsFor, menuFor, pageFor, searchPages, sectionOf } from "@/lib/admin/nav";
import {
  SHORTCUTS, ageText, countsByHref, hatsOf, noticeWarnings, parseAttention, rememberedHat, rowText, rowsFor, shortcutsFor, type AttentionRow,
} from "@/lib/admin/today";

const APP = join(__dirname, "../../src/app/(app)");

/** The roles a page lets in, read from the page itself: `requireRole(X, ...)` with X a list in roles.ts, or a list written out. */
function gateOf(route: string): Role[] | null {
  const file = join(APP, route === "/admin" ? "admin" : route.slice(1), "page.tsx");
  if (!existsSync(file)) return null;
  const source = readFileSync(file, "utf8");
  const call = /requireRole\(\s*(\[[^\]]*\]|[A-Z_]+)\s*,/.exec(source);
  if (!call) return null;
  const parts = call[1].startsWith("[") ? call[1].slice(1, -1).split(",") : [call[1]];
  const out: Role[] = [];
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    if (raw.startsWith("...")) out.push(...((ROLE_LISTS as unknown as Record<string, Role[]>)[raw.slice(3)] ?? []));
    else if (raw.startsWith('"')) out.push(raw.slice(1, -1) as Role);
    else out.push(...((ROLE_LISTS as unknown as Record<string, Role[]>)[raw] ?? []));
  }
  return out;
}

const sameRoles = (a: readonly Role[], b: readonly Role[]) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

/** Every page.tsx under Admin, as the address it answers (a dynamic part is given a value). */
function adminRoutes(dir = join(APP, "admin")): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return adminRoutes(full);
    if (name !== "page.tsx") return [];
    return ["/" + relative(APP, dir).replace(/\\/g, "/").replace(/\[[^\]]+\]/g, "1")];
  });
}

describe("the one list of Admin pages", () => {
  it("has the seven sections, in order", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Today", "Season", "People", "Leaders", "Messages", "Programme", "System"]);
  });

  it("puts every page in exactly one section, once", () => {
    const hrefs = PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(PAGES.map((p) => p.label)).size).toBe(PAGES.length);
    for (const href of hrefs) expect(SECTIONS.filter((s) => s.pages.some((p) => p.href === href)), href).toHaveLength(1);
    expect(PAGES).toHaveLength(26);
  });

  it("has a page for every address under Admin, so a new page cannot be left out of the menu", () => {
    for (const route of adminRoutes()) expect(pageFor(route), route).toBeDefined();
  });

  it("has a page behind every entry", () => {
    for (const p of PAGES) expect(existsSync(join(APP, p.href === "/admin" ? "admin" : p.href.slice(1), "page.tsx")), p.href).toBe(true);
    for (const p of PAGES) for (const c of p.children ?? []) expect(existsSync(join(APP, c.href.slice(1), "page.tsx")), c.href).toBe(true);
  });

  it("lets in the roles the page itself lets in, so the menu never offers a page that would send the person home", () => {
    for (const p of PAGES) {
      const gate = gateOf(p.href);
      expect(gate, p.href).not.toBeNull();
      expect(sameRoles(p.roles, gate!), `${p.href}: menu ${[...p.roles].sort()} / page ${[...gate!].sort()}`).toBe(true);
    }
  });

  it("names the pages after the job, and keeps the old names as search words", () => {
    const label = (href: string) => PAGES.find((p) => p.href === href)?.label;
    expect(label("/admin/referees")).toBe("Church referee list");
    expect(label("/admin/leader-quality")).toBe("Answer checks");
    expect(label("/admin/leader-supply")).toBe("Leaders needed");
    expect(PAGES.find((p) => p.href === "/admin/referees")?.synonyms).toContain("pastors and unit heads");
    expect(PAGES.find((p) => p.href === "/admin/leader-quality")?.synonyms).toContain("leader quality");
    expect(PAGES.find((p) => p.href === "/admin/leader-supply")?.synonyms).toContain("leader supply");
    expect(PAGES.find((p) => p.href === "/admin/system")?.synonyms).toContain("sending and reporting");
  });

  it("tells the pages that open in another area of the app", () => {
    const tagged = Object.fromEntries(PAGES.filter((p) => p.tag).map((p) => [p.href, p.tag]));
    expect(tagged).toEqual({
      "/growth/swaps": "Growth", "/growth/multiply": "Growth", "/growth/model": "Growth",
      "/care/teens": "Care", "/care/asks": "Care",
      "/review/templates": "Review",
    });
    for (const p of PAGES) if (!p.tag) expect(p.href.startsWith("/admin"), p.href).toBe(true);
  });
});

describe("where a page sits", () => {
  it("finds the page above a page that is not in the menu", () => {
    expect(pageFor("/admin")?.label).toBe("Today");
    expect(pageFor("/admin/announcements/6f1c2f0e")?.label).toBe("Announcements");
    expect(pageFor("/admin/announcements/approvals")?.label).toBe("Announcements");
    expect(pageFor("/admin/guides/4")?.label).toBe("Weekly guides");
    expect(pageFor("/admin/reminders/week-one")?.label).toBe("Automatic reminders");
    expect(pageFor("/growth/swaps")?.label).toBe("Tribe changes");
    expect(pageFor("/somewhere/else")).toBeUndefined();
    expect(pageFor("/admin/")?.label).toBe("Today");
    expect(pageFor("/admin/messages?status=failed")?.label).toBe("Message log");
  });

  it("writes the breadcrumbs, linking everything but the last step and the section", () => {
    expect(crumbsFor("/admin")).toEqual([{ label: "Today" }]);
    expect(crumbsFor("/admin/messages")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Messages" }, { label: "Message log" }]);
    expect(crumbsFor("/admin/announcements/approvals")).toEqual([
      { label: "Admin", href: "/admin" }, { label: "Messages" }, { label: "Announcements", href: "/admin/announcements" }, { label: "Waiting for approval" },
    ]);
    expect(crumbsFor("/admin/announcements/abc")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Messages" }, { label: "Announcements", href: "/admin/announcements" }]);
    expect(crumbsFor("/growth/model")).toEqual([{ label: "Admin", href: "/admin" }, { label: "Programme" }, { label: "Matching model" }]);
    expect(crumbsFor("/elsewhere")).toEqual([{ label: "Admin", href: "/admin" }]);
  });

  it("writes the bar on a phone as section and page", () => {
    expect(barText("/admin/messages")).toBe("Messages › Message log");
    expect(barText("/admin")).toBe("Today");
    expect(barText("/admin/people")).toBe("People › People and roles");
    expect(barText("/nowhere")).toBe("Admin");
  });

  it("knows each page's section", () => {
    expect(sectionOf("/admin/privacy")?.label).toBe("System");
    expect(sectionOf("/care/asks")?.label).toBe("Messages");
    expect(sectionOf("/admin/nope")).toBeUndefined();
  });
});

describe("the menu, for one person and for one who holds two roles", () => {
  const hrefs = (roles: Role[]) => menuFor(roles).flatMap((s) => s.pages.map((p) => p.href));

  it("shows an admin the pages an admin may open", () => {
    const h = hrefs(["admin"]);
    expect(h).toContain("/admin/people");
    expect(h).toContain("/admin/privacy");
    expect(h).toContain("/admin/messages");
    expect(h).not.toContain("/admin/leader-quality");
    expect(h).not.toContain("/review/cards");
  });

  it("shows a pastor the pages a pastor may open, and not the admin's", () => {
    const h = hrefs(["pastor"]);
    expect(h).toContain("/admin/leader-quality");
    expect(h).toContain("/review/templates");
    expect(h).not.toContain("/admin/privacy");
    expect(h).not.toContain("/admin/people");
    expect(h).not.toContain("/admin/messages");
  });

  it("shows someone who is both an admin and a pastor the pages of both, each once, in the same order as everyone", () => {
    const both = hrefs(["admin", "pastor"]);
    expect(new Set(both).size).toBe(both.length);
    expect(both).toEqual(expect.arrayContaining([...hrefs(["admin"]), ...hrefs(["pastor"])]));
    expect(both).toEqual(hrefs(["pastor", "admin"]));
    const order = PAGES.map((p) => p.href);
    expect(both).toEqual(order.filter((h) => both.includes(h)));
    expect(both.length).toBeGreaterThan(hrefs(["admin"]).length);
    expect(both.length).toBeGreaterThan(hrefs(["pastor"]).length);
  });

  it("shows a director, who holds the pastor's pages and more, no page twice", () => {
    const h = hrefs(["director", "pastor", "admin"]);
    expect(new Set(h).size).toBe(h.length);
    expect(h).toContain("/admin/people");
    expect(h).toContain("/admin/leader-quality");
  });

  it("leaves a section out when no page in it is open to the person, and the menu empty for a member", () => {
    expect(menuFor(["member"])).toEqual([]);
    expect(menuFor([])).toEqual([]);
    const champion = menuFor(["community_champion"]);
    expect(champion.map((s) => s.label)).toEqual(["Messages"]);
    expect(champion[0].pages.map((p) => p.href)).toEqual(["/admin/announcements"]);
    const care = menuFor(["care_lead"]).flatMap((s) => s.pages.map((p) => p.href));
    expect(care).toEqual(["/growth/swaps", "/care/teens", "/care/asks"]);
  });

  it("puts the number waiting beside a page, never a negative or a fraction", () => {
    const m = menuFor(["admin"], { "/admin/privacy": 2, "/admin/messages": -4, "/admin/people": 1.4, "/admin/nope": 9 });
    const count = (h: string) => m.flatMap((s) => s.pages).find((p) => p.href === h)?.count;
    expect(count("/admin/privacy")).toBe(2);
    expect(count("/admin/messages")).toBe(0);
    expect(count("/admin/people")).toBe(1);
    expect(m.flatMap((s) => s.pages).some((p) => p.href === "/admin/nope")).toBe(false);
  });
});

describe("search", () => {
  const menu = menuFor(["admin", "director", "pastor", "data_lead"]).flatMap((s) => s.pages);
  const find = (q: string) => searchPages(q, menu).map((p) => p.label);

  it("finds the pages the blueprint names", () => {
    expect(find("delete account")[0]).toBe("Data requests");
    expect(find("email")).toEqual(expect.arrayContaining(["Sending and email", "Notifications", "Message log"]));
    expect(find("email")[0]).toBe("Sending and email");
    expect(find("referees")[0]).toBe("Church referee list");
    expect(find("referee")[0]).toBe("Church referee list");
  });

  it("finds a page by its old name", () => {
    expect(find("pastors and unit heads")[0]).toBe("Church referee list");
    expect(find("leader quality")[0]).toBe("Answer checks");
    expect(find("leader supply")[0]).toBe("Leaders needed");
    expect(find("sending and reporting")[0]).toBe("Sending and email");
  });

  it("finds every page by its name, first", () => {
    for (const p of menu) expect(find(p.label)[0], p.label).toBe(p.label);
  });

  it("finds every page by each of its other names", () => {
    for (const p of PAGES) {
      for (const s of p.synonyms) expect(searchPages(s, PAGES).map((x) => x.href), `${s} → ${p.label}`).toContain(p.href);
    }
  });

  it("does not care about capitals, spaces, apostrophes or a plural", () => {
    expect(find("  DELETE   Account ")[0]).toBe("Data requests");
    expect(find("tribe cards")).toEqual(expect.arrayContaining([]));
    expect(find("Referees")[0]).toBe("Church referee list");
    expect(find("what's waiting")).toContain("Today");
  });

  it("finds nothing for nothing, for gibberish, and for a page the person cannot open", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
    expect(find("zzzqqq")).toEqual([]);
    expect(searchPages("delete account", menuFor(["pastor"]).flatMap((s) => s.pages))).toEqual([]);
  });

  it("needs every word typed to match, so more words narrow the list", () => {
    expect(find("message").length).toBeGreaterThan(find("message log").length);
    expect(find("message log")[0]).toBe("Message log");
    expect(find("email zzz")).toEqual([]);
  });

  it("lists a section's pages when its name is typed", () => {
    const programme = find("programme");
    expect(programme).toEqual(expect.arrayContaining(["Communities and goals", "Targets", "Matching model"]));
  });
});

describe("what Today says", () => {
  const raw = {
    roles: ["admin", "pastor"],
    rows: [
      { key: "referee_concerns", one: "concern raised by a referee", many: "concerns raised by referees", roles: ["pastor"], count: 1, oldest_days: 2, urgent: true, href: "/review" },
      { key: "data_requests", one: "deletion request", many: "deletion requests", roles: ["admin"], count: 2, oldest_days: 25, urgent: true, href: "/admin/privacy" },
      { key: "cards", one: "Tribe Card waiting for approval", many: "Tribe Cards waiting for approval", roles: ["pastor"], count: 3, oldest_days: 6, urgent: false, href: "/review/cards" },
      { key: "failed_messages", one: "message failed in the last day", many: "messages failed in the last day", roles: ["admin"], count: 4, oldest_days: 0, urgent: false, href: "/admin/messages" },
      { key: "held_references", one: "reference held for a look", many: "references held for a look", roles: ["admin", "pastor"], count: 1, oldest_days: 3, urgent: false, href: "/admin/referees" },
    ],
    coming: [{ label: "Season 1 opens", on: "2027-01-04", href: "/admin/seasons" }],
    numbers: { placed: 120, applications_month: 6, certified: 11, tribes_open: 9 },
    notices: { off: 11, empty: [{ group: "pastors" }], faults: 2 },
  };

  it("reads what the database sends", () => {
    const a = parseAttention(raw)!;
    expect(a.roles).toEqual(["admin", "pastor"]);
    expect(a.rows).toHaveLength(5);
    expect(a.rows[0]).toEqual({ key: "referee_concerns", one: "concern raised by a referee", many: "concerns raised by referees", roles: ["pastor"], count: 1, oldestDays: 2, urgent: true, href: "/review" });
    expect(a.coming).toEqual([{ label: "Season 1 opens", on: "2027-01-04", href: "/admin/seasons" }]);
    expect(a.numbers).toEqual({ placed: 120, applicationsMonth: 6, certified: 11, tribesOpen: 9 });
    expect(a.notices).toEqual({ off: 11, empty: ["pastors"], faults: 2 });
  });

  it("leaves out what is not in the shape expected, and never throws", () => {
    for (const bad of [null, undefined, 3, "x", [], true]) expect(parseAttention(bad)).toBeNull();
    const a = parseAttention({
      roles: ["admin", "wizard", 4],
      rows: [
        null, 7, "x", {},
        { key: "a", one: "x", many: "xs", roles: ["admin"], count: 0, href: "/admin/people" },
        { key: "b", one: "x", many: "xs", roles: ["admin"], count: 2, href: "https://evil.example" },
        { key: "c", one: "x", many: "xs", roles: ["admin"], count: 2, href: "//evil.example" },
        { key: "d", one: "x", many: "xs", roles: ["admin", "wizard"], count: "3", oldest_days: "x", href: "/admin/people" },
      ],
      coming: [{ label: "x", on: "not a date" }, { label: "ok", on: "2027-02-01", href: "https://evil.example" }, 4, null],
      numbers: "x",
      notices: [],
    })!;
    expect(a.roles).toEqual(["admin"]);
    expect(a.rows).toEqual([{ key: "d", one: "x", many: "xs", roles: ["admin"], count: 3, oldestDays: 0, urgent: false, href: "/admin/people" }]);
    expect(a.coming).toEqual([{ label: "ok", on: "2027-02-01", href: null }]);
    expect(a.numbers).toBeNull();
    expect(a.notices).toEqual({ off: 0, empty: [], faults: 0 });
  });

  it("shows one hat at a time, or everything, keeping the database's order", () => {
    const rows = parseAttention(raw)!.rows;
    expect(rowsFor(rows, "all").map((r) => r.key)).toEqual(["referee_concerns", "data_requests", "cards", "failed_messages", "held_references"]);
    expect(rowsFor(rows, "admin").map((r) => r.key)).toEqual(["data_requests", "failed_messages", "held_references"]);
    expect(rowsFor(rows, "pastor").map((r) => r.key)).toEqual(["referee_concerns", "cards", "held_references"]);
    expect(rowsFor(rows, "director")).toEqual([]);
  });

  it("offers a choice of hat only to someone who wears more than one, in a fixed order", () => {
    expect(hatsOf(["admin"])).toEqual(["admin"]);
    expect(hatsOf(["pastor", "admin"])).toEqual(["admin", "pastor"]);
    expect(hatsOf(["member", "leader", "coach"])).toEqual([]);
    expect(hatsOf(["data_lead", "director", "pastor", "admin"])).toEqual(["admin", "pastor", "director", "data_lead"]);
  });

  it("remembers a hat only while the person still wears it", () => {
    expect(rememberedHat("pastor", ["admin", "pastor"])).toBe("pastor");
    expect(rememberedHat("pastor", ["admin"])).toBe("all");
    expect(rememberedHat("all", ["admin", "pastor"])).toBe("all");
    expect(rememberedHat("wizard", ["admin", "pastor"])).toBe("all");
    expect(rememberedHat(null, ["admin", "pastor"])).toBe("all");
    expect(rememberedHat(7, ["admin", "pastor"])).toBe("all");
  });

  it("counts waiting work beside the page it opens, adding what shares a page and leaving out pages outside Admin's menu", () => {
    const rows = parseAttention(raw)!.rows;
    expect(countsByHref(rows)).toEqual({ "/admin/privacy": 2, "/admin/messages": 4, "/admin/referees": 1 });
    const twice: AttentionRow[] = [
      { key: "offers_unanswered", one: "o", many: "os", roles: ["director"], count: 2, oldestDays: 0, urgent: false, href: "/admin/leader-supply" },
      { key: "leaders_needed", one: "g", many: "gs", roles: ["director"], count: 3, oldestDays: 0, urgent: false, href: "/admin/leader-supply" },
    ];
    expect(countsByHref(twice)).toEqual({ "/admin/leader-supply": 5 });
  });

  it("says each row in words", () => {
    expect(rowText({ key: "data_requests", one: "deletion request", many: "deletion requests", count: 1 })).toBe("1 deletion request");
    expect(rowText({ key: "data_requests", one: "deletion request", many: "deletion requests", count: 2 })).toBe("2 deletion requests");
    expect(rowText({ key: "reporting_copy", one: "reporting copy has not refreshed", many: "reporting copy has not refreshed", count: 1 })).toBe("The reporting copy has not refreshed");
    expect(ageText(0)).toBe("");
    expect(ageText(1)).toBe("Oldest: 1 day");
    expect(ageText(12)).toBe("Oldest: 12 days");
  });

  it("warns about the notices only when there is something to say", () => {
    expect(noticeWarnings({ notices: { off: 0, empty: [], faults: 0 } })).toEqual([]);
    expect(noticeWarnings({ notices: { off: 11, empty: [], faults: 0 } })).toEqual([
      { text: "Team notices are switched off. Nobody is emailed until you turn a group on.", href: "/admin/notifications", tone: "info" },
    ]);
    expect(noticeWarnings({ notices: { off: 1, empty: [], faults: 0 } })[0].text).toBe("1 group of team notices is switched off.");
    expect(noticeWarnings({ notices: { off: 3, empty: [], faults: 0 } })[0].text).toBe("3 groups of team notices are switched off.");
    const w = noticeWarnings({ notices: { off: 0, empty: ["pastors", "care"], faults: 1 } });
    expect(w.map((x) => x.text)).toEqual(["No one receives pastor notices in this centre.", "No one receives care team notices in this centre.", "1 notice could not be queued this week."]);
    expect(w[0].href).toBe("/admin/people");
  });
});

describe("shortcuts", () => {
  it("gives an admin the four an admin opens most", () => {
    expect(shortcutsFor(["admin"]).map((s) => s.label)).toEqual(["People and roles", "Message log", "Data requests", "Announcements"]);
  });

  it("takes them in turn from every role a person holds, at most six, each page once", () => {
    const s = shortcutsFor(["admin", "pastor"]);
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.label)).toEqual(["People and roles", "Applications to decide", "Message log", "Tribe Cards", "Data requests", "Interviews"]);
    const all = shortcutsFor(["admin", "pastor", "director", "data_lead"]);
    expect(all).toHaveLength(6);
    expect(new Set(all.map((x) => x.href)).size).toBe(6);
  });

  it("does not repeat a page two roles share, and does not run short while another role has more", () => {
    const s = shortcutsFor(["admin", "director"]);
    expect(new Set(s.map((x) => x.href)).size).toBe(s.length);
    expect(s.filter((x) => x.href === "/admin/people")).toHaveLength(1);
    expect(shortcutsFor(["admin", "director"], 3)).toHaveLength(3);
  });

  it("gives nobody a shortcut for a role that has none", () => {
    expect(shortcutsFor(["member"])).toEqual([]);
    expect(shortcutsFor(["coach", "leader"])).toEqual([]);
    expect(shortcutsFor([])).toEqual([]);
  });

  it("only names pages the role listed against it may open", () => {
    for (const [role, list] of Object.entries(SHORTCUTS)) {
      for (const s of list ?? []) {
        const gate = gateOf(s.href);
        expect(gate, `${role}: ${s.href}`).not.toBeNull();
        expect(gate, `${role}: ${s.href}`).toContain(role);
      }
    }
  });
});
