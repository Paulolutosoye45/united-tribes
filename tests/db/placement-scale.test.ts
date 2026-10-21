import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit } from "./builders";
import type { TestDb } from "./helpers";
import { openSeason, resolveAll } from "./placement-kit";

// Automatic placement at the size the church expects: 5,000 members who are ready, 600 tribes, and a run planned, approved and placed
// in the small steps the page takes. Each step has to finish well inside a web request, and the pages that read a run must open fast.

const MEMBERS = 5_000;
const TRIBES = 600;
const STEP_LIMIT_MS = 10_000;
const READ_LIMIT_MS = 2_000;

let db: TestDb;
let o: OwnerKit;
let season: string;
let run: string;
let proposed = 0;
const timings: Record<string, number> = {};
const slowest = { plan: 0, place: 0 };
const steps = { plan: 0, place: 0 };

const sql = async (text: string, params: unknown[] = []) =>
  (await db.admin.query(text, params)).rows;

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const out = await fn();
  timings[label] = Math.round(performance.now() - start);
  return out;
}

beforeAll(async () => {
  ({ db } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  await sql(
    "update public.tribes set status = 'closed' where status = 'approved'",
  );

  await timed("seed leaders and tribes", async () => {
    await sql(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       select 'sl' || g || '@example.org', now(), '{}'::jsonb from generate_series(1, ${TRIBES}) g`,
    );
    await sql(
      `insert into public.person_roles (person_id, role, centre_id)
       select p.id, 'leader', p.centre_id from public.people p where p.email like 'sl%@example.org' on conflict do nothing`,
    );
    await sql(
      `insert into public.leader_certifications (person_id, as_role)
       select p.id, 'leader' from public.people p where p.email like 'sl%@example.org'`,
    );
    await sql(
      `with leaders as (select p.id, row_number() over (order by p.email) as i from public.people p where p.email like 'sl%@example.org'),
            slots as (select * from (values (0, 'weeknight-evening', 3, '20:00'::time), (1, 'saturday-morning', 6, '09:00'::time), (2, 'sunday-afternoon', 0, '15:00'::time)) s(k, slot, day, tm))
       insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story, meeting_day, meeting_time,
                                  slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
       select $1, l.id, 'approved', 'Scale ' || l.i, (select id from public.tracks where slug = 'builders'),
              (select id from public.communities where slug = 'professionals'),
              (select g.id from public.season_goals g join public.communities t on t.id = g.community_id where t.slug = 'professionals' order by g.sort limit 1),
              '{}', 'mixed', 'My story.', s.day, s.tm, s.slot, 'in_person', case when l.i % 2 = 0 then 'mainland' else 'island-lekki' end,
              'Near the bridge', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now()
         from leaders l join slots s on s.k = (l.i % 3)::int`,
      [season],
    );
  });

  await timed("seed members", async () => {
    await sql(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       select 'sm' || g || '@example.org', now(), '{}'::jsonb from generate_series(1, ${MEMBERS}) g`,
    );
    await db.admin.query("begin");
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      `with ms as (select p.id, row_number() over (order by p.email) as i from public.people p where p.email like 'sm%@example.org')
       insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id, goal_baseline,
                                           meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds, submitted_at, updated_at)
       select m.id, $1, (select id from public.age_ranges where slug = '33-40'), (case when m.i % 2 = 0 then 'female' else 'male' end)::public.gender_kind, 'mixed',
              case when (m.i % 6) < 3 then 'mainland' else 'island-lekki' end,
              (select id from public.communities where slug = 'professionals'),
              'growing',
              (select g.id from public.season_goals g join public.communities t on t.id = g.community_id where t.slug = 'professionals' order by g.sort limit 1),
              3, 'either',
              array[(array['weeknight-evening', 'saturday-morning', 'sunday-afternoon'])[1 + (m.i % 3)::int]],
              false, ((m.i % 3) - 1)::int, 250, now() - interval '20 days', now() - interval '20 days'
         from ms m`,
      [season],
    );
    await db.admin.query(
      `insert into public.consents (person_id, purpose, granted, version)
       select p.id, 'matching', true, 't' from public.people p where p.email like 'sm%@example.org'`,
    );
    await db.admin.query("commit");
    await sql("analyze");
  });

  await o.call(
    "placement_settings_save",
    JSON.stringify({ mode: "on", min_tribe: 4 }),
  );
}, 900_000);

afterAll(async () => {
  const line = `placement at scale (ms): ${JSON.stringify(timings)}; plan steps ${steps.plan} (slowest ${slowest.plan}), place steps ${steps.place} (slowest ${slowest.place})`;
  process.stderr.write(`${line}\n`);
  if (process.env.PLACEMENT_SCALE_OUT)
    writeFileSync(process.env.PLACEMENT_SCALE_OUT, `${line}\n`);
  await db?.close();
});

