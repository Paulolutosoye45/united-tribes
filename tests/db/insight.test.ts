import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wordingProblems } from "./contract";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Stage 5: targets, the Word habit, community champions, retention, the objectives, snapshots, reports,
// the heartbeat's daily jobs, summaries and the BI copy.
//
// The world (season A is running, in its sixth week; Z finished long ago):
//   Alpha  (Professionals, certified leader and assistant, coach): P1..P6, five meetings held
//          P1 5 present, P2 5, P3 4, P4 3, P5 1, P6 0 -> P1, P2, P3 are thriving (3 of 6)
//   Beta   (Business, leader not certified): B1..B3, all five meetings -> all thriving (3 of 3)
//   Z      (Professionals): five people who came to every one of twelve meetings

let db: TestDb;
let seasonA: string;
let seasonZ: string;
let centreId: string;
let trackId: string;
let t1: string; // Professionals
let t2: string; // Business & Entrepreneurship
const goalOf: Record<string, string> = {}; // each community's own season goal
let n = 0;

type Person = { id: string; email: string };
const S: {
  director: Person; pastor: Person; dataLead: Person; admin: Person; coach: Person; outsider: Person;
  champ1: Person; champ2: Person; assistant: Person;
  alpha: { leader: Person; tribe: string }; beta: { leader: Person; tribe: string }; zed: { leader: Person; tribe: string };
  p: Person[]; b: Person[]; z: Person[];
  token: string;
} = {} as never;

beforeAll(async () => {
  db = await createTestDb();
  const season = (await db.admin.query("select id, centre_id from public.seasons order by starts_on limit 1")).rows[0];
  seasonA = season.id;
  centreId = season.centre_id;
  trackId = (await db.admin.query("select id from public.tracks where slug = 'builders'")).rows[0].id;
  t1 = (await db.admin.query("select id from public.communities where slug = 'professionals'")).rows[0].id;
  t2 = (await db.admin.query("select id from public.communities where slug = 'business-entrepreneurship'")).rows[0].id;
  for (const community of [t1, t2]) {
    goalOf[community] = (await db.admin.query("select id from public.season_goals where community_id = $1 order by sort limit 1", [community])).rows[0].id;
  }
  seasonZ = (
    await db.admin.query(
      `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks)
       values ($1, 'Season Z', public.today_lagos() - 200, public.today_lagos() - 117, 12) returning id`,
      [centreId],
    )
  ).rows[0].id;
  // Season A: week 6, second day
  await db.admin.query(
    "update public.seasons set starts_on = public.today_lagos() - 37, ends_on = public.today_lagos() + 46 where id = $1",
    [seasonA],
  );
  S.token = (await db.admin.query("select public.bootstrap_worker_token('insight') as t")).rows[0].t;

  S.director = await staff("Dir", "director");
  S.pastor = await staff("Pas", "pastor");
  S.dataLead = await staff("Dat", "data_lead");
  S.admin = await staff("Adm", "admin");
  S.coach = await staff("Coa", "coach");
  S.outsider = await person("Outsider");
  S.champ1 = await person("Champ1");
  S.champ2 = await person("Champ2");
  await asUser(S.director.id, "select public.assign_community_champion($1, $2)", [S.champ1.id, t1]);
  await asUser(S.director.id, "select public.assign_community_champion($1, $2)", [S.champ2.id, t2]);

  // ---- Alpha ----
  S.alpha = await makeTribe(seasonA, { community: t1, coach: S.coach.id, certified: true, name: "Alpha" });
  S.assistant = await person("Assistant");
  await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'assistant_leader')", [S.assistant.id]);
  await db.admin.query("update public.tribes set assistant_id = $1 where id = $2", [S.assistant.id, S.alpha.tribe]);
  S.p = [];
  for (const [name, degree] of [["P1", 90], ["P2", 90], ["P3", 90], ["P4", 65], ["P5", 65], ["P6", 65]] as const) {
    S.p.push(await join(S.alpha.tribe, seasonA, name, degree));
  }
  const [p1, p2, p3, p4, p5, p6] = S.p;
  await meetings(S.alpha.tribe, S.alpha.leader.id, 5, [[p1.id, 5], [p2.id, 5], [p3.id, 4], [p4.id, 3], [p5.id, 1], [p6.id, 0]]);
  //                                 belonging, god, others, life
  await pulse(S.alpha.tribe, p1.id, 1, 4, 3, 3, 3); await pulse(S.alpha.tribe, p1.id, 6, 5, 4, 4, 4); // 9 -> 12 (+3)
  await pulse(S.alpha.tribe, p2.id, 1, 4, 3, 3, 3); await pulse(S.alpha.tribe, p2.id, 6, 4, 4, 4, 3); // 9 -> 11 (+2)
  await pulse(S.alpha.tribe, p3.id, 1, 4, 3, 3, 3); await pulse(S.alpha.tribe, p3.id, 6, 4, 3, 3, 4); // 9 -> 10 (+1)
  await pulse(S.alpha.tribe, p4.id, 1, 4, 3, 3, 3); await pulse(S.alpha.tribe, p4.id, 6, 2, 3, 3, 3); // 9 -> 9 (0), does not belong
  await pulse(S.alpha.tribe, p5.id, 1, 4, 3, 3, 3); await pulse(S.alpha.tribe, p5.id, 6, 5, 4, 4, 3); // 9 -> 11 (+2), too few meetings

  // ---- Beta ----
  S.beta = await makeTribe(seasonA, { community: t2, name: "Beta" });
  S.b = [];
  for (const name of ["B1", "B2", "B3"]) S.b.push(await join(S.beta.tribe, seasonA, name));
  await meetings(S.beta.tribe, S.beta.leader.id, 5, S.b.map((x) => [x.id, 5] as [string, number]));
  const [b1, b2, b3] = S.b;
  await pulse(S.beta.tribe, b1.id, 1, 5, 3, 3, 3); await pulse(S.beta.tribe, b1.id, 6, 5, 4, 4, 3); // +2
  await pulse(S.beta.tribe, b2.id, 1, 5, 3, 3, 3); await pulse(S.beta.tribe, b2.id, 6, 5, 3, 3, 4); // +1
  await pulse(S.beta.tribe, b3.id, 1, 5, 3, 3, 3); await pulse(S.beta.tribe, b3.id, 6, 5, 4, 4, 4); // +3

  // ---- Z: finished, five people at every meeting ----
  S.zed = await makeTribe(seasonZ, { community: t1, name: "Zed" });
  S.z = [];
  for (const name of ["Z1", "Z2", "Z3", "Z4", "Z5"]) S.z.push(await join(S.zed.tribe, seasonZ, name));
  await meetings(S.zed.tribe, S.zed.leader.id, 12, S.z.map((x) => [x.id, 12] as [string, number]));
  for (const x of S.z) {
    await pulse(S.zed.tribe, x.id, 1, 4, 3, 3, 3);
    await pulse(S.zed.tribe, x.id, 12, 5, 4, 4, 4);
  }

  // ---- Forms: how long they took, when they were sent, what the assistant offered and what was kept ----
  const shown = (v: string[], chosen: string | null, kept?: string[]) => ({ shown: v, chosen, ...(kept ? { kept } : {}) });
  const ai = (i: number) => ({
    community: shown(["professionals", "consulting"], i < 5 ? "professionals" : "other"),
    work_field: shown(["finance", "tech"], i < 3 ? "finance" : "health"),
    children: shown(["none", "under_12"], null, i < 4 ? ["none"] : []),
    success_sentence: shown(["Draft"], i < 3 ? "kept" : "own"),
    ...(i < 4 ? { meeting_times: shown(["sunday-evening"], null, i < 2 ? ["sunday-evening"] : []) } : {}),
  });
  const seconds = [300, 360, 420, 300, 600, 240];
  const submittedDays = [-10, -10, -4, -20, -10, -10]; // days from the start of the season
  for (const [i, x] of S.p.entries()) await profile(x.id, seasonA, t1, seconds[i], submittedDays[i], ai(i));
  for (const x of S.b) await profile(x.id, seasonA, t2, 330, -10, { community: shown(["business-entrepreneurship"], "business-entrepreneurship") });
  // They chose two days after sending the form
  await db.admin.query(
    `update public.tribe_members m set joined_at = mp.submitted_at + interval '2 days'
       from public.member_profiles mp where mp.person_id = m.person_id and m.season_id = $1`,
    [seasonA],
  );
  // Two forms started and not finished
  for (const name of ["Draft1", "Draft2"]) {
    const d = await person(name);
    await db.admin.query("insert into public.intake_drafts (person_id, step) values ($1, 'you')", [d.id]);
  }

  // ---- The weekly Word habit, last three weeks ----
  const word: [Person, number[]][] = [[p1, [7, 6, 5]], [p2, [4, 4, 4]], [p3, [1, 2, 3]], [p4, [0, 0, 0]], [p5, [5, 5, 5]]];
  for (const [x, days] of word) {
    for (const [i, d] of days.entries()) {
      await db.admin.query("insert into public.word_habit (person_id, tribe_id, week, days) values ($1, $2, $3, $4)", [x.id, S.alpha.tribe, 4 + i, d]);
    }
  }

  // ---- Care tasks, ten days old ----
  const care = async (kind: string, person: string, closedAfter: string | null, urgentToday = false) => {
    await db.admin.query(
      `insert into public.care_tasks (tribe_id, person_id, kind, assignee_role, due_on, status, closed_at, created_at)
       values ($1, $2, $3, 'care_lead', public.today_lagos() - 3, $4,
               case when $5::text is null then null else (case when $6 then (public.today_lagos() - 10 + time '10:00') at time zone 'Africa/Lagos' else now() - interval '10 days' end) + $5::interval end,
               case when $6 then (public.today_lagos() - 10 + time '10:00') at time zone 'Africa/Lagos' else now() - interval '10 days' end)`,
      [S.alpha.tribe, person, kind, closedAfter ? "done" : "open", closedAfter, urgentToday],
    );
  };
  await care("practical", p1.id, "2 days");
  await care("pastoral", p2.id, "5 days");
  await care("pastoral", p3.id, "9 days");
  await care("urgent", p4.id, "1 hour", true);
  await care("pastoral", p4.id, null);

  // ---- Testimonies the church has approved ----
  const testimony = async (person: Person, tribe: string, credit: string, status: string, minute: number, body: string) => {
    await db.admin.query(
      `insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit, status, decided_at)
       values ($1, $2, 3, $3, 'church', $4, $5, (public.today_lagos() + time '08:00' + $6 * interval '1 minute') at time zone 'Africa/Lagos')`,
      [person.id, tribe, body, credit, status, minute],
    );
  };
  await testimony(p1, S.alpha.tribe, "full_name", "church_approved", 40, "God opened a door at work after the third week of prayer.");
  await testimony(p2, S.alpha.tribe, "first_name", "church_approved", 30, "My family prays together again every evening now.");
  await testimony(p3, S.alpha.tribe, "anonymous", "church_approved", 20, "I paid the last of a debt I had carried for years.");
  await testimony(b1, S.beta.tribe, "full_name", "church_approved", 10, "The shop had its best week since we opened, thank God.");
  await testimony(p4, S.alpha.tribe, "full_name", "tribe_approved", 5, "Still waiting on the pastors to read this one, but I am glad.");
});

