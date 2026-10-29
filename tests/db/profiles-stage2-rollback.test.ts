import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Profiles and the Weekly Rhythm", stage 2, rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270101000300, which is stage 1 and the placement fix) and the one with
// everything applied. The migration may replace the eight functions it names and must not have changed any other function that already existed. The
// rollback file must put those eight back exactly as they were, drop the fourteen it added, take the four functions off the Switchboard, keep the three
// tables and every row in them, leave what a person typed where the platform reads it, change nothing the second time, and leave My page doing what
// stage 1 made it.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270101000300";
const THIS = "20270102000100_profiles_stage2";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270102000100")
  .sort()
  .reverse();
const REPLACED = ["details_clean_facts", "my_page_answer", "my_page_state", "profile_fact_answer", "profile_fact_applies", "profile_fact_current", "profile_fact_label", "profile_fact_options"];
const KEPT_TABLES = ["profile_story", "profile_office_asks", "profile_prompts"];
const FOUR = ["my_details", "my_story", "role_panels", "still_right"];
const GOOD = "Trying the whole road with everyone";

let c: Cast;
let baseline: Client;
let baselineName: string;
let rootClient: Client;

const functions = async (cl: Client) =>
  new Map(
    (
      await cl.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)
    ).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (cl: Client) =>
  (
    await cl.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                     where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)
  ).rows.map((r) => r.t as string);
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const tableExists = async (name: string) => (await c.one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const gone = (promise: Promise<unknown>) => expect(promise).rejects.toThrow(/does not exist/);
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `pr2base_${Date.now().toString(36)}`;
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
  c = await makeCast();
  await c.noticesOn();
  for (const f of LATER_DOWN) await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await c?.db.close();
});

