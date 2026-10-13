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
    ["communities", "professionals"],
    ["communities", "business-entrepreneurship"],
    ["communities", "marriage-relationships"],
    ["season_goals", "step-into-a-leadership-role"],
    ["season_goals", "change-career-direction-with-confidence"],
    ["season_goals", "launch-or-formalise-a-business"],
    ["season_goals", "strengthen-our-marriage"],
    ["age_ranges", "33-40"],
    ["age_ranges", "18-25"],
    ["age_ranges", "51-60"],
  ] as const) {
    ids[`${table}:${slug}`] = (await db.admin.query(`select id from public.${table} where slug = $1`, [slug])).rows[0].id;
  }
});

afterAll(async () => {
  await db.close();
});

// Every test starts with no open tribes, so the tribes it creates are the only ones a member can be shown.
beforeEach(async () => {
  await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
});

const id = (table: string, slug: string) => ids[`${table}:${slug}`];

interface TribeOpts {
  slot?: "weeknight-evening" | "sunday-afternoon" | "sunday-evening" | "saturday-morning";
  mode?: "online" | "in_person";
  zone?: string;
  capacity?: number;
  type?: "mixed" | "women" | "men";
  goal?: string;
  community?: string;
  track?: string;
  style?: string;
  certified?: boolean;
  status?: string;
}

/** A published tribe with a certified leader. Leaves the leader's id so a test can act as them. */
async function openTribe(o: TribeOpts = {}) {
  const leader = await db.createUser();
  await db.grant(leader.id, "leader");
  await db.admin.query(`update public.people set full_name = $2, preferred_name = 'Tola' where id = $1`, [leader.id, `Tola Leader ${leader.id.slice(0, 4)}`]);
  await db.admin.query(
    `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at)
     values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())`,
    [leader.id, JSON.stringify({ calling: { track: "builders", community: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: o.style ?? "structure" } })],
  );
  if (o.certified !== false) await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
  const slot = o.slot ?? "weeknight-evening";
  const day = slot === "weeknight-evening" ? 3 : slot === "saturday-morning" ? 6 : 0;
  const time = slot === "weeknight-evening" ? "20:00" : slot === "saturday-morning" ? "09:00" : slot === "sunday-afternoon" ? "15:00" : "19:00";
  const { rows } = await db.admin.query(
    `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, '{}', $8, 'My story.', $9, $10, $11, $12, $13, 'Near the bridge', $14,
             'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [
      seasonId, leader.id, o.status ?? "approved", `Tribe ${leader.id.slice(0, 4)}`,
      id("tracks", o.track ?? "builders"), id("communities", o.community ?? "professionals"), id("season_goals", o.goal ?? "step-into-a-leadership-role"),
      o.type ?? "mixed", day, time, slot, o.mode ?? "in_person", o.zone ?? "mainland", o.capacity ?? 12,
    ],
  );
  return { leader, tribe: rows[0].id as string };
}

interface MemberOpts {
  age?: string;
  gender?: "female" | "male" | "undisclosed";
  mix?: "mixed" | "same_gender" | "no_preference";
  zone?: string;
  community?: string;
  goal?: string;
  faith?: string;
  mode?: "online" | "in_person" | "either";
  times?: string[];
  social?: number;
  structure?: number;
  support?: number;
  whatsapp?: string | null;
}

async function member(o: MemberOpts = {}) {
  const user = await db.createUser();
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times, style_social, style_structure, support_load, whatsapp, duration_seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 3, $10, $11, $12, $13, $14, $15, 250)`,
    [
      user.id, seasonId, id("age_ranges", o.age ?? "33-40"), o.gender ?? "female", o.mix ?? "mixed", o.zone ?? "mainland",
      id("communities", o.community ?? "professionals"), o.faith ?? "growing", id("season_goals", o.goal ?? "step-into-a-leadership-role"),
      o.mode ?? "either", o.times ?? ["weeknight-evening"], o.social ?? 0, o.structure ?? 0, o.support ?? 0, o.whatsapp ?? null,
    ],
  );
  return user;
}

const match = async (userId: string, refresh = true) => (await db.asUser(userId, (q) => q("select public.match_me($1) as r", [refresh]))).rows[0].r;
const shownIds = (m: { tribes: { tribe: { id: string } }[] }) => m.tribes.map((c) => c.tribe.id);

