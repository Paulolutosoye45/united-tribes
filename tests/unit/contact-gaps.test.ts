import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_GAP_ACT_ROLES, CONTACT_GAP_ROLES } from "@/lib/auth/roles";
import {
  CAUSES, GAP_REPORT_OFF, REACH_GAPS_OFF, REACH_OFF, REACH_WORDS, askableCount, askedWords, causeLabel, gapCount, gapsCsv, parseGapExport, parseGapReport, parseReach, parseReachGaps,
} from "@/lib/contact-gaps/gaps";
import { AUDIENCE_KINDS, LEFT_OUT_REASONS, REACH_STARTERS, STARTERS, audienceLabel } from "@/lib/outreach/labels";
import { renderEmail } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { REACH_SAMPLES, REACH_TEMPLATES } from "@/lib/messaging/templates-reach";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// Contact gaps (fix 13): the members a leader cannot reach on WhatsApp. What these prove:
//   * what the screens read from the database is read defensively, and anything unclear means Off
//   * the list, the download and the leader's list never carry a phone number
//   * a spreadsheet cannot run a name as a formula
//   * the email to the member says who can see a number and that the choice is theirs, and never blames or names anyone else
//   * the announcement choice and its notes are worded so nobody is pressed

const SITE = "https://unitedtribes.example";
const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270106000100_contact_gaps.sql"), "utf8");
/** One function's text without its comments, from where it is created to where the next one is. */
const bodyOf = (from: string, to: string) =>
  sql
    .slice(sql.indexOf(`create function public.${from}`), sql.indexOf(`create function public.${to}`))
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

function message(params: Params): ClaimedMessage {
  return { id: "00000000-0000-4000-8000-000000000009", template: "contact_ask_leader", channel: "email", params, urgency: "normal", attempts: 1, reply_token: null, to: { email: "ada@example.org", phone: null, name: "Ada Okafor", first_name: "Ada" } };
}

describe("what the office list reads", () => {
  const good = {
    state: "on", role: "act", adults: 120, total: 2,
    counts: { unreachable: 1, no_number: 7, no_yes: 12, made_up: 2, not_open: 3, withheld: 4 },
    rows: [
      { person_id: "a", name: "Ada Okafor", tribe_id: "t1", tribe: "Builders Tribe", leader: "Grace", cause: "no_number", asks: 2, last_asked: "2026-11-01T10:00:00Z" },
      { person_id: "b", name: "Bola Ade", tribe_id: "t1", tribe: "Builders Tribe", leader: "Grace", cause: "no_yes", asks: 0, last_asked: null },
    ],
    trend: [{ day: "2026-11-02T00:00:00", counts: { no_number: 5 }, adults: 118 }],
    limit: 100, offset: 0,
  };

  it("reads a real answer", () => {
    const r = parseGapReport(good);
    expect(r.state).toBe("on");
    expect(r.role).toBe("act");
    expect(r.rows.map((x) => x.name)).toEqual(["Ada Okafor", "Bola Ade"]);
    expect(r.counts.no_yes).toBe(12);
    expect(r.trend[0].day).toBe("2026-11-02");
    expect(gapCount(r.counts)).toBe(22);
    expect(askableCount(r.counts)).toBe(21);
  });

  it("means Off for anything it does not recognise, and keeps the role when it knows it", () => {
    for (const bad of [null, undefined, 7, "on", [], {}, { state: "maybe" }, { state: "off", role: "act" }]) {
      const r = parseGapReport(bad);
      expect(r.state, JSON.stringify(bad)).toBe("off");
      expect(r.rows).toEqual([]);
    }
    expect(parseGapReport({ state: "off", role: "look" }).role).toBe("look");
    expect(GAP_REPORT_OFF.state).toBe("off");
  });

  it("drops a row it cannot read instead of failing, and never invents a cause", () => {
    const r = parseGapReport({ ...good, rows: [good.rows[0], { person_id: "c", cause: "something_new" }, { name: "No id", cause: "no_yes" }, 7, null] });
    expect(r.rows.map((x) => x.personId)).toEqual(["a"]);
  });

  it("names every cause in words, in the order the page shows them", () => {
    expect(CAUSES.map((c) => c.key)).toEqual(["unreachable", "no_number", "no_yes", "made_up", "not_open", "withheld"]);
    for (const c of CAUSES) expect(causeLabel(c.key)).toBe(c.label);
    expect(causeLabel("unknown")).toBe("unknown");
    // only the three the church can ask about are askable, and they are the three the database asks
    expect(CAUSES.filter((c) => c.askable).map((c) => c.key)).toEqual(["no_number", "no_yes", "made_up"]);
    expect(sql).toContain("array['no_number', 'made_up']");
  });

  it("says when someone was last asked", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(askedWords(null, 0, now)).toBe("Not asked");
    expect(askedWords("2026-11-10T09:00:00Z", 1, now)).toBe("Asked today");
    expect(askedWords("2026-11-09T09:00:00Z", 1, now)).toBe("Asked yesterday");
    expect(askedWords("2026-11-03T09:00:00Z", 2, now)).toBe("Asked 2 times, last 7 days ago");
  });
});

