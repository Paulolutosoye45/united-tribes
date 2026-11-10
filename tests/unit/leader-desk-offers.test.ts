import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESK_SUBJECT_MAX,
  DESK_WORDS,
  OFFER_ANSWERS,
  OFFER_EMAIL_SAMPLES,
  OFFER_REASONS,
  OFFER_REASON_IDS,
  OFFER_WORDS,
  isOfferAnswer,
  isOfferReason,
  offerCountLine,
  parseDeskInfo,
  parseOfferInfo,
} from "@/lib/desk/wording";
import { OWNER_OFFER_WORDS, canWithdrawOffer, latestRound, leaderStage, offerLine, parseCandidates, parseGroupLeader, parseOffersList, type OfferRow } from "@/lib/god/desk-offers";
import { daysForSlot, slotOf, timesForSlot } from "@/lib/academy/options";
import { renderEmail, renderSms, renderWhatsApp } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// The Leader Desk's leader offers (Phase 2b-1): the "Would you lead this group?" email and its reminders, the "Your group has a leader" email, the private
// offer page's reading of the database, the owner's screens' reading of the database, and the slot windows the tribe card keeps to.

const SITE = "https://unitedtribes.example";
const SECRET = "cd".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

function message(template: string, params: Params, to: Partial<ClaimedMessage["to"]> = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000009",
    template,
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: SECRET,
    to: { email: "ada.example@example.org", phone: null, name: "Ada Example", first_name: "Ada", ...to },
  };
}