async function place(memberId: string, tribeId: string) {
  const m = await match(memberId);
  expect(shownIds(m)).toContain(tribeId);
  return (await db.asUser(memberId, (q) => q("select public.choose_tribe($1, true, 'cov-1') as r", [tribeId]))).rows[0].r;
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
    await expect(db.admin.query(`insert into public.match_models (version, weights, active) values ('v2', '{"goal":30,"stage":20,"community":15,"place":10,"style":10,"rhythm":10,"faith":5}', true)`)).rejects.toThrow();
    await expect(db.admin.query(`insert into public.match_models (version, weights) values ('bad', '{"goal":50,"stage":20,"community":15,"place":10,"style":10,"rhythm":10,"faith":5}')`)).rejects.toThrow();
  });
});

describe("the hard rules", () => {
  it("shows a tribe that fits and hides tribes outside the member's life-stage track", async () => {
    const fits = await openTribe();
    const other = await openTribe({ track: "rising" });
    const m = await member();
    const shown = shownIds(await match(m.id));
    expect(shown).toContain(fits.tribe);
    expect(shown).not.toContain(other.tribe);
  });

  it("hides tribes that meet when the member cannot, and treats no times chosen as any time", async () => {
    const wed = await openTribe({ slot: "weeknight-evening" });
    const sat = await openTribe({ slot: "saturday-morning" });
    const weeknights = await member({ times: ["weeknight-evening"] });
    expect(shownIds(await match(weeknights.id))).toEqual(expect.arrayContaining([wed.tribe]));
    expect(shownIds(await match(weeknights.id))).not.toContain(sat.tribe);
    const open = await member({ times: [] });
    expect(shownIds(await match(open.id))).toEqual(expect.arrayContaining([wed.tribe, sat.tribe]));
  });

  it("respects online and in-person, and keeps people abroad out of in-person tribes", async () => {
    const online = await openTribe({ mode: "online", slot: "sunday-evening" });
    const inPerson = await openTribe({ mode: "in_person", slot: "sunday-evening" });
    const onlineOnly = await member({ mode: "online", times: ["sunday-evening"] });
    const inPersonOnly = await member({ mode: "in_person", times: ["sunday-evening"] });
    const either = await member({ mode: "either", times: ["sunday-evening"] });
    const abroad = await member({ mode: "either", zone: "abroad", times: ["sunday-evening"] });
    expect(shownIds(await match(onlineOnly.id))).toEqual(expect.arrayContaining([online.tribe]));
    expect(shownIds(await match(onlineOnly.id))).not.toContain(inPerson.tribe);
    expect(shownIds(await match(inPersonOnly.id))).toContain(inPerson.tribe);
    expect(shownIds(await match(inPersonOnly.id))).not.toContain(online.tribe);
    expect(shownIds(await match(either.id))).toEqual(expect.arrayContaining([online.tribe, inPerson.tribe]));
    expect(shownIds(await match(abroad.id))).toContain(online.tribe);
    expect(shownIds(await match(abroad.id))).not.toContain(inPerson.tribe);
  });

  it("keeps women's and men's tribes to the people they are for, and honours a wish for a mixed or same-gender tribe", async () => {
    const women = await openTribe({ type: "women", slot: "saturday-morning" });
    const men = await openTribe({ type: "men", slot: "saturday-morning" });
    const mixed = await openTribe({ type: "mixed", slot: "saturday-morning" });
    const t = { times: ["saturday-morning"] };
    const woman = await member({ ...t, gender: "female", mix: "same_gender" });
    const womanAnyone = await member({ ...t, gender: "female", mix: "no_preference" });
    const womanMixed = await member({ ...t, gender: "female", mix: "mixed" });
    const man = await member({ ...t, gender: "male", mix: "same_gender" });
    const undisclosed = await member({ ...t, gender: "undisclosed", mix: "same_gender" });
    expect(shownIds(await match(woman.id))).toContain(women.tribe);
    expect(shownIds(await match(woman.id))).not.toContain(men.tribe);
    expect(shownIds(await match(woman.id))).not.toContain(mixed.tribe);
    expect(shownIds(await match(womanAnyone.id))).toEqual(expect.arrayContaining([women.tribe, mixed.tribe]));
    expect(shownIds(await match(womanAnyone.id))).not.toContain(men.tribe);
    expect(shownIds(await match(womanMixed.id))).toContain(mixed.tribe);
    expect(shownIds(await match(womanMixed.id))).not.toContain(women.tribe);
    expect(shownIds(await match(man.id))).toContain(men.tribe);
    expect(shownIds(await match(man.id))).not.toContain(women.tribe);
    expect(shownIds(await match(undisclosed.id))).toHaveLength(0);
  });

  it("hides tribes that are not approved, whose leader is not certified, or that are full", async () => {
    const draft = await openTribe({ status: "submitted", slot: "sunday-afternoon" });
    const uncertified = await openTribe({ certified: false, slot: "sunday-afternoon" });
    const full = await openTribe({ capacity: 4, slot: "sunday-afternoon" });
    const good = await openTribe({ slot: "sunday-afternoon" });
    for (let i = 0; i < 4; i++) {
      const filler = await member({ times: ["sunday-afternoon"], faith: "established", social: i % 2 ? 1 : -1 });
      await db.admin.query(
        `insert into public.tribe_members (tribe_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 'x', '{}', current_date + 20)`,
        [full.tribe, filler.id, seasonId],
      );
    }
    const m = await member({ times: ["sunday-afternoon"], faith: "established" });
    const shown = shownIds(await match(m.id));
    expect(shown).toContain(good.tribe);
    for (const hidden of [draft.tribe, uncertified.tribe, full.tribe]) expect(shown).not.toContain(hidden);
  });

  it("never offers a leader their own tribe", async () => {
    const mine = await openTribe({ slot: "saturday-morning" });
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id, goal_baseline, meeting_mode, meeting_times)
       values ($1, $2, $3, 'female', 'mixed', 'mainland', $4, 'leading', $5, 3, 'either', '{}')`,
      [mine.leader.id, seasonId, id("age_ranges", "33-40"), id("communities", "professionals"), id("season_goals", "step-into-a-leadership-role")],
    );
    expect(shownIds(await match(mine.leader.id))).not.toContain(mine.tribe);
  });
});

describe("the score", () => {
  it("gives a perfect fit the weights in the model, and each tribe its own percentage", async () => {
    const best = await openTribe({ slot: "sunday-evening", style: "structure" });
    const m = await member({ times: ["sunday-evening"], zone: "mainland", structure: 1, mode: "in_person" });
    const result = await match(m.id);
    const top = result.tribes.find((c: { tribe: { id: string } }) => c.tribe.id === best.tribe);
    // goal 30 + stage 20 + community 15 + place 10 + rhythm 10 + style (0.5 x 0.6 balance + 0.5 x 1 affinity = 0.8) 8 + faith (empty tribe 0.8) 4
    expect(top.degree).toBe(97);
    expect(top.label).toBe("excellent");
    expect(top.reasons).toHaveLength(3);
    expect(top.reasons).toEqual(expect.arrayContaining(["goal_same", "stage_same", "community_same"]));
  });

  it("scores a close goal in the same family at 0.6, and shows the top three in order", async () => {
    const a = await openTribe({ slot: "saturday-morning", goal: "step-into-a-leadership-role" });
    const b = await openTribe({ slot: "saturday-morning", goal: "change-career-direction-with-confidence" });
    const c = await openTribe({ slot: "saturday-morning", goal: "step-into-a-leadership-role", zone: "island-lekki" });
    const d = await openTribe({ slot: "saturday-morning", goal: "step-into-a-leadership-role", zone: "island-lekki" });
    const m = await member({ times: ["saturday-morning"], zone: "mainland" });
    const r = await match(m.id);
    expect(r.tribes.length).toBe(3);
    const degrees = r.tribes.map((x: { degree: number }) => x.degree);
    expect([...degrees].sort((x, y) => y - x)).toEqual(degrees);
    expect(r.tribes.map((x: { rank: number }) => x.rank)).toEqual([1, 2, 3]);
    const stored = (await db.admin.query(
      `select tribe_id, degree, components from public.match_recommendations where run_id = (select id from public.match_runs where person_id = $1 order by ran_at desc limit 1) order by rank`,
      [m.id],
    )).rows;
    expect(stored).toHaveLength(3);
    for (const row of stored) {
      expect(Object.keys(row.components).sort()).toEqual(["community", "faith", "goal", "place", "rhythm", "stage", "style"]);
    }
    expect(r.tribes[0].tribe.id).toBe(a.tribe);
    expect([b.tribe, c.tribe, d.tribe]).toEqual(expect.arrayContaining([r.tribes[1].tribe.id]));
  });

  it("does not show a tribe that fits under 60%, and records the gap", async () => {
    const far = await openTribe({ slot: "sunday-evening", goal: "strengthen-our-marriage", community: "marriage-relationships", zone: "island-lekki" });
    const m = await member({ times: ["sunday-evening"], zone: "iganmu-surulere", mode: "in_person" });
    const r = await match(m.id);
    expect(shownIds(r)).not.toContain(far.tribe);
    const { rows } = await db.admin.query("select shown, tribe_kind, wants_starter from public.match_demand where person_id = $1", [m.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].shown).toBeLessThan(3);
    expect(r.short).toBe(true);
  });

  it("labels 85 and up excellent, 70 to 84 strong, 60 to 69 good", async () => {
    const { rows } = await db.admin.query("select public.degree_label(85) a, public.degree_label(84) b, public.degree_label(70) c, public.degree_label(69) d, public.degree_label(60) e, public.degree_label(59) f");
    expect(rows[0]).toEqual({ a: "excellent", b: "strong", c: "strong", d: "good", e: "good", f: "low" });
  });
});

describe("tribe health", () => {
  async function join(tribeId: string, memberId: string) {
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 'x', '{}', current_date + 20)`,
      [tribeId, memberId, seasonId],
    );
  }

  it("keeps heavy-support members to two per tribe", async () => {
    const c = await openTribe({ slot: "sunday-afternoon", capacity: 12 });
    const t = { times: ["sunday-afternoon"] };
    await join(c.tribe, (await member({ ...t, support: 2, faith: "established" })).id);
    await join(c.tribe, (await member({ ...t, support: 2, faith: "established" })).id);
    const third = await member({ ...t, support: 2 });
    const light = await member({ ...t });
    expect(shownIds(await match(third.id))).not.toContain(c.tribe);
    expect(shownIds(await match(light.id))).toContain(c.tribe);
  });

  it("keeps room for two established believers, quiet and lively people", async () => {
    const c = await openTribe({ slot: "saturday-morning", capacity: 4 });
    const t = { times: ["saturday-morning"] };
    await join(c.tribe, (await member({ ...t, faith: "new", social: 1 })).id);
    await join(c.tribe, (await member({ ...t, faith: "growing", social: 1 })).id);
    // Two seats left. A third newer believer would leave only one seat for two established believers.
    const newer = await member({ ...t, faith: "exploring", social: -1 });
    const established = await member({ ...t, faith: "established", social: -1 });
    expect(shownIds(await match(newer.id))).not.toContain(c.tribe);
    expect(shownIds(await match(established.id))).toContain(c.tribe);
  });
});

