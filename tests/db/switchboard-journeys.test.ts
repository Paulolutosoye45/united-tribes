import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";
import { ALL_OFF, ELIG_KEYS, OPEN_DOOR, answers, inDays, pipelineKit, setPositions, type PipelineKit, type Pos, type Positions } from "./pipeline-kit";

// Phase A, part two: whole applications taken through the database under every position of the switches, as the applicant, the panel
// and the pastor would, and the rules that must hold wherever the switches stand.

let db: TestDb;
let kit: PipelineKit;
let staff: Awaited<ReturnType<PipelineKit["panel"]>>;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const asUser = <T>(id: string, text: string, params: unknown[] = []) => db.asUser(id, async (q) => (await q(text, params)).rows[0] as T);

beforeAll(async () => {
  db = await createTestDb();
  kit = pipelineKit(db);
  staff = await kit.panel();
});
afterAll(async () => {
  await db?.close();
});

const eligibility = (p: Pos) => Object.fromEntries(ELIG_KEYS.map((k) => [k, p])) as Record<(typeof ELIG_KEYS)[number], Pos>;

type Journey = { name: string; positions: Positions; optionalReferees?: number; holdOptionalInterview?: boolean };

// 20 = every position of references (required, optional with none, one and two referees, off) against every position of the interview
// (required, optional skipped, optional held, off); then 7 that change the eligibility questions.
const REFS: { label: string; positions: Pos; optionalReferees?: number }[] = [
  { label: "references required", positions: "required" },
  { label: "references optional (none added)", positions: "optional", optionalReferees: 0 },
  { label: "references optional (one added)", positions: "optional", optionalReferees: 1 },
  { label: "references optional (two added)", positions: "optional", optionalReferees: 2 },
  { label: "references off", positions: "off" },
];
const INTERVIEWS: { label: string; positions: Pos; hold?: boolean }[] = [
  { label: "interview required", positions: "required" },
  { label: "interview optional (skipped)", positions: "optional", hold: false },
  { label: "interview optional (held)", positions: "optional", hold: true },
  { label: "interview off", positions: "off" },
];
const JOURNEYS: Journey[] = [
  ...REFS.flatMap((r) =>
    INTERVIEWS.map((i) => ({
      name: `${r.label}, ${i.label}`,
      positions: { references: r.positions, interview: i.positions } as Positions,
      optionalReferees: r.optionalReferees,
      holdOptionalInterview: i.hold,
    })),
  ),
  { name: "the open door", positions: OPEN_DOOR },
  { name: "every question optional", positions: { eligibility: eligibility("optional") } },
  { name: "every question off", positions: { eligibility: eligibility("off") } },
  { name: "every question off, no references, no interview", positions: ALL_OFF },
  { name: "mixed questions", positions: { eligibility: { member6: "off", age21: "optional", time: "optional" }, references: "optional", interview: "optional" }, optionalReferees: 1, holdOptionalInterview: true },
  { name: "only the safeguarding question asked", positions: { eligibility: { member6: "off", foundation: "off", serving: "off", age21: "off", time: "off", confidentiality: "off" }, references: "off" } },
  { name: "questions optional, no interview", positions: { eligibility: eligibility("optional"), interview: "off" } },
];