describe("at 5,000 members and 600 tribes", () => {
  it("holds what was planted", async () => {
    expect(
      (await sql("select count(*)::int n from public.member_profiles"))[0].n,
    ).toBe(MEMBERS);
    expect(
      (
        await sql(
          "select count(*)::int n from public.tribes where status = 'approved'",
        )
      )[0].n,
    ).toBe(TRIBES);
  });

  it("plans the run in small steps, each one fast", async () => {
    const made = await timed("start the run", () =>
      o.call("placement_run_new", JSON.stringify({})),
    );
    run = made.run;
    const byPhase: Record<string, number[]> = {};
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      const phaseBefore = (
        await sql("select phase from public.placement_runs where id = $1", [
          run,
        ])
      )[0].phase as string;
      const t0 = performance.now();
      const st = await o.call("placement_run_step", run);
      const ms = performance.now() - t0;
      void start;
      (byPhase[phaseBefore] ??= []).push(Math.round(ms));
      steps.plan++;
      slowest.plan = Math.max(slowest.plan, Math.round(ms));
      if (st.status !== "planning") break;
    }
    for (const [phase, list] of Object.entries(byPhase)) {
      timings[`plan ${phase}: steps`] = list.length;
      timings[`plan ${phase}: slowest step`] = Math.max(...list);
      timings[`plan ${phase}: total`] = list.reduce((a, b) => a + b, 0);
    }
    expect(slowest.plan).toBeLessThan(STEP_LIMIT_MS);
    const view = await o.call("placement_run_view", run);
    expect(view.run.status).toBe("planned");
    proposed = (
      await sql(
        "select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed'",
        [run],
      )
    )[0].n;
    expect(proposed).toBeGreaterThan(MEMBERS * 0.9);
    // every proposal is at or above the floor and inside a tribe's room
    expect(
      (
        await sql(
          "select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed' and degree < 60",
          [run],
        )
      )[0].n,
    ).toBe(0);
    expect(
      (
        await sql(
          `select count(*)::int n from (select tribe_id, count(*) c from public.placement_items where run_id = $1 and status = 'proposed' group by 1) x where c > 12`,
          [run],
        )
      )[0].n,
    ).toBe(0);
  }, 900_000);

  it("opens the pages that read the run in under 2 seconds", async () => {
    const reads: [string, () => Promise<unknown>][] = [
      ["overview", () => o.call("placement_overview")],
      ["run view", () => o.call("placement_run_view", run)],
      [
        "first page of people",
        () => o.call("placement_run_items", run, "proposed", 100, 0),
      ],
      [
        "a page deep in the list",
        () => o.call("placement_run_items", run, "proposed", 100, 4000),
      ],
      [
        "people not placed",
        () => o.call("placement_run_items", run, "unplaced", 100, 0),
      ],
      ["settings", () => o.call("placement_settings_get")],
    ];
    for (const [label, fn] of reads) {
      await fn(); // the plan cache is warm by the second click
      const ms = await timed(label, async () => {
        const start = performance.now();
        const r = await fn();
        expect(r).toBeTruthy();
        return performance.now() - start;
      });
      expect(ms, label).toBeLessThan(READ_LIMIT_MS);
    }
  });

  it("approves with the count the page showed and places everyone in steps of 50", async () => {
    await resolveAll(db, o, run, "keep");
    const n = (
      await sql(
        "select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed'",
        [run],
      )
    )[0].n;
    await timed("approve", () => o.call("placement_run_approve", run, n));
    for (let i = 0; i < 400; i++) {
      const start = performance.now();
      const r = await o.call("placement_run_place", run);
      const ms = performance.now() - start;
      steps.place++;
      slowest.place = Math.max(slowest.place, Math.round(ms));
      expect(ms).toBeLessThan(STEP_LIMIT_MS);
      if (r.left === 0) break;
    }
    const placed = (
      await sql(
        "select count(*)::int n from public.tribe_members where placed_by_run = $1 and status = 'active'",
        [run],
      )
    )[0].n;
    expect(placed).toBe(n);
    expect(
      (
        await sql(
          "select count(*)::int n from public.messages where template = 'placement_your_tribe' and created_at > now() - interval '1 hour'",
        )
      )[0].n,
    ).toBe(n);
    // no tribe is over its room, and nobody sits in two tribes
    expect(
      (
        await sql(
          "select count(*)::int n from (select tribe_id from public.tribe_members where status = 'active' group by 1 having count(*) > 12) x",
        )
      )[0].n,
    ).toBe(0);
    expect(
      (
        await sql(
          "select count(*)::int n from (select person_id from public.tribe_members where status = 'active' group by 1 having count(*) > 1) x",
        )
      )[0].n,
    ).toBe(0);
  }, 900_000);

  it("spreads the member emails at the pace set (100 an hour, inside the sending window), not all at once", async () => {
    const r = (
      await sql(
        `select count(*)::int n, count(distinct date_trunc('hour', scheduled_for))::int hours, max(scheduled_for) - min(scheduled_for) as span
           from public.messages where template = 'placement_your_tribe' and created_at > now() - interval '1 hour'`,
      )
    )[0];
    expect(r.hours).toBeGreaterThan(Math.floor(r.n / 100) - 1);
    const perHour = (
      await sql(
        `select max(c)::int m from (select count(*) c from public.messages where template = 'placement_your_tribe' and created_at > now() - interval '1 hour'
                                    group by date_trunc('hour', scheduled_for)) x`,
      )
    )[0].m;
    expect(perHour).toBeLessThanOrEqual(100);
  });

  it("runs the heartbeat in a few seconds with every one of them waiting", async () => {
    const wt = (
      await sql("select public.bootstrap_worker_token('scale') as t")
    )[0].t as string;
    const ms = await timed("heartbeat", async () => {
      const start = performance.now();
      await db.asAnon((q) =>
        q("select public.worker_placement_tick($1)", [wt]),
      );
      return performance.now() - start;
    });
    expect(ms).toBeLessThan(STEP_LIMIT_MS);
  });
});
