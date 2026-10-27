import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Row } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Profiles and the Weekly Rhythm", stage 1, rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20261231000100) and the one with everything applied. The
// migration must not have changed any function that already existed. The only things it may add to other tables' own writes are the two steps
// it names (the hold on a Tribe Card and the "Confirm your details" line of the leader's welcome email). The rollback file must leave exactly the
// baseline's functions and triggers, keep the twelve tables it added with every row in them, change nothing the second time, stop every door and
// leave the platform doing what it did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20261231000100";
const THIS = "20270101000100_profiles_stage1";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270101000100")
  .sort()
  .reverse();
const TABLES = [
  "feature_registry",
  "feature_settings",
  "feature_master",
  "feature_log",
  "profile_fact_registry",
  "profile_facts",
  "profile_fact_history",
  "profile_changes",
  "details_checks",
  "details_check_items",
  "details_check_tokens",
  "details_check_access",
];
const TRIGGERS = ["tribes.tribes_hold_for_stage", "messages.messages_welcome_confirm"];

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
const tableExists = async (name: string) => (await c.one("select to_regclass($1) is not null as e", [`public.${name}`])).e as boolean;
const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await tableExists(t)) ? (await c.one(`select count(*)::int n from public.${t}`)).n : -1;
  return out;
};
const gone = (promise: Promise<unknown>) => expect(promise).rejects.toThrow(/does not exist/);

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `prbase_${Date.now().toString(36)}`;
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

