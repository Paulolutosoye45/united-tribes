import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

// Two seasons so a finished one and a running one can be read side by side:
//   season 1 is over (week 13): two circles with a full twelve weeks of meetings, pulses and steps
//   season 2 is running: one circle of five and one of four, with four weeks logged

let db: TestDb;
let season1: string;
let season2: string;
let centreId: string;
let trackId: string;
let tribeId: string;
let goalId: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb();
  const season = (await db.admin.query("select id, centre_id from public.seasons order by starts_on limit 1")).rows[0];
  season1 = season.id;
  centreId = season.centre_id;
  trackId = (await db.admin.query("select id from public.tracks where slug = 'builders'")).rows[0].id;
  tribeId = (await db.admin.query("select id from public.tribes where slug = 'professionals'")).rows[0].id;
  goalId = (await db.admin.query("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).rows[0].id;
  season2 = (
    await db.admin.query(
      `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks)
       values ($1, 'Season B', public.today_lagos() - 30, public.today_lagos() + 53, 12) returning id`,
      [centreId],
    )
  ).rows[0].id;
});

afterAll(async () => {
  await db.close();
});

/** Puts a season in week `week`, `day` days into that week. Week 0 means it starts in a week; 13 means it is over. */
async function at(week: number, day: number, season: string) {
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

async function staff(name: string, role: string) {
  const u = await person(name);
  await db.grant(u.id, role);
  return u;
}

async function makeCircle(season: string, o: { coach?: string; certified?: boolean; name?: string } = {}) {
  const leader = await person(`Leader${++n}`);
  await db.grant(leader.id, "leader");
  const { rows } = await db.admin.query(
    `insert into public.circles (season_id, leader_id, coach_id, status, name, track_id, tribe_id, season_goal_id, fixed, circle_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, 'approved', $4, $5, $6, $7, '{}', 'mixed', 'My story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland',
             'Online', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [season, leader.id, o.coach ?? null, o.name ?? `Circle ${n}`, trackId, tribeId, goalId],
  );
  if (o.certified) await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
  return { leader, circle: rows[0].id as string };
}

async function join(circle: string, season: string, name: string, degree = 90, rank = 1) {
  const u = await person(name);
  await db.admin.query(
    `insert into public.circle_members (circle_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     values ($1, $2, $3, $4, $5, 'test', '{}'::jsonb, current_date + 14)`,
    [circle, u.id, season, rank, degree],
  );
  return u;
}

/** Holds `weeks` meetings; each person is present for their first `presence` weeks and away after. */
async function meetings(circle: string, leaderId: string, weeks: number, presence: [string, number][]) {
  for (let w = 1; w <= weeks; w++) {
    await db.admin.query("insert into public.circle_logs (circle_id, week, held, logged_by) values ($1, $2, true, $3)", [circle, w, leaderId]);
    for (const [person, count] of presence) {
      await db.admin.query("insert into public.circle_attendance (circle_id, week, person_id, status) values ($1, $2, $3, $4)", [
        circle, w, person, w <= count ? "present" : "absent",
      ]);
    }
  }
}

async function pulse(circle: string, person: string, week: number, belonging: number, god: number, others: number, life: number) {
  await db.admin.query(
    "insert into public.pulses (person_id, circle_id, week, belonging, god, others, life) values ($1, $2, $3, $4, $5, $6, $7)",
    [person, circle, week, belonging, god, others, life],
  );
}

async function step(circle: string, person: string, week: number, outcome: "done" | "partly" | "not_yet" | null) {
  await db.admin.query(
    `insert into public.week_steps (person_id, circle_id, week, when_text, will_text, outcome, checked_at)
     values ($1, $2, $3, 'I wake up', 'pray for ten minutes', $4, case when $4::text is null then null else now() end)`,
    [person, circle, week, outcome],
  );
}

async function profile(person: string, season: string) {
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times)
     values ($1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', '{}')`,
    [person, season, tribeId, goalId],
  );
}

const call = async (userId: string, sql: string, params: unknown[] = []) =>
  (await db.asUser(userId, (q) => q(sql, params))).rows[0]?.r;
const dash = (userId: string, season: string | null = null) => call(userId, "select public.dashboard($1) as r", [season]);
const progress = (userId: string, circle: string) => call(userId, "select public.circle_progress($1) as r", [circle]);
const mine = (userId: string) => call(userId, "select public.my_progress() as r");

type Person = { id: string; email: string };
const S: {
  director: Person; pastor: Person; dataLead: Person; admin: Person; careLead: Person; outsider: Person;
  coach1: Person; coach2: Person;
  c1: { leader: Person; circle: string }; c2: { leader: Person; circle: string };
  r1: { leader: Person; circle: string }; r2: { leader: Person; circle: string };
  m: Person[]; // season 1, circle 1: M1..M6
  e: Person[]; // season 1, circle 2: five who all did well
  ra: Person[]; // season 2, circle 1: five
  rb: Person[]; // season 2, circle 2: four
} = {} as never;

// ---------------------------------------------------------------------------
// The world the tests read
// ---------------------------------------------------------------------------

beforeAll(async () => {
  S.director = await staff("Dir", "director");
  S.pastor = await staff("Pas", "pastor");
  S.dataLead = await staff("Dat", "data_lead");
  S.admin = await staff("Adm", "admin");
  S.careLead = await staff("Car", "care_lead");
  S.outsider = await person("Outsider");
  S.coach1 = await staff("Coach1", "coach");
  S.coach2 = await staff("Coach2", "coach");

  await at(13, 0, season1);
  await at(5, 2, season2);

  // ---- Season 1, circle 1: six people, three thriving ----
  S.c1 = await makeCircle(season1, { coach: S.coach1.id, certified: true, name: "Alpha circle" });
  S.m = [];
  for (const [name, degree, rank] of [["M1", 90, 1], ["M2", 75, 2], ["M3", 75, 2], ["M4", 90, 1], ["M5", 90, 1], ["M6", 75, 2]] as const) {
    S.m.push(await join(S.c1.circle, season1, name, degree, rank));
  }
  const [m1, m2, m3, m4, m5, m6] = S.m;
  await meetings(S.c1.circle, S.c1.leader.id, 12, [[m1.id, 8], [m2.id, 7], [m3.id, 12], [m4.id, 9], [m5.id, 8], [m6.id, 0]]);
  // week-1 pulse (belonging, god, others, life) and the final one
  await pulse(S.c1.circle, m1.id, 1, 4, 3, 3, 3); await pulse(S.c1.circle, m1.id, 12, 4, 4, 4, 4); //  9 -> 12, +3, belongs
  await pulse(S.c1.circle, m2.id, 1, 5, 3, 3, 3); await pulse(S.c1.circle, m2.id, 12, 5, 4, 3, 3); //  9 -> 10, +1
  await pulse(S.c1.circle, m3.id, 1, 5, 4, 3, 3); await pulse(S.c1.circle, m3.id, 12, 3, 4, 3, 3); // 10 -> 10, +0, no longer belongs
  await pulse(S.c1.circle, m4.id, 1, 3, 3, 3, 2); await pulse(S.c1.circle, m4.id, 12, 5, 4, 4, 4); //  8 -> 12, +4
  await pulse(S.c1.circle, m5.id, 1, 4, 3, 3, 2); await pulse(S.c1.circle, m5.id, 12, 4, 4, 4, 3); //  8 -> 11, +3
  await step(S.c1.circle, m1.id, 1, "done"); await step(S.c1.circle, m1.id, 2, "done"); await step(S.c1.circle, m1.id, 3, "partly");
  await step(S.c1.circle, m2.id, 1, "not_yet");
  await step(S.c1.circle, m3.id, 1, null);

  // ---- Season 1, circle 2: five who all did well ----
  S.c2 = await makeCircle(season1, { coach: S.coach2.id, name: "Beta circle" });
  S.e = [];
  for (const name of ["E1", "E2", "E3", "E4", "E5"]) S.e.push(await join(S.c2.circle, season1, name));
  await meetings(S.c2.circle, S.c2.leader.id, 12, S.e.map((p) => [p.id, 10] as [string, number]));
  for (const p of S.e) {
    await pulse(S.c2.circle, p.id, 1, 4, 3, 3, 3);
    await pulse(S.c2.circle, p.id, 12, 5, 4, 4, 4);
  }

  // ---- Season 2 (running, week 5): four weeks logged ----
  S.r1 = await makeCircle(season2, { coach: S.coach1.id, name: "Gamma circle" });
  S.ra = [];
  for (const name of ["RA", "RB", "RC", "RD", "RE"]) S.ra.push(await join(S.r1.circle, season2, name));
  const [ra, rb, rc, rd, re] = S.ra;
  await meetings(S.r1.circle, S.r1.leader.id, 4, [[ra.id, 4], [rb.id, 2], [rc.id, 3], [rd.id, 4], [re.id, 3]]);
  await pulse(S.r1.circle, ra.id, 1, 5, 3, 3, 3);
  await pulse(S.r1.circle, rb.id, 1, 4, 3, 3, 3);
  await pulse(S.r1.circle, rc.id, 1, 4, 3, 3, 3);
  await pulse(S.r1.circle, rd.id, 1, 2, 3, 3, 3);
  await pulse(S.r1.circle, re.id, 1, 5, 3, 3, 3);
  S.r2 = await makeCircle(season2, { name: "Delta circle" });
  S.rb = [];
  for (const name of ["SA", "SB", "SC", "SD"]) S.rb.push(await join(S.r2.circle, season2, name));
  await meetings(S.r2.circle, S.r2.leader.id, 4, S.rb.map((p) => [p.id, 4] as [string, number]));
  for (const p of S.rb) await pulse(S.r2.circle, p.id, 1, 5, 3, 3, 3);

  // ---- The journey into season 1: forms, circles shown, demand ----
  for (const p of [...S.m, ...S.e, S.outsider]) await profile(p.id, season1);
  const model = (await db.admin.query("select version from public.match_models limit 1")).rows[0].version;
  for (const p of [S.m[0], S.m[1], S.outsider]) {
    await db.admin.query("insert into public.match_runs (person_id, season_id, model_version, candidates, shown) values ($1, $2, $3, 5, 3)", [p.id, season1, model]);
  }
  await db.admin.query(
    "insert into public.match_demand (person_id, season_id, circle_kind, shown) values ($1, $2, 'mixed', 0)",
    [S.outsider.id, season1],
  );

  // ---- Care and testimonies in season 1 ----
  await db.admin.query(
    `insert into public.care_flags (circle_id, person_id, kind, status, opened_at) values
       ($1, $2, 'missed_twice', 'open', now() - interval '5 days'),
       ($1, $3, 'low_belonging', 'open', now() - interval '1 day'),
       ($1, $4, 'missed_twice', 'escalated', now() - interval '2 days')`,
    [S.c1.circle, m2.id, m3.id, m6.id],
  );
  await db.admin.query(
    `insert into public.care_flags (circle_id, person_id, kind, status, opened_at, closed_at, closed_by)
     values ($1, $2, 'not_yet_twice', 'closed', now() - interval '3 days', now() - interval '1 day', $3)`,
    [S.c1.circle, m2.id, S.c1.leader.id],
  );
  const body = "God has been faithful to me this season and I want to say thank you.";
  for (const [who, status, share] of [
    [m1, "submitted", "circle"], [m2, "submitted", "church"], [m3, "circle_approved", "circle"], [m4, "church_approved", "church"], [m5, "declined", "circle"],
  ] as const) {
    await db.admin.query(
      "insert into public.testimonies (person_id, circle_id, week, body, share_with, credit, status) values ($1, $2, 11, $3, $4, 'first_name', $5)",
      [who.id, S.c1.circle, body, share, status],
    );
  }
});

// ---------------------------------------------------------------------------

describe("the targets and who can read them", () => {
  it("holds the programme to 85% thriving, 8 of 12 meetings and a belonging of 4", async () => {
    const t = (await db.admin.query("select public.kpi_targets() as r")).rows[0].r;
    expect(t).toMatchObject({ thriving_rate: 0.85, belonging_min: 4, gain_min: 2, effective_thriving: 0.8, effective_gain: 0.7, retrain_after: 300 });
    expect(Number(t.attend_share) * 12).toBeCloseTo(8, 6);
  });

  it("is closed to visitors, members, leaders and the care lead", async () => {
    await expectCode(db.asAnon((q) => q("select public.dashboard(null)")), "42501");
    for (const who of [S.outsider, S.careLead, S.c1.leader]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.dashboard(null)")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.circle_progress($1)", [S.c1.circle])), "42501");
    await expectCode(db.asAnon((q) => q("select public.my_progress()")), "42501");
    // the workings are not callable at all
    await expectCode(db.asUser(S.director.id, (q) => q("select * from public.kpi_members($1)", [season1])), "42501");
    await expectCode(db.asUser(S.director.id, (q) => q("select * from public.kpi_circles($1)", [season1])), "42501");
  });

  it("opens on the latest season that has started", async () => {
    const d = await dash(S.director.id);
    expect(d.season.id).toBe(season2);
    expect(d.seasons).toHaveLength(2);
  });
});

