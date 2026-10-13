import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { timesFor } from "@/lib/academy/options";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const inHours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

async function person(...roles: string[]) {
  const user = await db.createUser();
  for (const role of roles) await db.grant(user.id, role);
  return user;
}

/** An approved leader or assistant, with the application the pastor approved. */
async function approved(kind: "leader" | "assistant_leader", opts: { leadBest?: string; community?: string; goal?: string; track?: string; goalOnly?: boolean } = {}) {
  const user = await person(kind);
  await db.admin.query(`update public.people set full_name = $2, preferred_name = $3 where id = $1`, [user.id, `Test ${kind === "leader" ? "Leader" : "Assistant"} ${user.id.slice(0, 4)}`, "Tola"]);
  const answers = {
    calling: {
      track: opts.track ?? "builders",
      community: opts.community ?? "professionals",
      goal: opts.goalOnly === false ? undefined : (opts.goal ?? "step-into-a-leadership-role"),
    },
    style: { leadBest: opts.leadBest ?? "structure" },
  };
  await db.admin.query(
    `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at)
     values ($1, $2, 'review', $3::jsonb, 'test', now(), now())`,
    [user.id, kind === "leader" ? "approved_leader" : "approved_assistant", JSON.stringify(answers)],
  );
  return user;
}

/** Looks up the answer key as the database owner, which no signed-in person can do. */
async function key(slug: string): Promise<number[]> {
  const { rows } = await db.admin.query(
    `select q.correct from public.academy_questions q join public.academy_modules m on m.id = q.module_id
      where m.slug = $1 order by q.position`,
    [slug],
  );
  return rows.map((r) => r.correct as number);
}

async function pass(userId: string, slug: string) {
  const answers = await key(slug);
  const { rows } = await db.asUser(userId, (q) => q("select public.submit_quiz($1, $2::jsonb) as r", [slug, JSON.stringify(answers)]));
  return rows[0].r;
}

const SLUGS = ["the-why", "the-success-picture", "hosting-the-meeting", "knowing-your-people", "care-and-safeguarding", "using-the-platform"];
async function passAll(userId: string) {
  for (const slug of SLUGS) await pass(userId, slug);
}

async function readyForCoach(personId: string, coachId: string, ready = true) {
  await db.asUser(coachId, (q) => q("select public.record_practice($1, 'co_lead', $2, $3)", [personId, ready, ready ? "Steady and kind." : "Practise keeping time."]));
}

async function sign(userId: string) {
  await db.asUser(userId, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola Adeyemi')"));
}

async function certified(userId: string): Promise<boolean> {
  const { rows } = await db.admin.query("select 1 from public.leader_certifications where person_id = $1", [userId]);
  return rows.length > 0;
}

/** Fills a card with good values for a Wednesday evening tribe. */
const GOOD_CARD = {
  name: "Tola’s Professionals tribe",
  story: "I was passed over twice before I learned to lead by serving. Now I lead a team of eight and I want to help you do it with your peace intact.",
  meeting_day: 3,
  meeting_time: "20:00",
  mode: "online",
  zone: "mainland",
  place_note: "Yaba side, mostly online",
  capacity: 10,
  god: "Read the week’s passage and say the confession five days a week.",
  others: "Pray for our triad weekly; nobody misses twice without a call.",
  life: "Each of us completes 10 of 12 weekly steps and has one leadership conversation.",
};

async function newCard(leaderId: string) {
  const { rows } = await db.asUser(leaderId, (q) => q("select public.start_tribe_card() as id"));
  return rows[0].id as string;
}
async function fillCard(leaderId: string, id: string, fields: Record<string, unknown> = GOOD_CARD) {
  await db.asUser(leaderId, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify(fields)]));
}

