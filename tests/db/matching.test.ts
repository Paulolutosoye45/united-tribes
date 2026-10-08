import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { inject } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;
let seasonId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  const { rows } = await db.admin.query("select id from public.seasons where status in ('planning','open') order by starts_on limit 1");
  seasonId = rows[0].id;
  for (const [table, slug] of [
    ["tracks", "builders"],
    ["tracks", "rising"],
    ["tribes", "professionals"],
    ["tribes", "business-entrepreneurship"],
    ["tribes", "marriage-relationships"],
    ["season_goals", "step-into-a-leadership-role"],
    ["season_goals", "change-career-direction-with-confidence"],
    ["season_goals", "launch-or-formalise-a-business"],
    ["season_goals", "strengthen-our-marriage"],
    ["age_ranges", "33-40"],
    ["age_ranges", "18-25"],
  ] as const) {
    ids[`${table}:${slug}`] = (await db.admin.query(`select id from public.${table} where slug = $1`, [slug])).rows[0].id;
  }
});

afterAll(async () => {
  await db.close();
});

// Every test starts with no open circles, so the circles it creates are the only ones a member can be shown.
beforeEach(async () => {
  await db.admin.query("update public.circles set status = 'closed' where status = 'approved'");
});

const id = (table: string, slug: string) => ids[`${table}:${slug}`];

interface CircleOpts {
  slot?: "weeknight-evening" | "sunday-afternoon" | "sunday-evening" | "saturday-morning";
  mode?: "online" | "in_person";
  zone?: string;
  capacity?: number;
  type?: "mixed" | "women" | "men";
  goal?: string;
  tribe?: string;
  track?: string;
  style?: string;
  certified?: boolean;
  status?: string;
}

/** A published circle with a certified leader. Leaves the leader's id so a test can act as them. */
async function openCircle(o: CircleOpts = {}) {
  const leader = await db.createUser();
  await db.grant(leader.id, "leader");
  await db.admin.query(`update public.people set full_name = $2, preferred_name = 'Tola' where id = $1`, [leader.id, `Tola Leader ${leader.id.slice(0, 4)}`]);
  await db.admin.query(
    `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at)
     values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())`,
    [leader.id, JSON.stringify({ calling: { track: "builders", tribe: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: o.style ?? "structure" } })],
  );
  if (o.certified !== false) await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
  const slot = o.slot ?? "weeknight-evening";
  const day = slot === "weeknight-evening" ? 3 : slot === "saturday-morning" ? 6 : 0;
  const time = slot === "weeknight-evening" ? "20:00" : slot === "saturday-morning" ? "09:00" : slot === "sunday-afternoon" ? "15:00" : "19:00";
  const { rows } = await db.admin.query(
    `insert into public.circles (season_id, leader_id, status, name, track_id, tribe_id, season_goal_id, fixed, circle_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, '{}', $8, 'My story.', $9, $10, $11, $12, $13, 'Near the bridge', $14,
             'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [
      seasonId, leader.id, o.status ?? "approved", `Circle ${leader.id.slice(0, 4)}`,
      id("tracks", o.track ?? "builders"), id("tribes", o.tribe ?? "professionals"), id("season_goals", o.goal ?? "step-into-a-leadership-role"),
      o.type ?? "mixed", day, time, slot, o.mode ?? "in_person", o.zone ?? "mainland", o.capacity ?? 12,
    ],
  );
  return { leader, circle: rows[0].id as string };
}

interface MemberOpts {
  age?: string;
  gender?: "female" | "male" | "undisclosed";
  mix?: "mixed" | "same_gender" | "no_preference";
  zone?: string;
  tribe?: string;
  goal?: string;
  faith?: string;
  mode?: "online" | "in_person" | "either";
  times?: string[];
  social?: number;
  structure?: number;
  support?: string | null;
  whatsapp?: string | null;
}

async function member(o: MemberOpts = {}) {
  const user = await db.createUser();
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times, style_social, style_structure, support_needs, whatsapp, duration_seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 3, $10, $11, $12, $13, $14, $15, 250)`,
    [
      user.id, seasonId, id("age_ranges", o.age ?? "33-40"), o.gender ?? "female", o.mix ?? "mixed", o.zone ?? "mainland",
      id("tribes", o.tribe ?? "professionals"), o.faith ?? "growing", id("season_goals", o.goal ?? "step-into-a-leadership-role"),
      o.mode ?? "either", o.times ?? ["weeknight-evening"], o.social ?? 0, o.structure ?? 0, o.support ?? null, o.whatsapp ?? null,
    ],
  );
  return user;
}

