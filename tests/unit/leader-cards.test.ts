import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEADER_CARD_ACT_ROLES, LEADER_CARD_ROLES } from "@/lib/auth/roles";
import {
  BOARD_OFF, CARD_WORDS, DAY_NAMES, FILTERS, HOW_WORDS, INVITE_WORDS, REMINDERS_OFF, SKIP_WORDS, agoWords, asFilter, bulkTargets, canResend, dayWords, hourWords, inviteLine,
  parseBoard, parseFailures, parseReminders, parseSheet, sheetCsv, skipWords, type BoardRow, type SheetRow,
} from "@/lib/leader-cards/cards";
import { AUDIENCE_KINDS, audienceLabel } from "@/lib/outreach/labels";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { LEADER_CARD_SAMPLES, LEADER_CARD_TEMPLATES } from "@/lib/messaging/templates-leader-cards";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// Leader cards (fix 5, fix 4). What these prove:
//   * what the screens read from the database is read defensively, and anything unclear means "not available"
//   * the words for each state, each filter and each reason are complete, and a bounced address is told in words the office can act on
//   * the two spreadsheets: the one for the heads of department never has a number or an address, the call sheet has both, and a spreadsheet cannot
//     run a name or a number as a formula
//   * the reminder email is kind, says where the card is, never blames, never carries a number, and is email only
//   * the roles on the page, the download and the database agree, and nothing but the sending service can call the heartbeat's function
//   * the announcement audience is offered to the office and described in words

const ROOT = join(__dirname, "../..");
const SITE = "https://unitedtribes.example";
const sql = readFileSync(join(ROOT, "supabase/migrations/20270110000100_leader_cards.sql"), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  personId: "p1", name: "Ben Ade", tribeId: "t1", tribe: "Ben’s tribe", state: "not_started", how: "appointed", department: null,
  invite: { state: "not_sent", reason: null, at: null, tries: 0 }, blocker: null, signedIn: false, lastActivity: null, reminders: 0, resends: 0, email: null, canChat: false, ...over,
});

describe("what the board reads", () => {
  const good = {
    role: "act", filter: "email_failed", total: 2, limit: 100, offset: 0, departments: ["Ushers", "Media"], reminders: { mode: "rehearsal" },
    counts: { all: 5, unfinished: 3, not_started: 1, in_progress: 1, changes_asked: 1, submitted: 1, approved: 1, email_failed: 2, never_signed_in: 3 },
    rows: [
      { person_id: "a", name: "Ben Ade", tribe_id: "t1", tribe: "Ben’s tribe", state: "not_started", how: "appointed", department: "Ushers",
        invite: { state: "failed", reason: "Mailbox is full", at: "2026-11-02T10:00:00Z", tries: 2 }, blocker: null, signed_in: false, last_activity: null,
        reminders: 1, resends: 2, email: "ben@example.org", can_chat: true },
      { person_id: "b", state: "no-such-state" },
      { name: "No id", state: "approved" },
    ],
  };

  it("reads a good answer and skips rows it cannot understand", () => {
    const b = parseBoard(good);
    expect(b.ok).toBe(true);
    expect(b.role).toBe("act");
    expect(b.filter).toBe("email_failed");
    expect(b.counts.unfinished).toBe(3);
    expect(b.departments).toEqual(["Ushers", "Media"]);
    expect(b.reminderMode).toBe("rehearsal");
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ personId: "a", state: "not_started", department: "Ushers", signedIn: false, resends: 2, canChat: true, email: "ben@example.org" });
    expect(b.rows[0].invite).toEqual({ state: "failed", reason: "Mailbox is full", at: "2026-11-02T10:00:00Z", tries: 2 });
  });

  it.each([null, undefined, 42, "text", [], {}, { role: "nobody" }, { rows: [] }])("treats %j as not available", (v) => {
    expect(parseBoard(v)).toEqual(BOARD_OFF);
  });

  it("never invents a number, an address or a yes", () => {
    const b = parseBoard({ role: "look", rows: [{ person_id: "a", state: "approved" }] });
    expect(b.rows[0]).toMatchObject({ email: null, canChat: false, signedIn: false, department: null });
    expect(b.rows[0].invite.state).toBe("not_sent");
    expect(b.reminderMode).toBe("off");
  });

  it("falls back to the default filter for one it does not know", () => {
    expect(asFilter("email_failed")).toBe("email_failed");
    expect(asFilter("everything")).toBe("unfinished");
    expect(asFilter(undefined)).toBe("unfinished");
  });
});

