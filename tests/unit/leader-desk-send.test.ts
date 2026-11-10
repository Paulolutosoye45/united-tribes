import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESK_EMAIL_SAMPLES, DESK_SUBJECT_MAX, DESK_WORDS, becauseLine, groupWhen, isDeskAnswer, parseDeskInfo, seatsLine } from "@/lib/desk/wording";
import { INTEREST_WORDS, checkSummary, parseCheck, parseInterest, parsePreview, parseProposals, parseSendState, previewLine, statusWord, canWithdraw } from "@/lib/god/desk-send";
import { renderEmail, renderSms, renderWhatsApp } from "@/lib/messaging/render";
import { TEMPLATES } from "@/lib/messaging/templates";
import { DESK_TEMPLATES } from "@/lib/messaging/templates-desk";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// The Leader Desk's two emails (Phase 2a) and the way the owner's screens read what the database says about them.

const SITE = "https://unitedtribes.example";
const SECRET = "ab".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

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

const proposal = DESK_EMAIL_SAMPLES.desk_proposal as unknown as Params;
const interest = DESK_EMAIL_SAMPLES.desk_interest as unknown as Params;
const mail = (t: "desk_proposal" | "desk_interest", over: Params = {}) => renderEmail(message(t, { ...(t === "desk_proposal" ? proposal : interest), ...over }), SITE);