describe("the run", () => {
  it("is reused for ten minutes and made fresh on request", async () => {
    await openTribe({ slot: "sunday-evening" });
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
    await expectCode(db.asUser(a.id, (q) => q("select * from public.tribe_members")), "42501");
    await expectCode(db.asAnon((q) => q("select public.match_me(false)")), "42501");
  });

  it("clears the gap once three good tribes exist, and lets the member ask for a Starter Tribe while there is one", async () => {
    const m = await member({ times: ["sunday-afternoon"], zone: "mainland" });
    await match(m.id);
    expect((await db.admin.query("select 1 from public.match_demand where person_id = $1", [m.id])).rowCount).toBe(1);
    await db.asUser(m.id, (q) => q("select public.join_starter_list(true)"));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.on_starter_list).toBe(true);
    for (let i = 0; i < 3; i++) await openTribe({ slot: "sunday-afternoon" });
    const r = await match(m.id);
    expect(r.tribes.length).toBe(3);
    expect((await db.admin.query("select 1 from public.match_demand where person_id = $1", [m.id])).rowCount).toBe(0);
    const nobody = await member();
    await expectCode(db.asUser(nobody.id, (q) => q("select public.join_starter_list(true)")), "22023");
  });
});

describe("choosing a tribe", () => {
  it("needs the agreement, and a tribe that was shown", async () => {
    const c = await openTribe({ slot: "sunday-evening" });
    const stranger = await openTribe({ slot: "saturday-morning" });
    const m = await member({ times: ["sunday-evening"] });
    await match(m.id);
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_tribe($1, false, 'cov-1')", [c.tribe])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_tribe($1, null, 'cov-1')", [c.tribe])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_tribe($1, true, 'cov-1')", [stranger.tribe])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_tribe($1, true, 'bad version!')", [c.tribe])), "22023");
  });

  it("locks the seat and keeps the rank, the score and the covenant as it stood", async () => {
    const c = await openTribe({ slot: "sunday-evening" });
    const m = await member({ times: ["sunday-evening"] });
    const placed = await place(m.id, c.tribe);
    expect(placed.placement.tribe.id).toBe(c.tribe);
    expect(placed.placement.rank).toBeGreaterThanOrEqual(1);
    expect(placed.placement.covenant.life).toBe("Take one step a week.");
    const { rows } = await db.admin.query("select chosen_rank, degree, model_version, agreement_version, first_meeting_by, run_id from public.tribe_members where person_id = $1", [m.id]);
    expect(rows[0].model_version).toBe("v1");
    expect(rows[0].agreement_version).toBe("cov-1");
    expect(rows[0].run_id).toBeTruthy();
    expect(new Date(rows[0].first_meeting_by).getTime()).toBeGreaterThan(Date.now());
    expect((await db.admin.query("select count(*)::int n from public.match_recommendations where person_id = $1 and chosen", [m.id])).rows[0].n).toBe(1);
    // the covenant keeps its wording even if the card later changes
    await db.admin.query("update public.tribes set loving_life = 'Something else.' where id = $1", [c.tribe]);
    const again = (await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r;
    expect(again.placement.covenant.life).toBe("Take one step a week.");
    // placed members are not matched again, and cannot join a second tribe
    expect((await match(m.id)).placement.tribe.id).toBe(c.tribe);
    await expectCode(db.asUser(m.id, (q) => q("select public.choose_tribe($1, true, 'cov-1')", [c.tribe])), "22023");
  });

  it("gives the last seat to one person only, even when two choose at the same moment", async () => {
    const c = await openTribe({ slot: "saturday-morning", capacity: 5 });
    const t = { times: ["saturday-morning"] };
    for (let i = 0; i < 3; i++) await place((await member({ ...t, faith: "established", social: i % 2 ? 1 : -1 })).id, c.tribe);
    const one = await member({ ...t, faith: "established", social: -1 });
    const two = await member({ ...t, faith: "established", social: 1 });
    await match(one.id);
    await match(two.id);
    // Two members, both shown the tribe with one seat after theirs. Take seats to leave exactly one.
    await place((await member({ ...t, faith: "established", social: 1 })).id, c.tribe);
    const left = (await db.admin.query("select 5 - count(*)::int as n from public.tribe_members where tribe_id = $1 and status = 'active'", [c.tribe])).rows[0].n;
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
      await a.query("select public.choose_tribe($1, true, 'cov-1')", [c.tribe]);
      const blocked = b.query("select public.choose_tribe($1, true, 'cov-1')", [c.tribe]).then(() => "placed", (e: { code?: string }) => e.code);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect(await blocked).toBe("22023");
    } finally {
      await a.end();
      await b.query("rollback").catch(() => {});
      await b.end();
    }
    expect((await db.admin.query("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [c.tribe])).rows[0].n).toBe(5);
  });

  it("lets a member change their mind until the season starts", async () => {
    const c = await openTribe({ slot: "sunday-evening" });
    const m = await member({ times: ["sunday-evening"] });
    await place(m.id, c.tribe);
    const released = (await db.asUser(m.id, (q) => q("select public.release_my_seat('Work travel')  as r"))).rows[0].r;
    expect(released.placement).toBeNull();
    expect((await db.admin.query("select count(*)::int n from public.match_recommendations where person_id = $1 and chosen", [m.id])).rows[0].n).toBe(0);
    const again = await place(m.id, c.tribe);
    expect(again.placement.tribe.id).toBe(c.tribe);
    await db.admin.query("update public.seasons set starts_on = current_date - 1 where id = $1", [seasonId]);
    try {
      await expectCode(db.asUser(m.id, (q) => q("select public.release_my_seat(null)")), "22023");
    } finally {
      await db.admin.query("update public.seasons set starts_on = current_date + 120 where id = $1", [seasonId]);
    }
    await expectCode(db.asUser((await member()).id, (q) => q("select public.release_my_seat(null)")), "22023");
  });

  it("will not take a published card back while members are in it", async () => {
    const c = await openTribe({ slot: "sunday-evening" });
    const pastor = await db.createUser();
    await db.grant(pastor.id, "pastor");
    const m = await member({ times: ["sunday-evening"] });
    await place(m.id, c.tribe);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'changes', 'Please rewrite your story')", [c.tribe])), "22023");
    const empty = await openTribe({ slot: "sunday-evening" });
    await db.asUser(pastor.id, (q) => q("select public.decide_tribe_card($1, 'changes', 'Please rewrite your story')", [empty.tribe]));
    expect((await db.admin.query("select status from public.tribes where id = $1", [empty.tribe])).rows[0].status).toBe("changes_requested");
  });
});

