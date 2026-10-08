import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;
let seasonId: string;
let centreId: string;
let trackId: string;
let tribeId: string;
let goalId: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb();
  const season = (await db.admin.query("select id, centre_id from public.seasons order by starts_on limit 1")).rows[0];
  seasonId = season.id;
  centreId = season.centre_id;
  trackId = (await db.admin.query("select id from public.tracks where slug = 'builders'")).rows[0].id;
  tribeId = (await db.admin.query("select id from public.tribes where slug = 'professionals'")).rows[0].id;
  goalId = (await db.admin.query("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

/** Puts the season in week `week`, `day` days into that week (0 = the first day, 5 = the Friday of a Sunday start). */
async function at(week: number, day = 0, season = seasonId) {
  await db.admin.query(
    `update public.seasons set starts_on = public.today_lagos() - $1::int, ends_on = public.today_lagos() - $1::int + 83 where id = $2`,
    [(week - 1) * 7 + day, season],
  );
}

async function person(name: string) {
  const u = await db.createUser();
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Test`, name]);
  return u;
}

async function makeCircle(o: { season?: string; coach?: string; assistant?: string; name?: string } = {}) {
  const leader = await person(`Leader${++n}`);
  await db.grant(leader.id, "leader");
  const { rows } = await db.admin.query(
    `insert into public.circles (season_id, leader_id, assistant_id, coach_id, status, name, track_id, tribe_id, season_goal_id, fixed, circle_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, $4, 'approved', $5, $6, $7, $8, '{}', 'mixed', 'My story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland',
             'Online', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [o.season ?? seasonId, leader.id, o.assistant ?? null, o.coach ?? null, o.name ?? `Circle ${n}`, trackId, tribeId, goalId],
  );
  return { leader, circle: rows[0].id as string };
}

async function join(circle: string, name: string, season = seasonId) {
  const u = await person(name);
  await db.admin.query(
    `insert into public.circle_members (circle_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
    [circle, u.id, season],
  );
  return u;
}

const call = async (userId: string, sql: string, params: unknown[] = []) =>
  (await db.asUser(userId, (q) => q(sql, params))).rows[0]?.r;
const week = (userId: string) => call(userId, "select public.my_week() as r");
const kinds = (w: { nudges: { kind: string }[] }) => w.nudges.map((x) => x.kind);
type Att = [string, "present" | "absent" | "excused"];
const log = (leaderId: string, circle: string, wk: number, held: boolean, att: Att[], highlight: string | null = null) =>
  call(leaderId, "select public.save_circle_log($1, $2, $3, $4, $5::jsonb) as r", [
    circle, wk, held, highlight, JSON.stringify(att.map(([person, status]) => ({ person, status }))),
  ]);
const cweek = (userId: string, circle: string, wk: number | null = null) => call(userId, "select public.circle_week($1, $2) as r", [circle, wk]);
const flags = async (circle: string) => (await db.admin.query("select * from public.care_flags where circle_id = $1 order by opened_at", [circle])).rows;

// ---------------------------------------------------------------------------

describe("the guides and the calendar", () => {
  it("has twelve guides in the same 75-minute shape", async () => {
    const { rows } = await db.admin.query("select * from public.week_guides order by week");
    expect(rows).toHaveLength(12);
    rows.forEach((g, i) => {
      expect(g.week).toBe(i + 1);
      expect(g.questions).toHaveLength(3);
      expect(g.step_hint).toMatch(/^When /);
      const plan = g.plan as { minutes: number }[];
      expect(plan).toHaveLength(5);
      expect(plan.reduce((a, b) => a + b.minutes, 0)).toBe(75);
    });
    expect(rows[0].theme).toBe("begin");
    expect(rows[5].theme).toBe("review");
    expect(rows[11].theme).toBe("finish");
  });

  it("counts weeks from the start date and puts pulses in weeks 1, 6 and 12", async () => {
    const { rows } = await db.admin.query(
      `select public.season_week('2027-02-14', 12, '2027-02-13') as before, public.season_week('2027-02-14', 12, '2027-02-14') as first,
              public.season_week('2027-02-14', 12, '2027-02-20') as still_first, public.season_week('2027-02-14', 12, '2027-02-21') as second,
              public.season_week('2027-02-14', 12, '2027-05-08') as last, public.season_week('2027-02-14', 12, '2027-05-09') as after`,
    );
    expect(rows[0]).toEqual({ before: 0, first: 1, still_first: 1, second: 2, last: 12, after: 13 });
    const pulses = (await db.admin.query("select w from generate_series(1, 12) w where public.is_pulse_week(w, 12)")).rows.map((r) => r.w);
    expect(pulses).toEqual([1, 6, 12]);
  });

  it("keeps the guides and every table out of the app's reach", async () => {
    const u = await person("Nobody");
    for (const table of ["week_guides", "week_steps", "circle_logs", "circle_attendance", "pulses", "care_flags", "testimonies"]) {
      await expectCode(db.asUser(u.id, (q) => q(`select * from public.${table}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${table}`)), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.my_week()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.today_lagos()")), "42501");
  });
});

describe("a member's week", () => {
  it("says nothing is placed for someone without a circle", async () => {
    const u = await person("Alone");
    expect((await week(u.id)).placed).toBe(false);
  });

  it("counts down before the season, shows no guide yet and offers no steps", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() + 9, ends_on = public.today_lagos() + 92 where id = $1", [seasonId]);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const w = await week(ada.id);
    expect(w).toMatchObject({ placed: true, state: "before", days_to_start: 9, week: null, guide: null });
    expect(w.circle.leader_first_name).toMatch(/^Leader/);
    await expectCode(call(ada.id, "select public.save_week_step(1, 'Monday', 'pray') as r"), "22023");
  });

  it("shows this week's guide, the draft Success Picture and a nudge to set a step", async () => {
    await at(3, 2);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const w = await week(ada.id);
    expect(w).toMatchObject({ state: "running", week: 3, weeks: 12 });
    expect(w.guide.title).toBe("Pray with expectation, not performance");
    expect(w.guide.questions).toHaveLength(3);
    expect(w.guide.plan).toBeUndefined();
    expect(w.guide.leader_tip).toBeUndefined();
    expect(w.picture).toEqual({ god: "Pray daily.", others: "Call each other.", life: "Take one step a week.", refined: false });
    expect(w.nudges).toEqual([{ kind: "set_step", week: 3 }]);
    expect(w.rows).toHaveLength(12);
    expect(w.rows[2].state).toBe("now");
    expect(w.circle.meeting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lets a member read the guide and step of an earlier week, never a later one", async () => {
    await at(4, 1);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await db.admin.query(
      "insert into public.week_steps (person_id, circle_id, week, when_text, will_text, outcome) values ($1, $2, 2, 'When I wake', 'I will pray', 'done')", [ada.id, circle]);
    const back = await call(ada.id, "select public.my_week(2) as r");
    expect(back).toMatchObject({ week: 4, viewing: 2 });
    expect(back.guide.title).toBe("Hear Him every day");
    expect(back.step).toMatchObject({ week: 2, outcome: "done" });
    expect(kinds(back)).toContain("set_step"); // the nudge is always about this week
    expect((await call(ada.id, "select public.my_week(9) as r")).viewing).toBe(4);
    expect((await call(ada.id, "select public.my_week(0) as r")).viewing).toBe(4);
  });

  it("works out the meeting day from the season start", async () => {
    await at(2, 0);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const w = await week(ada.id);
    const start = (await db.admin.query("select starts_on::text as d, extract(dow from starts_on)::int as dow from public.seasons where id = $1", [seasonId])).rows[0];
    const offset = (3 - start.dow + 7) % 7;
    const expected = (await db.admin.query("select (($1::date) + 7 + $2::int)::text as d", [start.d, offset])).rows[0].d;
    expect(w.circle.meeting_date).toBe(expected);
  });

  it("is complete after the last week and then asks for a testimony", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 120, ends_on = public.today_lagos() - 37 where id = $1", [seasonId]);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const w = await week(ada.id);
    expect(w.state).toBe("complete");
    expect(w.guide).toBeNull();
    expect(w.nudges).toEqual([{ kind: "testimony", week: 12 }]);
  });

  it("keeps the last check-in and the last pulse open for a few days after the final week", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 85, ends_on = public.today_lagos() - 2 where id = $1", [seasonId]);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await db.admin.query(
      "insert into public.week_steps (person_id, circle_id, week, when_text, will_text) values ($1, $2, 12, 'When I wake', 'I will pray')", [ada.id, circle]);
    const w = await week(ada.id);
    expect(w.state).toBe("complete");
    expect(w.nudges).toEqual(expect.arrayContaining([{ kind: "check_in", week: 12 }, { kind: "pulse", week: 12 }, { kind: "testimony", week: 12 }]));
    await call(ada.id, "select public.save_checkin(12, 'done', null) as r");
    await call(ada.id, "select public.save_pulse(12, 5, 5, 4, 4, null) as r");
    expect(kinds(await week(ada.id))).toEqual(["testimony"]);
  });
});

describe("the step and the Friday check-in", () => {
  it("saves a step for the current week only, and can be rewritten before the check-in", async () => {
    await at(2, 1);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await call(ada.id, "select public.save_week_step(2, 'When I wake up', 'I will pray for ten minutes') as r");
    await call(ada.id, "select public.save_week_step(2, 'When I get into the car', 'I will read a psalm') as r");
    const w = await week(ada.id);
    expect(w.step).toMatchObject({ week: 2, when: "When I get into the car", will: "I will read a psalm", outcome: null });
    expect(kinds(w)).not.toContain("set_step");
    expect((await db.admin.query("select count(*)::int as c from public.week_steps where person_id = $1", [ada.id])).rows[0].c).toBe(1);
    await expectCode(call(ada.id, "select public.save_week_step(1, 'When', 'I will pray') as r"), "22023");
    await expectCode(call(ada.id, "select public.save_week_step(3, 'When', 'I will pray') as r"), "22023");
  });

  it("refuses empty or over-long steps", async () => {
    await at(2, 1);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await expectCode(call(ada.id, "select public.save_week_step(2, '', 'I will pray') as r"), "22023");
    await expectCode(call(ada.id, "select public.save_week_step(2, 'When I wake', '  ') as r"), "22023");
    await expectCode(call(ada.id, "select public.save_week_step(2, $1, 'I will pray') as r", ["x".repeat(141)]), "22023");
  });

  it("opens the check-in on Friday, offers it as a nudge, and closes it on the Tuesday after", async () => {
    await at(2, 2);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await call(ada.id, "select public.save_week_step(2, 'When I wake', 'I will pray') as r");
    await expectCode(call(ada.id, "select public.save_checkin(2, 'done', null) as r"), "22023");
    expect((await week(ada.id)).check_in.week).toBeNull();

    await at(2, 5);
    expect((await week(ada.id)).nudges).toContainEqual({ kind: "check_in", week: 2 });
    await call(ada.id, "select public.save_checkin(2, 'partly', 'Did four days') as r");
    const w = await week(ada.id);
    expect(w.step).toMatchObject({ outcome: "partly", reflection: "Did four days" });
    expect(kinds(w)).not.toContain("check_in");
    await expectCode(call(ada.id, "select public.save_week_step(2, 'When I wake', 'I will pray more') as r"), "22023");

    await at(3, 2); // week 3 is running; the check-in for week 2 is still open until its Tuesday (day 9)
    await call(ada.id, "select public.save_checkin(2, 'done', null) as r");
    await at(3, 3);
    await expectCode(call(ada.id, "select public.save_checkin(2, 'done', null) as r"), "22023");
  });

  it("needs a step to check in on, and a real outcome", async () => {
    await at(2, 5);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await expectCode(call(ada.id, "select public.save_checkin(2, 'done', null) as r"), "22023");
    await call(ada.id, "select public.save_week_step(2, 'When I wake', 'I will pray') as r");
    await expectCode(call(ada.id, "select public.save_checkin(2, 'great', null) as r"), "22023");
    await expectCode(call(ada.id, "select public.save_checkin(13, 'done', null) as r"), "22023");
  });

  it("opens a follow-up after two 'not yet' weeks in a row, and not after one or after a 'done' in between", async () => {
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const bisi = await join(circle, "Bisi");
    for (const [wk, who, outcome] of [
      [1, ada, "not_yet"], [2, ada, "not_yet"],
      [1, bisi, "not_yet"], [2, bisi, "done"], [3, bisi, "not_yet"],
    ] as const) {
      await at(wk, 5);
      await call(who.id, "select public.save_week_step($1, 'When I wake', 'I will pray') as r", [wk]);
      await call(who.id, "select public.save_checkin($1, $2, null) as r", [wk, outcome]);
    }
    const open = await flags(circle);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ person_id: ada.id, kind: "not_yet_twice", status: "open" });
  });

  it("keeps a member's step text to themselves: the leader sees only whether it was done", async () => {
    await at(2, 5);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await call(ada.id, "select public.save_week_step(2, 'When I wake', 'I will forgive my brother') as r");
    await call(ada.id, "select public.save_checkin(2, 'done', 'It was hard') as r");
    const w = await cweek(leader.id, circle);
    expect(JSON.stringify(w)).not.toContain("forgive my brother");
    expect(JSON.stringify(w)).not.toContain("It was hard");
    expect(w.members[0].step).toBe("done");
  });
});

describe("the three pulses", () => {
  it("opens in weeks 1, 6 and 12, for two weeks, with each answer from 1 to 5", async () => {
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await at(1, 0);
    expect((await week(ada.id)).pulse_week).toBe(1);
    await call(ada.id, "select public.save_pulse(1, 4, 3, 4, 5, 'Glad to be here') as r");
    expect((await week(ada.id)).pulse_week).toBeNull();
    expect((await week(ada.id)).nudges.map((x: { kind: string }) => x.kind)).not.toContain("pulse");
    await call(ada.id, "select public.save_pulse(1, 5, 4, 4, 5, null) as r"); // can change her answer
    expect((await db.admin.query("select belonging from public.pulses where person_id = $1", [ada.id])).rows).toEqual([{ belonging: 5 }]);

    await at(2, 0);
    await expectCode(call(ada.id, "select public.save_pulse(2, 4, 4, 4, 4, null) as r"), "22023");
    await at(6, 0);
    await expectCode(call(ada.id, "select public.save_pulse(12, 4, 4, 4, 4, null) as r"), "22023");
    await expectCode(call(ada.id, "select public.save_pulse(6, 6, 4, 4, 4, null) as r"), "22023");
    await expectCode(call(ada.id, "select public.save_pulse(6, 0, 4, 4, 4, null) as r"), "22023");
    await expectCode(call(ada.id, "select public.save_pulse(6, 4, 4, 4, null, null) as r"), "22023");
    await call(ada.id, "select public.save_pulse(6, 4, 4, 4, 4, null) as r");
    await at(8, 0);
    await expectCode(call(ada.id, "select public.save_pulse(6, 4, 4, 4, 4, null) as r"), "22023"); // closed after two weeks
  });

  it("opens a follow-up for a belonging of 1 or 2, and only then", async () => {
    await at(1, 1);
    const { circle } = await makeCircle();
    const low = await join(circle, "Low");
    const ok = await join(circle, "Ok");
    await call(low.id, "select public.save_pulse(1, 2, 4, 4, 4, null) as r");
    await call(ok.id, "select public.save_pulse(1, 3, 4, 4, 4, null) as r");
    const open = await flags(circle);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ person_id: low.id, kind: "low_belonging" });
  });

  it("shows the belonging average only when at least three people answered", async () => {
    await at(1, 1);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "A");
    const b = await join(circle, "B");
    const c = await join(circle, "C");
    await call(a.id, "select public.save_pulse(1, 5, 4, 4, 4, null) as r");
    await call(b.id, "select public.save_pulse(1, 3, 4, 4, 4, null) as r");
    expect((await cweek(leader.id, circle)).report).toMatchObject({ pulse_week: true, pulse_answers: 2, belonging_average: null });
    await call(c.id, "select public.save_pulse(1, 4, 4, 4, 4, null) as r");
    expect((await cweek(leader.id, circle)).report).toMatchObject({ pulse_answers: 3, belonging_average: 4 });
  });
});

describe("the leader's two-minute log", () => {
  it("records who came and gives the week's numbers", async () => {
    await at(2, 4);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    const b = await join(circle, "Bisi");
    const c = await join(circle, "Chike");
    const d = await join(circle, "Dayo");
    const report = await log(leader.id, circle, 2, true, [[a.id, "present"], [b.id, "present"], [c.id, "absent"], [d.id, "excused"]], "A good talk about prayer");
    expect(report).toMatchObject({ week: 2, logged: true, held: true, members: 4, present: 2, absent: 1, excused: 1, attendance_rate: 0.5, highlight: "A good talk about prayer" });
    const w = await cweek(leader.id, circle, 2);
    expect(w.members.find((m: { first_name: string }) => m.first_name === "Ada").attendance).toBe("present");
    expect(w.members.find((m: { first_name: string }) => m.first_name === "Chike").attendance).toBe("absent");
    expect(w.log).toMatchObject({ held: true, highlight: "A good talk about prayer" });
    expect((await week(a.id)).rows[1]).toMatchObject({ week: 2, held: true, attended: "present" });
    expect((await week(c.id)).rows[1].attended).toBe("absent");
    expect((await week(a.id)).attended).toBe(1);
  });

  it("can be saved again to correct it, without leaving old rows behind", async () => {
    await at(2, 4);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    const b = await join(circle, "Bisi");
    await log(leader.id, circle, 2, true, [[a.id, "present"], [b.id, "absent"]]);
    const fixed = await log(leader.id, circle, 2, true, [[a.id, "present"], [b.id, "present"]]);
    expect(fixed).toMatchObject({ present: 2, absent: 0 });
    expect((await db.admin.query("select count(*)::int as c from public.circle_attendance where circle_id = $1", [circle])).rows[0].c).toBe(2);
  });

  it("insists everyone is marked, only members are named, and only real statuses are used", async () => {
    await at(2, 4);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    const b = await join(circle, "Bisi");
    const stranger = await person("Stranger");
    await expectCode(log(leader.id, circle, 2, true, [[a.id, "present"]]), "22023");
    await expectCode(log(leader.id, circle, 2, true, [[a.id, "present"], [a.id, "present"]]), "22023");
    await expectCode(log(leader.id, circle, 2, true, [[a.id, "present"], [stranger.id, "present"]]), "P0002");
    await expectCode(log(leader.id, circle, 2, true, [[a.id, "present"], [b.id, "late" as "present"]]), "22023");
    await expectCode(call(leader.id, "select public.save_circle_log($1, 2, true, null, null) as r", [circle]), "22023");
    await expectCode(call(leader.id, "select public.save_circle_log($1, 2, null, null, '[]') as r", [circle]), "22023");
    await expectCode(log(leader.id, circle, 2, false, [], "x".repeat(301)), "22023");
  });

  it("cannot log a week that has not started or that closed two weeks ago, except by a pastor", async () => {
    await at(2, 0);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    await expectCode(log(leader.id, circle, 3, true, [[a.id, "present"]]), "22023");
    await expectCode(log(leader.id, circle, 13, true, [[a.id, "present"]]), "22023");
    await expectCode(log(leader.id, circle, 0, true, [[a.id, "present"]]), "22023");
    await log(leader.id, circle, 1, true, [[a.id, "present"]]); // week 1 ended a day ago: still open
    await at(3, 0);
    await expectCode(log(leader.id, circle, 1, true, [[a.id, "present"]]), "22023");
    const pastor = await person("Pastor");
    await db.grant(pastor.id, "pastor");
    expect(await log(pastor.id, circle, 1, true, [[a.id, "absent"]])).toMatchObject({ absent: 1 });
    expect((await cweek(leader.id, circle, 1)).log_open).toBe(false);
    expect((await cweek(pastor.id, circle, 1)).log_open).toBe(true);
  });

  it("is open to the assistant leader and closed to everyone else", async () => {
    await at(2, 4);
    const assistant = await person("Assistant");
    await db.grant(assistant.id, "assistant_leader");
    const { leader, circle } = await makeCircle({ assistant: assistant.id });
    const a = await join(circle, "Ada");
    const other = await makeCircle();
    const coach = await person("Coach");
    await db.grant(coach.id, "coach");
    await expect(log(assistant.id, circle, 2, true, [[a.id, "present"]])).resolves.toMatchObject({ present: 1 });
    await expectCode(log(other.leader.id, circle, 2, true, [[a.id, "present"]]), "42501");
    await expectCode(log(a.id, circle, 2, true, [[a.id, "present"]]), "42501");
    await expectCode(log(coach.id, circle, 2, true, [[a.id, "present"]]), "42501");
    void leader;
  });

  it("does not count a meeting that was not held", async () => {
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    await at(1, 5);
    await log(leader.id, circle, 1, true, [[a.id, "absent"]]);
    await at(2, 5);
    const report = await log(leader.id, circle, 2, false, [], "Power cut, we moved to next week");
    expect(report).toMatchObject({ held: false, present: 0, absent: 0, status: "needs_attention" });
    await at(3, 5);
    await log(leader.id, circle, 3, true, [[a.id, "absent"]]);
    // week 1 absent, week 2 not held, week 3 absent: that is two meetings missed in a row
    expect((await flags(circle)).map((f) => f.kind)).toEqual(["missed_twice"]);
    expect((await cweek(leader.id, circle, 3)).logged_weeks).toBe(2);
  });

  it("opens a follow-up for two missed meetings in a row, and not for one, for an excusal, or after coming back", async () => {
    const { leader, circle } = await makeCircle();
    const twice = await join(circle, "Twice");
    const once = await join(circle, "Once");
    const excused = await join(circle, "Excused");
    const back = await join(circle, "Back");
    await at(1, 5);
    await log(leader.id, circle, 1, true, [[twice.id, "absent"], [once.id, "present"], [excused.id, "excused"], [back.id, "absent"]]);
    await at(2, 5);
    await log(leader.id, circle, 2, true, [[twice.id, "absent"], [once.id, "absent"], [excused.id, "absent"], [back.id, "present"]]);
    await at(3, 5);
    await log(leader.id, circle, 3, true, [[twice.id, "absent"], [once.id, "present"], [excused.id, "excused"], [back.id, "absent"]]);
    const open = await flags(circle);
    expect(open.map((f) => f.person_id).sort()).toEqual([twice.id].sort());
    // saving the same log again does not open a second one
    await log(leader.id, circle, 3, true, [[twice.id, "absent"], [once.id, "present"], [excused.id, "excused"], [back.id, "absent"]]);
    expect(await flags(circle)).toHaveLength(1);
    const w = await cweek(leader.id, circle, 3);
    expect(w.follow_ups).toHaveLength(1);
    expect(w.follow_ups[0]).toMatchObject({ kind: "missed_twice", status: "open", first_name: "Twice" });
    expect(w.members.find((m: { first_name: string }) => m.first_name === "Twice").open_follow_up).toBe(true);
  });

  it("judges the week: on track, watch, needs attention, no log, upcoming", async () => {
    const { leader, circle } = await makeCircle();
    const m: { id: string }[] = [];
    for (const x of ["A", "B", "C", "D", "E"]) m.push(await join(circle, x));
    const came = (k: number): Att[] => m.map((x, i) => [x.id, i < k ? "present" : "absent"]);
    await at(1, 5);
    expect((await log(leader.id, circle, 1, true, came(5))).status).toBe("on_track");
    await at(2, 5);
    expect((await log(leader.id, circle, 2, true, came(3))).status).toBe("watch"); // 60%
    await at(3, 5);
    expect((await log(leader.id, circle, 3, true, came(2))).status).toBe("needs_attention"); // 40%
    await at(5, 0);
    expect((await cweek(leader.id, circle, 4)).report.status).toBe("no_log"); // that week is over and nothing was logged
    expect((await cweek(leader.id, circle, 5)).report.status).toBe("upcoming"); // today is the first day of the week
    expect((await cweek(leader.id, circle, 6)).report.status).toBe("upcoming");
  });
});

describe("follow-ups and calls", () => {
  async function withFlag() {
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    await at(1, 5);
    await log(leader.id, circle, 1, true, [[a.id, "absent"]]);
    await at(2, 5);
    await log(leader.id, circle, 2, true, [[a.id, "absent"]]);
    const flag = (await flags(circle))[0];
    return { leader, circle, ada: a, flag };
  }

  it("closes a follow-up when the call reached the person", async () => {
    const { leader, flag } = await withFlag();
    await call(leader.id, "select public.record_call($1, 'reached', 'She was travelling') as r", [flag.id]);
    const f = (await db.admin.query("select * from public.care_flags where id = $1", [flag.id])).rows[0];
    expect(f).toMatchObject({ status: "closed", attempts: 1, last_outcome: "reached", note: "She was travelling", closed_by: leader.id });
    await expectCode(call(leader.id, "select public.record_call($1, 'reached', null) as r", [flag.id]), "22023");
  });

  it("keeps trying, and escalates after three calls that did not get through", async () => {
    const { leader, flag } = await withFlag();
    for (const expected of ["open", "open", "escalated"]) {
      await call(leader.id, "select public.record_call($1, 'not_reached', null) as r", [flag.id]);
      expect((await db.admin.query("select status from public.care_flags where id = $1", [flag.id])).rows[0].status).toBe(expected);
    }
  });

  it("escalates at once when the leader asks the care team", async () => {
    const { leader, flag } = await withFlag();
    await call(leader.id, "select public.record_call($1, 'needs_care_lead', 'Lost her job') as r", [flag.id]);
    expect((await db.admin.query("select status from public.care_flags where id = $1", [flag.id])).rows[0].status).toBe("escalated");
  });

  it("refuses unknown outcomes, over-long notes, other leaders and members", async () => {
    const { flag, ada } = await withFlag();
    const other = await makeCircle();
    await expectCode(call(other.leader.id, "select public.record_call($1, 'reached', null) as r", [flag.id]), "42501");
    await expectCode(call(ada.id, "select public.record_call($1, 'reached', null) as r", [flag.id]), "42501");
    const second = await withFlag();
    await expectCode(call(second.leader.id, "select public.record_call($1, 'texted', null) as r", [second.flag.id]), "22023");
    await expectCode(call(second.leader.id, "select public.record_call($1, 'reached', $2) as r", [second.flag.id, "x".repeat(301)]), "22023");
    await expectCode(call(second.leader.id, "select public.record_call(gen_random_uuid(), 'reached', null) as r"), "P0002");
  });

  it("lets a leader raise a concern about someone in their circle, once", async () => {
    await at(3, 1);
    const { leader, circle } = await makeCircle();
    const a = await join(circle, "Ada");
    const outsider = await person("Outsider");
    await call(leader.id, "select public.raise_concern($1, $2, 'She said she is struggling') as r", [circle, a.id]);
    await call(leader.id, "select public.raise_concern($1, $2, 'Again') as r", [circle, a.id]);
    const open = await flags(circle);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "leader_concern", note: "She said she is struggling", opened_by: leader.id });
    await expectCode(call(leader.id, "select public.raise_concern($1, $2, null) as r", [circle, outsider.id]), "P0002");
    await expectCode(call(a.id, "select public.raise_concern($1, $2, null) as r", [circle, a.id]), "42501");
  });

  it("gives the care team the escalated and the long-waiting follow-ups, and nobody else", async () => {
    const { leader, circle, flag } = await withFlag();
    const care = await person("Care");
    await db.grant(care.id, "care_lead");
    const before = (await call(care.id, "select public.care_queue() as r")).items.map((i: { id: string }) => i.id);
    expect(before).not.toContain(flag.id); // opened a moment ago and not escalated
    await call(leader.id, "select public.record_call($1, 'needs_care_lead', null) as r", [flag.id]);
    const queue = await call(care.id, "select public.care_queue() as r");
    const item = queue.items.find((i: { id: string }) => i.id === flag.id);
    expect(item).toMatchObject({ status: "escalated", kind: "missed_twice", circle: expect.any(String) });
    expect(item.name).toContain("Ada");
    await call(care.id, "select public.record_call($1, 'reached', 'Spoke on Tuesday') as r", [flag.id]);
    expect((await db.admin.query("select status, closed_by from public.care_flags where id = $1", [flag.id])).rows[0]).toEqual({ status: "closed", closed_by: care.id });

    await db.admin.query("update public.care_flags set opened_at = now() - interval '4 days' where circle_id = $1 and status = 'open'", [circle]);
    await expectCode(call(leader.id, "select public.care_queue() as r"), "42501");
    const member = await person("Member");
    await expectCode(call(member.id, "select public.care_queue() as r"), "42501");
  });
});

describe("the prep pack", () => {
  it("gives the leader the whole guide with the 75-minute plan and a tip, which members never get", async () => {
    await at(4, 0);
    const { leader, circle } = await makeCircle();
    await join(circle, "Ada");
    const w = await cweek(leader.id, circle);
    expect(w).toMatchObject({ state: "running", week: 4, current_week: 4, can_edit: true, weeks: 12 });
    expect(w.guide.title).toBe("Better together");
    expect(w.guide.plan).toHaveLength(5);
    expect(w.guide.leader_tip).toMatch(/triads/);
    expect(w.week_starts_on).toBe((await db.admin.query("select (starts_on + 21)::text as d from public.seasons where id = $1", [seasonId])).rows[0].d);
  });

  it("lists a birthday this week, a full attendance record, and a run of finished steps", async () => {
    await at(5, 0);
    const { leader, circle } = await makeCircle();
    const bday = await join(circle, "Birthday");
    const keen = await join(circle, "Keen");
    const doer = await join(circle, "Doer");
    const wk5 = (await db.admin.query(
      "select extract(day from starts_on + 4 * 7 + 2)::int as d, extract(month from starts_on + 4 * 7 + 2)::int as m from public.seasons where id = $1", [seasonId])).rows[0];
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, faith_journey, season_goal_id,
          goal_baseline, meeting_mode, meeting_times, style_social, style_structure, birthday_day, birthday_month, duration_seconds)
       select $1, $2, ar.id, 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', '{}', 0, 0, $5, $6, 200
         from public.age_ranges ar where ar.slug = '33-40'`,
      [bday.id, seasonId, tribeId, goalId, wk5.d, wk5.m],
    );
    for (const wk of [1, 2, 3, 4]) {
      await db.admin.query(
        `insert into public.circle_logs (circle_id, week, held) values ($1, $2, true)`, [circle, wk]);
      for (const m of [bday, keen, doer]) {
        await db.admin.query(
          `insert into public.circle_attendance (circle_id, week, person_id, status) values ($1, $2, $3, $4)`,
          [circle, wk, m.id, m === bday && wk === 2 ? "absent" : "present"]);
      }
    }
    for (const wk of [2, 3, 4]) {
      await db.admin.query(
        `insert into public.week_steps (person_id, circle_id, week, when_text, will_text, outcome) values ($1, $2, $3, 'When I wake', 'I will pray', 'done')`,
        [doer.id, circle, wk]);
    }
    const kinds = (await cweek(leader.id, circle)).celebrations.map((c: { kind: string; first_name: string }) => `${c.kind}:${c.first_name}`);
    expect(kinds).toEqual(expect.arrayContaining(["birthday:Birthday", "every_meeting:Keen", "every_meeting:Doer", "steps_streak:Doer"]));
    expect(kinds).not.toContain("every_meeting:Birthday");
    expect(kinds).not.toContain("steps_streak:Keen");
  });

  it("lets a coach and a pastor read it, but not edit, and keeps everyone else out", async () => {
    await at(2, 3);
    const coach = await person("Coach");
    await db.grant(coach.id, "coach");
    const { leader, circle } = await makeCircle({ coach: coach.id });
    const ada = await join(circle, "Ada");
    const pastor = await person("Pastor");
    await db.grant(pastor.id, "pastor");
    const otherCoach = await person("Other coach");
    await db.grant(otherCoach.id, "coach");
    expect((await cweek(coach.id, circle)).can_edit).toBe(false);
    expect((await cweek(coach.id, circle)).log_open).toBe(false);
    expect((await cweek(pastor.id, circle)).can_edit).toBe(false);
    expect((await cweek(leader.id, circle)).can_edit).toBe(true);
    await expectCode(call(ada.id, "select public.circle_week($1, null) as r", [circle]), "42501");
    await expectCode(call(otherCoach.id, "select public.circle_week($1, null) as r", [circle]), "42501");
    await expectCode(call(leader.id, "select public.circle_week($1, 13) as r", [circle]), "P0002");
    await expectCode(call(leader.id, "select public.circle_week(gen_random_uuid(), null) as r"), "P0002");
  });

  it("shows a member's WhatsApp number to the leader only while they still share it", async () => {
    await at(2, 3);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, faith_journey, season_goal_id,
          goal_baseline, meeting_mode, meeting_times, style_social, style_structure, whatsapp, duration_seconds)
       select $1, $2, ar.id, 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', '{}', 0, 0, '+2348031234567', 200
         from public.age_ranges ar where ar.slug = '33-40'`,
      [ada.id, seasonId, tribeId, goalId],
    );
    expect((await cweek(leader.id, circle)).members[0].whatsapp).toBe("+2348031234567");
    await db.admin.query("update public.member_profiles set whatsapp = null where person_id = $1", [ada.id]);
    expect((await cweek(leader.id, circle)).members[0].whatsapp).toBeNull();
  });
});

describe("the Success Picture, refined in week 1 or 2", () => {
  it("lets the leader settle it in the first two weeks and shows it to members", async () => {
    await at(1, 3);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const refine = (userId: string, g = "We read the Word five days a week.", o = "Every person has two people who check on them.", l = "We each finish the goal we named.") =>
      call(userId, "select public.refine_success_picture($1, $2, $3, $4) as r", [circle, g, o, l]);
    expect((await cweek(leader.id, circle)).picture).toMatchObject({ refined: false, can_refine: true });
    await refine(leader.id);
    expect((await week(ada.id)).picture).toEqual({
      god: "We read the Word five days a week.", others: "Every person has two people who check on them.",
      life: "We each finish the goal we named.", refined: true });
    await expectCode(refine(leader.id, "Too short"), "22023");
    await expectCode(refine(leader.id, "x".repeat(201)), "22023");
    await expectCode(refine(ada.id), "42501");
    await at(2, 6);
    await refine(leader.id, "Changed in week two, still fine.");
    await at(3, 0);
    await expectCode(refine(leader.id), "22023");
    expect((await cweek(leader.id, circle)).picture.can_refine).toBe(false);
    expect((await db.admin.query("select loving_god from public.circles where id = $1", [circle])).rows[0].loving_god).toBe("Pray daily."); // the card stays as it was
  });

  it("keeps what each member agreed to word for word, whatever the circle refines later", async () => {
    await at(1, 1);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await db.admin.query(`update public.circle_members set covenant = '{"picture":{"god":"As agreed"}}'::jsonb where person_id = $1`, [ada.id]);
    await call(leader.id, "select public.refine_success_picture($1, 'A new line for God.', 'A new line for others.', 'A new line for life.') as r", [circle]);
    expect((await db.admin.query("select covenant from public.circle_members where person_id = $1", [ada.id])).rows[0].covenant.picture.god).toBe("As agreed");
  });
});

describe("testimonies", () => {
  const submit = (userId: string, body = "God opened a door at work that I did not expect.", share = "circle", credit = "first_name") =>
    call(userId, "select public.submit_testimony($1, $2, $3) as r", [body, share, credit]);
  const visible = async (userId: string) => (await call(userId, "select public.circle_testimonies() as r")) as { id: string; by: string; status: string; mine: boolean; body: string }[];

  it("is shared only after the leader approves, and then shows the name the author chose", async () => {
    await at(11, 2);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const bisi = await join(circle, "Bisi");
    const chike = await join(circle, "Chike");
    const idFirst = await submit(ada.id, "God opened a door at work that I did not expect.", "circle", "first_name");
    const idAnon = await submit(bisi.id, "I forgave my brother this season and we spoke again.", "circle", "anonymous");
    const idFull = await submit(chike.id, "I finished my business registration after years of waiting.", "circle", "full_name");
    expect((await visible(bisi.id)).map((t) => t.id)).toEqual([idAnon]); // her own only, still waiting
    expect((await visible(bisi.id))[0]).toMatchObject({ mine: true, status: "submitted" });

    expect((await cweek(leader.id, circle)).testimonies_waiting).toBe(3);
    for (const id of [idFirst, idAnon, idFull]) await call(leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    const seen = await visible(chike.id);
    expect(seen).toHaveLength(3);
    expect(seen.find((t) => t.id === idFirst)!.by).toBe("Ada");
    expect(seen.find((t) => t.id === idAnon)!.by).toBe("A member of the circle");
    expect(seen.find((t) => t.id === idFull)!.by).toBe("Chike Test");
    expect(JSON.stringify(seen.find((t) => t.id === idAnon))).not.toContain("Bisi");
    expect((await cweek(leader.id, circle)).testimonies_waiting).toBe(0);
  });

  it("keeps another circle's testimonies out of view, and removes a withdrawn one", async () => {
    await at(11, 2);
    const one = await makeCircle();
    const two = await makeCircle();
    const ada = await join(one.circle, "Ada");
    const eze = await join(two.circle, "Eze");
    const id = await submit(ada.id);
    await call(one.leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    expect(await visible(eze.id)).toHaveLength(0);
    await call(ada.id, "select public.withdraw_testimony($1) as r", [id]);
    const bisi = await join(one.circle, "Bisi");
    expect(await visible(bisi.id)).toHaveLength(0);
    expect((await visible(ada.id))).toHaveLength(0);
    await expectCode(call(eze.id, "select public.withdraw_testimony($1) as r", [id]), "P0002");
  });

  it("can be declined with a note that only the author reads", async () => {
    await at(11, 2);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const bisi = await join(circle, "Bisi");
    const id = await submit(ada.id, "My cousin Tunde cheated me and I will name him here.");
    await call(leader.id, "select public.review_testimony($1, 'decline', 'Please leave out names') as r", [id]);
    const mine = await visible(ada.id);
    expect(mine[0]).toMatchObject({ status: "declined", decline_note: "Please leave out names" });
    expect(await visible(bisi.id)).toHaveLength(0);
    await expectCode(call(leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]), "22023");
  });

  it("goes to the whole church only when a pastor approves it, after the leader has", async () => {
    await at(11, 2);
    const { leader, circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const pastor = await person("Pastor");
    await db.grant(pastor.id, "pastor");
    const id = await submit(ada.id, "I got the job after eight months of praying and applying.", "church", "full_name");
    const queue = await call(pastor.id, "select public.pending_testimonies() as r");
    expect(queue.church.map((t: { id: string }) => t.id)).toContain(id);
    expect((await call(leader.id, "select public.pending_testimonies() as r")).church).toEqual([]);
    expect((await call(leader.id, "select public.pending_testimonies() as r")).circle.map((t: { id: string }) => t.id)).toContain(id);

    await call(leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    expect((await db.admin.query("select status from public.testimonies where id = $1", [id])).rows[0].status).toBe("circle_approved");
    await expectCode(call(leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]), "22023");
    expect((await call(pastor.id, "select public.pending_testimonies() as r")).church.map((t: { id: string }) => t.id)).toContain(id);

    await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    expect((await db.admin.query("select status, decided_by from public.testimonies where id = $1", [id])).rows[0]).toEqual({ status: "church_approved", decided_by: pastor.id });
    expect((await call(pastor.id, "select public.pending_testimonies() as r")).church.map((t: { id: string }) => t.id)).not.toContain(id);
  });

  it("checks what is written, who may read it and who is reviewing", async () => {
    await at(5, 1);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    const other = await makeCircle();
    await expectCode(submit(ada.id, "Too short"), "22023");
    await expectCode(submit(ada.id, "x".repeat(601)), "22023");
    await expectCode(submit(ada.id, "God has been faithful to me this season.", "everyone"), "22023");
    await expectCode(submit(ada.id, "God has been faithful to me this season.", "circle", "nickname"), "22023");
    const id = await submit(ada.id, "God has been faithful to me this season.");
    await expectCode(call(other.leader.id, "select public.review_testimony($1, 'approve', null) as r", [id]), "42501");
    await expectCode(call(ada.id, "select public.review_testimony($1, 'approve', null) as r", [id]), "42501");
    for (let i = 0; i < 4; i++) await submit(ada.id, `Testimony number ${i + 2} about how good God has been.`);
    await expectCode(submit(ada.id, "A sixth testimony this season is too many."), "22023");
    const nobody = await person("Nobody");
    await expectCode(submit(nobody.id), "22023");
  });

  it("cannot be shared before the season starts", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() + 3, ends_on = public.today_lagos() + 86 where id = $1", [seasonId]);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await expectCode(submit(ada.id), "22023");
  });
});

describe("the weekly report for the office", () => {
  it("shows each coach their own circles and each pastor all of them, with the week's totals", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 400, ends_on = public.today_lagos() - 317 where id = $1", [seasonId]);
    const season2 = (await db.admin.query(
      `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks, status)
       values ($1, 'Digest season', public.today_lagos() - 10, public.today_lagos() + 73, 12, 'running') returning id`, [centreId])).rows[0].id as string;
    const coach = await person("Coach");
    await db.grant(coach.id, "coach");
    const mine = await makeCircle({ season: season2, coach: coach.id, name: "Mine" });
    const theirs = await makeCircle({ season: season2, name: "Theirs" });
    const a = await join(mine.circle, "Ada", season2);
    const b = await join(mine.circle, "Bisi", season2);
    const c = await join(theirs.circle, "Chike", season2);
    await log(mine.leader.id, mine.circle, 2, true, [[a.id, "present"], [b.id, "absent"]]);
    await log(theirs.leader.id, theirs.circle, 2, true, [[c.id, "present"]]);

    const pastor = await person("Pastor");
    await db.grant(pastor.id, "pastor");
    const all = await call(pastor.id, "select public.rhythm_digest(null) as r");
    expect(all).toMatchObject({ state: "running", season_name: "Digest season", current_week: 2, week: 2 });
    expect(all.circles.map((x: { name: string }) => x.name)).toEqual(["Mine", "Theirs"]);
    expect(all.totals).toMatchObject({ circles: 2, logged: 2, present: 2, members: 3, not_logged: 0 });
    expect(all.circles[0]).toMatchObject({ coach: expect.stringContaining("Coach"), leader: expect.stringContaining("Leader") });
    expect(all.circles[0].report).toMatchObject({ present: 1, absent: 1, attendance_rate: 0.5, status: "watch" });

    const own = await call(coach.id, "select public.rhythm_digest(2) as r");
    expect(own.circles.map((x: { name: string }) => x.name)).toEqual(["Mine"]);
    const week1 = await call(pastor.id, "select public.rhythm_digest(1) as r");
    expect(week1.circles[0].report).toMatchObject({ week: 1, logged: false, status: "no_log" });

    const member = await person("Member");
    await expectCode(call(member.id, "select public.rhythm_digest(null) as r"), "42501");
    const leaderOnly = await person("Leader only");
    await db.grant(leaderOnly.id, "leader");
    await expectCode(call(leaderOnly.id, "select public.rhythm_digest(null) as r"), "42501");
  });

  it("says there is no season yet when none has started", async () => {
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() + 30, ends_on = public.today_lagos() + 113");
    const pastor = await person("Pastor");
    await db.grant(pastor.id, "pastor");
    expect(await call(pastor.id, "select public.rhythm_digest(null) as r")).toEqual({ state: "none" });
  });
});

describe("erasure", () => {
  it("removes everything a person wrote when their account is deleted", async () => {
    await at(5, 5);
    const { circle } = await makeCircle();
    const ada = await join(circle, "Ada");
    await call(ada.id, "select public.save_week_step(5, 'When I wake', 'I will pray') as r");
    await call(ada.id, "select public.save_checkin(5, 'not_yet', null) as r");
    await call(ada.id, "select public.submit_testimony('God has been faithful to me this season.', 'circle', 'anonymous') as r");
    await db.admin.query("delete from auth.users where id = $1", [ada.id]);
    for (const table of ["week_steps", "pulses", "care_flags", "testimonies", "circle_attendance"]) {
      expect((await db.admin.query(`select count(*)::int as c from public.${table} where person_id = $1`, [ada.id])).rows[0].c).toBe(0);
    }
  });
});

