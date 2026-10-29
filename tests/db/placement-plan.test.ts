import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, makeYoung, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type TestDb } from "./helpers";
import {
  openSeason,
  planRun,
  proposedCount,
  readyMember,
  resolveAll,
  rows,
  settle,
} from "./placement-kit";

// Automatic placement, the planning half: the switch, who may use it, who is in the pool and why not, what a plan does and does not do,
// and the states a run moves through.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let pastor: string;
let director: string;
let adminId: string;
let leader: string;
let member: string;
const people: { id: string }[] = [];

const ZERO = "00000000-0000-0000-0000-000000000000";
const save = (changes: Record<string, unknown>) =>
  o.call("placement_settings_save", JSON.stringify(changes));
const reasonOf = async (person: string) =>
  (
    await rows(db, "select public.placement_pool_reason($1, $2) as r", [
      person,
      season,
    ])
  )[0].r as string | null;

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  leader = (await k.staff("Elder", "leader")).id;
  member = (await k.person("Plain")).id;
  await db.admin.query(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );
  await k.tribe(season, { capacity: 12, name: "Mid A" });
  await k.tribe(season, {
    capacity: 12,
    name: "Sunday B",
    slot: "sunday-afternoon",
  });
  for (let i = 0; i < 14; i++) {
    people.push(
      await readyMember(db, k, season, `Mem${i}`, {
        times: i % 7 === 6 ? ["sunday-afternoon"] : ["weeknight-evening"],
        daysAgo: 30 - i,
      }),
    );
  }
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe("the switch", () => {
  it("starts Off, with the church's choices at the values the blueprint recommends, and the floor the matching model already has", async () => {
    expect(await o.call("placement_settings_get")).toEqual({
      mode: "off",
      grace_days: 7,
      seats_free: 1,
      min_tribe: 5,
      pace_per_hour: 100,
      send_from: 9,
      send_until: 19,
      hold_hours: 24,
      reminder_days: 5,
      floor: 60,
      hold_group_link: true, // the WhatsApp group link waits for the member's answer, until God Mode says otherwise
      last_tick_at: null, // the heartbeat has not run yet
    });
  });

  it("will not plan anything while it is Off", async () => {
    await expectCode(o.call("placement_run_new", "{}"), "22023");
    await expect(o.call("placement_run_new", "{}")).rejects.toThrow(
      /switched Off/,
    );
  });

  it("treats a switch that cannot be read as Off", async () => {
    await db.admin.query("update public.placement_settings set mode = 'on'");
    expect((await rows(db, "select public.placement_mode() as m"))[0].m).toBe(
      "on",
    );
    await db.admin.query(
      "alter table public.placement_settings drop constraint if exists placement_settings_mode_check",
    );
    await db.admin.query(
      "update public.placement_settings set mode = 'banana'",
    );
    expect((await rows(db, "select public.placement_mode() as m"))[0].m).toBe(
      "off",
    );
    await db.admin.query("update public.placement_settings set mode = 'off'");
  });

  it("changes only what is named, checks every number in plain words, and writes each change to the record", async () => {
    const r = await save({ mode: "rehearsal", pace_per_hour: 50 });
    expect(r).toMatchObject({
      mode: "rehearsal",
      pace_per_hour: 50,
      grace_days: 7,
      seats_free: 1,
    });
    for (const bad of [
      { mode: "maybe" },
      { mode: null },
      { nothing: 1 },
      { grace_days: "7" },
      { grace_days: 1.5 },
      { grace_days: -1 },
      { grace_days: 31 },
      { seats_free: 3 },
      { min_tribe: 3 },
      { min_tribe: 9 },
      { pace_per_hour: 0 },
      { pace_per_hour: 1001 },
      { send_from: 5 },
      { send_until: 22 },
      { send_from: 12, send_until: 10 },
    ]) {
      await expectCode(save(bad), "22023");
    }
    await expectCode(
      o.call("placement_settings_save", JSON.stringify([1])),
      "22023",
    );
    expect(await o.call("placement_settings_get")).toMatchObject({
      mode: "rehearsal",
      pace_per_hour: 50,
    });
    expect(
      (
        await rows(
          db,
          "select count(*)::int n from public.god_log where action = 'placement.settings'",
        )
      )[0].n,
    ).toBeGreaterThan(0);
    await save({ pace_per_hour: 100 });
  });

  it("never names the owner in the ordinary record", async () => {
    const named = await rows(
      db,
      "select count(*)::int n from public.event_log where action like 'placement.%' and actor_id = $1",
      [o.owner.id],
    );
    expect(named[0].n).toBe(0);
  });
});

