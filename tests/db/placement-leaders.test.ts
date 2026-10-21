import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { answers, calling } from "./pipeline-kit";

// Appointing leaders in bulk, from the Bulk tab: approved leaders who have no tribe yet, and people from a pasted sheet. The plan changes
// nothing; the run appoints through the same doors as the one-at-a-time appointment; it approves no card and certifies nobody.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let pastor: string;
let seasonId: string;
let n = 0;
const approvedMade: string[] = [];

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> =>
  (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> =>
  (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> =>
  (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (
    await db.asUser(uid, (q) =>
      q(
        `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`,
        args,
      ),
    )
  ).rows[0]?.r;

// Where the members are waiting: two Consulting goals and one In-between Jobs goal (the plan fills the biggest gap first)
const PIPE = {
  track: "builders",
  lead_best: "connection",
  community: "consulting",
  goal: "build-a-steady-client-pipeline",
  relation: "achieved",
};
const LAND = { ...PIPE, goal: "land-my-first-three-clients" };
const GROW = {
  ...PIPE,
  community: "in-between-jobs",
  goal: "grow-a-network-that-opens-doors",
};
const MENTOR = {
  track: "builders",
  lead_best: "connection",
  community: "professionals",
  goal: "find-a-mentor-and-become-one",
  relation: "achieved",
};
const ZERO = "00000000-0000-0000-0000-000000000000";
const goalId = async (slug: string) =>
  (await one("select id from public.season_goals where slug = $1", [slug]))
    .id as string;

async function person(name = `Person${++n}`) {
  return k.person(name);
}

/** An approved leader with no tribe yet: the role and the application the pastor approved, with the calling they wrote. */
async function approvedLeader(
  name: string,
  form: { community: string; goal: string },
) {
  const u = await person(name);
  await db.grant(u.id, "leader");
  await db.admin.query(
    "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())",
    [
      u.id,
      JSON.stringify(
        answers(undefined, {
          calling: calling({
            community: form.community,
            goal: form.goal,
            goalRelation: "achieved",
          }),
        }),
      ),
    ],
  );
  approvedMade.push(u.id);
  return u;
}

/** Members waiting for a place in a goal, so the plan has a gap to fill. */
async function waiting(slug: string, howMany: number) {
  const g = await goalId(slug);
  const tag = `w${++n}`;
  await db.admin.query(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     select 'wait-${tag}-' || x || '@example.org', now(), '{}'::jsonb from generate_series(1, $1::int) x`,
    [howMany],
  );
  await db.admin.query(
    `insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown)
     select p.id, $1, sg.id, sg.community_id, 'any', 0 from public.people p, public.season_goals sg where sg.id = $2 and p.email like $3`,
    [seasonId, g, `wait-${tag}-%@example.org`],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  seasonId = (
    await one(
      "select id from public.seasons where status in ('planning','open') order by starts_on limit 1",
    )
  ).id;
  for (const c of await sql("select id from public.communities"))
    await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql(
    "select slug from public.tribe_card_templates where status <> 'signed_off'",
  ))
    await call(pastor, "card_template_sign_off", [t.slug]);
  await waiting("build-a-steady-client-pipeline", 14); // two tribes' worth
  await waiting("land-my-first-three-clients", 5);
  await waiting("grow-a-network-that-opens-doors", 3);
}, 240_000);

afterEach(async () => {
  await db.admin.query(
    "update public.placement_leader_runs set status = 'cancelled' where status = 'planned'",
  );
});

afterAll(async () => {
  await db?.close();
});

describe("planning", () => {
  it("needs an approved fit model first", async () => {
    await expect(o.call("placement_leaders_plan", "[]", true)).rejects.toThrow(
      /approve a fit model/,
    );
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  });

  it("refuses more than 300 rows and anything that is not a list", async () => {
    await expectCode(
      o.call(
        "placement_leaders_plan",
        JSON.stringify(Array.from({ length: 301 }, () => ({}))),
        false,
      ),
      "22023",
    );
    await expectCode(
      o.call("placement_leaders_plan", JSON.stringify({ a: 1 }), false),
      "22023",
    );
  });

  it("pairs approved leaders and sheet rows with the goals that have a gap, biggest first, and changes nothing", async () => {
    const a1 = await approvedLeader("Approved1", PIPE);
    const a2 = await approvedLeader("Approved2", PIPE);
    const onSheet = await person("Sheeted");
    const snapshot = async () => ({
      tribes: await count("select count(*)::int c from public.tribes"),
      roles: await count("select count(*)::int c from public.person_roles"),
      offers: await count("select count(*)::int c from public.leader_offers"),
      appts: await count(
        "select count(*)::int c from public.leader_appointments",
      ),
      mail: await count("select count(*)::int c from public.messages"),
    });
    const before = await snapshot();
    const plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: onSheet.email, ...LAND }]),
      true,
    );
    expect(plan.paired).toBe(3);
    expect(await snapshot()).toEqual(before);
    const view = await o.call("placement_leaders_view", plan.run);
    expect(view.run).toMatchObject({ id: plan.run, status: "planned" });
    const named = view.items.map((i: Row) => i.person);
    expect(named.sort()).toEqual([a1.id, a2.id, onSheet.id].sort());
    for (const i of view.items) expect(i.degree).toBeGreaterThanOrEqual(60);
    // the goal with the biggest gap needs two tribes and gets two leaders; the smaller one gets the person from the sheet
    expect(
      view.items.filter(
        (i: Row) => i.title === "Build a steady client pipeline",
      ).length,
    ).toBe(2);
    expect(view.items.find((i: Row) => i.person === onSheet.id).title).toBe(
      "Land my first three clients",
    );
    // what is still short is said in words
    expect(view.open_goals.map((g: Row) => g.title)).toEqual([
      "Grow a network that opens doors",
    ]);
  });

  it("says why a person was left out: not on the platform, already appointed, an application too thin to score, listed twice, or no goal needs them", async () => {
    const thin = await person("Thin");
    await db.grant(thin.id, "leader");
    await db.admin.query(
      "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', '{}'::jsonb, 'test', now(), now())",
      [thin.id],
    );
    approvedMade.push(thin.id);
    const twice = await person("Twice");
    const done = await person("Done");
    await o.call(
      "god_appoint_leader",
      done.id,
      JSON.stringify(PIPE),
      await goalId("build-a-steady-client-pipeline"),
      null,
    );
    // a card still being changed does not count as seats, so the gaps the other tests rely on stay as they are
    const leads = await k.tribe(seasonId, {
      community: "consulting",
      status: "changes_requested",
    });
    const plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([
        { email: "nobody@nowhere.example", ...PIPE },
        { email: twice.email, ...PIPE },
        { email: twice.email.toUpperCase(), ...PIPE },
        { email: done.email, ...PIPE },
        { email: leads.leader.email, ...PIPE },
        {
          email: (await person("Badform")).email,
          track: "builders",
          lead_best: "bossy",
        },
        "not a row",
      ]),
      true,
    );
    const view = await o.call("placement_leaders_view", plan.run);
    const reasons = view.left_over
      .map((x: Row) => x.reason as string)
      .join(" | ");
    expect(reasons).toMatch(/Not on the platform yet/);
    expect(reasons).toMatch(/On the list twice/);
    expect(reasons).toMatch(/Already appointed or already leads a tribe/);
    expect(reasons).toMatch(/not complete enough to score/);
    expect(reasons).toMatch(/could not be read/);
    expect(reasons).toMatch(/how they lead best/);
  });

  it("keeps the owner out, and allows one open run at a time", async () => {
    const plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: o.owner.email, ...PIPE }]),
      false,
    );
    expect(
      JSON.stringify(
        (await o.call("placement_leaders_view", plan.run)).left_over,
      ),
    ).toMatch(/Not on the platform yet/);
    await expect(o.call("placement_leaders_plan", "[]", true)).rejects.toThrow(
      /already open/,
    );
  });
});

describe("changing the plan", () => {
  let plan: Row;
  // (the run is cancelled after each test, so everything that needs it open is in this one)

  it("offers the other goals a person suits, and swaps or removes them while the plan is open", async () => {
    const x = await person("Swapper");
    plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: x.email, ...PIPE }]),
      false,
    );
    const view = await o.call("placement_leaders_view", plan.run);
    const pick = view.items.find((i: Row) => i.person === x.id);
    expect(pick).toBeTruthy();
    const opts = await o.call("placement_leaders_options", plan.run, x.id);
    const degrees = opts.map((r: Row) => r.degree);
    expect(degrees).toEqual([...degrees].sort((a: number, b: number) => b - a));
    const other = opts.find((r: Row) => r.goal !== pick.goal);
    expect(other).toBeTruthy();
    await o.call(
      "placement_leaders_adjust",
      plan.run,
      x.id,
      "move",
      other.goal,
    );
    expect(
      (
        await one(
          "select goal_id from public.placement_leader_items where run_id = $1 and person_id = $2",
          [plan.run, x.id],
        )
      ).goal_id,
    ).toBe(other.goal);
    await expectCode(
      o.call("placement_leaders_adjust", plan.run, x.id, "move", ZERO),
      "22023",
    );
    await expectCode(
      o.call("placement_leaders_adjust", plan.run, x.id, "sideways", null),
      "22023",
    );
    await expectCode(
      o.call("placement_leaders_adjust", plan.run, ZERO, "remove", null),
      "22023",
    );
    await expectCode(
      o.call("placement_leaders_options", plan.run, ZERO),
      "22023",
    );
    await o.call("placement_leaders_adjust", plan.run, x.id, "remove", null);
    expect(
      (
        await one(
          "select status from public.placement_leader_items where run_id = $1 and person_id = $2",
          [plan.run, x.id],
        )
      ).status,
    ).toBe("removed");
    // with the only person taken out, the plan appoints nobody; a cancelled plan can be neither approved nor changed
    await expect(
      o.call("placement_leaders_approve", plan.run, 0),
    ).rejects.toThrow(/appoints nobody/);
    await o.call("placement_leaders_cancel", plan.run);
    await expect(
      o.call("placement_leaders_approve", plan.run, 1),
    ).rejects.toThrow(/cannot be approved/);
    await expect(
      o.call("placement_leaders_adjust", plan.run, ZERO, "remove", null),
    ).rejects.toThrow(/only be changed before/);
  });
});

describe("appointing", () => {
  let plan: Row;
  let approvedOne: { id: string; email: string };
  const sheeted: { id: string; email: string }[] = [];

  beforeAll(async () => {
    // people made approved leaders by the tests above are set aside, so this plan is only about the people made here
    await db.admin.query(
      "delete from public.person_roles where person_id = any($1::uuid[]) and role = 'leader'",
      [approvedMade],
    );
  });

  it("plans an approved leader and two people from the sheet, approves the plan with the count the page showed, and approves it once", async () => {
    approvedOne = await approvedLeader("Approved3", GROW);
    for (let i = 0; i < 2; i++) sheeted.push(await person(`Sheet${i}`));
    plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([
        { email: sheeted[0].email, ...PIPE },
        { email: sheeted[1].email, ...LAND },
      ]),
      true,
    );
    expect(plan.paired).toBe(3);
    await expect(
      o.call("placement_leaders_approve", plan.run, 4),
    ).rejects.toThrow(/plan has changed/);
    expect(await o.call("placement_leaders_approve", plan.run, 3)).toEqual({
      status: "approved",
      leaders: 3,
    });
    expect(await o.call("placement_leaders_approve", plan.run, 3)).toEqual({
      status: "approved",
      already: true,
    });
  });

  it("appoints in small steps, and says when it is done", async () => {
    const res = await o.call("placement_leaders_apply", plan.run);
    expect(res).toMatchObject({ status: "done", done: 3, failed: 0, left: 0 });
    expect(await o.call("placement_leaders_apply", plan.run)).toMatchObject({
      status: "done",
      done: 0,
    }); // pressing it again changes nothing
    const items = await sql(
      "select status from public.placement_leader_items where run_id = $1",
      [plan.run],
    );
    expect(items.map((i) => i.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
  });

  it("makes each a leader of a draft card, and approves no card and certifies nobody", async () => {
    const applied = await sql(
      "select person_id, source, tribe_id from public.placement_leader_items where run_id = $1 and status = 'applied'",
      [plan.run],
    );
    for (const a of applied) {
      const t = await one(
        "select leader_id, status, published_at, season_id from public.tribes where id = $1",
        [a.tribe_id],
      );
      expect(t).toMatchObject({
        leader_id: a.person_id,
        status: "draft",
        published_at: null,
        season_id: seasonId,
      });
      expect(
        await count(
          "select count(*)::int c from public.leader_certifications where person_id = $1",
          [a.person_id],
        ),
      ).toBe(0);
      expect(
        await count(
          "select count(*)::int c from public.person_roles where person_id = $1 and role = 'leader'",
          [a.person_id],
        ),
      ).toBe(1);
    }
    // the card is the one the leader opens: start_tribe_card gives them the same one, with nothing to choose again
    const mine = await call(approvedOne.id, "start_tribe_card");
    expect(applied.map((a) => a.tribe_id)).toContain(mine);
    expect(
      await count(
        "select count(*)::int c from public.tribes where leader_id = $1",
        [approvedOne.id],
      ),
    ).toBe(1);
    // nobody is seated by it: a draft card shows members no seats
    const seats = await sql(
      "select seats_open from public.goal_demand_rows($1) where goal_id = $2",
      [seasonId, await goalId("build-a-steady-client-pipeline")],
    );
    expect(seats[0].seats_open).toBe(0);
  });

  it("records an approved leader's card the way an accepted offer does, and a sheet person's the way the one-at-a-time appointment does, never naming the owner", async () => {
    const approvedItem = await one(
      "select tribe_id from public.placement_leader_items where run_id = $1 and person_id = $2",
      [plan.run, approvedOne.id],
    );
    expect(
      await one(
        "select status, offered_by, tribe_id from public.leader_offers where person_id = $1",
        [approvedOne.id],
      ),
    ).toEqual({
      status: "accepted",
      offered_by: null,
      tribe_id: approvedItem.tribe_id,
    });
    for (const s of sheeted) {
      const a = await one(
        "select status, granted_role from public.leader_appointments where person_id = $1",
        [s.id],
      );
      expect(a).toMatchObject({ status: "active", granted_role: true });
      expect(
        (
          await one(
            "select granted_by from public.person_roles where person_id = $1 and role = 'leader'",
            [s.id],
          )
        ).granted_by,
      ).toBeNull();
    }
    expect(
      await count(
        "select count(*)::int c from public.event_log where action like 'placement.leaders%' and actor_id is not null",
      ),
    ).toBe(0);
    expect(
      await count(
        "select count(*)::int c from public.god_log where action like 'placement.leaders%'",
      ),
    ).toBeGreaterThan(0);
  });

  it("sends each appointed leader one email, by email only, with the goal and community and nothing about how well they scored", async () => {
    const mails = await sql(
      "select person_id, params, force_channel from public.messages where template = 'placement_leader_appointed'",
    );
    const applied = await sql(
      "select person_id from public.placement_leader_items where run_id = $1 and status = 'applied'",
      [plan.run],
    );
    expect(mails.map((m) => m.person_id).sort()).toEqual(
      applied.map((a) => a.person_id).sort(),
    );
    for (const m of mails) {
      expect(m.force_channel).toBe("email");
      expect(Object.keys(m.params).sort()).toEqual([
        "community",
        "fit",
        "goal",
        "tribe",
      ]);
      expect(["excellent", "strong", "good"]).toContain(m.params.fit);
      expect(JSON.stringify(m.params)).not.toMatch(/\d{2,}|@/);
    }
  });

  it("marks the one person who cannot be appointed with the reason and carries on with the rest", async () => {
    const a = await approvedLeader("Approved4", PIPE);
    const b = await person("Sheet9");
    const plan2 = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: b.email, ...LAND }]),
      true,
    );
    expect(plan2.paired).toBe(2);
    // between the plan and the press, one of them takes a tribe of their own
    const t = await k.tribe(seasonId, {
      community: "consulting",
      status: "changes_requested",
    });
    await db.admin.query(
      "update public.tribes set leader_id = $1 where id = $2",
      [a.id, t.tribe],
    );
    await o.call("placement_leaders_approve", plan2.run, 2);
    const res = await o.call("placement_leaders_apply", plan2.run);
    expect(res).toMatchObject({ status: "done", done: 1, failed: 1, left: 0 });
    const failed = await one(
      "select status, reason from public.placement_leader_items where run_id = $1 and person_id = $2",
      [plan2.run, a.id],
    );
    expect(failed.status).toBe("failed");
    expect(failed.reason).toMatch(/already have a Tribe Card or lead a tribe/);
    expect(
      (
        await one(
          "select status from public.placement_leader_items where run_id = $1 and person_id = $2",
          [plan2.run, b.id],
        )
      ).status,
    ).toBe("applied");
  });

  it("cannot be cancelled once it has started appointing", async () => {
    const b = await person("Sheet10");
    const p = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: b.email, ...GROW }]),
      false,
    );
    expect(p.paired).toBe(1);
    await o.call("placement_leaders_approve", p.run, 1);
    await o.call("placement_leaders_apply", p.run);
    await expect(o.call("placement_leaders_cancel", p.run)).rejects.toThrow(
      /started appointing/,
    );
  });
});

describe("a long run", () => {
  it("is appointed 25 at a time", async () => {
    await waiting("find-a-mentor-and-become-one", 12 * 30);
    const rows: Row[] = [];
    for (let i = 0; i < 30; i++)
      rows.push({ email: (await person(`Long${i}`)).email, ...MENTOR });
    const plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify(rows),
      false,
    );
    expect(plan.paired).toBe(30);
    await o.call("placement_leaders_approve", plan.run, 30);
    const first = await o.call("placement_leaders_apply", plan.run);
    expect(first).toMatchObject({
      status: "applying",
      done: 25,
      failed: 0,
      left: 5,
    });
    const second = await o.call("placement_leaders_apply", plan.run);
    expect(second).toMatchObject({ status: "done", done: 5, left: 0 });
    expect(
      await count(
        "select count(*)::int c from public.placement_leader_items where run_id = $1 and status = 'applied'",
        [plan.run],
      ),
    ).toBe(30);
    expect(
      await count(
        "select count(*)::int c from public.messages where template = 'placement_leader_appointed'",
      ),
    ).toBeGreaterThanOrEqual(30);
  }, 180_000);
});
