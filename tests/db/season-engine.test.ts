import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wordingProblems } from "./contract";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

let db: TestDb;
let seasonId: string;
let trackId: string;
let communityId: string;
let goalId: string;
let token: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb();
  seasonId = (await db.admin.query("select id from public.seasons order by starts_on limit 1")).rows[0].id;
  trackId = (await db.admin.query("select id from public.tracks where slug = 'builders'")).rows[0].id;
  communityId = (await db.admin.query("select id from public.communities where slug = 'professionals'")).rows[0].id;
  goalId = (await db.admin.query("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).rows[0].id;
  token = (await db.admin.query("select public.bootstrap_worker_token('season-engine-test') as t")).rows[0].t;
});

afterAll(async () => {
  await db.close();
});

/** Puts the season in week `week`, `day` days into that week. */
async function at(week: number, day = 0) {
  await db.admin.query(
    `update public.seasons set starts_on = public.today_lagos() - $1::int, ends_on = public.today_lagos() - $1::int + 83 where id = $2`,
    [(week - 1) * 7 + day, seasonId],
  );
}

async function person(name: string) {
  const u = await db.createUser();
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Test`, name]);
  return u;
}

async function makeTribe(o: { coach?: string | null; assistant?: string | null; community?: string; goal?: string } = {}) {
  const leader = await person(`Leader${++n}`);
  await db.grant(leader.id, "leader");
  const { rows } = await db.admin.query(
    `insert into public.tribes (season_id, leader_id, assistant_id, coach_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, $4, 'approved', $5, $6, $7, $8, '{}', 'mixed', 'My story.', 3, '20:00', 'weeknight-evening', 'online', 'mainland',
             'Online', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [seasonId, leader.id, o.assistant ?? null, o.coach ?? null, `Tribe ${n}`, trackId, o.community ?? communityId, o.goal ?? goalId],
  );
  return { leader, tribe: rows[0].id as string };
}

