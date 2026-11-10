import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the Leader Desk, Phase 2a" (email a proposed group, check interest, the member's one-tap answer), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270116000100, which includes Phase 1 of the Desk) and the one with everything
// applied. The migration replaces no function: it adds twenty-three, four tables, and rewrites one line of Switchboard text. The rollback file must drop exactly
// those, put the Switchboard text back as Phase 1 had it, keep every seat, member, tribe, message, notice, consent and log line, change nothing the second
// time, and leave Phase 1 of the Desk working.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270116000100";
const THIS = "20270117000100_desk_proposals";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270117000100")
  .sort()
  .reverse();
const ADDED = [
  "desk_mail_state", "desk_mail_block", "desk_mail_cap", "desk_mail_words", "desk_send_at", "desk_tribe_pick", "desk_tribe_params", "desk_interest_params",
  "desk_link_mint", "desk_link_proposal", "desk_mail_send", "desk_tick", "desk_send_state", "desk_settings_set", "desk_propose_preview", "desk_propose_tribe",
  "desk_interest_check", "desk_group_interest", "desk_proposals_list", "desk_proposal_cancel", "worker_desk_info", "worker_desk_answer", "worker_desk_tick",
];
const TABLES = ["desk_links", "desk_proposals", "desk_settings", "desk_stops"];

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
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const registry = async (cl: Client) => (await cl.query("select key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only from public.feature_registry order by sort, key")).rows;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `ldsbase_${Date.now().toString(36)}`;
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

describe("the way back from 'the Desk's email'", () => {
  let before: Record<string, number>;

  it("is what the migration added: no function that existed before was changed, twenty-three are new, no trigger is new, and four tables", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig))).toEqual([]);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect([...created].sort()).toEqual([...ADDED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect((await tables(c.db.admin)).filter((t) => !TABLES.includes(t))).toEqual(await tables(baseline));
    expect(migrationText()).not.toMatch(/\balter\s+table\s+public\.(?!desk_)/i);
    expect(migrationText()).not.toMatch(/\bcreate\s+or\s+replace\s+function\b/i);
  });

  it("changes only the Leader Desk's blurb on the Switchboard", async () => {
    const base = await registry(baseline);
    const now = await registry(c.db.admin);
    expect(now.map((r) => r.key)).toEqual(base.map((r) => r.key));
    const differ = now.filter((r, i) => JSON.stringify(r) !== JSON.stringify(base[i])).map((r) => r.key);
    expect(differ).toEqual(["leader_desk"]);
  });

  it("starts with something to keep: a Rehearsal line, a real email queued, a link, a stop, and the ordinary seats and messages", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
    await c.k.tribe(c.season, { name: "Keep this tribe" });
    const a = await readyMember(c.db, c.k, c.season, "KeepA", { daysAgo: 5 });
    const b = await readyMember(c.db, c.k, c.season, "KeepB", { daysAgo: 5 });
    const stopper = await readyMember(c.db, c.k, c.season, "KeepC", { daysAgo: 5 });
    await c.set("leader_desk", "rehearsal", { reason: "Rehearsing the way back" });
    await c.o.call("desk_propose_tribe", a.id, null);
    await c.set("leader_desk", "on", { reason: "Trying one real email before the way back" });
    await c.o.call("desk_propose_tribe", b.id, null);
    await c.db.admin.query("insert into public.desk_stops (person_id) values ($1)", [stopper.id]);
    expect(await count("desk_proposals")).toBe(2);
    expect(await count("desk_links")).toBe(1);
    expect(await count("desk_stops")).toBe(1);
    expect((await c.sql("select count(*)::int n from public.messages where template = 'desk_proposal'"))[0].n).toBe(1);
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
    };
  });

  it("runs the rollback file without error, and touches only what the migration added", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\b(truncate|insert|delete)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bcreate\s+(or\s+replace\s+)?function\b/i);
    // the only row it changes is the Desk's own blurb on the Switchboard
    const updates = [...code.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)\s*=[\s\S]*?where\s+([a-z_]+)\s*=\s*'([a-z_]+)'/gi)].map((m) => `${m[1]}.${m[2]} where ${m[3]}=${m[4]}`);
    expect(updates).toEqual(["public.feature_registry.blurb where key=leader_desk"]);
    expect(code.match(/\bupdate\b/gi)).toHaveLength(1);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions, triggers, tables and Switchboard the database had before, each function and each registry line unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect(await tables(c.db.admin)).toEqual(await tables(baseline));
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
  });

  it("keeps every seat, member, tribe, message, notice, consent and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("closes the Desk's email, and leaves Phase 1 of the Desk working", async () => {
    await expect(c.o.call("desk_send_state")).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_propose_tribe", null, null)).rejects.toThrow(/does not exist/);
    await expect(c.anon("worker_desk_info", "x", "y")).rejects.toThrow(/does not exist/);
    await c.set("leader_desk", "rehearsal", { reason: "Phase 1 after the way back" });
    const overview = await c.o.call("desk_overview");
    expect(overview.mode).toBe("rehearsal");
    expect(Array.isArray((await c.o.call("desk_waiting", null, 10, 0)).rows)).toBe(true);
    await c.set("leader_desk", "off", { reason: "Done" });
    // Changing the switch writes its own log lines; the second run is measured from here
    before.event_log = await count("event_log");
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    const firstTables = await tables(c.db.admin);
    const firstRegistry = await registry(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await tables(c.db.admin)).toEqual(firstTables);
    expect(await registry(c.db.admin)).toEqual(firstRegistry);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("can be applied again over the way back", async () => {
    await c.db.admin.query(migrationText());
    expect((await functions(c.db.admin)).has("desk_send_state()")).toBe(true);
    expect(await tables(c.db.admin)).toEqual(expect.arrayContaining(TABLES));
    const [row] = (await registry(c.db.admin)).filter((r) => r.key === "leader_desk");
    expect(row.blurb).not.toBe((await registry(baseline)).find((r) => r.key === "leader_desk")?.blurb);
  });
});