describe("thriving, in a season that is over", () => {
  it("counts a member only if they came to 8 of 12 and their latest belonging is 4 or 5", async () => {
    const d = await dash(S.director.id, season1);
    expect(d.state).toBe("complete");
    // C1: M1 (8, belongs) M4 (9) M5 (8) thrive; M2 (7 meetings), M3 (belonging fell to 3), M6 (never came) do not. C2: all five.
    expect(d.headline).toMatchObject({ members: 11, thriving: 8, measured: true, circles: 2 });
    expect(d.headline.thriving_rate).toBeCloseTo(8 / 11, 3);
  });

  it("adds up the Success Picture and the gain", async () => {
    const h = (await dash(S.director.id, season1)).headline;
    expect(h).toMatchObject({ base_n: 10, gain_n: 10 });
    expect(h.base_avg).toBeCloseTo(8.9, 1);
    expect(h.latest_avg).toBeCloseTo(11.5, 1);
    expect(h.gain_avg).toBeCloseTo(2.6, 1);
    expect(h.gain_share).toBeCloseTo(0.8, 3); // eight of ten gained two points or more
  });

  it("measures attendance, steps and who is still coming", async () => {
    const h = (await dash(S.director.id, season1)).headline;
    expect(h.attendance_rate).toBeCloseTo((44 + 50) / (72 + 60), 3);
    expect(h.steps_done_rate).toBeCloseTo(0.5, 3); // 2 done of 4 answered
    expect(h.checkin_rate).toBeCloseTo(0.8, 3); // 4 answered of 5 chosen
    expect(h.ever_came).toBe(10);
    expect(h.still_coming).toBe(6); // came in the last three weeks: M3 and the five in circle 2
  });

  it("calls a circle effective only when 80% thrive and 70% gain, and not yet otherwise", async () => {
    const d = await dash(S.director.id, season1);
    const by = Object.fromEntries(d.circles.map((c: { name: string }) => [c.name, c]));
    expect(by["Beta circle"]).toMatchObject({ verdict: "effective", members: 5, thriving: 5, thriving_rate: 1 });
    expect(by["Alpha circle"]).toMatchObject({ verdict: "not_yet", members: 6, thriving: 3, thriving_rate: 0.5 });
    expect(by["Alpha circle"].gain_avg).toBeCloseTo(2.2, 1);
    expect(by["Alpha circle"].gain_share).toBeCloseTo(0.6, 3);
    expect(by["Alpha circle"].attendance_rate).toBeCloseTo(44 / 72, 3);
    expect(d.headline.verdicts).toMatchObject({ effective: 1, not_yet: 1, on_course: 0, close: 0, at_risk: 0 });
    // the circle that needs help comes first
    expect(d.circles[0].name).toBe("Alpha circle");
  });

  it("does not call a circle effective on thriving alone when nobody answered the last pulse", async () => {
    const { circle, leader } = await makeCircle(season1, { name: "Quiet circle" });
    const p = [];
    for (const name of ["Q1", "Q2", "Q3", "Q4", "Q5"]) p.push(await join(circle, season1, name));
    await meetings(circle, leader.id, 12, p.map((x) => [x.id, 12] as [string, number]));
    for (const x of p) await pulse(circle, x.id, 6, 5, 3, 3, 3); // belonging recorded at the halfway pulse only
    const row = (await dash(S.director.id, season1)).circles.find((c: { name: string }) => c.name === "Quiet circle");
    expect(row).toMatchObject({ thriving: 5, verdict: "not_yet" });
    expect(row.gain_avg).toBeNull();
    await db.admin.query("delete from public.circle_members where circle_id = $1", [circle]);
    await db.admin.query("delete from public.circles where id = $1", [circle]);
  });
});

