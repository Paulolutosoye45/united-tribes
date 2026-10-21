import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { TestDb } from "./helpers";
import {
  openSeason,
  planRun,
  readyMember,
  rows,
  settle,
} from "./placement-kit";

// The placement scorer is match_candidates with three rules that apply only inside a run. With no run it must give the same rows, the
// same degrees, in the same order, as the matching every member already sees. This file fails if the two ever drift apart.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
const people: { id: string }[] = [];
const tribes: Record<string, string> = {};

const same = async (person: string, run: string | null) => {
  const a = await rows(
    db,
    "select to_jsonb(c) as r from public.match_candidates($1) c order by r_tribe",
    [person],
  );
  const b = await rows(
    db,
    "select to_jsonb(c) as r from public.placement_candidates($1, $2) c order by r_tribe",
    [person, run],
  );
  return { a: a.map((x) => x.r), b: b.map((x) => x.r) };
};

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  await db.admin.query(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );

  tribes.mid = (await k.tribe(season, { name: "Mid", capacity: 10 })).tribe;
  tribes.sunday = (
    await k.tribe(season, {
      name: "Sunday",
      capacity: 10,
      slot: "sunday-afternoon",
      community: "marriage-relationships",
    })
  ).tribe;
  tribes.online = (
    await k.tribe(season, {
      name: "Online",
      capacity: 8,
      slot: "saturday-morning",
      mode: "online",
      zone: "abroad",
    })
  ).tribe;
  tribes.women = (
    await k.tribe(season, { name: "Women", capacity: 10, type: "women" })
  ).tribe;
  tribes.men = (
    await k.tribe(season, {
      name: "Men",
      capacity: 10,
      type: "men",
      slot: "sunday-evening",
    })
  ).tribe;
  // a tribe whose leader is not certified is never offered, in a run or out of one
  await k.tribe(season, {
    name: "Uncertified",
    capacity: 10,
    certified: false,
  });
  // a tribe with one seat left, and a tribe with three
  const nearly = await k.tribe(season, {
    name: "Nearly full",
    capacity: 6,
    slot: "sunday-evening",
  });
  tribes.nearly = nearly.tribe;
  // (a tribe with a seat or two left must already have a quiet and a lively member, or the matching engine will not offer the seat)
  const SOCIAL = [-1, 1, 0, 0, 0];
  for (let i = 0; i < 5; i++)
    await k.seat(nearly.tribe, season, `Seated${i}`, {
      profile: {
        faith: "established",
        times: ["sunday-evening"],
        social: SOCIAL[i],
      },
    });
  const two = await k.tribe(season, {
    name: "Two seats",
    capacity: 6,
    slot: "sunday-evening",
    community: "education",
  });
  tribes.two = two.tribe;
  for (let i = 0; i < 3; i++)
    await k.seat(two.tribe, season, `Held${i}`, {
      profile: {
        faith: "established",
        times: ["sunday-evening"],
        community: "education",
        social: SOCIAL[i],
      },
    });

  const spread: Parameters<typeof readyMember>[4][] = [
    {},
    { times: ["sunday-afternoon"] },
    { times: ["sunday-evening"] },
    { times: [] },
    { mode: "online", zone: "abroad", times: ["saturday-morning"] },
    { mode: "in_person", zone: "island-lekki" },
    { mode: "in_person", zone: "iganmu-surulere", adjacent: true },
    { gender: "female", mix: "same_gender" },
    { gender: "male", mix: "same_gender", times: ["sunday-evening"] },
    { gender: "male", mix: "no_preference" },
    { faith: "established", social: 1 },
    { faith: "leading", social: -1 },
    { faith: "exploring" },
    { community: "marriage-relationships", times: ["sunday-afternoon"] },
    { community: "education", times: ["sunday-evening"] },
    { age: "26-32", adjacent: true },
    { age: "41-50" },
    { zone: "other-nigeria", mode: "online", times: [] },
    { social: 1, times: ["weeknight-evening", "sunday-evening"] },
    { social: -1, times: ["sunday-evening"], faith: "established" },
    // people who can meet at any time reach most of the tribes
    { times: [], mode: "either" },
    { times: [], mode: "either", gender: "male", social: 1 },
    {
      times: [],
      mode: "either",
      gender: "male",
      mix: "same_gender",
      faith: "established",
    },
    {
      times: [],
      mode: "either",
      gender: "female",
      mix: "same_gender",
      social: -1,
    },
    {
      times: [],
      mode: "either",
      zone: "island-lekki",
      adjacent: true,
      age: "26-32",
    },
    {
      times: [],
      mode: "either",
      zone: "iganmu-surulere",
      community: "education",
      faith: "leading",
    },
    {
      times: [],
      mode: "either",
      zone: "abroad",
      community: "marriage-relationships",
    },
    {
      times: [],
      mode: "online",
      zone: "other-nigeria",
      faith: "exploring",
      social: 1,
    },
  ];
  for (let i = 0; i < spread.length; i++)
    people.push(await readyMember(db, k, season, `Spread${i}`, spread[i]));
}, 180_000);