describe("the course", () => {
  it("has six modules, each with a quiz whose key points at a real option", async () => {
    const { rows } = await db.admin.query(`
      select m.slug, count(q.id)::int as questions,
             bool_and(q.correct < jsonb_array_length(q.options)) as keyed
        from public.academy_modules m left join public.academy_questions q on q.module_id = m.id
       group by m.slug, m.number order by m.number`);
    expect(rows.map((r) => r.slug)).toEqual(SLUGS);
    for (const r of rows) {
      expect(r.questions, r.slug).toBeGreaterThanOrEqual(5);
      expect(r.keyed, r.slug).toBe(true);
    }
  });

  it("does not always put the right answer in the same place", async () => {
    const positions = new Set<number>();
    for (const slug of SLUGS) for (const c of await key(slug)) positions.add(c);
    expect(positions.size).toBeGreaterThanOrEqual(3);
  });

  it("is closed to people who are not leaders in training", async () => {
    const member = await person();
    await expectCode(db.asUser(member.id, (q) => q("select public.my_academy()")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("select public.academy_module('the-why')")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("select public.submit_quiz('the-why', '[0]'::jsonb)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.my_academy()")), "42501");
  });

  it("never sends the answer key to the browser", async () => {
    const leader = await approved("leader");
    const { rows } = await db.asUser(leader.id, (q) => q("select public.academy_module('the-why') as m"));
    const text = JSON.stringify(rows[0].m);
    expect(rows[0].m.questions.length).toBeGreaterThanOrEqual(5);
    expect(text).not.toContain('"correct"');
    expect(text).not.toContain('"explanation"');
    // And the tables themselves are closed.
    await expectCode(db.asUser(leader.id, (q) => q("select correct from public.academy_questions")), "42501");
    await expectCode(db.asUser(leader.id, (q) => q("update public.academy_progress set passed_at = now()")), "42501");
    await expectCode(db.asUser(leader.id, (q) => q("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id])), "42501");
  });

  it("lets the review panel read a module without taking it", async () => {
    const pastor = await person("pastor");
    const { rows } = await db.asUser(pastor.id, (q) => q("select public.academy_module('care-and-safeguarding') as m"));
    expect(rows[0].m.can_take).toBe(false);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.submit_quiz('the-why', '[0,0,0,0,0,0]'::jsonb)")), "42501");
  });
});

describe("quizzes", () => {
  it("scores in the database, shows why a wrong answer is wrong, and passes at 80%", async () => {
    const leader = await approved("leader");
    const answers = await key("the-why");
    const total = answers.length;
    // Get exactly one wrong: 5 of 6 is 83%, a pass.
    const oneWrong = answers.map((a, i) => (i === 0 ? (a + 1) % 4 : a));
    const first = await db.asUser(leader.id, (q) => q("select public.submit_quiz('the-why', $1::jsonb) as r", [JSON.stringify(oneWrong)]));
    const r1 = first.rows[0].r;
    expect(r1.total).toBe(total);
    expect(r1.right).toBe(total - 1);
    expect(r1.score).toBe(Math.round(((total - 1) * 100) / total));
    expect(r1.passed).toBe(true);
    expect(r1.results[0].right).toBe(false);
    expect(r1.results[0].explanation).toMatch(/\w/);
    expect(r1.results[1].explanation).toBeUndefined();
  });

  it("fails below 80%, keeps the best score, and records every attempt", async () => {
    const leader = await approved("leader");
    const answers = await key("the-success-picture");
    const allWrong = answers.map((a) => (a + 1) % 4);
    const bad = await db.asUser(leader.id, (q) => q("select public.submit_quiz('the-success-picture', $1::jsonb) as r", [JSON.stringify(allWrong)]));
    expect(bad.rows[0].r.passed).toBe(false);
    expect(bad.rows[0].r.score).toBe(0);
    const half = answers.map((a, i) => (i < answers.length / 2 ? a : (a + 1) % 4));
    await db.asUser(leader.id, (q) => q("select public.submit_quiz('the-success-picture', $1::jsonb)", [JSON.stringify(half)]));
    const { rows } = await db.admin.query(
      `select p.attempts, p.best_score, p.passed_at,
              (select count(*)::int from public.academy_attempts a where a.person_id = p.person_id and a.module_id = p.module_id) as logged
         from public.academy_progress p join public.academy_modules m on m.id = p.module_id
        where p.person_id = $1 and m.slug = 'the-success-picture'`,
      [leader.id],
    );
    expect(rows[0].attempts).toBe(2);
    expect(rows[0].logged).toBe(2);
    expect(rows[0].best_score).toBe(50);
    expect(rows[0].passed_at).toBeNull();
    // Passing later keeps the pass even if a later try is worse.
    await pass(leader.id, "the-success-picture");
    await db.asUser(leader.id, (q) => q("select public.submit_quiz('the-success-picture', $1::jsonb)", [JSON.stringify(allWrong)]));
    const after = await db.admin.query(
      `select p.best_score, p.passed_at from public.academy_progress p join public.academy_modules m on m.id = p.module_id
        where p.person_id = $1 and m.slug = 'the-success-picture'`,
      [leader.id],
    );
    expect(after.rows[0].best_score).toBe(100);
    expect(after.rows[0].passed_at).not.toBeNull();
  });

  it("insists on an answer for every question, and on real options", async () => {
    const leader = await approved("leader");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('the-why', '[0,1]'::jsonb)")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('the-why', '[0,0,0,0,0,9]'::jsonb)")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('the-why', '[0,0,0,0,0,null]'::jsonb)")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('the-why', '{}'::jsonb)")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('no-such-module', '[]'::jsonb)")), "P0002");
  });

  it("allows five tries a day per module, which stops guessing", async () => {
    const leader = await approved("leader");
    const wrong = (await key("using-the-platform")).map((a) => (a + 1) % 4);
    for (let i = 0; i < 5; i++) {
      await db.asUser(leader.id, (q) => q("select public.submit_quiz('using-the-platform', $1::jsonb)", [JSON.stringify(wrong)]));
    }
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_quiz('using-the-platform', $1::jsonb)", [JSON.stringify(wrong)])), "22023");
    // Another module is unaffected.
    const ok = await pass(leader.id, "the-why");
    expect(ok.passed).toBe(true);
  });

  it("shows each person only their own progress", async () => {
    const a = await approved("leader");
    const b = await approved("assistant_leader");
    await pass(a.id, "the-why");
    const mine = await db.asUser(b.id, (q) => q("select public.my_academy() as r"));
    const first = mine.rows[0].r.modules.find((m: { slug: string }) => m.slug === "the-why");
    expect(first.passed).toBe(false);
    expect(first.attempts).toBe(0);
    expect(mine.rows[0].r.modules).toHaveLength(6);
    expect(mine.rows[0].r.is_leader).toBe(false);
  });
});

describe("the safeguarding declaration", () => {
  it("needs the care and safeguarding module first, and a first and last name", async () => {
    const leader = await approved("leader");
    await expectCode(db.asUser(leader.id, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola Adeyemi')")), "22023");
    await pass(leader.id, "care-and-safeguarding");
    await expectCode(db.asUser(leader.id, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola')")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.sign_safeguarding('2026-11-s1', '  ')")), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.sign_safeguarding('bad version!', 'Tola Adeyemi')")), "22023");
    await sign(leader.id);
    await sign(leader.id); // signing twice changes nothing
    const { rows } = await db.admin.query("select count(*)::int as n, min(signed_name) as name from public.safeguarding_declarations where person_id = $1", [leader.id]);
    expect(rows[0]).toEqual({ n: 1, name: "Tola Adeyemi" });
  });

  it("is not signed for you by anyone else", async () => {
    const leader = await approved("leader");
    const other = await approved("leader");
    await pass(other.id, "care-and-safeguarding");
    await sign(other.id);
    const mine = await db.asUser(leader.id, (q) => q("select public.my_academy() as r"));
    expect(mine.rows[0].r.declaration).toBeNull();
    await expectCode(db.asUser(leader.id, (q) => q("select * from public.safeguarding_declarations")), "42501");
  });
});

describe("workshops", () => {
  const add = (userId: string, kind = "practice_workshop", hours = 72, capacity = 30) =>
    db.asUser(userId, (q) => q("select public.add_academy_session($1, $2, 120, 'online', 'https://meet.example/abc', $3) as id", [kind, inHours(hours), capacity]));

  it("is added and removed by the office only", async () => {
    const director = await person("director");
    const coach = await person("coach");
    const leader = await approved("leader");
    await expectCode(add(coach.id), "42501");
    await expectCode(add(leader.id), "42501");
    const made = await add(director.id);
    expect(made.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expectCode(add(director.id, "practice_workshop", 0), "22023");
    await expectCode(add(director.id, "party"), "22023");
    await expectCode(db.asUser(coach.id, (q) => q("select public.remove_academy_session($1)", [made.rows[0].id])), "42501");
    await db.asUser(director.id, (q) => q("select public.remove_academy_session($1)", [made.rows[0].id]));
  });

  it("is booked one date at a time, within capacity, and shows the place only to those booked", async () => {
    const director = await person("director");
    const a = await approved("leader");
    const b = await approved("assistant_leader");
    const c = await approved("assistant_leader");
    const one = (await add(director.id, "practice_workshop", 72, 2)).rows[0].id as string;
    const other = (await add(director.id, "practice_workshop", 96, 5)).rows[0].id as string;

    const before = await db.asUser(a.id, (q) => q("select public.my_academy() as r"));
    const listed = before.rows[0].r.sessions.find((s: { id: string }) => s.id === one);
    expect(listed.place).toBeNull();
    expect(listed.seats_left).toBe(2);

    await db.asUser(a.id, (q) => q("select public.book_academy_session($1)", [one]));
    await db.asUser(a.id, (q) => q("select public.book_academy_session($1)", [one])); // again is harmless
    await expectCode(db.asUser(a.id, (q) => q("select public.book_academy_session($1)", [other])), "22023");
    await db.asUser(b.id, (q) => q("select public.book_academy_session($1)", [one]));
    await expectCode(db.asUser(c.id, (q) => q("select public.book_academy_session($1)", [one])), "22023");

    const after = await db.asUser(a.id, (q) => q("select public.my_academy() as r"));
    const mine = after.rows[0].r.sessions.find((s: { id: string }) => s.id === one);
    expect(mine.booked).toBe(true);
    expect(mine.place).toBe("https://meet.example/abc");
    expect(mine.seats_left).toBe(0);

    // A full workshop frees up when someone cancels.
    await db.asUser(b.id, (q) => q("select public.cancel_academy_booking($1)", [one]));
    await db.asUser(c.id, (q) => q("select public.book_academy_session($1)", [one]));
  });

  it("lets only a trainee book, and a booking cannot be cancelled within a day", async () => {
    const director = await person("director");
    const member = await person();
    const leader = await approved("leader");
    const soon = (await add(director.id, "commissioning_workshop", 5)).rows[0].id as string;
    await expectCode(db.asUser(member.id, (q) => q("select public.book_academy_session($1)", [soon])), "42501");
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [soon]));
    await expectCode(db.asUser(leader.id, (q) => q("select public.cancel_academy_booking($1)", [soon])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.book_academy_session(gen_random_uuid())")), "22023");
  });

  it("is marked on the register by a coach, once it has started", async () => {
    const coach = await person("coach");
    const leader = await approved("leader");
    const stranger = await approved("leader");
    const future = (await add((await person("director")).id)).rows[0].id as string;
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [future]));
    await expectCode(db.asUser(coach.id, (q) => q("select public.mark_attendance($1, $2, true)", [future, leader.id])), "22023");

    // Move the workshop into the past, as time would.
    await db.admin.query("update public.academy_sessions set starts_at = now() - interval '2 hours' where id = $1", [future]);
    await expectCode(db.asUser(leader.id, (q) => q("select public.mark_attendance($1, $2, true)", [future, leader.id])), "42501");
    await expectCode(db.asUser(coach.id, (q) => q("select public.mark_attendance($1, $2, true)", [future, stranger.id])), "22023");
    await db.asUser(coach.id, (q) => q("select public.mark_attendance($1, $2, true)", [future, leader.id]));

    const mine = await db.asUser(leader.id, (q) => q("select public.my_academy() as r"));
    expect(mine.rows[0].r.attended.practice_workshop).toBe(true);
    expect(mine.rows[0].r.attended.commissioning_workshop).toBe(false);

    const cohort = await db.asUser(coach.id, (q) => q("select public.academy_cohort() as r"));
    const row = cohort.rows[0].r.find((r: { person_id: string }) => r.person_id === leader.id);
    expect(row.workshops.practice_workshop).toBe("attended");
    expect(row.workshops.commissioning_workshop).toBeNull();
    // Having been, a second booking of the same workshop is refused.
    const again = (await add((await person("director")).id)).rows[0].id as string;
    await expectCode(db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [again])), "22023");
  });

  it("shows registers to the panel and only counts to the office", async () => {
    const admin = await person("admin");
    const pastor = await person("pastor");
    const leader = await approved("leader");
    const s = (await add((await person("director")).id)).rows[0].id as string;
    await db.asUser(leader.id, (q) => q("select public.book_academy_session($1)", [s]));
    const seenByPastor = await db.asUser(pastor.id, (q) => q("select public.academy_sessions_admin() as r"));
    const row = seenByPastor.rows[0].r.find((x: { id: string }) => x.id === s);
    expect(row.roster.map((r: { person_id: string }) => r.person_id)).toContain(leader.id);
    const seenByAdmin = await db.asUser(admin.id, (q) => q("select public.academy_sessions_admin() as r"));
    const adminRow = seenByAdmin.rows[0].r.find((x: { id: string }) => x.id === s);
    expect(adminRow.booked).toBe(1);
    expect(adminRow.roster).toEqual([]);
    await expectCode(db.asUser(leader.id, (q) => q("select public.academy_sessions_admin()")), "42501");
  });
});

describe("the practice session", () => {
  it("is marked ready or not yet by the panel, never by the person themself", async () => {
    const coach = await person("coach");
    const leader = await approved("leader");
    const member = await person();
    await expectCode(db.asUser(leader.id, (q) => q("select public.record_practice($1, 'co_lead', true, null)", [leader.id])), "42501");
    await expectCode(db.asUser(coach.id, (q) => q("select public.record_practice($1, 'co_lead', true, null)", [member.id])), "22023");
    await expectCode(db.asUser(coach.id, (q) => q("select public.record_practice($1, 'live', true, null)", [leader.id])), "22023");
    await expectCode(db.asUser(coach.id, (q) => q("select public.record_practice($1, 'co_lead', false, null)", [leader.id])), "22023");
    await expectCode(db.asUser(coach.id, (q) => q("select public.record_practice($1, 'co_lead', null, 'x')", [leader.id])), "22023");

    await readyForCoach(leader.id, coach.id, false);
    let mine = await db.asUser(leader.id, (q) => q("select public.my_academy() as r"));
    expect(mine.rows[0].r.practice).toMatchObject({ ready: false, note: "Practise keeping time." });
    expect(mine.rows[0].r.state.practice).toBe(false);

    await readyForCoach(leader.id, coach.id, true);
    mine = await db.asUser(leader.id, (q) => q("select public.my_academy() as r"));
    expect(mine.rows[0].r.practice.ready).toBe(true);
    expect(mine.rows[0].r.state.practice).toBe(true);
  });
});

describe("certification", () => {
  it("makes an assistant leader certified only when modules, declaration and practice are all done", async () => {
    const coach = await person("coach");
    const assistant = await approved("assistant_leader");

    for (const slug of SLUGS.slice(0, 5)) await pass(assistant.id, slug);
    await readyForCoach(assistant.id, coach.id);
    await sign(assistant.id);
    expect(await certified(assistant.id), "five of six modules is not enough").toBe(false);

    await pass(assistant.id, "using-the-platform");
    expect(await certified(assistant.id)).toBe(true);
    const { rows } = await db.admin.query("select as_role from public.leader_certifications where person_id = $1", [assistant.id]);
    expect(rows[0].as_role).toBe("assistant_leader");
    const mine = await db.asUser(assistant.id, (q) => q("select public.my_academy() as r"));
    expect(mine.rows[0].r.certified_at).not.toBeNull();
    expect(mine.rows[0].r.state.card_required).toBe(false);
  });

  it("does not certify without the declaration, or without the practice session", async () => {
    const coach = await person("coach");
    const noSignature = await approved("assistant_leader");
    await passAll(noSignature.id);
    await readyForCoach(noSignature.id, coach.id);
    expect(await certified(noSignature.id)).toBe(false);
    await sign(noSignature.id);
    expect(await certified(noSignature.id)).toBe(true);

    const noPractice = await approved("assistant_leader");
    await passAll(noPractice.id);
    await sign(noPractice.id);
    expect(await certified(noPractice.id)).toBe(false);
    await readyForCoach(noPractice.id, coach.id, false);
    expect(await certified(noPractice.id)).toBe(false);
    await readyForCoach(noPractice.id, coach.id, true);
    expect(await certified(noPractice.id)).toBe(true);
  });

  it("asks a tribe leader for the fourth condition too: an approved Tribe Card", async () => {
    const coach = await person("coach");
    const pastor = await person("pastor");
    const leader = await approved("leader");
    await passAll(leader.id);
    await sign(leader.id);
    await readyForCoach(leader.id, coach.id);
    expect(await certified(leader.id), "three of four").toBe(false);

    const card = await newCard(leader.id);
    await fillCard(leader.id, card);
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [card]));
    expect(await certified(leader.id), "a submitted card is not an approved one").toBe(false);

    await db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [card]));
    expect(await certified(leader.id)).toBe(true);
    const { rows } = await db.admin.query("select as_role from public.leader_certifications where person_id = $1", [leader.id]);
    expect(rows[0].as_role).toBe("leader");
  });

  it("cannot be written by anyone through the API", async () => {
    const leader = await approved("leader");
    await expectCode(db.asUser(leader.id, (q) => q("select public.refresh_certification($1)", [leader.id])), "42501");
    await expectCode(db.asUser(leader.id, (q) => q("select public.certification_state($1)", [leader.id])), "42501");
  });
});