describe("the two Desk emails", () => {
  it("are registered, email only, and addressed to a member", () => {
    expect(DESK_TEMPLATES.map((t) => t.key)).toEqual(["desk_proposal", "desk_interest"]);
    for (const k of ["desk_proposal", "desk_interest"]) {
      expect(TEMPLATES[k].emailOnly, k).toBe(true);
      expect(TEMPLATES[k].audience, k).toBe("member");
    }
  });

  it("have a subject that fits a phone's lock screen", () => {
    for (const t of ["desk_proposal", "desk_interest"] as const) {
      const { subject } = mail(t);
      expect(subject.length, subject).toBeLessThanOrEqual(DESK_SUBJECT_MAX);
      expect(subject).toContain("Ada");
    }
    // A long first name falls back to the short subject instead of being cut mid-word
    const long = renderEmail(message("desk_interest", interest, { first_name: "Oluwatobiloba-Chukwuemeka-Adewale" }), SITE);
    expect(long.subject.length).toBeLessThanOrEqual(DESK_SUBJECT_MAX);
  });

  it("promise no seat: a tribe is still the member's to choose, and a yes is only interest", () => {
    const a = mail("desk_proposal").text;
    expect(a).toContain(DESK_WORDS.notice.nothingDecided);
    expect(a).toContain(DESK_WORDS.notice.noIsFine);
    const b = mail("desk_interest").text;
    expect(b).toContain(DESK_WORDS.notice.nothingYet);
    expect(b).toContain(DESK_WORDS.notice.silence);
    for (const text of [a, b]) {
      expect(text).not.toMatch(/\b(reserved|we have placed you|you have been placed|your seat is|guaranteed|confirmed)\b/i);
    }
  });

  it("each has Not for me and Stop these emails, and every button opens the private page, which saves nothing until a button there is pressed", () => {
    for (const t of ["desk_proposal", "desk_interest"] as const) {
      const { text, html } = mail(t);
      expect(text, t).toContain("Not for me");
      expect(text, t).toContain("Stop these emails");
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((u) => u.includes("/d/"));
      expect(links.length, t).toBeGreaterThanOrEqual(3);
      for (const u of links) expect(u, u).toMatch(new RegExp(`^${SITE}/d/${SECRET}\\?a=(look|yes|no|time|stop)$`));
    }
    expect(mail("desk_interest").text).toContain("A different time");
    expect(mail("desk_proposal").text).not.toContain("A different time");
  });

  it("never carry a phone number, another member's name, or anything about faith, stage, support or age", () => {
    for (const t of ["desk_proposal", "desk_interest"] as const) {
      const { text } = mail(t);
      expect(text.replace(/[a-f0-9]{64}/g, ""), t).not.toMatch(/\+?\d[\d\s-]{8,}/);
      expect(text, t).not.toMatch(/\b(saved|born again|baptis|pastor|care|support|age|years old|single|married|widow|divorc)/i);
    }
    // Only the leader's first name is ever shown, and only on the tribe email
    expect(mail("desk_proposal").text).toContain("Ngozi");
    expect(mail("desk_interest").text).not.toContain("Ngozi");
    expect(mail("desk_interest").text).toContain("We are still finding its leader");
  });

  it("say the fit and its reasons only from the matching's own words, and only as many as three", () => {
    const t = mail("desk_proposal").text;
    expect(t).toContain("82% fit");
    expect(t).toContain("We think so because");
    const none = mail("desk_proposal", { reasons: [], degree: null }).text;
    expect(none).not.toContain("% fit");
    expect(none).not.toContain("We think so because");
    // A reason the page does not know is dropped rather than shown
    expect(becauseLine(["made_up_reason"])).toBeNull();
    expect(becauseLine(["goal_same", "place_near", "rhythm_fit", "place_same"])?.split(" and ").length).toBe(2);
  });

  it("say how many seats are left only when there are some", () => {
    expect(mail("desk_proposal", { seats_left: 1 }).text).toContain("There is 1 seat left.");
    expect(mail("desk_proposal", { seats_left: 4 }).text).toContain("There are 4 seats left.");
    expect(mail("desk_proposal", { seats_left: 0 }).text).not.toMatch(/seats? left/);
    expect(seatsLine(null)).toBeNull();
  });

  it("fall back to the ordinary tribe page when there is no secret, instead of a broken link", () => {
    const m = { ...message("desk_proposal", proposal), reply_token: null };
    const html = renderEmail(m, SITE).html;
    expect(html).not.toContain("/d/undefined");
    expect(html).not.toContain("/d/null");
    expect(html).toContain(`${SITE}/tribe`);
  });

  it("have only a short pointer as a text message or WhatsApp note, with no decision in it", () => {
    for (const t of ["desk_proposal", "desk_interest"] as const) {
      const m = { ...message(t, t === "desk_proposal" ? proposal : interest), channel: "sms" as const };
      const sms = renderSms(m, SITE);
      expect(sms.length).toBeLessThan(320);
      expect(sms).toContain("/d/");
      const w = renderWhatsApp({ ...m, channel: "whatsapp" as const }, SITE);
      expect(JSON.stringify(w)).toContain("/d/");
    }
  });

  it("describe the group by the slot, mode and zone the database gives", () => {
    expect(groupWhen("weeknight-evening", "online", null)).toBe("Weeknight evenings, online");
    expect(groupWhen("nonsense", "online", null)).toContain("ime still to be set");
    expect(mail("desk_interest").text).toMatch(/weeknight evenings/i);
    expect(mail("desk_interest").text).toContain("within 48 hours");
  });

  it("are only queued by the Desk's own database function, as email, with the fields the template reads", () => {
    const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270117000100_desk_proposals.sql"), "utf8");
    expect(sql).toContain("'desk_proposal'");
    expect(sql).toContain("'desk_interest'");
    expect(sql).toMatch(/force_channel\s*=>\s*'email'|p_force\s*=>\s*'email'|'email'/);
    for (const field of Object.keys(proposal)) if (field !== "kind") expect(sql, field).toContain(`'${field}'`);
    for (const field of Object.keys(interest)) if (field !== "kind") expect(sql, field).toContain(`'${field}'`);
  });
});

describe("the private page's reading of the database", () => {
  const found = {
    found: true,
    kind: "interest",
    open: true,
    first: "Ada",
    answered: false,
    answer: null,
    slots: ["sunday-evening", "bogus"],
    stopped: false,
    expires_at: "2026-11-12T10:00:00Z",
    details: { community: "Professionals", goal: "Lead", slot: "weeknight-evening", mode: "online", capacity: 8, hours: 48, reasons: ["goal_same", "nope"] },
  };

  it("keeps only what it knows and treats anything else as no page", () => {
    const info = parseDeskInfo(found);
    expect(info?.kind).toBe("interest");
    expect(info?.slots).toEqual(["sunday-evening"]);
    expect(info?.reasons).toEqual(["goal_same"]);
    expect(parseDeskInfo(null)).toBeNull();
    expect(parseDeskInfo({ found: false })).toBeNull();
    expect(parseDeskInfo({ found: true, kind: "other" })).toBeNull();
    expect(parseDeskInfo("x")).toBeNull();
  });

  it("accepts exactly four answers", () => {
    for (const a of ["yes", "no", "other_time", "stop"]) expect(isDeskAnswer(a)).toBe(true);
    for (const a of ["maybe", "", null, undefined, 1]) expect(isDeskAnswer(a)).toBe(false);
  });
});

