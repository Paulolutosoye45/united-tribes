import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanAudience, isAudienceKind, isFactKey, parseAnswered, parseCheckStatus, parseChecks, parseCodeChecked, parseCodeSent, parseLink, parsePage, parsePlan, parseReviews, parseSent, parseStageStatus,
} from "@/lib/profile/parse";
import { FACTS } from "@/lib/profile/registry";
import { AUDIENCES, FACT_KEYS, ITEM_STATUSES, LEFT_OUT_REASONS } from "@/lib/profile/types";
import { AUDIENCE_WORDS, CODE_WORDS, FACT_WORDS, LEFT_OUT_WORDS, OUTCOME_WORDS, STATUS_WORDS, standing } from "@/lib/profile/wording";

// What the website makes of the database's answers about My page, the stage reviews, the Details Check console and the private page.

const MIGRATION = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20270101000100_profiles_stage1.sql"), "utf8");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

describe("the facts and the words for them", () => {
  it("are the same facts the registry and the database name", () => {
    expect([...FACT_KEYS]).toEqual(FACTS.map((f) => f.key));
    const rows = [...MIGRATION.slice(MIGRATION.indexOf("insert into public.profile_fact_registry")).matchAll(/^\s+\('([a-z_]+)', '/gm)].slice(0, FACT_KEYS.length).map((m) => m[1]);
    expect(rows).toEqual([...FACT_KEYS]);
    expect(FACT_KEYS.every(isFactKey)).toBe(true);
    expect(isFactKey("shoe_size")).toBe(false);
    expect(AUDIENCES.every(isAudienceKind)).toBe(true);
    expect(isAudienceKind("everyone")).toBe(false);
  });

  it("have words for every fact, audience, reason, status and way an answer ends", () => {
    for (const k of FACT_KEYS) expect(FACT_WORDS[k].label.length, k).toBeGreaterThan(0);
    for (const a of AUDIENCES) expect(AUDIENCE_WORDS[a].name.length, a).toBeGreaterThan(0);
    for (const r of LEFT_OUT_REASONS) expect(LEFT_OUT_WORDS[r].length, r).toBeGreaterThan(0);
    for (const s of ITEM_STATUSES) expect(STATUS_WORDS[s].length, s).toBeGreaterThan(0);
    for (const o of ["confirmed", "recorded", "applied_now", "pending_review", "not_me", "later"] as const) expect(OUTCOME_WORDS[o].title.length, o).toBeGreaterThan(0);
  });

  it("say where a fact stands, in the person's own terms, and what a code mistake means", () => {
    expect(standing("person", true)).toBe("You told us this.");
    expect(standing("office", true)).toBe("You confirmed this.");
    expect(standing("office", false)).toBe("The church office suggested this. Please check it.");
    expect(standing("system", false)).toBe("We have this on record. Please check it.");
    expect(CODE_WORDS.locked(null)).toMatch(/30 minutes/);
    expect(CODE_WORDS.wrong(1)).toBe("That is not the code. 1 try left.");
    expect(CODE_WORDS.wrong(3)).toBe("That is not the code. 3 tries left.");
    expect(CODE_WORDS.wrong(null)).toBe("That is not the code.");
  });
});

describe("My page", () => {
  it("is not there when the database says it is not enabled, or says anything else", () => {
    for (const bad of [null, undefined, "x", {}, { enabled: false }, { enabled: "yes" }]) expect(parsePage(bad)).toEqual({ enabled: false });
  });

  it("reads each fact, keeps the change that is waiting, and drops a fact it does not know or that has no value", () => {
    const page = parsePage({
      enabled: true,
      first: "Ada",
      facts: [
        { key: "life_stage", label: "Stage of life", state: "unconfirmed", value: "builders", valueLabel: "26 to 40, the Builders stage", by: "office", at: "2027-01-02T09:00:00Z", options: [{ value: "rising", label: "18 to 25", detail: null }, { value: 3 }], change: { status: "pending", newLabel: "Stewards", dueOn: "2027-01-09", at: "2027-01-04T09:00:00Z" }, last: { event: "pending", at: "2027-01-04T09:00:00Z" } },
        { key: "shoe_size", value: "9" },
        { key: "age_range", state: "confirmed" },
        { key: "age_range", value: "41-50", state: "bogus", change: { status: "weird" } },
      ],
    });
    if (!page.enabled) throw new Error("expected My page to be enabled");
    expect(page.first).toBe("Ada");
    expect(page.facts.map((f) => f.key)).toEqual(["life_stage", "age_range"]);
    const [stage, age] = page.facts;
    expect(stage).toMatchObject({ state: "unconfirmed", valueLabel: "26 to 40, the Builders stage", by: "office", question: "We have you down as 26 to 40, the Builders stage. Is that right?" });
    expect(stage.options).toEqual([{ value: "rising", label: "18 to 25", detail: null }]);
    expect(stage.change).toMatchObject({ status: "pending", newLabel: "Stewards", dueOn: "2027-01-09" });
    expect(stage.last).toEqual({ event: "pending", at: "2027-01-04T09:00:00Z" });
    // an unknown state is read as not yet confirmed (never the other way), and an unknown change is no change
    expect(age).toMatchObject({ state: "unconfirmed", valueLabel: "41-50", change: null, last: null });
  });

  it("reads an answer: a known outcome, or a refusal with its words, or something unknown", () => {
    expect(parseAnswered({ ok: true, outcome: "pending_review" })).toEqual({ ok: true, outcome: "pending_review" });
    expect(parseAnswered({ ok: true, outcome: "teleported" })).toEqual({ ok: false, reason: "unknown", message: null });
    expect(parseAnswered({ ok: false, reason: "bad_value", message: "Choose one from the list" })).toEqual({ ok: false, reason: "bad_value", message: "Choose one from the list" });
    expect(parseAnswered(null)).toEqual({ ok: false, reason: "unknown", message: null });
  });
});

describe("the pastor's stage reviews", () => {
  it("reads each review, keeps the pending ones pending, and tells who may decide", () => {
    const r = parseReviews({ canDecide: true, reviews: [{ id: "a", person: "Ngozi", fact: "Stage of life", oldLabel: "Stewards", newLabel: "Builders", members: 2, dueOn: "2027-01-09", overdue: true, status: "approved", decidedAt: "2027-01-05T10:00:00Z" }, { id: "b", status: "weird" }, { person: "no id" }, null] });
    expect(r?.canDecide).toBe(true);
    expect(r?.reviews.map((x) => [x.id, x.status])).toEqual([["a", "approved"], ["b", "pending"]]);
    expect(r?.reviews[0]).toMatchObject({ person: "Ngozi", members: 2, overdue: true, decidedAt: "2027-01-05T10:00:00Z", tribe: null, note: null });
    expect(r?.reviews[1]).toMatchObject({ person: "Someone", first: "They", fact: "Detail", members: 0, overdue: false });
    expect(parseReviews({ reviews: [] })).toEqual({ canDecide: false, reviews: [] });
    expect(parseReviews("x")).toBeNull();
  });

  it("reads the line shown beside a Tribe Card, with the hold only when it is one the database knows", () => {
    expect(parseStageStatus({ state: "confirmed", leader: "Builders", card: "Builders", differs: false, hold: "required", pending: null })).toEqual({ state: "confirmed", leader: "Builders", card: "Builders", differs: false, hold: "required", pending: null });
    expect(parseStageStatus({ state: "unconfirmed", hold: "banana", differs: true })).toMatchObject({ state: "unconfirmed", hold: "off", differs: true, leader: null });
    expect(parseStageStatus({})).toBeNull();
    expect(parseStageStatus(null)).toBeNull();
  });
});

describe("the owner's Details Check console", () => {
  it("reads a count of who would be asked and who is left out, keeping only the reasons that have someone in them", () => {
    expect(parsePlan({ asked: 3, leftOut: { under_18: 2, already_confirmed: 0, invented: 9, no_channel: 1 }, facts: ["life_stage", "shoe_size"] })).toEqual({ asked: 3, leftOut: { under_18: 2, no_channel: 1 }, facts: ["life_stage"] });
    expect(parsePlan({ leftOut: {} })).toBeNull();
  });

  it("reads what was sent, and calls anything but a live run a rehearsal", () => {
    expect(parseSent({ ok: true, check: "c1", asked: 2, mode: "live", leftOut: { already_asked: 1 } })).toEqual({ check: "c1", asked: 2, mode: "live", leftOut: { already_asked: 1 } });
    expect(parseSent({ ok: true, check: "c1", mode: "whatever" })).toMatchObject({ mode: "rehearsal", asked: 0 });
    expect(parseSent({ ok: false })).toBeNull();
  });

  it("reads the list of runs, and the people in one, with a status it does not know read as waiting", () => {
    const list = parseChecks([{ id: "c1", at: "t", mode: "live", facts: ["life_stage"], audience: "appointed", asked: 2, leftOut: { under_18: 1 }, closed: false, counts: { confirmed: 1, queued: 1, nonsense: 4 } }, { nope: 1 }]);
    expect(list).toHaveLength(1);
    expect(list[0].counts).toEqual({ confirmed: 1, queued: 1 });
    const status = parseCheckStatus({ id: "c1", mode: "rehearsal", asked: 1, corrected: 1, people: [{ id: "p1", name: "Ada Test", status: "mystery", sent: true, channel: "email", opened: true }, { name: "no id" }] });
    expect(status?.corrected).toBe(1);
    expect(status?.people).toHaveLength(1);
    expect(status?.people[0]).toMatchObject({ status: "queued", sent: true, channel: "email", opened: true, reminded: false, wouldSend: null });
    expect(parseCheckStatus({})).toBeNull();
  });

  it("sends the database one of five kinds of audience and nothing else", () => {
    expect(cleanAudience({ kind: "appointed" }, isUuid)).toEqual({ kind: "appointed" });
    expect(cleanAudience({ kind: "leaders", extra: 1 }, isUuid)).toEqual({ kind: "leaders" });
    expect(cleanAudience({ kind: "unconfirmed" }, isUuid)).toEqual({ kind: "unconfirmed" });
    expect(cleanAudience({ kind: "tribe", tribe: uuid(1) }, isUuid)).toEqual({ kind: "tribe", tribe: uuid(1) });
    expect(cleanAudience({ kind: "tribe", tribe: "not-an-id" }, isUuid)).toBeNull();
    expect(cleanAudience({ kind: "list", people: [uuid(1), uuid(2)] }, isUuid)).toEqual({ kind: "list", people: [uuid(1), uuid(2)] });
    expect(cleanAudience({ kind: "list", people: [] }, isUuid)).toBeNull();
    expect(cleanAudience({ kind: "list", people: [uuid(1), "x"] }, isUuid)).toBeNull();
    expect(cleanAudience({ kind: "list", people: Array.from({ length: 401 }, (_x, i) => uuid(i + 1)) }, isUuid)).toBeNull();
    expect(cleanAudience({ kind: "everyone" }, isUuid)).toBeNull();
    expect(cleanAudience("appointed", isUuid)).toBeNull();
  });
});

describe("the private page", () => {
  it("says nothing about a link that is not found, only whether signing in would help", () => {
    expect(parseLink(null)).toEqual({ found: false, reason: null });
    expect(parseLink({ found: false, reason: "signed_out" })).toEqual({ found: false, reason: "signed_out" });
    expect(parseLink({ found: false, reason: "other_account", leaked: "Ada" })).toEqual({ found: false, reason: "other_account" });
    expect(parseLink({ found: false, reason: "whose" })).toEqual({ found: false, reason: null });
    expect(parseLink({ found: true, key: "shoe_size" })).toEqual({ found: false, reason: null });
  });

  it("asks for a code when the database says so, shows a finished page, or one question", () => {
    expect(parseLink({ found: true, needsCode: true })).toEqual({ found: true, needsCode: true });
    expect(parseLink({ found: true, done: true, first: "Ada", waiting: true })).toEqual({ found: true, done: true, first: "Ada", waiting: true });
    const q = parseLink({ found: true, done: false, first: "Ada", key: "life_stage", label: "Stage of life", question: "Is that right?", valueLabel: "Builders", options: [{ value: "a", label: "A" }], left: 2 });
    expect(q).toMatchObject({ found: true, done: false, key: "life_stage", left: 2, options: [{ value: "a", label: "A", detail: null }] });
  });

  it("reads the sending of a code and the checking of one without trusting either", () => {
    expect(parseCodeSent({ ok: true, via: "sms", to: "+234 ••• 567" })).toEqual({ ok: true, via: "sms", to: "+234 ••• 567" });
    expect(parseCodeSent({ ok: true, via: "whatsapp", to: "x" })).toEqual({ ok: false, reason: "invalid", minutes: null });
    expect(parseCodeSent({ ok: false, reason: "locked", minutes: 30 })).toEqual({ ok: false, reason: "locked", minutes: 30 });
    expect(parseCodeSent(undefined)).toEqual({ ok: false, reason: "invalid", minutes: null });
    const session = "a".repeat(64);
    expect(parseCodeChecked({ ok: true, session })).toEqual({ ok: true, session });
    expect(parseCodeChecked({ ok: true, session: "short" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(parseCodeChecked({ ok: false, reason: "wrong", triesLeft: 3 })).toEqual({ ok: false, reason: "wrong", minutes: null, triesLeft: 3 });
    expect(parseCodeChecked({ ok: false, reason: "locked", minutes: 30 })).toMatchObject({ reason: "locked", minutes: 30 });
  });
});