async function join(tribe: string, name: string) {
  const u = await person(name);
  await db.admin.query(
    `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
    [tribe, u.id, seasonId],
  );
  return u;
}

async function withRole(name: string, role: string) {
  const u = await person(name);
  await db.grant(u.id, role);
  return u;
}

const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
const call = async (userId: string, text: string, params: unknown[] = []) => (await db.asUser(userId, (q) => q(text, params))).rows[0]?.r;
const asWorker = async (text: string, params: unknown[] = [], tok = token) => (await db.asAnon((q) => q(text, [tok, ...params]))).rows[0]?.r;

type Att = [string, "present" | "absent" | "excused"];
type Extras = {
  energy?: number | null;
  prayers?: { id?: string; body: string }[] | null;
  care?: { person?: string; level: string; note?: string }[] | null;
  needCoach?: boolean;
  needCoachNote?: string | null;
  celebrations?: { kind: string; person?: string; note?: string }[] | null;
};
const log = (leaderId: string, tribe: string, wk: number, held: boolean, att: Att[], x: Extras = {}, highlight: string | null = null) =>
  call(
    leaderId,
    "select public.save_tribe_log($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb) as r",
    [
      tribe, wk, held, highlight, JSON.stringify(att.map(([person, status]) => ({ person, status }))),
      x.energy ?? null, x.prayers ? JSON.stringify(x.prayers) : null, x.care ? JSON.stringify(x.care) : null,
      x.needCoach ?? false, x.needCoachNote ?? null, x.celebrations ? JSON.stringify(x.celebrations) : null,
    ],
  );
const logExtras = (userId: string, tribe: string, wk: number | null = null) => call(userId, "select public.tribe_log_extras($1, $2) as r", [tribe, wk]);
const tasks = (tribe: string) => sql("select * from public.care_tasks where tribe_id = $1 order by created_at", [tribe]);
const queued = (template: string, tribe?: string) =>
  sql("select * from public.messages where template = $1 and ($2::uuid is null or tribe_id = $2) order by created_at", [template, tribe ?? null]);

// ---------------------------------------------------------------------------

describe("the new tables and functions", () => {
  it("keeps every new table out of the app's reach, for visitors too", async () => {
    const u = await person("Nobody");
    for (const table of ["prayer_requests", "celebrations", "care_tasks", "community_prompts", "goal_ideas"]) {
      await expectCode(db.asUser(u.id, (q) => q(`select * from public.${table}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${table}`)), "42501");
    }
  });

  it("refuses a visitor on every new function", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    for (const text of [
      "select public.tribe_log_extras($1)",
      "select public.answer_prayer($1, null)",
      "select public.remove_prayer($1)",
      "select public.my_care_tasks()",
      "select public.complete_care_task($1, 'done', null)",
      "select public.reassign_care_task($1, $1)",
      "select public.care_task_stats(30)",
      "select public.care_task_options($1)",
      "select public.testimony_wall()",
      "select public.forward_testimony($1)",
      "select public.week_layer($1)",
    ]) {
      await expectCode(db.asAnon((q) => q(text, text.includes("$1") ? [id] : [])), "42501");
    }
  });
});

describe("the curriculum content", () => {
  it("has a confession for every week, short enough to say aloud", async () => {
    const rows = await sql("select week, confession from public.week_guides order by week");
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.confession, `week ${r.week}`).toBeTruthy();
      expect(r.confession.length).toBeLessThanOrEqual(300);
    }
  });

  it("has a skill-share prompt for each community in each phase, and an idea for each goal in each phase", async () => {
    const communities = (await sql("select count(*)::int as n from public.communities"))[0].n;
    const goals = (await sql("select count(*)::int as n from public.season_goals"))[0].n;
    expect((await sql("select count(*)::int as n from public.community_prompts"))[0].n).toBe(communities * 3);
    expect((await sql("select count(*)::int as n from public.goal_ideas"))[0].n).toBe(goals * 3);
    expect(communities).toBe(11);
    expect(goals).toBe(23);
  });
});

describe("week_layer", () => {
  it("gives the tribe its confession, a prompt for its community and an idea for its goal, by phase", async () => {
    const { tribe, leader } = await makeTribe();
    const ada = await join(tribe, "Ada");
    for (const [wk, phase] of [[1, 1], [4, 1], [5, 2], [8, 2], [9, 3], [12, 3]] as const) {
      const layer = await call(ada.id, "select public.week_layer($1, $2) as r", [tribe, wk]);
      expect(layer).toMatchObject({ week: wk, phase, community: "Professionals", goal: "Step into a leadership role" });
      expect(layer.confession).toBeTruthy();
      expect(layer.skill_share).toBeTruthy();
      expect(layer.goal_idea).toBeTruthy();
    }
    expect((await call(ada.id, "select public.week_layer($1, 1) as r", [tribe])).skill_share).not.toBe(
      (await call(ada.id, "select public.week_layer($1, 9) as r", [tribe])).skill_share,
    );
    // the leader can read it too
    expect((await call(leader.id, "select public.week_layer($1, 2) as r", [tribe])).week).toBe(2);
  });

  it("follows the calendar when no week is asked for, and shows the sermon once the office has set it", async () => {
    await at(6, 1);
    const { tribe } = await makeTribe();
    const ada = await join(tribe, "Ada");
    expect((await call(ada.id, "select public.week_layer($1) as r", [tribe])).week).toBe(6);
    await sql("update public.week_guides set sermon_series = 'Walls Down', sermon_title = 'Look back, then reset' where week = 6");
    expect(await call(ada.id, "select public.week_layer($1) as r", [tribe])).toMatchObject({
      sermon_series: "Walls Down",
      sermon_title: "Look back, then reset",
    });
    await at(1, 0);
  });

  it("is closed to people outside the tribe, and open to its coach and the pastorate", async () => {
    const coach = await withRole("Coach", "coach");
    const pastor = await withRole("Pastor", "pastor");
    const { tribe } = await makeTribe({ coach: coach.id });
    const stranger = await person("Stranger");
    await expectCode(call(stranger.id, "select public.week_layer($1, 1) as r", [tribe]), "42501");
    expect((await call(coach.id, "select public.week_layer($1, 1) as r", [tribe])).week).toBe(1);
    expect((await call(pastor.id, "select public.week_layer($1, 1) as r", [tribe])).week).toBe(1);
    await expectCode(call(coach.id, "select public.week_layer($1, 13) as r", [tribe]), "P0002");
    await expectCode(call(coach.id, "select public.week_layer('00000000-0000-0000-0000-000000000009', 1) as r"), "P0002");
  });
});

describe("the two-minute log", () => {
  it("still accepts the original five-part log", async () => {
    await at(2, 5);
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    const r = await log(leader.id, tribe, 2, true, [[a.id, "present"]], {}, "A good night");
    expect(r).toMatchObject({ held: true, present: 1 });
    const e = await logExtras(leader.id, tribe, 2);
    expect(e).toMatchObject({ energy: null, need_coach: false, prayers_this_week: [], celebrations: [], care: [] });
  });

  it("records the energy of the meeting, from 1 to 5, only for a meeting that was held", async () => {
    await at(2, 5);
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { energy: 4 });
    expect((await logExtras(leader.id, tribe, 2)).energy).toBe(4);
    await expectCode(log(leader.id, tribe, 2, true, [[a.id, "present"]], { energy: 6 }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, [[a.id, "present"]], { energy: 0 }), "22023");
    await log(leader.id, tribe, 2, false, [], { energy: 5 });
    expect((await logExtras(leader.id, tribe, 2)).energy).toBeNull();
  });

  it("adds the energy of the meeting and the tribe's open care tasks to the weekly report", async () => {
    await at(2, 5);
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    const report = await log(leader.id, tribe, 2, true, [[a.id, "present"]], { energy: 3, care: [{ person: a.id, level: "pastoral" }] });
    expect(report).toMatchObject({ energy: 3, care_open: 1 });
    // the coach reads the same numbers in the tribe's week, and a meeting that was not held has no energy
    expect((await sql("select public.tribe_week_report($1, 2) as r", [tribe]))[0].r).toMatchObject({ energy: 3, care_open: 1 });
    expect(await log(leader.id, tribe, 2, false, [], { energy: 5 })).toMatchObject({ energy: null });
  });

  it("keeps a private prayer list: this week's requests are replaced, answered ones are kept", async () => {
    await at(2, 5);
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { prayers: [{ body: "Healing for a mother" }, { body: "A job interview on Tuesday" }] });
    let e = await logExtras(leader.id, tribe, 2);
    expect(e.prayers_this_week.map((p: { body: string }) => p.body)).toEqual(["Healing for a mother", "A job interview on Tuesday"]);

    // editing: keep one (changing its words), drop one, add one
    const keep = e.prayers_this_week[0].id;
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { prayers: [{ id: keep, body: "Healing for a mother and her nurse" }, { body: "Peace at home" }] });
    e = await logExtras(leader.id, tribe, 2);
    expect(e.prayers_this_week.map((p: { body: string }) => p.body)).toEqual(["Healing for a mother and her nurse", "Peace at home"]);
    expect(e.prayer_list).toHaveLength(2);

    // answered: leaves the list, becomes a celebration, and is not removed by the next edit
    const answered = e.prayers_this_week[1].id;
    await call(leader.id, "select public.answer_prayer($1, 'She got the post') as r", [answered]);
    e = await logExtras(leader.id, tribe, 2);
    expect(e.prayer_list.map((p: { body: string }) => p.body)).toEqual(["Healing for a mother and her nurse"]);
    expect(e.answered).toMatchObject([{ body: "Peace at home", note: "She got the post" }]);
    expect(e.celebrations.map((c: { kind: string }) => c.kind)).toContain("answered_prayer");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { prayers: [] });
    e = await logExtras(leader.id, tribe, 2);
    expect(e.prayer_list).toHaveLength(0);
    expect(e.answered).toHaveLength(1);
    await expectCode(call(leader.id, "select public.answer_prayer($1, null) as r", [answered]), "22023");
    // the team of the tribe was reminded to celebrate it
    expect((await queued("celebration_prompt", tribe)).length).toBeGreaterThanOrEqual(1);
  });

  it("does not show the prayer list to members, or to another tribe's leader, and lets only the team change it", async () => {
    await at(2, 5);
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    const other = await makeTribe();
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { prayers: [{ body: "Private need" }] });
    const id = (await sql("select id from public.prayer_requests where tribe_id = $1", [tribe]))[0].id;
    await expectCode(logExtras(a.id, tribe, 2), "42501");
    await expectCode(logExtras(other.leader.id, tribe, 2), "42501");
    await expectCode(call(a.id, "select public.remove_prayer($1) as r", [id]), "42501");
    await expectCode(call(other.leader.id, "select public.answer_prayer($1, null) as r", [id]), "42501");
    await call(leader.id, "select public.remove_prayer($1) as r", [id]);
    expect(await sql("select 1 from public.prayer_requests where tribe_id = $1", [tribe])).toHaveLength(0);
  });

  it("rejects a bad prayer, care or celebration entry and writes nothing", async () => {
    await at(2, 5);
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    const stranger = await person("Stranger");
    const att: Att[] = [[a.id, "present"]];
    await expectCode(log(leader.id, tribe, 2, true, att, { prayers: [{ body: "no" }] }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, att, { prayers: Array.from({ length: 11 }, (_, i) => ({ body: `Request ${i} here` })) }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, att, { care: [{ person: a.id, level: "dire" }] }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, att, { care: [{ person: stranger.id, level: "pastoral" }] }), "P0002");
    await expectCode(log(leader.id, tribe, 2, true, att, { care: [{ person: a.id, level: "pastoral", note: "x".repeat(301) }] }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, att, { celebrations: [{ kind: "party" }] }), "22023");
    await expectCode(log(leader.id, tribe, 2, true, att, { celebrations: [{ kind: "new_baby", person: stranger.id }] }), "P0002");
    await expectCode(log(leader.id, tribe, 2, true, att, { needCoach: true, needCoachNote: "x".repeat(301) }), "22023");
    expect(await sql("select 1 from public.tribe_logs where tribe_id = $1", [tribe])).toHaveLength(0);
    expect(await tasks(tribe)).toHaveLength(0);
  });

  it("records celebrations, tells the team once, and replaces the week's list on an edit", async () => {
    await at(2, 5);
    const assistant = await withRole("Assistant", "assistant_leader");
    const { leader, tribe } = await makeTribe({ assistant: assistant.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], {
      celebrations: [{ kind: "new_baby", person: a.id, note: "A baby girl" }, { kind: "promotion", note: "Made a manager" }],
    });
    let e = await logExtras(leader.id, tribe, 2);
    expect(e.celebrations.map((c: { kind: string }) => c.kind).sort()).toEqual(["new_baby", "promotion"]);
    expect(e.celebrations.find((c: { kind: string }) => c.kind === "new_baby")).toMatchObject({ first_name: "Ada", person_id: a.id });
    expect(e.has_coach).toBe(false);
    // one prompt for each of the two on the team, for each of the two celebrations
    expect(await queued("celebration_prompt", tribe)).toHaveLength(4);

    // saving again changes nothing and sends nothing more
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], {
      celebrations: [{ kind: "new_baby", person: a.id, note: "A baby girl" }, { kind: "promotion", note: "Made a manager" }],
    });
    expect(await queued("celebration_prompt", tribe)).toHaveLength(4);

    // dropping one removes it
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { celebrations: [{ kind: "promotion", note: "Made a manager" }] });
    e = await logExtras(leader.id, tribe, 2);
    expect(e.celebrations.map((c: { kind: string }) => c.kind)).toEqual(["promotion"]);
  });
});

describe("care flags become tasks", () => {
  it("sends a practical need to the assistant leader, due in seven days, with a message", async () => {
    await at(2, 5);
    const assistant = await withRole("Assistant", "assistant_leader");
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ assistant: assistant.id, coach: coach.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "practical", note: "Needs help moving house" }] });
    const [t] = await tasks(tribe);
    expect(t).toMatchObject({ kind: "practical", status: "open", assignee_role: "assistant", assigned_to: assistant.id, person_id: a.id, week: 2 });
    const days = (await sql("select ($1::date - public.today_lagos()) as d", [t.due_on]))[0].d;
    expect(days).toBe(7);
    const [m] = await queued("care_task", tribe);
    expect(m).toMatchObject({ person_id: assistant.id });
    expect(m.params).toMatchObject({ level: "practical", member: "Ada Test", note: "Needs help moving house" });
  });

  it("sends a pastoral need to the coach, and falls back to the other person when there is no coach", async () => {
    await at(2, 5);
    const coach = await withRole("Coach", "coach");
    const withCoach = await makeTribe({ coach: coach.id });
    const a = await join(withCoach.tribe, "Ada");
    await log(withCoach.leader.id, withCoach.tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "pastoral" }] });
    expect((await tasks(withCoach.tribe))[0]).toMatchObject({ assignee_role: "coach", assigned_to: coach.id });

    const assistant = await withRole("Assistant", "assistant_leader");
    const noCoach = await makeTribe({ assistant: assistant.id });
    const b = await join(noCoach.tribe, "Bayo");
    await log(noCoach.leader.id, noCoach.tribe, 2, true, [[b.id, "present"]], { care: [{ person: b.id, level: "pastoral" }] });
    expect((await tasks(noCoach.tribe))[0]).toMatchObject({ assignee_role: "assistant", assigned_to: assistant.id });

    const alone = await makeTribe();
    const c = await join(alone.tribe, "Chi");
    await log(alone.leader.id, alone.tribe, 2, true, [[c.id, "present"]], { care: [{ person: c.id, level: "practical" }] });
    expect((await tasks(alone.tribe))[0]).toMatchObject({ assignee_role: "care_lead", assigned_to: null });
  });

  it("alerts every Care Lead at once by email AND text for an urgent need, outside quiet hours or not", async () => {
    await at(2, 5);
    const care1 = await withRole("Care One", "care_lead");
    const care2 = await withRole("Care Two", "care_lead");
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "urgent", note: "In hospital tonight" }] });
    const [t] = await tasks(tribe);
    expect(t).toMatchObject({ kind: "urgent", assignee_role: "care_lead", assigned_to: null });
    expect(t.due_on.toISOString().slice(0, 10)).toBe((await sql("select public.today_lagos()::text as d"))[0].d);
    const alerts = await queued("care_urgent", tribe);
    expect(alerts).toHaveLength(4);
    expect(alerts.every((m) => m.urgency === "urgent")).toBe(true);
    for (const who of [care1, care2]) {
      expect(alerts.filter((m) => m.person_id === who.id).map((m) => m.force_channel).sort()).toEqual(["email", "sms"]);
    }
    // the text carries no detail of what happened
    const sms = alerts.find((m) => m.force_channel === "sms");
    expect(JSON.stringify(sms?.params)).not.toContain("hospital");
    // saving the same log again does not alert again
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "urgent", note: "In hospital tonight" }] });
    expect(await queued("care_urgent", tribe)).toHaveLength(4);
    expect(await tasks(tribe)).toHaveLength(1);
  });

  it("alerts the directors when there is no Care Lead", async () => {
    await at(2, 5);
    const director = await withRole("Director", "director");
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    await sql("delete from public.person_roles where role = 'care_lead'");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "urgent" }] });
    expect((await queued("care_urgent", tribe)).every((m) => m.person_id === director.id)).toBe(true);
  });

  it("opens one task however many times the same need is flagged, and updates its note", async () => {
    await at(2, 5);
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "pastoral", note: "First note" }] });
    await at(3, 5);
    await log(leader.id, tribe, 3, true, [[a.id, "present"]], { care: [{ person: a.id, level: "pastoral", note: "Newer note" }] });
    const all = await tasks(tribe);
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("Newer note");
    expect(await queued("care_task", tribe)).toHaveLength(1);
  });

  it("asks the coach for help when the leader ticks 'I need my coach', and withdraws it when untick", async () => {
    await at(2, 5);
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { needCoach: true, needCoachNote: "Two members are in conflict" });
    let e = await logExtras(leader.id, tribe, 2);
    expect(e).toMatchObject({ need_coach: true, need_coach_note: "Two members are in conflict" });
    const [t] = await tasks(tribe);
    expect(t).toMatchObject({ kind: "coach_help", assigned_to: coach.id, person_id: null, status: "open" });
    const [m] = await queued("coach_help", tribe);
    expect(m).toMatchObject({ person_id: coach.id });
    expect(m.params).toMatchObject({ note: "Two members are in conflict", week: 2 });

    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { needCoach: false });
    e = await logExtras(leader.id, tribe, 2);
    expect(e.need_coach).toBe(false);
    expect((await tasks(tribe))[0].status).toBe("dismissed");
  });

  it("opens a task for the coach on the third missed meeting in a row, not before", async () => {
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    const b = await join(tribe, "Bayo");
    for (const wk of [1, 2]) {
      await at(wk, 5);
      await log(leader.id, tribe, wk, true, [[a.id, "absent"], [b.id, "present"]]);
    }
    expect((await tasks(tribe)).filter((t) => t.kind === "missed_three")).toHaveLength(0);
    await at(3, 5);
    await log(leader.id, tribe, 3, true, [[a.id, "absent"], [b.id, "present"]]);
    const missed = (await tasks(tribe)).filter((t) => t.kind === "missed_three");
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ person_id: a.id, assigned_to: coach.id, assignee_role: "coach", status: "open" });
    // fixing the log (she did come) takes the new task away
    await log(leader.id, tribe, 3, true, [[a.id, "present"], [b.id, "present"]]);
    expect((await tasks(tribe)).filter((t) => t.kind === "missed_three" && t.status === "open")).toHaveLength(0);
  });

  it("opens a task for the coach when a belonging score falls below three", async () => {
    await at(1, 1);
    const coach = await withRole("Coach", "coach");
    const { tribe } = await makeTribe({ coach: coach.id });
    const low = await join(tribe, "Low");
    const fine = await join(tribe, "Fine");
    await call(low.id, "select public.save_pulse(1, 2, 4, 4, 4, null) as r");
    await call(fine.id, "select public.save_pulse(1, 4, 4, 4, 4, null) as r");
    const rows = await tasks(tribe);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "low_pulse", person_id: low.id, assigned_to: coach.id });
    expect((await queued("coach_low_pulse", tribe)).length).toBe(1);
  });
});

describe("working through care tasks", () => {
  async function setup() {
    await at(2, 5);
    const assistant = await withRole("Assistant", "assistant_leader");
    const coach = await withRole("Coach", "coach");
    const care = await withRole("Careful", "care_lead");
    const { leader, tribe } = await makeTribe({ assistant: assistant.id, coach: coach.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], {
      care: [{ person: a.id, level: "practical", note: "Needs a lift to clinic" }],
      needCoach: true,
    });
    const practical = (await tasks(tribe)).find((t) => t.kind === "practical")!;
    const help = (await tasks(tribe)).find((t) => t.kind === "coach_help")!;
    return { assistant, coach, care, leader, tribe, a, practical, help };
  }

  it("lists a person's own tasks, the Care Lead queue for the care team, and what a leader raised", async () => {
    const { assistant, coach, care, leader, a, tribe } = await setup();
    const alone = await makeTribe();
    const b = await join(alone.tribe, "Bayo");
    await log(alone.leader.id, alone.tribe, 2, true, [[b.id, "present"]], { care: [{ person: b.id, level: "urgent" }] });
    // other tests in this file leave tasks behind, so look only at these two tribes
    const here = (list: { kind: string; tribe: { id: string } }[]) =>
      list.filter((t) => t.tribe.id === tribe || t.tribe.id === alone.tribe).map((t) => t.kind).sort();

    const mineAssistant = await call(assistant.id, "select public.my_care_tasks() as r");
    expect(here(mineAssistant.mine)).toEqual(["practical"]);
    expect(mineAssistant.queue).toEqual([]);
    expect(mineAssistant.others).toEqual([]);
    expect(mineAssistant.mine[0]).toMatchObject({ member: "Ada Test", first_name: "Ada", days_left: 7, overdue: false });

    const mineCoach = await call(coach.id, "select public.my_care_tasks() as r");
    expect(here(mineCoach.mine)).toEqual(["coach_help"]);

    const mineCare = await call(care.id, "select public.my_care_tasks() as r");
    expect(mineCare.mine).toEqual([]);
    expect(here(mineCare.queue)).toEqual(["urgent"]);
    expect(here(mineCare.others)).toEqual(["coach_help", "practical"]);

    const raised = await call(leader.id, "select public.my_care_tasks() as r");
    expect(here(raised.raised)).toEqual(["coach_help", "practical"]);
    expect(raised.queue).toEqual([]);

    // a member sees none of it
    const mem = await call(a.id, "select public.my_care_tasks() as r");
    expect(mem).toMatchObject({ mine: [], queue: [], others: [], raised: [] });
  });

  it("lets the person it is assigned to close it, and the care team and pastors close any", async () => {
    const { assistant, coach, care, practical, help, leader } = await setup();
    await expectCode(call(coach.id, "select public.complete_care_task($1, 'done', null) as r", [practical.id]), "42501");
    await expectCode(call(leader.id, "select public.complete_care_task($1, 'done', null) as r", [practical.id]), "42501");
    await expectCode(call(assistant.id, "select public.complete_care_task($1, 'finished', null) as r", [practical.id]), "22023");
    await expectCode(call(assistant.id, "select public.complete_care_task($1, 'dismissed', null) as r", [practical.id]), "22023");
    await call(assistant.id, "select public.complete_care_task($1, 'done', 'Drove her on Tuesday') as r", [practical.id]);
    expect((await sql("select status, closed_note, closed_by from public.care_tasks where id = $1", [practical.id]))[0]).toEqual({
      status: "done", closed_note: "Drove her on Tuesday", closed_by: assistant.id,
    });
    await expectCode(call(assistant.id, "select public.complete_care_task($1, 'done', null) as r", [practical.id]), "22023");
    await call(care.id, "select public.complete_care_task($1, 'done', null) as r", [help.id]);
    expect((await sql("select status from public.care_tasks where id = $1", [help.id]))[0].status).toBe("done");
    await expectCode(call(assistant.id, "select public.complete_care_task('00000000-0000-0000-0000-000000000009', 'done', null) as r"), "P0002");
  });

  it("lets the leader who raised a need take it back, but only with a reason", async () => {
    const { leader, practical } = await setup();
    await expectCode(call(leader.id, "select public.complete_care_task($1, 'dismissed', null) as r", [practical.id]), "22023");
    await call(leader.id, "select public.complete_care_task($1, 'dismissed', 'Sorted it out ourselves') as r", [practical.id]);
    expect((await sql("select status from public.care_tasks where id = $1", [practical.id]))[0].status).toBe("dismissed");
  });

  it("lets the care team pass a task to the tribe's coach, assistant or leader, or another Care Lead, and nobody else", async () => {
    const { assistant, coach, care, leader, practical, tribe } = await setup();
    await expectCode(call(assistant.id, "select public.reassign_care_task($1, $2) as r", [practical.id, coach.id]), "42501");
    await call(care.id, "select public.reassign_care_task($1, $2) as r", [practical.id, coach.id]);
    expect((await sql("select assignee_role, assigned_to from public.care_tasks where id = $1", [practical.id]))[0]).toEqual({ assignee_role: "coach", assigned_to: coach.id });
    expect((await queued("care_task", tribe)).map((m) => m.person_id)).toContain(coach.id);
    await call(care.id, "select public.reassign_care_task($1, $2) as r", [practical.id, leader.id]);
    expect((await sql("select assignee_role from public.care_tasks where id = $1", [practical.id]))[0].assignee_role).toBe("leader");
    const outsider = await person("Outsider");
    await expectCode(call(care.id, "select public.reassign_care_task($1, $2) as r", [practical.id, outsider.id]), "22023");
    const options = await call(care.id, "select public.care_task_options($1) as r", [practical.id]);
    expect(options.map((o: { role: string }) => o.role)).toEqual(expect.arrayContaining(["coach", "assistant", "leader", "care_lead"]));
    expect(options.map((o: { id: string }) => o.id)).not.toContain(outsider.id);
    await expectCode(call(assistant.id, "select public.care_task_options($1) as r", [practical.id]), "42501");
    await call(coach.id, "select public.complete_care_task($1, 'done', null) as r", [practical.id]).catch(() => undefined);
    await call(leader.id, "select public.complete_care_task($1, 'done', 'Done') as r", [practical.id]);
    await expectCode(call(care.id, "select public.reassign_care_task($1, $2) as r", [practical.id, coach.id]), "P0002");
  });

  it("counts care for the office, with no names", async () => {
    const { assistant, practical, care } = await setup();
    await call(assistant.id, "select public.complete_care_task($1, 'done', 'Done') as r", [practical.id]);
    const stats = await call(care.id, "select public.care_task_stats(90) as r");
    expect(stats.opened).toBeGreaterThanOrEqual(1);
    expect(stats.resolved).toBeGreaterThanOrEqual(1);
    expect(stats.resolved_in_7_days).toBeGreaterThanOrEqual(1);
    expect(stats.by_kind.practical).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(stats)).not.toMatch(/Ada/);
    const leader = await withRole("Plain Leader", "leader");
    await expectCode(call(leader.id, "select public.care_task_stats(90) as r"), "42501");
  });
});

describe("the care sweep", () => {
  async function dueTask(daysFromNow: number) {
    await at(2, 5);
    const coach = await withRole("Coach", "coach");
    const care = await withRole("Careful", "care_lead");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "pastoral", note: "Grieving" }] });
    await sql("update public.care_tasks set due_on = public.today_lagos() + $2::int where tribe_id = $1", [tribe, daysFromNow]);
    return { coach, care, tribe, leader };
  }

  it("needs the sending token to run, and is part of the heartbeat", async () => {
    await expectCode(db.asAnon((q) => q("select public.care_sweep(now())")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_tick($1)", ["z".repeat(40)])), "42501");
    const out = await asWorker("select public.worker_tick($1) as r");
    expect(out).toHaveProperty("care_open");
  });

  it("reminds the assignee two days before the deadline, once", async () => {
    await sql("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
    const { coach, tribe } = await dueTask(2);
    await asWorker("select public.worker_tick($1) as r");
    await asWorker("select public.worker_tick($1) as r");
    const reminders = await queued("care_task_reminder", tribe);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].person_id).toBe(coach.id);
  });

  it("does not remind too early or on the wrong day", async () => {
    await sql("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
    const { tribe } = await dueTask(5);
    await asWorker("select public.worker_tick($1) as r");
    expect(await queued("care_task_reminder", tribe)).toHaveLength(0);
    expect(await queued("care_task_overdue", tribe)).toHaveLength(0);
  });

  it("tells the assignee and the care team once a task is late", async () => {
    await sql("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
    const { coach, care, tribe } = await dueTask(-1);
    // earlier tests created other care leads; this one is about the care team being told
    await sql("delete from public.person_roles where role = 'care_lead' and person_id <> $1", [care.id]);
    await asWorker("select public.worker_tick($1) as r");
    await asWorker("select public.worker_tick($1) as r");
    const late = await queued("care_task_overdue", tribe);
    expect(late.map((m) => m.person_id).sort()).toEqual([care.id, coach.id].sort());
    expect(await call(care.id, "select public.my_care_tasks() as r").then((r) => r.others[0].overdue)).toBe(true);
  });

  it("sends an urgent need nobody has answered in four hours to the directors", async () => {
    await sql("create or replace function public.lagos_hour() returns integer language sql as $$ select 12 $$");
    await at(2, 5);
    const director = await withRole("Director", "director");
    await withRole("Careful", "care_lead");
    const { leader, tribe } = await makeTribe();
    const a = await join(tribe, "Ada");
    await log(leader.id, tribe, 2, true, [[a.id, "present"]], { care: [{ person: a.id, level: "urgent" }] });
    await asWorker("select public.worker_tick($1) as r");
    expect((await queued("care_task_overdue", tribe)).filter((m) => m.person_id === director.id)).toHaveLength(0);
    await sql("update public.care_tasks set created_at = now() - interval '5 hours' where tribe_id = $1", [tribe]);
    await asWorker("select public.worker_tick($1) as r");
    await asWorker("select public.worker_tick($1) as r");
    const alerts = (await queued("care_task_overdue", tribe)).filter((m) => m.person_id === director.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].urgency).toBe("urgent");
    await sql(
      "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer $$",
    );
  });
});

describe("testimonies: themes, the wall and forwarding", () => {
  async function testimony(o: { share?: "tribe" | "church"; credit?: string; status?: string; community?: string; goal?: string } = {}) {
    await at(3, 2);
    const { leader, tribe } = await makeTribe({ community: o.community, goal: o.goal });
    const ada = await join(tribe, "Ada");
    await call(ada.id, "select public.submit_testimony($1, $2, $3) as r", [
      "God provided the rent I could not find, just in time.", o.share ?? "church", o.credit ?? "first_name",
    ]);
    const id = (await sql("select id from public.testimonies where tribe_id = $1", [tribe]))[0].id as string;
    return { leader, tribe, ada, id };
  }

  it("takes the community and goal of the tribe when it is written", async () => {
    const { id } = await testimony();
    expect((await sql("select community_id, season_goal_id from public.testimonies where id = $1", [id]))[0]).toEqual({ community_id: communityId, season_goal_id: goalId });
  });

  it("lets the reviewer tag up to three themes, and refuses an unknown or a fourth", async () => {
    const { leader, id } = await testimony();
    await expectCode(call(leader.id, "select public.review_testimony($1, 'approve', null, array['healing','provision','family','peace']) as r", [id]), "22023");
    await expectCode(call(leader.id, "select public.review_testimony($1, 'approve', null, array['luck']) as r", [id]), "22023");
    expect((await sql("select status, themes from public.testimonies where id = $1", [id]))[0]).toEqual({ status: "submitted", themes: [] });
    await call(leader.id, "select public.review_testimony($1, 'approve', null, array['provision','provision','answered_prayer']) as r", [id]);
    expect((await sql("select status, themes from public.testimonies where id = $1", [id]))[0]).toEqual({ status: "tribe_approved", themes: ["answered_prayer", "provision"] });
  });

  it("keeps the themes when approved again without any, and lets a pastor re-tag", async () => {
    const { leader, id } = await testimony();
    const pastor = await withRole("Pastor", "pastor");
    await call(leader.id, "select public.review_testimony($1, 'approve', null, array['provision']) as r", [id]);
    await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    expect((await sql("select status, themes from public.testimonies where id = $1", [id]))[0]).toEqual({ status: "church_approved", themes: ["provision"] });
  });

  it("shows the wall only to people who are signed in, and only what the pastorate approved for the church", async () => {
    await sql("delete from public.testimonies");
    const pastor = await withRole("Pastor", "pastor");
    const approved = await testimony({ credit: "first_name" });
    const tribeOnly = await testimony({ share: "tribe" });
    const waiting = await testimony();
    const anon = await testimony({ credit: "anonymous" });
    await call(approved.leader.id, "select public.review_testimony($1, 'approve', null, array['provision','peace']) as r", [approved.id]);
    await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [approved.id]);
    await call(tribeOnly.leader.id, "select public.review_testimony($1, 'approve', null) as r", [tribeOnly.id]);
    await call(anon.leader.id, "select public.review_testimony($1, 'approve', null, array['healing']) as r", [anon.id]);
    await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [anon.id]);
    void waiting;

    const reader = await person("Reader");
    const wall = await call(reader.id, "select public.testimony_wall() as r");
    expect(wall.total).toBe(2);
    expect(wall.items.map((i: { id: string }) => i.id).sort()).toEqual([approved.id, anon.id].sort());
    const shown = wall.items.find((i: { id: string }) => i.id === approved.id);
    expect(shown).toMatchObject({ by: "Ada", community: "Professionals", goal: "Step into a leadership role", themes: ["peace", "provision"], forwarded: null });
    const hidden = wall.items.find((i: { id: string }) => i.id === anon.id);
    expect(hidden.by).toBe("A member of The Covenant Nation");
    expect(JSON.stringify(wall)).not.toContain("person_id");
    expect(JSON.stringify(hidden)).not.toContain("Ada");
    // the pastorate can see which have gone to the TCN form
    expect((await call(pastor.id, "select public.testimony_wall() as r")).items[0].forwarded).toBe(false);
  });

  it("filters the wall by community, goal and theme, pages through it, and counts what each filter would find", async () => {
    await sql("delete from public.testimonies");
    const pastor = await withRole("Pastor", "pastor");
    const otherCommunity = (await sql("select id from public.communities where slug = 'education'"))[0].id as string;
    const otherGoal = (await sql("select id from public.season_goals where slug = 'excel-in-my-studies-or-exams'"))[0].id as string;
    const one = await testimony({ community: communityId, goal: goalId });
    const two = await testimony({ community: otherCommunity, goal: otherGoal });
    const three = await testimony({ community: otherCommunity, goal: otherGoal });
    for (const [t, themes] of [[one, "'healing'"], [two, "'growth'"], [three, "'growth','family'"]] as const) {
      await call(t.leader.id, `select public.review_testimony($1, 'approve', null, array[${themes}]) as r`, [t.id]);
      await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [t.id]);
    }
    const reader = await person("Reader");
    const byCommunity = await call(reader.id, "select public.testimony_wall($1) as r", [otherCommunity]);
    expect(byCommunity.items.map((i: { id: string }) => i.id).sort()).toEqual([two.id, three.id].sort());
    expect((await call(reader.id, "select public.testimony_wall(null, $1) as r", [goalId])).items.map((i: { id: string }) => i.id)).toEqual([one.id]);
    expect((await call(reader.id, "select public.testimony_wall(null, null, 'family') as r")).items.map((i: { id: string }) => i.id)).toEqual([three.id]);
    expect((await call(reader.id, "select public.testimony_wall(null, null, 'growth') as r")).total).toBe(2);

    const first = await call(reader.id, "select public.testimony_wall(null, null, null, 2, 0) as r");
    expect(first).toMatchObject({ total: 3, has_more: true });
    expect(first.items).toHaveLength(2);
    const next = await call(reader.id, "select public.testimony_wall(null, null, null, 2, 2) as r");
    expect(next.items).toHaveLength(1);
    expect(next.has_more).toBe(false);
    expect(new Set([...first.items, ...next.items].map((i: { id: string }) => i.id)).size).toBe(3);

    const facets = first.facets;
    expect(facets.communities.find((t: { name: string }) => t.name === "Education").n).toBe(2);
    expect(facets.themes.find((t: { theme: string }) => t.theme === "growth").n).toBe(2);
    // a silly page size is brought back into range
    expect((await call(reader.id, "select public.testimony_wall(null, null, null, 9999, -5) as r", [])).items).toHaveLength(3);
  });

  it("lets the pastorate forward an approved testimony to the TCN form, once on record, and nobody else", async () => {
    const pastor = await withRole("Pastor", "pastor");
    const { leader, id } = await testimony();
    await expectCode(call(pastor.id, "select public.forward_testimony($1) as r", [id]), "22023"); // not yet approved for the church
    await call(leader.id, "select public.review_testimony($1, 'approve', null, array['provision']) as r", [id]);
    await call(pastor.id, "select public.review_testimony($1, 'approve', null) as r", [id]);
    await expectCode(call(leader.id, "select public.forward_testimony($1) as r", [id]), "42501");

    const first = await call(pastor.id, "select public.forward_testimony($1) as r", [id]);
    expect(first).toMatchObject({ id, already: false, by: "Ada", community: "Professionals", themes: ["provision"] });
    expect(first.body).toContain("God provided the rent");
    const second = await call(pastor.id, "select public.forward_testimony($1) as r", [id]);
    expect(second.already).toBe(true);
    expect(second.forwarded_at).toBe(first.forwarded_at);
    expect(await sql("select 1 from public.event_log where action = 'testimony.forwarded' and entity_id = $1", [id])).toHaveLength(1);
    await expectCode(call(pastor.id, "select public.forward_testimony('00000000-0000-0000-0000-000000000009') as r"), "P0002");
  });
});

// ---------------------------------------------------------------------------

describe("the wording matches what the season engine queues", () => {
  it("renders every care, coach and celebration message in every channel", async () => {
    // a third missed meeting that is left as it is, so its message stays queued
    const coach = await withRole("Coach", "coach");
    const { leader, tribe } = await makeTribe({ coach: coach.id });
    const a = await join(tribe, "Ada");
    for (const wk of [1, 2, 3]) {
      await at(wk, 5);
      await log(leader.id, tribe, wk, true, [[a.id, "absent"]]);
    }
    const rows = await sql(
      `select distinct on (template) id, template, params, reply_token, urgency from public.messages
        where template in ('care_urgent', 'care_task', 'care_task_reminder', 'care_task_overdue', 'coach_help', 'celebration_prompt',
                           'coach_low_pulse', 'coach_missed_three')
          and params <> '{}'::jsonb
        order by template, created_at desc`,
    );
    const seen = new Set(rows.map((r) => r.template));
    for (const t of ["care_urgent", "care_task", "care_task_reminder", "care_task_overdue", "coach_help", "celebration_prompt", "coach_low_pulse", "coach_missed_three"]) {
      expect(seen.has(t), `no ${t} message was queued by the tests above`).toBe(true);
    }
    expect(await wordingProblems(rows)).toEqual([]);
  });
});