afterAll(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function makeTribe(season: string, o: { community: string; coach?: string; certified?: boolean; name: string }) {
  const leader = await person(`Leader${++n}`);
  await db.grant(leader.id, "leader");
  const { rows } = await db.admin.query(
    `insert into public.tribes (season_id, leader_id, coach_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, 'approved', $4, $5, $6, $7, '{}', 'mixed', 'My story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland',
             'Online', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [season, leader.id, o.coach ?? null, o.name, trackId, o.community, goalOf[o.community]],
  );
  if (o.certified) await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
  return { leader, tribe: rows[0].id as string };
}

async function join(tribe: string, season: string, name: string, degree = 90) {
  const u = await person(name);
  await db.admin.query(
    `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     values ($1, $2, $3, 1, $4, 'test', '{}'::jsonb, current_date + 14)`,
    [tribe, u.id, season, degree],
  );
  return u;
}

/** Holds `weeks` meetings; each person is present for their first `presence` weeks and away after. */
async function meetings(tribe: string, leaderId: string, weeks: number, presence: [string, number][]) {
  for (let w = 1; w <= weeks; w++) {
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, $2, true, $3)", [tribe, w, leaderId]);
    for (const [who, count] of presence) {
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, $2, $3, $4)", [
        tribe, w, who, w <= count ? "present" : "absent",
      ]);
    }
  }
}

async function pulse(tribe: string, who: string, week: number, belonging: number, god: number, others: number, life: number) {
  await db.admin.query(
    "insert into public.pulses (person_id, tribe_id, week, belonging, god, others, life) values ($1, $2, $3, $4, $5, $6, $7)",
    [who, tribe, week, belonging, god, others, life],
  );
}

async function profile(who: string, season: string, community: string, seconds: number, dayOffset: number, aiAssist: object) {
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times, ai_assist, duration_seconds, submitted_at)
     values ($1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', '{}',
             $5::jsonb, $6,
             ((select starts_on from public.seasons where id = $2) + $7::int + time '12:00') at time zone 'Africa/Lagos')`,
    [who, season, community, goalOf[community], JSON.stringify(aiAssist), seconds, dayOffset],
  );
}

const asUser = async (userId: string, sql: string, params: unknown[] = []) => (await db.asUser(userId, (q) => q(sql, params))).rows[0]?.r ?? null;
const call = async (userId: string, fn: string, params: unknown[] = []) =>
  (await db.asUser(userId, (q) => q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params))).rows[0]?.r;
const callAdmin = async (fn: string, params: unknown[] = []) =>
  (await db.admin.query(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params)).rows[0]?.r;
const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
const todayLagos = async () => (await sql("select to_char(public.today_lagos(), 'YYYY-MM-DD') as d"))[0].d as string;
const kpi = (insight: Row, key: string) => (insight.kpis as Row[]).find((k) => k.key === key)!;
const worker = async (text: string, params: unknown[] = []) => (await db.asAnon((q) => q(text, [S.token, ...params]))).rows[0]?.r;

// ---------------------------------------------------------------------------
// The targets
// ---------------------------------------------------------------------------