describe("27 whole applications, one for every position that matters", () => {
  it("has the 27 journeys it says it has", () => {
    expect(JOURNEYS).toHaveLength(27);
  });

  for (const j of JOURNEYS) {
    it(j.name, async () => {
      const w = await kit.walk(j.positions, { staff, optionalReferees: j.optionalReferees, holdOptionalInterview: j.holdOptionalInterview });
      const refMode = j.positions.references ?? "required";
      const intMode = j.positions.interview ?? "required";
      const refsCounted = refMode === "required" || (refMode === "optional" && (j.optionalReferees ?? 0) >= 1);
      const interviewHeld = intMode === "required" || (intMode === "optional" && !!j.holdOptionalInterview);

      // It ends in the decision, and the role is given
      expect(w.decided.ok).toBe(true);
      expect(w.decided.status).toBe("approved_leader");
      expect(w.role).toBe(true);

      // The score is the same bar on the evidence that exists: every part here is a perfect one, so anything counted gives 100
      expect(Number(w.ready.readiness)).toBe(100);
      expect(w.ready.band).toBe("leader");
      expect(w.ready.counted).toEqual(["calling", "scenarios", ...(refsCounted ? ["references"] : []), ...(interviewHeld ? ["interview"] : [])]);
      expect(w.ready.evidence).toBe(refsCounted && interviewHeld ? "full" : "reduced");
      expect(w.ready.modes).toEqual({ references: refMode, interview: intMode });

      // The record of what applied when it was sent, and what the decision rested on
      const policy = (await sql("select * from public.leader_application_policy where application_id = $1", [w.appId]))[0];
      expect(policy.at_send.references).toBe(refMode);
      expect(policy.at_send.interview).toBe(intMode);
      for (const k of ELIG_KEYS) expect(policy.at_send.eligibility[k]).toBe(j.positions.eligibility?.[k] ?? "required");
      expect(policy.at_decision.modes.references).toBe(refMode);
      expect(policy.at_decision.modes.interview).toBe(intMode);
      expect(Number(policy.at_decision.readiness)).toBe(100);
      expect(policy.evidence).toBe(refsCounted && interviewHeld ? "full" : "reduced");
      expect(policy.decided_at).not.toBeNull();

      // An interview that was not held leaves no slot behind
      if (!interviewHeld) expect(w.slotId).toBeNull();

      // The applicant's messages only mention the steps that apply to them
      const received = await sql("select params from public.messages where person_id = $1 and template = 'application_received'", [w.user.id]);
      expect(received).toHaveLength(1);
      const p = received[0].params as Record<string, unknown>;
      expect(p.refs).toBe(refMode === "off" ? false : undefined);
      expect(p.refs_optional).toBe(refMode === "optional" ? true : undefined);
      expect(p.interview).toBe(intMode === "off" ? false : undefined);
      const approved = await sql("select params from public.messages where person_id = $1 and template = 'application_approved'", [w.user.id]);
      expect(approved).toHaveLength(1);

      // Nothing the applicant can reach holds the evidence or the note
      await expect(asUser(w.user.id, "select * from public.leader_application_policy")).rejects.toThrow(/permission denied/i);
      await expect(asUser(w.user.id, "select public.review_application($1) as r", [w.appId])).rejects.toMatchObject({ code: "42501" });
      const own = await asUser<{ r: Row }>(w.user.id, "select public.my_application_modes($1) as r", [w.appId]);
      expect(Object.keys(own.r).sort()).toEqual(["eligibility", "interview", "references", "sent"]);
      expect(JSON.stringify(own.r)).not.toMatch(/evidence|reduced|score|readiness/i);
    });
  }
});

describe("the form and the database agree on which questions are asked", () => {
  // A small deterministic shuffle so the same 40 combinations run every time
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const combos = Array.from({ length: 40 }, () => Object.fromEntries(ELIG_KEYS.map((k) => [k, (["required", "optional", "off"] as Pos[])[Math.floor(next() * 3)]])) as Record<string, Pos>);

  it("answering exactly what is required passes, an optional no never blocks, and a missing required answer is refused", async () => {
    for (const [i, combo] of combos.entries()) {
      await setPositions(db, { eligibility: combo, references: "off" });
      const required = ELIG_KEYS.filter((k) => combo[k] === "required");
      const given: Record<string, boolean> = {};
      for (const k of ELIG_KEYS) {
        if (combo[k] === "required") given[k] = true;
        else if (combo[k] === "optional") given[k] = false;
      }
      const user = await kit.person();
      const appId = await kit.startDraft(user.id, answers(Object.keys(given).length ? given : undefined));
      const check = await asUser<{ r: Row }>(user.id, "select public.check_leader_eligibility($1) as r", [appId]);
      expect(check.r.ok, `combo ${i}`).toBe(true);
      await expect(asUser(user.id, "select public.submit_leader_application($1) as r", [appId])).resolves.toMatchObject({ r: { ok: true } });

      if (required.length > 0) {
        const gap = { ...given };
        delete gap[required[0]];
        const user2 = await kit.person();
        const appId2 = await kit.startDraft(user2.id, answers(Object.keys(gap).length ? gap : undefined));
        await expect(asUser(user2.id, "select public.check_leader_eligibility($1) as r", [appId2])).rejects.toThrow(required.length === 7 ? /Answer all seven questions/ : /Answer all the questions/);
        await expect(asUser(user2.id, "select public.submit_leader_application($1) as r", [appId2])).rejects.toThrow(/Complete the eligibility questions first/);

        const no = { ...given, [required[0]]: false };
        const user3 = await kit.person();
        const appId3 = await kit.startDraft(user3.id, answers(no));
        const stop = await asUser<{ r: Row }>(user3.id, "select public.check_leader_eligibility($1) as r", [appId3]);
        expect(stop.r.ok).toBe(false);
        expect(stop.r.failed).toEqual([required[0]]);
        expect((await kit.appRow(appId3)).status).toBe("ineligible");
      }
    }
    await setPositions(db);
  });
});