describe("thriving, while the season runs", () => {
  it("shows no rate before three weeks have passed", async () => {
    await at(3, 2, season2); // two weeks are over
    const d = await dash(S.director.id, season2);
    expect(d.state).toBe("running");
    expect(d.headline).toMatchObject({ measured: false, thriving_rate: null });
    expect(d.circles.every((c: { verdict: string; thriving_rate: number | null }) => c.verdict === "too_early" && c.thriving_rate === null)).toBe(true);
  });

  it("counts people by how they are doing so far: meetings against two thirds, and belonging", async () => {
    await at(4, 2, season2); // three weeks are over, two thirds is two of three
    let g = (await dash(S.director.id, season2)).circles.find((c: { name: string }) => c.name === "Gamma circle");
    // RA 3, RB 2 (just enough), RC 3, RE 3 thrive; RD came every week but does not belong
    expect(g).toMatchObject({ thriving: 4, members: 5, thriving_rate: 0.8, verdict: "on_course" });

    await at(5, 2, season2); // four weeks over, two thirds is three of four
    g = (await dash(S.director.id, season2)).circles.find((c: { name: string }) => c.name === "Gamma circle");
    expect(g).toMatchObject({ thriving: 3, thriving_rate: 0.6, verdict: "close" }); // RB has now missed too many
  });

  it("marks a circle at risk below 60%", async () => {
    const d = await dash(S.director.id, season2);
    const delta = d.circles.find((c: { name: string }) => c.name === "Delta circle");
    expect(delta).toMatchObject({ verdict: "on_course", thriving: 4 });
    await db.admin.query("update public.pulses set belonging = 2 where circle_id = $1 and person_id in ($2, $3)", [S.r2.circle, S.rb[0].id, S.rb[1].id]);
    const again = (await dash(S.director.id, season2)).circles.find((c: { name: string }) => c.name === "Delta circle");
    expect(again).toMatchObject({ verdict: "at_risk", thriving: 2 });
    await db.admin.query("update public.pulses set belonging = 5 where circle_id = $1", [S.r2.circle]);
  });

  it("shows nothing but counts before the season starts", async () => {
    await at(0, 0, season2);
    const d = await dash(S.director.id, season2);
    expect(d.state).toBe("before");
    expect(d.headline.thriving_rate).toBeNull();
    expect(d.circles.every((c: { verdict: string }) => c.verdict === "before")).toBe(true);
    expect(d.weeks).toEqual([]);
    expect(d.headline.members).toBe(9);
    await at(5, 2, season2);
  });
});