describe("the targets", () => {
  it("start at the blueprint's numbers and can be listed by the office", async () => {
    const list = (await call(S.pastor.id, "kpi_target_list")) as Row[];
    expect(list.length).toBe(22);
    const thriving = list.find((t) => t.key === "thriving_rate")!;
    expect(Number(thriving.value)).toBe(0.85);
    expect(thriving.custom).toBe(false);
    expect(Number(thriving.min)).toBeLessThan(0.85);
    expect(Number(thriving.max)).toBe(1);
    const targets = (await callAdmin("kpi_targets")) as Record<string, number>;
    expect(targets.min_cell).toBe(5);
    expect(targets.connect_days).toBe(14);
    expect(targets.care_days).toBe(7);
  });

  it("can be changed by the admin, directors and the data lead, and the change is audited", async () => {
    for (const who of [S.director, S.admin, S.dataLead]) {
      const list = (await call(who.id, "set_kpi_target", ["care_days", 5])) as Row[];
      expect(Number(list.find((t) => t.key === "care_days")!.value)).toBe(5);
      await call(who.id, "set_kpi_target", ["care_days", 7]);
    }
    await call(S.director.id, "set_kpi_target", ["thriving_rate", 0.9]);
    const row = (await call(S.pastor.id, "kpi_target_list") as Row[]).find((t) => t.key === "thriving_rate")!;
    expect(Number(row.value)).toBe(0.9);
    expect(row.custom).toBe(true);
    expect(row.updated_by).toBe("Dir Test");
    const events = await sql("select meta from public.event_log where action = 'kpi.target_set' and entity_id = 'thriving_rate'");
    expect(events[0].meta).toMatchObject({ to: 0.9 });
    expect(Number(events[0].meta.from)).toBe(0.85);
    const list = (await call(S.director.id, "reset_kpi_target", ["thriving_rate"])) as Row[];
    const back = list.find((t) => t.key === "thriving_rate")!;
    expect(Number(back.value)).toBe(0.85);
    expect(back.custom).toBe(false);
  });

  it("must stay inside sensible bounds, and whole numbers are rounded", async () => {
    await expectCode(call(S.director.id, "set_kpi_target", ["thriving_rate", 1.5]), "22023");
    await expectCode(call(S.director.id, "set_kpi_target", ["thriving_rate", 0.1]), "22023");
    await expectCode(call(S.director.id, "set_kpi_target", ["not_a_target", 1]), "22023");
    await expectCode(call(S.director.id, "set_kpi_target", ["care_days", null]), "22023");
    await expectCode(call(S.director.id, "set_kpi_target", ["care_days", 99]), "22023");
    const list = (await call(S.director.id, "set_kpi_target", ["care_days", 6.6])) as Row[];
    expect(Number(list.find((t) => t.key === "care_days")!.value)).toBe(7);
    await call(S.director.id, "reset_kpi_target", ["care_days"]);
  });

  it("are changed only by the office that owns them", async () => {
    for (const who of [S.pastor, S.coach, S.champ1, S.outsider]) {
      await expectCode(call(who.id, "set_kpi_target", ["care_days", 5]), "42501");
      await expectCode(call(who.id, "reset_kpi_target", ["care_days"]), "42501");
    }
    for (const who of [S.coach, S.champ1, S.outsider]) await expectCode(call(who.id, "kpi_target_list"), "42501");
    await expectCode(db.asAnon((q) => q("select public.set_kpi_target('care_days', 5)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.kpi_targets()")), "42501");
  });

  it("are the ones the dashboard and the objectives use", async () => {
    const before = (await call(S.director.id, "dashboard")) as Row;
    expect(before.headline.thriving).toBe(6);
    // A third of the season is now enough and a belonging of 2 will do, so P4 (3 meetings, belonging 2) is thriving
    await call(S.director.id, "set_kpi_target", ["attend_share", 0.3]);
    await call(S.director.id, "set_kpi_target", ["belonging_min", 2]);
    const after = (await call(S.director.id, "dashboard")) as Row;
    expect(after.headline.thriving).toBe(7);
    const insight = (await call(S.director.id, "insight")) as Row;
    expect(kpi(insight, "belong").value).toBeCloseTo(7 / 9, 3);
    expect(insight.targets.attend_share).toBeCloseTo(0.3, 3);
    await call(S.director.id, "reset_kpi_target", ["attend_share"]);
    await call(S.director.id, "reset_kpi_target", ["belonging_min"]);
    expect(((await call(S.director.id, "dashboard")) as Row).headline.thriving).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// The Word habit
// ---------------------------------------------------------------------------

describe("the Word habit", () => {
  it("shows a placed member their weeks and the week they are in", async () => {
    const mine = (await call(S.p[0].id, "my_word_days")) as Row;
    expect(mine.placed).toBe(true);
    expect(mine.current_week).toBe(6);
    expect(mine.weeks).toEqual([{ week: 4, days: 7 }, { week: 5, days: 6 }, { week: 6, days: 5 }]);
    const nobody = (await call(S.outsider.id, "my_word_days")) as Row;
    expect(nobody.placed).toBe(false);
  });

  it("saves and changes the days for a week that has begun", async () => {
    const out = (await call(S.p[5].id, "save_word_days", [6, 3])) as Row;
    expect(out.weeks).toEqual([{ week: 6, days: 3 }]);
    const again = (await call(S.p[5].id, "save_word_days", [6, 6])) as Row;
    expect(again.weeks).toEqual([{ week: 6, days: 6 }]);
    await db.admin.query("delete from public.word_habit where person_id = $1", [S.p[5].id]);
  });

  it("refuses a week that has not begun, a number of days that cannot be, or someone without a tribe", async () => {
    await expectCode(call(S.p[0].id, "save_word_days", [7, 3]), "22023");
    await expectCode(call(S.p[0].id, "save_word_days", [0, 3]), "22023");
    await expectCode(call(S.p[0].id, "save_word_days", [6, 8]), "22023");
    await expectCode(call(S.p[0].id, "save_word_days", [6, -1]), "22023");
    await expectCode(call(S.outsider.id, "save_word_days", [1, 3]), "22023");
    await expectCode(db.asAnon((q) => q("select public.save_word_days(1, 3)")), "42501");
  });

  it("is private: the table has no grants and one member cannot read another's days", async () => {
    await expectCode(db.asUser(S.p[0].id, (q) => q("select * from public.word_habit")), "42501");
    const theirs = (await call(S.p[1].id, "my_word_days")) as Row;
    expect(theirs.weeks).toEqual([{ week: 4, days: 4 }, { week: 5, days: 4 }, { week: 6, days: 4 }]);
  });
});

// ---------------------------------------------------------------------------
// Community champions
// ---------------------------------------------------------------------------

describe("community champions", () => {
  it("are appointed by the admin and directors, and hold the role while they champion a community", async () => {
    const list = (await call(S.director.id, "community_champion_list")) as Row[];
    expect(list.map((c) => c.name).sort()).toEqual(["Champ1 Test", "Champ2 Test"]);
    expect(await sql("select 1 from public.person_roles where person_id = $1 and role = 'community_champion'", [S.champ1.id])).toHaveLength(1);
    const extra = await person("Extra");
    await call(S.admin.id, "assign_community_champion", [extra.id, t1]);
    await call(S.admin.id, "assign_community_champion", [extra.id, t2]);
    await call(S.admin.id, "assign_community_champion", [extra.id, t2]); // twice is fine
    expect(((await call(S.director.id, "community_champion_list")) as Row[]).filter((c) => c.person_id === extra.id)).toHaveLength(2);
    await call(S.admin.id, "remove_community_champion", [extra.id, t1]);
    expect(await sql("select 1 from public.person_roles where person_id = $1 and role = 'community_champion'", [extra.id])).toHaveLength(1);
    await call(S.admin.id, "remove_community_champion", [extra.id, t2]);
    expect(await sql("select 1 from public.person_roles where person_id = $1 and role = 'community_champion'", [extra.id])).toHaveLength(0);
    const audit = await sql("select action from public.event_log where entity_id = $1 and action like 'champion.%' order by id", [extra.id]);
    expect(audit.map((a) => a.action)).toEqual(["champion.assigned", "champion.assigned", "champion.assigned", "champion.removed", "champion.removed"]);
  });

  it("cannot be appointed by anyone else, or for someone or a community that does not exist", async () => {
    for (const who of [S.pastor, S.dataLead, S.coach, S.champ1, S.outsider]) {
      await expectCode(call(who.id, "assign_community_champion", [S.outsider.id, t1]), "42501");
      await expectCode(call(who.id, "remove_community_champion", [S.champ2.id, t2]), "42501");
    }
    await expectCode(call(S.director.id, "assign_community_champion", ["00000000-0000-0000-0000-000000000000", t1]), "P0002");
    await expectCode(call(S.director.id, "assign_community_champion", [S.outsider.id, "00000000-0000-0000-0000-000000000000"]), "P0002");
  });

  it("are listed only for the office", async () => {
    for (const who of [S.pastor, S.dataLead, S.admin]) expect(((await call(who.id, "community_champion_list")) as Row[]).length).toBe(2);
    for (const who of [S.champ1, S.coach, S.outsider]) await expectCode(call(who.id, "community_champion_list"), "42501");
  });
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

describe("the retention curve", () => {
  it("counts who was still coming each week that is over", async () => {
    const curve = (await callAdmin("retention_curve", [seasonA])) as Row;
    expect(curve.cohort).toBe(9);
    expect(curve.points.map((p: Row) => p.retained)).toEqual([8, 8, 7, 7, 6]);
    expect(curve.points.map((p: Row) => p.week)).toEqual([1, 2, 3, 4, 5]);
    expect(curve.points[0].rate).toBeCloseTo(8 / 9, 3);
    expect(curve.points[4].rate).toBeCloseTo(6 / 9, 3);
  });

  it("is full for a season where everyone came, and empty for one that has not begun", async () => {
    const z = (await callAdmin("retention_curve", [seasonZ])) as Row;
    expect(z.cohort).toBe(5);
    expect(z.points).toHaveLength(12);
    expect(z.points.every((p: Row) => p.rate === 1)).toBe(true);
    const future = (
      await sql(`insert into public.seasons (centre_id, name, starts_on, ends_on, weeks) values ($1, 'Later', public.today_lagos() + 30, public.today_lagos() + 113, 12) returning id`, [centreId])
    )[0].id;
    const none = (await callAdmin("retention_curve", [future])) as Row;
    expect(none.points).toEqual([]);
    await sql("delete from public.seasons where id = $1", [future]);
  });
});

// ---------------------------------------------------------------------------
// The objectives
// ---------------------------------------------------------------------------

describe("the objectives", () => {
  it("are visible to the pastorate, directors, the data lead and the admin only", async () => {
    for (const who of [S.pastor, S.director, S.dataLead, S.admin]) expect(((await call(who.id, "insight")) as Row).state).toBe("running");
    for (const who of [S.coach, S.champ1, S.outsider, S.alpha.leader]) await expectCode(call(who.id, "insight"), "42501");
    await expectCode(db.asAnon((q) => q("select public.insight()")), "42501");
  });

  it("report all ten rows, each against its target", async () => {
    const insight = (await call(S.director.id, "insight")) as Row;
    expect((insight.kpis as Row[]).map((k) => k.key)).toEqual([
      "connect", "belong", "word", "goal", "care", "multiply", "match", "form_time", "form_completion", "ai_keep",
    ]);
    expect(insight.season).toMatchObject({ name: expect.any(String), current_week: 6, weeks_over: 5 });
    expect(insight.measured).toBe(true);
    expect(insight.members).toBe(9);
  });

  it("Belong: the share thriving, 6 of 9", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "belong");
    expect(k.value).toBeCloseTo(6 / 9, 3);
    expect(k.n).toBe(9);
    expect(Number(k.target)).toBe(0.85);
    expect(k.status).toBe("behind");
  });

  it("Achieve the goal: the share who gained at least two points, 5 of 8", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "goal");
    expect(k.value).toBeCloseTo(5 / 8, 3);
    expect(k.n).toBe(8);
    expect(k.status).toBe("behind");
  });

  it("Grow in faith: the share whose last three weeks average four days, 3 of 5", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "word");
    expect(k.value).toBeCloseTo(3 / 5, 3);
    expect(k.n).toBe(5);
    expect(k.coverage).toBeCloseTo(5 / 9, 3);
  });

  it("Care well: tasks old enough to judge that were done inside the week, 3 of 5, and the urgent one the same day", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "care");
    expect(k.value).toBeCloseTo(3 / 5, 3);
    expect(k.n).toBe(5);
    expect(k.urgent).toBe(1);
    expect(k.urgent_same_day).toBe(1);
  });

  it("Multiply: tribes with a certified assistant, 1 of 2", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "multiply");
    expect(Number(k.value)).toBe(0.5);
    expect(k.certified).toBe(1);
    expect(k.n).toBe(2);
    expect(k.status).toBe("behind");
  });

  it("Connect fast: the median days from sending the form to the first meeting they came to", async () => {
    const expected = Number(
      (await sql(
        `select public.meeting_date_of($1, 1) - (starts_on - 10) as d from public.seasons where id = $2`,
        [S.alpha.tribe, seasonA],
      ))[0].d,
    );
    const k = kpi((await call(S.director.id, "insight")) as Row, "connect");
    expect(Number(k.value)).toBe(expected);
    expect(k.n).toBe(8);
    expect(Number(k.target)).toBe(14);
    expect(Number(k.target_alt)).toBe(7);
  });

  it("Match effortlessly: the median time on the form, how many finished, and the wait to choose", async () => {
    const insight = (await call(S.director.id, "insight")) as Row;
    const time = kpi(insight, "form_time");
    expect(Number(time.value)).toBe(5.5);
    expect(time.status).toBe("met");
    expect(Number(time.wait_days)).toBe(2);
    const done = kpi(insight, "form_completion");
    expect(done.finished).toBe(9);
    expect(done.started).toBe(11);
    expect(done.value).toBeCloseTo(9 / 11, 3);
  });

  it("Understand people: how often each suggestion was kept, and the weakest field is named", async () => {
    const insight = (await call(S.director.id, "insight")) as Row;
    const fields = Object.fromEntries((insight.ai.fields as Row[]).map((f) => [f.field, f]));
    expect(fields.community).toMatchObject({ shown: 9, kept: 8 });
    expect(fields.work_field).toMatchObject({ shown: 6, kept: 3, rate: 0.5 });
    expect(fields.children).toMatchObject({ shown: 6, kept: 4 });
    expect(fields.success_sentence).toMatchObject({ shown: 6, kept: 3 });
    expect(fields.meeting_times).toBeUndefined();
    expect(insight.ai.times_shown).toBe(4);
    expect(insight.ai.times_kept).toBe(2);
    const k = kpi(insight, "ai_keep");
    expect(Number(k.value)).toBe(0.5);
    expect(k.lowest_field).toBe("success_sentence");
    expect(k.status).toBe("behind");
  });

  it("Match well: no gap is claimed until both groups are big enough to mean something", async () => {
    const k = kpi((await call(S.director.id, "insight")) as Row, "match");
    expect(k.value).toBeNull();
    expect(k.status).toBe("na");
    expect(k.high_n).toBe(6);
    expect(k.low_n).toBe(3);
  });

  it("Success Picture progress is given for each goal and community", async () => {
    const goals = ((await call(S.director.id, "insight")) as Row).goals as Row[];
    const pro = goals.find((g) => g.community === "Professionals")!;
    expect(pro.members).toBe(6);
    expect(pro.gain_n).toBe(5);
    expect(pro.gain_avg).toBeCloseTo(1.6, 1);
    const biz = goals.find((g) => String(g.community).startsWith("Business"))!;
    expect(biz.gain_n).toBe(3);
    expect(biz.gain_avg).toBeCloseTo(2, 1);
  });

  it("put the finished season beside the running one", async () => {
    const insight = (await call(S.director.id, "insight")) as Row;
    expect(insight.earlier).toHaveLength(1);
    expect(insight.earlier[0]).toMatchObject({ name: "Season Z", cohort: 5 });
    expect(insight.earlier[0].points).toHaveLength(12);
  });

  it("can be read for the finished season", async () => {
    const z = (await call(S.director.id, "insight", [seasonZ])) as Row;
    expect(z.state).toBe("complete");
    expect(z.members).toBe(5);
    expect(kpi(z, "belong").value).toBe(1);
    expect(kpi(z, "belong").status).toBe("met");
  });

  it("give every reader the same numbers", async () => {
    const a = (await call(S.director.id, "insight")) as Row;
    const b = (await call(S.dataLead.id, "insight")) as Row;
    expect(b.kpis).toEqual(a.kpis);
  });
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe("daily snapshots", () => {
  it("keep one row for a season per day, and the numbers worth drawing", async () => {
    await callAdmin("take_snapshot", [seasonA]);
    await callAdmin("take_snapshot", [seasonA]);
    const rows = await sql("select * from public.kpi_snapshots where season_id = $1", [seasonA]);
    expect(rows).toHaveLength(1);
    const data = rows[0].data;
    expect(data.members).toBe(9);
    expect(data.attendance_rate).toBeCloseTo(33 / 45, 3);
    expect(data.retention_rate).toBeCloseTo(6 / 9, 3);
    expect(data.retention_week).toBe(5);
    expect(data.belong).toBeCloseTo(6 / 9, 3);
    expect(data.open_care).toBe(3); // the one left open, and the two the system raised when P5 and P6 missed three meetings
    expect(rows[0].week).toBe(5);
  });

  it("appear in the trend, oldest first", async () => {
    await sql("delete from public.kpi_snapshots");
    await callAdmin("take_snapshot", [seasonA, new Date(Date.now() - 3 * 86400000).toISOString()]);
    await callAdmin("take_snapshot", [seasonA]);
    const insight = (await call(S.director.id, "insight")) as Row;
    expect(insight.trend).toHaveLength(2);
    expect(insight.trend[0].taken_on < insight.trend[1].taken_on).toBe(true);
    expect(insight.trend[1].members).toBe(9);
  });

  it("are not open to anyone: no grants", async () => {
    await expectCode(db.asUser(S.director.id, (q) => q("select * from public.kpi_snapshots")), "42501");
    await expectCode(call(S.director.id, "take_snapshot", [seasonA]), "42501");
  });
});