describe("a switch moved while people are part-way through", () => {
  it("a draft follows the position now, and a sent application can only get easier", async () => {
    await setPositions(db);
    const w = await kit.walk({}, { staff }); // a whole one at today's positions, for the contrast
    expect((await kit.modes(w.appId)).references).toBe("required");

    // Sent under references Required, waiting for them
    const waiting = await (async () => {
      const user = await kit.person();
      const appId = await kit.startDraft(user.id);
      await kit.setReferee(user.id, appId, 1, true);
      await kit.setReferee(user.id, appId, 2, false);
      await kit.send(user.id, appId);
      await kit.review(staff.coach.id, appId, "calling", 4);
      await kit.review(staff.scorer.id, appId, "calling", 4);
      return { user, appId };
    })();
    await expect(db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [waiting.appId]))).rejects.toThrow(/Both references must be in first/);

    // References go off: the waiting application is released
    await setPositions(db, { references: "off" });
    expect((await kit.modes(waiting.appId)).references).toBe("off");
    await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [waiting.appId]));
    expect((await kit.appRow(waiting.appId)).status).toBe("interview_invited");

    // An application sent while references were off is never pulled back when they come on
    await setPositions(db, { references: "off" });
    const eased = await kit.person();
    const easedApp = await kit.startDraft(eased.id);
    await kit.send(eased.id, easedApp);
    await setPositions(db, { references: "required" });
    expect((await kit.modes(easedApp)).references).toBe("off");
    // while a draft started now is asked for them
    const fresh = await kit.person();
    const freshApp = await kit.startDraft(fresh.id);
    expect((await kit.modes(freshApp)).references).toBe("required");
    await expect(kit.send(fresh.id, freshApp)).rejects.toThrow(/Add both referees/);
    await setPositions(db);
  });

  it("an application sent under the strictest positions stays strict when the switches are only changed back", async () => {
    await setPositions(db, { interview: "required" });
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.setReferee(user.id, appId, 1, true);
    await kit.setReferee(user.id, appId, 2, false);
    await kit.send(user.id, appId);
    await setPositions(db, { interview: "off" });
    await setPositions(db, { interview: "required" });
    expect((await kit.modes(appId)).interview).toBe("required");
    // approval still waits for the interview
    await expect(db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]))).rejects.toThrow(/Approve only after the interview has been scored/);
  });

  it("an interview already booked is freed when the interview is switched off and the pastor decides", async () => {
    await setPositions(db);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.setReferee(user.id, appId, 1, true);
    await kit.setReferee(user.id, appId, 2, false);
    await kit.send(user.id, appId);
    await kit.answerReference(appId, 1, 5);
    await kit.answerReference(appId, 2, 5);
    await kit.review(staff.coach.id, appId, "calling", 5);
    await kit.review(staff.scorer.id, appId, "calling", 5);
    await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    const slot = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [inDays(4)]))).rows[0].id as string;
    await db.asUser(user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    expect((await kit.slotRow(slot)).application_id).toBe(appId);

    await setPositions(db, { interview: "off" });
    // nobody else can book now, and the booked one is released by the decision
    const another = await kit.person();
    await expect(db.asUser(another.id, (q) => q("select public.book_interview_slot($1)", [slot]))).rejects.toThrow(/not been invited/);
    // the scores of the panel are not needed with the interview off, but the situations and calling are
    await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]));
    expect((await kit.slotRow(slot)).application_id).toBeNull();
    expect(await kit.hasRole(user.id, "leader")).toBe(true);
    await setPositions(db);
  });

  it("booking is refused for someone already invited when the interview is switched off", async () => {
    await setPositions(db);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.setReferee(user.id, appId, 1, true);
    await kit.setReferee(user.id, appId, 2, false);
    await kit.send(user.id, appId);
    await kit.answerReference(appId, 1, 5);
    await kit.answerReference(appId, 2, 5);
    await kit.review(staff.coach.id, appId, "calling", 5);
    await kit.review(staff.scorer.id, appId, "calling", 5);
    await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    const slot = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [inDays(4)]))).rows[0].id as string;
    await setPositions(db, { interview: "off" });
    await expect(db.asUser(user.id, (q) => q("select public.book_interview_slot($1)", [slot]))).rejects.toThrow(/nothing to book/);
    await setPositions(db);
  });

  it("nobody is invited to an interview that is switched off", async () => {
    await setPositions(db, { interview: "off" });
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.setReferee(user.id, appId, 1, true);
    await kit.setReferee(user.id, appId, 2, false);
    await kit.send(user.id, appId);
    await kit.review(staff.coach.id, appId, "calling", 5);
    await kit.review(staff.scorer.id, appId, "calling", 5);
    await expect(db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [appId]))).rejects.toThrow(/Interviews are switched off/);
    await setPositions(db);
  });
});

