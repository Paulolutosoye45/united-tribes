import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

// The key (see the migration): best picks rate 4, worst picks rate 1.
const BEST = { s1: "b", s2: "b", s3: "a", s4: "a", s5: "a", s6: "a" } as Record<string, string>;
const WORST = { s1: "d", s2: "c", s3: "d", s4: "c", s5: "b", s6: "c" } as Record<string, string>;
const picks = (best: Record<string, string>, worst: Record<string, string>) =>
  Object.fromEntries(Object.keys(best).map((k) => [k, { best: best[k], worst: worst[k] }]));

const ELIGIBLE = {
  member6: true,
  foundation: true,
  serving: true,
  age21: true,
  time: true,
  safeguarding: true,
  confidentiality: true,
};

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    eligibility: ELIGIBLE,
    calling: {
      track: "builders",
      tribe: "professionals",
      goal: "step-into-a-leadership-role",
      goalRelation: "pursuing",
      goalStory: "I have been stepping into leadership at work this year and I am still learning how.",
      why: "I want to help other people grow into what God has put in them, not to be seen.",
      walked: "I walked with a friend through a job loss. I listened a lot and did not give advice.",
      walkRating: 4,
      walkNote: "Steady, though I get tired in busy seasons and pray less than I want to.",
      obstacles: "Work travel in the second half of the season could get in the way.",
    },
    scenarios: picks(BEST, WORST),
    style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
    contact: { whatsapp: "+2348031234567" },
    ...overrides,
  };
}

const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();

async function person(role?: string) {
  const user = await db.createUser();
  if (role) await db.grant(user.id, role);
  return user;
}

async function startDraft(userId: string, answers: Record<string, unknown> = validAnswers()) {
  const { rows } = await db.asUser(userId, (q) =>
    q(
      `insert into public.leader_applications (person_id, step, answers, consent_version)
       values ($1, 'welcome', $2::jsonb, '2026-10-v1') returning id`,
      [userId, JSON.stringify(answers)],
    ),
  );
  return rows[0].id as string;
}

const setReferee = (userId: string, appId: string, slot: number, head: boolean, name = `Referee ${slot}`) =>
  db.asUser(userId, (q) =>
    q("select public.set_referee($1, $2, $3, 'Unit head', $4, $5) as id", [appId, slot, name, `referee${slot}@example.org`, head]),
  );

async function submitApplication(answers?: Record<string, unknown>) {
  const user = await person();
  const appId = await startDraft(user.id, answers);
  await setReferee(user.id, appId, 1, true, "Pastor Ife");
  await setReferee(user.id, appId, 2, false, "Sister Bola");
  await db.asUser(user.id, (q) => q("select public.submit_leader_application($1)", [appId]));
  return { user, appId };
}

async function answerReference(owner: string, appId: string, slot: number, rating = 5, concern: string | null = null) {
  const ref = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = $2", [appId, slot])).rows[0].id;
  const secret = (await db.asUser(owner, (q) => q("select public.renew_referee_link($1) as secret", [ref]))).rows[0].secret as string;
  await db.asAnon((q) =>
    q("select public.submit_reference($1, $2, $2, $2, $2, $3, $4)", [secret, rating, concern !== null, concern]),
  );
  return { ref: ref as string, secret };
}