describe("the Tribe Card", () => {
  it("starts from the approved application, with track, community and goal fixed", async () => {
    const leader = await approved("leader", { community: "marriage-relationships", goal: "strengthen-our-marriage", track: "stewards", leadBest: "connection" });
    const id = await newCard(leader.id);
    const again = await newCard(leader.id);
    expect(again, "one card per leader per season").toBe(id);

    const { rows } = await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"));
    const card = rows[0].c;
    expect(card.status).toBe("draft");
    expect(card.track.slug).toBe("stewards");
    expect(card.community.slug).toBe("marriage-relationships");
    expect(card.goal.slug).toBe("strengthen-our-marriage");
    expect(card.fixed.sort()).toEqual(["community", "goal", "track"]);
    expect(card.name).toMatch(/Tola/);
    expect(card.editable).toBe(true);
    expect(card.missing).toEqual(expect.arrayContaining(["story", "time", "mode", "zone", "god", "others", "life"]));
    expect(card.missing).not.toContain("community");

    // Trying to change the fixed fields changes nothing.
    await fillCard(leader.id, id, { community: "education", goal: "grow-as-an-educator", track: "rising" });
    const after = await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"));
    expect(after.rows[0].c.community.slug).toBe("marriage-relationships");
    expect(after.rows[0].c.goal.slug).toBe("strengthen-our-marriage");
    expect(after.rows[0].c.track.slug).toBe("stewards");
  });

  it("lets a leader whose goal was in their own words choose one from their community's list", async () => {
    const leader = await approved("leader", { community: "education", goalOnly: false, track: "rising" });
    const id = await newCard(leader.id);
    let card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.fixed).toEqual(expect.arrayContaining(["community", "track"]));
    expect(card.fixed).not.toContain("goal");
    expect(card.goal).toBeNull();
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ goal: "strengthen-our-marriage" })])), "22023");
    await fillCard(leader.id, id, { goal: "grow-as-an-educator" });
    card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.goal.slug).toBe("grow-as-an-educator");
  });

  it("is only for approved tribe leaders", async () => {
    const assistant = await approved("assistant_leader");
    const member = await person();
    await expectCode(db.asUser(assistant.id, (q) => q("select public.start_tribe_card()")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("select public.start_tribe_card()")), "42501");
    expect((await db.asUser(member.id, (q) => q("select public.my_tribe() as c"))).rows[0].c).toBeNull();
  });

  it("needs an open season", async () => {
    const leader = await approved("leader");
    await db.admin.query("update public.seasons set status = 'closed'");
    try {
      await expectCode(db.asUser(leader.id, (q) => q("select public.start_tribe_card()")), "22023");
    } finally {
      await db.admin.query("update public.seasons set status = 'planning'");
    }
  });

  it("works out the meeting slot, and refuses times members cannot make", async () => {
    const leader = await approved("leader");
    const id = await newCard(leader.id);
    const slotAt = async (day: number, time: string) => {
      await fillCard(leader.id, id, { meeting_day: day, meeting_time: time });
      return (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c.slot as string;
    };
    expect(await slotAt(3, "20:00")).toBe("weeknight-evening");
    expect(await slotAt(1, "19:30")).toBe("weeknight-evening");
    expect(await slotAt(6, "09:00")).toBe("saturday-morning");
    expect(await slotAt(0, "14:00")).toBe("sunday-afternoon");
    expect(await slotAt(0, "19:00")).toBe("sunday-evening");

    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ meeting_day: 3, meeting_time: "07:00" })])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ meeting_day: 3, meeting_time: "18:00" })])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ meeting_day: 6, meeting_time: "15:00" })])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ meeting_time: "later" })])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ meeting_day: 9 })])), "22023");
  });

  it("checks each field and says what is wrong", async () => {
    const leader = await approved("leader");
    const id = await newCard(leader.id);
    const bad = (fields: Record<string, unknown>) =>
      expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify(fields)])), "22023");
    await bad({ name: "ab" });
    await bad({ name: "x".repeat(49) });
    await bad({ story: "x".repeat(301) });
    await bad({ capacity: 13 });
    await bad({ capacity: 3 });
    await bad({ capacity: "many" });
    await bad({ mode: "hybrid" });
    await bad({ zone: "moon" });
    await bad({ tribe_type: "kids" });
    await bad({ god: "x".repeat(201) });
    await bad({ place_note: "x".repeat(121) });
    // Nothing above was saved
    const card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.capacity).toBe(12);
    expect(card.mode).toBeNull();
  });

  it("cannot be changed by another leader, or read by one", async () => {
    const owner = await approved("leader");
    const other = await approved("leader");
    const id = await newCard(owner.id);
    await expectCode(db.asUser(other.id, (q) => q("select public.save_tribe_card($1, '{}'::jsonb)", [id])), "P0002");
    await expectCode(db.asUser(other.id, (q) => q("select public.submit_tribe_card($1)", [id])), "P0002");
    const peek = await db.asUser(other.id, (q) => q("select id from public.tribes where id = $1", [id]));
    expect(peek.rows).toEqual([]);
    const own = await db.asUser(owner.id, (q) => q("select id from public.tribes where id = $1", [id]));
    expect(own.rows).toHaveLength(1);
    // Direct writes are closed: only the functions change a card.
    await expectCode(db.asUser(owner.id, (q) => q("update public.tribes set status = 'approved' where id = $1", [id])), "42501");
    await expectCode(db.asUser(owner.id, (q) => q("delete from public.tribes where id = $1", [id])), "42501");
  });

  it("cannot be sent before the Success Picture module is passed, or while incomplete", async () => {
    const leader = await approved("leader");
    const id = await newCard(leader.id);
    await fillCard(leader.id, id);
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id])), "22023");
    await pass(leader.id, "the-success-picture");

    await fillCard(leader.id, id, { story: "Too short." });
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id])), "22023");
    await fillCard(leader.id, id, GOOD_CARD);
    await fillCard(leader.id, id, { life: "" });
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id])), "22023");
    await fillCard(leader.id, id, GOOD_CARD);

    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));
    const card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.status).toBe("submitted");
    expect(card.editable).toBe(false);
    // While it is with the pastorate it is frozen.
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [id, JSON.stringify({ name: "A new name" })])), "22023");
    await expectCode(db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id])), "22023");
  });

  it("is approved or sent back by a pastor or director, with a reason, never by its own leader or a coach", async () => {
    const pastor = await person("pastor");
    const director = await person("director");
    const coach = await person("coach");
    const leader = await approved("leader");
    await pass(leader.id, "the-success-picture");
    const id = await newCard(leader.id);
    await fillCard(leader.id, id);
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));

    await expectCode(db.asUser(coach.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [id])), "42501");
    await expectCode(db.asUser(leader.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [id])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'changes', '')", [id])), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'maybe', 'x')", [id])), "22023");

    await db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'changes', 'Make the Loving Life line measurable.')", [id]));
    let card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.status).toBe("changes_requested");
    expect(card.review_note).toBe("Make the Loving Life line measurable.");
    expect(card.editable).toBe(true);

    await fillCard(leader.id, id, { life: "Each of us completes 10 of 12 weekly steps and leads one team meeting." });
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));
    card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.review_note, "the old note goes when the card is sent again").toBeNull();

    await db.asUser(director.id, (q) => q("select public.decide_tribe_card($1, 'approve', 'Lovely.')", [id]));
    card = (await db.asUser(leader.id, (q) => q("select public.my_tribe() as c"))).rows[0].c;
    expect(card.status).toBe("approved");
    expect(card.published_at).not.toBeNull();
    await expectCode(db.asUser(director.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [id])), "22023");
  });

  it("can be sent back after approval, which takes it off the shelf", async () => {
    const pastor = await person("pastor");
    const leader = await approved("leader");
    await pass(leader.id, "the-success-picture");
    const id = await newCard(leader.id);
    await fillCard(leader.id, id);
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));
    await db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [id]));
    await db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'changes', 'The meeting time clashes with the midweek service.')", [id]));
    const { rows } = await db.admin.query("select status, published_at from public.tribes where id = $1", [id]);
    expect(rows[0].status).toBe("changes_requested");
    expect(rows[0].published_at).toBeNull();
  });

  it("is seen by the pastorate, and by a coach only for tribes assigned to them", async () => {
    const pastor = await person("pastor");
    const coachA = await person("coach");
    const coachB = await person("coach");
    const leader = await approved("leader");
    await pass(leader.id, "the-success-picture");
    const id = await newCard(leader.id);
    await fillCard(leader.id, id);
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));

    const inQueue = async (userId: string) =>
      (await db.asUser(userId, (q) => q("select public.tribe_queue() as r"))).rows[0].r.some((r: { id: string }) => r.id === id);
    expect(await inQueue(pastor.id)).toBe(true);
    expect(await inQueue(coachA.id)).toBe(false);
    await expectCode(db.asUser(coachA.id, (q) => q("select public.review_tribe($1)", [id])), "P0002");

    await expectCode(db.asUser(coachA.id, (q) => q("select public.assign_coach($1, $2)", [id, coachA.id])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.assign_coach($1, $2)", [id, leader.id])), "22023");
    await db.asUser(pastor.id, (q) => q("select public.assign_coach($1, $2)", [id, coachA.id]));
    expect(await inQueue(coachA.id)).toBe(true);
    expect(await inQueue(coachB.id)).toBe(false);
    const detail = await db.asUser(coachA.id, (q) => q("select public.review_tribe($1) as r", [id]));
    expect(detail.rows[0].r.can_decide).toBe(false);
    expect(detail.rows[0].r.coach.id).toBe(coachA.id);
    // The coach can read their tribe row, and not the other coach's.
    expect((await db.asUser(coachA.id, (q) => q("select id from public.tribes where id = $1", [id]))).rows).toHaveLength(1);
    expect((await db.asUser(coachB.id, (q) => q("select id from public.tribes where id = $1", [id]))).rows).toHaveLength(0);
    await expectCode(db.asUser(leader.id, (q) => q("select public.tribe_queue()")), "42501");
  });
});