describe("questions that stop people, and what happens when the stop is lifted", () => {
  it("taking a question out releases the people stopped at it, and only them", async () => {
    await setPositions(db);
    const stopped = async (failed: Partial<Record<(typeof ELIG_KEYS)[number], boolean>>) => {
      const user = await kit.person();
      const appId = await kit.startDraft(user.id, answers({ ...Object.fromEntries(ELIG_KEYS.map((k) => [k, true])), ...failed }));
      const r = await asUser<{ r: Row }>(user.id, "select public.check_leader_eligibility($1) as r", [appId]);
      expect(r.r.ok).toBe(false);
      return { user, appId };
    };
    const oneNo = await stopped({ age21: false });
    const twoNos = await stopped({ age21: false, time: false });
    const other = await stopped({ foundation: false });
    await setPositions(db, { eligibility: { age21: "optional" } });
    // The one who failed only that question is back at the first screen of the questions, with their answers kept
    const a = await kit.appRow(oneNo.appId);
    expect(a.status).toBe("draft");
    expect(a.step).toBe("eligibility");
    expect(a.failed_checks).toEqual([]);
    expect((a.answers as Row).eligibility).toMatchObject({ age21: false });
    // The one who failed two is still stopped, at the one left
    const b = await kit.appRow(twoNos.appId);
    expect(b.status).toBe("ineligible");
    expect(b.failed_checks).toEqual(["time"]);
    // The one who failed something else is untouched
    const c = await kit.appRow(other.appId);
    expect(c.status).toBe("ineligible");
    expect(c.failed_checks).toEqual(["foundation"]);
    // No message is sent to anyone
    expect(await sql("select 1 from public.messages where person_id = $1 and created_at > now() - interval '1 minute' and template like 'application%'", [oneNo.user.id])).toHaveLength(0);
    // And the released applicant now passes, with the optional no recorded for the panel
    const r = await asUser<{ r: Row }>(oneNo.user.id, "select public.check_leader_eligibility($1) as r", [oneNo.appId]);
    expect(r.r.ok).toBe(true);
    await setPositions(db);
  });

  it("turning a question on again stops nobody who is already past it", async () => {
    await setPositions(db, { eligibility: { age21: "off" } });
    const user = await kit.person();
    const elig = Object.fromEntries(ELIG_KEYS.filter((k) => k !== "age21").map((k) => [k, true]));
    const appId = await kit.startDraft(user.id, answers(elig));
    await asUser(user.id, "select public.check_leader_eligibility($1) as r", [appId]);
    await kit.send(user.id, appId).catch(() => undefined);
    await kit.setReferee(user.id, appId, 1, true);
    await kit.setReferee(user.id, appId, 2, false);
    await kit.send(user.id, appId);
    await setPositions(db);
    expect((await kit.modes(appId)).eligibility.age21).toBe("off");
    expect((await kit.appRow(appId)).status).toBe("submitted");
  });

  it("an optional no does not block, and is shown to the panel with the application", async () => {
    await setPositions(db, { eligibility: { serving: "optional", time: "optional" }, references: "off", interview: "off" });
    const user = await kit.person();
    const given = { ...Object.fromEntries(ELIG_KEYS.map((k) => [k, true])), serving: false, time: false };
    const appId = await kit.startDraft(user.id, answers(given));
    await asUser(user.id, "select public.check_leader_eligibility($1) as r", [appId]);
    await kit.send(user.id, appId);
    await kit.review(staff.coach.id, appId, "calling", 5);
    await kit.review(staff.scorer.id, appId, "calling", 5);
    const opened = (await db.asUser(staff.pastor.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r as Row;
    expect(opened.optional_no).toEqual(["serving", "time"]);
    // the answers shown to the panel carry no eligibility block, as before
    expect((opened.answers as Row).eligibility).toBeUndefined();
    // a coach opening it sees the same list, but not what the decision rests on
    const coach = (await db.asUser(staff.coach.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r as Row;
    expect(coach.optional_no).toEqual(["serving", "time"]);
    expect(coach.readiness).toBeNull();
    expect(coach.evidence).toBeNull();
    expect(coach.evidence_note).toBeNull();
    // and it can still be approved
    await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]));
    await setPositions(db);
  });
});

describe("a referee's concern stops an approval under every position", () => {
  for (const mode of ["required", "optional", "off"] as Pos[]) {
    it(`with references ${mode}: an open concern blocks until the pastor clears it`, async () => {
      await setPositions(db, { references: mode, interview: "off" });
      const user = await kit.person();
      const appId = await kit.startDraft(user.id);
      if (mode === "required") {
        await kit.setReferee(user.id, appId, 1, true);
        await kit.setReferee(user.id, appId, 2, false);
      } else {
        await kit.setReferee(user.id, appId, 1, false);
      }
      await kit.send(user.id, appId);
      const refId = await kit.answerReference(appId, 1, 5, "I am not sure about their reliability with money");
      if (mode === "required") await kit.answerReference(appId, 2, 5);
      await kit.review(staff.coach.id, appId, "calling", 5);
      await kit.review(staff.scorer.id, appId, "calling", 5);
      const ready = await kit.readiness(appId);
      expect((ready.gates as Row).open_concerns).toBe(1);
      expect((ready.gates as Row).references_clean).toBe(false);
      await expect(db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]))).rejects.toThrow(
        mode === "required" ? /The reference check is not clean/ : /A referee has raised a concern that has not been cleared yet/,
      );
      expect(await kit.hasRole(user.id, "leader")).toBe(false);
      // The pastor reads it and clears it
      await db.asUser(staff.pastor.id, (q) => q("select public.clear_reference_concern($1, 'Spoke to them; it was about one week only')", [refId]));
      await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]));
      expect(await kit.hasRole(user.id, "leader")).toBe(true);
      await setPositions(db);
    });
  }

  it("a referee held for a flag, or disputed, is not counted as a reference under any position", async () => {
    await setPositions(db, { references: "optional", interview: "off" });
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.setReferee(user.id, appId, 1, false);
    await kit.send(user.id, appId);
    const refId = await kit.answerReference(appId, 1, 5);
    await sql("update public.referee_trust set verification = 'disputed' where reference_id = $1", [refId]);
    const ready = await kit.readiness(appId);
    expect(ready.counted).not.toContain("references");
    expect(ready.evidence).toBe("reduced");
    await setPositions(db);
  });
});

