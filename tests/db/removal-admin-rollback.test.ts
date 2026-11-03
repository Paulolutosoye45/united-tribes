import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "an admin or director approves a removal request, a coach recommends, and the member waits three days", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270107000100) and the one with everything applied. The migration
// may replace the fourteen functions it names and must not have changed any other function that already existed. The rollback file must put those
// fourteen back exactly as they were, drop the three it added and the trigger that started the staff email groups, keep every seat, request, answer,
// message and consent, take away only the holds this change put on people (and never the owner's), and change nothing the second time. It adds no
// table: the columns it added stay where they are.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270107000100";
const THIS = "20270108000100_removal_admin";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270108000100")
  .sort()
  .reverse();
const REPLACED = [
  "removal_can_decide", "removal_ask", "removal_answer", "removal_release", "removal_reinstate", "removal_tick", "removal_board",
  "placement_hold_set", "placement_holds_list", "placement_pool_reason", "placement_one_check", "placement_overview", "placement_adjust", "admin_attention",
];
const ADDED = ["removal_can_recommend", "removal_recommend", "removal_switch_on_notices"];
const GOOD = "Trying the way back with a real request";
const NOTE = "He has missed five weeks and does not answer calls, and I have asked twice.";

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

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `rmabase_${Date.now().toString(36)}`;
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

describe("the way back from 'an admin approves'", () => {
  let before: Record<string, number>;
  let requestId: string;
  let member: string;
  let ownerHeld: string;
  let tribe: string;
  let coach: string;

  it("is what the migration added: only the fourteen functions it names were replaced, the rest are new, and one trigger is new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const named = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) named.add(m[1].toLowerCase());
    const created = [...named].filter((n) => !REPLACED.includes(n));
    expect(created.sort()).toEqual([...ADDED].sort());
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...ADDED].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    const baseTriggers = await triggers(baseline);
    expect((await triggers(c.db.admin)).filter((t) => !baseTriggers.includes(t))).toEqual(["feature_settings.feature_settings_removal_notices"]);
  });

  it("starts with something to keep: a request with the coach's recommendation, an approval and its hold, and a hold the owner put there", async () => {
    await c.reset();
    await c.sql("delete from public.removal_requests");
    await c.sql("delete from public.placement_holds");
    coach = (await c.k.staff("RmaCoach", "coach")).id;
    await c.set("removal_requests", "on", { reason: GOOD });
    const t = await c.k.tribe(c.season, { name: "Rollback Admin Tribe", track: "builders" });
    tribe = t.tribe;
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [tribe, coach]);
    member = (await c.k.seat(tribe, c.season, "Taken Out")).id;
    ownerHeld = (await c.k.seat(tribe, c.season, "Owner Held")).id;
    const r = await c.as(t.leader.id, "removal_ask", tribe, member, "other", NOTE, true, false);
    requestId = r.id;
    await c.as(coach, "removal_recommend", r.id, "approve", "I know this member; the leader is right here.");
    await c.as(c.admin, "removal_decide", r.id, "approve", "Looked at this carefully and agree.");
    await c.o.call("placement_hold_set", ownerHeld, "Waiting for a call");
    expect((await c.one("select source from public.placement_holds where person_id = $1", [member])).source).toBe("removal");
    before = {
      seats: await count("tribe_members"),
      released: (await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n,
      requests: await count("removal_requests"),
      messages: await count("messages"),
      consents: await count("consents"),
      events: (await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n,
      holds: await count("placement_holds"),
    };
    expect(before.released).toBe(1);
    expect(before.holds).toBe(2);
  });

  it("runs the rollback file without error, and its only writes are the holds this change made", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$function\$[\s\S]*?\$function\$\s*;?/gi) ?? [];
    expect(bodies).toHaveLength(REPLACED.length);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    expect(own).not.toMatch(/\b(truncate|insert|update)\b\s/i);
    expect([...own.matchAll(/\bdelete\s+from\s+([a-z_.]+)[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, " "))).toEqual(["delete from public.placement_holds where source in ('removal', 'care');"]);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|table|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...code.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect(dropped.sort()).toEqual([...ADDED].sort());
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

  it("keeps every seat, request, message, consent and log line, takes away the hold this change made, and keeps the owner's", async () => {
    expect(await count("tribe_members")).toBe(before.seats);
    expect((await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n).toBe(before.released);
    expect(await count("removal_requests")).toBe(before.requests);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.event_log where action like 'removal.%'")).n).toBe(before.events);
    const holds = await c.sql("select person_id, source, note from public.placement_holds");
    expect(holds.map((h) => h.person_id)).toEqual([ownerHeld]);
    expect(holds[0]).toMatchObject({ source: "owner", note: "Waiting for a call" });
    // the person taken out of the tribe can be considered by the matching again, as before this change
    expect((await c.one("select public.placement_pool_reason($1, $2, 0) as r", [member, c.season])).r).not.toBe("held");
  });

  it("goes back to the old rule: the recommendation door is gone, a coach decides an ordinary request again, and Today has no removals line", async () => {
    await expect(c.as(coach, "removal_recommend", requestId, "approve", "A long enough note here")).rejects.toThrow(/does not exist/);
    const t = await c.k.tribe(c.season, { name: "Rollback Admin Two", track: "builders" });
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [t.tribe, coach]);
    const m = (await c.k.seat(t.tribe, c.season, "Second")).id;
    const r = await c.as(t.leader.id, "removal_ask", t.tribe, m, "other", NOTE, true, false);
    expect((await c.as(c.admin, "admin_attention")).rows.find((x: { key: string }) => x.key === "removals")).toBeUndefined();
    await c.as(coach, "removal_decide", r.id, "decline", "Please keep visiting him; he needs you.");
    expect((await c.one("select status from public.removal_requests where id = $1", [r.id])).status).toBe("declined");
    // moving the switch no longer starts any email group
    await c.sql("update public.notice_settings set mode = 'off'");
    await c.set("removal_requests", "off", { reason: GOOD });
    await c.set("removal_requests", "on", { reason: GOOD });
    expect((await c.sql("select 1 from public.notice_settings where mode <> 'off'"))).toHaveLength(0);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("tribe_members")).toBe(before.seats + 1);
    expect((await c.sql("select 1 from public.placement_holds"))).toHaveLength(1);
  });
});
