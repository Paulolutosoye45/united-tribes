import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearLogs, makeOwner, sqlOf, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { TestDb } from "./helpers";

// Phase 5, made fast: 20,000 people and 1,000,000 recorded events, and every tab of the dashboard opens in under 2 seconds.
// The page reads the daily and hourly summaries, rebuilt on the five-minute heartbeat, not the raw events.

const PEOPLE = 20_000;
const EVENTS = 1_000_000;
const LIMIT_MS = 2_000;

let db: TestDb;
let k: Kit;
let ok: OwnerKit;
let sql: ReturnType<typeof sqlOf>;
const timings: Record<string, number> = {};

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const out = await fn();
  timings[label] = Math.round(performance.now() - start);
  return out;
}

beforeAll(async () => {
  ({ db, k } = await newKit());
  sql = sqlOf(db);
  const S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id as string;
  await sql("update public.seasons set status = 'running' where id = $1", [S]);
  const t = await k.tribe(S, { name: "Scale 0" });
  void t;
  ok = await makeOwner(db);

  await timed("seed people", async () => {
    await sql(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       select 'scale' || g || '@example.org', now(), '{}'::jsonb from generate_series(1, ${PEOPLE}) g`,
    );
    await sql("update public.people set created_at = now() - random() * interval '120 days' where email like 'scale%'");
  });

  const tribes: string[] = [(await db.admin.query("select id from public.tribes where name = 'Scale 0'")).rows[0].id];
  for (let i = 0; i < 39; i++) tribes.push((await k.tribe(S, { name: `Scale ${i + 1}` })).tribe);

  await db.admin.query("begin");
  await db.admin.query("set local session_replication_role = replica");
  await timed("seed profiles, places and meetings", async () => {
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
          season_goal_id, goal_baseline, meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds, submitted_at)
       select p.id, $1, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed',
              (array['mainland', 'iganmu-surulere', 'island-lekki', 'other-nigeria', 'abroad'])[1 + (row_number() over (order by p.id) % 5)::int],
              c.id, 'growing',
              (select g.id from public.season_goals g where g.community_id = c.id order by g.sort limit 1), 3, 'either', array['weeknight-evening'], false, 0,
              60 + (random() * 900)::int, p.created_at + interval '1 day'
         from public.people p
         join lateral (select id from public.communities order by id offset (abs(hashtext(p.id::text)) % 6) limit 1) c on true
        where p.email like 'scale%' and abs(hashtext(p.id::text)) % 10 < 7`,
      [S],
    );
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by, joined_at, agreed_at)
       select ($2::uuid[])[1 + (row_number() over (order by m.person_id) % 40)::int], m.person_id, $1, 1, 90, 'test', '{}'::jsonb, current_date + 14,
              m.submitted_at + interval '2 days', m.submitted_at + interval '3 days'
         from public.member_profiles m where abs(hashtext(m.person_id::text)) % 10 < 4`,
      [S, tribes],
    );
    await db.admin.query(
      `insert into public.tribe_logs (tribe_id, week, held, logged_by, logged_at)
       select t.id, w, true, t.leader_id, now() - (13 - w) * interval '1 day' from public.tribes t cross join generate_series(1, 8) w`,
    );
    await db.admin.query(
      `insert into public.tribe_attendance (tribe_id, week, person_id, status)
       select m.tribe_id, w, m.person_id, case when random() < 0.7 then 'present' else 'absent' end
         from public.tribe_members m cross join generate_series(1, 8) w`,
    );
    await db.admin.query(
      `insert into public.messages (person_id, template, status, channel, created_at, sent_at)
       select p.id, 'welcome', (array['sent', 'delivered', 'read', 'failed', 'queued'])[1 + (g % 5)], (array['whatsapp', 'email', 'sms'])[1 + (g % 3)],
              now() - random() * interval '60 days', now() - random() * interval '60 days'
         from generate_series(1, 50000) g
         join lateral (select id from public.people where email like 'scale%' offset (g % 20000) limit 1) p on true`,
    );
    await db.admin.query(
      `insert into public.signin_attempts (at, outcome, counted, flow, route, decided_at)
       select now() - random() * interval '30 days', (array['delivered', 'sent', 'failed', 'declined_wait', 'unmatched'])[1 + (g % 5)], g % 5 < 3, 'sign_in', 'official', now()
         from generate_series(1, 20000) g`,
    );
    await db.admin.query("commit");
  });

  await timed("seed events", async () => {
    await sql(
      `with ids as (select id, row_number() over (order by id) - 1 as idx from public.people where email like 'scale%')
       insert into public.activity_events (at, day, person_id, kind, meta)
       select t.at, (t.at at time zone 'Africa/Lagos')::date, p.id,
              case when t.g % 20 = 0 then 'visit' else 'screen' end,
              case when t.g % 20 = 0 then '{"device":"phone"}'::jsonb else '{"screen":"home","device":"phone","speed":"ok"}'::jsonb end
         from (select g, now() - random() * interval '390 days' as at, floor(random() * ${PEOPLE})::int as pidx from generate_series(1, ${EVENTS}) g) t
         join ids p on p.idx = t.pidx`,
    );
    await sql(
      `with ids as (select id, row_number() over (order by id) - 1 as idx from public.people where email like 'scale%')
       insert into public.event_log (at, actor_id, action, entity, entity_id)
       select now() - random() * interval '390 days', p.id,
              (array['testimony.submitted', 'care.call', 'circle.log', 'leader.reviewed', 'role.granted', 'message.retried', 'tribe.saved', 'match.chosen'])[1 + (t.g % 8)],
              'person', 'x'
         from (select g, floor(random() * ${PEOPLE})::int as pidx from generate_series(1, 200000) g) t
         join ids p on p.idx = t.pidx`,
    );
    await sql("analyze");
  });
}, 600_000);

afterAll(async () => {
  const line = `activity at scale (ms): ${JSON.stringify(timings)}`;
  process.stderr.write(`${line}\n`);
  if (process.env.ACTIVITY_SCALE_OUT) writeFileSync(process.env.ACTIVITY_SCALE_OUT, `${line}\n`);
  await db?.close();
});

describe("at 20,000 people and 1,000,000 events", () => {
  it("holds what was planted", async () => {
    expect(Number((await sql("select count(*) as n from public.activity_events"))[0].n)).toBe(EVENTS);
    expect(Number((await sql("select count(*) as n from public.people where email like 'scale%'"))[0].n)).toBe(PEOPLE);
  });

  it("builds the summaries from scratch in a reasonable time, and refreshes on the heartbeat quickly", async () => {
    await timed("full fill", () => sql("select public.activity_refresh(now(), true)"));
    expect(Number((await sql("select count(*) as n from public.activity_person_day"))[0].n)).toBeGreaterThan(100_000);
    expect(Number((await sql("select count(*) as n from public.activity_hourly"))[0].n)).toBeGreaterThan(1_000);
    expect(timings["full fill"]).toBeLessThan(120_000);
    await timed("heartbeat refresh", () => sql("select public.activity_refresh(now(), false)"));
    expect(timings["heartbeat refresh"]).toBeLessThan(15_000);
  }, 300_000);

  const TABS: [string, string, unknown[]][] = [
    ["Pulse", "activity_pulse", []],
    ["Pulse brief", "activity_brief", []],
    ["Funnels (member)", "activity_funnels", ["member", null, null, null]],
    ["Funnels (member by zone)", "activity_funnels", ["member", null, null, "zone"]],
    ["Funnels (member by community)", "activity_funnels", ["member", null, null, "community"]],
    ["Funnels (leader)", "activity_funnels", ["leader", null, null, null]],
    ["Funnel people", "activity_funnel_people", ["member", 3, "stopped", null, null, 100]],
    ["Compare communities", "activity_compare", ["community"]],
    ["Compare zones", "activity_compare", ["zone"]],
    ["Compare tribes", "activity_compare", ["tribe"]],
    ["Retention grid", "activity_retention", [12]],
    ["Heat map", "activity_heatmap", [28]],
    ["Stakeholders", "activity_stakeholders", []],
    ["Quality and integrity", "activity_integrity", []],
    ["Messages and sign-in", "activity_messages", []],
    ["Audit trail", "activity_audit", [null, null, null, null, null, null, 100]],
    ["Audit trail (a week, one area)", "activity_audit", [null, "care", null, "2000-01-01", null, null, 100]],
    ["Audit areas", "activity_audit_areas", []],
    ["Settings", "activity_settings_get", []],
  ];

  for (const [label, fn, params] of TABS) {
    it(`opens "${label}" in under ${LIMIT_MS / 1000} seconds`, async () => {
      await ok.call(fn, ...params); // warm the plan cache once, as a person's second click would
      const ms = await timed(label, async () => {
        const start = performance.now();
        const r = await ok.call(fn, ...params);
        expect(r).toBeTruthy();
        return performance.now() - start;
      });
      expect(ms).toBeLessThan(LIMIT_MS);
    });
  }

  it("still hides small groups and young members at this size", async () => {
    const r = (await ok.call("activity_audit", "young", null, null, null, null, null, 200)) as { rows: { who: string; person_id: string | null }[] };
    for (const row of r.rows) {
      expect(row.who).toBe("Young member");
      expect(row.person_id).toBeNull();
    }
    const pulse = (await ok.call("activity_pulse")) as { active: { d30: number } };
    expect(pulse.active.d30).toBeGreaterThan(1_000);
  });

  it("never lets another role read any of it, at any size", async () => {
    const admin = await k.staff("Adm", "admin");
    await expect(db.asUser(admin.id, (q) => q("select count(*) from public.activity_events"))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(admin.id, (q) => q("select public.activity_pulse()"))).rejects.toMatchObject({ code: "42501" });
    await clearLogs(db);
  });
});