describe("the pastor's reason for approving on thinner evidence", () => {
  it("is kept for the pastor, never shown to the applicant or the coach, and a blank clears it", async () => {
    await setPositions(db, OPEN_DOOR);
    const w = await kit.walk(OPEN_DOOR, { staff });
    // walk already decided; add the note afterwards the way the screen does
    await expect(db.asUser(staff.coach.id, (q) => q("select public.set_evidence_note($1, 'x')", [w.appId]))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(w.user.id, (q) => q("select public.set_evidence_note($1, 'x')", [w.appId]))).rejects.toMatchObject({ code: "42501" });
    await db.asUser(staff.pastor.id, (q) => q("select public.set_evidence_note($1, '  Known to the church for ten years  ')", [w.appId]));
    const opened = (await db.asUser(staff.pastor.id, (q) => q("select public.review_application($1) as r", [w.appId]))).rows[0].r as Row;
    expect(opened.evidence_note).toBe("Known to the church for ten years");
    expect(opened.evidence).toBe("reduced");
    const coach = (await db.asUser(staff.coach.id, (q) => q("select public.review_application($1) as r", [w.appId]))).rows[0].r as Row;
    expect(JSON.stringify(coach)).not.toContain("ten years");
    await expect(asUser(w.user.id, "select evidence_note from public.leader_application_policy where application_id = $1", [w.appId])).rejects.toThrow(/permission denied/i);
    await db.asUser(staff.pastor.id, (q) => q("select public.set_evidence_note($1, '   ')", [w.appId]));
    const cleared = (await db.asUser(staff.pastor.id, (q) => q("select public.review_application($1) as r", [w.appId]))).rows[0].r as Row;
    expect(cleared.evidence_note).toBeNull();
    // 600 characters at most, and nothing for a draft or an unknown application
    await db.asUser(staff.pastor.id, (q) => q("select public.set_evidence_note($1, $2)", [w.appId, "x".repeat(900)]));
    expect(((await sql("select evidence_note from public.leader_application_policy where application_id = $1", [w.appId]))[0].evidence_note as string).length).toBe(600);
    const draftUser = await kit.person();
    const draftApp = await kit.startDraft(draftUser.id);
    await expect(db.asUser(staff.pastor.id, (q) => q("select public.set_evidence_note($1, 'x')", [draftApp]))).rejects.toMatchObject({ code: "P0002" });
    await setPositions(db);
  });
});

