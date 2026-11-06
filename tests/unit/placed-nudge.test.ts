import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/messaging/render";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";
import {
  LOCKED_PARAGRAPH,
  NUDGE_BUTTONS,
  NUDGE_CARD,
  NUDGE_WORDING,
  SUBJECT_MAX,
  isNudgeLink,
  parseChoose,
  parseConfirmedCounts,
  parseConfirmedFor,
  parseLinkState,
  parseNudgeMarks,
  parseNudgeOverview,
  parseNudgePageInfo,
  parseNudgeSettings,
  parseNudgeState,
  withLocked,
} from "@/lib/placement/nudge";

// The nudge email and the small readers its screens use. The email says the tribe, when it meets and who leads it, and nothing else about anyone: no
// number (not even with its middle hidden), always three honest buttons, a subject that fits a phone's lock screen, and a line about who can see a
// number that a writer cannot take out.

const SITE = "https://unitedtribes.example";
const SECRET = "a1b2c3d4".repeat(8);
const STOP = "e5f6a7b8".repeat(8);

function message(over: Partial<Params> = {}, placed: Params | null = {}): ClaimedMessage {
  return {
    id: "00000000-0000-4000-8000-000000000006",
    template: "office_message",
    channel: "email",
    params: {
      kind: "announcement",
      copy: {
        subject: NUDGE_WORDING.subject,
        paragraphs: [...NUDGE_WORDING.paragraphs],
        button_label: null,
        actions: [],
        tone: "office",
        step: 0,
      },
      data: { tribe: "Builders Tribe", first_name: "Adaeze", my_page: "/home", season_starts: "14 February 2027" },
      links: { stop: STOP, prefs: "9".repeat(64) },
      church: { name: "The Covenant Nation", address: "Iganmu, Lagos, Nigeria" },
      ...(placed ? { placed: { mode: "in_person", tribe: "Builders Tribe", secret: SECRET, meeting_day: 2, meeting_time: "19:00", leader_first: "Ngozi", ...placed } } : {}),
      ...over,
    },
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "adaeze@example.org", phone: "+2348031234567", name: "Adaeze Okafor", first_name: "Adaeze" },
  };
}

const render = (over: Partial<Params> = {}, placed: Params | null = {}) => renderEmail(message(over, placed), SITE);