describe("the words", () => {
  it("has a word for every state, every invite state and every filter", () => {
    expect(Object.keys(CARD_WORDS).sort()).toEqual(["approved", "changes_asked", "in_progress", "not_started", "submitted"]);
    expect(Object.keys(INVITE_WORDS).sort()).toEqual(["failed", "not_sent", "sending", "sent"]);
    expect(FILTERS.map((f) => f.key)).toContain("email_failed");
    for (const f of FILTERS) {
      expect(f.label.length).toBeGreaterThan(3);
      expect(f.line.length).toBeGreaterThan(3);
    }
    expect(Object.keys(HOW_WORDS)).toEqual(["appointed", "applied"]);
  });

  it("says why the database held a leader back, in plain words, and passes an unknown reason through", () => {
    for (const reason of ["card_sent", "sent_three_times", "already_today", "bounced", "email_off", "deletion"]) expect(SKIP_WORDS[reason].length).toBeGreaterThan(8);
    expect(skipWords("bounced")).toBe("Their address bounces");
    expect(skipWords("something_new")).toBe("something_new");
  });

  it("says when, in days", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(agoWords(null, now)).toBe("Never");
    expect(agoWords("junk", now)).toBe("Never");
    expect(agoWords("2026-11-04T08:00:00Z", now)).toBe("Today");
    expect(agoWords("2026-11-03T08:00:00Z", now)).toBe("Yesterday");
    expect(agoWords("2026-11-01T08:00:00Z", now)).toBe("3 days ago");
  });

  it("writes one line about the email: sent and when, failed and why, never sent and why", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(inviteLine(row({ invite: { state: "sent", reason: null, at: "2026-11-02T08:00:00Z", tries: 1 } }), now)).toBe("Email sent 2 days ago");
    expect(inviteLine(row({ invite: { state: "failed", reason: "Mailbox is full", at: null, tries: 1 } }), now)).toBe("Did not arrive: Mailbox is full");
    expect(inviteLine(row({ invite: { state: "failed", reason: null, at: null, tries: 1 } }), now)).toBe("Did not arrive");
    expect(inviteLine(row({ blocker: "bounced" }), now)).toBe("Never sent: their address bounces");
    expect(inviteLine(row({ invite: { state: "sending", reason: null, at: null, tries: 1 } }), now)).toBe("Waiting to go");
  });

  it("describes the days and the hour", () => {
    expect(dayWords([4, 5, 6])).toBe("Thursday, Friday and Saturday");
    expect(dayWords([4])).toBe("Thursday");
    expect(DAY_NAMES).toHaveLength(7);
    expect(hourWords(9)).toBe("9 am");
    expect(hourWords(12)).toBe("12 pm");
    expect(hourWords(15)).toBe("3 pm");
  });
});

describe("who the buttons are for", () => {
  it("offers Send again to a leader who has not sent their card in and has been sent it fewer than three times", () => {
    expect(canResend(row())).toBe(true);
    expect(canResend(row({ state: "in_progress" }))).toBe(true);
    expect(canResend(row({ state: "submitted" }))).toBe(false);
    expect(canResend(row({ state: "approved" }))).toBe(false);
    expect(canResend(row({ resends: 3 }))).toBe(false);
  });

  it("picks, for the bulk button, those who have not started and whose email did not arrive", () => {
    const rows = [
      row({ personId: "a" }),
      row({ personId: "b", invite: { state: "failed", reason: "x", at: null, tries: 1 } }),
      row({ personId: "c", invite: { state: "sent", reason: null, at: "2026-11-01T00:00:00Z", tries: 1 } }),
      row({ personId: "d", state: "in_progress" }),
      row({ personId: "e", resends: 3 }),
      row({ personId: "f", state: "approved" }),
    ];
    expect(bulkTargets(rows).map((r) => r.personId)).toEqual(["a", "b"]);
  });
});

