import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the Leader Desk, the three things Phase 2 left out" ("Yes, as assistant", "Recommend as leader" on a waiting member's row, WhatsApp for the
// Desk), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270124000100) and the one with everything applied. The migration replaces seven
// functions, adds five, adds seven columns (three on the Desk's groups, four on its settings), widens one check and adds four rows to WhatsApp mode's table of
// classes. The rollback file must put every replaced function back exactly as it was, drop what was added, narrow the check, keep every seat, member, tribe,
// message, recommendation and log line, send anything waiting back to email, change nothing the second time, and be applied again over the way back.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270124000100";
const THIS = "20270125000100_desk_extras";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270125000100")
  .sort()
  .reverse();
const REPLACED = ["desk_group_leader", "desk_mail_send", "desk_offer_complete", "desk_offer_open", "desk_offer_tick", "worker_desk_offer_answer", "worker_desk_offer_info"];
const ADDED = ["desk_assistant_put_forward", "desk_person_lead_options", "desk_whatsapp_on", "desk_whatsapp_set", "desk_whatsapp_state"];
const NEW_COLUMNS = [
  "desk_groups.assistant_id",
  "desk_groups.assistant_yes_at",
  "desk_groups.assistant_offer_id",
  "desk_settings.whatsapp_on",
  "desk_settings.whatsapp_reason",
  "desk_settings.whatsapp_changed_by",
  "desk_settings.whatsapp_changed_at",
];

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
const WATCHED = "('desk_groups', 'desk_settings', 'desk_offers', 'desk_proposals', 'assistant_recommendations', 'whatsapp_message_class')";
const columns = async (cl: Client) =>
  (
    await cl.query(`select table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') as c
                      from information_schema.columns where table_schema = 'public' and table_name in ${WATCHED}
                     order by table_name, ordinal_position`)
  ).rows.map((r) => r.c as string);
const constraints = async (cl: Client) =>
  (
    await cl.query(`select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as c from pg_constraint
                     where connamespace = 'public'::regnamespace and conrelid::regclass::text in ${WATCHED} order by 1`)
  ).rows.map((r) => r.c as string);
const indexes = async (cl: Client) =>
  (await cl.query(`select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename in ${WATCHED} order by 1`)).rows.map((r) => r.i as string);
const count = async (table: string) => (await c.one(`select count(*)::int n from public.${table}`)).n as number;
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const registry = async (cl: Client) => (await cl.query("select key, name, blurb, stage, depends, modes, default_mode, available, sort, platform_only from public.feature_registry order by sort, key")).rows;

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `ldxbase_${Date.now().toString(36)}`;
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