describe("pairing a leader with an assistant", () => {
  async function submittedCard(leadBest: string) {
    const leader = await approved("leader", { leadBest });
    await pass(leader.id, "the-success-picture");
    const id = await newCard(leader.id);
    await fillCard(leader.id, id);
    await db.asUser(leader.id, (q) => q("select public.submit_tribe_card($1)", [id]));
    return { leader, id };
  }

  it("ranks a connecting assistant above a structured one for a structured leader", async () => {
    const pastor = await person("pastor");
    const { id } = await submittedCard("structure");
    const connector = await approved("assistant_leader", { leadBest: "connection" });
    const planner = await approved("assistant_leader", { leadBest: "structure" });
    const { rows } = await db.asUser(pastor.id, (q) => q("select public.suggest_assistants($1) as r", [id]));
    const list = rows[0].r as { person_id: string; fit: number; reason: string; style: string }[];
    const a = list.find((x) => x.person_id === connector.id)!;
    const b = list.find((x) => x.person_id === planner.id)!;
    expect(a.fit).toBeGreaterThan(b.fit);
    expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
    expect(a.reason).toMatch(/conversation and connection.*structure and preparation/);
    expect(b.reason).toMatch(/Shares your strength/);
    expect(a.fit).toBeLessThanOrEqual(100);
  });

  it("pairs one assistant to one tribe a season, and lets the panel change its mind", async () => {
    const pastor = await person("pastor");
    const one = await submittedCard("connection");
    const two = await submittedCard("teaching");
    const assistant = await approved("assistant_leader", { leadBest: "structure" });

    await expectCode(db.asUser(one.leader.id, (q) => q("select public.pair_assistant($1, $2)", [one.id, assistant.id])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.pair_assistant($1, $2)", [one.id, one.leader.id])), "22023");
    const notAssistant = await person();
    await expectCode(db.asUser(pastor.id, (q) => q("select public.pair_assistant($1, $2)", [one.id, notAssistant.id])), "22023");

    await db.asUser(pastor.id, (q) => q("select public.pair_assistant($1, $2)", [one.id, assistant.id]));
    await expectCode(db.asUser(pastor.id, (q) => q("select public.pair_assistant($1, $2)", [two.id, assistant.id])), "22023");

    // The paired assistant is not offered to the other tribe, but is shown as paired on their own.
    const others = await db.asUser(pastor.id, (q) => q("select public.suggest_assistants($1) as r", [two.id]));
    expect(others.rows[0].r.map((x: { person_id: string }) => x.person_id)).not.toContain(assistant.id);
    const here = await db.asUser(pastor.id, (q) => q("select public.suggest_assistants($1) as r", [one.id]));
    expect(here.rows[0].r.find((x: { person_id: string }) => x.person_id === assistant.id).paired_here).toBe(true);

    // The leader and the assistant both see the pairing.
    const mine = await db.asUser(assistant.id, (q) => q("select public.my_tribe() as c"));
    expect(mine.rows[0].c.role).toBe("assistant");
    expect(mine.rows[0].c.leader.id).toBe(one.leader.id);
    const lead = await db.asUser(one.leader.id, (q) => q("select public.my_tribe() as c"));
    expect(lead.rows[0].c.assistant.id).toBe(assistant.id);

    await db.asUser(pastor.id, (q) => q("select public.unpair_assistant($1)", [one.id]));
    await db.asUser(pastor.id, (q) => q("select public.pair_assistant($1, $2)", [two.id, assistant.id]));
  });
});

describe("the cohort and the totals", () => {
  it("lets the panel see where every trainee stands, and nobody else", async () => {
    const coach = await person("coach");
    const leader = await approved("leader");
    const member = await person();
    await pass(leader.id, "the-why");
    const { rows } = await db.asUser(coach.id, (q) => q("select public.academy_cohort() as r"));
    const row = rows[0].r.find((r: { person_id: string }) => r.person_id === leader.id);
    expect(row.role).toBe("leader");
    expect(row.state.modules_passed).toBe(1);
    expect(row.state.modules_total).toBe(6);
    expect(row.card).toBeNull();
    expect(rows[0].r.find((r: { person_id: string }) => r.person_id === member.id)).toBeUndefined();
    await expectCode(db.asUser(leader.id, (q) => q("select public.academy_cohort()")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("select public.academy_cohort()")), "42501");
  });

  it("gives the office totals without names", async () => {
    const director = await person("director");
    const leader = await approved("leader");
    await expectCode(db.asUser(leader.id, (q) => q("select public.academy_stats()")), "42501");
    const { rows } = await db.asUser(director.id, (q) => q("select public.academy_stats() as r"));
    const stats = rows[0].r;
    expect(stats.trainees).toBeGreaterThan(0);
    expect(stats.modules).toHaveLength(6);
    expect(JSON.stringify(stats)).not.toContain("@");
  });
});

describe("agreement between the screen and the database", () => {
  it("accepts every start time the Tribe Card screen offers, and nothing just outside", async () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      for (const time of timesFor(day)) {
        const { rows } = await db.admin.query("select public.tribe_slot_for($1, $2::time) as slot", [day, time]);
        expect(rows[0].slot, `day ${day} at ${time}`).not.toBeNull();
      }
    }
    // The half hours either side of each window are refused.
    for (const [day, time] of [[3, "19:00"], [3, "22:00"], [6, "06:30"], [6, "12:00"], [0, "12:30"], [0, "22:00"]] as const) {
      const { rows } = await db.admin.query("select public.tribe_slot_for($1, $2::time) as slot", [day, time]);
      expect(rows[0].slot, `day ${day} at ${time}`).toBeNull();
    }
  });
});