describe("the way back from 'Profiles and the Weekly Rhythm', stage 2", () => {
  let eze: string;
  let before: Record<string, number>;
  let leaderPage: unknown;

  it("is what the migration added: only the eight functions it names were replaced, the rest are new, and no step was added", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(created.size).toBe(14);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: rules, a typed fact, a story, a message to the Care Team, a strip set aside", async () => {
    await c.reset();
    await c.set("my_page", "on", { reason: GOOD });
    for (const f of FOUR) await c.set(f, "on", { reason: GOOD });
    await c.db.admin.query("update public.seasons set status = 'running' where id = $1", [c.season]);
    eze = (await c.k.person("Eze")).id;
    await c.k.profile(eze, c.season, { zone: "mainland", age: "26-32" });
    expect(await c.as(eze, "my_page_save", "preferred_name", "Ezinne")).toEqual({ ok: true, outcome: "saved" });
    expect(await c.as(eze, "my_page_save", "area", "island-lekki")).toEqual({ ok: true, outcome: "saved" });
    expect(await c.as(eze, "my_page_save", "birthday", "03-14")).toEqual({ ok: true, outcome: "saved" });
    expect(await c.as(eze, "my_page_save", "about_me", "Hello from Eze")).toEqual({ ok: true, outcome: "saved" });
    expect(await c.as(eze, "my_office_ask", "I am really 16")).toMatchObject({ ok: true });
    await c.db.admin.query("update public.member_profiles set submitted_at = now() - interval '60 days' where person_id = $1", [eze]);
    expect(await c.as(eze, "still_right_later", "age_range")).toEqual({ ok: true });
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null)).toMatchObject({ ok: true });
    leaderPage = await c.as(c.appointed.id, "my_page_state");
    before = {
      profile_story: await count("profile_story"),
      profile_office_asks: await count("profile_office_asks"),
      profile_prompts: await count("profile_prompts"),
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      feature_settings: await count("feature_settings"),
      profile_fact_registry: await count("profile_fact_registry"),
      profile_fact_history: await count("profile_fact_history"),
      profile_facts: await count("profile_facts"),
    };
    expect(before.profile_story).toBe(1);
    expect(before.profile_office_asks).toBe(1);
    expect(before.profile_prompts).toBe(1);
    expect(before.feature_settings).toBe(5);
    expect(before.profile_fact_registry).toBe(9);
    expect(before.feature_registry).toBe(21);
  });

  it("runs the rollback file without error, and writes only to the four functions' rows and the seven facts' rows", async () => {
    const text = fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    // what the file itself does, apart from the bodies of the eight functions it puts back (those are stage 1's own text)
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$\$[\s\S]*?\$\$;/gi) ?? [];
    expect(bodies).toHaveLength(8);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    expect(own).not.toMatch(/\b(truncate|insert)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(column|schema|type|table)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdelete\s+from\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_settings", "profile_fact_registry"]);
    expect([...own.matchAll(/\bupdate\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_registry"]);
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped).toHaveLength(14);
    const created = [...migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
    expect(dropped.sort()).toEqual(created.sort());
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    // the way to take the three tables out too is written in the file for a person to run, not run for them
    for (const t of KEPT_TABLES) expect(text, t).toContain(`public.${t}`);
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps the three tables and every row in them, takes the four functions off the board, and keeps the log", async () => {
    for (const t of KEPT_TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await count("profile_story")).toBe(before.profile_story);
    expect(await count("profile_office_asks")).toBe(before.profile_office_asks);
    expect(await count("profile_prompts")).toBe(before.profile_prompts);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect(await count("feature_registry")).toBe(before.feature_registry - 4);
    expect(await count("feature_settings")).toBe(before.feature_settings - 4);
    expect((await c.sql("select key from public.feature_registry order by sort")).map((r) => r.key)).toEqual([
      "my_page", "details_check", "hold_card", "photos", "visibility", "our_tribe", "encourage", "week_line", "directory", "weekly_rhythm", "thanks", "fruit", "personal_fruit", "pulse", "shepherd_hour", "coach_card", "rest_week",
    ]);
    expect((await c.sql("select sort from public.feature_registry order by sort")).map((r) => r.sort)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    // the facts a person has used stay in the registry, with their history; nothing reads them
    expect(await count("profile_fact_history")).toBe(before.profile_fact_history);
    expect(await count("profile_facts")).toBe(before.profile_facts);
    expect((await c.sql("select key from public.profile_fact_registry order by sort")).map((r) => r.key)).toEqual(["life_stage", "age_range", "preferred_name", "area", "birthday", "about_me"]);
  });

  it("leaves what the person typed where the platform already reads it", async () => {
    expect((await c.one("select preferred_name from public.people where id = $1", [eze])).preferred_name).toBe("Ezinne");
    expect((await c.one("select zone, birthday_month m, birthday_day d from public.member_profiles where person_id = $1", [eze]))).toEqual({ zone: "island-lekki", m: 3, d: 14 });
    expect((await c.one("select value from public.profile_story where person_id = $1 and key = 'about_me'", [eze])).value).toBe("Hello from Eze");
  });

  it("stops every new door", async () => {
    for (const [who, fn, args] of [
      [eze, "my_page_save", ["about_me", "x"]],
      [eze, "my_page_open", []],
      [eze, "my_office_ask", [null]],
      [eze, "still_right_state", []],
      [eze, "still_right_later", ["age_range"]],
      [eze, "my_profile_export", []],
      [c.pastor, "profile_office_asks_list", []],
    ] as const) await gone(c.as(who, fn, ...args));
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8"));
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("feature_registry")).toBe(before.feature_registry - 4);
    expect(await count("profile_story")).toBe(before.profile_story);
  });

  it("leaves My page doing what stage 1 made it: the leader's question, a yes, and nothing about the new facts", async () => {
    const page = (await c.as(c.appointed.id, "my_page_state")) as { enabled: boolean; first: string; facts: { key: string }[] } & Record<string, unknown>;
    expect(Object.keys(page).sort()).toEqual(["enabled", "facts", "first"]);
    expect(page.facts.map((f) => f.key)).toEqual(["life_stage"]);
    expect(page.facts).toEqual((leaderPage as { facts: unknown[] }).facts);
    expect(page.first).toBe((leaderPage as { first: string }).first);
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null)).toEqual({ ok: true, outcome: "confirmed" });
    // the member's page has their age range and nothing else, even though a row for their typed facts is still in the registry
    const member = (await c.as(eze, "my_page_state")) as { facts: { key: string }[] };
    expect(member.facts.map((f) => f.key)).toEqual(["age_range"]);
  });
});
