import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "WhatsApp that cannot fail quietly", stage 4 (leader removal requests), rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270103000300, which is stage 3) and the one with everything applied.
// The migration replaced exactly two functions that already existed, match_candidates and placement_candidates (each with one added line that leaves out
// a tribe the church took a member out of). The rollback file must put both back as they were, drop everything else it added, take the one function off
// the Switchboard, keep every seat, attendance, testimony, consent and message and the log of who moved a switch, change nothing the second time, and
// leave stages 1 to 3 doing what they did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270103000300";
const THIS = "20270103000400_removal_requests";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270103000400")
  .sort()
  .reverse();
const TABLES = ["removal_requests", "removal_thread", "removal_blocks"];
const REPLACED = ["match_candidates", "placement_candidates"];
const GOOD = "Trying removal requests with everyone";

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
const nameOf = (sig: string) => sig.split("(")[0];
const migrationText = () => fs.readFileSync(path.join(MIGRATIONS, `${THIS}.sql`), "utf8");
const rollbackText = () => fs.readFileSync(path.join(ROLLBACK, `${THIS}.down.sql`), "utf8");

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `wa4base_${Date.now().toString(36)}`;
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

const FUNCTION_BODY = /\$([a-z_]*)\$[\s\S]*?\$\1\$/g;

describe("the way back from 'WhatsApp that cannot fail quietly', stage 4", () => {
  let before: Record<string, number>;
  let member: string;
  let tribe: string;
  let requestId: string;

  it("is what the migration added: the two scorers are the only functions replaced, and the rest are new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig)).sort()).toEqual(REPLACED);
    const created = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)) created.add(m[1].toLowerCase());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...created].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: a request approved and appealed, a seat released, the log of who moved a switch", async () => {
    await c.reset();
    const coach = (await c.k.staff("RollCoach", "coach")).id;
    await c.k.staff("RollCare", "care_lead");
    await c.set("removal_requests", "on", { reason: GOOD });
    const t = await c.k.tribe(c.season, { name: "Rollback Tribe", track: "builders" });
    tribe = t.tribe;
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [tribe, coach]);
    member = (await c.k.seat(tribe, c.season, "Released")).id;
    await c.k.seat(tribe, c.season, "Stays");
    await c.k.meetings(tribe, t.leader.id, 2, [[member, 2]]);
    const r = await c.as(t.leader.id, "removal_ask", tribe, member, "other", "He has missed many weeks and does not answer our calls.", true, false);
    requestId = r.id;
    await c.as(coach, "removal_decide", r.id, "approve", "Agreed with the leader on this.");
    await c.as(member, "removal_appeal", r.id, "Please look again at this decision.");
    expect((await c.one("select status from public.tribe_members where person_id = $1 and tribe_id = $2", [member, tribe])).status).toBe("released");
    expect(await c.sql("select r_tribe from public.match_candidates($1)", [member]).then((x) => x.map((y) => y.r_tribe))).not.toContain(tribe);
    before = {
      seats: await count("tribe_members"),
      released: (await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n,
      attendance: await count("tribe_attendance"),
      messages: await count("messages"),
      events: (await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n,
      feature_log: await count("feature_log"),
      feature_registry: await count("feature_registry"),
      consents: await count("consents"),
    };
    expect(before.released).toBe(1);
    expect(before.events).toBeGreaterThan(2);
    expect(before.messages).toBeGreaterThan(0);
    expect(before.feature_log).toBeGreaterThan(0);
    expect(before.feature_registry).toBe(25);
  });

  it("runs the rollback file without error, and writes only to the Switchboard's two tables", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(REPLACED);
    // Outside the text of the two restored functions, the file writes nothing but the Switchboard's rows
    const outside = code.replace(FUNCTION_BODY, "");
    expect(outside).not.toMatch(/\b(truncate|insert|update)\b\s/i);
    expect(code).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect([...outside.matchAll(/\bdelete\s+from\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual(["feature_registry", "feature_settings"]);
    const created = [...migrationText().matchAll(/create\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1].toLowerCase());
    const dropped = [...outside.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual(created.sort());
    expect([...outside.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_0-9]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    await c.db.admin.query(text);
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged (both scorers as they were)", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect([...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => sig)).toEqual([]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("drops the three tables and takes the function off the Switchboard, leaving stages 1 to 3", async () => {
    for (const t of TABLES) expect(await tableExists(t), t).toBe(false);
    expect(await count("feature_registry")).toBe(24);
    expect((await c.sql("select key from public.feature_registry where stage > 6 order by key")).map((r) => r.key)).toEqual(["number_required", "whatsapp_guard", "whatsapp_health"]);
    expect((await c.one("select count(*)::int n from public.feature_settings where feature = 'removal_requests'")).n).toBe(0);
  });

  it("keeps every seat as it was, every attendance, consent and message, the fact of each request in the log, and the log of who moved a switch", async () => {
    expect(await count("tribe_members")).toBe(before.seats);
    expect((await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n).toBe(before.released);
    expect(await count("tribe_attendance")).toBe(before.attendance);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect(await count("feature_log")).toBe(before.feature_log);
    expect((await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n).toBe(before.events);
    expect(JSON.stringify(await c.sql("select meta from public.event_log where action like 'removal.%'"))).not.toMatch(/missed many weeks|does not answer/);
  });

  it("stops every new door", async () => {
    const who = (await c.k.person("After")).id;
    for (const [fn, args] of [
      ["removal_ask", [tribe, member, "other", "x".repeat(30), true, false]],
      ["removal_answer", [requestId, "A reply"]],
      ["removal_withdraw", [requestId]],
      ["removal_mine", [tribe]],
      ["removal_board", []],
      ["removal_decide", [requestId, "approve", "A long enough note"]],
      ["my_removal", []],
      ["removal_appeal", [requestId, null]],
      ["removal_reinstate", [requestId, "A long enough note"]],
      ["removal_appeal_uphold", [requestId, "A long enough note"]],
    ] as const) await expect(c.as(who, fn, ...args), fn).rejects.toThrow(/does not exist/);
    await expect(c.db.asAnon((q) => q("select public.worker_removal_tick('x')"))).rejects.toThrow(/does not exist/);
  });

  it("offers the person taken out of the tribe the tribe again, the matching being as it was", async () => {
    expect(await c.sql("select r_tribe from public.match_candidates($1)", [member]).then((x) => x.map((y) => y.r_tribe))).toContain(tribe);
    expect(await c.sql("select r_tribe from public.placement_candidates($1, null)", [member]).then((x) => x.map((y) => y.r_tribe))).toContain(tribe);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("feature_registry")).toBe(24);
  });
});