describe("onboarding", () => {
  it("shows the roster to the people who run the tribe, with a number only if the member shared one", async () => {
    const c = await openTribe({ slot: "saturday-morning" });
    const shared = await member({ times: ["saturday-morning"], whatsapp: "+2348031234567", faith: "established" });
    const quiet = await member({ times: ["saturday-morning"], whatsapp: null, faith: "established" });
    await place(shared.id, c.tribe);
    await place(quiet.id, c.tribe);
    const roster = (await db.asUser(c.leader.id, (q) => q("select public.tribe_roster($1) as r", [c.tribe]))).rows[0].r;
    expect(roster.members).toHaveLength(2);
    expect(roster.members.find((x: { person_id: string }) => x.person_id === shared.id).whatsapp).toBe("+2348031234567");
    expect(roster.members.find((x: { person_id: string }) => x.person_id === quiet.id).whatsapp).toBeNull();
    expect(roster.tribe.can_edit).toBe(true);
    const coach = await db.createUser();
    await db.grant(coach.id, "coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.tribe_roster($1)", [c.tribe])), "42501");
    await db.admin.query("update public.tribes set coach_id = $2 where id = $1", [c.tribe, coach.id]);
    expect((await db.asUser(coach.id, (q) => q("select public.tribe_roster($1) as r", [c.tribe]))).rows[0].r.tribe.can_edit).toBe(false);
    await expectCode(db.asUser(shared.id, (q) => q("select public.tribe_roster($1)", [c.tribe])), "42501");
  });

  it("lets the leader set the group link and first meeting, and mark who they have called", async () => {
    const c = await openTribe({ slot: "saturday-morning" });
    const m = await member({ times: ["saturday-morning"] });
    await place(m.id, c.tribe);
    const day = new Date(Date.now() + 130 * 86400000).toISOString().slice(0, 10);
    await db.admin.query("update public.seasons set starts_on = $1 where id = $2", [day, seasonId]);
    const first = new Date(Date.now() + 131 * 86400000).toISOString().slice(0, 10);
    await db.asUser(c.leader.id, (q) => q("select public.save_tribe_onboarding($1, 'https://chat.whatsapp.com/AbCdEf123456', $2)", [c.tribe, first]));
    const seen = (await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement;
    expect(seen.group_url).toBe("https://chat.whatsapp.com/AbCdEf123456");
    expect(seen.first_meeting_on).toBe(first);
    expect(seen.called).toBe(false);
    await db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.tribe, m.id]));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement.called).toBe(true);
    await db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, $2, false)", [c.tribe, m.id]));
    expect((await db.asUser(m.id, (q) => q("select public.my_match() as r"))).rows[0].r.placement.called).toBe(false);
  });

  it("refuses a link that is not a WhatsApp invite, a date in the past, and people who do not lead the tribe", async () => {
    const c = await openTribe({ slot: "saturday-morning" });
    const m = await member({ times: ["saturday-morning"] });
    await place(m.id, c.tribe);
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.save_tribe_onboarding($1, 'https://example.com/join', null)", [c.tribe])), "22023");
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.save_tribe_onboarding($1, null, current_date - 1)", [c.tribe])), "22023");
    await expectCode(db.asUser(m.id, (q) => q("select public.save_tribe_onboarding($1, null, null)", [c.tribe])), "42501");
    await expectCode(db.asUser(m.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.tribe, m.id])), "42501");
    const other = await openTribe({ slot: "saturday-morning" });
    await expectCode(db.asUser(other.leader.id, (q) => q("select public.mark_member_called($1, $2, true)", [c.tribe, m.id])), "42501");
    await expectCode(db.asUser(c.leader.id, (q) => q("select public.mark_member_called($1, gen_random_uuid(), true)", [c.tribe])), "P0002");
  });

  it("shows a leader's first name only, and never the leader's own answers", async () => {
    const c = await openTribe({ slot: "sunday-evening", style: "doing" });
    const m = await member({ times: ["sunday-evening"] });
    const r = await match(m.id);
    const card = r.tribes.find((x: { tribe: { id: string } }) => x.tribe.id === c.tribe).tribe;
    expect(card.leader_first_name).toBe("Tola");
    expect(JSON.stringify(card)).not.toMatch(/Leader|doing|leadBest|@/);
  });
});

