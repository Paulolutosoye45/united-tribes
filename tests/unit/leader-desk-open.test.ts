import { describe, expect, it } from "vitest";
import {
  EMPTY_PIPELINE,
  OPEN_WORDS,
  PIPELINE_RANGES,
  PIPELINE_STAGES,
  PIPELINE_WORDS,
  checkSettings,
  days,
  parseOpenPreview,
  parseOpenResult,
  parsePipeline,
} from "@/lib/god/desk-open";
import { renderEmail } from "@/lib/messaging/render";
import { NOTICE_SAMPLES } from "@/lib/messaging/templates-notices";
import type { ClaimedMessage, Params } from "@/lib/messaging/types";

// The Leader Desk, Phase 2b-2: the owner's screens' reading of what the database says about opening a tribe and about the pipeline, the limits form, and the
// pastors' reminder for a card that has waited a day.

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const SITE = "https://unitedtribes.example";

describe("reading the plan for opening a tribe", () => {
  const plan = {
    ok: true,
    problem: null,
    rehearsal: false,
    placement_on: true,
    tribe: { id: ID3, name: "Builders, weeknights", capacity: 8, active: 1 },
    members: [
      { person_id: ID, name: "Ada", said_yes: true, state: "ready", text: null },
      { person_id: ID2, name: "Bola", said_yes: false, state: "blocked", text: "Bola is already in another tribe" },
    ],
    counts: { ready: 1, seated: 0, not_placed: 1 },
  };

  it("reads a plan, with who can be placed and who cannot and why", () => {
    const p = parseOpenPreview(plan);
    expect(p).toMatchObject({ ok: true, rehearsal: false, placementOn: true, tribe: { name: "Builders, weeknights", capacity: 8, active: 1 }, counts: { ready: 1, seated: 0, notPlaced: 1 } });
    expect(p?.members).toEqual([
      { personId: ID, name: "Ada", saidYes: true, state: "ready", text: null },
      { personId: ID2, name: "Bola", saidYes: false, state: "blocked", text: "Bola is already in another tribe" },
    ]);
  });

  it("reads a group that cannot be opened yet as its reason, with nobody to place", () => {
    const p = parseOpenPreview({ ok: false, problem: "The leader has not been certified by the Academy yet", rehearsal: true, placement_on: false, tribe: null, members: [], counts: {} });
    expect(p).toMatchObject({ ok: false, problem: "The leader has not been certified by the Academy yet", rehearsal: true, placementOn: false, tribe: null, members: [] });
    expect(p?.counts).toEqual({ ready: 0, seated: 0, notPlaced: 0 });
  });

  it("drops a member it does not understand, and refuses anything that is not a plan", () => {
    const p = parseOpenPreview({ ...plan, members: [...plan.members, { person_id: "nope", name: "X", state: "ready" }, { person_id: ID3, name: "Y", state: "somewhere" }, "bad", null] });
    expect(p?.members.map((m) => m.personId)).toEqual([ID, ID2]);
    for (const v of [null, undefined, "x", 3, [], true]) expect(parseOpenPreview(v)).toBeNull();
  });

  it("is never more than the plan said: nothing is placed unless ok is exactly true", () => {
    expect(parseOpenPreview({ ...plan, ok: "true" })?.ok).toBe(false);
    expect(parseOpenPreview({ ...plan, placement_on: 1 })?.placementOn).toBe(false);
  });

  it("reads the result of opening, with each person left alone and the reason", () => {
    const r = parseOpenResult({ ok: true, rehearsal: false, placed: 2, would: 0, closed: false, not_placed: [{ person_id: ID2, name: "Bola", text: "No seat left" }, { person_id: "x", name: "?", text: "?" }, 4] });
    expect(r).toEqual({ rehearsal: false, placed: 2, would: 0, closed: false, notPlaced: [{ personId: ID2, name: "Bola", text: "No seat left" }] });
    expect(parseOpenResult({ ok: true, rehearsal: true, placed: 0, would: 3, closed: false, not_placed: [] })).toMatchObject({ rehearsal: true, placed: 0, would: 3 });
    expect(parseOpenResult({ ok: false })).toBeNull();
    expect(parseOpenResult(null)).toBeNull();
    expect(parseOpenResult({ ok: true, not_placed: [{ person_id: ID, name: "", text: "" }] })?.notPlaced[0]).toMatchObject({ name: "A member", text: "They could not be placed." });
  });

  it("says what happened in words, once, with the right singular and plural", () => {
    expect(OPEN_WORDS.placed(1)).toBe("1 person was placed.");
    expect(OPEN_WORDS.placed(3)).toBe("3 people were placed.");
    expect(OPEN_WORDS.would(1)).toBe("1 person would be placed. Nothing was done.");
    expect(OPEN_WORDS.counts(2, 1, 1)).toBe("2 can be placed, 1 already in, 1 cannot be placed");
    expect(OPEN_WORDS.counts(2, 0, 0)).toBe("2 can be placed");
    expect(OPEN_WORDS.tribe("The Builders", 3, 8)).toBe("The Builders: 3 of 8 seats taken");
    for (const s of ["seated", "ready", "blocked", "full"]) expect(OPEN_WORDS.states[s], s).toBeTruthy();
  });

  it("makes no promise that the Desk itself seats anyone, accepts a warning, or approves a card", () => {
    const all = JSON.stringify([OPEN_WORDS.intro, OPEN_WORDS.on, OPEN_WORDS.rehearsal, OPEN_WORDS.placementOff, OPEN_WORDS.left]);
    expect(all).toMatch(/the same way the office places one person/);
    expect(all).toMatch(/by hand/);
    expect(all).not.toMatch(/approve[sd]? (the|a) card for|certif(y|ies) the leader for|accept[s]? (the|a) warning/i);
  });
});