const match = async (userId: string, refresh = true) => (await db.asUser(userId, (q) => q("select public.match_me($1) as r", [refresh]))).rows[0].r;
const shownIds = (m: { circles: { circle: { id: string } }[] }) => m.circles.map((c) => c.circle.id);

async function place(memberId: string, circleId: string) {
  const m = await match(memberId);
  expect(shownIds(m)).toContain(circleId);
  return (await db.asUser(memberId, (q) => q("select public.choose_circle($1, true, 'cov-1') as r", [circleId]))).rows[0].r;
}

describe("the model", () => {
  it("has one active model whose weights add to 100", async () => {
    const { rows } = await db.admin.query("select version, weights, min_degree from public.match_models where active");
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("v1");
    expect(rows[0].min_degree).toBe(60);
    const total = Object.values(rows[0].weights as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it("refuses a second active model and weights that do not add up", async () => {
    await expect(db.admin.query(`insert into public.match_models (version, weights, active) values ('v2', '{"goal":30,"stage":20,"tribe":15,"place":10,"style":10,"rhythm":10,"faith":5}', true)`)).rejects.toThrow();
    await expect(db.admin.query(`insert into public.match_models (version, weights) values ('bad', '{"goal":50,"stage":20,"tribe":15,"place":10,"style":10,"rhythm":10,"faith":5}')`)).rejects.toThrow();
  });
});

describe("the hard rules", () => {
  it("shows a circle that fits and hides circles outside the member's life-stage track", async () => {
    const fits = await openCircle();
    const other = await openCircle({ track: "rising" });
    const m = await member();
    const shown = shownIds(await match(m.id));
    expect(shown).toContain(fits.circle);
    expect(shown).not.toContain(other.circle);
  });

  it("hides circles that meet when the member cannot, and treats no times chosen as any time", async () => {
    const wed = await openCircle({ slot: "weeknight-evening" });
    const sat = await openCircle({ slot: "saturday-morning" });
    const weeknights = await member({ times: ["weeknight-evening"] });
    expect(shownIds(await match(weeknights.id))).toEqual(expect.arrayContaining([wed.circle]));
    expect(shownIds(await match(weeknights.id))).not.toContain(sat.circle);
    const open = await member({ times: [] });
    expect(shownIds(await match(open.id))).toEqual(expect.arrayContaining([wed.circle, sat.circle]));
  });

  it("respects online and in-person, and keeps people abroad out of in-person circles", async () => {
    const online = await openCircle({ mode: "online", slot: "sunday-evening" });
    const inPerson = await openCircle({ mode: "in_person", slot: "sunday-evening" });
    const onlineOnly = await member({ mode: "online", times: ["sunday-evening"] });
    const inPersonOnly = await member({ mode: "in_person", times: ["sunday-evening"] });
    const either = await member({ mode: "either", times: ["sunday-evening"] });
    const abroad = await member({ mode: "either", zone: "abroad", times: ["sunday-evening"] });
    expect(shownIds(await match(onlineOnly.id))).toEqual(expect.arrayContaining([online.circle]));
    expect(shownIds(await match(onlineOnly.id))).not.toContain(inPerson.circle);
    expect(shownIds(await match(inPersonOnly.id))).toContain(inPerson.circle);
    expect(shownIds(await match(inPersonOnly.id))).not.toContain(online.circle);
    expect(shownIds(await match(either.id))).toEqual(expect.arrayContaining([online.circle, inPerson.circle]));
    expect(shownIds(await match(abroad.id))).toContain(online.circle);
    expect(shownIds(await match(abroad.id))).not.toContain(inPerson.circle);
  });

  it("keeps women's and men's circles to the people they are for, and honours a wish for a mixed or same-gender circle", async () => {
    const women = await openCircle({ type: "women", slot: "saturday-morning" });
    const men = await openCircle({ type: "men", slot: "saturday-morning" });
    const mixed = await openCircle({ type: "mixed", slot: "saturday-morning" });
    const t = { times: ["saturday-morning"] };
    const woman = await member({ ...t, gender: "female", mix: "same_gender" });
    const womanAnyone = await member({ ...t, gender: "female", mix: "no_preference" });
    const womanMixed = await member({ ...t, gender: "female", mix: "mixed" });
    const man = await member({ ...t, gender: "male", mix: "same_gender" });
    const undisclosed = await member({ ...t, gender: "undisclosed", mix: "same_gender" });
    expect(shownIds(await match(woman.id))).toContain(women.circle);
    expect(shownIds(await match(woman.id))).not.toContain(men.circle);
    expect(shownIds(await match(woman.id))).not.toContain(mixed.circle);
    expect(shownIds(await match(womanAnyone.id))).toEqual(expect.arrayContaining([women.circle, mixed.circle]));
    expect(shownIds(await match(womanAnyone.id))).not.toContain(men.circle);
    expect(shownIds(await match(womanMixed.id))).toContain(mixed.circle);
    expect(shownIds(await match(womanMixed.id))).not.toContain(women.circle);
    expect(shownIds(await match(man.id))).toContain(men.circle);
    expect(shownIds(await match(man.id))).not.toContain(women.circle);
    expect(shownIds(await match(undisclosed.id))).toHaveLength(0);
  });

  it("hides circles that are not approved, whose leader is not certified, or that are full", async () => {
    const draft = await openCircle({ status: "submitted", slot: "sunday-afternoon" });
    const uncertified = await openCircle({ certified: false, slot: "sunday-afternoon" });
    const full = await openCircle({ capacity: 4, slot: "sunday-afternoon" });
    const good = await openCircle({ slot: "sunday-afternoon" });
    for (let i = 0; i < 4; i++) {
      const filler = await member({ times: ["sunday-afternoon"], faith: "established", social: i % 2 ? 1 : -1 });
      await db.admin.query(
        `insert into public.circle_members (circle_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 'x', '{}', current_date + 20)`,
        [full.circle, filler.id, seasonId],
      );
    }
    const m = await member({ times: ["sunday-afternoon"], faith: "established" });
    const shown = shownIds(await match(m.id));
    expect(shown).toContain(good.circle);
    for (const hidden of [draft.circle, uncertified.circle, full.circle]) expect(shown).not.toContain(hidden);
  });

  it("never offers a leader their own circle", async () => {
    const mine = await openCircle({ slot: "saturday-morning" });
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, faith_journey, season_goal_id, goal_baseline, meeting_mode, meeting_times)
       values ($1, $2, $3, 'female', 'mixed', 'mainland', $4, 'leading', $5, 3, 'either', '{}')`,
      [mine.leader.id, seasonId, id("age_ranges", "33-40"), id("tribes", "professionals"), id("season_goals", "step-into-a-leadership-role")],
    );
    expect(shownIds(await match(mine.leader.id))).not.toContain(mine.circle);
  });
});

describe("the score", () => {
  it("gives a perfect fit the weights in the model, and each circle its own percentage", async () => {
    const best = await openCircle({ slot: "sunday-evening", style: "structure" });
    const m = await member({ times: ["sunday-evening"], zone: "mainland", structure: 1, mode: "in_person" });
    const result = await match(m.id);
    const top = result.circles.find((c: { circle: { id: string } }) => c.circle.id === best.circle);
    // goal 30 + stage 20 + tribe 15 + place 10 + rhythm 10 + style (0.5 x 0.6 balance + 0.5 x 1 affinity = 0.8) 8 + faith (empty circle 0.8) 4
    expect(top.degree).toBe(97);
    expect(top.label).toBe("excellent");
    expect(top.reasons).toHaveLength(3);
    expect(top.reasons).toEqual(expect.arrayContaining(["goal_same", "stage_same", "tribe_same"]));
  });

  it("scores a close goal in the same family at 0.6, and shows the top three in order", async () => {
    const a = await openCircle({ slot: "saturday-morning", goal: "step-into-a-leadership-role" });
    const b = await openCircle({ slot: "saturday-morning", goal: "change-career-direction-with-confidence" });
    const c = await openCircle({ slot: "saturday-morning", goal: "step-into-a-leadership-role", zone: "island-lekki" });
    const d = await openCircle({ slot: "saturday-morning", goal: "step-into-a-leadership-role", zone: "island-lekki" });
    const m = await member({ times: ["saturday-morning"], zone: "mainland" });
    const r = await match(m.id);
    expect(r.circles.length).toBe(3);
    const degrees = r.circles.map((x: { degree: number }) => x.degree);
    expect([...degrees].sort((x, y) => y - x)).toEqual(degrees);
    expect(r.circles.map((x: { rank: number }) => x.rank)).toEqual([1, 2, 3]);
    const stored = (await db.admin.query(
      `select circle_id, degree, components from public.match_recommendations where run_id = (select id from public.match_runs where person_id = $1 order by ran_at desc limit 1) order by rank`,
      [m.id],
    )).rows;
    expect(stored).toHaveLength(3);
    for (const row of stored) {
      expect(Object.keys(row.components).sort()).toEqual(["faith", "goal", "place", "rhythm", "stage", "style", "tribe"]);
    }
    expect(r.circles[0].circle.id).toBe(a.circle);
    expect([b.circle, c.circle, d.circle]).toEqual(expect.arrayContaining([r.circles[1].circle.id]));
  });

  it("does not show a circle that fits under 60%, and records the gap", async () => {
    const far = await openCircle({ slot: "sunday-evening", goal: "strengthen-our-marriage", tribe: "marriage-relationships", zone: "island-lekki" });
    const m = await member({ times: ["sunday-evening"], zone: "iganmu-surulere", mode: "in_person" });
    const r = await match(m.id);
    expect(shownIds(r)).not.toContain(far.circle);
    const { rows } = await db.admin.query("select shown, circle_kind, wants_starter from public.match_demand where person_id = $1", [m.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].shown).toBeLessThan(3);
    expect(r.short).toBe(true);
  });

  it("labels 85 and up excellent, 70 to 84 strong, 60 to 69 good", async () => {
    const { rows } = await db.admin.query("select public.degree_label(85) a, public.degree_label(84) b, public.degree_label(70) c, public.degree_label(69) d, public.degree_label(60) e, public.degree_label(59) f");
    expect(rows[0]).toEqual({ a: "excellent", b: "strong", c: "strong", d: "good", e: "good", f: "low" });
  });
});

describe("circle health", () => {
  async function join(circleId: string, memberId: string) {
    await db.admin.query(
      `insert into public.circle_members (circle_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 'x', '{}', current_date + 20)`,
      [circleId, memberId, seasonId],
    );
  }

  it("keeps heavy-support members to two per circle", async () => {
    const c = await openCircle({ slot: "sunday-afternoon", capacity: 12 });
    const t = { times: ["sunday-afternoon"] };
    await join(c.circle, (await member({ ...t, support: "Needs weekly check-ins", faith: "established" })).id);
    await join(c.circle, (await member({ ...t, support: "Grieving", faith: "established" })).id);
    const third = await member({ ...t, support: "Anxious about work" });
    const light = await member({ ...t });
    expect(shownIds(await match(third.id))).not.toContain(c.circle);
    expect(shownIds(await match(light.id))).toContain(c.circle);
  });

  it("keeps room for two established believers, quiet and lively people", async () => {
    const c = await openCircle({ slot: "saturday-morning", capacity: 4 });
    const t = { times: ["saturday-morning"] };
    await join(c.circle, (await member({ ...t, faith: "new", social: 1 })).id);
    await join(c.circle, (await member({ ...t, faith: "growing", social: 1 })).id);
    // Two seats left. A third newer believer would leave only one seat for two established believers.
    const newer = await member({ ...t, faith: "exploring", social: -1 });
    const established = await member({ ...t, faith: "established", social: -1 });
    expect(shownIds(await match(newer.id))).not.toContain(c.circle);
    expect(shownIds(await match(established.id))).toContain(c.circle);
  });
});

describe("the run", () => {
  it("is reused for ten minutes and made fresh on request", async () => {
    await openCircle({ slot: "sunday-evening" });
    const m = await member({ times: ["sunday-evening"] });
    await match(m.id);
    await match(m.id, false);
    expect((await db.admin.query("select count(*)::int n from public.match_runs where person_id = $1", [m.id])).rows[0].n).toBe(1);
    await match(m.id, true);
    expect((await db.admin.query("select count(*)::int n from public.match_runs where person_id = $1", [m.id])).rows[0].n).toBe(2);
    await db.admin.query("update public.match_runs set ran_at = now() - interval '11 minutes' where person_id = $1", [m.id]);
    await match(m.id, false);
    expect((await db.admin.query("select count(*)::int n from public.match_runs where person_id = $1", [m.id])).rows[0].n).toBe(3);
  });

  it("needs a finished form, and a person sees only their own results", async () => {
    const nobody = await db.createUser();
    await expectCode(db.asUser(nobody.id, (q) => q("select public.match_me(false)")), "22023");
    const a = await member();
    const b = await member();
    await match(a.id);
    const mine = (await db.asUser(b.id, (q) => q("select public.my_match() as r"))).rows[0].r;
    expect(mine.ran).toBe(false);
    await expectCode(db.asUser(a.id, (q) => q("select * from public.match_runs")), "42501");
    await expectCode(db.asUser(a.id, (q) => q("select * from public.match_recommendations")), "42501");
    await expectCode(db.asUser(a.id, (q) => q("select * from public.circle_members")), "42501");
    await expectCode(db.asAnon((q) => q("select public.match_me(false)")), "42501");
  });

  it("clears the gap once three good circles exist, and lets the member ask for a Starter Circle while there is one", async () => {
    const m = await member({ times: ["sunday-afternoon"], zone: "mainland" });
    await match(m.id);
    expect((await db.admin.query("select 1 from public.match_demand where person_id = $1", [m.id])).rowCount).toBe(1);
    await db.asUser(m.id, (q) => q("select public.join_starter_list(true)"));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.on_starter_list).toBe(true);
    for (let i = 0; i < 3; i++) await openCircle({ slot: "sunday-afternoon" });
    const r = await match(m.id);
    expect(r.circles.length).toBe(3);
    expect((await db.admin.query("select 1 from public.match_demand where person_id = $1", [m.id])).rowCount).toBe(0);
    const nobody = await member();
    await expectCode(db.asUser(nobody.id, (q) => q("select public.join_starter_list(true)")), "22023");
  });
});

describe("choosing a circle", () => {
  it("needs the agreement, and a circle that was shown", async () => {
    const c = await openCircle({ slot: "sunday-evening" });
    const stranger = await openCircle({ slot: "saturday-morning" });
    const m = await member({ times: ["sunday-evening"] });
    await match(m.id);
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_circle($1, false, 'cov-1')", [c.circle])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_circle($1, null, 'cov-1')", [c.circle])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_circle($1, true, 'cov-1')", [stranger.circle])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_circle($1, true, 'bad version!')", [c.circle])), "22023");
  });

  it("locks the seat and keeps the rank, the score and the covenant as it stood", async () => {
    const c = await openCircle({ slot: "sunday-evening" });
    const m = await member({ times: ["sunday-evening"] });
    const placed = await place(m.id, c.circle);
    expect(placed.placement.circle.id).toBe(c.circle);
    expect(placed.placement.rank).toBeGreaterThanOrEqual(1);
    expect(placed.placement.covenant.life).toBe("Take one step a week.");
    const { rows } = await db.admin.query("select chosen_rank, degree, model_version, agreement_version, first_meeting_by, run_id from public.circle_members where person_id = $1", [m.id]);
    expect(rows[0].model_version).toBe("v1");
    expect(rows[0].agreement_version).toBe("cov-1");
    expect(rows[0].run_id).toBeTruthy();
    expect(new Date(rows[0].first_meeting_by).getTime()).toBeGreaterThan(Date.now());
    expect((await db.admin.query("select count(*)::int n from public.match_recommendations where person_id = $1 and chosen", [m.id])).rows[0].n).toBe(1);
    // the covenant keeps its wording even if the card later changes
    await db.admin.query("update public.circles set loving_life = 'Something else.' where id = $1", [c.circle]);
    const again = (await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r;
    expect(again.placement.covenant.life).toBe("Take one step a week.");
    // placed members are not matched again, and cannot join a second circle
    expect((await match(m.id)).placement.circle.id).toBe(c.circle);
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_circle($1, true, 'cov-1')", [c.circle])), "22023");
  });

  it("gives the last seat to one person only, even when two choose at the same moment", async () => {
    const c = await openCircle({ slot: "saturday-morning", capacity: 5 });
    const t = { times: ["saturday-morning"] };
    for (let i = 0; i < 3; i++) await place((await member({ ...t, faith: "established", social: i % 2 ? 1 : -1 })).id, c.circle);
    const one = await member({ ...t, faith: "established", social: -1 });
    const two = await member({ ...t, faith: "established", social: 1 });
    await match(one.id);
    await match(two.id);
    // Two members, both shown the circle with one seat after theirs. Take seats to leave exactly one.
    await place((await member({ ...t, faith: "established", social: 1 })).id, c.circle);
    const left = (await db.admin.query("select 5 - count(*)::int as n from public.circle_members where circle_id = $1 and status = 'active'", [c.circle])).rows[0].n;
    expect(left).toBe(1);

    const port = inject("pgPort");
    const open = async (user: string) => {
      const client = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: db.name });
      await client.connect();
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
      return client;
    };
    const a = await open(one.id);
    const b = await open(two.id);
    try {
      await a.query("select public.choose_circle($1, true, 'cov-1')", [c.circle]);
      const blocked = b.query("select public.choose_circle($1, true, 'cov-1')", [c.circle]).then(() => "placed", (e: { code?: string }) => e.code);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await blocked).toBe("22023");
    } finally {
      await a.end();
      await b.query("rollback").catch(() => {});
      await b.end();
    }
    expect((await db.admin.query("select count(*)::int n from public.circle_members where circle_id = $1 and status = 'active'", [c.circle])).rows[0].n).toBe(5);
  });

  it("lets a member change their mind until the season starts", async () => {
    const c = await openCircle({ slot: "sunday-evening" });
    const m = await member({ times: ["sunday-evening"] });
    await place(m.id, c.circle);
    const released = (await db.asUser(m.id, (q) => q("select public.release_my_seat('Work travel')  as r"))).rows[0].r;
    expect(released.placement).toBeNull();
    expect((await db.admin.query("select count(*)::int n from public.match_recommendations where person_id = $1 and chosen", [m.id])).rows[0].n).toBe(0);
    const again = await place(m.id, c.circle);
    expect(again.placement.circle.id).toBe(c.circle);
    await db.admin.query("update public.seasons set starts_on = current_date - 1 where id = $1", [seasonId]);
    try {
      await expectCode(db.asUser(m.id, (q) => q("select public.release_my_seat(null)")), "22023");
    } finally {
      await db.admin.query("update public.seasons set starts_on = current_date + 120 where id = $1", [seasonId]);
    }
    await expectCode(db.asUser((await member()).id, (q) => q("select public.release_my_seat(null)")), "22023");
  });

  it("will not take a published card back while members are in it", async () => {
    const c = await openCircle({ slot: "sunday-evening" });
    const pastor = await db.createUser();
    await db.grant(pastor.id, "pastor");
    const m = await member({ times: ["sunday-evening"] });
    await place(m.id, c.circle);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decide_circle_card($1, 'changes', 'Please rewrite your story')", [c.circle])), "22023");
    const empty = await openCircle({ slot: "sunday-evening" });
    await db.asUser(pastor.id, (q) => q("select public.decide_circle_card($1, 'changes', 'Please rewrite your story')", [empty.circle]));
    expect((await db.admin.query("select status from public.circles where id = $1", [empty.circle])).rows[0].status).toBe("changes_requested");
  });
});

describe("onboarding", () => {
  it("shows the roster to the people who run the circle, with a number only if the member shared one", async () => {
    const c = await openCircle({ slot: "saturday-morning" });
    const shared = await member({ times: ["saturday-morning"], whatsapp: "+2348031234567", faith: "established" });
    const quiet = await member({ times: ["saturday-morning"], whatsapp: null, faith: "established" });
    await place(shared.id, c.circle);
    await place(quiet.id, c.circle);
    const roster = (await db.asUser(c.leader.id, (q) => q("select public.circle_roster($1) as r", [c.circle]))).rows[0].r;
    expect(roster.members).toHaveLength(2);
    expect(roster.members.find((x: { person_id: string }) => x.person_id === shared.id).whatsapp).toBe("+2348031234567");
    expect(roster.members.find((x: { person_id: string }) => x.person_id === quiet.id).whatsapp).toBeNull();
    expect(roster.circle.can_edit).toBe(true);
    const coach = await db.createUser();
    await db.grant(coach.id, "coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.circle_roster($1)", [c.circle])), "42501");
    await db.admin.query("update public.circles set coach_id = $2 where id = $1", [c.circle, coach.id]);
    expect((await db.asUser(coach.id, (q) => q("select public.circle_roster($1) as r", [c.circle]))).rows[0].r.circle.can_edit).toBe(false);
    await expectCode(db.asUser(shared.id, (q) => q("select public.circle_roster($1)", [c.circle])), "42501");
  });

  it("lets the leader set the group link and first meeting, and mark who they have called", async () => {
    const c = await openCircle({ slot: "saturday-morning" });
    const m = await member({ times: ["saturday-morning"] });
    await place(m.id, c.circle);
    const day = new Date(Date.now() + 130 * 86400000).toISOString().slice(0, 10);
    await db.admin.query("update public.seasons set starts_on = $1 where id = $2", [day, seasonId]);
    const first = new Date(Date.now() + 131 * 86400000).toISOString().slice(0, 10);
    await db.asUser(c.leader.id, (q) => q("select public.save_circle_onboarding($1, 'https://chat.whatsapp.com/AbCdEf123456', $2)", [c.circle, first]));
    const seen = (await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement;
    expect(seen.group_url).toBe("https://chat.whatsapp.com/AbCdEf123456");
    expect(seen.first_meeting_on).toBe(first);
    expect(seen.called).toBe(false);
    await db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.circle, m.id]));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement.called).toBe(true);
    await db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, $2, false)", [c.circle, m.id]));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement.called).toBe(false);
  });

  it("refuses a link that is not a WhatsApp invite, a date in the past, and people who do not lead the circle", async () => {
    const c = await openCircle({ slot: "saturday-morning" });
    const m = await member({ times: ["saturday-morning"] });
    await place(m.id, c.circle);
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.save_circle_onboarding($1, 'https://example.com/join', null)", [c.circle])), "22023");
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.save_circle_onboarding($1, null, current_date - 1)", [c.circle])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.save_circle_onboarding($1, null, null)", [c.circle])), "42501");
    await expectCode(db.asUser(m.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.circle, m.id])), "42501");
    const other = await openCircle({ slot: "saturday-morning" });
    await expectCode(db.asUser(other.leader.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.circle, m.id])), "42501");
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, gen_random_uuid(), true)", [c.circle])), "P0002");
  });

  it("shows a leader's first name only, and never the leader's own answers", async () => {
    const c = await openCircle({ slot: "sunday-evening", style: "doing" });
    const m = await member({ times: ["sunday-evening"] });
    const r = await match(m.id);
    const card = r.circles.find((x: { circle: { id: string } }) => x.circle.id === c.circle).circle;
    expect(card.leader_first_name).toBe("Tola");
    expect(JSON.stringify(card)).not.toMatch(/Leader|doing|leadBest|@/);
  });
});

describe("the office", () => {
  it("reports totals to the office only, with where members are missing circles", async () => {
    const office = await db.createUser();
    await db.grant(office.id, "director");
    const open = await openCircle({ slot: "sunday-evening" });
    await place((await member({ times: ["sunday-evening"] })).id, open.circle);
    const stats = (await db.asUser(office.id, (q) => q("select public.match_stats() as r"))).rows[0].r;
    expect(stats.profiled).toBeGreaterThan(0);
    expect(stats.circles_open).toBeGreaterThan(0);
    expect(stats.placed).toBeGreaterThan(0);
    expect(Array.isArray(stats.gaps)).toBe(true);
    const m = await member();
    await expectCode(db.asUser(m.id, (q) => q("select public.match_stats()")), "42501");
    const coach = await db.createUser();
    await db.grant(coach.id, "coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.match_stats()")), "42501");
  });
});

describe("privacy", () => {
  it("erases the runs and the gap when matching consent is withdrawn", async () => {
    const m = await member({ times: ["sunday-afternoon"], zone: "abroad" });
    await match(m.id);
    expect((await db.admin.query("select count(*)::int n from public.match_runs where person_id = $1", [m.id])).rows[0].n).toBe(1);
    await db.asUser(m.id, (q) => q("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', false, '2026-10-v1')", [m.id]));
    expect((await db.admin.query("select count(*)::int n from public.match_runs where person_id = $1", [m.id])).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.match_demand where person_id = $1", [m.id])).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.member_profiles where person_id = $1", [m.id])).rows[0].n).toBe(0);
  });
});
