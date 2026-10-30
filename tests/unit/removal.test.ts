import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPEAL_DAYS, BOARD_OFF, DECISION_NOTE_MIN, MAX_OPEN, MINE_OFF, NOTE_MAX, NOTE_MIN, REASONS, REMOVAL_WORDS, STATUS_LINE,
  needsAction, noteProblem, parseBoard, parseMine, parseMyRemoval, reasonLabel, type BoardRequest,
} from "@/lib/removal/removal";

const sql = readFileSync(join(__dirname, "../../supabase/migrations/20270103000400_removal_requests.sql"), "utf8");
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

describe("the limits and reasons agree with the database", () => {
  it("offers exactly the five reasons the database accepts", () => {
    const inSql = /p_reason not in \(([^)]*)\)/.exec(sql)![1].match(/'([a-z_]+)'/g)!.map((s) => s.replace(/'/g, ""));
    expect(REASONS.map((r) => r.id)).toEqual(inSql);
    expect(reasonLabel("conflict")).toBe("Conflict in the tribe");
    expect(reasonLabel("nonsense")).toBe("Something else");
  });

  it("uses the same note length, number of open requests and days to ask again as the database", () => {
    expect(sql).toContain(`char_length(v_note) < ${NOTE_MIN} or char_length(v_note) > ${NOTE_MAX}`);
    expect(sql).toContain(`v_open >= ${MAX_OPEN}`);
    expect(sql).toMatch(new RegExp(`interval '${APPEAL_DAYS} days'`));
    expect(DECISION_NOTE_MIN).toBe(10);
  });

  it("explains a note that is too short or too long, and accepts the edges", () => {
    expect(noteProblem("x".repeat(19))).toMatch(/at least 20 characters \(19 so far\)/);
    expect(noteProblem("x".repeat(20))).toBeNull();
    expect(noteProblem(`  ${"x".repeat(500)}  `)).toBeNull();
    expect(noteProblem("x".repeat(501))).toMatch(/500/);
  });
});

describe("what the leader's page reads", () => {
  it("is Off for anything that is not clearly On or Rehearsal with permission to ask", () => {
    for (const bad of [null, undefined, 3, "x", [], {}, { state: "off", can_ask: true }, { state: "on", can_ask: false }, { state: "bogus", can_ask: true }]) expect(parseMine(bad)).toEqual(MINE_OFF);
  });

  it("reads the requests, skips malformed ones and fills what is missing", () => {
    const m = parseMine({
      state: "rehearsal", can_ask: true, open: 1, max: 2,
      requests: [
        { id: ID, member_id: ID2, member_first: "Bola", status: "open", waiting_on: "leader", rehearsal: true, created_at: "2027-03-01T10:00:00Z", question: "How long?", decision_note: null },
        { id: 7 },
        null,
        { id: ID2, member_id: ID, status: "declined", decision_note: "Please keep visiting." },
      ],
    });
    expect(m.state).toBe("rehearsal");
    expect(m.requests).toHaveLength(2);
    expect(m.requests[0]).toMatchObject({ member_first: "Bola", waiting_on: "leader", rehearsal: true, question: "How long?" });
    expect(m.requests[1]).toMatchObject({ member_first: "Your member", status: "declined", waiting_on: "approver", decision_note: "Please keep visiting." });
    expect(STATUS_LINE(m.requests[0])).toBe(REMOVAL_WORDS.waitingLeader);
    expect(STATUS_LINE(m.requests[1])).toBe(REMOVAL_WORDS.statusDeclined);
  });
});

describe("what the board reads", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    id: ID, tribe: "Builders", member: "Bola Ade", member_first: "Bola", under_18: false, leader: "Ngozi O", reason: "repeated_absence", note: "Missed five weeks.",
    note_cleared: false, urgent: false, restricted: false, rehearsal: false, status: "open", waiting_on: "approver", created_at: "2027-03-01T10:00:00Z", days: 4,
    reminded: true, escalated: false, decided_at: null, decided_by: null, decision_note: null, can_decide: true, can_reinstate: false, can_judge_appeal: false,
    reinstated_at: null, appeal: null, attendance: { present: 3, absent: 2, excused: 1 }, thread: [{ side: "approver", body: "How long?", at: "x" }, { side: "bogus", body: "no" }], ...over,
  });

  it("is Off for anything not in the shape", () => {
    for (const bad of [null, 3, "x", {}, { state: "off", requests: [raw()] }]) expect(parseBoard(bad)).toEqual(BOARD_OFF);
  });

  it("reads a request in full, drops a thread line with no side, and falls back safely", () => {
    const b = parseBoard({ state: "on", requests: [raw(), { nope: true }, raw({ id: ID2, reason: "weird", status: "weird", note: null, note_cleared: true, attendance: null })] });
    expect(b.requests).toHaveLength(2);
    expect(b.requests[0]).toMatchObject({ member: "Bola Ade", days: 4, reminded: true, can_decide: true, attendance: { present: 3, absent: 2, excused: 1 } });
    expect(b.requests[0].thread).toEqual([{ side: "approver", body: "How long?", at: "x" }]);
    expect(b.requests[1]).toMatchObject({ reason: "other", status: "open", note: null, note_cleared: true, attendance: { present: 0, absent: 0, excused: 0 } });
  });

  it("puts what needs a person first: an open request they may decide, or an appeal they may judge", () => {
    const [a, b, c, d] = parseBoard({
      state: "on",
      requests: [
        raw(),
        raw({ id: ID2, can_decide: false }),
        raw({ status: "approved", can_decide: false, appeal: { status: "open", note: "Please", at: "x" }, can_judge_appeal: true }),
        raw({ status: "approved", can_decide: false, appeal: { status: "upheld", at: "x" }, can_judge_appeal: false }),
      ],
    }).requests as BoardRequest[];
    expect([a, b, c, d].map(needsAction)).toEqual([true, false, true, false]);
    expect(c.appeal).toMatchObject({ status: "open", note: "Please" });
  });
});