describe("the failures for Sending and email", () => {
  it("reads them, and an unclear answer is none", () => {
    const f = parseFailures({ count: 2, rows: [{ person_id: "a", name: "Chi", tribe: "T", state: "failed", reason: "Rejected", at: null }, { person_id: "b", state: "not_sent" }, { name: "x" }] });
    expect(f.count).toBe(2);
    expect(f.rows).toHaveLength(2);
    expect(f.rows[0]).toMatchObject({ name: "Chi", state: "failed", reason: "Rejected" });
    expect(f.rows[1]).toMatchObject({ name: "A leader", state: "not_sent", reason: null });
    expect(parseFailures(null)).toEqual({ count: 0, rows: [] });
  });
});

describe("the reminder setting", () => {
  it("reads it, and Off is the answer to anything unclear", () => {
    const r = parseReminders({ role: "act", mode: "on", days: [4, 6, 9, "x"], start_hour: 10, max_total: 8, reason: "Week one", paused: true, week: { sent: 4, would_send: 2, resent: 1 } });
    expect(r).toMatchObject({ role: "act", mode: "on", days: [4, 6], startHour: 10, maxTotal: 8, reason: "Week one", paused: true, week: { sent: 4, wouldSend: 2, resent: 1 } });
    expect(parseReminders(null)).toEqual(REMINDERS_OFF);
    expect(parseReminders({ mode: "always" }).mode).toBe("off");
    expect(parseReminders({ mode: "on", days: [] }).days).toEqual([4, 5, 6]);
  });
});

