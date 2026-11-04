import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GAP_REPORT_OFF, gapsCsv, parseGapExport, parseGapReport } from "@/lib/contact-gaps/gaps";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import {
  ADD_NUMBER_WORDS,
  SERIES_FILTERS,
  SERIES_STATES,
  STRIP_OFF,
  STRIP_WORDS,
  isReachLink,
  parsePageInfo,
  parsePlacedReach,
  parseReachSettings,
  parseSeriesCounts,
  parseSeriesOf,
  parseSeriesStats,
  parseTribeStrip,
  seriesWords,
} from "@/lib/reach/series";

// The contact series and the tribe note (Package 5): the three emails, what the screens read from the database, and what they say.

const SITE = "https://unitedtribes.example";
const SECRET = "a1".repeat(32);
const ROOT = path.resolve(__dirname, "../..");

function mail(template: string, params: Params, token: string | null = SECRET): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: token,
    to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Okafor", first_name: "Ada" },
  };
}
const series = (over: Params = {}, token: string | null = SECRET) =>
  renderEmail(mail("reach_series", { n: 1, kind: "no_number", leader_first: "Grace", tribe: "Builders Tribe", has_group: false, release_on: false, ...over }, token), SITE);

describe("the four emails of the series", () => {
  it("each opens the person's own page, with the secret from the message, and the plain version says so too", () => {
    for (const n of [1, 2, 3, 4]) {
      for (const kind of ["no_number", "no_yes"]) {
        const e = series({ n, kind });
        expect(e.html, `${n} ${kind}`).toContain(`${SITE}/add-number/${SECRET}`);
        expect(e.text).toContain(`${SITE}/add-number/${SECRET}`);
        expect(e.subject.length).toBeLessThanOrEqual(60);
        expect(e.subject).not.toMatch(/[!?]{2}|FREE|URGENT/i);
      }
    }
  });

  it("falls back to the signed-in profile when the private link has been forgotten, and never builds a page from a wrong-looking secret", () => {
    expect(series({ n: 2 }, null).html).toContain(`${SITE}/profile`);
    expect(series({ n: 2 }, null).html).not.toContain("/add-number/");
    expect(series({ n: 2 }, "not-a-secret").html).not.toContain("/add-number/");
  });

  it("speaks as the leader in emails 1 and 3 and as the church in 2 and 4, and signs 1 and 3 with the leader's name and tribe", () => {
    const one = series({ n: 1 });
    const three = series({ n: 3 });
    expect(one.text).toContain("Grace");
    expect(one.text).toMatch(/Grace\s*\nBuilders Tribe/);
    expect(three.subject).toContain("Grace");
    expect(three.text).toMatch(/Grace\s*\nBuilders Tribe/);
    expect(series({ n: 2 }).text).not.toMatch(/Grace\s*\nBuilders Tribe/);
    expect(series({ n: 4 }).text).not.toMatch(/Grace\s*\nBuilders Tribe/);
  });

  it("quotes the leader's own line in email 1 only, and puts the words that introduce it right above it", () => {
    const e = series({ n: 1, line: "Please do it today, it really helps me." });
    expect(e.text).toContain("---\nPlease do it today, it really helps me.\n---");
    expect(e.text.indexOf("Grace adds:")).toBeLessThan(e.text.indexOf("---\nPlease do it"));
    expect(series({ n: 1 }).text).not.toContain("adds:");
    expect(series({ n: 2, line: "Please do it today" }).text).not.toContain("Please do it today");
    expect(series({ n: 3, line: "Please do it today" }).text).not.toContain("Please do it today");
  });

  it("escapes whatever the leader or the member wrote", () => {
    const e = series({ n: 1, line: "<script>alert(1)</script> & more", leader_first: "<b>Grace</b>", tribe: "\"><img src=x>" });
    expect(e.html).not.toMatch(/<script>|<img src=x|<b>Grace/);
    expect(e.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });

  it("says what is missing in the right words: no number, or a number without the yes", () => {
    expect(series({ n: 1, kind: "no_number" }).text).toMatch(/we have no number for you/);
    expect(series({ n: 1, kind: "no_number" }).html).toContain("Add my number");
    expect(series({ n: 1, kind: "no_yes" }).text).toMatch(/WhatsApp is not ticked/);
    expect(series({ n: 1, kind: "no_yes" }).html).toContain("Tick WhatsApp");
    expect(series({ n: 1, kind: "no_yes" }).text).not.toMatch(/we have no number/);
  });

  it("says who can see a number, that the choice is theirs, and how to ask to be emailed, in every email", () => {
    for (const n of [1, 2, 3, 4]) {
      const t = series({ n }).text;
      expect(t, `${n}`).toMatch(/Only your tribe’s leader, their assistant and your coach can see your number, and only if you tick WhatsApp/);
      expect(t, `${n}`).toMatch(/Other members never see it/);
      expect(t, `${n}`).toMatch(/Email me instead|emailed/);
    }
    expect(series({ n: 4 }).text).toContain("Email me instead:");
    expect(series({ n: 4 }).text).toContain("last of four");
  });

  it("never carries a phone number, never blames, never names another member, and says nothing about what happens at the end while the end does nothing", () => {
    for (const n of [1, 2, 3, 4]) {
      for (const kind of ["no_number", "no_yes"]) {
        const e = series({ n, kind, release_on: false });
        expect(e.text).not.toMatch(/\+?\d{9,}/);
        expect(e.text).not.toMatch(/your fault|you failed|you must|you have to|removed|taken out|lose your place|your place/i);
        expect(e.text).not.toMatch(/!/);
      }
    }
  });

  it("survives a half-filled message", () => {
    const e = renderEmail(mail("reach_series", {}, null), SITE);
    expect(e.subject.length).toBeGreaterThan(3);
    expect(e.text).not.toMatch(/undefined|NaN|\[object|\{\{|\bnull\b/);
    const odd = renderEmail(mail("reach_series", { n: "9", kind: 5, leader_first: null, tribe: 3 }, null), SITE);
    expect(odd.text).not.toMatch(/undefined|NaN|\[object|\bnull\b/);
  });

  it("is an email-only message everywhere it is listed", () => {
    for (const k of ["reach_series", "reach_new_link", "tribe_note"]) {
      expect(TEMPLATES[k], k).toBeDefined();
      expect(TEMPLATES[k].emailOnly).toBe(true);
    }
  });
});

describe("the new-link email", () => {
  it("sends a fresh link for thirty days, only theirs, with the same sentence about who can see a number", () => {
    const e = renderEmail(mail("reach_new_link", { leader_first: "Grace" }), SITE);
    expect(e.html).toContain(`${SITE}/add-number/${SECRET}`);
    expect(e.text).toContain("thirty days");
    expect(e.text).toMatch(/Other members never see it/);
    expect(e.subject).toBe("Your new link");
  });
});

describe("the tribe note", () => {
  const note = (over: Params = {}, token: string | null = SECRET) =>
    renderEmail(mail("tribe_note", { leader_first: "Grace", tribe: "Builders Tribe", body: "Hello, tribe.\nWe meet on Wednesday.\n\nBring a friend.", gap: null, ...over }, token), SITE);

  it("is the leader's words, a paragraph for each line, in the leader's name, and nothing added but a sign-off", () => {
    const e = note();
    expect(e.subject).toBe("A note from Grace (Builders Tribe)");
    expect(e.text).toContain("Hello, tribe.\n\nWe meet on Wednesday.\n\nBring a friend.");
    expect(e.text).toMatch(/Grace\s*\nBuilders Tribe/);
    expect(e.html).not.toContain("/add-number/");
    expect(e.text).not.toMatch(/add your number|tick whatsapp/i);
  });

  it("carries a button to add the number only for a member who still has a gap, and says which", () => {
    const a = note({ gap: "no_number" });
    expect(a.html).toContain("Add my number");
    expect(a.html).toContain(`${SITE}/add-number/${SECRET}`);
    expect(a.text).toMatch(/we have no number for you/);
    const b = note({ gap: "no_yes" });
    expect(b.html).toContain("Tick WhatsApp");
    expect(b.text).toMatch(/WhatsApp is not ticked/);
  });

  it("escapes what the leader typed, and keeps to twelve paragraphs", () => {
    const e = note({ body: "<script>x</script>\n" + Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") });
    expect(e.html).not.toContain("<script>x");
    expect(e.text).not.toContain("line 20");
  });

  it("survives a note with no words", () => {
    const e = note({ body: "" });
    expect(e.text).toContain("Grace has sent your tribe a note.");
  });
});

describe("what the private page reads", () => {
  it("only accepts a 64-character lower-case hex link", () => {
    expect(isReachLink(SECRET)).toBe(true);
    for (const bad of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), `${"a".repeat(63)}g`, null, undefined, 5, "../etc/passwd"]) expect(isReachLink(bad)).toBe(false);
  });

  it("reads the page's answer defensively: anything not clearly ours means 'this link isn't valid'", () => {
    for (const bad of [null, undefined, {}, { found: false }, "found", [], { found: "true" }]) expect(parsePageInfo(bad)).toBeNull();
    const ok = parsePageInfo({ found: true, state: "form", first: "Ada", leader_first: "Grace", tribe: "Builders", kind: "no_yes", number: "+234••••••••67", signin: "+234••••••••55" });
    expect(ok).toEqual({ state: "form", first: "Ada", leaderFirst: "Grace", tribe: "Builders", kind: "no_yes", number: "+234••••••••67", signin: "+234••••••••55" });
    expect(parsePageInfo({ found: true, state: "expired", first: "Ada" })).toMatchObject({ state: "expired", kind: null, number: null });
    expect(parsePageInfo({ found: true, state: "nonsense" })).toMatchObject({ state: "form", first: "Friend" });
  });

  it("reads the two boxes of the placement page, or none", () => {
    expect(parsePlacedReach({ gap: null })).toBeNull();
    expect(parsePlacedReach({ gap: "other" })).toBeNull();
    expect(parsePlacedReach(null)).toBeNull();
    expect(parsePlacedReach({ gap: "no_number", number: null, signin: "+234••••••••55" })).toEqual({ gap: "no_number", number: null, signin: "+234••••••••55" });
  });

  it("says what each state is in plain words, with the way to be emailed and the way to a new link", () => {
    expect(ADD_NUMBER_WORDS.noNumberBody("Grace", "Builders")).toContain("Grace cannot message you on WhatsApp yet");
    expect(ADD_NUMBER_WORDS.noYesBody("Grace", "+234••••••••67")).toContain("+234••••••••67");
    expect(ADD_NUMBER_WORDS.emailInstead).toBe("I would rather be emailed");
    expect(ADD_NUMBER_WORDS.newLink).toBe("Send me a new link");
    expect(ADD_NUMBER_WORDS.agree).toMatch(/leader, their assistant and my coach may message me on WhatsApp/);
  });
});

describe("what the leader's strip reads", () => {
  const on = {
    on: true,
    adults: 10,
    reachable: 6,
    people: [
      { person_id: "a", first_name: "Ada", status: "to_ask" },
      { person_id: "b", first_name: "Bola", status: "asked", email: 2, follow_up_used: false },
      { person_id: "c", first_name: "Chi", status: "follow_up", until: "2026-11-09T10:00:00Z" },
      { person_id: "d", first_name: "Dayo", status: "asked_out" },
      { person_id: "e", first_name: "Emeka", status: "nonsense" },
      { first_name: "NoId", status: "asked" },
    ],
    ask: { count: 1, names: ["Ada", 5, "Dayo"], next_at: null, can: true },
    note: { state: "on", limit: 2, used: 1, next_at: null, recipients: 9, can: true },
  };

  it("reads who is where, drops what it does not know, and keeps names only", () => {
    const s = parseTribeStrip(on);
    expect(s.on).toBe(true);
    expect(s.people.map((p) => [p.firstName, p.status])).toEqual([["Ada", "to_ask"], ["Bola", "asked"], ["Chi", "follow_up"], ["Dayo", "asked_out"]]);
    expect(s.people[1]).toMatchObject({ email: 2, followUpUsed: false });
    expect(s.ask).toEqual({ count: 1, names: ["Ada", "Dayo"], nextAt: null, can: true });
    expect(s.note).toMatchObject({ state: "on", limit: 2, used: 1, recipients: 9, can: true });
    expect(JSON.stringify(s)).not.toMatch(/\+\d{6,}|@/);
  });

  it("is Off for anything that is not clearly On, and still offers the note when only the note is On", () => {
    for (const bad of [null, undefined, {}, "on", [], { on: "true" }]) expect(parseTribeStrip(bad)).toEqual(STRIP_OFF);
    const noteOnly = parseTribeStrip({ on: false, note: { state: "rehearsal", limit: 2, used: 0, recipients: 4, can: true } });
    expect(noteOnly.on).toBe(false);
    expect(noteOnly.people).toEqual([]);
    expect(noteOnly.note).toMatchObject({ state: "rehearsal", can: true });
    // an Off note cannot be sent, whatever the database says
    expect(parseTribeStrip({ on: true, note: { state: "off", can: true } }).note.can).toBe(false);
  });

  it("says its words plainly", () => {
    expect(STRIP_WORDS.line(6, 10)).toBe("6 of 10 can be messaged on WhatsApp.");
    expect(STRIP_WORDS.askBody(1)).toMatch(/One member/);
    expect(STRIP_WORDS.askBody(3)).toMatch(/3 members/);
    expect(STRIP_WORDS.sent(1)).toBe("Done. One member has been emailed.");
    expect(STRIP_WORDS.lineMax).toBe(200);
    expect(STRIP_WORDS.noteMax).toBe(600);
    expect(STRIP_WORDS.statusLine.asked(2)).toBe("Email 2 of 4 sent");
  });
});

describe("what the office list reads", () => {
  const report = {
    state: "on",
    role: "act",
    counts: { no_number: 2 },
    adults: 20,
    total: 2,
    rows: [
      { person_id: "a", name: "Ada", tribe_id: "t", tribe: "T", leader: "G", cause: "no_number", asks: 0, last_asked: null, series: { state: "in_series", sends: 2, following_up: false, frozen: false } },
      { person_id: "b", name: "Bola", tribe_id: "t", tribe: "T", leader: "G", cause: "no_yes", asks: 1, last_asked: "2026-11-01T10:00:00Z", series: { state: "email_only", sends: 1 } },
      { person_id: "c", name: "Chi", tribe_id: "t", tribe: "T", leader: "G", cause: "made_up", asks: 0, last_asked: null },
      { person_id: "d", name: "Dayo", tribe_id: "t", tribe: "T", leader: "G", cause: "no_number", asks: 0, last_asked: null, series: { state: "weird" } },
    ],
    trend: [],
    limit: 100,
    offset: 0,
    series_counts: { in_series: 1, email_only: 1, silent: 3, weird: 9 },
    series_stats: { started: 5, running: 1, fixed: 2, email_only: 1, seen_not_done: 0, silent: 1, not_reached: 0, fixed_by: { before: 0, "1": 1, "2": 1, "3": 0, "4": 0 } },
    series_switch: "on",
    series_paused: true,
  };

  it("reads each person's stage, the counts, the stats and whether the series is paused", () => {
    const r = parseGapReport(report);
    expect(r.rows.map((x) => x.series.state)).toEqual(["in_series", "email_only", "not_in_series", "not_in_series"]);
    expect(r.rows[0].series).toEqual({ state: "in_series", sends: 2, followingUp: false, frozen: false });
    expect(r.seriesCounts).toMatchObject({ in_series: 1, email_only: 1, silent: 3, not_reached: 0 });
    expect(Object.keys(r.seriesCounts).sort()).toEqual([...SERIES_STATES].sort());
    expect(r.seriesStats).toMatchObject({ started: 5, running: 1, fixed: 2, emailOnly: 1 });
    expect(r.seriesStats.fixedBy).toEqual({ before: 0, "1": 1, "2": 1, "3": 0, "4": 0 });
    expect(r.seriesSwitch).toBe("on");
    expect(r.seriesPaused).toBe(true);
  });

  it("is as it was from a database that does not have the series: no stages, a series that is Off", () => {
    const old = parseGapReport({ ...report, series_counts: undefined, series_stats: undefined, series_switch: undefined, series_paused: undefined, rows: report.rows.slice(2, 3) });
    expect(old.rows[0].series.state).toBe("not_in_series");
    expect(old.seriesSwitch).toBe("off");
    expect(old.seriesPaused).toBe(false);
    expect(old.seriesStats.started).toBe(0);
    expect(GAP_REPORT_OFF.seriesSwitch).toBe("off");
  });

  it("puts a stage in words, and every stage the database can send has a filter", () => {
    expect(seriesWords({ state: "in_series", sends: 0, followingUp: false, frozen: false })).toBe("Waiting for the leader’s go");
    expect(seriesWords({ state: "in_series", sends: 3, followingUp: false, frozen: false })).toBe("Email 3 of 4 sent");
    expect(seriesWords({ state: "in_series", sends: 3, followingUp: true, frozen: false })).toBe("Leader is following up");
    expect(seriesWords({ state: "in_series", sends: 3, followingUp: false, frozen: true })).toBe("On hold");
    expect(seriesWords({ state: "silent", sends: 4, followingUp: false, frozen: false })).toBe("No answer");
    expect(SERIES_FILTERS.map((f) => f.key).sort()).toEqual([...SERIES_STATES].sort());
    expect(parseSeriesOf(null).state).toBe("not_in_series");
    expect(parseSeriesOf({ state: "in_series", sends: 99 }).sends).toBe(4);
    expect(parseSeriesCounts("x").in_series).toBe(0);
    expect(parseSeriesStats(undefined).started).toBe(0);
  });

  it("adds the two series columns to the download only when the database sent them, and still never a number", () => {
    const rows = parseGapExport([
      { name: "Ada", tribe: "T", leader: "G", cause: "no_number", asks: 0, last_asked: null, series: "in_series", emails: 2 },
      { name: "Bola", tribe: "T", leader: "G", cause: "no_yes", asks: 1, last_asked: "2026-11-01T10:00:00Z", series: "email_only", emails: 1 },
    ]);
    const lines = gapsCsv(rows).slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Tribe,Leader,Why a leader cannot reach them,Times asked,Last asked,Contact series,Series emails sent");
    expect(lines[1]).toBe("Ada,T,G,No number saved,0,,In the series,2");
    expect(lines[2]).toBe('Bola,T,G,"Number saved, WhatsApp not agreed",1,2026-11-01,Chose email,1');
    const old = gapsCsv(parseGapExport([{ name: "Ada", tribe: "T", leader: "G", cause: "no_number", asks: 0, last_asked: null }]));
    expect(old.slice(1).split("\r\n")[0]).toBe("Name,Tribe,Leader,Why a leader cannot reach them,Times asked,Last asked");
  });
});

describe("the owner's settings", () => {
  it("reads the numbers, and nothing if they are not there", () => {
    expect(parseReachSettings(null)).toBeNull();
    expect(parseReachSettings({ first_go_hours: "24" })).toBeNull();
    expect(parseReachSettings({ first_go_hours: 24, release_after_days: 6, end_mode: "list", note_per_week: 2, email_days: [0, 2, 4, 5], reason: "x" })).toEqual({
      firstGoHours: 24,
      releaseAfterDays: 6,
      endMode: "list",
      notePerWeek: 2,
      emailDays: [0, 2, 4, 5],
      reason: "x",
    });
  });
});

describe("the files themselves", () => {
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("opens the private page to someone who is not signed in, and keeps it out of search results", () => {
    expect(read("src/proxy.ts")).toContain('"/add-number"');
    const page = read("src/app/(public)/add-number/[token]/page.tsx");
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).toMatch(/referrer: "no-referrer"/);
    expect(page).toContain("await connection()");
  });

  it("never ticks the WhatsApp box for the member, and saves nothing when the page is only opened", () => {
    const page = read("src/app/(public)/add-number/[token]/page.tsx");
    expect(page).not.toMatch(/defaultChecked|checked=/);
    const placed = read("src/app/(public)/placed/[token]/page.tsx");
    expect(placed).not.toMatch(/defaultChecked/);
    expect(read("src/app/(public)/add-number/[token]/actions.ts")).toMatch(/formData\.get\("whatsapp"\) === "on"/);
  });

  it("checks the link as 64 hex characters before the database is asked, and never logs it", () => {
    const actions = read("src/app/(public)/add-number/[token]/actions.ts");
    expect(actions).toContain("isReachLink(token)");
    expect(actions).not.toMatch(/console\./);
    expect(read("src/app/(public)/placed/[token]/actions.ts")).not.toMatch(/console\./);
  });

  it("has the heartbeat call the series before it sends", () => {
    const route = read("src/app/api/cron/tick/route.ts");
    expect(route.indexOf('rpc("worker_reach_tick")')).toBeGreaterThan(0);
    expect(route.indexOf('rpc("worker_reach_tick")')).toBeLessThan(route.indexOf("await runDispatch"));
  });

  it("lets the owner see the two new switches", () => {
    expect(read("src/lib/features/types.ts")).toMatch(/"reach_series",\s*"tribe_note"/);
  });
});