describe("the nudge email", () => {
  it("names the tribe, when it meets and who leads it, in a subject that fits a phone's lock screen", () => {
    const mail = render();
    expect(mail.subject).toBe("One tap keeps your place in Builders Tribe");
    expect(mail.subject.length).toBeLessThanOrEqual(SUBJECT_MAX);
    expect(mail.text).toContain("Hi Adaeze,");
    expect(mail.text).toContain("Your place is held: Builders Tribe, Tuesdays at 7:00 pm, in person, with Ngozi.");
    expect(mail.html).toContain("Ngozi is looking forward to meeting you.");
  });

  it("cuts a long subject to 78 characters", () => {
    const mail = render({ copy: { subject: `One tap keeps your place in {tribe} ${"and so on ".repeat(20)}`, paragraphs: ["Hello."], step: 0 } });
    expect(mail.subject.length).toBeLessThanOrEqual(SUBJECT_MAX);
  });

  it("always carries the three buttons, each with the member's own private link", () => {
    const mail = render();
    expect(mail.text).toContain(`${NUDGE_BUTTONS.yes}: ${SITE}/placed/${SECRET}?a=confirm`);
    expect(mail.text).toContain(`${NUDGE_BUTTONS.other}: ${SITE}/placed/${SECRET}?a=change`);
    expect(mail.text).toContain(`${NUDGE_BUTTONS.withhold}: ${SITE}/placed/${SECRET}?a=withhold`);
    for (const a of ["confirm", "change", "withhold"]) expect(mail.html).toContain(`${SITE}/placed/${SECRET}?a=${a}`);
    const links = mail.text.match(/\/placed\/[a-f0-9]{64}\?a=[a-z]+/g) ?? [];
    expect(new Set(links).size).toBe(3);
  });

  it("ignores any button a writer tried to add, so the three cannot become one", () => {
    const mail = render({
      copy: { subject: NUDGE_WORDING.subject, paragraphs: [...NUDGE_WORDING.paragraphs], button_label: "Open my page", actions: ["done"], step: 0 },
      links: { go: "b".repeat(64), stop: STOP, prefs: "9".repeat(64) },
    });
    expect(mail.text).not.toContain("Open my page");
    expect(mail.text).not.toContain(`/e/${"b".repeat(64)}`);
    expect(mail.text).toContain(NUDGE_BUTTONS.yes);
  });

  it("says who can see a number, and puts the line back if a writer takes it out", () => {
    expect(render().text).toContain(LOCKED_PARAGRAPH);
    const bare = render({ copy: { subject: "Your place", paragraphs: ["Just one line."], step: 0 } });
    expect(bare.text).toContain(LOCKED_PARAGRAPH);
    const once = render().text.split(LOCKED_PARAGRAPH).length - 1;
    expect(once).toBe(1);
    // and the writer cannot make it appear twice by writing it too
    const doubled = render({ copy: { subject: "Your place", paragraphs: ["One.", LOCKED_PARAGRAPH, "Two."], step: 0 } });
    expect(doubled.text.split(LOCKED_PARAGRAPH).length - 1).toBe(1);
  });

  it("has no phone number in it, in the text or the page, however the member's details look", () => {
    const mail = render();
    const stripped = (s: string) => s.replace(/[a-f0-9]{64}/g, "");
    for (const body of [stripped(mail.text), stripped(mail.html)]) {
      expect(body).not.toMatch(/\d{7,}/);
      expect(body).not.toContain("+234");
      expect(body).not.toContain("8031234567");
      expect(body).not.toContain("•");
    }
    expect(mail.subject).not.toMatch(/\d{7,}/);
  });

  it("is honest in the footer: why they got it, and one click to stop announcements", () => {
    const mail = render();
    expect(mail.text).toContain("because the church placed you in a tribe");
    expect(mail.text).toContain("Stop announcements");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("is an ordinary announcement when there is no private link, so a nudge can never go out without one", () => {
    const plain = render({}, null);
    expect(plain.text).not.toContain("/placed/");
    expect(plain.text).not.toContain(LOCKED_PARAGRAPH);
    const broken = render({}, { secret: "not-a-link" });
    expect(broken.text).not.toContain("/placed/");
  });

  it("holds the ready wording to the words the announcement check allows", () => {
    const allowed = /\{(first_name|tribe|season_starts|my_page)\}/g;
    for (const t of [NUDGE_WORDING.subject, ...NUDGE_WORDING.paragraphs]) {
      const left = t.replace(allowed, "");
      expect(left).not.toMatch(/[{}]/);
      expect(t).not.toMatch(/\d{5,}|\+\d/);
    }
    expect(NUDGE_WORDING.subject.replace("{tribe}", "A tribe with a rather long name indeed, long").length).toBeLessThanOrEqual(SUBJECT_MAX + 20);
    expect(NUDGE_WORDING.paragraphs.join(" ")).toMatch(/choice is yours/);
  });

  it("puts the locked paragraph before the last paragraph, or after the only one", () => {
    expect(withLocked(["a"])).toEqual(["a", LOCKED_PARAGRAPH]);
    expect(withLocked(["a", "b", "c"])).toEqual(["a", "b", LOCKED_PARAGRAPH, "c"]);
    expect(withLocked([])).toEqual([LOCKED_PARAGRAPH]);
    expect(withLocked(["a", `  ${LOCKED_PARAGRAPH.toUpperCase()} `])).toEqual(["a", `  ${LOCKED_PARAGRAPH.toUpperCase()} `]);
  });
});

describe("the small readers", () => {
  it("know a link when it is 64 hex characters", () => {
    expect(isNudgeLink(SECRET)).toBe(true);
    for (const bad of ["", "abc", `${SECRET}0`, SECRET.toUpperCase(), 5, null, undefined]) expect(isNudgeLink(bad)).toBe(false);
  });

  it("read the state, defaulting to off", () => {
    expect(parseNudgeState("on")).toBe("on");
    expect(parseNudgeState("rehearsal")).toBe("rehearsal");
    for (const bad of ["maybe", null, undefined, 1, {}]) expect(parseNudgeState(bad)).toBe("off");
  });

  it("read the home card's numbers, and say them plainly", () => {
    expect(parseNudgeOverview({ state: "on", waiting: 12, waited_two_days: 7 })).toEqual({ state: "on", waiting: 12, waitedTwoDays: 7 });
    expect(parseNudgeOverview({ state: "off" })).toEqual({ state: "off", waiting: 0, waitedTwoDays: 0 });
    expect(parseNudgeOverview(null)).toEqual({ state: "off", waiting: 0, waitedTwoDays: 0 });
    expect(parseNudgeOverview({ state: "on", waiting: -3, waited_two_days: "x" })).toEqual({ state: "on", waiting: 0, waitedTwoDays: 0 });
    expect(NUDGE_CARD.line(12, 7)).toBe("12 placed members are waiting for a reply. 7 have waited more than 2 days.");
    expect(NUDGE_CARD.line(1, 1)).toBe("1 placed member is waiting for a reply. 1 has waited more than 2 days.");
    expect(NUDGE_CARD.line(5, 0)).toBe("5 placed members are waiting for a reply.");
    expect(NUDGE_CARD.line(0, 0)).toBe("No placed member is waiting for a reply.");
  });

  it("read the leader's marks and drop anything that is not a row", () => {
    expect(parseNudgeMarks([{ person_id: "p1", reminded_at: "2026-11-10T08:00:00Z", number_confirmed: true }, { person_id: "p2", reminded_at: null, number_confirmed: false }, null, { reminded_at: "x" }, 4])).toEqual([
      { personId: "p1", remindedAt: "2026-11-10T08:00:00Z", numberConfirmed: true },
      { personId: "p2", remindedAt: null, numberConfirmed: false },
    ]);
    expect(parseNudgeMarks(null)).toEqual([]);
    expect(parseNudgeMarks({})).toEqual([]);
  });

  it("read the confirmed counts and who is confirmed", () => {
    expect(parseConfirmedCounts({ agreed: 40, confirmed: 18 })).toEqual({ agreed: 40, confirmed: 18 });
    expect(parseConfirmedCounts("x")).toBeNull();
    expect(parseConfirmedFor({ a: "signin", b: 4, c: "message" })).toEqual({ a: "signin", c: "message" });
    expect(parseConfirmedFor([])).toEqual({});
  });

  it("read the owner's settings and refuse nonsense", () => {
    expect(parseNudgeSettings({ first_after_hours: 24, spacing_days: 3, max_per_seat: 2, reason: "Because", changed_at: "2026-11-06T10:00:00Z" })).toEqual({
      firstAfterHours: 24,
      spacingDays: 3,
      maxPerSeat: 2,
      reason: "Because",
      changedAt: "2026-11-06T10:00:00Z",
    });
    expect(parseNudgeSettings({ first_after_hours: 0, spacing_days: 0, max_per_seat: 0 })).toMatchObject({ firstAfterHours: 0, spacingDays: 1, maxPerSeat: 1 });
    expect(parseNudgeSettings(null)).toBeNull();
  });

  it("read the private page's information, showing nothing unless the nudge is on for them", () => {
    expect(parseNudgePageInfo({ on: true, number: "+234••••••••22", signin: null, yes: false })).toEqual({ on: true, number: "+234••••••••22", signin: null, yes: false });
    for (const off of [{ on: false }, { on: "true" }, null, undefined, "on", []]) expect(parseNudgePageInfo(off)).toEqual({ on: false, number: null, signin: null, yes: false });
  });

  it("tell a link that ran out from a seat that is gone and from one we never made", () => {
    expect(parseLinkState({ state: "ok" })).toBe("ok");
    expect(parseLinkState({ state: "expired" })).toBe("expired");
    expect(parseLinkState({ state: "gone" })).toBe("gone");
    for (const bad of [{ state: "weird" }, null, "ok", undefined]) expect(parseLinkState(bad)).toBe("unknown");
  });

  it("read the answer to a press", () => {
    expect(parseChoose({ ok: true, mode: "whatsapp", confirmed: true })).toEqual({ ok: true, mode: "whatsapp", confirmed: true });
    expect(parseChoose({ ok: true, mode: "email" })).toEqual({ ok: true, mode: "email", confirmed: false });
    expect(parseChoose({ ok: false, reason: "invalid" })).toEqual({ ok: false, reason: "invalid" });
    expect(parseChoose({ ok: false, reason: "not_available" })).toEqual({ ok: false, reason: "not_available" });
    expect(parseChoose({ ok: false, reason: "started" })).toEqual({ ok: false, reason: "started" });
    expect(parseChoose({ ok: false, reason: "mystery" })).toEqual({ ok: false, reason: "other" });
    expect(parseChoose(null)).toEqual({ ok: false, reason: "other" });
  });
});