describe("the Sending tab's reading of the database", () => {
  it("reads the state, and shows 'off' for anything it does not understand", () => {
    expect(parseSendState({ mode: "on", paused: false, daily_cap: 40, gap_days: 7, season_cap: 3, interest_hours: 48, sent_today: 2, would_today: 0, sending_hours: true })).toEqual({
      mode: "on", paused: false, dailyCap: 40, gapDays: 7, seasonCap: 3, interestHours: 48, sentToday: 2, wouldToday: 0, sendingHours: true,
    });
    expect(parseSendState({ mode: "weird" })?.mode).toBe("off");
    expect(parseSendState(null)).toBeNull();
    expect(parseSendState([])).toBeNull();
  });

  it("reads the list, drops rows it cannot trust, and words each status", () => {
    const page = parseProposals({
      total: 3,
      counts: { sent: 1, would_send: 1, yes: 1, no: 0, other_time: 0, stop: 0, expired: 0 },
      rows: [
        { id: ID, kind: "tribe", person_id: ID2, name: "Ada Example", target: "Builders", status: "sent", answer: null, slots: [], rehearsal: false, degree: 81.6, at: "2026-11-10T09:00:00Z", expires_at: null },
        { id: "not-an-id", kind: "tribe", person_id: ID2, status: "sent" },
        { id: ID2, kind: "interest", person_id: ID, name: "Ben", status: "answered", answer: "other_time", slots: ["sunday-evening"], rehearsal: true },
        { id: ID, kind: "unknown", person_id: ID2, status: "sent" },
      ],
    });
    expect(page.rows.map((r) => r.name)).toEqual(["Ada Example", "Ben"]);
    expect(page.rows[0].degree).toBe(82);
    expect(page.total).toBe(3);
    expect(page.counts.yes).toBe(1);
    expect(statusWord(page.rows[0])).toBe("Sent, no answer yet");
    expect(statusWord(page.rows[1])).toBe("Would rather: sunday evening");
    expect(canWithdraw(page.rows[0])).toBe(true);
    expect(canWithdraw(page.rows[1])).toBe(false);
    expect(parseProposals("x").rows).toEqual([]);
  });

  it("reads who in a draft has said what, and who left by answering", () => {
    const v = parseInterest({
      members: [{ person_id: ID, state: "yes" }, { person_id: ID2, state: "sent" }, { person_id: "bad", state: "yes" }],
      left: [{ person_id: ID2, name: "Ben", answer: "other_time", slots: ["sunday-evening"] }, { person_id: ID, name: "Ada", answer: "stop" }],
    });
    expect(v.members).toEqual({ [ID]: "yes", [ID2]: "asked" });
    expect(v.left).toHaveLength(1);
    expect(INTEREST_WORDS.asked).toBe("Asked, no answer yet");
    expect(parseInterest(null).left).toEqual([]);
  });

  it("reads the preview, and a refusal's words, and says what the check did and left out", () => {
    const ok = parsePreview({ ok: true, tribe_id: ID, mode: "rehearsal", params: { tribe: "Builders", leader_first: "Ngozi", degree: 82, seats_left: 1 } });
    expect(ok && ok.ok && previewLine(ok)).toBe("Builders, led by Ngozi, 82% fit, 1 seat left.");
    expect(parsePreview({ ok: false, text: "That member is under 18." })).toEqual({ ok: false, text: "That member is under 18." });
    expect(parsePreview({ ok: true })).toBeNull();
    const r = parseCheck({ sent: 0, would_send: 3, skipped: { already: 1, bounced: 1, gap: 0 } });
    expect(r && checkSummary(r)).toBe("Written down for 3. Nothing was sent. Left out: 1 already asked, 1 emails not arriving.");
    expect(checkSummary({ sent: 2, wouldSend: 0, skipped: [] })).toBe("Sent to 2.");
    expect(checkSummary({ sent: 0, wouldSend: 0, skipped: [] })).toBe("Nobody was asked.");
  });
});