describe("taking a referee off", () => {
  it("is allowed before anything has gone to them, and only for the applicant's own", async () => {
    await setPositions(db);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    const refId = (await kit.setReferee(user.id, appId, 1, false)).rows[0].id as string;
    await expect(db.asUser((await kit.person()).id, (q) => q("select public.clear_referee($1)", [refId]))).rejects.toMatchObject({ code: "P0002" });
    await db.asUser(user.id, (q) => q("select public.clear_referee($1)", [refId]));
    expect(await sql("select 1 from public.leader_references where id = $1", [refId])).toHaveLength(0);
    await expect(db.asUser(user.id, (q) => q("select public.clear_referee($1)", [refId]))).rejects.toMatchObject({ code: "P0002" });
  });

  it("is refused once a request has gone out, once they have answered, and once the application is decided", async () => {
    await setPositions(db);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    const r1 = (await kit.setReferee(user.id, appId, 1, true)).rows[0].id as string;
    const r2 = (await kit.setReferee(user.id, appId, 2, false)).rows[0].id as string;
    await kit.send(user.id, appId);
    await db.asUser(user.id, (q) => q("select public.request_referee_send($1)", [r1]));
    await expect(db.asUser(user.id, (q) => q("select public.clear_referee($1)", [r1]))).rejects.toThrow(/request has already gone/);
    await kit.answerReference(appId, 2, 4);
    await expect(db.asUser(user.id, (q) => q("select public.clear_referee($1)", [r2]))).rejects.toThrow(/already answered/);
    await sql("update public.leader_applications set status = 'approved_leader' where id = $1", [appId]);
    await expect(db.asUser(user.id, (q) => q("select public.clear_referee($1)", [r1]))).rejects.toThrow(/can no longer be changed/);
  });

  it("asking a referee is refused when references are off", async () => {
    await setPositions(db, { references: "optional" });
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    const refId = (await kit.setReferee(user.id, appId, 1, false)).rows[0].id as string;
    await kit.send(user.id, appId);
    await setPositions(db, { references: "off" });
    await expect(db.asUser(user.id, (q) => q("select public.request_referee_send($1)", [refId]))).rejects.toThrow(/References are not part of the process/);
    await setPositions(db, { references: "optional" });
    await expect(db.asUser(user.id, (q) => q("select public.request_referee_send($1)", [refId]))).resolves.toBeDefined();
    await setPositions(db);
  });
});

