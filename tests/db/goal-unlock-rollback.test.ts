import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { Row, TestDb } from "./helpers";

// The way back from "Let them choose", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20261227000100) and the one with everything applied. The new
// migration must not have changed any function that already existed. The rollback file must put the lock back on every tribe it unlocked, keep
// whatever the leaders picked, leave exactly the baseline's functions and triggers, keep the three tables it added with every row in them (as
// the way back from the earlier features does), change nothing the second time, and leave the platform doing what it did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20261227000100";
const THIS = "20261228000100_goal_unlock";
/**
 * Anything built after this feature is rolled back first (newest first), so the checks below still see the database as this feature left it.
 * The files are found by name, so a later feature's way back is run here without this test having to know about it (as the older rollback tests do).
 */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20261228000100")
  .sort()
  .reverse();
const VERSION = "test-v1";
const TABLES = ["leader_goal_unlock", "leader_welcome_settings", "leader_welcome_sends"];
const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };

let k: Kit;
let o: OwnerKit;
let db: TestDb;
let baseline: Client;
let baselineName: string;
let rootClient: Client;
let seasonId: string;
let pastor: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;
const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug])).id as string;

const functions = async (c: Client) =>
  new Map(
    (
      await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)
    ).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (c: Client) =>
  (
    await c.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                    where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)
  ).rows.map((r) => r.t as string);
const tableExists = async (name: string) => (await one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `gubase_${Date.now().toString(36)}`;
  rootClient = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await rootClient.connect();
  await rootClient.query(`create database ${baselineName} template ut_before_tribes`);
  baseline = new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: baselineName });
  await baseline.connect();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && f >= "20261210000100" && f.slice(0, 14) <= LAST_BEFORE)
    .sort();
  for (const f of files) await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  ({ db, k } = await newKit());
  for (const f of LATER_DOWN) await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
  await call(pastor, "leader_fit_model_activate", ["lf-1"]);
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await db?.close();
});

