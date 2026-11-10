import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the Leader Desk, in God Mode" (Phase 1: see), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270115000100) and the one with everything applied. The migration replaces no
// function: it adds twenty-two, three tables and one place on the Switchboard. The rollback file must drop exactly those, put nothing back (there is nothing to
// put back), keep every seat, member, tribe, message, notice, consent and log line, change nothing the second time, and leave the Switchboard as it was.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270115000100";
const THIS = "20270116000100_leader_desk";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270116000100")
  .sort()
  .reverse();
const ADDED = [
  "leader_desk_any", "desk_need", "desk_base", "desk_kind", "desk_waiting_base", "desk_block_reason", "desk_group_fit", "desk_lead_base", "desk_lead_notes",
  "desk_overview", "desk_waiting", "desk_leaders", "desk_lead_signal", "desk_phone_reveal", "desk_group_view", "desk_groups_list", "desk_group_save",
  "desk_group_archive", "desk_group_member_add", "desk_group_member_remove", "desk_group_suggest", "desk_clusters",
];
const TABLES = ["desk_groups", "desk_group_members", "desk_reveals"];

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
const registry = async (cl: Client) => (await cl.query("select key from public.feature_registry order by sort, key")).rows.map((r) => r.key as string);

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `ldrbase_${Date.now().toString(36)}`;
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

describe("the way back from 'the Leader Desk'", () => {
  let before: Record<string, number>;

  it("is what the migration added: no function that existed before was changed, twenty-two are new, and no trigger is new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig))).toEqual([]);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    expect([...created].sort()).toEqual([...ADDED].sort());
    expect([...now.keys()].filter((sig) => !base.has(sig)).map(nameOf).sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    // three tables are new, and no table that existed was altered in the migration
    expect((await tables(c.db.admin)).filter((t) => !(["desk_groups", "desk_group_members", "desk_reveals"] as string[]).includes(t))).toEqual(await tables(baseline));
    expect(migrationText()).not.toMatch(/\balter\s+table\s+public\.(?!desk_)/i);
    // one place on the Switchboard is new
    expect((await registry(c.db.admin)).filter((k) => k !== "leader_desk")).toEqual(await registry(baseline));
  });

  it("starts with something to keep: a draft group, a member in it, an opened number, a switch, and the ordinary seats and messages", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.set("leader_desk", "rehearsal", { reason: "Rehearsing the way back" });
    const m = await readyMember(c.db, c.k, c.season, "Keep", { daysAgo: 5, whatsapp: "+2348031924657" });
    const track = await c.k.lookup("tracks", "builders");
    const g = await c.o.call("desk_group_save", null, "A draft to remove", track, null, null, "weeknight-evening", "online", null, "mixed", 6, null);
    await c.o.call("desk_group_member_add", g.id, m.id);
    await c.db.admin.query("insert into public.desk_reveals (person_id, by_person) values ($1, $2)", [m.id, c.o.owner.id]);
    expect(await count("desk_groups")).toBe(1);
    expect(await count("desk_group_members")).toBe(1);
    expect((await c.sql("select count(*)::int n from public.feature_settings where feature = 'leader_desk'"))[0].n).toBe(1);
    before = {
      tribe_members: await count("tribe_members"),
      tribes: await count("tribes"),
      member_profiles: await count("member_profiles"),
      messages: await count("messages"),
      notice_items: await count("notice_items"),
      consents: await count("consents"),
      people: await count("people"),
      event_log: await count("event_log"),
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
    // The only rows it removes are the Desk's own place on the Switchboard and its rules
    const deletes = [...code.matchAll(/\bdelete\s+from\s+([a-z_.]+)\s+where\s+([a-z_]+)\s*=\s*'([a-z_]+)'/gi)].map((m) => `${m[1]}.${m[2]}=${m[3]}`);
    expect(deletes.sort()).toEqual(["public.feature_registry.key=leader_desk", "public.feature_settings.feature=leader_desk"]);
    expect(code.match(/\bdelete\b/gi)).toHaveLength(2);
    expect(code).not.toMatch(/\b(truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/\bcreate\s+(or\s+replace\s+)?function\b/i);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    expect([...code.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions, triggers, tables and Switchboard the database had before, each function unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
    expect(await tables(c.db.admin)).toEqual(await tables(baseline));
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
    expect((await c.sql("select count(*)::int n from public.feature_settings where feature = 'leader_desk'"))[0].n).toBe(0);
  });

  it("keeps every seat, member, tribe, message, notice, consent and log line", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("closes the desk: its functions are gone, so the page shows 'switched off' and the rest of the site is unchanged", async () => {
    await expect(c.o.call("desk_overview")).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_waiting", null, 10, 0)).rejects.toThrow(/does not exist/);
    // The matching it read from is untouched
    expect(Array.isArray(await c.sql("select * from public.match_candidates($1)", [c.seasoned.members[0]]))).toBe(true);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    const firstTables = await tables(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await tables(c.db.admin)).toEqual(firstTables);
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
  });

  it("can be applied again over the way back", async () => {
    await c.db.admin.query(migrationText());
    expect((await functions(c.db.admin)).has("desk_overview()")).toBe(true);
    expect(await registry(c.db.admin)).toContain("leader_desk");
    expect(await tables(c.db.admin)).toEqual(expect.arrayContaining(TABLES));
  });
});
