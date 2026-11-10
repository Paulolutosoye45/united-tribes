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
const LAST_BEFORE = "20270117000100";
const THIS = "20270118000100_desk_offers";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270118000100")
  .sort()
  .reverse();
const REPLACED = ["god_appoint_leader", "save_tribe_card", "desk_mail_send", "worker_desk_info", "worker_desk_answer", "desk_tick"];
const ADDED = [
  "leader_appoint_core", "desk_offer_words", "desk_offer_gate_core", "desk_offer_member_ok", "desk_offer_gate", "desk_offer_problem", "desk_offer_params",
  "desk_offer_link_mint", "desk_offer_link_offer", "desk_offer_open", "desk_offer_close", "desk_offer_advance", "desk_found_params", "desk_offer_complete",
  "desk_offer_accept", "desk_offer_candidates", "desk_offer_send", "desk_offer_cancel", "desk_offers_pause", "desk_offer_review", "desk_group_leader",
  "desk_offers_list", "desk_offer_tick", "worker_desk_offer_info", "worker_desk_offer_answer",
];
const TABLES = ["desk_offer_links", "desk_offers", "desk_lead_stops"];

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

describe("the way back from 'recommend a leader'", () => {
  let before: Record<string, number>;
  let leaderId: string;
  let tribeId: string;

  it("is what the migration did: six functions replaced, twenty-five new, no trigger new, three tables", async () => {
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
    expect((await tables(c.db.admin)).filter((t) => !TABLES.includes(t))).toEqual(await tables(baseline));
  });

  it("changes only the Leader Desk's blurb on the Switchboard", async () => {
    const base = await registry(baseline);
    const now = await registry(c.db.admin);
    expect(now.map((r) => r.key)).toEqual(base.map((r) => r.key));
    expect(now.filter((r, i) => JSON.stringify(r) !== JSON.stringify(base[i])).map((r) => r.key)).toEqual(["leader_desk"]);
  });

  it("starts with something to keep: an accepted offer with its leader, appointment and card, a 'found' email, a Rehearsal offer, and the ordinary seats and messages", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
    await c.db.admin.query("update public.desk_settings set daily_cap = 300");
    await c.k.tribe(c.season, { name: "Keep this tribe" });
    await c.db.admin.query("create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select 11; $f$");
    const token = (await c.one("select public.bootstrap_worker_token('desk-offers-rollback') as t")).t as string;
    await c.set("leader_desk", "on", { reason: "Trying one real offer before the way back" });
    const track = await c.k.lookup("tracks", "builders");
    const comm = await c.k.lookup("communities", "professionals");
    const goal = await c.k.goalOf("professionals");
    const g = (await c.o.call("desk_group_save", null, "Keep this group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const lead = await readyMember(c.db, c.k, c.season, "KeepLead", { daysAgo: 6, faith: "established" });
    await c.db.admin.query("update public.member_profiles set open_to_serving = 'yes' where person_id = $1", [lead.id]);
    const draft = await readyMember(c.db, c.k, c.season, "KeepDraft", { daysAgo: 6 });
    await c.o.call("desk_group_member_add", g.id, draft.id);
    await c.o.call("desk_offer_send", g.id, [lead.id]);
    const link = (await c.sql("select reply_token from public.messages where person_id = $1 and template = 'desk_offer'", [lead.id]))[0].reply_token as string;
    const answered = await c.anon("worker_desk_offer_answer", token, link, "lead", true, "connection", "achieved", []);
    expect(answered).toMatchObject({ ok: true, answer: "lead" });
    expect(await count("desk_proposals")).toBe(1);
    leaderId = lead.id;
    tribeId = (await c.one("select tribe_id from public.desk_groups where id = $1", [g.id])).tribe_id as string;
    expect((await c.one("select fixed from public.tribes where id = $1", [tribeId])).fixed.length).toBeGreaterThan(3);
    // a Rehearsal offer on another group
    const g2 = (await c.o.call("desk_group_save", null, "Rehearsed group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const other = await readyMember(c.db, c.k, c.season, "KeepOther", { daysAgo: 6, faith: "established" });
    await c.db.admin.query("update public.member_profiles set open_to_serving = 'yes' where person_id = $1", [other.id]);
    await c.set("leader_desk", "rehearsal", { reason: "Rehearsing the way back" });
    await c.o.call("desk_offer_send", g2.id, [other.id]);
    await c.db.admin.query("insert into public.desk_lead_stops (person_id) values ($1)", [draft.id]);
    expect(await count("desk_offers")).toBe(2);
    expect(await count("desk_offer_links")).toBeGreaterThanOrEqual(1);
    await c.set("leader_desk", "off", { reason: "Switching the Desk off before the way back" });
    // the test's own stand-in for the hour goes back as the database had it
    await c.db.admin.query((await baseline.query("select pg_get_functiondef('public.lagos_hour()'::regprocedure) as d")).rows[0].d as string);
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
      leader_appointments: await count("leader_appointments"),
      person_roles: await count("person_roles"),
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
      // (the bodies of the functions it puts back; the one guard block that deletes the "found" records is kept, it is a statement of the file itself)
      .replace(/\$(function)?\$[\s\S]*?\$\1\$/gi, "$$$$");
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type)\b/i);
    // the rows it changes: the Desk's blurb, the "found" records, and the locks on a Desk tribe card
    expect([...code.matchAll(/\bdelete\s+from\s+([a-z_.]+)\s+where\s+([a-z_]+)\s*=\s*'([a-z_]+)'/gi)].map((m) => `${m[1]} where ${m[2]}=${m[3]}`)).toEqual(["public.desk_proposals where kind=found"]);
    expect(code.match(/\bdelete\b/gi)).toHaveLength(1);
    expect([...code.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`).sort()).toEqual(["public.feature_registry.blurb", "public.tribes.fixed"]);
    expect(code).not.toMatch(/\binsert\b/i);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    expect([...code.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
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

  it("keeps every seat, member, tribe, appointment, role, message, notice, consent and log line, and the leader's card with its details", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    const t = await c.one("select leader_id, status, slot, meeting_mode, capacity, fixed from public.tribes where id = $1", [tribeId]);
    expect(t).toMatchObject({ leader_id: leaderId, status: "draft", slot: "weeknight-evening", meeting_mode: "in_person", capacity: 8 });
    expect([...t.fixed].sort()).toEqual(["community", "goal", "track"]);
    expect((await c.one("select count(*)::int n from public.leader_appointments where person_id = $1 and status = 'active'", [leaderId])).n).toBe(1);
    expect((await c.one("select count(*)::int n from public.desk_proposals where kind = 'found'")).n).toBe(0);
  });

  it("closes the offers, and leaves Phase 2a of the Desk working", async () => {
    await expect(c.o.call("desk_offers_list", 10, 0)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_offer_send", null, [])).rejects.toThrow(/does not exist/);
    await expect(c.anon("worker_desk_offer_info", "x", "y")).rejects.toThrow(/does not exist/);
    await c.set("leader_desk", "rehearsal", { reason: "Phase 2a after the way back" });
    const state = await c.o.call("desk_send_state");
    expect(state.mode).toBe("rehearsal");
    expect(Array.isArray((await c.o.call("desk_proposals_list", null, 10, 0)).rows)).toBe(true);
    // the owner's own appointment still works the way it did
    const p = await c.k.person("AfterRollback");
    const goal = (await c.one("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).id as string;
    const form = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
    expect(await c.o.call("god_appoint_leader", p.id, JSON.stringify(form), goal, "Asked by the pastor")).toMatchObject({ ok: true });
    await c.set("leader_desk", "off", { reason: "Done" });
    // Changing the switch and appointing write their own log lines; the second run is measured from here
    for (const k of ["event_log", "people", "person_roles", "leader_appointments", "tribes", "messages"]) before[k] = await count(k);
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
    expect(now.has("desk_offers_list(p_limit integer, p_offset integer)")).toBe(true);
    expect(await tables(c.db.admin)).toEqual(expect.arrayContaining(TABLES));
    const [row] = (await registry(c.db.admin)).filter((r) => r.key === "leader_desk");
    expect(row.blurb).not.toBe((await registry(baseline)).find((r) => r.key === "leader_desk")?.blurb);
  });
});
