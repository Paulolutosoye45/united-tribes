import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Leader cards", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270109000100) and the one with everything applied. The migration may
// replace the two audience functions it names and must not have changed any other function that already existed. The rollback file must put those two
// back exactly as they were, drop everything it added (the functions and the three tables), keep every card, message and consent, and change nothing
// the second time.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270109000100";
const THIS = "20270110000100_leader_cards";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270110000100")
  .sort()
  .reverse();
const REPLACED = ["audience_clean", "audience_base"];
const ADDED = [
  "leader_cards_role", "leader_card_state", "leader_card_rows", "leader_card_invite_of", "leader_last_activity", "leader_cards_board",
  "leader_card_department_set", "leader_cards_resend", "leader_cards_failures", "leader_cards_sheet", "leader_card_reminders_get",
  "leader_card_reminders_set", "leader_card_reminders_run", "worker_leader_card_reminders",
];
const REASON = "Trying the Thursday reminders";

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

describe("the way back from 'Leader cards'", () => {
  let before: Record<string, number>;
  let leader: { id: string; tribe: string };

  it("is what the migration added: only the two audience functions it names were replaced, the rest are new, and no trigger is new", async () => {
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

  it("starts with something to keep: a department, an email sent again, a reminder setting and the log of both", async () => {
    await c.reset();
    leader = await c.appoint("WayBack");
    await c.as(c.admin, "leader_card_department_set", leader.id, "Ushers");
    await c.as(c.admin, "leader_cards_resend", leader.id);
    await c.as(c.admin, "leader_card_reminders_set", "rehearsal", [4, 5], 10, REASON);
    expect(await count("leader_departments")).toBe(1);
    expect(await count("leader_card_log")).toBe(1);
    before = {
      tribes: await count("tribes"),
      people: await count("people"),
      messages: await count("messages"),
      consents: await count("consents"),
      events: (await c.one("select count(*)::int n from public.event_log where action like 'leader_cards.%'")).n,
    };
    expect(before.events).toBe(3);
    expect(before.messages).toBeGreaterThanOrEqual(1);
  });

  it("runs the rollback file without error, and it only drops what was added and puts two functions back", async () => {
    const text = rollbackText();
    expect(text).toMatch(/^-- /);
    expect(text).toMatch(/\bbegin;/);
    expect(text).toMatch(/\bcommit;\s*$/);
    const code = text
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const bodies = code.match(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$\$[\s\S]*?\$\$\s*;?/gi) ?? [];
    expect(bodies).toHaveLength(REPLACED.length);
    const own = bodies.reduce((rest, body) => rest.replace(body, ""), code);
    expect(own).not.toMatch(/\b(truncate|insert|update|delete)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdrop\s+table\s+if\s+exists\s+([a-z_.]+)/gi)].map((m) => m[1]).sort()).toEqual(
      ["public.leader_card_log", "public.leader_card_settings", "public.leader_departments"],
    );
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

  it("keeps every card, person, message, consent and log line, and drops only the three tables", async () => {
    expect(await count("tribes")).toBe(before.tribes);
    expect(await count("people")).toBe(before.people);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.event_log where action like 'leader_cards.%'")).n).toBe(before.events);
    for (const t of ["leader_departments", "leader_card_settings", "leader_card_log"]) {
      expect((await c.one("select to_regclass($1) as t", [`public.${t}`])).t).toBeNull();
    }
    expect((await c.one("select status from public.tribes where id = $1", [leader.tribe])).status).toBe("draft");
  });

  it("goes back to the old rule: announcements cannot pick the new audience, and the older ones are as they were", async () => {
    const clean = (v: unknown) => c.one("select public.audience_clean($1::jsonb) as r", [JSON.stringify(v)]);
    await expectCode(clean({ kind: "leader_cards" }), "22023");
    expect((await clean({ kind: "leaders" })).r).toEqual({ kind: "leaders" });
    await expectCode(c.as(c.admin, "leader_cards_board"), "42883");
    await expectCode(c.anon("worker_leader_card_reminders", "x".repeat(40)), "42883");
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("tribes")).toBe(before.tribes);
  });
});