describe("the way back from the Desk's three extras", () => {
  let before: Record<string, number>;
  let recommendation: string;
  let assistOffer: string;
  let waiting: string;

  it("is what the migration did: seven functions replaced, five new, no table, trigger or Switchboard line", async () => {
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
    const baseCols = await columns(baseline);
    const added = (await columns(c.db.admin)).filter((col) => !baseCols.includes(col));
    expect(added.map((col) => col.split(" ")[0]).sort()).toEqual([...NEW_COLUMNS].sort());
    expect(await registry(c.db.admin)).toEqual(await registry(baseline));
  });

  it("starts with something to keep: a member who offered to assist, the recommendation that put them forward, Desk messages waiting, and the ordinary seats", async () => {
    await c.reset();
    await c.k.moveSeason(c.season, 3);
    await c.db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
    await c.db.admin.query("update public.desk_settings set daily_cap = 300");
    await c.k.tribe(c.season, { name: "Keep this tribe" });
    await c.set("leader_desk", "on", { reason: "Trying the extras before the way back" });
    const token = (await c.one("select public.bootstrap_worker_token('desk-extras-rollback') as t")).t as string;
    const track = await c.k.lookup("tracks", "builders");
    const comm = await c.k.lookup("communities", "professionals");
    const goal = await c.k.goalOf("professionals");
    const g = (await c.o.call("desk_group_save", null, "Keep this group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const person = async (name: string) => {
      const m = await readyMember(c.db, c.k, c.season, name, { daysAgo: 6, faith: "established" });
      await c.db.admin.query("update public.member_profiles set open_to_serving = 'yes' where person_id = $1", [m.id]);
      return m;
    };
    const helper = await person("KeepHelper");
    const leader = await person("KeepLeader");
    waiting = (await person("KeepWaiting")).id;
    await c.o.call("desk_offer_send", g.id, [helper.id, leader.id]);
    const linkOf = async (p: string) =>
      (await c.one("select m.reply_token from public.messages m join public.desk_offers o on m.dedupe_key = 'desk-offer:' || o.id::text where o.group_id = $1 and o.person_id = $2", [g.id, p])).reply_token as string;
    expect(await c.anon("worker_desk_offer_answer", token, await linkOf(helper.id), "assist", true, null, null, [])).toMatchObject({ ok: true, answer: "assist" });
    assistOffer = (await c.one("select id from public.desk_offers where group_id = $1 and person_id = $2", [g.id, helper.id])).id as string;
    expect(await c.anon("worker_desk_offer_answer", token, await linkOf(leader.id), "lead", true, "connection", "achieved", [])).toMatchObject({ ok: true, answer: "lead" });
    const tribe = (await c.one("select tribe_id from public.desk_groups where id = $1", [g.id])).tribe_id as string;
    recommendation = (await c.one("select id from public.assistant_recommendations where tribe_id = $1", [tribe])).id as string;
    // the Desk's WhatsApp switch turned On, and a message waiting that was left free to go any way
    await c.o.call("desk_whatsapp_set", true, "Trying WhatsApp before the way back");
    const g2 = (await c.o.call("desk_group_save", null, "Second group", track, comm, goal, "weeknight-evening", "in_person", "mainland", "mixed", 8, null)) as { id: string };
    const other = await person("KeepOther");
    await c.o.call("desk_offer_send", g2.id, [other.id]);
    await c.db.admin.query("update public.messages set status = 'queued' where template = 'desk_offer' and person_id = $1", [other.id]);
    expect((await c.one("select force_channel from public.messages where template = 'desk_offer' and person_id = $1", [other.id])).force_channel).toBeNull();
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
      desk_offers: await count("desk_offers"),
      assistant_recommendations: await count("assistant_recommendations"),
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
    expect(code).not.toMatch(/\binsert\b/i);
    // every row it changes is inside a guarded block (each block first looks for its table, so running the file twice, or after the Desk's own way back, is safe)
    expect([...code.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`)).toEqual([]);
    expect(code).not.toMatch(/\bdelete\b/i);
    // the word "assist" on an answered offer
    const assistBlock = /\$rbassist\$([\s\S]*?)\$rbassist\$/.exec(text)?.[1] ?? "";
    expect(assistBlock).toMatch(/to_regclass\('public\.desk_offers'\) is not null/);
    expect([...assistBlock.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["public.desk_offers.answer"]);
    // ...and, in one guarded block, Desk messages still waiting (back to email) and the four lines the migration added to WhatsApp mode's table of classes
    const block = /\$rb\$([\s\S]*?)\$rb\$/.exec(text)?.[1] ?? "";
    expect([...block.matchAll(/\bupdate\s+([a-z_.]+)\s+set\s+([a-z_]+)/gi)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["public.messages.force_channel"]);
    expect([...block.matchAll(/\bdelete\s+from\s+([a-z_.]+)/gi)].map((m) => m[1])).toEqual(["public.whatsapp_message_class"]);
    expect(block).toMatch(/template in \('desk_offer', 'desk_proposal', 'desk_interest', 'desk_found'\)/);
    expect([...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...ADDED].sort());
    expect([...text.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase()).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+column\s+if\s+exists\s+([a-z_]+)/gi)].map((m) => m[1]).sort();
    expect(dropped).toEqual(NEW_COLUMNS.map((col) => col.split(".")[1]).sort());
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

  it("keeps every seat, member, tribe, message, recommendation and log line, and the recommendation is still the office's to decide", async () => {
    for (const [table, n] of Object.entries(before)) expect(await count(table), table).toBe(n);
    expect((await c.one("select status from public.assistant_recommendations where id = $1", [recommendation])).status).toBe("requested");
  });

  it("loses only the word \"assist\" on the offer that carried it, and keeps it as a no to leading", async () => {
    const o = await c.one("select status, answer from public.desk_offers where id = $1", [assistOffer]);
    expect(o).toMatchObject({ status: "declined", answer: null });
    await expect(c.db.admin.query("update public.desk_offers set answer = 'assist' where id = $1", [assistOffer])).rejects.toThrow(/check/);
  });

  it("sends every Desk message still waiting back to email, and takes the Desk off WhatsApp's table of classes", async () => {
    expect((await c.one("select count(*)::int n from public.messages where template like 'desk_%' and status = 'queued' and force_channel is distinct from 'email'")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.whatsapp_message_class where template like 'desk_%'")).n).toBe(0);
  });

  it("closes the three new features and leaves the Desk working as it did", async () => {
    await c.set("leader_desk", "rehearsal", { reason: "The Desk after the way back" });
    await expect(c.o.call("desk_person_lead_options", waiting)).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_whatsapp_state")).rejects.toThrow(/does not exist/);
    await expect(c.o.call("desk_whatsapp_set", true, "Back again")).rejects.toThrow(/does not exist/);
    const view = (await c.o.call("desk_group_leader", (await c.one("select id from public.desk_groups limit 1")).id)) as Record<string, unknown>;
    expect(view).not.toHaveProperty("assistant");
    expect(Array.isArray((await c.o.call("desk_offers_list", 10, 0)).rows)).toBe(true);
    await c.set("leader_desk", "off", { reason: "Done" });
    // Changing the switch writes its own log lines; the second run is measured from here
    before.event_log = await count("event_log");
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

  it("can be applied again over the way back, with the switch Off and \"assist\" allowed again", async () => {
    await c.db.admin.query(migrationText());
    expect((await functions(c.db.admin)).has("desk_whatsapp_state()")).toBe(true);
    expect((await c.one("select whatsapp_on from public.desk_settings")).whatsapp_on).toBe(false);
    expect((await c.one("select count(*)::int n from public.whatsapp_message_class where template like 'desk_%'")).n).toBe(4);
    await c.db.admin.query("update public.desk_offers set answer = 'assist' where id = $1", [assistOffer]);
  });
});