describe("the activity funnel never drops anyone for a step that is not asked", () => {
  it("counts a sent application past the references stage and the interview stage when they are not required", async () => {
    await setPositions(db, ALL_OFF);
    const w = await kit.walk(ALL_OFF, { staff });
    await setPositions(db, ALL_OFF);
    const sent = await kit.person();
    const sentApp = await kit.startDraft(sent.id);
    await kit.send(sent.id, sentApp);
    await sql("select public.activity_refresh(now(), true)");
    const stageOf = async (userId: string) =>
      Number((await sql("select stage from public.activity_leader_rows(current_date - 1, current_date + 1) where person_id = $1", [userId]))[0].stage);
    expect(await stageOf(w.user.id)).toBe(28); // approved, role granted
    expect(await stageOf(sent.id)).toBe(26); // sent, past the references and interview stages, waiting for the pastor
    // The same application under today's positions would sit at the stage it always did
    await setPositions(db);
    const strict = await kit.person();
    const strictApp = await kit.startDraft(strict.id);
    await kit.setReferee(strict.id, strictApp, 1, true);
    await kit.setReferee(strict.id, strictApp, 2, false);
    await kit.send(strict.id, strictApp);
    await sql("select public.activity_refresh(now(), true)");
    expect(await stageOf(strict.id)).toBe(24);
  });
});

describe("the readiness score weighs the evidence that exists, on the same bar", () => {
  it("scores calling and the situations alone when nothing else is asked, and never moves the bars", async () => {
    await setPositions(db, ALL_OFF);
    const make = async (calling: number, scen: number) => {
      const user = await kit.person();
      const appId = await kit.startDraft(user.id);
      await kit.send(user.id, appId);
      await sql("update public.leader_assessments set scenario_pct = $2 where application_id = $1", [appId, scen]);
      await kit.review(staff.coach.id, appId, "calling", calling);
      await kit.review(staff.scorer.id, appId, "calling", calling);
      return appId;
    };
    const high = await kit.readiness(await make(5, 100));
    expect(Number(high.readiness)).toBe(100);
    expect(high.weights).toEqual({ calling: 30, scenarios: 25, references: 0, interview: 0 });
    expect(high.missing).toEqual([
      { part: "references", why: "not_asked" },
      { part: "interview", why: "not_asked" },
    ]);
    const mid = await kit.readiness(await make(4, 70)); // (80*30 + 70*25) / 55 = 75.45...
    expect(Number(mid.readiness)).toBe(75.5);
    expect(mid.band).toBe("leader");
    const edge = await kit.readiness(await make(3, 59)); // (60*30 + 59*25) / 55 = 59.5
    expect(Number(edge.readiness)).toBe(59.5);
    expect(edge.band).toBe("below");
    const low = await kit.readiness(await make(3, 70)); // (60*30 + 70*25) / 55 = 64.5
    expect(Number(low.readiness)).toBe(64.5);
    expect(low.band).toBe("assistant_leader");
    // The reviewers' notes still need two people
    const one = await kit.person();
    const oneApp = await kit.startDraft(one.id);
    await kit.send(one.id, oneApp);
    await kit.review(staff.coach.id, oneApp, "calling", 5);
    expect((await kit.readiness(oneApp)).readiness).toBeNull();
    // A leader needs 75, an assistant leader 60: the same refusals, with the switches off
    const lowApp = await make(3, 70);
    await sql("update public.leader_applications set status = 'interviewed' where id = $1", [lowApp]);
    await expect(db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [lowApp]))).rejects.toThrow(/A leader needs a readiness score of 75 or more/);
    await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'assistant_leader', null)", [lowApp]));
    await setPositions(db);
  });

  it("an optional step that was not done is listed as not received, not as not asked", async () => {
    await setPositions(db, { references: "optional", interview: "optional" });
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await kit.send(user.id, appId);
    await kit.review(staff.coach.id, appId, "calling", 5);
    await kit.review(staff.scorer.id, appId, "calling", 5);
    const ready = await kit.readiness(appId);
    expect(ready.missing).toEqual([
      { part: "references", why: "not_received" },
      { part: "interview", why: "not_received" },
    ]);
    expect(Number(ready.readiness)).toBe(100);
    await setPositions(db);
  });
});

describe("the first check's messages", () => {
  it("say nothing about steps that are asked, and name the ones that are not", async () => {
    for (const [positions, expected] of [
      [{}, {}],
      [{ references: "off" }, { refs: false }],
      [{ references: "optional" }, { refs_optional: true }],
      [{ interview: "off" }, { interview: false }],
      [{ references: "off", interview: "off" }, { refs: false, interview: false }],
    ] as [Positions, Record<string, unknown>][]) {
      await setPositions(db, positions);
      const user = await kit.person();
      const appId = await kit.startDraft(user.id);
      if (!positions.references || positions.references === "required") {
        await kit.setReferee(user.id, appId, 1, true);
        await kit.setReferee(user.id, appId, 2, false);
      }
      await kit.send(user.id, appId);
      const flags = (await sql("select public.leader_message_flags($1) as r", [appId]))[0].r;
      expect(flags).toEqual(expected);
    }
    await setPositions(db);
  });
});

