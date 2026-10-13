/**
 * The migration that renamed "circle" to "tribe" and "tribe" to "community" (20261210000100_tribes_naming.sql).
 *
 * These tests build a database exactly as it stood BEFORE that migration (every earlier migration, nothing after),
 * fill it with the kinds of rows real people had already created, apply the migration, and check that nothing was lost,
 * everything speaks the new names, and the platform still does its work on the old data.
 *
 * This file is the one place that still writes the old words, on purpose: it is describing the old database.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

const MIGRATION = path.resolve(__dirname, "../../supabase/migrations/20261210000100_tribes_naming.sql");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let root: Client;
let db: Client;
let name: string;
const ids: Record<string, string> = {};
const who: Record<string, string> = {};
let counts: Record<string, number> = {};

const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Row[];

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const out = await fn();
    await db.query("commit");
    return out;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function user(fullName: string) {
  const email = `${randomUUID().slice(0, 8)}@example.org`;
  const { rows } = await db.query("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]);
  await db.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [rows[0].id, fullName, fullName.split(" ")[0]]);
  return rows[0].id as string;
}

async function counted() {
  const out: Record<string, number> = {};
  const tables = await q("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1");
  for (const t of tables) out[t.relname] = Number((await q(`select count(*) n from public.${t.relname}`))[0].n);
  return out;
}

beforeAll(async () => {
  const port = inject("pgPort");
  name = `t_upg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  root = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await root.connect();
  await root.query(`create database ${name} template ut_before_tribes`);
  db = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: name });
  await db.connect();

  // --- people and the catalogue, as the old application wrote them ---------------------------------------------------
  const get = async (table: string, slug: string) => (await q(`select id from public.${table} where slug = $1`, [slug]))[0].id as string;
  const season = (await q("select id from public.seasons where status in ('planning','open') order by starts_on limit 1"))[0].id as string;
  ids.season = season;
  ids.track = await get("tracks", "builders");
  ids.tribe = await get("tribes", "professionals");
  ids.second = await get("tribes", "marriage-relationships");
  ids.goal = await get("season_goals", "step-into-a-leadership-role");
  ids.age = await get("age_ranges", "33-40");

  who.leader = await user("Tola Leader");
  who.member = await user("Ada Member");
  who.drafter = await user("Dayo Drafter");
  who.champion = await user("Chi Champion");
  who.parent = await user("Pat Parent");

  await db.query("insert into public.person_roles (person_id, role, centre_id) select id, 'leader', centre_id from public.people where id = $1", [who.leader]);
  await db.query("insert into public.person_roles (person_id, role, centre_id) select id, 'tribe_champion', centre_id from public.people where id = $1", [who.champion]);
  await db.query("insert into public.tribe_champions (person_id, tribe_id) values ($1, $2)", [who.champion, ids.tribe]);
  await db.query(
    `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at)
     values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())`,
    [who.leader, JSON.stringify({ calling: { track: "builders", tribe: "professionals", goal: "step-into-a-leadership-role" }, style: { leadBest: "structure" } })],
  );
  await db.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [who.leader]);

  // a published circle with a name the leader typed, and a story that uses the old word
  ids.circle = (
    await q(
      `insert into public.circles (season_id, leader_id, status, name, track_id, tribe_id, season_goal_id, fixed, circle_type, story,
          meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
       values ($1, $2, 'approved', 'Builders Circle', $3, $4, $5, '{track,tribe,goal}', 'mixed', 'A circle for people building careers.',
          3, '20:00', 'weeknight-evening', 'in_person', 'mainland', 'Near the bridge', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
       returning id`,
      [ids.season, who.leader, ids.track, ids.tribe, ids.goal],
    )
  )[0].id;

  // a member who filled in the form: a profile, a second-choice tribe, words of their own, then matched and joined
  await db.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, circle_mix, zone, tribe_id, second_tribe_id, tribe_other, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times, style_social, style_structure, support_load, duration_seconds, ai_assist)
     values ($1, $2, $3, 'female', 'mixed', 'mainland', $4, $5, 'People like me who also want a circle of friends', 'growing', $6, 3, 'either',
        '{weeknight-evening}', 0, 0, 0, 250, $7::jsonb)`,
    [who.member, ids.season, ids.age, ids.tribe, ids.second, ids.goal, JSON.stringify({ tribe: { shown: ["professionals"], chosen: ["professionals"], via: "engine" }, tribe_second: { shown: ["marriage-relationships"] } })],
  );
  await asUser(who.member, () => db.query("select public.match_me(true)"));
  await asUser(who.member, () => db.query("select public.choose_circle($1, true, 'cov-1')", [ids.circle]));

  // a form saved half way, at the tribe step, and one that says what the old keys said
  await db.query("insert into public.intake_drafts (person_id, step, answers) values ($1, 'tribe', $2::jsonb)", [
    who.drafter,
    JSON.stringify({ tribe: "professionals", secondTribe: "marriage-relationships", tribeOther: "my own words", circleMix: "mixed", story: "I want a circle of friends." }),
  ]);

  // what the platform wrote as it ran
  await db.query("insert into public.testimonies (person_id, circle_id, week, body, share_with, credit, status, tribe_id, season_goal_id) values ($1, $2, 1, 'God has been faithful to me.', 'circle', 'first_name', 'circle_approved', $3, $4)", [who.member, ids.circle, ids.tribe, ids.goal]);
  await db.query("insert into public.event_log (actor_id, action, entity, entity_id, meta) values (null, 'circle.approved', 'circle', $1, $2::jsonb), (null, 'tribe.saved', 'tribe', $3, $4::jsonb)", [
    ids.circle, JSON.stringify({ circle: ids.circle, name: "Builders Circle" }), ids.tribe, JSON.stringify({ tribe: ids.tribe, role: "tribe_champion" }),
  ]);
  await db.query("insert into public.reports (centre_id, kind, period_start, period_end, season_id, tribe_id, data, summary, summary_by) select centre_id, 'tribe', date '2026-09-01', date '2026-09-07', $1, $2, $3::jsonb, $4, 'plain' from public.people where id = $5", [
    ids.season, ids.tribe, JSON.stringify({ kind: "tribe", tribe: { id: ids.tribe, name: "Professionals" }, circles: [{ circle_id: ids.circle, name: "Builders Circle" }] }),
    "The Professionals tribe has 1 member in 1 circle. Circles to look at: Builders Circle.", who.leader,
  ]);
  await db.query("insert into public.centre_settings (centre_id, key, value) select centre_id, 'vision', 'A church where every member belongs to a circle and is thriving.' from public.people where id = $1", [who.leader]);

  counts = await counted();
  await db.query(fs.readFileSync(MIGRATION, "utf8"));
}, 120_000);

afterAll(async () => {
  await db?.end();
  await root?.query(`drop database if exists ${name} with (force)`);
  await root?.end();
});

describe("nothing is lost", () => {
  it("keeps every row of every table", async () => {
    const after = await counted();
    const renamed = (t: string) => (t === "tribes" ? "communities" : t.replace("circle", "tribe").replace(/^tribe(_champions|_prompts)$/, "community$1"));
    for (const [table, n] of Object.entries(counts)) {
      expect(after[renamed(table)], `${table} -> ${renamed(table)}`).toBe(n);
    }
    expect(Object.keys(after).length).toBe(Object.keys(counts).length);
  });

  it("leaves no table, column, function or type with the old word", async () => {
    expect(await q("select relname from pg_class where relnamespace in ('public'::regnamespace, 'bi'::regnamespace) and relname ~* 'circle'")).toEqual([]);
    expect(await q("select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace in ('public'::regnamespace, 'bi'::regnamespace) and c.relkind in ('r','m') and attnum > 0 and not attisdropped and attname ~* 'circle'")).toEqual([]);
    expect(await q("select proname from pg_proc where pronamespace = 'public'::regnamespace and prokind = 'f' and (proname ~* 'circle' or pg_get_functiondef(oid) ~* 'circle')")).toEqual([]);
    expect(await q("select typname from pg_type where typnamespace = 'public'::regnamespace and typname ~* 'circle'")).toEqual([]);
  });

  it("keeps who may call what: no function lets signed-out visitors in, and each keeps its permission list", async () => {
    const rows = await q(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authed
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname in ('my_tribe', 'choose_tribe', 'save_tribe_card', 'tribe_roster', 'community_dashboard')`,
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.anon, r.proname).toBe(false);
      expect(r.authed, r.proname).toBe(true);
    }
  });
});

describe("the structure speaks the new names", () => {
  it("names the groups of twelve 'tribes' and the interest areas 'communities'", async () => {
    expect((await q("select name, fixed from public.tribes where id = $1", [ids.circle]))[0]).toEqual({ name: "Builders Circle", fixed: ["track", "community", "goal"] });
    expect((await q("select slug from public.communities order by sort limit 2")).map((r) => r.slug)).toEqual(["business-entrepreneurship", "professionals"]);
    expect((await q("select community_id from public.tribes where id = $1", [ids.circle]))[0].community_id).toBe(ids.tribe);
    expect((await q("select tribe_id from public.tribe_members where person_id = $1", [who.member]))[0].tribe_id).toBe(ids.circle);
  });

  it("renames the role and keeps who held it", async () => {
    expect((await q("select role from public.person_roles where person_id = $1", [who.champion])).map((r) => r.role)).toContain("community_champion");
    expect((await q("select count(*)::int n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'app_role' and e.enumlabel ~ 'tribe_champion'"))[0].n).toBe(0);
    expect((await q("select community_id from public.community_champions where person_id = $1", [who.champion]))[0].community_id).toBe(ids.tribe);
  });

  it("keeps words people typed exactly as they typed them", async () => {
    expect((await q("select name, story from public.tribes where id = $1", [ids.circle]))[0]).toEqual({ name: "Builders Circle", story: "A circle for people building careers." });
    expect((await q("select community_other from public.member_profiles where person_id = $1", [who.member]))[0].community_other).toBe("People like me who also want a circle of friends");
    expect((await q("select body from public.testimonies where person_id = $1", [who.member]))[0].body).toBe("God has been faithful to me.");
    expect((await q("select answers->>'story' s from public.intake_drafts where person_id = $1", [who.drafter]))[0].s).toBe("I want a circle of friends.");
  });
});

describe("the words the application stored", () => {
  it("moves a half-finished form to the new step and keys, so nobody loses it", async () => {
    const d = (await q("select step, answers from public.intake_drafts where person_id = $1", [who.drafter]))[0];
    expect(d.step).toBe("community");
    expect(d.answers).toEqual({ community: "professionals", secondCommunity: "marriage-relationships", communityOther: "my own words", tribeMix: "mixed", story: "I want a circle of friends." });
  });

  it("moves leader applications, the quality log, match results and reports to the new keys", async () => {
    expect((await q("select answers #>> '{calling,community}' c, answers #>> '{calling,tribe}' t from public.leader_applications where person_id = $1", [who.leader]))[0]).toEqual({ c: "professionals", t: null });
    const log = (await q("select ai_assist from public.member_profiles where person_id = $1", [who.member]))[0].ai_assist;
    expect(Object.keys(log).sort()).toEqual(["community", "community_second"]);
    const rec = (await q("select components, reasons from public.match_recommendations limit 1"))[0];
    expect(Object.keys(rec.components)).toContain("community");
    expect(Object.keys(rec.components)).not.toContain("tribe");
    expect(rec.reasons.join(" ")).not.toMatch(/\btribe_(same|related|second)\b/);
    const report = (await q("select kind, data, summary from public.reports where kind = 'community'"))[0];
    expect(report.data).toEqual({ kind: "community", community: { id: ids.tribe, name: "Professionals" }, tribes: [{ tribe_id: ids.circle, name: "Builders Circle" }] });
    // The summary is a sentence the application wrote, so it is rewritten whole (a group's own name inside it reads with the new word too).
    expect(report.summary).toBe("The Professionals community has 1 member in 1 tribe. Tribes to look at: Builders Tribe.");
    const weights = (await q("select weights from public.match_models where active"))[0].weights;
    expect(Object.keys(weights).sort()).toEqual(["community", "faith", "goal", "place", "rhythm", "stage", "style"]);
    expect(Object.values(weights as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("moves message parameters, events, testimony settings and the vision line", async () => {
    const msg = (await q("select params from public.messages where params::text ~* 'tribe' limit 1"))[0];
    if (msg) expect(Object.keys(msg.params)).not.toContain("circle");
    expect((await q("select action, entity, meta from public.event_log where action like 'tribe.approved'"))[0]).toEqual({ action: "tribe.approved", entity: "tribe", meta: { tribe: ids.circle, name: "Builders Circle" } });
    expect((await q("select action, entity, meta from public.event_log where action = 'community.saved'"))[0]).toEqual({ action: "community.saved", entity: "community", meta: { community: ids.tribe, role: "community_champion" } });
    expect((await q("select share_with, status from public.testimonies where person_id = $1", [who.member]))[0]).toEqual({ share_with: "tribe", status: "tribe_approved" });
    expect((await q("select value from public.centre_settings where key = 'vision'"))[0].value).toBe("A church where every member belongs to a tribe and is thriving.");
  });

  it("rewrites the guides and training in the new words but keeps 'United Tribes' as the programme's name", async () => {
    const text = (await q("select string_agg(concat_ws(' ', big_idea, leader_tip, opening_question, practice, prayer, step_hint, plan::text, questions::text), ' ') t from public.week_guides"))[0].t as string;
    expect(text).not.toMatch(/\bcircles?\b/i);
    const lessons = (await q("select lesson::text t from public.academy_modules")).map((r) => r.t).join(" ");
    expect(lessons).toContain("United Tribes");
    expect(lessons).not.toContain("United Communities");
  });

  it("does not move 'last changed' times, because the update must not look like activity", async () => {
    const p = (await q("select updated_at, now() as n from public.member_profiles where person_id = $1", [who.member]))[0];
    expect(new Date(p.updated_at).getTime()).toBeLessThan(new Date(p.n).getTime() - 1);
  });
});

describe("the platform still works on the old data", () => {
  it("lets the leader read their roster, with the member who joined", async () => {
    const roster = (await asUser(who.leader, () => db.query("select public.tribe_roster($1) as r", [ids.circle]))).rows[0].r;
    expect(JSON.stringify(roster)).toContain("Ada");
  });

  it("lets the champion see their community's page", async () => {
    const dash = (await asUser(who.champion, () => db.query("select public.community_dashboard($1, null) as r", [ids.tribe]))).rows[0].r;
    expect(dash).toBeTruthy();
    expect(JSON.stringify(dash)).toContain("Builders Circle");
  });

  it("lets the member be matched again: every key and reason is in the new words (only words people typed keep the old one)", async () => {
    const m = (await asUser(who.member, () => db.query("select public.match_me(true) as r"))).rows[0].r;
    const typed = new Set(["name", "story"]); // a leader's own words
    const stray: string[] = [];
    (function walk(value: unknown, key = "") {
      if (typeof value === "string" && !typed.has(key) && /circle/i.test(value)) stray.push(`${key}=${value}`);
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { if (/circle/i.test(k)) stray.push(`key ${k}`); walk(v, k); }
    })(m);
    expect(stray).toEqual([]);
    expect(m.tribes[0].tribe.community).toBe("Professionals");
    expect(m.tribes[0].reasons).toEqual(["goal_same", "stage_same", "community_same"]);
  });

  it("shows the leader their own tribe, with the missing-pieces list in the new words", async () => {
    const mine = (await asUser(who.leader, () => db.query("select public.my_tribe() as r"))).rows[0].r;
    expect(mine.id).toBe(ids.circle);
    expect(mine.role).toBe("leader");
    expect(mine.name).toBe("Builders Circle");
    expect(mine.missing).not.toContain("tribe");
  });

  it("shows the member the tribe they chose", async () => {
    const row = (await q("select tribe_id, status from public.tribe_members where person_id = $1", [who.member]))[0];
    expect(row.tribe_id).toBe(ids.circle);
  });

  it("still keeps people out of what is not theirs", async () => {
    await expect(asUser(who.parent, () => db.query("select public.tribe_roster($1)", [ids.circle]))).rejects.toThrow();
    expect((await asUser(who.parent, () => db.query("select id from public.tribes"))).rows).toEqual([]); // row-level security: a stranger sees no groups
  });

  it("rebuilds the BI copy under the new names with the same permissions", async () => {
    const views = (await q("select relname from pg_class where relnamespace = 'bi'::regnamespace and relkind = 'm' order by 1")).map((r) => r.relname);
    expect(views).toEqual(["ai_fields", "care_weekly", "kpi_daily", "members", "messages_daily", "tribes", "weekly"]);
    expect((await q("select has_table_privilege('bi_reader', 'bi.tribes', 'select') as ok"))[0].ok).toBe(true);
    const cols = (await q("select attname from pg_attribute where attrelid = 'bi.tribes'::regclass and attnum > 0 and not attisdropped")).map((r) => r.attname);
    expect(cols).toContain("tribe_id");
    expect(cols).toContain("community");
  });
});

describe("it is safe", () => {
  it("refuses to run twice", async () => {
    await expect(db.query(fs.readFileSync(MIGRATION, "utf8"))).rejects.toThrow(/already been applied|already exists/);
  });

  it("changes nothing at all when it has to stop (all or nothing)", async () => {
    const port = inject("pgPort");
    const copy = `${name}_stop`;
    await root.query(`create database ${copy} template ut_before_tribes`);
    const c = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: copy });
    await c.connect();
    try {
      // Someone's own view leans on a function the migration has to rebuild with new parameter names: it must say so and stop.
      await c.query("create view public.someones_own_view as select * from public.kpi_circles(null::uuid)");
      const before = (await c.query("select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace")).rows[0].n;
      await expect(c.query(fs.readFileSync(MIGRATION, "utf8"))).rejects.toThrow(/has dependants/);
      expect((await c.query("select to_regclass('public.circles') is not null as old, to_regclass('public.tribes') is not null as interest, to_regclass('public.communities') is null as none")).rows[0]).toEqual({ old: true, interest: true, none: true });
      expect((await c.query("select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace")).rows[0].n).toBe(before);
      expect((await c.query("select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = 'choose_circle'")).rows[0].n).toBe(1);
    } finally {
      await c.end();
      await root.query(`drop database if exists ${copy} with (force)`);
    }
  });
});