describe("the download", () => {
  const rows = [
    { name: "Ada Okafor", tribe: "Builders Tribe", leader: "Grace", cause: "no_number", asks: 1, last_asked: "2026-11-01T10:00:00Z" },
    { name: "=HYPERLINK(\"http://x\")", tribe: "Tribe, with comma", leader: "", cause: "no_yes", asks: 0, last_asked: null },
    { name: "+234 x", tribe: "T", leader: "G", cause: "unreachable", asks: 0, last_asked: null },
  ];
  const csv = gapsCsv(rows);

  it("starts with the mark a spreadsheet needs, has a header, and one line per person", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Tribe,Leader,Why a leader cannot reach them,Times asked,Last asked");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("Ada Okafor,Builders Tribe,Grace,No number saved,1,2026-11-01");
  });

  it("cannot be run as a formula, and quotes what needs quoting", () => {
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+234 x");
    expect(csv).toContain('"Tribe, with comma"');
    expect(csv).not.toMatch(/(^|[\r\n,])[=+@-]/);
  });

  it("has no column for a phone number, and the database does not give one", () => {
    expect(csv.split("\r\n")[0].toLowerCase()).not.toMatch(/phone|number saved|whatsapp number|mobile/);
    const fn = bodyOf("contact_gaps_export()", "tribe_reach_gaps");
    expect(fn).not.toMatch(/whatsapp|\.phone|mobile|sign_in_phone|msisdn/i);
  });

  it("reads the database's rows defensively", () => {
    expect(parseGapExport(null)).toEqual([]);
    expect(parseGapExport([{ name: "A", asks: 1 }, 5, null])).toHaveLength(1);
  });
});

describe("what a leader sees", () => {
  it("reads first names and a state, and drops what it cannot read", () => {
    const r = parseReachGaps({ on: true, people: [{ person_id: "a", first_name: "Ada", state: "ask", asked_at: null }, { person_id: "b", first_name: "Bola", state: "asked", asked_at: "2026-11-02T00:00:00Z" }, { person_id: "c", first_name: "Chi", state: "in_person" }, { person_id: "d", state: "weird" }, { state: "ask" }] });
    expect(r.on).toBe(true);
    expect(r.people.map((p) => [p.firstName, p.state])).toEqual([["Ada", "ask"], ["Bola", "asked"], ["Chi", "in_person"]]);
  });
  it("is Off unless the database says it is on", () => {
    for (const bad of [null, {}, { on: false, people: [{ person_id: "a", first_name: "A", state: "ask" }] }, "on", { on: "true" }]) expect(parseReachGaps(bad)).toEqual(REACH_GAPS_OFF);
  });
  it("shows no number anywhere, and the sentences ask rather than press", () => {
    expect(REACH_WORDS.leaderAsk("Ada")).toBe("Ask Ada to add it");
    expect(REACH_WORDS.leaderAsked("Ada")).toBe("Ada was asked");
    expect(REACH_WORDS.leaderLine).toMatch(/their choice/i);
    expect(REACH_WORDS.leaderDone("Ada")).toMatch(/choose what to share/i);
    const fn = bodyOf("tribe_reach_gaps", "contact_ask_send");
    expect(fn).toContain("'first_name'");
    expect(fn).not.toMatch(/whatsapp|\.phone|mobile|msisdn/i);
  });
});

