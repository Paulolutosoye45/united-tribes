import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the Leader Desk, Phase 2b-1" (recommend a leader with backups, the private offer page, the shared appointment step, the tribe card started from
// the draft, "Your group has a leader"), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270117000100, which includes Phase 2a of the Desk) and the one with everything applied.
// The migration replaces six functions (god_appoint_leader, save_tribe_card, and Phase 2a's desk_mail_send, worker_desk_info, worker_desk_answer, desk_tick), adds
// twenty-five, adds three tables and some columns, and widens three checks. The rollback file must put every replaced function back exactly as it was, drop what was
// added, narrow the checks, keep every seat, member, tribe, appointment, message, notice, consent and log line, change nothing the second time, and leave Phase 2a working.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270118000100";
const THIS = "20270119000100_desk_open";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270119000100")
  .sort()
  .reverse();
const REPLACED = ["desk_interest_check", "desk_tick"];
const ADDED = ["desk_open_words", "desk_open_plan", "desk_open_preview", "desk_open_tribe", "desk_card_tick", "desk_pipeline", "desk_pipeline_settings_set"];

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
const tables = async (cl: Client) => (await cl.query("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).rows.map((r) => r.relname as string);
const columns = async (cl: Client) =>
  (
    await cl.query(`select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as c
                      from information_schema.columns where table_schema = 'public' and table_name in ('desk_groups', 'desk_settings', 'desk_proposals', 'tribes')
                     order by table_name, ordinal_position`)
  ).rows.map((r) => r.c as string);
const constraints = async (cl: Client) =>
  (
    await cl.query(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text in ('desk_groups', 'desk_settings', 'desk_proposals', 'tribes') order by 1`)
  ).rows.map((r) => r.c as string);
const indexes = async (cl: Client) =>
  (await cl.query("select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename in ('desk_groups', 'desk_settings', 'desk_proposals', 'tribes') order by 1")).rows.map(
    (r) => r.i as string,
  );
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const registry = async (cl: Client) => (await cl.query("select key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only from public.feature_registry order by sort, key")).rows;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `ldobase_${Date.now().toString(36)}`;
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
  for (const f of LATER_DOWN) await c.db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
  await rootClient?.end();
  await c?.db.close();
});

describe("the way back from 'Open tribe'", () => {
  let before: Record<string, number>;
  let seated: string;
  let tribeId: string;
  let groupId: string;
  let reminded: number;

  it("is what the migration did: two functions replaced, seven new, no trigger new, no table new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual([...REPLACED].sort());
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect([...created].sort()).toEqual([...ADDED].sort());
    const replaced = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) replaced.add(m[1].toLowerCase());
    expect([...replaced].sort()).toEqual([...REPLACED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect(await tables(c.db.admin)).toEqual(await tables(baseline));
    // the one column
    const baseCols = await columns(baseline);
    const added = (await columns(c.db.admin)).filter((col) => !baseCols.includes(col));
    expect(added.map((col) => col.split(" ")[0])).toEqual(["desk_groups.opened_at"]);
  });

  it("changes only the Leader Desk's blurb on the Switchboard", async () => {
    const base = await registry(baseline);
    const now = await registry(c.db.admin);
    expect(now.map((r) => r.key)).toEqual(base.map((r) => r.key));
    expect(now.filter((r, i) => JSON.stringify(r) !== JSON.stringify(base[i])).map((r) => r.key)).toEqual(["leader_desk"]);
  });

  it("starts with something to keep: a member placed by Open tribe, a reminder already sent to the pastors, settings the owner changed, and the ordinary seats and messages", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
    await c.db.admin.query("update public.desk_settings set daily_cap = 300");
    await c.k.tribe(c.season, { name: "Keep this tribe" });
    await c.noticesOn();
    await c.set("leader_desk", "on", { reason: "Trying one real Open tribe before the way back" });
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    const track = await c.k.lookup("tracks", "builders");
    const comm = await c.k.lookup("communities", "professionals");
    const goal = await c.k.goalOf("professionals");
    const g = (await c.o.call("desk_group_save", null, "Keep this group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const t = await c.k.tribe(c.season, { name: "Keep the opened tribe", capacity: 8, status: "approved", slot: "weeknight-evening" });
    await c.db.admin.query("update public.desk_groups set leader_id = $1, tribe_id = $2, leader_found_at = now() where id = $3", [t.leader.id, t.tribe, g.id]);
    const m = await readyMember(c.db, c.k, c.season, "KeepOpened", { daysAgo: 20, times: ["weeknight-evening"] });
    await c.o.call("desk_group_member_add", g.id, m.id);
    expect(await c.o.call("desk_open_tribe", g.id)).toMatchObject({ ok: true, placed: 1, not_placed: [] });
    seated = m.id;
    tribeId = t.tribe;
    groupId = g.id;
    expect((await c.one("select status from public.desk_groups where id = $1", [g.id])).status).toBe("archived");
    expect((await c.one("select opened_at is not null as o from public.desk_groups where id = $1", [g.id])).o).toBe(true);
    // a card the Desk's tribe sent in two days ago, and the reminder the heartbeat sent for it
    const g2 = (await c.o.call("desk_group_save", null, "Waiting group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const w = await c.k.tribe(c.season, { name: "Keep the waiting tribe", status: "submitted" });
    await c.db.admin.query("update public.desk_groups set leader_id = $1, tribe_id = $2, leader_found_at = now() where id = $3", [w.leader.id, w.tribe, g2.id]);
    await c.db.admin.query("update public.tribes set submitted_at = now() - interval '48 hours' where id = $1", [w.tribe]);
    await c.db.admin.query("select public.desk_card_tick()");
    reminded = (await c.one("select count(*)::int n from public.notice_items where kind = 'pastor_card_waiting'")).n as number;
    expect(reminded).toBeGreaterThan(0);
    // settings the owner changed
    await c.o.call("desk_pipeline_settings_set", 96, 1, 4, 5, "Keeping these for the way back");
    await c.set("leader_desk", "off", { reason: "Switching the Desk off before the way back" });
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      consents: await count("consents"),
      people: await count("people"),
      event_log: await count("event_log"),
      desk_groups: await count("desk_groups"),
      placement_runs: await count("placement_runs"),
      placement_items: await count("placement_items"),
      leader_appointments: await count("leader_appointments"),
    };
  });

  it("runs the rollback file without error, and touches only what the migration added or replaced", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    // The statements of the file itself; the bodies of the functions it puts back are the old ones, checked line for line against the baseline below
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "$$$$");
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|table)\b/i);
    expect(code).not.toMatch(/\bdelete\b/i);
    expect(code).not.toMatch(/\binsert\b/i);
    // the one row it changes is the Desk's blurb
    expect([...code.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["public.feature_registry.blurb"]);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    expect([...code.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    expect([...code.matchAll(/\balter\s+table\s+if\s+exists\s+([a-z_.]+)\s+drop\s+column\s+if\s+exists\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["public.desk_groups.opened_at"]);
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions, triggers, tables, columns, checks, indexes and Switchboard the database had before, each function and each registry line unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect(await tables(c.db.admin)).toEqual(await tables(baseline));
    expect(await columns(c.db.admin)).toEqual(await columns(baseline));
    expect(await constraints(c.db.admin)).toEqual(await constraints(baseline));
    expect(await indexes(c.db.admin)).toEqual(await indexes(baseline));
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
  });

  it("keeps every seat Open tribe made, every reminder already sent, every setting the owner changed and every log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    const seat = await c.one("select tribe_id, status from public.tribe_members where person_id = $1 and status = 'active'", [seated]);
    expect(seat).toMatchObject({ tribe_id: tribeId, status: "active" });
    expect((await c.one("select status from public.desk_groups where id = $1", [groupId])).status).toBe("archived");
    expect((await c.one("select count(*)::int n from public.notice_items where kind = 'pastor_card_waiting'")).n).toBe(reminded);
    expect(await c.one("select offer_hours, backups, said_yes_days, card_days from public.desk_settings")).toMatchObject({ offer_hours: 96, backups: 1, said_yes_days: 4, card_days: 5 });
  });

  it("closes Open tribe, the pipeline and the pastors' reminder, and leaves Phase 2b-1 of the Desk working", async () => {
    await expect(c.o.call("desk_open_tribe", groupId)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_open_preview", groupId)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_pipeline")).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_pipeline_settings_set", 72, 2, 2, 3, "Back to the old numbers")).rejects.toThrow(/does not exist/);
    // the heartbeat runs, and no longer looks at cards
    const tick = (await c.one("select public.desk_tick() as t")).t as Record<string, unknown>;
    expect(tick).not.toHaveProperty("card_reminders");
    // Phase 2b-1 still works: the Desk can be put in Rehearsal and the offers list reads
    await c.set("leader_desk", "rehearsal", { reason: "Phase 2b-1 after the way back" });
    expect(Array.isArray((await c.o.call("desk_offers_list", 10, 0)).rows)).toBe(true);
    // "Check interest" is as Phase 2a had it: it does not know about leaders
    const def = (await c.one("select pg_get_functiondef('public.desk_interest_check(uuid)'::regprocedure) as d")).d as string;
    expect(def).not.toMatch(/leader_id/);
    await c.set("leader_desk", "off", { reason: "Done" });
    // Changing the switch writes its own log lines; the second run is measured from here
    for (const k of ["event_log"]) before[k] = await count(k);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTables = await tables(c.db.admin);
    const firstColumns = await columns(c.db.admin);
    const firstConstraints = await constraints(c.db.admin);
    const firstRegistry = await registry(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await tables(c.db.admin)).toEqual(firstTables);
    expect(await columns(c.db.admin)).toEqual(firstColumns);
    expect(await constraints(c.db.admin)).toEqual(firstConstraints);
    expect(await registry(c.db.admin)).toEqual(firstRegistry);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("can be applied again over the way back", async () => {
    await c.db.admin.query(migrationText());
    const now = await functions(c.db.admin);
    expect(now.has("desk_pipeline()")).toBe(true);
    expect(await columns(c.db.admin)).toContain((await columns(c.db.admin)).find((col) => col.startsWith("desk_groups.opened_at")));
    const [row] = (await registry(c.db.admin)).filter((r) => r.key === "leader_desk");
    expect(row.blurb).not.toBe((await registry(baseline)).find((r) => r.key === "leader_desk")?.blurb);
  });
});
