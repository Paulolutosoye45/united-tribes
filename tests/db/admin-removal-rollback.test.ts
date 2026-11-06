import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Remove a member from a tribe, from Admin", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270111000100) and the one with everything applied. The migration may
// replace one function that already existed (the heartbeat's removal round, which now also clears old reasons) and must not have changed any other. The
// rollback file must put that one back exactly as it was, drop the six functions and the table it added, lift the office's own blocks in the table of blocked
// tribes (nothing is deleted, and nothing is left blocked for good; the column the migration added there stays, as earlier files leave theirs), keep every
// seat, hold, message and log line, and change nothing the second time.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270111000100";
const THIS = "20270112000100_admin_remove";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270112000100")
  .sort()
  .reverse();
const REPLACED = ["worker_removal_tick"];
const ADDED = ["admin_remove_member", "admin_put_back", "admin_removal_lately", "admin_tribe_members", "admin_removal_person", "admin_removal_tidy"];
const WHY = "Moved away from Lagos and asked to step back";

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
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");
const columns = async (table: string) =>
  (await c.sql("select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [table])).map(
    (r) => `${r.column_name}:${r.is_nullable}`,
  );
const keys = async (table: string) =>
  (await c.sql("select conname, contype from pg_constraint where conrelid = $1::regclass and contype in ('p', 'c', 'u') order by conname", [`public.${table}`])).map((r) => `${r.conname}:${r.contype}`);

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `arbase_${Date.now().toString(36)}`;
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

describe("the way back from 'Remove a member from a tribe, from Admin'", () => {
  let before: Record<string, number>;
  let office: { tribe: string; member: string; removal: string };
  let asked: { member: string; request: string };
  let blocksBefore: string[];

  it("is what the migration added: only the heartbeat's removal round was replaced, the rest are new, and no trigger is new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const named = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) named.add(m[1].toLowerCase());
    expect([...named].filter((n) => !REPLACED.includes(n)).sort()).toEqual([...ADDED].sort());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...ADDED].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: a seat the office released with its hold and emails, and a leader's request that blocked another tribe", async () => {
    await c.reset();
    const careLead = (await c.k.staff("RollCare", "care_lead")).id;
    const coach = (await c.k.staff("RollCoach", "coach")).id;
    await c.set("removal_requests", "on", { reason: "Trying removal requests with everyone" });
    const t = await c.k.tribe(c.season, { name: "Way back office", track: "builders" });
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [t.tribe, coach]);
    const gone = (await c.k.seat(t.tribe, c.season, "OfficeGone")).id;
    await c.k.seat(t.tribe, c.season, "OfficeStays");
    const u = await c.k.tribe(c.season, { name: "Way back request", track: "builders" });
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [u.tribe, coach]);
    const asker = (await c.k.seat(u.tribe, c.season, "RequestGone")).id;
    await c.k.seat(u.tribe, c.season, "RequestStays");
    const r = await c.as(c.admin, "admin_remove_member", t.tribe, gone, WHY);
    office = { tribe: t.tribe, member: gone, removal: r.removal };
    const ask = await c.as(u.leader.id, "removal_ask", u.tribe, asker, "other", "He has missed many weeks and does not answer our calls.", true, false);
    await c.as(careLead, "removal_decide", ask.id, "approve", "Looked at this carefully and agree with the leader.");
    asked = { member: asker, request: ask.id };
    expect((await c.sql("select 1 from public.removal_blocks where lifted_at is null")).length).toBe(2);
    blocksBefore = (await c.sql("select request_id from public.removal_blocks where request_id is not null")).map((x) => x.request_id as string);
    before = {
      tribes: await count("tribes"),
      people: await count("people"),
      seats: await count("tribe_members"),
      released: (await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n,
      holds: await count("placement_holds"),
      messages: await count("messages"),
      consents: await count("consents"),
      events: (await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n,
    };
    expect(before.released).toBe(2);
    expect(before.holds).toBe(2);
  });

  it("runs the rollback file without error, and it only drops what was added, lifts the office's own blocks, deletes nothing, and puts one function back", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const bodies = code.match(/create\s+(?:or\s+replace\s+)?function[\s\S]*?as\s+\$\$[\s\S]*?\$\$\s*;?/gi) ?? [];
    expect(bodies).toHaveLength(REPLACED.length);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    // It deletes nothing (the older rollback tests insist on that), and the only rows it changes are the office's own blocks, which it lifts
    expect(own).not.toMatch(/\b(delete|truncate|insert)\b\s/i);
    expect([...own.matchAll(/\bupdate\s+(public\.[a-z_]+)/gi)].map((m) => m[1])).toEqual(["public.removal_blocks"]);
    expect(own).toMatch(/update public\.removal_blocks set lifted_at = coalesce\(lifted_at, now\(\)\) where request_id is null;/);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdrop\s+table\s+if\s+exists\s+([a-z_.]+)/gi)].map((m) => m[1])).toEqual(["public.admin_removals"]);
    expect([...code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect([...new Set(dropped)].sort()).toEqual([...ADDED].sort());
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

  it("drops the office's table, and leaves the table of blocked tribes with only what the migration added there, as earlier files leave theirs", async () => {
    expect((await c.one("select to_regclass('public.admin_removals') as t")).t).toBeNull();
    const baseCols = (await baseline.query("select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'removal_blocks' order by ordinal_position")).rows.map(
      (r) => `${r.column_name}:${r.is_nullable}`,
    );
    // the same columns as before, plus the one that was added, and request_id may be empty (the office's own rows have none)
    expect(await columns("removal_blocks")).toEqual([...baseCols.map((x) => (x === "request_id:NO" ? "request_id:YES" : x)), "admin_removal_id:YES"]);
    // the rule the old functions rely on (one block for each request) still holds, as a unique index in place of the primary key
    expect(await keys("removal_blocks")).toEqual(["removal_blocks_one_source:c"]);
    await expect(
      c.sql("insert into public.removal_blocks (request_id, person_id, tribe_id, season_id) select request_id, person_id, tribe_id, season_id from public.removal_blocks where request_id is not null limit 1"),
    ).rejects.toThrow(/removal_blocks_request_uidx/);
  });

  it("keeps every person, seat, hold, message, consent and log line, and the leader's request and its block", async () => {
    expect(await count("tribes")).toBe(before.tribes);
    expect(await count("people")).toBe(before.people);
    expect(await count("tribe_members")).toBe(before.seats);
    expect((await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n).toBe(before.released);
    expect(await count("placement_holds")).toBe(before.holds);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n).toBe(before.events);
    // the office's removal stays a removal: still out of the tribe, still with the hold; only the memory that the church took them out of that tribe is gone
    expect((await c.one("select status from public.tribe_members where person_id = $1 and tribe_id = $2", [office.member, office.tribe])).status).toBe("released");
    expect(await c.sql("select 1 from public.placement_holds where person_id = $1 and source = 'removal'", [office.member])).toHaveLength(1);
    // its block is still a row, but lifted, so nothing is left blocked for good; the matching may offer that tribe again
    const lifted = await c.sql("select request_id, lifted_at from public.removal_blocks where person_id = $1", [office.member]);
    expect(lifted).toHaveLength(1);
    expect(lifted[0].request_id).toBeNull();
    expect(lifted[0].lifted_at).not.toBeNull();
    expect(await c.sql("select r_tribe from public.match_candidates($1)", [office.member]).then((x) => x.map((y) => y.r_tribe))).toContain(office.tribe);
    // the leader's request and its block are as they were
    const kept = (await c.sql("select request_id, lifted_at from public.removal_blocks where request_id is not null")).map((x) => x.request_id as string);
    expect(kept).toEqual(blocksBefore);
    expect(kept).toEqual([asked.request]);
    expect((await c.one("select lifted_at from public.removal_blocks where request_id = $1", [asked.request])).lifted_at).toBeNull();
    expect(await c.sql("select r_tribe from public.match_candidates($1)", [asked.member]).then((x) => x.map((y) => y.r_tribe))).not.toContain(
      (await c.one("select tribe_id from public.removal_requests where id = $1", [asked.request])).tribe_id,
    );
  });

  it("goes back to the old heartbeat, and the new screens are gone", async () => {
    await expectCode(c.as(c.admin, "admin_remove_member", office.tribe, office.member, WHY), "42883");
    await expectCode(c.as(c.admin, "admin_put_back", office.removal), "42883");
    await expectCode(c.as(c.admin, "admin_tribe_members", office.tribe), "42883");
    await expectCode(c.as(c.admin, "admin_removal_person", office.member), "42883");
    const token = (await c.one("select public.bootstrap_worker_token('test-admin-removal-rollback') as t")).t;
    expect(await c.anon("worker_removal_tick", token)).toBeDefined();
    // the leader's own requests carry on, and the place can still be put back by the Care Lead
    const careLead = (await c.one("select person_id from public.person_roles where role = 'care_lead' limit 1")).person_id as string;
    expect(await c.as(careLead, "removal_reinstate", asked.request, "Looked again and the place should be back.")).toMatchObject({ ok: true });
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    const firstCols = await columns("removal_blocks");
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await columns("removal_blocks")).toEqual(firstCols);
    expect(await count("tribes")).toBe(before.tribes);
    expect(await count("people")).toBe(before.people);
  });
});