// ---------------------------------------------------------------------------
// What happened in a window
// ---------------------------------------------------------------------------

describe("the facts for a window of dates", () => {
  it("count meetings, attendance, joiners, forms, care and testimonies inside it", async () => {
    const scope = (await sql("select array_agg(id) as ids from public.tribes where season_id = $1", [seasonA]))[0].ids;
    const window = (await sql("select (starts_on - 30)::text as s, ends_on::text as e from public.seasons where id = $1", [seasonA]))[0];
    const facts = (await callAdmin("report_window_facts", [seasonA, scope, window.s, window.e])) as Row;
    expect(facts).toMatchObject({
      meetings_held: 10, present: 33, possible: 45, joined: 9, left: 0, forms_finished: 9,
      care_opened: 7, care_closed: 4, care_open_now: 3, urgent_opened: 1, // 5 made by hand, 2 raised by the system for missed meetings
      testimonies_new: 5, testimonies_to_church: 4,
    });
    expect(facts.attendance_rate).toBeCloseTo(33 / 45, 3);
  });

  it("are empty for a window with nothing in it", async () => {
    const scope = (await sql("select array_agg(id) as ids from public.tribes where season_id = $1", [seasonA]))[0].ids;
    const facts = (await callAdmin("report_window_facts", [seasonA, scope, "2000-01-01", "2000-01-31"])) as Row;
    expect(facts.meetings_held).toBe(0);
    expect(facts.attendance_rate).toBeNull();
    expect(facts.joined).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

describe("reports", () => {
  let programme: Row;
  let pastorate: Row;
  let community1: Row;
  let community2: Row;

  it("the programme report holds the whole picture", async () => {
    programme = (await call(S.director.id, "generate_report", ["programme", await todayLagos()])) as Row;
    expect(programme.kind).toBe("programme");
    expect(programme.season).toBeTruthy();
    const d = programme.data as Row;
    expect(d.kind).toBe("programme");
    expect(d.kpis).toHaveLength(10);
    expect(d.retention.cohort).toBe(9);
    expect(d.headline.members).toBe(9);
    expect(d.headline.thriving).toBe(6);
    expect(typeof d.window.meetings_held).toBe("number");
    expect(d.funnel).toHaveLength(6);
    expect(d.communities.length).toBeGreaterThan(0);
    expect(d.care).toBeTruthy();
    expect(d.supply.wants).toBe(9);
    expect(d.testimonies).toHaveLength(4);
    expect(programme.period_start).toBe((await todayLagos()).slice(0, 8) + "01");
  });

  it("testimonies are worded as their authors allowed, and carry no identifiers", async () => {
    const who = (programme.data.testimonies as Row[]).map((t) => t.who);
    const names = await sql("select public.person_display_name($1) as full_name, public.first_name_of($2) as first_name", [S.p[0].id, S.p[1].id]);
    expect(who).toContain(names[0].full_name);
    expect(who).toContain(names[0].first_name);
    expect(names[0].first_name).not.toBe(names[0].full_name);
    expect(who).toContain("A member");
    const json = JSON.stringify(programme.data.testimonies);
    expect(json).not.toContain(S.p[2].id);
    expect(json).not.toContain("P3 Test");
    expect(json).not.toContain("tribe_approved");
    expect(json).not.toContain("Still waiting on the pastors");
  });

  it("the pastorate one-pager is shorter: three testimonies, the scorecard and the care counts", async () => {
    pastorate = (await call(S.pastor.id, "generate_report", ["pastorate", await todayLagos()])) as Row;
    const d = pastorate.data as Row;
    expect(d.testimonies).toHaveLength(3);
    expect(d.kpis).toHaveLength(10);
    expect(d.care).toBeTruthy();
    expect(d.communities).toBeUndefined();
    expect(d.retention).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("@");
  });

  it("a community report shows that community only, and hides a rate for a group too small to show", async () => {
    community1 = (await call(S.director.id, "generate_report", ["community", await todayLagos(), t1])) as Row;
    community2 = (await call(S.director.id, "generate_report", ["community", await todayLagos(), t2])) as Row;
    const d1 = community1.data as Row;
    expect(d1.community.name).toBe("Professionals");
    expect(d1.headline.members).toBe(6);
    expect(d1.headline.thriving_rate).toBeCloseTo(0.5, 3);
    expect(d1.tribes).toHaveLength(1);
    expect(d1.tribes[0].name).toBe("Alpha");
    expect(d1.tribes[0].verdict).not.toBe("small");
    expect(d1.testimonies).toHaveLength(3);
    expect(d1.kpis).toBeUndefined();

    const d2 = community2.data as Row;
    expect(d2.community.name).toMatch(/^Business/);
    expect(d2.headline.members).toBe(3);
    expect(d2.headline.thriving_rate).toBeUndefined();
    expect(d2.headline.verdicts).toBeUndefined();
    expect(d2.tribes[0].verdict).toBe("small");
    expect(d2.tribes[0].thriving_rate).toBeUndefined();
    expect(d2.tribes[0].gain_avg).toBeUndefined();
    expect(d2.tribes[0].attendance_rate).toBeCloseTo(1, 3);
    expect(d2.testimonies).toHaveLength(1);
    expect(d2.watch).toEqual([]);
    expect(d2.supply.reduce((a: number, c: Row) => a + c.wants, 0)).toBe(3);
  });

  it("the season report holds the finished season, for the months it covered", async () => {
    const z = (await call(S.director.id, "generate_report", ["season", null, null, seasonZ])) as Row;
    expect(z.kind).toBe("season");
    expect(z.data.headline.members).toBe(5);
    expect(z.data.tribes).toHaveLength(1);
    expect(z.data.earlier).toEqual([]);
    expect(z.data.season.over).toBe(true);
    const bounds = await sql("select starts_on::text as s, ends_on::text as e from public.seasons where id = $1", [seasonZ]);
    expect(z.period_start).toBe(bounds[0].s);
    expect(z.period_end).toBe(bounds[0].e);
  });

  it("making the same report again replaces it, and keeps a summary someone wrote", async () => {
    const before = await sql("select count(*)::int as n from public.reports");
    const again = (await call(S.director.id, "generate_report", ["programme", await todayLagos()])) as Row;
    expect(again.id).toBe(programme.id);
    expect((await sql("select count(*)::int as n from public.reports"))[0].n).toBe(before[0].n);
    await call(S.director.id, "set_report_summary", [programme.id, "The directors' own words."]);
    const kept = (await call(S.director.id, "generate_report", ["programme", await todayLagos()])) as Row;
    expect(kept.summary).toBe("The directors' own words.");
    expect(kept.summary_by).toBe("edited");
  });

  it("is asked for only by the office, and only in a sensible way", async () => {
    for (const who of [S.coach, S.champ1, S.outsider]) await expectCode(call(who.id, "generate_report", ["programme"]), "42501");
    await expectCode(call(S.director.id, "generate_report", ["weekly"]), "22023");
    await expectCode(call(S.director.id, "generate_report", ["community"]), "22023");
    await expectCode(call(S.director.id, "generate_report", ["programme", null, t1]), "22023");
    await expectCode(call(S.director.id, "generate_report", ["programme", "2999-01-01"]), "22023");
    await expectCode(call(S.director.id, "generate_report", ["community", await todayLagos(), "00000000-0000-0000-0000-000000000000"]), "P0002");
    await expectCode(db.asAnon((q) => q("select public.generate_report('programme')")), "42501");
    // the pastor may ask for one
    expect(((await call(S.pastor.id, "generate_report", ["pastorate", await todayLagos()])) as Row).id).toBe(pastorate.id);
  });

  it("is read by the office, and a champion reads only their own community's", async () => {
    for (const who of [S.director, S.pastor, S.dataLead, S.admin]) {
      expect(((await call(who.id, "get_report", [programme.id])) as Row).kind).toBe("programme");
      expect((await call(who.id, "list_reports")) as Row[]).toHaveLength(5);
    }
    expect(((await call(S.champ1.id, "get_report", [community1.id])) as Row).community).toBe("Professionals");
    await expectCode(call(S.champ1.id, "get_report", [community2.id]), "P0002");
    await expectCode(call(S.champ1.id, "get_report", [programme.id]), "P0002");
    await expectCode(call(S.champ2.id, "get_report", [community1.id]), "P0002");
    const mine = (await call(S.champ1.id, "list_reports")) as Row[];
    expect(mine.map((r) => r.id)).toEqual([community1.id]);
    expect(mine[0]).toMatchObject({ kind: "community", community: "Professionals", has_summary: false });
    for (const who of [S.coach, S.outsider]) {
      expect((await call(who.id, "list_reports")) as Row[]).toEqual([]);
      await expectCode(call(who.id, "get_report", [programme.id]), "P0002");
    }
    await expectCode(db.asAnon((q) => q("select public.list_reports()")), "42501");
    await expectCode(db.asUser(S.director.id, (q) => q("select * from public.reports")), "42501");
  });

  it("has a summary that its readers can reword, or clear", async () => {
    const edited = (await call(S.champ1.id, "set_report_summary", [community1.id, "  Professionals had a strong month.  "])) as Row;
    expect(edited.summary).toBe("Professionals had a strong month.");
    expect(edited.summary_by).toBe("edited");
    await expectCode(call(S.champ2.id, "set_report_summary", [community1.id, "Not mine"]), "P0002");
    await expectCode(call(S.champ1.id, "set_report_summary", [community1.id, "x".repeat(2401)]), "22023");
    await expectCode(call(S.outsider.id, "set_report_summary", [community1.id, "Hello"]), "P0002");
    const cleared = (await call(S.champ1.id, "set_report_summary", [community1.id, "   "])) as Row;
    expect(cleared.summary).toBeNull();
    expect(cleared.summary_by).toBeNull();
    const audit = await sql("select meta from public.event_log where action = 'report.summary_edited' and entity_id = $1 order by id", [community1.id]);
    expect(audit.map((a) => a.meta.cleared)).toEqual([false, true]);
  });
});

// ---------------------------------------------------------------------------
// The community champion's page
// ---------------------------------------------------------------------------

describe("the community page", () => {
  it("shows a champion their own community with the same arithmetic as the dashboard", async () => {
    const page = (await call(S.champ1.id, "community_dashboard")) as Row;
    expect(page.community.name).toBe("Professionals");
    expect(page.communities.map((t: Row) => t.name)).toEqual(["Professionals"]);
    expect(page.headline.members).toBe(6);
    expect(page.headline.thriving).toBe(3);
    expect(page.headline.thriving_rate).toBeCloseTo(0.5, 3);
    expect(page.tribes).toHaveLength(1);
    expect(page.tribes[0].name).toBe("Alpha");
    expect(page.weeks).toHaveLength(6);
    expect(page.testimonies.church).toBe(3);
    expect(page.testimonies.waiting).toBe(1);
    expect(page.testimonies.recent).toHaveLength(3);
    expect(page.care).toEqual({ open: 3, late: 1 });
    expect(page.champions).toEqual(["Champ1 Test"]);
    const dash = (await call(S.director.id, "dashboard")) as Row;
    const alpha = dash.tribes.find((c: Row) => c.name === "Alpha");
    expect(page.tribes[0].thriving_rate).toBe(alpha.thriving_rate);
    expect(page.tribes[0].attendance_rate).toBe(alpha.attendance_rate);
  });

  it("hides a rate for a group too small to show, and shows where seats are short", async () => {
    const page = (await call(S.champ2.id, "community_dashboard")) as Row;
    expect(page.community.name).toMatch(/^Business/);
    expect(page.headline.members).toBe(3);
    expect(page.headline.thriving_rate).toBeUndefined();
    expect(page.tribes[0].verdict).toBe("small");
    expect(page.tribes[0].thriving_rate).toBeUndefined();
    const short = (page.supply as Row[]).reduce((a, c) => a + c.short, 0);
    const open = (page.supply as Row[]).reduce((a, c) => a + c.tribes_to_open, 0);
    expect(short).toBe(3);
    expect(open).toBe(1);
    expect(page.min_cell).toBe(5);
  });

  it("will not show a champion another community", async () => {
    await expectCode(call(S.champ1.id, "community_dashboard", [t2]), "P0002");
    await expectCode(call(S.champ2.id, "community_dashboard", [t1]), "P0002");
  });

  it("lets the office look at any community, and nobody else at all", async () => {
    for (const who of [S.director, S.pastor, S.dataLead, S.admin]) {
      const page = (await call(who.id, "community_dashboard", [t1])) as Row;
      expect(page.community.name).toBe("Professionals");
      expect(page.communities.length).toBeGreaterThan(2);
    }
    for (const who of [S.coach, S.outsider, S.p[0]]) await expectCode(call(who.id, "community_dashboard"), "42501");
    await expectCode(db.asAnon((q) => q("select public.community_dashboard()")), "42501");
  });

  it("is unchanged by the split of the dashboard: a coach still sees only their own tribes", async () => {
    const dash = (await call(S.coach.id, "dashboard")) as Row;
    expect(dash.scope).toBe("coach");
    expect(dash.tribes.map((c: Row) => c.name)).toEqual(["Alpha"]);
    expect(dash.funnel).toBeUndefined();
    const church = (await call(S.director.id, "dashboard")) as Row;
    expect(church.scope).toBe("church");
    expect(church.funnel).toHaveLength(6);
    expect(church.tribes.map((c: Row) => c.name).sort()).toEqual(["Alpha", "Beta"]);
  });
});

// ---------------------------------------------------------------------------
// The heartbeat's daily jobs
// ---------------------------------------------------------------------------

describe("the heartbeat", () => {
  const firstOfNextMonth = async () =>
    (await sql(`select to_char(date_trunc('month', public.today_lagos())::date + interval '1 month' + interval '9 hours', 'YYYY-MM-DD"T"HH24:MI:SS') || '+01:00' as t`))[0].t as string;

  it("takes a snapshot of the running season and refreshes the BI copy, once a day", async () => {
    await sql("delete from public.kpi_snapshots");
    const first = (await callAdmin("insight_tick", [new Date().toISOString()])) as Row;
    expect(first.snapshots).toBe(1);
    expect(first.bi_refreshed).toBe(true);
    const second = (await callAdmin("insight_tick", [new Date().toISOString()])) as Row;
    expect(second.snapshots).toBe(0);
    expect(second.reports).toBe(0);
    expect(second.bi_refreshed).toBe(false);
    expect(await sql("select 1 from public.kpi_snapshots where season_id = $1", [seasonA])).toHaveLength(1);
  });

  it("makes last month's reports on the first day of the month, and tells the right people once", async () => {
    await sql("delete from public.reports");
    await sql("delete from public.messages where template = 'report_ready'");
    const at = await firstOfNextMonth();
    const out = (await callAdmin("insight_tick", [at])) as Row;
    expect(out.reports).toBe(4); // programme, pastorate and one for each of the two communities with tribes
    const made = await sql("select kind, community_id, period_start::text as start, period_end::text as finish from public.reports order by kind, community_id");
    expect(made.map((r) => r.kind).sort()).toEqual(["community", "community", "pastorate", "programme"]);
    const monthStart = (await sql("select date_trunc('month', public.today_lagos())::date::text as d"))[0].d;
    expect(new Set(made.map((r) => r.start))).toEqual(new Set([monthStart]));

    const messages = await sql("select id, person_id, params, urgency, reply_token, template from public.messages where template = 'report_ready' order by created_at");
    // programme: director and pastor; pastorate: pastor; the two community reports: their champions
    expect(messages).toHaveLength(5);
    const byPerson = (id: string) => messages.filter((m) => m.person_id === id).length;
    expect(byPerson(S.director.id)).toBe(1);
    expect(byPerson(S.pastor.id)).toBe(2);
    expect(byPerson(S.champ1.id)).toBe(1);
    expect(byPerson(S.champ2.id)).toBe(1);
    expect(byPerson(S.dataLead.id)).toBe(0);
    expect(messages.every((m) => typeof m.params.report_id === "string" && m.params.title && m.params.period)).toBe(true);
    expect(await wordingProblems(messages)).toEqual([]);

    // Running it again changes nothing
    const again = (await callAdmin("insight_tick", [at])) as Row;
    expect(again.reports).toBe(0);
    expect((await sql("select count(*)::int as n from public.messages where template = 'report_ready'"))[0].n).toBe(5);
  });

  it("makes nothing in the middle of a month", async () => {
    await sql("delete from public.reports");
    const out = (await callAdmin("insight_tick", [(await sql(`select to_char(date_trunc('month', public.today_lagos())::date + interval '14 days' + interval '9 hours', 'YYYY-MM-DD"T"HH24:MI:SS') || '+01:00' as t`))[0].t])) as Row;
    expect(out.reports).toBe(0);
  });

  it("makes a season's report after it ends, once", async () => {
    await sql("delete from public.reports");
    await sql("update public.seasons set starts_on = public.today_lagos() - 89, ends_on = public.today_lagos() - 6 where id = $1", [seasonZ]);
    const out = (await callAdmin("insight_tick", [new Date().toISOString()])) as Row;
    expect(out.reports).toBeGreaterThanOrEqual(1);
    const seasonReports = await sql("select season_id, period_start::text as s from public.reports where kind = 'season'");
    expect(seasonReports).toHaveLength(1);
    expect(seasonReports[0].season_id).toBe(seasonZ);
    const again = await callAdmin("insight_tick", [new Date().toISOString()]);
    expect(((await sql("select count(*)::int as n from public.reports where kind = 'season'"))[0].n)).toBe(1);
    expect((again as Row).reports).toBe(0);
    // the season report goes to the directors and the pastor
    const sent = await sql("select person_id from public.messages where template = 'report_ready' and params->>'kind' = 'season'");
    expect(sent.map((m) => m.person_id).sort()).toEqual([S.director.id, S.pastor.id].sort());
  });

  it("runs as part of the sending service's tick, and a fault in it never stops the rest", async () => {
    const ok = (await worker("select public.worker_tick($1) as r")) as Row;
    expect(ok.insight_error).toBeUndefined();
    expect(ok).toHaveProperty("snapshots");
    expect(ok).toHaveProperty("reports");
    expect(ok).toHaveProperty("queued"); // the calendar still ran
    expect(ok).toHaveProperty("care_open");
    await sql("create or replace function public.insight_tick(p_now timestamptz) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end $$");
    const broken = (await worker("select public.worker_tick($1) as r")) as Row;
    expect(broken.insight_error).toBe("boom");
    expect(broken).toHaveProperty("queued");
    expect(broken).toHaveProperty("care_open");
  });
});

// ---------------------------------------------------------------------------
// The sending service writes the summaries
// ---------------------------------------------------------------------------

describe("report summaries by the sending service", () => {
  it("lists the reports that have none, and sets one only where none is set", async () => {
    await sql("delete from public.reports");
    const id = (await call(S.director.id, "generate_report", ["pastorate", await todayLagos()]) as Row).id as string;
    const pending = (await worker("select public.worker_pending_summaries($1) as r")) as Row[];
    expect(pending.map((p) => p.id)).toContain(id);
    const mine = pending.find((p) => p.id === id)!;
    expect(mine.kind).toBe("pastorate");
    expect(mine.data.kpis).toHaveLength(10);

    expect(await worker("select public.worker_set_summary($1, $2, $3, 'plain') as r", [id, "Six in nine are thriving."])).toBe(true);
    expect(await worker("select public.worker_set_summary($1, $2, $3, 'assistant') as r", [id, "Something else."])).toBe(false);
    const got = (await call(S.director.id, "get_report", [id])) as Row;
    expect(got.summary).toBe("Six in nine are thriving.");
    expect(got.summary_by).toBe("plain");
    expect(((await worker("select public.worker_pending_summaries($1) as r")) as Row[]).map((p) => p.id)).not.toContain(id);
  });

  it("never overwrites a person's words, and refuses a bad summary or a bad token", async () => {
    const id = (await sql("select id from public.reports limit 1"))[0].id as string;
    await call(S.director.id, "set_report_summary", [id, "Written by hand."]);
    expect(await worker("select public.worker_set_summary($1, $2, $3, 'assistant') as r", [id, "Replaced?"])).toBe(false);
    expect(((await call(S.director.id, "get_report", [id])) as Row).summary).toBe("Written by hand.");
    await call(S.director.id, "set_report_summary", [id, ""]);
    await expectCode(db.asAnon((q) => q("select public.worker_set_summary($1, $2, $3, 'robot')", [S.token, id, "Hello"])), "22023");
    await expectCode(db.asAnon((q) => q("select public.worker_set_summary($1, $2, $3, 'plain')", [S.token, id, ""])), "22023");
    await expectCode(db.asAnon((q) => q("select public.worker_set_summary($1, $2, $3, 'plain')", [S.token, id, "x".repeat(2401)])), "22023");
    await expectCode(db.asAnon((q) => q("select public.worker_set_summary($1, $2, $3, 'plain')", ["z".repeat(40), id, "Hello"])), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_pending_summaries($1)", ["z".repeat(40)])), "42501");
    await expectCode(db.asUser(S.director.id, (q) => q("select public.worker_pending_summaries($1)", ["z".repeat(40)])), "42501");
  });
});

// ---------------------------------------------------------------------------
// Movement across a month
// ---------------------------------------------------------------------------

describe("movement across a window", () => {
  it("compares the first and last snapshot inside the window, and is empty with only one", async () => {
    await sql("delete from public.kpi_snapshots");
    const start = (await sql("select (starts_on)::text as s from public.seasons where id = $1", [seasonA]))[0].s as string;
    const day = (offset: number) => new Date(Date.parse(`${start}T11:00:00Z`) + offset * 86400000).toISOString();
    await callAdmin("take_snapshot", [seasonA, day(8)]);
    expect(await callAdmin("report_movement", [seasonA, start, "2999-01-01"])).toBeNull();
    await callAdmin("take_snapshot", [seasonA, day(15)]);
    await sql("update public.kpi_snapshots set data = jsonb_set(data, '{members}', '5') where taken_on = $1::date", [day(8).slice(0, 10)]);
    const out = (await callAdmin("report_movement", [seasonA, start, "2999-01-01"])) as Row;
    expect(out.from.members).toBe(5);
    expect(out.to.members).toBe(9);
    expect(out.from.taken_on < out.to.taken_on).toBe(true);
    // nothing in a window with no snapshot of its own
    expect(await callAdmin("report_movement", [seasonA, "2000-01-01", "2000-01-31"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The BI copy
// ---------------------------------------------------------------------------

describe("the BI copy", () => {
  async function asReader<T>(fn: () => Promise<T>) {
    await db.admin.query("set role bi_reader");
    try {
      return await fn();
    } finally {
      await db.admin.query("reset role");
    }
  }

  it("is refreshed by the admin, directors and the data lead, and reported on", async () => {
    for (const who of [S.admin, S.director, S.dataLead]) {
      const status = (await call(who.id, "bi_refresh")) as Row;
      expect(status.reader_role).toBe("bi_reader");
      expect(status.refreshed_at).toBeTruthy();
      expect((status.views as Row[]).map((v) => v.name)).toEqual([
        "bi.members", "bi.tribes", "bi.weekly", "bi.care_weekly", "bi.messages_daily", "bi.ai_fields", "bi.kpi_daily",
      ]);
    }
    for (const who of [S.pastor, S.coach, S.champ1, S.outsider]) {
      await expectCode(call(who.id, "bi_refresh"), "42501");
      await expectCode(call(who.id, "bi_status"), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.bi_refresh()")), "42501");
    expect(await sql("select 1 from public.event_log where action = 'bi.refreshed'")).toHaveLength(3);
  });

  it("holds one row per member, tribe and week, with every person replaced by a code", async () => {
    const counts = await sql(
      `select (select count(*) from bi.members)::int as members, (select count(*) from bi.tribes)::int as tribes,
              (select count(*) from bi.weekly)::int as weekly, (select count(*) from bi.ai_fields)::int as ai`);
    expect(counts[0].members).toBe(9 + 5);
    expect(counts[0].tribes).toBe(3);
    expect(counts[0].weekly).toBe(5 + 5 + 12);
    expect(counts[0].ai).toBeGreaterThanOrEqual(4);
    const keys = await sql("select member_key, thriving, meetings_attended from bi.members where season = (select name from public.seasons where id = $1)", [seasonA]);
    expect(new Set(keys.map((k) => k.member_key)).size).toBe(9);
    expect(keys.every((k) => /^[0-9a-f]{32}$/.test(k.member_key))).toBe(true);
    expect(keys.filter((k) => k.thriving).length).toBe(6);
    const ids = new Set([...S.p, ...S.b, ...S.z].map((x) => x.id));
    expect(keys.some((k) => ids.has(k.member_key))).toBe(false);
    // The code is stable between refreshes
    await callAdmin("bi_refresh_all");
    const again = await sql("select member_key from bi.members where season = (select name from public.seasons where id = $1)", [seasonA]);
    expect(new Set(again.map((k) => k.member_key))).toEqual(new Set(keys.map((k) => k.member_key)));
  });

  it("carries no names, contact details, free text or care notes", async () => {
    const columns = await sql("select table_name, column_name from information_schema.columns where table_schema = 'bi' and table_name <> 'config'");
    const bad = columns.filter((c) => /(^|_)(name|names|email|phone|whatsapp|note|notes|story|body|address|birthday|support|person_id|leader_id|coach_id|text|reflection)($|_)/.test(c.column_name));
    expect(bad).toEqual([]);
    let all = "";
    for (const view of ["members", "tribes", "weekly", "care_weekly", "messages_daily", "ai_fields", "kpi_daily"]) {
      all += (await sql(`select coalesce(string_agg(row_to_json(t)::text, ' '), '') as j from bi.${view} t`))[0].j;
    }
    expect(all).not.toContain("@");
    expect(all).not.toContain(" Test");
    for (const x of [...S.p, ...S.b, S.alpha.leader, S.beta.leader]) expect(all).not.toContain(x.id);
    expect(all).not.toContain("Pray daily");
  });

  it("is what the reader role can read, and nothing more", async () => {
    const n = await asReader(async () => (await db.admin.query("select count(*)::int as n from bi.members")).rows[0].n);
    expect(n).toBe(14);
    for (const table of ["public.people", "public.member_profiles", "public.tribes", "public.messages", "public.reports", "public.care_tasks", "bi.config", "public.kpi_settings"]) {
      await asReader(() => expectCode(db.admin.query(`select * from ${table} limit 1`), "42501"));
    }
    await asReader(() => expectCode(db.admin.query("select public.dashboard()"), "42501"));
    await asReader(() => expectCode(db.admin.query("select public.bi_refresh_all()"), "42501"));
    await asReader(() => expectCode(db.admin.query("refresh materialized view bi.members"), "42501"));
    await asReader(() => expectCode(db.admin.query("insert into bi.tribes select * from bi.tribes limit 1"), "42501"));
  });

  it("cannot be reached by the app's own roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await db.admin.query(
        `select has_schema_privilege($1, 'bi', 'usage') as u, has_table_privilege($1, 'bi.members', 'select') as s, has_table_privilege($1, 'bi.config', 'select') as c`,
        [role],
      );
      expect(rows[0]).toEqual({ u: false, s: false, c: false });
    }
    await expectCode(db.asUser(S.director.id, (q) => q("select * from bi.members")), "42501");
  });
});

// ---------------------------------------------------------------------------
// The new tables are closed to the app
// ---------------------------------------------------------------------------

describe("the new tables", () => {
  it("have row-level security on and no grants to the app's roles", async () => {
    const tables = ["kpi_settings", "word_habit", "community_champions", "kpi_snapshots", "reports"];
    for (const t of tables) {
      const rls = await sql("select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass", [t]);
      expect(rls[0].relrowsecurity, t).toBe(true);
      const grants = await sql(
        "select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee in ('anon', 'authenticated')",
        [t],
      );
      expect(grants, t).toHaveLength(0);
    }
  });
});
