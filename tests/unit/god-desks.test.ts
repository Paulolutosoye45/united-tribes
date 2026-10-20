import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABELS } from "@/lib/auth/roles";
import { ANALYSIS, DESK_LIST, deskFor } from "@/lib/god/desks";
import {
  contextWords,
  parseAnnouncements,
  parseChatOpens,
  parseDesks,
  parseMessages,
  parseRolePeople,
  replyLine,
} from "@/lib/god/oversight";
import { lookedLine } from "@/lib/god/wording";

const APP = join(process.cwd(), "src", "app");
function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (name === "page.tsx") out.push(relative(APP, dir).split(sep).filter((seg) => !/^\(.*\)$/.test(seg)).join("/"));
  }
  return out;
}
const ROUTES = pages(APP).map((r) => new RegExp(`^/${r.split("/").filter(Boolean).map((seg) => (/^\[.*\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}$`));
const exists = (href: string) => ROUTES.some((re) => re.test(href));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("the desks", () => {
  it("has a desk for every role, in the platform’s order, with its own label", () => {
    expect(DESK_LIST.map((d) => d.role)).toEqual([...ROLES]);
    for (const d of DESK_LIST) {
      expect(d.label).toBe(ROLE_LABELS[d.role]);
      expect(d.watches.length).toBeGreaterThan(20);
      expect(d.items.length).toBeGreaterThan(0);
      expect(deskFor(d.role)).toBe(d);
    }
    expect(deskFor("wizard")).toBeNull();
    expect(deskFor("")).toBeNull();
  });

  it("points only at screens that exist: every link on every desk and in the analysis map", () => {
    const links = [
      ...DESK_LIST.flatMap((d) => [...d.items.map((i) => i.href), ...d.counts.flatMap((c) => (c.href ? [c.href] : []))]),
      ...ANALYSIS.map((a) => a.href),
    ];
    expect(links.length).toBeGreaterThan(40);
    for (const href of links) expect(exists(href), href).toBe(true);
  });

  it("only shows counts the database gives", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261224000100_god_oversight.sql"), "utf8");
    const keys = [...sql.matchAll(/'([a-z0-9_]+)',\s*(?:\(|v_demand)/g)].map((m) => m[1]);
    for (const d of DESK_LIST) for (const c of d.counts) expect(keys, `${d.role}: ${c.key}`).toContain(c.key);
  });

  it("gives every item a title and a sentence, and no item twice on one desk", () => {
    for (const d of DESK_LIST) {
      const seen = new Set<string>();
      for (const i of d.items) {
        expect(i.title.length).toBeGreaterThan(1);
        expect(i.what.length).toBeGreaterThan(10);
        const key = `${i.href}|${i.title}`;
        expect(seen.has(key), `${d.role}: ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("lists the owner’s console pages in the analysis map only once each", () => {
    const hrefs = ANALYSIS.map((a) => a.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("reading the oversight functions", () => {
  it("reads the desks and leaves out what is not in shape", () => {
    const d = parseDesks({
      season: { id: ID(1), name: "Season 3", status: "planning" },
      roles: [{ role: "pastor", people: 2, active_7d: 1 }, { nope: 1 }, { role: "coach", people: -4, active_7d: "x" }],
      counts: { tribes_live: 12, bad: "x", negative: -2 },
    })!;
    expect(d.roles).toEqual([{ role: "pastor", people: 2, active7d: 1 }, { role: "coach", people: 0, active7d: 0 }]);
    expect(d.counts).toEqual({ tribes_live: 12, bad: 0, negative: 0 });
    expect(d.season?.name).toBe("Season 3");
    for (const bad of [null, undefined, "x", [], 3]) expect(parseDesks(bad)).toBeNull();
    expect(parseDesks({})?.roles).toEqual([]);
  });

  it("reads the people who hold a role", () => {
    const r = parseRolePeople({ role: "coach", people: [{ id: ID(1), name: "Amy", last_seen: "2026-10-19T10:00:00Z", actions_7d: 3, tribes: 2 }, { id: "x" }, { id: ID(2) }] })!;
    expect(r.people.map((p) => p.name)).toEqual(["Amy", "Someone"]);
    expect(r.people[0]).toMatchObject({ actions7d: 3, tribes: 2 });
    expect(parseRolePeople({ role: "coach" })).toBeNull();
  });

  it("never keeps the wording of a held message, whatever came back", () => {
    const r = parseMessages({
      messages: [
        { id: ID(1), at: "2026-10-19T10:00:00Z", template: "care_urgent", status: "sent", held: "A care message.", params: { note: "private" } },
        { id: ID(2), at: "2026-10-19T09:00:00Z", template: "welcome", status: "failed", error: "No phone", held: null, params: { first: "Ngozi" }, urgency: "urgent", person_id: ID(5), name: "Ngozi", roles: ["leader"] },
        { id: "x", at: "now", template: "welcome" },
        { id: ID(3), template: "welcome" },
      ],
      more: true,
      replies: [{ at: "2026-10-19T08:00:00Z", action: "contact.opt_out", channel: "whatsapp" }, { action: "x" }],
    })!;
    expect(r.messages.map((m) => m.template)).toEqual(["care_urgent", "welcome"]);
    expect(r.messages[0].params).toBeNull();
    expect(r.messages[0].held).toBe("A care message.");
    expect(r.messages[1]).toMatchObject({ params: { first: "Ngozi" }, urgent: true, error: "No phone", personId: ID(5), roles: ["leader"] });
    expect(r.more).toBe(true);
    expect(r.replies).toHaveLength(1);
    expect(parseMessages({})).toBeNull();
  });

  it("reads chat opens, including one whose person was erased", () => {
    const c = parseChatOpens({ total: 2, opens: [{ id: 1, at: "2026-10-19T10:00:00Z", context: "welcome_call", opened_by: ID(1), opened_by_name: "Sade", opened_by_roles: ["coach"], person_id: ID(2), person_name: "Tobi" }, { id: 2, at: "2026-10-18T10:00:00Z", context: "x", person_id: null, person_name: null }, { id: "z" }] })!;
    expect(c.total).toBe(2);
    expect(c.opens).toHaveLength(2);
    expect(c.opens[1].personName).toBeNull();
    expect(contextWords("welcome_call")).toBe("welcome call");
    expect(contextWords("")).toBe("a chat");
    expect(parseChatOpens({ total: 1 })).toBeNull();
  });

  it("reads announcements", () => {
    const a = parseAnnouncements([{ id: ID(1), at: "2026-10-19T10:00:00Z", title: "Season starts", subject: "Come early", audience_label: "Everyone", status: "done", recipient_count: 42, created_by_name: "Pastor Ife" }, { id: "x" }, null]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ reached: 42, by: "Pastor Ife" });
    expect(parseAnnouncements("x")).toEqual([]);
  });

  it("says a reply in a line", () => {
    expect(replyLine({ at: "x", action: "contact.opt_out", outcome: null, channel: "whatsapp" })).toMatch(/Replied STOP on WhatsApp/);
    expect(replyLine({ at: "x", action: "checkin.by_reply", outcome: "not_yet", channel: "sms" })).toBe("Checked in by pressing a button on Text: not yet.");
    expect(replyLine({ at: "x", action: "checkin.by_reply", outcome: null, channel: null })).toBe("Checked in by pressing a button.");
  });
});

describe("the owner’s record of looking", () => {
  it("says each look in plain words, and nothing for any other kind", () => {
    expect(lookedLine("looked", "desks", null)).toBe("You looked at every desk");
    expect(lookedLine("looked", "desk", "pastor")).toBe("You looked at the pastor desk");
    expect(lookedLine("looked", "desk", "community_champion")).toBe("You looked at the community champion desk");
    expect(lookedLine("looked", "desk", "nonsense")).toBe("You looked at a desk");
    expect(lookedLine("looked", "conversations", null)).toMatch(/messages the platform has sent/);
    expect(lookedLine("looked", "person_conversation", ID(1))).toBe("You read the messages sent to one person");
    expect(lookedLine("looked", "chat_opens", null)).toMatch(/chats staff opened/);
    expect(lookedLine("unlock", null, null)).toBeNull();
  });
});