describe("what the member reads", () => {
  it("is nothing without a tribe and an id", () => {
    for (const bad of [null, {}, { id: ID }, { tribe: "Builders" }, "x", 5]) expect(parseMyRemoval(bad)).toBeNull();
  });

  it("reads the notice, with a named person and the days left", () => {
    const r = parseMyRemoval({ id: ID, tribe: "Builders", decided_on: "2027-03-02", contact_first: "Grace", reinstated: false, appeal: null, can_appeal: true, appeal_until: "2027-03-16" });
    expect(r).toMatchObject({ tribe: "Builders", contact_first: "Grace", can_appeal: true, appeal: null, appeal_until: "2027-03-16" });
    expect(parseMyRemoval({ id: ID, tribe: "B", appeal: { status: "upheld", at: "x" } })!.appeal).toEqual({ status: "upheld", at: "x" });
    expect(parseMyRemoval({ id: ID, tribe: "B" })!.contact_first).toBe("the Care Team");
  });
});

describe("the words", () => {
  it("never tell a member who asked, why, or anything that reads as a verdict", () => {
    const toMember = [REMOVAL_WORDS.memberTitle("Builders"), REMOVAL_WORDS.memberBody, REMOVAL_WORDS.memberSpeak("Grace"), REMOVAL_WORDS.memberAppealIntro("Grace", "16 March 2027"), REMOVAL_WORDS.memberAppealWaiting, REMOVAL_WORDS.memberAppealUpheld, REMOVAL_WORDS.memberBack("Builders")].join(" ");
    expect(toMember).not.toMatch(/reason|conduct|safety|absence|the leader|asked the church|removed|expelled|banned|punish|fault/i);
    expect(toMember).toMatch(/Other tribes are open to you/);
  });

  it("tell the leader they are asking, not removing, and that the church decides", () => {
    expect(REMOVAL_WORDS.askIntro).toMatch(/not removing anyone/);
    expect(REMOVAL_WORDS.boardIntro).toMatch(/Silence never removes anyone/);
    expect(REMOVAL_WORDS.removeFromGroup).toMatch(/WhatsApp group/);
  });
});