const offer = OFFER_EMAIL_SAMPLES.desk_offer as unknown as Params;
const found = OFFER_EMAIL_SAMPLES.desk_found as unknown as Params;
const offerMail = (over: Params = {}, to: Partial<ClaimedMessage["to"]> = {}) => renderEmail(message("desk_offer", { ...offer, ...over }, to), SITE);
const foundMail = (over: Params = {}) => renderEmail(message("desk_found", { ...found, ...over }), SITE);
const linksIn = (html: string, path: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((u) => u.includes(path));

describe("the 'Would you lead this group?' email", () => {
  it("is registered, email only, and addressed to a member", () => {
    expect(TEMPLATES.desk_offer.emailOnly).toBe(true);
    expect(TEMPLATES.desk_offer.audience).toBe("member");
  });

  it("has a subject that fits a phone's lock screen, with a short fallback for a long first name", () => {
    for (const reminder of [null, "24", "12", "tomorrow"]) {
      const { subject } = offerMail({ reminder });
      expect(subject.length, subject).toBeLessThanOrEqual(DESK_SUBJECT_MAX);
      expect(subject).toContain("Ada");
    }
    const long = offerMail({ reminder: "24" }, { first_name: "Oluwatobiloba-Chukwuemeka-Adewale" });
    expect(long.subject.length).toBeLessThanOrEqual(DESK_SUBJECT_MAX);
    expect(long.subject).toMatch(/lead this group/);
  });

  it("says plainly that it is a question, that a yes is not the end of the process, and that silence changes nothing", () => {
    const t = offerMail().text;
    expect(t).toContain(OFFER_WORDS.notice.ask);
    expect(t).toContain(OFFER_WORDS.notice.support);
    expect(t).toContain(OFFER_WORDS.notice.nothingYet);
    expect(t).toContain(OFFER_WORDS.notice.silence);
    expect(t).toContain("Please answer by Friday 13 November at 11:00 am.");
    expect(t).not.toMatch(/\b(you have been appointed|you are now the leader|guaranteed|confirmed)\b/i);
  });

  it("tells them before the button that a yes asks for 21 or older and two short questions", () => {
    expect(offerMail().text).toMatch(/21 or older/);
    expect(offerMail().text).toMatch(/two short questions/);
  });

  it("has every answer on the page, and the main button is the yes", () => {
    const { text, html } = offerMail();
    for (const label of ["Yes, I will lead", "Not this season", "Call me", "Remind me tomorrow", "Never ask me to lead", "Stop these emails"]) expect(text, label).toContain(label);
    expect(text).not.toContain("Skip");
    const links = linksIn(html, "/o/");
    expect(links.length).toBeGreaterThanOrEqual(6);
    const seen = new Set<string>();
    for (const u of links) {
      expect(u, u).toMatch(new RegExp(`^${SITE}/o/${SECRET}\\?a=(lead|not_season|call|tomorrow|never|stop)$`));
      seen.add(u.split("a=")[1]);
    }
    expect([...seen].sort()).toEqual([...OFFER_ANSWERS].sort());
    expect(linksIn(html, "/d/")).toEqual([]);
  });

  it("says how many are on the group's list, as counts only, and nothing when there are none", () => {
    expect(offerMail().text).toContain("5 people are on its list so far, and 3 of them have said they would like to join.");
    expect(offerMail({ members: 1, asked: false, yes: 0 }).text).toContain("1 person is on its list so far.");
    expect(offerMail({ members: 0, asked: true, yes: 0 }).text).not.toMatch(/on its list/);
    expect(offerCountLine(4, true, 1)).toBe("4 people are on its list so far, and 1 of them has said they would like to join.");
    expect(offerCountLine(4, false, 3)).toBe("4 people are on its list so far.");
    expect(offerCountLine(0, true, 3)).toBeNull();
  });

  it("names the reminders, and only the three it knows", () => {
    expect(offerMail({ reminder: "24" }).text).toContain(OFFER_WORDS.reminder["24"]);
    expect(offerMail({ reminder: "12" }).text).toContain(OFFER_WORDS.reminder["12"]);
    expect(offerMail({ reminder: "tomorrow" }).text).toContain(OFFER_WORDS.reminder.tomorrow);
    expect(offerMail({ reminder: null }).text).not.toMatch(/A reminder/);
    expect(offerMail({ reminder: "7" }).text).not.toMatch(/A reminder|You asked us/);
    expect(offerMail({ reminder: "12" }).subject).toMatch(/^Reminder/);
  });

  it("never carries a phone number, another member's name, or anything about faith, stage, support need or age beyond the 21 question", () => {
    const t = offerMail().text.replace(/[a-f0-9]{64}/g, "");
    expect(t).not.toMatch(/\+?\d[\d\s-]{8,}/);
    expect(t).not.toMatch(/\b(saved|born again|baptis|single|married|widow|divorc|years old)/i);
    // The offer names no leader and no other member
    expect(t).not.toContain("Ngozi");
  });

  it("falls back to the ordinary tribe page when there is no secret, instead of a broken link", () => {
    const m = { ...message("desk_offer", offer), reply_token: null };
    const html = renderEmail(m, SITE).html;
    expect(html).not.toContain("/o/undefined");
    expect(html).not.toContain("/o/null");
    expect(html).toContain(`${SITE}/tribe`);
  });

  it("has only a short pointer as a text message or WhatsApp note, with no decision in it", () => {
    const m = { ...message("desk_offer", offer), channel: "sms" as const };
    const sms = renderSms(m, SITE);
    expect(sms.length).toBeLessThan(320);
    expect(sms).toContain("/o/");
    expect(JSON.stringify(renderWhatsApp({ ...m, channel: "whatsapp" as const }, SITE))).toContain("/o/");
  });
});

describe("the 'Your group has a leader' email", () => {
  it("is registered, email only, addressed to a member, and short enough for a lock screen", () => {
    expect(TEMPLATES.desk_found.emailOnly).toBe(true);
    expect(TEMPLATES.desk_found.audience).toBe("member");
    const { subject } = foundMail();
    expect(subject.length).toBeLessThanOrEqual(DESK_SUBJECT_MAX);
    expect(subject).toContain("Ada");
    expect(foundMail({}).subject).toMatch(/has a leader/);
  });

  it("names the leader by first name only, and promises no seat", () => {
    const t = foundMail().text;
    expect(t).toContain("Ngozi");
    expect(t).toContain(DESK_WORDS.notice.foundNothingDecided);
    expect(t).toContain(DESK_WORDS.notice.foundNoIsFine);
    expect(t).not.toMatch(/\b(reserved|we have placed you|you have been placed|your seat is|guaranteed|confirmed)\b/i);
    expect(t.replace(/[a-f0-9]{64}/g, "")).not.toMatch(/\+?\d[\d\s-]{8,}/);
  });

  it("has Yes, No and Stop, and every one opens the member's private page, which saves nothing until a button there is pressed", () => {
    const { text, html } = foundMail();
    expect(text).toContain("Stop these emails");
    const links = linksIn(html, "/d/");
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const u of links) expect(u, u).toMatch(new RegExp(`^${SITE}/d/${SECRET}\\?a=(yes|no|stop)$`));
    expect(linksIn(html, "/o/")).toEqual([]);
  });
});