describe("the two spreadsheets", () => {
  const rows: SheetRow[] = [
    { department: "Ushers", name: "Ben Ade", tribe: "Ben’s tribe", how: "appointed", state: "not_started", invite: "failed", signedIn: false, lastActivity: null, phone: "+2348031234567", email: "ben@example.org", whatsappOk: true },
    { department: "", name: "=HYPERLINK(\"x\")", tribe: "Chi, “Chi” tribe", how: "applied", state: "approved", invite: "sent", signedIn: true, lastActivity: "2026-11-02T08:00:00Z", phone: "", email: "", whatsappOk: false },
  ];

  it("reads the database's rows", () => {
    expect(parseSheet(null)).toEqual([]);
    const r = parseSheet([{ department: "Ushers", name: "Ben", tribe: "T", how: "appointed", state: "approved", invite: "sent", signed_in: true, phone: "+234", whatsapp_ok: true }, 5]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ department: "Ushers", signedIn: true, phone: "+234", whatsappOk: true });
  });

  it("never puts a number or an address in the list for the heads of department, even if the rows carry them", () => {
    const csv = sheetCsv("hod", rows);
    expect(csv).not.toMatch(/\+234|@example|Phone|Email address|WhatsApp/);
    expect(csv.split("\r\n")[0]).toBe("﻿Department,Name,Tribe,How they came,Where their card is,Their email,Signed in,Last did something");
    expect(csv).toContain("Ushers,Ben Ade,Ben’s tribe,Appointed,Not started,Did not arrive,No,");
    expect(csv).toContain("No department yet");
  });

  it("puts the number and the address in the call sheet", () => {
    const csv = sheetCsv("call", rows);
    expect(csv.split("\r\n")[0]).toContain("Phone,Email address,Said yes to WhatsApp");
    // a number starts with + and a spreadsheet would run it as a formula, so it is kept as text
    expect(csv).toContain("'+2348031234567,ben@example.org,Yes");
  });

  it("cannot run a name as a formula, and quotes what needs quotes", () => {
    const csv = sheetCsv("hod", rows);
    expect(csv).toContain("'=HYPERLINK(\"\"x\"\")".replace(/^/, '"').replace(/$/, '"'));
    expect(csv).toContain('"Chi, “Chi” tribe"');
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("the email that reminds", () => {
  const message = (params: Params): ClaimedMessage => ({
    id: "00000000-0000-4000-8000-000000000009", template: "leader_card_reminder", channel: "email", params, urgency: "normal", attempts: 1, reply_token: null,
    to: { email: "ben@example.org", phone: "+2348031234567", name: "Ben Ade", first_name: "Ben" },
  });
  const KINDS = ["again", "thursday", "friday", "saturday", "weekly"];
  const STATES = ["not_started", "in_progress", "changes_asked"];

  it("is registered, email only, and queued by the database as email", () => {
    expect(LEADER_CARD_TEMPLATES.map((t) => t.key)).toEqual(["leader_card_reminder"]);
    expect(TEMPLATES.leader_card_reminder.emailOnly).toBe(true);
    expect(TEMPLATES.leader_card_reminder.audience).toBe("leader");
    expect([...code.matchAll(/enqueue_message\([^;]*?'leader_card_reminder'[\s\S]*?\);/g)]).toHaveLength(2);
    for (const m of code.matchAll(/enqueue_message\([^;]*?'leader_card_reminder'[\s\S]*?\);/g)) expect(m[0]).toMatch(/'normal', 'email'\)/);
  });

  it.each(KINDS.flatMap((k) => STATES.map((s) => [k, s])))("%s / %s: a short subject, the first name, where the card is, why it matters and one button to the card", (kind, state) => {
    const mail = renderEmail(message({ ...LEADER_CARD_SAMPLES.leader_card_reminder, kind, state }), SITE);
    expect(mail.subject.length).toBeGreaterThan(8);
    expect(mail.subject.length).toBeLessThan(60);
    expect(mail.text).toContain("Hi Ben,");
    expect(mail.text).toMatch(/Tribe Card/);
    expect(mail.text).toMatch(/A pastor reviews your card before members can see your tribe/);
    expect(mail.text).toContain(`${SITE}/lead/tribe`);
    for (const url of mail.text.match(/https?:\/\/\S+/g) ?? []) expect(url.startsWith(SITE)).toBe(true);
    expect(mail.text + mail.subject).not.toMatch(/undefined|null|NaN|\[object|\{\{/);
    expect(mail.text.length).toBeLessThan(1500);
    if (state === "changes_asked") expect(mail.text).toMatch(/asked for a few changes/);
    if (state === "in_progress") expect(mail.text).toMatch(/You have started your Tribe Card/);
    if (state === "not_started") expect(mail.text).toMatch(/not started your Tribe Card yet/);
  });

  it("never blames, never presses, never invents a deadline and never carries a number or an address", () => {
    for (const kind of KINDS) {
      for (const state of STATES) {
        const mail = renderEmail(message({ ...LEADER_CARD_SAMPLES.leader_card_reminder, kind, state }), SITE);
        expect(mail.text).not.toMatch(/you (forgot|failed|should have|must|have to)|late|overdue|required|compulsory|deadline|last chance|urgent|final/i);
        expect(mail.text).not.toMatch(/\+?\d[\d\s-]{7,}/);
        expect(mail.text).not.toMatch(/@(?!unitedtribes)/);
      }
    }
  });

  it("says the first email may not have arrived, once, and says how they came to lead", () => {
    const appointed = renderEmail(message({ tribe: "Ben’s tribe", state: "not_started", kind: "again", how: "appointed" }), SITE).text;
    expect(appointed).toMatch(/appointed you to lead Ben’s tribe/);
    expect(appointed).toMatch(/our first email did not reach you/);
    const applied = renderEmail(message({ tribe: "Ben’s tribe", state: "not_started", kind: "again", how: "applied" }), SITE).text;
    expect(applied).toMatch(/application to lead was approved/);
    expect(applied.match(/first email/g)).toHaveLength(1);
    const thursday = renderEmail(message({ state: "not_started", kind: "thursday", how: "appointed" }), SITE).text;
    expect(thursday).not.toMatch(/first email/);
  });

  it("gives Thursday, Friday and Saturday different openings and the same message", () => {
    const text = (kind: string) => renderEmail(message({ ...LEADER_CARD_SAMPLES.leader_card_reminder, kind }), SITE);
    const [thu, fri, sat] = [text("thursday"), text("friday"), text("saturday")];
    expect(new Set([thu.subject, fri.subject, sat.subject]).size).toBe(3);
    for (const m of [thu, fri, sat]) expect(m.text).toMatch(/not started your Tribe Card yet/);
  });

  it("still renders when the database sends nothing at all", () => {
    const mail = renderEmail(message({}), SITE);
    expect(mail.subject.length).toBeGreaterThan(5);
    expect(mail.subject + mail.text).not.toMatch(/undefined|null|NaN|\[object/);
  });
});

describe("the roles", () => {
  it("lets the admin, a director and a pastor act, and the data lead look, in the page, the download and the database", () => {
    expect([...LEADER_CARD_ACT_ROLES].sort()).toEqual(["admin", "director", "pastor"]);
    expect([...LEADER_CARD_ROLES].sort()).toEqual(["admin", "data_lead", "director", "pastor"]);
    expect(code).toMatch(/has_any_role\(array\['admin', 'director', 'pastor'\]::public\.app_role\[\]\)\s+then 'act'/);
    expect(code).toMatch(/has_any_role\(array\['data_lead'\]::public\.app_role\[\]\)\s+then 'look'/);
    expect(read("src/app/(app)/admin/people/leader-cards/page.tsx")).toContain("requireRole(LEADER_CARD_ROLES");
    const route = read("src/app/(app)/admin/people/leader-cards/download/route.ts");
    expect(route).toMatch(/kind === "call" \? LEADER_CARD_ACT_ROLES : LEADER_CARD_ROLES/);
    expect(read("src/lib/admin/nav.ts")).toMatch(/href: "\/admin\/people\/leader-cards"[\s\S]*?roles: LEADER_CARD_ROLES/);
  });

  it("makes every function who-may-call-it explicit: internal ones to nobody, screens to signed-in people, the heartbeat's only to the sending service", () => {
    const grants = [...code.matchAll(/\bgrant execute on function([\s\S]*?);/g)].map((m) => m[0]);
    const toAuth = grants.filter((g) => /to authenticated/.test(g)).join("\n");
    const toAnon = grants.filter((g) => /to anon/.test(g)).join("\n");
    for (const f of ["leader_cards_board", "leader_card_department_set", "leader_cards_resend", "leader_cards_failures", "leader_cards_sheet", "leader_card_reminders_get", "leader_card_reminders_set"]) {
      expect(toAuth, f).toContain(`public.${f}(`);
      expect(toAnon, f).not.toContain(f);
    }
    expect(toAnon).toContain("worker_leader_card_reminders(text)");
    for (const f of ["leader_card_rows", "leader_card_invite_of", "leader_last_activity", "leader_card_reminders_run", "leader_cards_role", "leader_card_state"]) {
      expect(toAuth, f).not.toContain(f);
      expect(toAnon, f).not.toContain(f);
    }
    expect(code).toMatch(/revoke execute on function[\s\S]*?leader_card_reminders_run\(\)[\s\S]*?from public, anon, authenticated;/);
  });

  it("keeps the three tables closed to everyone but the functions", () => {
    for (const t of ["leader_departments", "leader_card_settings", "leader_card_log"]) {
      expect(code).toMatch(new RegExp(`alter table public\\.${t} enable row level security;\\s+revoke all on table public\\.${t} from public, anon, authenticated;`));
    }
  });

  it("holds each function that reads a person to a role check before it reads anything", () => {
    for (const f of ["leader_cards_board", "leader_card_department_set", "leader_cards_resend", "leader_cards_failures", "leader_cards_sheet", "leader_card_reminders_get", "leader_card_reminders_set"]) {
      const start = code.indexOf(`create function public.${f}(`);
      const body = code.slice(start, code.indexOf("\n$$;", start));
      expect(body, f).toMatch(/(auth\.uid\(\)|uid) is null/);
      expect(body, f).toMatch(/leader_cards_role\(\)/);
    }
  });
});

describe("the reminders are a new function that starts Off and respects the Master pause", () => {
  it("starts Off, with Thursday, Friday and Saturday at nine and twelve in all", () => {
    expect(code).toMatch(/reminder_mode text not null default 'off'/);
    expect(code).toMatch(/days smallint\[\] not null default array\[4, 5, 6\]/);
    expect(code).toMatch(/start_hour smallint not null default 9/);
    expect(code).toMatch(/max_total smallint not null default 12/);
  });

  it("does nothing when Off or when the Master pause is on, and writes the log before it counts", () => {
    const run = code.slice(code.indexOf("create function public.leader_card_reminders_run()"), code.indexOf("create function public.worker_leader_card_reminders"));
    expect(run).toMatch(/if s\.reminder_mode = 'off' then\s+return/);
    expect(run).toMatch(/feature_master m where m\.id\), true\) then/);
    expect(run).toMatch(/send_window_ok\('reminder'\)/);
    expect(run).toMatch(/message_blocker\(r\.person_id\) is not null or public\.reminder_stopped\(r\.person_id, 'reminders'\)/);
    expect(run).toMatch(/'would_send'/);
  });

  it("never uses the ordinary-number route or any channel but email (decision 19)", () => {
    expect(code).not.toMatch(/baileys|whatsapp_hand|chat_open\(|'whatsapp'\s*\)\s*;?\s*--/i);
    for (const m of code.matchAll(/enqueue_message\(([\s\S]*?)\);/g)) expect(m[1]).toContain("'email'");
  });
});

describe("the announcement audience", () => {
  it("is offered, described in words, and left out of the community narrowing", () => {
    expect(AUDIENCE_KINDS.map((k) => k.kind)).toContain("leader_cards");
    expect(audienceLabel({ kind: "leader_cards" })).toBe("Leaders whose Tribe Card is not finished");
    expect(read("src/components/outreach/AudiencePicker.tsx")).toMatch(/withCommunity = \["everyone", "started", "finished_no_tribe", "in_tribe", "cannot_reach", "placed_waiting"\]/);
  });
});

describe("the office guide and the pages around it", () => {
  it("has a guide for the page, registered, with a code of its own", () => {
    const catalogue = read("src/lib/guides/catalogue.ts");
    expect(catalogue).toContain("leaderCards");
    expect(read("src/lib/guides/context.ts")).toMatch(/prefix: "\/admin\/people\/leader-cards", slug: "leader-cards"/);
    expect(read("src/lib/guides/content/leader-cards.ts")).toContain('code: "A5"');
    expect(existsSync(join(ROOT, "docs/LEADER-CARDS.md"))).toBe(true);
  });

  it("puts the page before the broader People help line, so the right guide is offered", () => {
    const ctx = read("src/lib/guides/context.ts");
    expect(ctx.indexOf('"/admin/people/leader-cards"')).toBeLessThan(ctx.indexOf('{ prefix: "/admin/people", slug'));
  });

  it("lists the failed sends on Sending and email, and says why the Contact gaps button can be missing", () => {
    const system = read("src/app/(app)/admin/system/page.tsx");
    expect(system).toContain("loadFailures");
    expect(system).toContain("Leaders who did not get their Tribe Card email");
    expect(read("src/app/(app)/admin/people/contact-gaps/page.tsx")).toContain("gaps-write-why");
  });
});
