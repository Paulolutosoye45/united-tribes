import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({ calls: [] as { fn: string; args: Record<string, unknown> }[], answers: {} as Record<string, unknown> }));
vi.mock("@/lib/messaging/worker", async (original) => {
  const real = await original<typeof import("@/lib/messaging/worker")>();
  return {
    ...real,
    workerRpc: () => async (fn: string, args: Record<string, unknown> = {}) => {
      db.calls.push({ fn, args });
      const answer = db.answers[fn];
      if (answer instanceof Error) return { data: null, error: { message: answer.message, code: "XX000" } };
      return { data: answer ?? null, error: null };
    },
  };
});

import { GET, POST } from "@/app/api/email/unsubscribe/route";
import { announcementSpec, fieldValues, fill, leaderProgress, memberProgress, previewDocument, wordingProblem } from "@/lib/outreach/compose";
import { designedHtml, designedText, safeHref, type DesignSpec } from "@/lib/outreach/email-design";
import { ASKS, STARTERS, audienceLabel } from "@/lib/outreach/labels";
import { reminderPreview, SAMPLE_DATA, unsubscribeHeaders } from "@/lib/outreach/templates";
import { parseEmailEvent } from "@/lib/messaging/inbound";
import { renderEmail } from "@/lib/messaging/render";
import type { ClaimedMessage } from "@/lib/messaging/types";
import { sampleParams } from "./fixtures/message-params";

const SITE = "https://unitedtribes.example";
const CHURCH = { name: "The Covenant Nation", address: "Km 10, Idiroko Road, Ota" };
const TOKEN = "ab".repeat(32);

function msg(template: string, params: Record<string, unknown> = sampleParams(template)): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001", template, channel: "email", params, urgency: "normal", attempts: 1, reply_token: null,
    to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" },
  };
}

describe("name fields and wording", () => {
  it("fills what it knows and removes what it does not, never leaving braces", () => {
    const v = fieldValues({ first_name: "Ada", tribe: "Builders Tribe", seats_left: 3 }, null, SITE);
    expect(fill("Hi {first_name}, {tribe} has {seats_left} seats. {nonsense}", v)).toBe("Hi Ada, Builders Tribe has 3 seats.");
    expect(fill("Applications close soon. {close_line}", v)).toBe("Applications close soon.");
  });

  it("falls back to kind words when the facts are missing", () => {
    const v = fieldValues({}, null, SITE);
    expect(v.first_name).toBe("friend");
    expect(v.tribe).toBe("your tribe");
    expect(v.season_starts).toBe("soon");
    expect(v.meets).toBe("at the time your leader shared");
  });

  it("writes when a tribe meets in a phrase", () => {
    const v = fieldValues({ meeting_day: 3, meeting_time: "20:00", mode: "online" }, "in_tribe", SITE);
    expect(v.meets).toBe("Wednesdays at 8:00 pm, online");
    expect(fieldValues({ meeting_day: 6, meeting_time: "09:30", mode: "in_person", place_note: "Hall B" }, "in_tribe", SITE).meets).toBe("Saturdays at 9:30 am, in person (Hall B)");
  });

  it("says what is wrong with wording, as the database does", () => {
    expect(wordingProblem("Hello {first_name}")).toBeNull();
    expect(wordingProblem("Visit https://example.com")).toMatch(/Links can’t go in the words/);
    expect(wordingProblem("Hi {nickname}")).toMatch(/isn’t a name field/);
    expect(wordingProblem("Hi {leader_first}")).toMatch(/only be used in the automatic reminders/);
    expect(wordingProblem("Hi {first_name")).toMatch(/curly bracket/);
  });
});