describe("the offer's secret fields, as the database writes them", () => {
  const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270118000100_desk_offers.sql"), "utf8");

  it("queues both emails by the Desk's own function, as email, with the fields each template reads", () => {
    expect(sql).toContain("'desk_offer'");
    expect(sql).toContain("'desk_found'");
    expect(sql).toMatch(/'email'/);
    for (const field of Object.keys(offer)) if (field !== "kind") expect(sql, `desk_offer.${field}`).toContain(`'${field}'`);
    for (const field of Object.keys(found)) if (field !== "kind") expect(sql, `desk_found.${field}`).toContain(`'${field}'`);
  });

  it("gives an offer a 72 hour window by default, with reminders 24 and 12 hours before it closes", () => {
    expect(sql).toMatch(/offer_hours[^;]*72/);
    expect(sql).toContain("'24'");
    expect(sql).toContain("'12'");
    expect(sql).toContain("'tomorrow'");
  });
});

describe("the offer page's answers and reasons", () => {
  it("accepts exactly six answers", () => {
    for (const a of ["lead", "not_season", "call", "tomorrow", "never", "stop"]) expect(isOfferAnswer(a), a).toBe(true);
    for (const a of ["yes", "no", "maybe", "", null, undefined, 1, "LEAD"]) expect(isOfferAnswer(a), String(a)).toBe(false);
  });

  it("accepts exactly five reasons for 'Not this season', and anything else is dropped", () => {
    expect(OFFER_REASON_IDS).toEqual(["busy", "family", "not_ready", "other_goal", "other"]);
    for (const r of OFFER_REASONS) expect(isOfferReason(r.id)).toBe(true);
    expect(isOfferReason("made_up")).toBe(false);
    expect(isOfferReason(undefined)).toBe(false);
  });

  it("reads the page's facts, keeps counts as whole numbers, and treats anything else as no page", () => {
    const info = parseOfferInfo({
      found: true,
      open: true,
      status: "open",
      first: "Ada",
      answer: null,
      call_me: true,
      reminder_set: false,
      stopped: false,
      details: { ends: "Friday", community: "Professionals", goal: "Lead", slot: "weeknight-evening", mode: "online", zone: null, capacity: 8, members: 5, asked: true, yes: 3, hours: 72 },
    });
    expect(info).toMatchObject({ open: true, first: "Ada", callMe: true, members: 5, yes: 3, hours: 72, capacity: 8, asked: true, slot: "weeknight-evening" });
    expect(parseOfferInfo(null)).toBeNull();
    expect(parseOfferInfo({ found: false })).toBeNull();
    expect(parseOfferInfo("x")).toBeNull();
    expect(parseOfferInfo({ found: true })?.members).toBe(0);
    // A tribe-proposal page is not an offer page: the two readers do not take each other's rows
    expect(parseDeskInfo({ found: true, kind: "offer" })).toBeNull();
  });

  it("has a done line for every answer, and no shaming in a no", () => {
    for (const a of OFFER_ANSWERS) expect(OFFER_WORDS.done[a], a).toBeTruthy();
    expect(OFFER_WORDS.notice.noIsFine).toMatch(/fine answer/);
    expect(OFFER_WORDS.done.not_season).not.toMatch(/sorry|disappoint|unfortunately/i);
    expect(OFFER_WORDS.notice.reasonsWhy).toMatch(/private/);
  });
});