describe("reading the pipeline", () => {
  const row = (over: Record<string, unknown> = {}) => ({ group_id: ID, group: "Builders group", person_id: ID2, name: "Ngozi", stage: "card_waiting", since: "2026-11-05T10:00:00Z", hours: 80, limit_hours: 72, stuck: true, formed: true, tribe_id: ID3, ...over });
  const data = { settings: { offer_hours: 72, backups: 2, said_yes_days: 2, card_days: 3 }, stuck: 1, rows: [row(), row({ group_id: ID3, stage: "asked", hours: 5, limit_hours: 72, stuck: false, formed: false, tribe_id: null })] };

  it("reads each group's stage, how long it has been there, its limit and whether it is stuck", () => {
    const p = parsePipeline(data);
    expect(p?.settings).toEqual({ offerHours: 72, backups: 2, saidYesDays: 2, cardDays: 3 });
    expect(p?.stuck).toBe(1);
    expect(p?.rows[0]).toEqual({ groupId: ID, group: "Builders group", leaderId: ID2, name: "Ngozi", stage: "card_waiting", since: "2026-11-05T10:00:00Z", hours: 80, limitHours: 72, stuck: true, formed: true });
    expect(p?.rows[1]).toMatchObject({ stage: "asked", stuck: false, formed: false });
  });

  it("counts the stuck ones itself, from the rows, so the number always matches what is listed", () => {
    expect(parsePipeline({ ...data, stuck: 99 })?.stuck).toBe(1);
    expect(parsePipeline({ ...data, rows: [] })?.stuck).toBe(0);
  });

  it("has a limit only for the stages that have one", () => {
    const p = parsePipeline({ ...data, rows: [row({ stage: "ready", limit_hours: null, stuck: false })] });
    expect(p?.rows[0].limitHours).toBeNull();
    expect(p?.rows[0].stuck).toBe(false);
  });

  it("drops a row it does not understand, and refuses anything without the limits", () => {
    const p = parsePipeline({ ...data, rows: [row({ stage: "somewhere" }), row({ group_id: "no" }), "x", row()] });
    expect(p?.rows).toHaveLength(1);
    for (const v of [null, undefined, "x", [], {}, { rows: [] }]) expect(parsePipeline(v)).toBeNull();
  });

  it("has words for every stage the database can name, and the empty pipeline shows nothing", () => {
    for (const s of PIPELINE_STAGES) expect(PIPELINE_WORDS.stages[s], s).toBeTruthy();
    expect(PIPELINE_STAGES).toHaveLength(7);
    expect(EMPTY_PIPELINE.rows).toEqual([]);
    expect(PIPELINE_WORDS.stuck(1)).toBe("1 group is stuck");
    expect(PIPELINE_WORDS.stuck(3)).toBe("3 groups are stuck");
  });

  it("writes how long in hours and days", () => {
    expect(days(0)).toBe("0 hours");
    expect(days(1)).toBe("1 hour");
    expect(days(23)).toBe("23 hours");
    expect(days(24)).toBe("1 day");
    expect(days(49)).toBe("2 days 1 hour");
    expect(days(72)).toBe("3 days");
    expect(days(-5)).toBe("0 hours");
    expect(PIPELINE_WORDS.limit(48)).toBe("limit 2 days");
  });
});

