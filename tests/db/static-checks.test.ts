import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, type Row, type TestDb } from "./helpers";

// Phase 8, part two: the static checks that run on every build. They read the database as it stands after every migration, and the
// migration files themselves, and say whether the pieces of the plan are still one piece each.

let db: TestDb;
let k: Kit;
let pastor: string;

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];

/** The migrations of the leader rework and what came after it: Phase 1 (the settings) onward. */
const REWORK_FROM = "20261216000100";
const reworkFiles = () => fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= REWORK_FROM).sort();

/** Names of the functions a migration file creates (new or replaced), in the public schema. */
function functionsCreatedIn(file: string): string[] {
  const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
  const names = new Set<string>();
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) names.add(m[1].toLowerCase());
  return [...names];
}

// What Phases 2 and 3 revised (the live body plus the switches) and Phase 6 replaced (the two hooks)
const REVISED = [
  "check_leader_eligibility", "submit_leader_application", "invite_to_interview", "application_readiness", "decide_application",
  "request_referee_send", "book_interview_slot", "review_queue", "review_application", "activity_leader_rows", "on_application_stage",
  "leader_ai_clear", "worker_save_leader_ai_score", "journey_data",
  "certification_state", "refresh_certification", "sign_safeguarding", "submit_tribe_card", "book_academy_session", "record_practice",
  "submit_quiz", "academy_module", "my_academy", "my_tribe", "leader_message_flags",
  "leader_fit_gate", "leader_fit_ready",
];

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
});
afterAll(async () => {
  await db?.close();
});