describe("the owner's screens' reading of leader offers", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: ID, round: 1, seq: 1, person_id: ID2, name: "Ngozi Example", status: "open", rehearsal: false, ...over });

  it("reads the candidates, drops rows it cannot trust, and says why when there are none", () => {
    const c = parseCandidates({
      problem: null,
      rows: [
        { person_id: ID, name: "Ada Example", score: 81.6, pool: "waiting", notes: ["goal_same", 4], in_group: true, phone: "+2348012345678", has_number: true },
        { person_id: "not-an-id", name: "X" },
        "nope",
        { person_id: ID2 },
      ],
    });
    expect(c?.rows.map((r) => r.name)).toEqual(["Ada Example", "A member"]);
    expect(c?.rows[0]).toMatchObject({ score: 82, pool: "waiting", inGroup: true, hasNumber: true });
    expect(c?.rows[0].notes).toEqual(["goal_same"]);
    expect(c?.rows[1].pool).toBe("members");
    expect(parseCandidates({ problem: "This group already has a leader.", rows: [] })?.problem).toBe("This group already has a leader.");
    expect(parseCandidates(null)).toBeNull();
    expect(parseCandidates([])).toBeNull();
  });

  it("reads a group's leader and its offers, keeping only valid ones", () => {
    const g = parseGroupLeader({
      problem: null,
      paused: true,
      leader: { person_id: ID2, name: "Ngozi", found_at: "2026-11-10T10:00:00Z", tribe_id: ID3, tribe_status: "draft", certified: false },
      needs_decision: false,
      offers: [row(), row({ id: "bad" }), row({ status: "weird" }), row({ id: ID3, seq: 2, status: "queued" })],
    });
    expect(g.paused).toBe(true);
    expect(g.leader).toMatchObject({ name: "Ngozi", certified: false, tribeStatus: "draft" });
    expect(g.offers.map((o) => o.status)).toEqual(["open", "queued"]);
    expect(parseGroupLeader("x")).toEqual({ problem: null, paused: false, leader: null, needsDecision: false, offers: [] });
    expect(parseGroupLeader({ leader: { person_id: "bad" } }).leader).toBeNull();
  });

  it("counts the reasons given for 'Not this season', only the five it knows, and never attaches one to a person", () => {
    const page = parseOffersList({
      total: 2,
      counts: { open: 1, review: 0, accepted: 0, declined: 1, expired: 0, would_send: 0, call_me: 1 },
      reasons: { busy: 3, family: 1, made_up: 9, other: "x" },
      rows: [{ ...row(), group_id: ID3, group: "Builders", at: "2026-11-10T10:00:00Z", reasons: ["busy"] }, { ...row({ id: ID3 }), group_id: "bad" }],
    });
    expect(page.reasons).toEqual({ busy: 3, family: 1, other: 0 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].group).toBe("Builders");
    expect(JSON.stringify(page.rows)).not.toMatch(/busy/);
    expect(page.counts.callMe).toBe(1);
    expect(parseOffersList(null).rows).toEqual([]);
  });

  it("words each status and answer, and allows withdrawal only until an answer", () => {
    for (const s of ["would_send", "queued", "open", "review", "accepted", "declined", "expired", "cancelled", "skipped"] as const) expect(OWNER_OFFER_WORDS.status[s], s).toBeTruthy();
    const o = (over: Partial<OfferRow> = {}) => ({ status: "open", answer: null, seq: 1, callMe: false, ...over }) as Pick<OfferRow, "status" | "answer" | "seq" | "callMe">;
    expect(offerLine(o())).toBe("Asked, waiting for an answer");
    expect(offerLine(o({ callMe: true }))).toBe("Asked, waiting for an answer. Asked for a call");
    expect(offerLine(o({ status: "declined", answer: "never" }))).toBe("Said no, never ask me to lead");
    expect(offerLine(o({ status: "declined", answer: "not_season" }))).toBe("Said no, not this season");
    expect(offerLine(o({ status: "expired" }))).toBe("Did not answer in time");
    for (const s of ["would_send", "queued", "open"] as const) expect(canWithdrawOffer({ status: s })).toBe(true);
    for (const s of ["review", "accepted", "declined", "expired", "cancelled", "skipped"] as const) expect(canWithdrawOffer({ status: s })).toBe(false);
  });

  it("says where a new leader stands: the tribe card's state, and whether the Academy has certified them", () => {
    const base = { personId: ID, name: "Ngozi", foundAt: null, tribeId: ID2, certified: false };
    expect(leaderStage({ ...base, tribeStatus: "draft" })).toBe("The tribe card has been started. The leader is filling it in. Not yet certified by the Academy.");
    expect(leaderStage({ ...base, tribeStatus: "approved", certified: true })).toBe("The tribe card is approved. Certified.");
    expect(leaderStage({ ...base, tribeStatus: "mystery" })).toContain("The tribe card has been started.");
  });

  it("picks the latest round, first to last", () => {
    const mk = (round: number, seq: number): OfferRow => ({ id: ID, round, seq, personId: ID2, name: "N", status: "queued", rehearsal: false, openedAt: null, windowEndsAt: null, callMe: false, answer: null, fit: null, phone: null, hasNumber: false });
    expect(latestRound([mk(1, 1), mk(2, 2), mk(2, 1), mk(1, 2)]).map((o) => `${o.round}.${o.seq}`)).toEqual(["2.1", "2.2"]);
    expect(latestRound([])).toEqual([]);
    expect(OWNER_OFFER_WORDS.limit(2)).toBe("You can choose up to 3: one now and 2 backups.");
    expect(OWNER_OFFER_WORDS.limit(1)).toBe("You can choose up to 2: one now and 1 backup.");
    expect(OWNER_OFFER_WORDS.order(1)).toBe("Asked first");
    expect(OWNER_OFFER_WORDS.order(3)).toBe("Second backup");
  });
});