describe("when the settings cannot be read", () => {
  it("every step is asked, as it is today", async () => {
    // Made first: the helpers commit as they go, so nothing of the test's own may sit inside the transaction that is rolled back
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    await db.admin.query("begin");
    try {
      await db.admin.query("delete from public.leader_pipeline_settings");
      const m = (await db.admin.query("select public.leader_stage_modes($1) as r", [appId])).rows[0].r as Row;
      expect(m.references).toBe("required");
      expect(m.interview).toBe("required");
      for (const k of ELIG_KEYS) expect((m.eligibility as Row)[k]).toBe("required");
      expect((await db.admin.query("select public.leader_message_flags($1) as r", [appId])).rows[0].r).toEqual({});
      expect((await db.admin.query("select public.leader_check_template($1) as r", [appId])).rows[0].r).toBe("leader_check_clear");
    } finally {
      await db.admin.query("rollback");
    }
    // and the settings are back
    expect(await sql("select 1 from public.leader_pipeline_settings")).toHaveLength(1);
  });
});

describe("the messages an applicant gets when the first check clears their application", () => {
  const sendClear = async (positions: Positions) => {
    await setPositions(db, positions);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id);
    if ((positions.references ?? "required") === "required") {
      await kit.setReferee(user.id, appId, 1, true);
      await kit.setReferee(user.id, appId, 2, false);
    }
    await kit.send(user.id, appId);
    await sql("insert into public.leader_ai_state (application_id, state, basis) values ($1, 'held', 'ai')", [appId]);
    await db.asUser(staff.pastor.id, (q) => q("select public.leader_ai_clear($1, 'read it')", [appId]));
    const sent = await sql("select template, params from public.messages where person_id = $1 and template like 'leader_check_clear%'", [user.id]);
    await setPositions(db);
    return sent;
  };

  it("is the message it has always been when references are asked, with the same details", async () => {
    const sent = await sendClear({});
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe("leader_check_clear");
    expect(Object.keys(sent[0].params as object)).toEqual(["first_name"]);
    // and the same when only the interview is changed
    const noInterview = await sendClear({ interview: "off" });
    expect(noInterview[0].template).toBe("leader_check_clear");
  });

  it("is a message that does not ask them to send referees a link when references are off or optional", async () => {
    expect((await sendClear({ references: "off" }))[0].template).toBe("leader_check_clear_open");
    expect((await sendClear({ references: "optional" }))[0].template).toBe("leader_check_clear_optional");
  });

  it("only the template changes: the details are the same", async () => {
    const open = await sendClear({ references: "off" });
    expect(Object.keys(open[0].params as object)).toEqual(["first_name"]);
  });
});

describe("the reminder journey knows which steps are left", () => {
  const dataFor = async (positions: Positions) => {
    await setPositions(db, positions);
    const user = await kit.person();
    const appId = await kit.startDraft(user.id, answers(), "why");
    const data = (
      await sql("select public.journey_data(jsonb_populate_record(null::public.journey_runs, $1::jsonb)) as d", [
        JSON.stringify({ journey_key: "leader_application", person_id: user.id, ref_id: appId }),
      ])
    )[0].d as Row;
    await setPositions(db);
    return data;
  };

  it("adds nothing when every step is asked", async () => {
    const d = await dataFor({});
    expect(d.step).toBe("why");
    expect(d.modes).toBeUndefined();
    expect(Object.keys(d).sort()).toEqual(["close_date", "first_name", "step"]);
  });

  it("adds the steps that apply when one is switched off or made optional", async () => {
    const off = await dataFor({ references: "off" });
    expect((off.modes as Row).references).toBe("off");
    const optional = await dataFor({ interview: "optional" });
    expect((optional.modes as Row).interview).toBe("optional");
    const question = await dataFor({ eligibility: { age21: "optional" } });
    expect(((question.modes as Row).eligibility as Row).age21).toBe("optional");
  });
});