describe("what the member sees", () => {
  it("shows the prompt only for a gap that was not put away, and the sign-in number only when it is usable", () => {
    expect(parseReach({ on: true, cause: "no_number", prompt: true, signin: "+2348031234567" })).toEqual({ on: true, cause: "no_number", prompt: true, signin: "+2348031234567" });
    expect(parseReach({ on: true, cause: "no_yes", prompt: true, signin: "+2348031234567" }).signin).toBe("+2348031234567");
    expect(parseReach({ on: true, cause: "no_number", prompt: false, signin: null }).prompt).toBe(false);
    expect(parseReach({ on: true, cause: null, prompt: true, signin: "+2348031234567" })).toMatchObject({ prompt: false, signin: null });
    expect(parseReach({ on: true, cause: "no_number", prompt: true, signin: "08031234567" }).signin).toBeNull();
    expect(parseReach({ on: true, cause: "no_number", prompt: true, signin: "+12" }).signin).toBeNull();
  });
  it("is Off for anything else", () => {
    for (const bad of [null, undefined, {}, { on: false, cause: "no_number", prompt: true }, "on", []]) expect(parseReach(bad)).toEqual(REACH_OFF);
  });
  it("says who can see a number, and that nothing is ticked for them", () => {
    expect(REACH_WORDS.whoSees).toMatch(/leader, their assistant and your coach/);
    expect(REACH_WORDS.whoSees).toMatch(/only if WhatsApp is ticked/);
    expect(REACH_WORDS.whoSees).toMatch(/Other members never see it/);
    expect(REACH_WORDS.signinNote).toMatch(/only fills the box/i);
    expect(REACH_WORDS.signinNote).toMatch(/WhatsApp stays unticked/);
    expect(REACH_WORDS.noNumberBody).toMatch(/you can say no/i);
    expect(REACH_WORDS.noYesBody).toMatch(/leave it as it is/i);
  });
});