describe("the way back from 'Let them choose'", () => {
  const made: { person: string; tribe: string; before: string[]; community: boolean }[] = [];
  let rowsBefore: Record<string, number>;
  let triggersBefore: string[];

  const counts = async () => {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = (await tableExists(t)) ? (await one(`select count(*)::int n from public.${t}`)).n : -1;
    out.messages = (await one("select count(*)::int n from public.messages where template = 'leader_welcome'")).n;
    return out;
  };

  it("is what the migration added and nothing else: no function that existed before was changed", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    const created = new Set<string>();
    for (const m of fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map((sig) => sig.split("(")[0]);
    expect(extra.length).toBe(14);
    expect(extra.filter((name) => !created.has(name))).toEqual([]);
    // and the one trigger it added is the only difference in triggers
    const added = (await triggers(db.admin)).filter((x) => !(triggersBeforeBaseline).includes(x));
    expect(added).toEqual(["tribes.tribes_goal_guard"]);
  });

  let triggersBeforeBaseline: string[] = [];
  beforeAll(async () => {
    triggersBeforeBaseline = await triggers(baseline);
  });

  it("starts with something to keep: leaders unlocked, one has picked, one with the community open, one locked again, one welcomed", async () => {
    for (const [name, community] of [["Ada", false], ["Bola", true], ["Chi", false]] as const) {
      const p = await k.person(name);
      await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [p.id, `${name} Surname`, name]);
      const r = await o.call("god_appoint_leader", p.id, JSON.stringify(FORM), await goalId(FORM.goal), null);
      const before = (await one("select fixed from public.tribes where id = $1", [r.tribe])).fixed as string[];
      made.push({ person: p.id, tribe: r.tribe, before, community });
      // one goal only is needed here: a second leader may lead the same goal
    }
    await o.call("god_welcome_approve", VERSION);
    await o.call("god_unlock_goal", [made[0].tribe], false, true, VERSION);
    await o.call("god_unlock_goal", [made[1].tribe], true, false, null);
    await o.call("god_unlock_goal", [made[2].tribe], false, false, null);
    // Ada picks a different goal; Bola changes her community and goal; Chi is locked again before choosing
    await call(made[0].person, "save_tribe_card", [made[0].tribe, JSON.stringify({ goal: "find-a-mentor-and-become-one" })]);
    await call(made[1].person, "save_tribe_card", [made[1].tribe, JSON.stringify({ community: "consulting", goal: "build-a-steady-client-pipeline" })]);
    await o.call("god_lock_goal", [made[2].tribe]);
    expect((await one("select fixed from public.tribes where id = $1", [made[0].tribe])).fixed.slice().sort()).toEqual(["community", "track"]);
    expect((await one("select fixed from public.tribes where id = $1", [made[1].tribe])).fixed).toEqual(["track"]);
    rowsBefore = await counts();
    expect(rowsBefore).toEqual({ leader_goal_unlock: 3, leader_welcome_settings: 1, leader_welcome_sends: 1, messages: 1 });
    triggersBefore = await triggers(db.admin);
    expect(triggersBefore).toContain("tribes.tribes_goal_guard");
  });

  it("runs the rollback file without error: it drops functions and the trigger, drops no table, and puts locks back", async () => {
    const file = `${THIS}.down.sql`;
    const text = fs.readFileSync(path.join(ROLLBACK, file), "utf8");
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\b(delete|truncate|insert)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(column|schema|type)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    // the only thing it writes is the list of locked parts on the tribes it unlocked
    const updates = [...code.matchAll(/\bupdate\s+([a-z_.]+)\s+(\w+)?\s*set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[3]}`);
    expect(updates).toEqual(["public.tribes.fixed"]);
    expect(code).not.toMatch(/\bdrop\s+table\b/i);
    // the way to take the tables out too is written in the file for a person to run, not run for them
    for (const t of TABLES) expect(text, t).toContain(`drop table if exists public.${t};`);
    await db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps the three tables and every row in them: no unlock, pick or welcome record is lost", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("puts the lock back on every tribe it had unlocked, exactly as it was, and keeps what the leaders picked", async () => {
    for (const m of made) {
      const t = await one("select t.fixed, g.slug as goal, c.slug as community from public.tribes t left join public.season_goals g on g.id = t.season_goal_id left join public.communities c on c.id = t.community_id where t.id = $1", [m.tribe]);
      expect(t.fixed.slice().sort(), m.tribe).toEqual(m.before.slice().sort());
    }
    expect((await one("select g.slug from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [made[0].tribe])).slug).toBe("find-a-mentor-and-become-one");
    const bola = await one("select g.slug goal, c.slug community, t.name from public.tribes t join public.season_goals g on g.id = t.season_goal_id join public.communities c on c.id = t.community_id where t.id = $1", [made[1].tribe]);
    expect(bola).toMatchObject({ goal: "build-a-steady-client-pipeline", community: "consulting" });
    expect((await one("select g.slug from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [made[2].tribe])).slug).toBe("step-into-a-leadership-role");
  });

  it("keeps the welcome email that was queued, and every message", async () => {
    expect((await counts()).messages).toBe(1);
    expect((await one("select status from public.messages where template = 'leader_welcome'")).status).toBe("queued");
  });

  it("stops the leaders changing their goal again: the card behaves as it did before this was added", async () => {
    await call(made[0].person, "save_tribe_card", [made[0].tribe, JSON.stringify({ goal: "build-a-reputation-for-excellent-work", god: "Our own words about prayer, written by the leader." })]);
    const t = await one("select g.slug goal, t.loving_god from public.tribes t join public.season_goals g on g.id = t.season_goal_id where t.id = $1", [made[0].tribe]);
    expect(t.goal).toBe("find-a-mentor-and-become-one");
    expect(t.loving_god).toBe("Our own words about prayer, written by the leader.");
    await expect(call(made[0].person, "tribe_goal_hints", [made[0].tribe])).rejects.toThrow(/does not exist/);
    await expect(o.call("god_unlock_goal", [made[0].tribe], false, false, null)).rejects.toThrow(/does not exist/);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(db.admin);
    const firstTriggers = await triggers(db.admin);
    const tribesBefore = await sql("select id, fixed, season_goal_id, community_id from public.tribes order by id");
    await db.admin.query(fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8"));
    const again = await functions(db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(db.admin)).toEqual(firstTriggers);
    expect(await sql("select id, fixed, season_goal_id, community_id from public.tribes order by id")).toEqual(tribesBefore);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("leaves the platform doing what it did: a member joins a tribe and is welcomed, and a leader can finish and send a card", async () => {
    const t = await k.tribe(seasonId, { capacity: 12, name: "Rollback B" });
    const person = await k.person("Joiner");
    const tm = (
      await sql(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14) returning id`,
        [t.tribe, person.id, seasonId],
      )
    )[0].id;
    expect((await one("select count(*)::int n from public.messages where dedupe_key = $1", [`welcome:${tm}`])).n).toBe(1);
    // an appointed leader still completes their own card through the unchanged saving function
    const before = await one("select academy_mode, declaration_mode from public.leader_pipeline_settings");
    await sql("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
    await call(made[2].person, "save_tribe_card", [
      made[2].tribe,
      JSON.stringify({ story: "I lead people toward their next step and I want to do it well, with honesty.", meeting_day: 3, meeting_time: "20:00", mode: "in_person", zone: "mainland" }),
    ]);
    await db.asUser(made[2].person, (q) => q("select public.submit_tribe_card($1)", [made[2].tribe]));
    expect((await one("select status from public.tribes where id = $1", [made[2].tribe])).status).toBe("submitted");
    await sql("update public.leader_pipeline_settings set academy_mode = $1, declaration_mode = $2", [before.academy_mode, before.declaration_mode]);
    // and the new functions are gone, as the apply guide says they will be
    await expect(db.admin.query("select public.god_goal_unlock_view(array[]::uuid[])")).rejects.toThrow(/does not exist/);
  });
});