describe("functions", () => {
  it("has each revised function exactly once, not a second copy from a changed argument list", async () => {
    for (const name of REVISED) {
      const copies = await sql("select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1", [name]);
      expect(copies.length, `${name}: ${JSON.stringify(copies)}`).toBe(1);
    }
  });

  it("has no function in the public schema with two argument lists", async () => {
    const rows = await sql(
      `select p.proname, count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        group by p.proname having count(*) > 1 order by 1`,
    );
    expect(rows).toEqual([]);
  });

  it("closes every function the rework added to the client roles, or lists it among the ones the app calls", async () => {
    const allowed = fs.readFileSync(path.join(__dirname, "foundation.test.ts"), "utf8");
    const listed = (name: string) => allowed.includes(`"${name}"`);
    const open: string[] = [];
    for (const file of reworkFiles()) {
      for (const name of functionsCreatedIn(file)) {
        const rows = await sql(
          `select has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
          [name],
        );
        for (const r of rows) {
          // A client may run it only if the permission test names it, and a visitor only the ones it names for visitors
          if (r.anon && !listed(name)) open.push(`${file}: ${name} is open to visitors and is not on the permission list`);
          if (r.auth && !listed(name)) open.push(`${file}: ${name} is open to signed-in people and is not on the permission list`);
        }
      }
    }
    expect(open).toEqual([]);
  });

  it("has a row level security switch on every table, and every definer function pins its search path", async () => {
    expect(await sql("select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity")).toEqual([]);
    expect(
      await sql(
        `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
            and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
      ),
    ).toEqual([]);
  });
});

describe("one copy of each rule", () => {
  const bodies = async (needle: RegExp) =>
    (await sql("select p.proname, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1"))
      .filter((r) => needle.test(r.prosrc as string))
      .map((r) => r.proname as string);

  it("has one 'members waiting' rule: goal_demand_rows, and no leader function reads the member demand table itself", async () => {
    const readers = await bodies(/match_demand/);
    const leaderSide = readers.filter((n) => /^(leader|my_leader|god_appoint|god_appointment)/.test(n));
    expect(leaderSide).toEqual([]);
    const users = await bodies(/goal_demand_rows\s*\(/);
    for (const name of ["leader_fit_options", "leader_board", "leader_suggest", "leader_offer_send"]) expect(users, name).toContain(name);
  });

  it("has one copy of the fit formula: the leader weights are read in leader_fit_options and nowhere else", async () => {
    const readers = await bodies(/weights\s*->>\s*'(judgement|care_bar|unassessed_judgement)'/);
    expect(readers).toEqual(["leader_fit_options"]);
  });

  it("has one copy of the sign-off rule: only card_template_activate marks a card signed off", async () => {
    const writers = await bodies(/update\s+public\.tribe_card_templates[\s\S]{0,400}?status\s*=\s*'signed_off'/i);
    expect(writers).toEqual(["card_template_activate"]);
    const callers = await bodies(/card_template_activate\s*\(/);
    expect(callers.sort()).toEqual(["card_template_sign_off", "card_template_sign_off_community"]);
  });

  it("keeps the readiness bars at 75 and 60, in the score and in the decision, and nowhere a third place", async () => {
    const at75 = await bodies(/(>=|<)\s*75\b/);
    const at60 = await bodies(/(>=|<)\s*60\b/);
    expect(at75).toContain("application_readiness");
    expect(at75).toContain("decide_application");
    expect(at60).toContain("application_readiness");
    expect(at60).toContain("decide_application");
    const weights = await one("select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'application_readiness'");
    expect(weights.prosrc).toMatch(/calling \* 30/);
    expect(weights.prosrc).toMatch(/scen \* 25/);
    expect(weights.prosrc).toMatch(/refs \* 25/);
    expect(weights.prosrc).toMatch(/interview \* 20/);
  });

  it("has one reference copy of the scoring formula in the tests, and the database test reads it", () => {
    const reference = path.join(__dirname, "leader-fit-reference.ts");
    expect(fs.existsSync(reference)).toBe(true);
    const users = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.ts") && fs.readFileSync(path.join(__dirname, f), "utf8").includes("leader-fit-reference"));
    expect(users).toContain("leader-fit.test.ts");
  });
});

describe("the goals and their weekly ideas", () => {
  const SIGNED = async () => (await one("select count(*)::int n from public.tribe_card_templates where status = 'signed_off'")).n as number;
  const GOALS = async () => (await one("select count(*)::int n from public.season_goals")).n as number;
  const originals = async () => sql("select id, slug, title from public.season_goals order by slug");
  const notThree = async () =>
    sql(
      `select g.slug, (select count(*)::int from public.goal_ideas i where i.season_goal_id = g.id) as n
         from public.season_goals g where (select count(*) from public.goal_ideas i where i.season_goal_id = g.id) <> 3 order by 1`,
    );
  /** The goals there are equals 23 plus the signed-off cards that are not among the 23. */
  const goalsMatchCards = async (twentyThree: Row[]) => {
    const slugs = new Set(twentyThree.map((g) => g.slug as string));
    const extra = (await sql("select slug from public.tribe_card_templates where status = 'signed_off'")).filter((r) => !slugs.has(r.slug as string)).length;
    expect(await GOALS()).toBe(23 + extra);
  };

  let twentyThree: Row[];

  it("starts with 23 goals, each with exactly three weekly ideas", async () => {
    twentyThree = await originals();
    expect(twentyThree).toHaveLength(23);
    expect(await notThree()).toEqual([]);
    expect(await SIGNED()).toBe(0);
    await goalsMatchCards(twentyThree);
  });

  it("has 100 cards loaded as drafts, and none of them still has text that was not written", async () => {
    const r = await one("select count(*)::int n, count(*) filter (where status = 'draft')::int d from public.tribe_card_templates");
    expect(r).toMatchObject({ n: 100, d: 100 });
    const holes = await sql(
      `select slug from public.tribe_card_templates
        where 'To be written by the pastorate' in (who_for, loving_god, loving_others, loving_life, week12_outcome, guardrail, who_leads_well,
                                                   arc_1, arc_2, arc_3, title)`,
    );
    expect(holes).toEqual([]);
  });

  it("signs off all 100 through the real functions, community by community and the sensitive ones one at a time, and stays consistent at every step", async () => {
    const communities = await sql("select id, slug from public.communities where active order by sort, slug");
    for (const c of communities) {
      await db.asUser(pastor, (q) => q("select public.card_template_sign_off_community($1)", [c.id]));
      await goalsMatchCards(twentyThree);
      expect(await notThree()).toEqual([]);
    }
    const sensitive = await sql("select slug from public.tribe_card_templates where status = 'draft' and sensitive order by slug");
    expect(sensitive.length).toBeGreaterThan(0);
    for (const s of sensitive) {
      await db.asUser(pastor, (q) => q("select public.card_template_sign_off($1)", [s.slug]));
      await goalsMatchCards(twentyThree);
    }
    expect(await SIGNED()).toBe(100);
    expect(await GOALS()).toBe(100);
    expect((await one("select count(*)::int n from public.goal_ideas")).n).toBe(300);
    expect(await notThree()).toEqual([]);
  });

  it("leaves no community above ten active goals, and the 23 original goals as they were in id, slug and title", async () => {
    const big = await sql("select c.slug, count(*)::int n from public.season_goals g join public.communities c on c.id = g.community_id where g.active group by c.slug having count(*) > 10");
    expect(big).toEqual([]);
    const now = await originals();
    for (const g of twentyThree) expect(now.find((x) => x.id === g.id), `${g.slug}`).toMatchObject({ slug: g.slug, title: g.title });
  });

  it("has no signed-off card with placeholder text, and each signed-off card has a goal that is on", async () => {
    const holes = await sql(
      `select slug from public.tribe_card_templates
        where status = 'signed_off' and ('To be written by the pastorate' in (who_for, loving_god, loving_others, loving_life, week12_outcome, guardrail, who_leads_well, arc_1, arc_2, arc_3)
              or btrim(who_for) = '' or btrim(arc_1) = '' or btrim(arc_2) = '' or btrim(arc_3) = '')`,
    );
    expect(holes).toEqual([]);
    const off = await sql(
      `select t.slug from public.tribe_card_templates t left join public.season_goals g on g.id = t.season_goal_id
        where t.status = 'signed_off' and (g.id is null or not g.active)`,
    );
    expect(off).toEqual([]);
  });

  it("retires a card by switching its goal off, deletes nothing, and keeps the ideas", async () => {
    const before = { cards: (await one("select count(*)::int n from public.tribe_card_templates")).n, goals: await GOALS(), ideas: (await one("select count(*)::int n from public.goal_ideas")).n };
    const slug = (await one("select slug from public.tribe_card_templates where status = 'signed_off' and season_goal_id not in (select id from public.season_goals where slug = any($1)) order by slug limit 1", [twentyThree.map((g) => g.slug)])).slug as string;
    await db.asUser(pastor, (q) => q("select public.card_template_retire($1)", [slug]));
    expect(await one("select g.active from public.tribe_card_templates t join public.season_goals g on g.id = t.season_goal_id where t.slug = $1", [slug])).toMatchObject({ active: false });
    expect(await one("select count(*)::int n from public.tribe_card_templates")).toMatchObject({ n: before.cards });
    expect(await GOALS()).toBe(before.goals);
    expect((await one("select count(*)::int n from public.goal_ideas")).n).toBe(before.ideas);
  });
});

describe("the saved copies of the functions the plan revised", () => {
  it("has a golden copy of each function the first two revising phases changed, and each test that uses them", () => {
    for (const file of ["leader-v1.sql", "academy-v1.sql"]) expect(fs.existsSync(path.join(__dirname, "golden", file)), file).toBe(true);
    const leader = fs.readFileSync(path.join(__dirname, "golden", "leader-v1.sql"), "utf8");
    for (const name of ["check_leader_eligibility", "submit_leader_application", "invite_to_interview", "application_readiness", "decide_application", "review_application"]) {
      expect(leader, name).toContain(`public.${name}_v1(`);
    }
    const academy = fs.readFileSync(path.join(__dirname, "golden", "academy-v1.sql"), "utf8");
    for (const name of ["certification_state", "refresh_certification", "sign_safeguarding", "submit_tribe_card", "my_academy", "my_tribe"]) {
      expect(academy, name).toContain(`public.${name}_v1(`);
    }
    const users = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.ts") && /golden/.test(fs.readFileSync(path.join(__dirname, f), "utf8")));
    expect(users).toEqual(expect.arrayContaining(["switchboard.test.ts", "academy-switch.test.ts"]));
  });
});