afterEach(async () => {
  await db.admin.query(
    "update public.placement_runs set status = 'cancelled' where status in ('planning', 'planned')",
  );
});

afterAll(async () => {
  await db?.close();
});

describe("the placement scorer outside a run", () => {
  it("gives exactly the rows, the degrees and the order that match_candidates gives, for every kind of member", async () => {
    let compared = 0;
    for (const p of people) {
      const { a, b } = await same(p.id, null);
      expect(b).toEqual(a);
      compared += a.length;
    }
    expect(compared).toBeGreaterThan(30);
  });

  it("offers a tribe whose leader is not certified to nobody", async () => {
    const offered = new Set<string>();
    for (const p of people)
      for (const r of await rows(
        db,
        "select r_tribe from public.placement_candidates($1, null)",
        [p.id],
      ))
        offered.add(r.r_tribe);
    const unc = (
      await rows(db, "select id from public.tribes where name = 'Uncertified'")
    )[0].id;
    expect(offered.has(unc)).toBe(false);
    expect(offered.size).toBeGreaterThan(3);
  });
});

describe("inside a run", () => {
  let sensitiveGoal: string;
  let sensitiveCommunity: string;
  let sensitiveTribe: string;

  beforeAll(async () => {
    await o.call(
      "placement_settings_save",
      JSON.stringify({ mode: "rehearsal", seats_free: 0 }),
    );
    const sg = (
      await rows(
        db,
        "select t.season_goal_id as g, c.slug from public.tribe_card_templates t join public.season_goals g on g.id = t.season_goal_id join public.communities c on c.id = g.community_id where t.sensitive limit 1",
      )
    )[0];
    sensitiveGoal = sg.g;
    sensitiveCommunity = sg.slug;
    const sens = await k.tribe(season, {
      name: "Sensitive",
      capacity: 10,
      community: sg.slug,
    });
    sensitiveTribe = sens.tribe;
    await db.admin.query(
      "update public.tribes set season_goal_id = $2 where id = $1",
      [sensitiveTribe, sensitiveGoal],
    );
  });

  it("adds only its three rules: with none of them in play it still gives the rows match_candidates gives", async () => {
    // seats kept free: 0 for this run; nobody proposed yet; and the tribes built on a sensitive card (the marriage tribes are) are set aside
    // for this check, since a run offers those only to a member who chose that goal
    await db.admin.query(
      "update public.tribes set status = 'changes_requested' where status = 'approved' and season_goal_id in (select season_goal_id from public.tribe_card_templates where sensitive)",
    );
    const run = (await o.call("placement_run_new", "{}")).run as string;
    for (const p of people) {
      const { a, b } = await same(p.id, run);
      expect(b).toEqual(a);
    }
    await o.call("placement_run_cancel", run);
    await db.admin.query(
      "update public.tribes set status = 'approved' where status = 'changes_requested' and season_goal_id in (select season_goal_id from public.tribe_card_templates where sensitive)",
    );
  });

  it("keeps a seat free in every tribe when the church asks for one, and not otherwise", async () => {
    const member = people[1]; // Sunday afternoon
    const sunEve = await readyMember(db, k, season, "SundayEve", {
      times: ["sunday-evening"],
      faith: "established",
    });
    // The tribe with one seat left is shown to the member on their own, and not offered by a run that keeps a seat free
    const own = await rows(
      db,
      "select r_tribe from public.match_candidates($1)",
      [sunEve.id],
    );
    expect(own.map((r) => r.r_tribe)).toContain(tribes.nearly);
    await o.call("placement_settings_save", JSON.stringify({ seats_free: 1 }));
    const run = (await o.call("placement_run_new", "{}")).run as string;
    const inRun = await rows(
      db,
      "select r_tribe from public.placement_candidates($1, $2)",
      [sunEve.id, run],
    );
    expect(inRun.map((r) => r.r_tribe)).not.toContain(tribes.nearly);
    expect(inRun.map((r) => r.r_tribe)).toContain(tribes.two);
    void member;
    await o.call("placement_run_cancel", run);
    await o.call("placement_settings_save", JSON.stringify({ seats_free: 0 }));
    const run2 = (await o.call("placement_run_new", "{}")).run as string;
    const free0 = await rows(
      db,
      "select r_tribe from public.placement_candidates($1, $2)",
      [sunEve.id, run2],
    );
    expect(free0.map((r) => r.r_tribe)).toContain(tribes.nearly);
    await o.call("placement_run_cancel", run2);
  });

  it("offers a tribe on a sensitive card only to a member who chose that very goal", async () => {
    const run = (await o.call("placement_run_new", "{}")).run as string;
    const plain = people[0];
    expect(
      (
        await rows(db, "select r_tribe from public.match_candidates($1)", [
          plain.id,
        ])
      ).map((r) => r.r_tribe),
    ).toContain(sensitiveTribe);
    expect(
      (
        await rows(
          db,
          "select r_tribe from public.placement_candidates($1, $2)",
          [plain.id, run],
        )
      ).map((r) => r.r_tribe),
    ).not.toContain(sensitiveTribe);
    const chose = await readyMember(db, k, season, "Chose", {
      community: sensitiveCommunity,
    });
    await db.admin.query(
      "update public.member_profiles set season_goal_id = $2 where person_id = $1",
      [chose.id, sensitiveGoal],
    );
    await settle(db, chose.id, 20);
    expect(
      (
        await rows(
          db,
          "select r_tribe from public.placement_candidates($1, $2)",
          [chose.id, run],
        )
      ).map((r) => r.r_tribe),
    ).toContain(sensitiveTribe);
    await o.call("placement_run_cancel", run);
  });

  it("counts people already proposed for a tribe as its members, so the plan fills a tribe once and never past its room", async () => {
    await o.call(
      "placement_settings_save",
      JSON.stringify({ seats_free: 1, min_tribe: 4 }),
    );
    await db.admin.query(
      "update public.tribes set status = 'closed' where status = 'approved' and id <> $1",
      [tribes.two],
    );
    // six new members who can only meet on Sunday evening and want the tribe with two seats; one stays free, so only one may be proposed
    const crowd: string[] = [];
    for (let i = 0; i < 6; i++)
      crowd.push(
        (
          await readyMember(db, k, season, `Crowd${i}`, {
            times: ["sunday-evening"],
            community: "education",
            faith: "established",
          })
        ).id,
      );
    const run = await planRun(o, {});
    const placed = await rows(
      db,
      "select person_id from public.placement_items where run_id = $1 and tribe_id = $2 and status = 'proposed'",
      [run, tribes.two],
    );
    const active = (
      await rows(
        db,
        "select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'",
        [tribes.two],
      )
    )[0].n;
    expect(active).toBe(3);
    expect(placed.length).toBe(2); // 3 seated + 2 proposed = 5 of 6, one seat kept free
    expect(active + placed.length).toBeLessThanOrEqual(6 - 1);
    const left = await rows(
      db,
      "select reason, count(*)::int n from public.placement_items where run_id = $1 and person_id = any($2::uuid[]) and status = 'unplaced' group by 1",
      [run, crowd],
    );
    expect(left.length).toBeGreaterThan(0);
    await o.call("placement_run_cancel", run);
  });
});