describe("who sees what", () => {
  it("shows a coach only their own circles and none of the church-wide views", async () => {
    const d = await dash(S.coach1.id, season1);
    expect(d.scope).toBe("coach");
    expect(d.circles.map((c: { name: string }) => c.name)).toEqual(["Alpha circle"]);
    expect(d.headline.members).toBe(6);
    for (const key of ["funnel", "supply", "tribes", "accuracy", "care", "testimonies"]) expect(d).not.toHaveProperty(key);
    const other = await dash(S.coach2.id, season1);
    expect(other.circles.map((c: { name: string }) => c.name)).toEqual(["Beta circle"]);
    expect(other.headline).toMatchObject({ members: 5, thriving: 5 });
    // a coach with circles in the running season only sees theirs there too
    expect((await dash(S.coach1.id, season2)).circles.map((c: { name: string }) => c.name)).toEqual(["Gamma circle"]);
  });

  it("shows the pastor, director, admin and data lead everything", async () => {
    for (const who of [S.pastor, S.director, S.admin, S.dataLead]) {
      const d = await dash(who.id, season1);
      expect(d.scope).toBe("church");
      expect(d.headline.members).toBe(11);
      expect(d).toHaveProperty("funnel");
    }
  });

  it("names leaders and coaches but no member, and no answer from any member", async () => {
    const text = JSON.stringify(await dash(S.director.id, season1));
    expect(text).not.toMatch(/M[1-6] Test|E[1-5] Test|Outsider/);
    expect(text).not.toContain("pray for ten minutes");
    expect(text).not.toContain("God has been faithful");
  });
});