const scoreOf = (n: number, count: number) => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i + 1}`, n])));
const review = (reviewer: string, appId: string, stage: "calling" | "interview", n: number, notes = "") =>
  db.asUser(reviewer, (q) =>
    q("select public.save_review($1, $2, $3::jsonb, $4)", [appId, stage, scoreOf(n, stage === "calling" ? 6 : 5), notes]),
  );

/** A submitted application with both references in and two calling reviews done. */
async function readyForInterview(opts: { rating?: number; calling?: number; answers?: Record<string, unknown> } = {}) {
  const { user, appId } = await submitApplication(opts.answers);
  await answerReference(user.id, appId, 1, opts.rating ?? 5);
  await answerReference(user.id, appId, 2, opts.rating ?? 5);
  const a = await person("coach");
  const b = await person("pastor");
  await review(a.id, appId, "calling", opts.calling ?? 5);
  await review(b.id, appId, "calling", opts.calling ?? 5);
  return { user, appId, a, b };
}

async function interviewed(opts: { rating?: number; calling?: number; interview?: number; answers?: Record<string, unknown> } = {}) {
  const base = await readyForInterview(opts);
  const director = await person("director");
  await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [base.appId]));
  const slot = (await db.asUser(director.id, (q) =>
    q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [inDays(5)]),
  )).rows[0].id as string;
  await db.asUser(base.user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
  await review(base.a.id, base.appId, "interview", opts.interview ?? 5);
  await review(base.b.id, base.appId, "interview", opts.interview ?? 5);
  return { ...base, director, slot };
}

describe("applications: who can see and change what", () => {
  it("lets a person start and edit only their own draft", async () => {
    const me = await person();
    const other = await person();
    const id = await startDraft(me.id, { eligibility: {} });

    await db.asUser(me.id, async (q) => {
      expect((await q("select id from public.leader_applications")).rows).toHaveLength(1);
      await q("update public.leader_applications set step = 'calling', answers = $2::jsonb where id = $1", [id, JSON.stringify({ eligibility: ELIGIBLE })]);
    });
    // Someone else sees nothing, and cannot start one on another person's behalf
    await db.asUser(other.id, async (q) => {
      expect((await q("select id from public.leader_applications")).rows).toHaveLength(0);
    });
    await expectCode(
      db.asUser(other.id, (q) =>
        q("insert into public.leader_applications (person_id, answers, consent_version) values ($1, '{}', 'v1')", [me.id]),
      ),
      "42501",
    );
  });

  it("keeps status, scores and decisions out of the applicant's hands", async () => {
    const me = await person();
    const id = await startDraft(me.id);
    await expectCode(db.asUser(me.id, (q) => q("update public.leader_applications set status = 'approved_leader' where id = $1", [id])), "42501");
    await expectCode(db.asUser(me.id, (q) => q("update public.leader_applications set decision_note = 'ok' where id = $1", [id])), "42501");
    await expectCode(
      db.asUser(me.id, (q) =>
        q("insert into public.leader_applications (person_id, status, answers, consent_version) values ($1, 'approved_leader', '{}', 'v1')", [me.id]),
      ),
      "42501",
    );
    // No access at all to scores, reviews, the answer key or interview times
    for (const table of ["leader_reference_answers", "leader_assessments", "leader_reviews", "scenario_keys", "interview_slots"]) {
      await expectCode(db.asUser(me.id, (q) => q(`select * from public.${table}`)), "42501");
    }
  });

  it("allows one open application at a time, and a fresh start after an ineligible one", async () => {
    const me = await person();
    await startDraft(me.id);
    await expectCode(startDraft(me.id), "23505");

    const second = await person();
    const id = await startDraft(second.id, { eligibility: { ...ELIGIBLE, age21: false } });
    await db.asUser(second.id, (q) => q("select public.check_leader_eligibility($1)", [id]));
    await startDraft(second.id); // allowed: the first is closed as ineligible
  });

  it("requires the consent wording version to be recorded", async () => {
    const me = await person();
    await expectCode(
      db.asUser(me.id, (q) => q("insert into public.leader_applications (person_id, answers, consent_version) values ($1, '{}', '')", [me.id])),
      "23514",
    );
  });
});

describe("stage 1: eligibility", () => {
  it("passes when all seven are yes", async () => {
    const me = await person();
    const id = await startDraft(me.id);
    const { rows } = await db.asUser(me.id, (q) => q("select public.check_leader_eligibility($1) as r", [id]));
    expect(rows[0].r).toEqual({ ok: true, failed: [] });
  });

  it("routes any no to ineligible and says which checks failed", async () => {
    const me = await person();
    const id = await startDraft(me.id, { eligibility: { ...ELIGIBLE, member6: false, time: false } });
    const { rows } = await db.asUser(me.id, (q) => q("select public.check_leader_eligibility($1) as r", [id]));
    expect(rows[0].r.ok).toBe(false);
    expect(rows[0].r.failed.sort()).toEqual(["member6", "time"]);
    const app = (await db.asUser(me.id, (q) => q("select status, failed_checks from public.leader_applications where id = $1", [id]))).rows[0];
    expect(app.status).toBe("ineligible");
    expect(app.failed_checks.sort()).toEqual(["member6", "time"]);
  });

  it("insists that all seven are answered", async () => {
    const me = await person();
    const id = await startDraft(me.id, { eligibility: { member6: true } });
    await expect(db.asUser(me.id, (q) => q("select public.check_leader_eligibility($1)", [id]))).rejects.toThrow(/seven/);
  });

  it("does not let someone check another person's application", async () => {
    const me = await person();
    const other = await person();
    const id = await startDraft(me.id);
    await expectCode(db.asUser(other.id, (q) => q("select public.check_leader_eligibility($1)", [id])), "P0002");
  });
});

describe("submitting an application", () => {
  it("scores the scenarios in the database and closes the draft", async () => {
    const { user, appId } = await submitApplication();
    const app = (await db.asUser(user.id, (q) => q("select status, submitted_at from public.leader_applications where id = $1", [appId]))).rows[0];
    expect(app.status).toBe("submitted");
    expect(app.submitted_at).not.toBeNull();
    const score = (await db.admin.query("select scenario_pct from public.leader_assessments where application_id = $1", [appId])).rows[0];
    expect(Number(score.scenario_pct)).toBe(100);
    // The applicant cannot read it back
    await expectCode(db.asUser(user.id, (q) => q("select * from public.leader_assessments")), "42501");
  });

  it("scores the worst possible picks at zero, and mixed picks in between", async () => {
    const reversed = await submitApplication(validAnswers({ scenarios: picks(WORST, BEST) }));
    expect(Number((await db.admin.query("select scenario_pct from public.leader_assessments where application_id = $1", [reversed.appId])).rows[0].scenario_pct)).toBe(0);

    const mixed = await submitApplication(validAnswers({ scenarios: picks({ ...BEST, s1: "c" }, WORST) }));
    // Five situations score 1, one scores (3 - 1 + 3) / 6, all out of six
    expect(Number((await db.admin.query("select scenario_pct from public.leader_assessments where application_id = $1", [mixed.appId])).rows[0].scenario_pct)).toBeCloseTo(97.22, 2);
  });

  it("cannot be edited once submitted", async () => {
    const { user, appId } = await submitApplication();
    const { rowCount } = await db.asUser(user.id, (q) =>
      q("update public.leader_applications set answers = '{}'::jsonb where id = $1", [appId]),
    );
    expect(rowCount).toBe(0);
    await expect(db.asUser(user.id, (q) => q("select public.submit_leader_application($1)", [appId]))).rejects.toThrow(/already submitted/);
  });

  it("refuses incomplete answers with a plain message", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ eligibility: { ...ELIGIBLE, serving: false } }, /eligibility/],
      [{ calling: { ...validAnswers().calling, goal: undefined } }, /Season Goal/],
      [{ calling: { ...validAnswers().calling, goalStory: "too short" } }, /few sentences/],
      [{ calling: { ...validAnswers().calling, walkRating: 9 } }, /1 to 5/],
      [{ contact: { whatsapp: "0803" } }, /WhatsApp/],
      [{ style: { leadBest: "shouting" } }, /lead best/],
      [{ scenarios: picks({ ...BEST, s2: "a" }, { ...WORST, s2: "a" }) }, /different worst/],
      [{ scenarios: { s1: { best: "b", worst: "d" } } }, /every situation/],
    ];
    for (const [override, message] of cases) {
      const me = await person();
      const id = await startDraft(me.id, validAnswers(override));
      await setReferee(me.id, id, 1, true);
      await setReferee(me.id, id, 2, false);
      await expect(db.asUser(me.id, (q) => q("select public.submit_leader_application($1)", [id]))).rejects.toThrow(message);
    }
  });

  it("needs two referees, one a pastor or unit head", async () => {
    const me = await person();
    const id = await startDraft(me.id);
    await setReferee(me.id, id, 1, true);
    await expect(db.asUser(me.id, (q) => q("select public.submit_leader_application($1)", [id]))).rejects.toThrow(/both referees/i);

    const you = await person();
    const id2 = await startDraft(you.id);
    await setReferee(you.id, id2, 1, false);
    await setReferee(you.id, id2, 2, false);
    await expect(db.asUser(you.id, (q) => q("select public.submit_leader_application($1)", [id2]))).rejects.toThrow(/pastor or unit head/);
  });

  it("does not submit someone else's application", async () => {
    const me = await person();
    const other = await person();
    const id = await startDraft(me.id);
    await expectCode(db.asUser(other.id, (q) => q("select public.submit_leader_application($1)", [id])), "P0002");
  });
});

describe("referees answer by private link", () => {
  it("hands out a link only after submission, and stores only its hash", async () => {
    const me = await person();
    const id = await startDraft(me.id);
    const ref = (await setReferee(me.id, id, 1, true)).rows[0].id as string;
    await expect(db.asUser(me.id, (q) => q("select public.renew_referee_link($1)", [ref]))).rejects.toThrow(/submitted/);

    const { user, appId } = await submitApplication();
    const refId = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = 1", [appId])).rows[0].id;
    const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [refId]))).rows[0].s as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const row = (await db.admin.query("select * from public.leader_references where id = $1", [refId])).rows[0];
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows a visitor only what the referee needs, and nothing for a wrong link", async () => {
    const { user, appId } = await submitApplication();
    const refId = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = 1", [appId])).rows[0].id;
    const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [refId]))).rows[0].s as string;

    const info = (await db.asAnon((q) => q("select public.get_reference_request($1) as r", [secret]))).rows[0].r;
    expect(Object.keys(info).sort()).toEqual(["answered", "applicant", "closed", "expired", "referee", "relationship"]);
    expect(info.referee).toBe("Pastor Ife");
    expect(info.answered).toBe(false);

    expect((await db.asAnon((q) => q("select public.get_reference_request($1) as r", ["0".repeat(64)]))).rows[0].r).toBeNull();
    expect((await db.asAnon((q) => q("select public.get_reference_request($1) as r", [""]))).rows[0].r).toBeNull();
    // A visitor can read no table
    await expectCode(db.asAnon((q) => q("select * from public.leader_references")), "42501");
  });

  it("accepts one answer, then refuses the link", async () => {
    const { user, appId } = await submitApplication();
    const { secret } = await answerReference(user.id, appId, 1, 4);
    const row = (await db.admin.query("select * from public.leader_reference_answers")).rows.find(Boolean);
    expect(row.reliability).toBe(4);
    await expect(
      db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, false, null)", [secret])),
    ).rejects.toThrow(/already sent/);
    const info = (await db.asAnon((q) => q("select public.get_reference_request($1) as r", [secret]))).rows[0].r;
    expect(info.answered).toBe(true);
  });

  it("refuses a wrong secret, an expired link and out-of-range ratings", async () => {
    const { user, appId } = await submitApplication();
    await expectCode(db.asAnon((q) => q("select public.submit_reference('nope', 5, 5, 5, 5, false, null)")), "P0002");

    const refId = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = 2", [appId])).rows[0].id;
    const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [refId]))).rows[0].s as string;
    await expectCode(db.asAnon((q) => q("select public.submit_reference($1, 6, 5, 5, 5, false, null)", [secret])), "23514");
    await db.admin.query("update public.leader_references set token_expires_at = now() - interval '1 day' where id = $1", [refId]);
    await expect(db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, false, null)", [secret]))).rejects.toThrow(/expired/);
    const expired = (await db.asAnon((q) => q("select public.get_reference_request($1) as r", [secret]))).rows[0].r;
    expect(expired.expired).toBe(true);
    // A new link replaces the old one
    const fresh = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [refId]))).rows[0].s as string;
    expect((await db.asAnon((q) => q("select public.get_reference_request($1) as r", [secret]))).rows[0].r).toBeNull();
    await db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, false, null)", [fresh]));
  });

  it("needs a note when a referee raises a concern", async () => {
    const { user, appId } = await submitApplication();
    const refId = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = 1", [appId])).rows[0].id;
    const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [refId]))).rows[0].s as string;
    await expectCode(db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, true, '')", [secret])), "23514");
  });

  it("never lets the applicant see ratings or concerns", async () => {
    const { user, appId } = await submitApplication();
    await answerReference(user.id, appId, 1, 2, "Late to things and defensive when corrected.");
    await expectCode(db.asUser(user.id, (q) => q("select * from public.leader_reference_answers")), "42501");
    const mine = (await db.asUser(user.id, (q) => q("select * from public.leader_references where application_id = $1 order by slot", [appId]))).rows;
    expect(mine).toHaveLength(2);
    expect(mine[0].submitted_at).not.toBeNull();
    expect(Object.keys(mine[0])).not.toContain("reliability");
    // Nobody else's referees either
    const other = await person();
    expect((await db.asUser(other.id, (q) => q("select * from public.leader_references"))).rows).toHaveLength(0);
  });

  it("locks a referee once they have answered", async () => {
    const { user, appId } = await submitApplication();
    await answerReference(user.id, appId, 1);
    await expect(setReferee(user.id, appId, 1, true, "Someone Else")).rejects.toThrow(/already answered/);
  });
});

describe("the review panel", () => {
  it("is closed to members and the office without a panel role", async () => {
    const { appId } = await submitApplication();
    for (const role of [undefined, "admin", "leader", "care_lead", "data_lead"]) {
      const who = await person(role);
      await expectCode(db.asUser(who.id, (q) => q("select public.review_queue()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.review_application($1)", [appId])), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.save_review($1, 'calling', $2::jsonb, '')", [appId, scoreOf(3, 6)])), "42501");
    }
  });

  it("shows the applicant's full name to the panel, falling back to the name they go by", async () => {
    const full = await db.createUser({ meta: { full_name: "Ngozi Adeyemi" } });
    await db.admin.query("update public.people set preferred_name = 'Ngozi' where id = $1", [full.id]);
    const goesBy = await db.createUser();
    await db.admin.query("update public.people set full_name = null, preferred_name = 'Chi' where id = $1", [goesBy.id]);
    const name = async (id: string) => (await db.admin.query("select public.person_display_name($1) as n", [id])).rows[0].n;
    expect(await name(full.id)).toBe("Ngozi Adeyemi");
    expect(await name(goesBy.id)).toBe("Chi");
  });

  it("lists submitted applications, never drafts, never the reviewer's own", async () => {
    const { appId } = await submitApplication();
    const draftId = await startDraft((await person()).id);
    const reviewer = await person("coach");
    const queue = (await db.asUser(reviewer.id, (q) => q("select public.review_queue() as r"))).rows[0].r as { id: string; status: string }[];
    expect(queue.map((a) => a.id)).toContain(appId);
    expect(queue.map((a) => a.id)).not.toContain(draftId);
    expect(queue.some((a) => a.status === "draft")).toBe(false);

    // A pastor who applies sees everyone's but their own
    const applyingPastor = await person("pastor");
    const own = await startDraft(applyingPastor.id);
    await setReferee(applyingPastor.id, own, 1, true);
    await setReferee(applyingPastor.id, own, 2, false);
    await db.asUser(applyingPastor.id, (q) => q("select public.submit_leader_application($1)", [own]));
    const theirs = (await db.asUser(applyingPastor.id, (q) => q("select public.review_queue() as r"))).rows[0].r as { id: string }[];
    expect(theirs.map((a) => a.id)).toContain(appId);
    expect(theirs.map((a) => a.id)).not.toContain(own);
    await expectCode(db.asUser(applyingPastor.id, (q) => q("select public.review_application($1)", [own])), "P0002");
    await expectCode(db.asUser(applyingPastor.id, (q) => q("select public.save_review($1, 'calling', $2::jsonb, '')", [own, scoreOf(5, 6)])), "P0002");
  });

  it("does not let a reviewer read the tables directly", async () => {
    await submitApplication();
    const reviewer = await person("pastor");
    expect((await db.asUser(reviewer.id, (q) => q("select * from public.leader_applications"))).rows).toHaveLength(0);
    await expectCode(db.asUser(reviewer.id, (q) => q("select * from public.leader_reviews")), "42501");
  });

  it("shows the whole application, including referee answers, but not the eligibility answers", async () => {
    const { user, appId } = await submitApplication();
    await answerReference(user.id, appId, 1, 4, "Worth a conversation about time.");
    const reviewer = await person("coach");
    const view = (await db.asUser(reviewer.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r;
    expect(view.answers.calling.goalStory).toContain("stepping into leadership");
    expect(view.answers.eligibility).toBeUndefined();
    expect(view.tribe_name).toBe("Professionals");
    expect(view.goal_title).toBe("Step into a leadership role");
    expect(view.references[0]).toMatchObject({ name: "Pastor Ife", answered: true, reliability: 4, concern: true });
    // Only decision-makers see the combined score
    expect(view.readiness).toBeNull();
    expect(view.can_decide).toBe(false);
  });

  it("validates rubric scores", async () => {
    const { appId } = await submitApplication();
    const reviewer = await person("coach");
    const bad = (scores: unknown, stage = "calling") =>
      db.asUser(reviewer.id, (q) => q("select public.save_review($1, $2, $3::jsonb, '')", [appId, stage, JSON.stringify(scores)]));
    await expect(bad({ q1: 3 })).rejects.toThrow(/every question/);
    await expect(bad({ ...JSON.parse(scoreOf(3, 6)), q2: 6 })).rejects.toThrow(/1 to 5/);
    await expect(bad({ ...JSON.parse(scoreOf(3, 6)), q2: "4" })).rejects.toThrow(/1 to 5/);
    await expect(bad(JSON.parse(scoreOf(3, 5)), "interview")).rejects.toThrow(/booked/);
    await expect(bad(JSON.parse(scoreOf(3, 6)), "whatever")).rejects.toThrow(/stage/);
  });

  it("keeps a colleague's scores hidden until you have scored yourself", async () => {
    const { appId } = await submitApplication();
    const a = await person("coach");
    const b = await person("pastor");
    await review(a.id, appId, "calling", 4, "Clear story.");
    const before = (await db.asUser(b.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r;
    expect(before.others.calling).toBeNull();
    expect(before.mine.calling).toBeNull();

    await review(b.id, appId, "calling", 2, "Vague on the goal.");
    const after = (await db.asUser(b.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r;
    expect(after.others.calling).toHaveLength(1);
    expect(after.others.calling[0]).toMatchObject({ pct: 80, notes: "Clear story." });
    expect(after.mine.calling.notes).toBe("Vague on the goal.");
  });

  it("updates a reviewer's own score rather than adding a second", async () => {
    const { appId } = await submitApplication();
    const a = await person("coach");
    await review(a.id, appId, "calling", 3);
    await review(a.id, appId, "calling", 5);
    const { rows } = await db.admin.query("select scores from public.leader_reviews where application_id = $1", [appId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].scores.q1).toBe(5);
  });
});

describe("interview invitations and booking", () => {
  it("lets only a pastor or director invite, and only when the file is complete", async () => {
    const { user, appId } = await submitApplication();
    const director = await person("director");
    await expect(db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [appId]))).rejects.toThrow(/references/);
    await answerReference(user.id, appId, 1);
    await answerReference(user.id, appId, 2);
    await expect(db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [appId]))).rejects.toThrow(/Two reviewers/);
    await review((await person("coach")).id, appId, "calling", 4);
    await review((await person("coach")).id, appId, "calling", 4);

    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.invite_to_interview($1)", [appId])), "42501");
    await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    expect((await db.admin.query("select status from public.leader_applications where id = $1", [appId])).rows[0].status).toBe("interview_invited");
  });

  it("lets only the office add times, and not in the past", async () => {
    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null)", [inDays(4)])), "42501");
    const admin = await person("admin");
    await expect(db.asUser(admin.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null)", [inDays(-1)]))).rejects.toThrow(/future/);
    await db.asUser(admin.id, (q) => q("select public.add_interview_slot($1, 20, 'in_person', 'Room 3', 'Pastor A and Coach B')", [inDays(4)]));
    // Admin sees times but no names; the panel sees names
    const times = (await db.asUser(admin.id, (q) => q("select public.review_interviews() as r"))).rows[0].r;
    expect(times).toHaveLength(1);
    expect(times[0].applicant).toBeNull();
  });

  it("offers times only to invited applicants, hides near ones, and books a seat once", async () => {
    const a = await readyForInterview();
    const b = await readyForInterview();
    const director = await person("director");
    const slotNear = (await db.asUser(director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null) as id", [new Date(Date.now() + 3 * 3600 * 1000).toISOString()]))).rows[0].id;
    const slotFar = (await db.asUser(director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null) as id", [inDays(4)]))).rows[0].id as string;

    // Not invited yet: nothing offered, cannot book
    expect((await db.asUser(a.user.id, (q) => q("select public.my_interview_options() as r"))).rows[0].r).toBeNull();
    await expect(db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slotFar]))).rejects.toThrow(/invited/);

    await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [a.appId]));
    await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [b.appId]));
    const options = (await db.asUser(a.user.id, (q) => q("select public.my_interview_options() as r"))).rows[0].r;
    const offered = options.open.map((s: { id: string }) => s.id);
    expect(offered).toContain(slotFar);
    expect(offered).not.toContain(slotNear);
    await expect(db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slotNear]))).rejects.toThrow(/no longer available/);

    await db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slotFar]));
    // The seat is gone for the next person
    await expect(db.asUser(b.user.id, (q) => q("select public.book_interview_slot($1)", [slotFar]))).rejects.toThrow(/no longer available/);
    const mine = (await db.asUser(a.user.id, (q) => q("select public.my_interview_options() as r"))).rows[0].r;
    expect(mine.status).toBe("interview_booked");
    expect(mine.booked.id).toBe(slotFar);
    expect(mine.open).toEqual([]);

    // The panel sees who is booked; the office cannot cancel a booked seat by deleting it
    const panelView = (await db.asUser(a.a.id, (q) => q("select public.review_interviews() as r"))).rows[0].r.find((s: { id: string }) => s.id === slotFar);
    expect(panelView.booked).toBe(true);
    expect(panelView.application_id).toBe(a.appId);
    await expect(db.asUser(director.id, (q) => q("select public.remove_interview_slot($1)", [slotFar]))).rejects.toThrow(/booked/);
  });

  it("lets an applicant cancel well ahead, freeing the seat, but not within a day", async () => {
    const a = await readyForInterview();
    const director = await person("director");
    await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [a.appId]));
    const slot = (await db.asUser(director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null) as id", [inDays(4)]))).rows[0].id as string;
    await db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    await db.asUser(a.user.id, (q) => q("select public.cancel_interview_booking()"));
    expect((await db.admin.query("select application_id from public.interview_slots where id = $1", [slot])).rows[0].application_id).toBeNull();
    expect((await db.admin.query("select status from public.leader_applications where id = $1", [a.appId])).rows[0].status).toBe("interview_invited");

    await db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    await db.admin.query("update public.interview_slots set starts_at = now() + interval '5 hours' where id = $1", [slot]);
    await expect(db.asUser(a.user.id, (q) => q("select public.cancel_interview_booking()"))).rejects.toThrow(/Too close/);
  });

  it("scores the interview only once booked, and marks the application interviewed", async () => {
    const a = await readyForInterview();
    await expect(review(a.a.id, a.appId, "interview", 4)).rejects.toThrow(/booked/);
    const director = await person("director");
    await db.asUser(director.id, (q) => q("select public.invite_to_interview($1)", [a.appId]));
    const slot = (await db.asUser(director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null) as id", [inDays(4)]))).rows[0].id as string;
    await db.asUser(a.user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    await review(a.a.id, a.appId, "interview", 4);
    expect((await db.admin.query("select status from public.leader_applications where id = $1", [a.appId])).rows[0].status).toBe("interviewed");
  });
});

describe("the decision", () => {
  it("grants the leader role to a strong, clean, interviewed applicant", async () => {
    const f = await interviewed();
    const pastor = await person("pastor");
    const readiness = (await db.asUser(pastor.id, (q) => q("select public.review_application($1) as r", [f.appId]))).rows[0].r.readiness;
    expect(readiness).toMatchObject({ readiness: 100, band: "leader", scenarios: 100, calling: 100, references: 100, interview: 100 });
    expect(readiness.gates).toMatchObject({ goal_declared: true, references_clean: true, open_concerns: 0 });

    const out = (await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', 'Welcome to the team.') as r", [f.appId]))).rows[0].r;
    expect(out).toEqual({ ok: true, status: "approved_leader" });
    const roles = (await db.asUser(f.user.id, (q) => q("select public.my_roles() as r"))).rows[0].r as string[];
    expect(roles).toContain("leader");
    const mine = (await db.asUser(f.user.id, (q) => q("select status, decision_note from public.leader_applications where id = $1", [f.appId]))).rows[0];
    expect(mine).toEqual({ status: "approved_leader", decision_note: "Welcome to the team." });
    const logged = await db.admin.query("select action from public.event_log where entity_id = $1 order by id", [f.appId]);
    expect(logged.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["leader.applied", "leader.reference_received", "leader.reviewed", "leader.invited", "leader.interview_booked", "leader.decided"]),
    );
  });

  it("weights the four components 30, 25, 25 and 20", async () => {
    // calling 60, scenarios 100, references 60, interview 60: 18 + 25 + 15 + 12
    const f = await interviewed({ calling: 3, rating: 3, interview: 3 });
    const pastor = await person("pastor");
    const r = (await db.asUser(pastor.id, (q) => q("select public.review_application($1) as r", [f.appId]))).rows[0].r.readiness;
    expect(r.readiness).toBe(70);
    expect(r.band).toBe("assistant_leader");
  });

  it("holds the thresholds: 75 for a leader, 60 for an assistant, nothing below", async () => {
    const mid = await interviewed({ calling: 3, rating: 3, interview: 3 });
    const pastor = await person("pastor");
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [mid.appId]))).rejects.toThrow(/75/);
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'assistant_leader', null)", [mid.appId]));
    expect(((await db.asUser(mid.user.id, (q) => q("select public.my_roles() as r"))).rows[0].r as string[])).toContain("assistant_leader");

    // 45: below both thresholds
    const low = await interviewed({ calling: 3, rating: 3, interview: 3, answers: validAnswers({ scenarios: picks(WORST, BEST) }) });
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'assistant_leader', null)", [low.appId]))).rejects.toThrow(/60/);
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'not_approved', 'Thank you. Please consider serving in a unit.')", [low.appId]));
    expect(((await db.asUser(low.user.id, (q) => q("select public.my_roles() as r"))).rows[0].r as string[])).not.toContain("leader");
  });

  it("is a pastor's decision alone, never on their own application", async () => {
    const f = await interviewed();
    for (const role of ["director", "coach", "admin"]) {
      const who = await person(role);
      await expectCode(db.asUser(who.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId])), "42501");
    }
    const pastor = await person("pastor");
    const own = await startDraft(pastor.id);
    await setReferee(pastor.id, own, 1, true);
    await setReferee(pastor.id, own, 2, false);
    await db.asUser(pastor.id, (q) => q("select public.submit_leader_application($1)", [own]));
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'not_approved', null)", [own])), "P0002");
  });

  it("will not approve before the interview is scored", async () => {
    const f = await readyForInterview();
    const pastor = await person("pastor");
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId]))).rejects.toThrow(/interview/);
    // A kind no is always possible
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'not_approved', 'Not this season.')", [f.appId]));
  });

  it("blocks approval while a referee concern is open, until a pastor clears it with a note", async () => {
    const { user, appId } = await submitApplication();
    await answerReference(user.id, appId, 1, 5, "I would want to talk about how they handle criticism.");
    await answerReference(user.id, appId, 2, 5);
    const a = await person("coach");
    const b = await person("director");
    await review(a.id, appId, "calling", 5);
    await review(b.id, appId, "calling", 5);
    await db.asUser(b.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    const slot = (await db.asUser(b.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'link', null) as id", [inDays(4)]))).rows[0].id as string;
    await db.asUser(user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    await review(a.id, appId, "interview", 5);
    await review(b.id, appId, "interview", 5);

    const pastor = await person("pastor");
    const view = (await db.asUser(pastor.id, (q) => q("select public.review_application($1) as r", [appId]))).rows[0].r;
    expect(view.readiness.gates.references_clean).toBe(false);
    expect(view.readiness.gates.open_concerns).toBe(1);
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]))).rejects.toThrow(/reference check/);

    const refId = view.references[0].id as string;
    await expect(db.asUser(pastor.id, (q) => q("select public.clear_reference_concern($1, 'ok')", [refId]))).rejects.toThrow(/follow/);
    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.clear_reference_concern($1, 'I spoke to the referee at length')", [refId])), "42501");
    await db.asUser(pastor.id, (q) => q("select public.clear_reference_concern($1, 'I spoke to the referee and the applicant; it was about timekeeping.')", [refId]));
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [appId]));
  });

  it("needs a referee who is a pastor or unit head to have answered", async () => {
    const f = await interviewed();
    // Pretend the head's answer is missing by marking the answering referees as non-heads
    await db.admin.query("update public.leader_references set is_pastor_or_unit_head = false where application_id = $1", [f.appId]);
    const pastor = await person("pastor");
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId]))).rejects.toThrow(/reference check/);
  });

  it("needs a declared Season Goal", async () => {
    const f = await interviewed();
    await db.admin.query("update public.leader_applications set answers = answers #- '{calling,goal}' where id = $1", [f.appId]);
    const pastor = await person("pastor");
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId]))).rejects.toThrow(/Season Goal/);
  });

  it("does not decide twice", async () => {
    const f = await interviewed();
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId]));
    await expect(db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'not_approved', null)", [f.appId]))).rejects.toThrow(/not open/);
  });
});

describe("erasure and statistics", () => {
  it("lets an applicant delete their application, freeing the seat and removing everything about it", async () => {
    const f = await interviewed();
    expect((await db.admin.query("select count(*) from public.leader_reviews where application_id = $1", [f.appId])).rows[0].count).toBe("4");
    await db.asUser(f.user.id, (q) => q("delete from public.leader_applications where id = $1", [f.appId]));
    for (const table of ["leader_references", "leader_assessments", "leader_reviews"]) {
      expect((await db.admin.query(`select count(*) from public.${table} where application_id = $1`, [f.appId])).rows[0].count).toBe("0");
    }
    expect((await db.admin.query("select application_id from public.interview_slots where id = $1", [f.slot])).rows[0].application_id).toBeNull();
  });

  it("keeps the record of an approved leader", async () => {
    const f = await interviewed();
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [f.appId]));
    const { rowCount } = await db.asUser(f.user.id, (q) => q("delete from public.leader_applications where id = $1", [f.appId]));
    expect(rowCount).toBe(0);
  });

  it("reports totals to the office without personal details", async () => {
    await interviewed();
    const stats = (await db.asUser((await person("pastor")).id, (q) => q("select public.leader_stats() as r"))).rows[0].r;
    expect(stats.submitted).toBeGreaterThanOrEqual(1);
    expect(stats).not.toHaveProperty("applicants");
    await expectCode(db.asUser((await person()).id, (q) => q("select public.leader_stats()")), "42501");
    await expectCode(db.asUser((await person("leader")).id, (q) => q("select public.leader_stats()")), "42501");
  });
});