describe("the tribe card's locks for a group the Desk formed", () => {
  it("find the slot of a day and time the same way the database does", () => {
    expect(slotOf(0, "13:00")).toBe("sunday-afternoon");
    expect(slotOf(0, "17:59")).toBe("sunday-afternoon");
    expect(slotOf(0, "18:00")).toBe("sunday-evening");
    expect(slotOf(0, "21:30")).toBe("sunday-evening");
    expect(slotOf(0, "21:31")).toBeNull();
    expect(slotOf(3, "19:30")).toBe("weeknight-evening");
    expect(slotOf(3, "19:29")).toBeNull();
    expect(slotOf(5, "21:30")).toBe("weeknight-evening");
    expect(slotOf(6, "07:00")).toBe("saturday-morning");
    expect(slotOf(6, "11:59")).toBe("saturday-morning");
    expect(slotOf(6, "12:00")).toBeNull();
    expect(slotOf(null, "19:30")).toBeNull();
    expect(slotOf(3, null)).toBeNull();
    expect(slotOf(3, "late")).toBeNull();
  });

  it("offer only the days a locked slot can be held on, and only the times inside it", () => {
    expect(daysForSlot("weeknight-evening")).toEqual([1, 2, 3, 4, 5]);
    expect(daysForSlot("saturday-morning")).toEqual([6]);
    expect(daysForSlot("sunday-afternoon")).toEqual([0]);
    expect(daysForSlot("sunday-evening")).toEqual([0]);
    expect(daysForSlot(null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const slot of ["weeknight-evening", "saturday-morning", "sunday-afternoon", "sunday-evening"]) {
      for (const day of daysForSlot(slot)) {
        const times = timesForSlot(day, slot);
        expect(times.length, `${slot} ${day}`).toBeGreaterThan(0);
        for (const t of times) expect(slotOf(day, t), `${slot} ${day} ${t}`).toBe(slot);
      }
    }
    expect(timesForSlot(0, "sunday-afternoon").every((t) => t < "18:00")).toBe(true);
    expect(timesForSlot(0, "sunday-evening").every((t) => t >= "18:00")).toBe(true);
  });

  it("keep the database's windows and the page's the same", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270118000100_desk_offers.sql"), "utf8");
    // The card's fixed list now holds the slot, the format, the zone, the kind and the seats, as well as the track, community and goal
    expect(sql).toMatch(/tribes_fixed_check/);
    for (const k of ["slot", "mode", "zone", "kind", "capacity"]) expect(sql, k).toContain(`'${k}'`);
  });
});