describe("the church-wide views", () => {
  it("follows the journey from the form to thriving", async () => {
    const f = (await dash(S.director.id, season1)).funnel as { key: string; count: number }[];
    expect(Object.fromEntries(f.map((x) => [x.key, x.count]))).toEqual({
      started: 12, finished: 12, shown: 3, chose: 11, came: 10, thriving: 8,
    });
  });

  it("sets the seats against the people who asked for them", async () => {
    const s = (await dash(S.director.id, season1)).supply;
    // only the certified leader's circle counts as seats; everyone placed counts as placed
    expect(s).toMatchObject({ wants: 12, seats: 12, placed: 11, unmet: 1 });
    expect(s.cells).toEqual([{ tribe: "Professionals", track: "Builders", wants: 12, seats: 12, placed: 11 }]);
    expect(s.tribes).toHaveLength(11);
    expect(s.tracks).toEqual(["Rising", "Builders", "Stewards", "Sages"]); // the teens track is not open yet
  });

  it("breaks the result down by tribe", async () => {
    const t = (await dash(S.director.id, season1)).tribes;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ tribe: "Professionals", members: 11 });
    expect(t[0].thriving_rate).toBeCloseTo(8 / 11, 3);
  });

  it("shows whether a higher score predicts thriving, and hides a rate for fewer than five people", async () => {
    const a = (await dash(S.director.id, season1)).accuracy;
    const band = Object.fromEntries(a.bands.map((b: { key: string }) => [b.key, b]));
    expect(band.excellent).toMatchObject({ n: 8, thriving_rate: 1 }); // M1, M4, M5 and all five of circle 2
    expect(band.strong).toMatchObject({ n: 3, thriving_rate: null, attendance_rate: null }); // M2, M3 and M6: too few to read
    expect(band.good).toMatchObject({ n: 0, thriving_rate: null });
    const rank = Object.fromEntries(a.ranks.map((r: { rank: number }) => [r.rank, r]));
    expect(rank[1]).toMatchObject({ n: 8, thriving_rate: 1 });
    expect(rank[2]).toMatchObject({ n: 3, thriving_rate: null });
    expect(a.average_degree).toBe(86);
  });

  it("counts finished placements toward the point where the weights can be retrained", async () => {
    const a = (await dash(S.director.id, season1)).accuracy;
    expect(a.completed).toBe(11); // season 1 is over; season 2 is still running
    expect(a.retrain_after).toBe(300);
  });

  it("counts follow-ups and testimonies", async () => {
    const d = await dash(S.director.id, season1);
    expect(d.care).toMatchObject({ open: 2, escalated: 1, oldest_open_days: 5, closed_7d: 1 });
    expect(d.care.median_days_to_close).toBeCloseTo(2, 1);
    expect(d.testimonies).toEqual({ waiting: 2, circle: 1, church: 1, declined: 1 });
  });

  it("gives the week-by-week picture", async () => {
    const d = await dash(S.director.id, season1);
    expect(d.weeks).toHaveLength(12);
    expect(d.weeks[0]).toMatchObject({ week: 1, logged: 2, met: 2, present: 10, possible: 11, steps_set: 3, steps_done: 1, steps_checked: 2 });
    expect(d.weeks[11]).toMatchObject({ week: 12, present: 1 }); // only M3 was still coming in C1; the five in C2 stopped at week 10
  });
});