describe("the office", () => {
  it("reports totals to the office only, with where members are missing tribes", async () => {
    const office = await db.createUser();
    await db.grant(office.id, "director");
    const open = await openTribe({ slot: "sunday-evening" });
    await place((await member({ times: ["sunday-evening"] })).id, open.tribe);
    const stats = (await db.asUser(office.id, (q) => q("select public.match_stats() as r"))).rows[0].r;
    expect(stats.profiled).toBeGreaterThan(0);
    expect(stats.tribes_open).toBeGreaterThan(0);
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

describe("the rest of the smart form, in the engine", () => {
  const setProfile = (personId: string, sql: string, args: unknown[] = []) =>
    db.admin.query(`update public.member_profiles set ${sql} where person_id = $1`, [personId, ...args]);
  // Straight from the engine, so a tribe under 60% still has its numbers.
  const component = async (personId: string, tribeId: string, key: string) =>
    Number(
      (await db.admin.query(`select r_${key} as v from public.match_candidates($1) where r_tribe = $2`, [personId, tribeId])).rows[0].v,
    );
  const joinTribe = (tribeId: string, memberId: string) =>
    db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 'x', '{}', current_date + 20)`,
      [tribeId, memberId, seasonId],
    );

  it("shows a neighbouring life stage only to someone who said they are open to it, at half credit", async () => {
    const near = await openTribe({ slot: "sunday-evening", track: "rising" });
    const far = await openTribe({ slot: "sunday-evening", track: "builders" });
    const closed = await member({ times: ["sunday-evening"] });
    const open = await member({ times: ["sunday-evening"] });
    await setProfile(open.id, "open_to_adjacent = true");
    expect(shownIds(await match(closed.id))).not.toContain(near.tribe);
    const r = await match(open.id);
    expect(shownIds(r)).toContain(near.tribe);
    expect(await component(open.id, near.tribe, "stage")).toBe(0.5);
    expect(await component(open.id, far.tribe, "stage")).toBe(1);
    const card = r.tribes.find((x: { tribe: { id: string } }) => x.tribe.id === near.tribe);
    expect(card.reasons).not.toContain("stage_same");
  });

  it("never reaches two life stages away, even for someone who is open", async () => {
    const twoAway = await openTribe({ slot: "sunday-evening", track: "rising" });
    const m = await member({ times: ["sunday-evening"], age: "51-60" });
    await setProfile(m.id, "open_to_adjacent = true");
    expect(shownIds(await match(m.id))).not.toContain(twoAway.tribe);
  });

  it("gives a second-choice community 0.7 and says so", async () => {
    const business = await openTribe({ slot: "sunday-evening", community: "business-entrepreneurship", goal: "launch-or-formalise-a-business" });
    const m = await member({ times: ["sunday-evening"] });
    await setProfile(m.id, "second_community_id = $2", [id("communities", "business-entrepreneurship")]);
    const r = await match(m.id);
    expect(shownIds(r)).toContain(business.tribe);
    expect(await component(m.id, business.tribe, "community")).toBe(0.7);
    const without = await member({ times: ["sunday-evening"] });
    expect(await component(without.id, business.tribe, "community")).toBeLessThan(0.7);
  });

  it("prefers the tribe that is short of what the member brings", async () => {
    const c = await openTribe({ slot: "sunday-evening", capacity: 12 });
    const t = { times: ["sunday-evening"], faith: "established" };
    for (let i = 0; i < 2; i++) {
      const host = await member(t);
      await setProfile(host.id, "group_roles = $2", [["host"]]);
      await joinTribe(c.tribe, host.id);
    }
    const another = await member({ times: ["sunday-evening"] });
    await setProfile(another.id, "group_roles = $2", [["host"]]);
    const fresh = await member({ times: ["sunday-evening"] });
    await setProfile(fresh.id, "group_roles = $2", [["thinker"]]);
    const plain = await member({ times: ["sunday-evening"] });
    const [a, b, p] = await Promise.all([
      component(another.id, c.tribe, "style"),
      component(fresh.id, c.tribe, "style"),
      component(plain.id, c.tribe, "style"),
    ]);
    expect(b).toBeGreaterThan(a);
    // Someone who chose no roles is scored on the mix of voices alone, as before.
    expect(p).toBeGreaterThanOrEqual(a);
  });
});

describe("portraits", () => {
  const jpeg = (n = 300) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]).toString("base64");
  const save = (userId: string, data: string, mime = "image/jpeg") =>
    db.asUser(userId, (q) => q("select public.set_my_photo($1, $2) as r", [data, mime]));

  it("keeps a small real picture, and nothing else", async () => {
    const u = await db.createUser();
    const info = (await save(u.id, jpeg())).rows[0].r;
    expect(info.has).toBe(true);
    await expectCode(save(u.id, jpeg(), "image/png"), "22023"); // says PNG, is JPEG
    await expectCode(save(u.id, jpeg(), "image/gif"), "22023");
    await expectCode(save(u.id, "!!!not base64!!!"), "22023");
    await expectCode(save(u.id, Buffer.alloc(40, 1).toString("base64")), "22023"); // too small to be a picture
    await expectCode(save(u.id, jpeg(160000)), "22023"); // too large
    await expectCode(db.asAnon((q) => q("select public.set_my_photo($1, 'image/jpeg')", [jpeg()])), "42501");
  });

  it("shows a leader's face to members, and a member's face only to themselves and the people who run things", async () => {
    const c = await openTribe({ slot: "saturday-morning" });
    const m = await member({ times: ["saturday-morning"] });
    const stranger = await db.createUser();
    await save(c.leader.id, jpeg());
    await save(m.id, jpeg());

    const seen = async (viewer: string, of: string) =>
      (await db.asUser(viewer, (q) => q("select public.photo_of($1) as r", [of]))).rows[0].r as { mime: string; data: string } | null;
    expect((await seen(m.id, c.leader.id))?.mime).toBe("image/jpeg");
    expect((await seen(stranger.id, c.leader.id))?.data).toBe(jpeg());
    expect(await seen(m.id, m.id)).not.toBeNull();
    expect(await seen(stranger.id, m.id)).toBeNull();
    expect(await seen(c.leader.id, m.id)).toBeNull();
    const pastor = await db.createUser();
    await db.grant(pastor.id, "pastor");
    expect(await seen(pastor.id, m.id)).not.toBeNull();

    const card = (await match(m.id)).tribes.find((x: { tribe: { id: string } }) => x.tribe.id === c.tribe).tribe;
    expect(card.leader_photo_id).toBe(c.leader.id);
    expect(JSON.stringify(card)).not.toContain(jpeg());
  });

  it("can be removed, and the card stops showing it", async () => {
    const c = await openTribe({ slot: "sunday-afternoon" });
    const m = await member({ times: ["sunday-afternoon"] });
    await save(c.leader.id, jpeg());
    await db.asUser(c.leader.id, (q) => q("select public.remove_my_photo()"));
    const card = (await match(m.id)).tribes.find((x: { tribe: { id: string } }) => x.tribe.id === c.tribe).tribe;
    expect(card.leader_photo_id).toBeNull();
    expect((await db.asUser(c.leader.id, (q) => q("select public.my_photo_info() as r"))).rows[0].r.has).toBe(false);
  });
});

describe("the leader's brief", () => {
  it("gives roles and the member's own words to the leader, and the sealed note to the leader and assistant only", async () => {
    const c = await openTribe({ slot: "weeknight-evening" });
    const m = await member({ times: ["weeknight-evening"], faith: "established" });
    await db.admin.query(
      "update public.member_profiles set group_roles = $2, success_statement = $3, leader_note_enc = $4 where person_id = $1",
      [m.id, ["host", "connector"], "I lead my team with confidence.", "v1.sealed.note.here"],
    );
    await place(m.id, c.tribe);
    const coach = await db.createUser();
    await db.grant(coach.id, "coach");
    await db.admin.query("update public.tribes set coach_id = $2 where id = $1", [c.tribe, coach.id]);

    const roster = async (viewer: string) =>
      (await db.asUser(viewer, (q) => q("select public.tribe_roster($1) as r", [c.tribe]))).rows[0].r.members[0];
    const asLeader = await roster(c.leader.id);
    expect(asLeader.roles).toEqual(["host", "connector"]);
    expect(asLeader.success).toBe("I lead my team with confidence.");
    expect(asLeader.note_enc).toBe("v1.sealed.note.here");
    const asCoach = await roster(coach.id);
    expect(asCoach.roles).toEqual(["host", "connector"]);
    expect(asCoach.note_enc).toBeNull();
  });
});