describe("the limits form", () => {
  const ok = { offerHours: "72", backups: "2", saidYesDays: "2", cardDays: "3", reason: "Two days is too short for the pastors" };

  it("accepts whole numbers inside the database's ranges and a reason of 3 to 300 characters", () => {
    expect(checkSettings(ok)).toEqual({ ok: true, value: { offerHours: 72, backups: 2, saidYesDays: 2, cardDays: 3, reason: "Two days is too short for the pastors" } });
    expect(checkSettings({ ...ok, offerHours: "24", backups: "0", saidYesDays: "1", cardDays: "14", reason: "abc" }).ok).toBe(true);
    expect(checkSettings({ ...ok, offerHours: "240", backups: "2", saidYesDays: "14", reason: "x".repeat(300) }).ok).toBe(true);
    expect(checkSettings({ ...ok, offerHours: " 96 " })).toMatchObject({ ok: true, value: { offerHours: 96 } });
  });

  it("says which number is wrong, and what is allowed", () => {
    expect(checkSettings({ ...ok, offerHours: "23" })).toEqual({ ok: false, message: "Hours to answer an offer: between 24 and 240." });
    expect(checkSettings({ ...ok, offerHours: "241" }).ok).toBe(false);
    expect(checkSettings({ ...ok, backups: "3" })).toEqual({ ok: false, message: "Backups for each group: between 0 and 2." });
    expect(checkSettings({ ...ok, saidYesDays: "0" })).toEqual({ ok: false, message: "Days a yes may wait for you: between 1 and 14." });
    expect(checkSettings({ ...ok, cardDays: "15" })).toEqual({ ok: false, message: "Days a card may wait for the pastors: between 1 and 14." });
  });

  it("refuses anything that is not a whole number", () => {
    for (const bad of ["", " ", "two", "2.5", "-1", "1e2", "0x10", "7 days", "١٢"]) {
      expect(checkSettings({ ...ok, saidYesDays: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a missing, too short or too long reason", () => {
    for (const reason of ["", "  ", "ab", " a ", "x".repeat(301)]) {
      expect(checkSettings({ ...ok, reason })).toEqual({ ok: false, message: "Say why you are changing this, in 3 to 300 characters." });
    }
  });

  it("keeps the ranges the database enforces", () => {
    expect(PIPELINE_RANGES).toEqual({ offerHours: [24, 240], backups: [0, 2], saidYesDays: [1, 14], cardDays: [1, 14] });
  });
});

describe("the pastors' reminder for a card that has waited a day", () => {
  const sample = NOTICE_SAMPLES.pastor_card_waiting as unknown as Params;
  const message = (params: Params): ClaimedMessage => ({
    id: "00000000-0000-4000-8000-000000000009",
    template: "pastor_card_waiting",
    channel: "email",
    params,
    urgency: "normal",
    attempts: 1,
    reply_token: null,
    to: { email: "pastor@example.org", phone: null, name: "Pastor Example", first_name: "Pastor", ...{} },
  });
  const mail = (over: Params = {}) => renderEmail(message({ ...sample, ...over }), SITE);

  it("names the tribe and the leader's first name, and sends the pastor to the cards", () => {
    const m = mail();
    expect(m.subject).toBe("Builders Tribe is still waiting for review");
    expect(m.text).toContain("Ngozi sent in the Tribe Card for Builders Tribe a day ago");
    expect(m.html).toContain(`${SITE}/review/cards`);
  });

  it("has a subject short enough for a phone's lock screen, even for a long tribe name", () => {
    expect(mail().subject.length).toBeLessThan(80);
    const long = mail({ tribe: "A very long tribe name that goes on and on for a good while" });
    expect(long.subject).toContain("is still waiting for review");
  });

  it("falls back to plain words when the names are missing, and never prints markup it was given", () => {
    const plain = mail({ tribe: "", leader: "" });
    expect(plain.subject).toBe("A Tribe Card is still waiting for review");
    expect(plain.text).toContain("A leader sent in the Tribe Card for a tribe");
    const evil = mail({ tribe: "<script>alert(1)</script>", leader: "A & B" });
    expect(evil.html).not.toContain("<script>alert(1)</script>");
  });

  it("says nothing about a member: no name, no note, no reason", () => {
    const m = mail();
    expect(m.text).not.toMatch(/waiting members?:|note|reason|score|phone/i);
  });

  it("does not follow a path that is not on this site", () => {
    expect(mail({ path: "//evil.example/x" }).html).not.toContain("evil.example");
  });
});