describe("who may use the console", () => {
  const CALLS: [string, unknown[]][] = [
    ["placement_settings_get", []],
    ["placement_settings_save", ['{"mode":"off"}']],
    ["placement_run_new", ["{}"]],
    ["placement_run_step", [ZERO]],
    ["placement_run_approve", [ZERO, 1]],
    ["placement_run_place", [ZERO]],
    ["placement_run_cancel", [ZERO]],
    ["placement_options", [ZERO, ZERO]],
    ["placement_adjust", [ZERO, ZERO, "remove", null]],
    ["placement_resolve_small", [ZERO, ZERO, "keep"]],
    ["placement_hold_clear", [ZERO]],
    ["placement_hold_set", [ZERO, null]],
    ["placement_holds_list", []],
    ["placement_undo", [ZERO]],
    ["placement_overview", []],
    ["placement_run_view", [ZERO]],
    ["placement_run_items", [ZERO, null, 10, 0]],
    ["placement_open_now", [ZERO, ZERO]],
    ["placement_open_all", [ZERO]],
    ["placement_leaders_plan", ["[]", true]],
    ["placement_leaders_options", [ZERO, ZERO]],
    ["placement_leaders_adjust", [ZERO, ZERO, "remove", null]],
    ["placement_leaders_approve", [ZERO, 1]],
    ["placement_leaders_cancel", [ZERO]],
    ["placement_leaders_apply", [ZERO]],
    ["placement_leaders_view", [null]],
    ["god_start_leader_card", [ZERO, ZERO]],
  ];
  const run = (
    who: string | null,
    fn: string,
    args: unknown[],
    session?: string,
  ) => {
    const text = `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`;
    return who === null
      ? db.asAnon((q) => q(text, args))
      : db.asUser(who, (q) => q(text, args), session ? { session } : undefined);
  };

  it("refuses every other role, a visitor, and the owner until they have unlocked on this sign-in", async () => {
    for (const [fn, args] of CALLS) {
      for (const who of [adminId, director, pastor, leader, member])
        await expectCode(run(who, fn, args), "42501");
      await expectCode(run(null, fn, args), "42501");
      await expectCode(run(o.owner.id, fn, args, randomUUID()), "42501");
    }
  });

  it("keeps all eight tables closed to every client, with row level security on and no policy", async () => {
    const tables = [
      "placement_settings",
      "placement_runs",
      "placement_items",
      "placement_teams",
      "placement_tokens",
      "placement_holds",
      "placement_leader_runs",
      "placement_leader_items",
    ];
    for (const t of tables) {
      const r = (
        await rows(
          db,
          "select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = $1::regclass",
          [`public.${t}`],
        )
      )[0];
      expect(r).toEqual({ rls: true, pol: 0 });
      for (const who of [adminId, pastor, o.owner.id])
        await expectCode(
          db.asUser(who, (q) => q(`select * from public.${t}`)),
          "42501",
        );
      await expectCode(
        db.asAnon((q) => q(`select * from public.${t}`)),
        "42501",
      );
    }
  });

  it("closes the internal steps to every client", async () => {
    for (const [fn, args] of [
      ["placement_candidates", [member, null]],
      ["placement_pool_reason", [member, season]],
      ["placement_place_item", [ZERO, 1]],
      ["placement_place_batch", [ZERO, 10]],
      ["placement_team_mail", [ZERO]],
      ["placement_team_mail_for", [ZERO, ZERO]],
      ["placement_contact", [ZERO]],
      ["placement_group_open", [ZERO]],
      ["placement_tick", []],
      ["placement_token_mint", [ZERO, ZERO, 1]],
      ["placement_do_confirm", [ZERO, "v"]],
    ] as [string, unknown[]][]) {
      await expectCode(run(o.owner.id, fn, args, o.session), "42501");
      await expectCode(run(null, fn, args), "42501");
    }
  });
});