describe("the way back from 'Profiles and the Weekly Rhythm', stage 1", () => {
  let rowsBefore: Record<string, number>;
  let asked: { id: string; tribe: string };
  let workerToken: string;
  let link: string;

  it("is what the migration added and nothing else: no function that existed before was changed, and the only new steps are the two it names", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    const created = new Set<string>();
    for (const m of fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8").matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map((sig) => sig.split("(")[0]);
    expect(created.size).toBe(52);
    expect(extra.length).toBe(created.size);
    expect(extra.filter((name) => !created.has(name))).toEqual([]);
    const before = await triggers(baseline);
    const after = await triggers(c.db.admin);
    expect(after.filter((t) => !before.includes(t)).sort()).toEqual([...TRIGGERS].sort());
    expect(before.filter((t) => !after.includes(t))).toEqual([]);
  });

  it("starts with something to keep: rules and a log, a fact with its history, a held change, a Details run with a link and a code", async () => {
    await c.open("optional");
    // a fact confirmed and changed, with its history
    expect(await c.as(c.appointed.id, "my_page_answer", "life_stage", "change", "builders")).toMatchObject({ ok: true });
    // a leader's change that waits for the pastor, so a stage review exists
    expect(await c.as(c.seasoned.id, "my_page_answer", "life_stage", "change", "rising")).toMatchObject({ ok: true, outcome: "pending_review" });
    // a Details run with a private link, and a code asked for on it
    asked = await c.appoint("Dayo");
    const r = await c.o.call("god_details_send", JSON.stringify({ kind: "list", people: [asked.id] }), ["life_stage"], "live");
    expect(r.asked).toBe(1);
    link = (await c.one("select reply_token from public.messages where person_id = $1 and template = 'details_check_request' order by created_at desc limit 1", [asked.id])).reply_token as string;
    workerToken = (await c.one("select public.bootstrap_worker_token('details') as t")).t as string;
    const sent = (await c.db.asAnon((q) => q("select public.worker_details_code_send($1, $2) as r", [workerToken, link]))).rows[0].r;
    expect(sent.ok).toBe(true);
    rowsBefore = await counts();
    expect(rowsBefore.feature_registry).toBeGreaterThan(0);
    expect(rowsBefore.profile_fact_registry).toBeGreaterThan(0);
    expect(rowsBefore.feature_settings).toBe(3);
    expect(rowsBefore.feature_log).toBeGreaterThanOrEqual(3);
    expect(rowsBefore.profile_facts).toBeGreaterThanOrEqual(1);
    expect(rowsBefore.profile_fact_history).toBeGreaterThanOrEqual(2);
    expect(rowsBefore.profile_changes).toBe(1);
    expect(rowsBefore.details_checks).toBe(1);
    expect(rowsBefore.details_check_items).toBe(1);
    expect(rowsBefore.details_check_tokens).toBeGreaterThanOrEqual(1);
    expect(rowsBefore.details_check_access).toBe(1);
  });

  it("runs the rollback file without error: it drops functions and the two steps only, and writes nothing", async () => {
    const text = fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\b(delete|truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(column|schema|type|table)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bcreate\b/i);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).length).toBe(52);
    expect([...code.matchAll(/\bdrop\s+trigger\s+if\s+exists\s+([a-z_0-9]+)\s+on\s+public\.([a-z_0-9]+)/gi)].map((m) => `${m[2]}.${m[1]}`).sort()).toEqual([...TRIGGERS].sort());
    // the way to take the tables out too is written in the file for a person to run, not run for them
    for (const t of TABLES) expect(text, t).toContain(`public.${t}`);
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

  it("keeps the twelve tables and every row in them: no rule, log line, fact, change, run or link is lost", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(true);
    expect(await counts()).toEqual(rowsBefore);
    // what a person confirmed is still what they confirmed
    const f = await c.one("select value from public.profile_facts where person_id = $1 and key = 'life_stage'", [c.appointed.id]);
    expect(f.value).toBe("builders");
  });

  it("stops every door: no switch moves, no page answers, nobody is asked, no link or code works", async () => {
    await gone(c.o.call("god_feature_set", "my_page", "platform", null, "off", [], null, null));
    await gone(c.o.call("god_feature_board"));
    await gone(c.o.call("god_details_send", JSON.stringify({ kind: "appointed" }), ["life_stage"], "live"));
    await gone(c.o.call("god_details_plan", JSON.stringify({ kind: "appointed" }), ["life_stage"], "rehearsal"));
    await gone(c.o.call("god_details_checks"));
    await gone(c.as(c.appointed.id, "my_page_state"));
    await gone(c.as(c.appointed.id, "my_page_answer", "life_stage", "yes", null));
    await gone(c.as(c.appointed.id, "my_features"));
    await gone(c.as(c.appointed.id, "feature_state", "my_page", null));
    await gone(c.as(c.pastor, "stage_reviews_list"));
    await gone(c.as(c.director, "tribe_stage_status", c.seasoned.tribe));
    await gone(c.as(asked.id, "details_check_info", link));
    await gone(c.db.asAnon((q) => q("select public.worker_details_info($1, $2, $3)", [workerToken, link, "a".repeat(64)])));
    await gone(c.db.asAnon((q) => q("select public.worker_details_code_send($1, $2)", [workerToken, link])));
    await gone(c.db.asAnon((q) => q("select public.worker_details_tick($1)", [workerToken])));
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8"));
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("leaves the platform doing what it did: a Tribe Card is approved with no hold, a welcome email carries no new line, the heartbeat and the daily clean-up still run, and a member can still be placed", async () => {
    // a submitted Tribe Card is approved straight by the pastor, as before the stage existed
    const sub = await c.k.tribe(c.season, { name: "Approved after", status: "submitted", track: "builders", certified: false });
    await c.as(c.pastor, "decide_tribe_card", sub.tribe, "approve", null);
    expect((await c.one("select status from public.tribes where id = $1", [sub.tribe])).status).toBe("approved");
    // the welcome email is exactly what the three functions that queue it made
    const id = (await c.one("select public.enqueue_message($1, 'leader_welcome', $2::jsonb, null, $3) as id", [asked.id, JSON.stringify({ goal: "Grow", choose: false }), `welcome-after:${Math.random()}`])).id as string;
    const m = await c.one("select params from public.messages where id = $1", [id]);
    expect(m.params).toEqual({ goal: "Grow", choose: false });
    // the daily clean-up runs
    await c.db.admin.query("delete from public.calendar_runs where key like 'retention:%'");
    const out = (await c.db.admin.query("select public.retention_tick(now()) as r")).rows[0].r;
    expect(out.retention_ran).toBe(true);
    // a member can still be placed and counted
    const season = await c.k.season("After the way back", 30);
    const t = await c.k.tribe(season, { name: "Still works" });
    const seat = await c.k.seat(t.tribe, season, "Joiner");
    const n = (await c.one("select count(*)::int n from public.tribe_members where tribe_id = $1 and person_id = $2", [t.tribe, seat.id] as unknown[])) as Row;
    expect(n.n).toBe(1);
  });
});