describe("a leader's view of their own circle", () => {
  it("shows meetings and steps, and the circle's verdict once six people stand behind it", async () => {
    const p = await progress(S.c1.leader.id, S.c1.circle);
    expect(p).toMatchObject({ state: "complete", members: 6, can_see_rate: true, thriving: 3, verdict: "not_yet", held: 12 });
    expect(p.attendance_rate).toBeCloseTo(44 / 72, 3);
    expect(p.weeks).toHaveLength(12);
    expect(p.picture).toMatchObject({ answers: 5 });
    expect(p.picture.base_avg).toBeCloseTo(8.8, 1);
    expect(p.picture.latest_avg).toBeCloseTo(11, 1);
    expect(p.picture.gain_avg).toBeCloseTo(2.2, 1);
  });

  it("never carries a member's belonging, and paces each person on meetings alone", async () => {
    const p = await progress(S.c1.leader.id, S.c1.circle);
    expect(JSON.stringify(p.member_rows)).not.toMatch(/belong|pulse|reflection|when_text|will_text|pray for/i);
    const by = Object.fromEntries(p.member_rows.map((r: { name: string }) => [r.name, r]));
    expect(by["M1 Test"]).toMatchObject({ attended: 8, pace: "on_pace", steps_set: 3, steps_done: 2 });
    expect(by["M2 Test"]).toMatchObject({ attended: 7, pace: "behind" });
    expect(by["M6 Test"]).toMatchObject({ attended: 0, pace: "behind" });
  });

  it("hides the circle-wide thriving figure from a leader when fewer than five people stand behind it", async () => {
    const p = await progress(S.r2.leader.id, S.r2.circle);
    expect(p).toMatchObject({ members: 4, can_see_rate: false, thriving: null, thriving_rate: null, verdict: null });
    expect(p.attendance_rate).not.toBeNull(); // they know who came
    expect(p.picture.answers).toBe(4);
  });

  it("shows a coach or a pastor the verdict for a small circle", async () => {
    // r2 has no coach, so the office reads it
    const p = await progress(S.pastor.id, S.r2.circle);
    expect(p).toMatchObject({ can_see_rate: true, verdict: "on_course" });
    const g = await progress(S.coach1.id, S.r1.circle);
    expect(g.verdict).toBe("close");
  });

  it("is only for the people who run the circle", async () => {
    await expectCode(db.asUser(S.c2.leader.id, (q) => q("select public.circle_progress($1)", [S.c1.circle])), "42501");
    await expectCode(db.asUser(S.coach2.id, (q) => q("select public.circle_progress($1)", [S.c1.circle])), "42501");
    await expectCode(db.asUser(S.outsider.id, (q) => q("select public.circle_progress($1)", [S.c1.circle])), "42501");
    await expectCode(db.asUser(S.careLead.id, (q) => q("select public.circle_progress($1)", [S.c1.circle])), "42501");
    await expectCode(db.asUser(S.director.id, (q) => q("select public.circle_progress('00000000-0000-0000-0000-000000000000')")), "P0002");
  });
});