describe("who is in the pool, and why not", () => {
  it("leaves out leaders, assistants, held members, members with no form, no consent, under 18, a deletion open, an address that bounces, another season, and anyone still inside the grace period", async () => {
    const fresh = await readyMember(db, k, season, "Fresh");
    expect(await reasonOf(fresh.id)).toBeNull();

    expect(await reasonOf(leader)).toBe("leader");
    const asst = await k.staff("Asst", "assistant_leader");
    expect(await reasonOf(asst.id)).toBe("leader");
    expect(await reasonOf(member)).toBe("needs_form");

    const noConsent = await readyMember(db, k, season, "NoConsent", {
      matching: false,
    });
    expect(await reasonOf(noConsent.id)).toBe("no_consent");
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't'), ($1, 'matching', false, 't')",
      [fresh.id],
    );
    // (withdrawing the consent also clears the form, so the member is out either way)
    expect(["no_consent", "needs_form"]).toContain(await reasonOf(fresh.id));

    const young = await k.person("Young");
    await makeYoung(db, k, young.id, season);
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')",
      [young.id],
    );
    await settle(db, young.id, 20);
    expect(await reasonOf(young.id)).toBe("under18");

    const del = await readyMember(db, k, season, "Deleting");
    await db.admin.query(
      "insert into public.erasure_requests (person_id, centre_id) select id, centre_id from public.people where id = $1",
      [del.id],
    );
    expect(await reasonOf(del.id)).toBe("deletion_open");

    const bounce = await readyMember(db, k, season, "Bounce");
    await db.admin.query(
      "insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')",
      [bounce.id],
    );
    expect(await reasonOf(bounce.id)).toBe("cannot_email");

    const other = await k.season("Another season", -400);
    const away = await k.person("Away");
    await k.profile(away.id, other);
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')",
      [away.id],
    );
    await settle(db, away.id, 20);
    expect(await reasonOf(away.id)).toBe("other_season");

    const recent = await readyMember(db, k, season, "Recent", { daysAgo: 2 });
    expect(await reasonOf(recent.id)).toBe("in_grace");
    const ran = await readyMember(db, k, season, "RanLately");
    await db.admin.query(
      "insert into public.match_runs (person_id, season_id, model_version, candidates, shown) values ($1, $2, (select version from public.match_models where active), 3, 3)",
      [ran.id, season],
    );
    expect(await reasonOf(ran.id)).toBe("in_grace");
    expect(
      await rows(db, "select public.placement_pool_reason($1, $2, 0) as r", [
        ran.id,
        season,
      ]),
    ).toEqual([{ r: null }]);

    await db.admin.query(
      "insert into public.placement_holds (person_id) values ($1)",
      [fresh.id],
    );
    expect(await reasonOf(fresh.id)).toBe("held");
    expect(await reasonOf(del.id)).toBe("deletion_open");
  });
});