describe("progress through a form", () => {
  it("shows the shield and an honest time left for a member", () => {
    const early = memberProgress("name")!;
    const late = memberProgress("contact")!;
    expect(early.percent).toBeLessThan(late.percent);
    expect(early.section).toBe("About you");
    expect(late.minutes).toBeLessThanOrEqual(early.minutes);
    expect(memberProgress("review")!.percent).toBe(100);
    expect(memberProgress("extras")!.section).toBe("Your rhythm");
    expect(memberProgress("nonsense")).toBeNull();
  });

  it("does the same for a leader application", () => {
    const p = leaderProgress("obstacles")!;
    expect(p.section).toBe("Your calling");
    expect(p.partsLeft).toBeGreaterThan(5);
    expect(leaderProgress("review")!.fills).toEqual([1, 1, 1, 1]);
  });
});

describe("the designed email", () => {
  const spec: DesignSpec = {
    subject: "You’re part-way", preheader: "Your answers are saved.", greeting: "Hi Ada,", paragraphs: ["One.", "Two <b>bold</b> & more."],
    hero: { kind: "progress", progress: memberProgress("community")!, label: "Your form" },
    button: { label: "Carry on", url: `${SITE}/e/${TOKEN}` },
    options: [{ label: "Not this season", url: `${SITE}/e/${"cd".repeat(32)}` }, { label: "Bad", url: "javascript:alert(1)" }],
    church: CHURCH, why: "You are getting this because you started.", stopLabel: "Stop these reminders", stopUrl: `${SITE}/e/${TOKEN}`, prefsUrl: `${SITE}/e/${TOKEN}`,
  };

  it("has a hidden preview line, a button that works in Outlook, a dark mode and a postal address", () => {
    const html = designedHtml(spec);
    expect(html).toContain("Your answers are saved.");
    expect(html).toContain("v:roundrect");
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("Km 10, Idiroko Road, Ota");
    expect(html).toContain("Stop these reminders");
    expect(html).toContain("% there");
    expect(html).toMatch(/max-width:520px/);
  });

  it("escapes anything written into it, and drops links that are not https", () => {
    const html = designedHtml(spec);
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; more.");
    expect(html).not.toContain("javascript:");
    expect(safeHref("http://evil.example/x")).toBe("");
    expect(safeHref("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(safeHref("https://ok.example/x")).toBe("https://ok.example/x");
  });

  it("has a plain-text twin with every link and the address", () => {
    const text = designedText(spec);
    expect(text).toContain(`Carry on: ${SITE}/e/${TOKEN}`);
    expect(text).toContain("Not this season:");
    expect(text).not.toContain("javascript:");
    expect(text).toContain("The Covenant Nation, Km 10");
    expect(text).toMatch(/\d+% there/);
  });

  it("switches links off in the office preview", () => {
    expect(previewDocument(spec)).toContain("a{pointer-events:none}");
  });
});

describe("reminder and announcement emails", () => {
  const links = { go: "11".repeat(32), stop: "12".repeat(32), prefs: "13".repeat(32), help_finish: "14".repeat(32), not_season: "15".repeat(32) };
  const reminder = (over: Record<string, unknown>) => ({
    kind: "reminder", links, church: CHURCH,
    copy: { journey: "member_form", step: 1, tone: "warm", subject: "You’re part-way to your tribe, {first_name}", paragraphs: ["Saved.", "Five more minutes."], button_label: "Carry on where I stopped", actions: [] },
    data: { first_name: "Ada", step: "story", erase_date: "9 March 2027" },
    ...over,
  });

  it("brings people back through their own link, with a progress shield and the saved note", () => {
    const m = renderEmail(msg("reminder_email", reminder({})), SITE);
    expect(m.subject).toBe("You’re part-way to your tribe, Ada");
    expect(m.html).toContain(`${SITE}/e/${links.go}`);
    expect(m.html).toContain("Your answers are saved exactly as you left them.");
    expect(m.html).toContain("% there");
    expect(m.text).toContain(`Carry on where I stopped: ${SITE}/e/${links.go}`);
    expect(m.html).not.toMatch(/\{[a-z_]+\}/);
  });

  it("carries the one-click unsubscribe headers every mail program understands", () => {
    const m = renderEmail(msg("reminder_email", reminder({})), SITE);
    expect(m.headers).toEqual({
      "List-Unsubscribe": `<${SITE}/api/email/unsubscribe?t=${links.stop}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(unsubscribeHeaders(`${SITE}/`, "x".repeat(64))["List-Unsubscribe"]).toContain("/api/email/unsubscribe?t=");
  });

  it("offers the ways out at the foot of the last email, each through its own page", () => {
    const last = reminder({ copy: { journey: "member_form", step: 4, tone: "honest", subject: "Your answers will be cleared on {erase_date}", paragraphs: ["Last one."], button_label: "Finish my form", actions: ["help_finish", "not_season"] } });
    const m = renderEmail(msg("reminder_email", last), SITE);
    expect(m.subject).toBe("Your answers will be cleared on 9 March 2027");
    expect(m.html).toContain(ASKS.help_finish.label);
    expect(m.html).toContain(`${SITE}/e/${links.not_season}`);
    expect(m.text).toContain("Not this season");
  });

  it("shows the best-matching tribe and the next gathering where they help", () => {
    const tribe = renderEmail(msg("reminder_email", reminder({
      copy: { journey: "no_tribe", step: 3, tone: "encouraging", subject: "{tribe_1} still has a seat for you", paragraphs: ["Your best match, {tribe_1}, led by {leader_first}, has {seats_left} seats left."], button_label: "Choose my tribe", actions: [] },
      data: SAMPLE_DATA.no_tribe,
    })), SITE);
    expect(tribe.subject).toBe("Builders Tribe still has a seat for you");
    expect(tribe.html).toContain("3 seats left");
    expect(tribe.html).toContain("Your best match");
    const gather = renderEmail(msg("reminder_email", reminder({
      copy: { journey: "in_tribe", step: 3, tone: "encouraging", subject: "Your tribe saved you a seat", paragraphs: ["Come on {next_meeting}."], button_label: "See my tribe", actions: [] },
      data: SAMPLE_DATA.in_tribe,
    })), SITE);
    expect(gather.html).toContain("Your next gathering");
    expect(gather.html).toContain("Wednesday 17 February");
  });

  it("writes an announcement with each person’s own details and its own unsubscribe", () => {
    const m = renderEmail(msg("office_message", {
      kind: "announcement", links, church: CHURCH,
      copy: { subject: "Your tribe is waiting, {first_name}", paragraphs: ["Season starts {season_starts}."], button_label: "Carry on", actions: [], tone: "office", step: 0 },
      data: { first_name: "Ada", tribe: "your tribe", season_starts: "14 February 2027", my_page: "/home" },
    }), SITE);
    expect(m.subject).toBe("Your tribe is waiting, Ada");
    expect(m.html).toContain("Season starts 14 February 2027.");
    expect(m.html).toContain("Stop announcements");
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("never leads anywhere off-site: a missing or short token gives no button", () => {
    const m = renderEmail(msg("reminder_email", reminder({ links: { go: "short", stop: "short", prefs: "short" } })), SITE);
    expect(m.html).not.toContain(`${SITE}/e/short`);
    expect(m.headers).toBeUndefined();
  });

  it("survives a half-written message", () => {
    const m = renderEmail(msg("reminder_email", {}), SITE);
    expect(m.subject.length).toBeGreaterThan(3);
    expect(m.html).not.toMatch(/undefined|NaN|\{[a-z_]+\}/);
  });

  it("builds the office preview for every one of the sixteen kinds of email with no gaps", () => {
    for (const journey of Object.keys(SAMPLE_DATA)) {
      for (let step = 1; step <= 4; step++) {
        const spec = reminderPreview({ journey, step, tone: "warm", subject: "Hello {first_name}", paragraphs: ["A {tribe}, {leader_first}, {meets}, {parts_left}, {minutes_left}, {close_line}, {seats_left}, {next_meeting}"], button_label: "Go", actions: step === 4 ? ["not_season"] : [] }, SITE, CHURCH);
        expect(designedHtml(spec)).not.toMatch(/\{[a-z_]+\}|undefined|NaN/);
      }
    }
  });
});

describe("announcement preview", () => {
  it("fills the writer’s words for one person and keeps links dead", () => {
    const spec = announcementSpec({ subject: "Hi {first_name}", paragraphs: ["{tribe} starts {season_starts}"], button_label: "Open", button_target: "/home" }, { first_name: "Sade", tribe: "Pillars", season_starts: "1 March 2027", my_page: "/home" }, SITE, CHURCH);
    expect(spec.subject).toBe("Hi Sade");
    expect(spec.paragraphs).toEqual(["Pillars starts 1 March 2027"]);
    expect(spec.button?.url).toBe(`${SITE}/e/preview`);
  });

  it("every starting note passes the wording rules", () => {
    for (const s of STARTERS) {
      for (const t of [s.subject, ...s.paragraphs, s.button_label ?? ""]) expect(wordingProblem(t), `${s.id}: ${t}`).toBeNull();
    }
  });

  it("describes a rule in a sentence", () => {
    expect(audienceLabel({ kind: "started", idle_days: 7 })).toBe("Started the form, not finished (quiet for 7+ days)");
    expect(audienceLabel({ kind: "staff", roles: ["coach", "care_lead"] })).toBe("Team members (coaches, care leads)");
    expect(audienceLabel({ kind: "everyone" })).toBe("Everyone");
  });
});

describe("the unsubscribe address", () => {
  beforeEach(() => {
    db.calls.length = 0;
    db.answers = {};
    vi.stubEnv("WORKER_TOKEN", "w".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  });
  afterEach(() => vi.unstubAllEnvs());
  const url = (t: string | null) => `${SITE}/api/email/unsubscribe${t === null ? "" : `?t=${t}`}`;

  it("ends the email on a POST from the mail program, with no questions", async () => {
    db.answers.worker_unsubscribe_oneclick = true;
    const res = await POST(new Request(url(TOKEN), { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(res.status).toBe(200);
    expect(db.calls).toEqual([{ fn: "worker_unsubscribe_oneclick", args: { p_link: TOKEN } }]);
  });

  it("answers 410 for a link that is spent or expired, and 400 for rubbish", async () => {
    db.answers.worker_unsubscribe_oneclick = false;
    expect((await POST(new Request(url(TOKEN), { method: "POST" }))).status).toBe(410);
    expect((await POST(new Request(url("nope"), { method: "POST" }))).status).toBe(400);
    expect((await POST(new Request(url(null), { method: "POST" }))).status).toBe(400);
  });

  it("never unsubscribes anyone on a plain visit, because scanners fetch every link", async () => {
    const res = await GET(new Request(url(TOKEN)));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SITE}/e/${TOKEN}`);
    expect(db.calls).toEqual([]);
    expect((await GET(new Request(url("bad")))).headers.get("location")).toBe(`${SITE}/`);
  });
});

describe("bounces and complaints from the email provider", () => {
  it("keeps a hard bounce and a complaint as signals, and a soft bounce as only a failure", () => {
    expect(parseEmailEvent({ type: "email.bounced", data: { email_id: "e1", bounce: { type: "Permanent" } } })).toMatchObject({ signal: "hard_bounce" });
    expect(parseEmailEvent({ type: "email.bounced", data: { email_id: "e1", bounce: { type: "Transient" } } })?.signal).toBeUndefined();
    expect(parseEmailEvent({ type: "email.complained", data: { email_id: "e2", to: ["a@b.org"] } })).toMatchObject({ signal: "complaint", optOutEmail: "a@b.org" });
  });
});