describe("the email that asks", () => {
  it("is registered with the sender, email only, and queued by the database as email", () => {
    expect(REACH_TEMPLATES.map((t) => t.key)).toEqual(["contact_ask_leader"]);
    expect(TEMPLATES.contact_ask_leader.emailOnly).toBe(true);
    expect(sql).toMatch(/enqueue_message\(p_person, 'contact_ask_leader'[\s\S]*?'normal', 'email'\)/);
  });

  it.each(["no_number", "no_yes"])("%s: a short subject, the leader by first name, who can see a number, and that it is their choice", (kind) => {
    const mail = renderEmail(message({ ...REACH_SAMPLES.contact_ask_leader, kind }), SITE);
    expect(mail.subject.length).toBeGreaterThan(8);
    expect(mail.subject.length).toBeLessThan(60);
    expect(mail.subject + mail.text).toContain("Grace");
    expect(mail.text).toContain("Hi Ada,");
    expect(mail.text).toMatch(/tribe’s leader, their assistant and your coach/);
    expect(mail.text).toMatch(/Other members never see it/);
    expect(mail.text).toMatch(/your choice|Nothing changes unless you change it/);
    expect(mail.text).toMatch(/change .* any time|any time/);
    expect(mail.text).not.toMatch(/undefined|null|NaN|\[object/);
    for (const url of mail.text.match(/https?:\/\/\S+/g) ?? []) expect(url.startsWith(SITE)).toBe(true);
    expect(mail.text).toContain(`${SITE}/profile`);
    expect(mail.text.length).toBeLessThan(1400);
  });

  it("never blames, never names another member, never carries a number or an email address", () => {
    for (const kind of ["no_number", "no_yes"]) {
      const mail = renderEmail(message({ ...REACH_SAMPLES.contact_ask_leader, kind }), SITE);
      expect(mail.text).not.toMatch(/you (forgot|failed|should have|must|have to)|required|compulsory|deadline|last chance|urgent/i);
      expect(mail.text).not.toMatch(/\+?\d[\d\s-]{7,}/);
      expect(mail.text).not.toMatch(/@(?!unitedtribes)/);
    }
  });

  it("still renders when the database sends nothing at all", () => {
    const mail = renderEmail(message({}), SITE);
    expect(mail.subject).toContain("Your leader");
    expect(mail.subject + mail.text).not.toMatch(/undefined|null|NaN|\[object/);
  });

  it("says a person who has said yes to WhatsApp can be messaged on it, and one who said nothing is told how to leave it", () => {
    const yes = renderEmail(message({ leader_first: "Grace", kind: "no_yes" }), SITE).text;
    expect(yes).toMatch(/tick it/i);
    expect(yes).toMatch(/leave it as it is/i);
    const none = renderEmail(message({ leader_first: "Grace", kind: "no_number" }), SITE).text;
    expect(none).toMatch(/you do not need to do anything/i);
  });
});

describe("the announcement choice", () => {
  it("is one more audience, the three left-out reasons are worded, and its label says who", () => {
    expect(AUDIENCE_KINDS.map((k) => k.kind)).toContain("cannot_reach");
    for (const k of ["asked_recently", "asked_enough", "gap_closed"]) expect(LEFT_OUT_REASONS[k], k).toBeTruthy();
    expect(audienceLabel({ kind: "cannot_reach", cause: "no_number" })).toBe("Cannot be reached on WhatsApp (no number saved)");
    expect(audienceLabel({ kind: "cannot_reach", cause: "no_yes", tribe: "t" })).toBe("Cannot be reached on WhatsApp (number saved, WhatsApp not agreed; one tribe)");
    expect(audienceLabel({ kind: "cannot_reach", cause: "either" })).toBe("Cannot be reached on WhatsApp");
    // the database keeps the three reasons in step with these words
    for (const k of ["asked_recently", "asked_enough", "gap_closed"]) expect(sql, k).toContain(`'${k}'`);
  });

  it("has three notes of its own that leave the choice with the person, and the usual four are unchanged", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["saved", "tribes_ready", "season_soon", "thank_you"]);
    expect(REACH_STARTERS.map((s) => s.id)).toEqual(["how_to_reach", "add_number", "tick_whatsapp"]);
    for (const s of REACH_STARTERS) {
      const words = [s.subject, ...s.paragraphs].join(" ");
      expect(words, s.id).toMatch(/\{first_name\}/);
      expect(words, s.id).not.toMatch(/required|compulsory|must|deadline|last chance|urgent|or else/i);
      expect(s.button_target, s.id).toBe("/profile");
    }
    expect(REACH_STARTERS[0].paragraphs.join(" ")).toMatch(/tribe’s leader, their assistant and your coach/);
  });
});

describe("who may see the page", () => {
  it("reads: the office and the pastor and care lead. Acts: the admin, the director and the data lead, as the database does", () => {
    expect([...CONTACT_GAP_ACT_ROLES].sort()).toEqual(["admin", "data_lead", "director"]);
    expect([...CONTACT_GAP_ROLES].sort()).toEqual(["admin", "care_lead", "data_lead", "director", "pastor"]);
    expect(sql).toContain("array['admin', 'director', 'data_lead']");
    expect(sql).toContain("array['pastor', 'care_lead']");
  });
});