describe("a plan", () => {
  let run: string;

  it("is made in as many steps as it takes, places nobody, and says who is out and why", async () => {
    await save({ mode: "rehearsal" });
    const before = (
      await rows(db, "select count(*)::int n from public.tribe_members")
    )[0].n;
    const made = await o.call("placement_run_new", "{}");
    expect(made.pool).toBeGreaterThan(14);
    run = made.run;
    const phases: string[] = [];
    for (let i = 0; i < 60; i++) {
      const st = await o.call("placement_run_step", run);
      phases.push(`${st.status}/${st.phase}`);
      if (st.status !== "planning") break;
    }
    expect(phases).toContain("planning/assign");
    expect(phases.at(-1)).toBe("planned/ready");
    expect((await o.call("placement_run_step", run)).status).toBe("planned"); // a second press changes nothing
    expect(
      (await rows(db, "select count(*)::int n from public.tribe_members"))[0].n,
    ).toBe(before);
    const by = await rows(
      db,
      "select status, reason, count(*)::int n from public.placement_items where run_id = $1 group by 1, 2 order by 1, 2",
      [run],
    );
    const reasons = Object.fromEntries(
      by.filter((r) => r.status === "unplaced").map((r) => [r.reason, r.n]),
    );
    expect(reasons).toMatchObject({
      no_consent: expect.any(Number),
      under18: expect.any(Number),
      in_grace: expect.any(Number),
      held: expect.any(Number),
      needs_form: expect.any(Number),
    });
    expect(reasons).not.toHaveProperty("leader"); // leaders are never in the pool at all
    expect(
      (
        await rows(
          db,
          "select count(*)::int n from public.placement_items where run_id = $1 and person_id = any($2::uuid[])",
          [run, [leader]],
        )
      )[0].n,
    ).toBe(0);
  });

  it("puts every member it proposes in a tribe that scored at least the floor, and gives the next-best tribes beside it", async () => {
    const items = await rows(
      db,
      "select person_id, tribe_id, degree, alternatives from public.placement_items where run_id = $1 and status = 'proposed'",
      [run],
    );
    // 14 members: two are left over because the weeknight tribe keeps room for two established members, which the matching engine insists on
    expect(items.length).toBe(12);
    for (const it of items) {
      expect(it.degree).toBeGreaterThanOrEqual(60);
      const own = await rows(
        db,
        "select r_degree from public.match_candidates($1) where r_tribe = $2",
        [it.person_id, it.tribe_id],
      );
      expect(own[0].r_degree).toBeGreaterThanOrEqual(60);
      expect(Array.isArray(it.alternatives)).toBe(true);
      expect(it.alternatives.length).toBeLessThanOrEqual(3);
    }
  });

  it("is the same plan every time it is made from the same data", async () => {
    const first = await rows(
      db,
      "select person_id, tribe_id, degree, seq from public.placement_items where run_id = $1 and status = 'proposed' order by person_id",
      [run],
    );
    await o.call("placement_run_cancel", run);
    const again = await planRun(o, {});
    const second = await rows(
      db,
      "select person_id, tribe_id, degree, seq from public.placement_items where run_id = $1 and status = 'proposed' order by person_id",
      [again],
    );
    expect(second).toEqual(first);
    run = again;
  });

  it("goes to the member with the fewest suitable tribes first, whoever filled in the form earlier", async () => {
    const ordered = await rows(
      db,
      "select person_id, seq, cand_count from public.placement_items where run_id = $1 and status = 'proposed' order by seq",
      [run],
    );
    const counts = ordered.map((r) => r.cand_count as number);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("allows one run at a time", async () => {
    await expectCode(o.call("placement_run_new", "{}"), "22023");
    await expect(o.call("placement_run_new", "{}")).rejects.toThrow(
      /already in progress/,
    );
  });

  it("shows the tribes a member could be moved to, best first, and moves them only to a tribe that suits them", async () => {
    const it = (
      await rows(
        db,
        "select person_id, tribe_id from public.placement_items where run_id = $1 and status = 'proposed' order by seq limit 1",
        [run],
      )
    )[0];
    const opts = await o.call("placement_options", run, it.person_id);
    const degrees = opts.map((x: { degree: number }) => x.degree);
    expect(degrees).toEqual([...degrees].sort((a: number, b: number) => b - a));
    expect(
      opts.every(
        (x: Record<string, unknown>) =>
          typeof x.name === "string" && typeof x.below_floor === "boolean",
      ),
    ).toBe(true);
    const other = opts.find((x: { tribe: string }) => x.tribe !== it.tribe_id);
    if (other) {
      await o.call("placement_adjust", run, it.person_id, "move", other.tribe);
      expect(
        (
          await rows(
            db,
            "select tribe_id, moved from public.placement_items where run_id = $1 and person_id = $2",
            [run, it.person_id],
          )
        )[0],
      ).toEqual({ tribe_id: other.tribe, moved: true });
      await o.call("placement_adjust", run, it.person_id, "move", it.tribe_id);
    }
    await expectCode(
      o.call("placement_adjust", run, it.person_id, "move", ZERO),
      "22023",
    );
    await expectCode(
      o.call("placement_adjust", run, it.person_id, "sideways", null),
      "22023",
    );
    await expectCode(
      o.call("placement_adjust", run, member, "remove", null),
      "22023",
    ); // not in the plan
  });

  it("takes someone out of the run, or puts them on hold so no later run considers them, until God Mode clears the hold", async () => {
    const ps = await rows(
      db,
      "select person_id from public.placement_items where run_id = $1 and status = 'proposed' order by seq",
      [run],
    );
    const before = await proposedCount(db, run);
    await o.call("placement_adjust", run, ps[0].person_id, "remove", null);
    await o.call("placement_adjust", run, ps[1].person_id, "hold", null);
    expect(await proposedCount(db, run)).toBe(before - 2);
    expect(
      (await o.call("placement_holds_list")).map(
        (h: { person: string }) => h.person,
      ),
    ).toContain(ps[1].person_id);
    expect(await reasonOf(ps[1].person_id)).toBe("held");
    await o.call("placement_hold_clear", ps[1].person_id);
    expect(await reasonOf(ps[1].person_id)).toBeNull();
    expect(
      (await o.call("placement_holds_list")).map(
        (h: { person: string }) => h.person,
      ),
    ).not.toContain(ps[1].person_id);
  });

  it("is cancelled in one press while nobody has been placed", async () => {
    await o.call("placement_run_cancel", run);
    expect(
      (
        await rows(
          db,
          "select status from public.placement_runs where id = $1",
          [run],
        )
      )[0].status,
    ).toBe("cancelled");
    await expectCode(o.call("placement_run_approve", run, 1), "22023");
    await expectCode(
      o.call("placement_adjust", run, member, "remove", null),
      "22023",
    );
  });
});

describe("approving", () => {
  let run: string;

  it("needs the switch to match the plan, the count the page showed, and every small tribe decided", async () => {
    await save({ mode: "on", min_tribe: 8 });
    run = await planRun(o, {});
    const n = await proposedCount(db, run);
    expect(n).toBeGreaterThan(0);
    const smalls = await rows(
      db,
      "select tribe_id from public.placement_teams where run_id = $1 and small",
      [run],
    );
    expect(smalls.length).toBeGreaterThan(0); // 14 members across two tribes with a smallest tribe of 8 leaves the Sunday tribe short
    await expect(o.call("placement_run_approve", run, n)).rejects.toThrow(
      /too small/,
    );
    await resolveAll(db, o, run, "keep");
    await expect(o.call("placement_run_approve", run, n + 1)).rejects.toThrow(
      /plan has changed/,
    );
    await save({ mode: "rehearsal" });
    await expect(o.call("placement_run_approve", run, n)).rejects.toThrow(
      /switch has changed/,
    );
    await save({ mode: "off" });
    await expect(o.call("placement_run_approve", run, n)).rejects.toThrow(
      /switched Off/,
    );
    await save({ mode: "on" });
    expect(await o.call("placement_run_approve", run, n)).toEqual({
      status: "approved",
      members: n,
    });
    expect(await o.call("placement_run_approve", run, n)).toEqual({
      status: "approved",
      already: true,
    }); // a second press changes nothing
  });

  it("freezes the plan: nothing can be adjusted once it is approved", async () => {
    const one = (
      await rows(
        db,
        "select person_id from public.placement_items where run_id = $1 and status = 'proposed' limit 1",
        [run],
      )
    )[0];
    if (one)
      await expectCode(
        o.call("placement_adjust", run, one.person_id, "remove", null),
        "22023",
      );
  });

  it("will not let a run go backwards: the state machine allows only the forward moves", async () => {
    const bad: [string, string][] = [
      ["cancelled", "planned"],
      ["cancelled", "approved"],
      ["placed", "approved"],
      ["placed", "planned"],
      ["closed", "placed"],
      ["undone", "placed"],
      ["planning", "approved"],
    ];
    for (const [from, to] of bad) {
      const id = randomUUID();
      await db.admin.query(
        "update public.placement_runs set status = 'cancelled' where status in ('planning', 'planned', 'approved', 'placing')",
      );
      await db.admin.query(
        `insert into public.placement_runs (id, season_id, status, rehearsal, grace_days, seats_free, min_tribe, pace_per_hour, send_from, send_until, hold_hours, model_version)
         values ($1, $2, 'cancelled', false, 7, 1, 5, 100, 9, 19, 24, (select version from public.match_models where active))`,
        [id, season],
      );
      await db.admin.query(
        "alter table public.placement_runs disable trigger placement_runs_guard",
      );
      await db.admin.query(
        "update public.placement_runs set status = $2, undone_at = case when $2 = 'undone' then now() end where id = $1",
        [id, from],
      );
      await db.admin.query(
        "alter table public.placement_runs enable trigger placement_runs_guard",
      );
      await expectCode(
        db.admin.query(
          "update public.placement_runs set status = $2 where id = $1",
          [id, to],
        ),
        "22023",
      );
      await db.admin.query("delete from public.placement_runs where id = $1", [
        id,
      ]);
    }
  });
});

describe("a member the plan cannot place", () => {
  it("becomes waiting demand for the leader board when the plan is approved, and the app's own row is never overwritten", async () => {
    await db.admin.query(
      "update public.placement_runs set status = 'cancelled' where status in ('planning', 'planned', 'approved', 'placing')",
    );
    const lonely = await readyMember(db, k, season, "Lonely", {
      times: ["saturday-morning"],
      community: "education",
    });
    const run = await planRun(o, {});
    const item = (
      await rows(
        db,
        "select status, reason from public.placement_items where run_id = $1 and person_id = $2",
        [run, lonely.id],
      )
    )[0];
    expect(item).toMatchObject({ status: "unplaced" });
    expect(["no_tribe", "below_bar"]).toContain(item.reason);
    await resolveAll(db, o, run, "keep");
    const n = await proposedCount(db, run);
    await o.call("placement_run_approve", run, n);
    const demand = await rows(
      db,
      "select person_id from public.match_demand where person_id = $1",
      [lonely.id],
    );
    expect(demand.length).toBe(1);
    await o.call("placement_run_cancel", run).catch(() => undefined);
  });
});
