import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "place or move one person from Admin", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270108000100) and the one with everything applied. The migration may
// replace the four functions it names and must not have changed any other function that already existed. The rollback file must put those four
// back exactly as they were, drop everything it added (the functions and the table of requests to the owner), keep every seat, run, message and
// consent, and change nothing the second time. The columns it added to the runs stay where they are.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270108000100";
const THIS = "20270109000100_office_placement";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270109000100")
  .sort()
  .reverse();
const REPLACED = ["placement_one_options", "placement_one_check", "placement_one_place", "placement_undo"];
const ADDED = [
  "placement_gate", "placement_reason_words", "placement_run_undoable", "placement_check_core", "placement_office_do", "placement_one_move",
  "placement_move_check", "placement_office_ask", "placement_requests_list", "placement_request_check", "placement_request_decide",
  "placement_request_withdraw", "placement_find", "placement_office_person", "placement_office_tribes", "placement_office_tribe", "placement_office_counts",
];
const REASON = "Asked me in person after church";

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
  baselineName = `opbase_${Date.now().toString(36)}`;
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

describe("the way back from 'place or move one person from Admin'", () => {
  let before: Record<string, number>;
  let placed: { id: string; tribe: string };
  let owner: string;

  it("is what the migration added: only the four functions it names were replaced, the rest are new, and no trigger is new", async () => {
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
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: a person an admin placed, a move, a request to the owner and the run records", async () => {
    await c.reset();
    await c.sql("update public.tribes set status = 'closed' where status = 'approved'");
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    await c.k.moveSeason(c.season, 5);
    const A = await c.k.tribe(c.season, { name: "Way Back A", assistant: "certified" });
    const B = await c.k.tribe(c.season, { name: "Way Back B", assistant: "certified" });
    const m = await readyMember(c.db, c.k, c.season, "Way Back One", { times: ["weeknight-evening"], daysAgo: 40 });
    const s = await readyMember(c.db, c.k, c.season, "Way Back Sunday", { times: ["sunday-afternoon"], daysAgo: 40 });
    await c.as(c.admin, "placement_one_place", m.id, A.tribe, [], null, false);
    await c.as(c.director, "placement_one_move", m.id, B.tribe, [], null, false);
    await c.as(c.admin, "placement_office_ask", s.id, A.tribe, ["no_score"], REASON, false, false);
    placed = { id: m.id, tribe: B.tribe };
    owner = A.tribe;
    expect(await count("placement_requests")).toBe(1);
    before = {
      seats: await count("tribe_members"),
      released: (await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n,
      runs: await count("placement_runs"),
      byOffice: (await c.one("select count(*)::int n from public.placement_runs where placed_via = 'office'")).n,
      messages: await count("messages"),
      consents: await count("consents"),
      events: (await c.one("select count(*)::int n from public.event_log where action like 'placement.%'")).n,
    };
    expect(before.byOffice).toBe(2);
    expect(before.released).toBe(1);
  });

  it("runs the rollback file without error, and it only drops what was added and puts four functions back", async () => {
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
    expect(own).not.toMatch(/\b(truncate|insert|update|delete)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdrop\s+table\s+if\s+exists\s+([a-z_.]+)/gi)].map((m) => m[1])).toEqual(["public.placement_requests"]);
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

  it("keeps every seat, run, message, consent and log line, and drops only the table of requests", async () => {
    expect(await count("tribe_members")).toBe(before.seats);
    expect((await c.one("select count(*)::int n from public.tribe_members where status = 'released'")).n).toBe(before.released);
    expect(await count("placement_runs")).toBe(before.runs);
    expect((await c.one("select count(*)::int n from public.placement_runs where placed_via = 'office'")).n).toBe(before.byOffice);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.event_log where action like 'placement.%'")).n).toBe(before.events);
    expect((await c.one("select to_regclass('public.placement_requests') as t")).t).toBeNull();
    expect((await c.one("select tribe_id from public.tribe_members where person_id = $1 and status = 'active'", [placed.id])).tribe_id).toBe(placed.tribe);
  });

  it("goes back to the old rule: only the owner places one person and undoes a run", async () => {
    for (const who of [c.admin, c.director]) {
      await expectCode(c.as(who, "placement_one_check", placed.id, owner), "42501");
      await expectCode(c.as(who, "placement_one_options", placed.id), "42501");
    }
    expect((await c.o.call("placement_one_check", placed.id, owner)).blockers.map((x: { code: string }) => x.code)).toContain("has_seat");
    await expect(c.as(c.admin, "placement_find", "way")).rejects.toThrow(/does not exist/);
    const run = (await c.one("select id from public.placement_runs where placed_via = 'office' order by planned_at limit 1")).id as string;
    await expectCode(c.as(c.admin, "placement_undo", run), "42501");
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("tribe_members")).toBe(before.seats);
  });
});