describe("a member's view of their own season", () => {
  it("says nothing is placed for someone without a circle", async () => {
    expect(await mine(S.outsider.id)).toEqual({ placed: false });
  });

  it("tells a member who finished well that they thrived, with their own numbers", async () => {
    const p = await mine(S.m[0].id);
    expect(p).toMatchObject({ placed: true, state: "complete", status: "thriving", attended: 8, held: 12, gain: 3 });
    expect(p.steps).toEqual({ set: 3, done: 2, partly: 1, not_yet: 0 });
    expect(p.pulses).toHaveLength(2);
    expect(p.pulses[0]).toMatchObject({ week: 1, belonging: 4, total: 9 });
    expect(p.pulses[1]).toMatchObject({ week: 12, total: 12 });
    expect(p.season.meetings_needed).toBe(8);
  });

  it("is kind but honest to someone who did not", async () => {
    expect((await mine(S.m[1].id)).status).toBe("not_yet");
    expect((await mine(S.m[2].id)).status).toBe("not_yet");
  });

  it("reads where someone stands while the season runs, and says it is early before week 4", async () => {
    await at(5, 2, season2);
    expect((await mine(S.ra[0].id)).status).toBe("on_pace");
    expect((await mine(S.ra[1].id)).status).toBe("catching_up");
    await at(3, 2, season2);
    expect((await mine(S.ra[0].id)).status).toBe("too_early");
    await at(0, 0, season2);
    expect((await mine(S.ra[0].id)).status).toBe("before");
    await at(5, 2, season2);
  });

  it("never shows anyone else's numbers", async () => {
    const text = JSON.stringify(await mine(S.m[0].id));
    expect(text).not.toMatch(/M[2-6] Test|E[1-5] Test/);
  });
});

describe("when people leave", () => {
  it("drops a deleted person from every figure", async () => {
    await db.admin.query("delete from auth.users where id = $1", [S.m[5].id]); // M6
    const d = await dash(S.director.id, season1);
    expect(d.headline.members).toBe(10);
    expect(d.circles.find((c: { name: string }) => c.name === "Alpha circle").members).toBe(5);
    expect(d.funnel.find((x: { key: string }) => x.key === "chose").count).toBe(10);
  });
});
