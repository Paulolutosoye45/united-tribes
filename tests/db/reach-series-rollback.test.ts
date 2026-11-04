import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "Reach series and Tribe note", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270110000100) and the one with everything applied. The migration may
// replace the four Contact gaps functions it names (one of them with a new set of arguments) and must not have changed any other function that
// already existed. The rollback file must put those four back exactly as they were, drop everything it added (the functions and the six tables), take
// the two Switchboard rows away, stop any email of the series that has not gone yet, keep every person, number, consent, message and log line, and
// change nothing the second time.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270110000100";
const THIS = "20270111000100_reach_series";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270111000100")
  .sort()
  .reverse();
const REPLACED = ["contact_ask_history", "contact_ask_send", "contact_gaps_export", "contact_gaps_report"];
const ADDED = [
  "reach_email_days", "reach_mask", "reach_signin_number", "reach_number_kind", "reach_gap_kind", "reach_block_of", "reach_state_of", "reach_window_ok",
  "reach_link_mint", "reach_link_open", "reach_end", "reach_enrol", "reach_had_series", "reach_enrol_sweep", "reach_send", "reach_step",
  "reach_series_tick", "reach_apply_number", "reach_close_if_fixed", "reach_person_status", "reach_series_of", "tribe_reach", "reach_ask_tribe",
  "reach_follow_up", "tribe_note_send", "reach_series_pause", "reach_series_stop", "god_reach_settings", "god_reach_settings_set",
  "worker_reach_tick", "worker_reach_info", "worker_reach_save", "worker_reach_email_instead", "worker_reach_new_link", "worker_placed_reach",
  "worker_placed_reach_save",
];
const TABLES = ["reach_settings", "reach_enrolments", "reach_sends", "reach_links", "reach_leader_asks", "tribe_notes"];
const REASON = "Trying the contact series";

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
const EVENTS = "action like 'reach.%' or action like 'tribe_note.%'";

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `rsbase_${Date.now().toString(36)}`;
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

describe("the way back from 'Reach series and Tribe note'", () => {
  let before: Record<string, number>;
  let leader: { id: string; tribe: string };
  let asked: string;

  it("is what the migration added: only the four Contact gaps functions it names were replaced, the rest are new, and no trigger is new", async () => {
    const base = await functions(baseline);
    const now = await functions(c.db.admin);
    const changed = [...base].filter(([sig, def]) => now.get(sig) !== def).map(([sig]) => nameOf(sig));
    expect(changed.sort()).toEqual([...REPLACED].sort());
    const named = new Set<string>();
    for (const m of migrationText().matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)) named.add(m[1].toLowerCase());
    const created = [...named].filter((n) => !REPLACED.includes(n));
    expect(created.sort()).toEqual([...ADDED].sort());
    // The report has a new set of arguments, so it is one old signature gone and one new one
    const extra = [...now.keys()].filter((sig) => !base.has(sig)).map(nameOf);
    expect(extra.sort()).toEqual([...ADDED, "contact_gaps_report"].sort());
    expect([...base.keys()].filter((sig) => !now.has(sig)).map(nameOf)).toEqual(["contact_gaps_report"]);
    expect(await triggers(c.db.admin)).toEqual(await triggers(baseline));
  });

  it("starts with something to keep: a series with an email waiting, a tribe note, a private link, and the log of all of it", async () => {
    await c.reset();
    await c.db.admin.query("delete from public.erasure_requests");
    await c.set("contact_gaps", "on", { reason: REASON });
    await c.set("reach_series", "on", { reason: REASON });
    await c.set("tribe_note", "on", { reason: REASON });
    const t = await c.k.tribe(c.season, { name: "Way back", capacity: 12 });
    leader = { id: t.leader.id, tribe: t.tribe };
    asked = (await c.k.seat(t.tribe, c.season, "Asked")).id;
    await c.k.seat(t.tribe, c.season, "Noted");
    expect(await c.as(leader.id, "reach_ask_tribe", leader.tribe, "Please add your number")).toMatchObject({ ok: true, sent: 2 });
    expect(await c.as(leader.id, "tribe_note_send", leader.tribe, "A word for the tribe")).toMatchObject({ ok: true });
    expect(await count("reach_enrolments")).toBeGreaterThanOrEqual(2);
    expect(await count("reach_links")).toBeGreaterThanOrEqual(2);
    expect(await count("tribe_notes")).toBe(1);
    // One email already went; one is still waiting
    await c.db.admin.query("update public.messages set status = 'sent', sent_at = now() where person_id = $1 and template = 'reach_series'", [asked]);
    before = {
      tribes: await count("tribes"),
      people: await count("people"),
      messages: await count("messages"),
      consents: await count("consents"),
      members: await count("tribe_members"),
      events: (await c.one(`select count(*)::int n from public.event_log where ${EVENTS}`)).n,
    };
    expect(before.events).toBeGreaterThanOrEqual(2);
    expect((await c.one("select count(*)::int n from public.messages where template in ('reach_series', 'tribe_note') and status = 'queued'")).n).toBeGreaterThanOrEqual(2);
  });

  it("runs the rollback file without error, and it only drops what was added, stops the waiting emails, and puts four functions back", async () => {
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
    // The only data it touches: the waiting emails of the two new templates, and the Switchboard's rows for the two new functions
    expect([...own.matchAll(/\bupdate\s+(public\.[a-z_]+)/gi)].map((m) => m[1])).toEqual(["public.messages"]);
    expect([...own.matchAll(/\bdelete\s+from\s+(public\.[a-z_]+)/gi)].map((m) => m[1]).sort()).toEqual(["public.feature_registry", "public.feature_settings"]);
    expect(own).not.toMatch(/\b(truncate|insert)\b\s/i);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdrop\s+table\s+if\s+exists\s+([a-z_.]+)/gi)].map((m) => m[1]).sort()).toEqual(TABLES.map((t) => `public.${t}`).sort());
    expect([...code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect([...new Set(dropped)].sort()).toEqual([...ADDED, "contact_gaps_report"].sort());
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

  it("keeps every person, seat, message, consent and log line, drops the six tables and the two Switchboard rows, and stops only what had not gone", async () => {
    expect(await count("tribes")).toBe(before.tribes);
    expect(await count("people")).toBe(before.people);
    expect(await count("tribe_members")).toBe(before.members);
    expect(await count("messages")).toBe(before.messages);
    expect(await count("consents")).toBe(before.consents);
    expect((await c.one(`select count(*)::int n from public.event_log where ${EVENTS}`)).n).toBe(before.events);
    for (const t of TABLES) expect((await c.one("select to_regclass($1) as t", [`public.${t}`])).t).toBeNull();
    expect(await c.one("select count(*)::int n from public.feature_registry where key in ('reach_series', 'tribe_note')")).toEqual({ n: 0 });
    expect(await c.one("select count(*)::int n from public.feature_settings where feature in ('reach_series', 'tribe_note')")).toEqual({ n: 0 });
    // The email that had gone is still sent; nothing of either template is still waiting, and no private link is left in a waiting row
    expect((await c.one("select count(*)::int n from public.messages where template in ('reach_series', 'tribe_note') and status = 'sent'")).n).toBeGreaterThanOrEqual(1);
    expect((await c.one("select count(*)::int n from public.messages where template in ('reach_series', 'tribe_note') and status in ('queued', 'sending')")).n).toBe(0);
    expect((await c.one("select count(*)::int n from public.messages where template in ('reach_series', 'tribe_note') and status = 'skipped' and reply_token is not null")).n).toBe(0);
    // Contact gaps itself carries on
    expect((await c.one("select public.feature_summary('contact_gaps') as s")).s).toBeDefined();
  });

  it("goes back to the old report and the old single ask, and the new screens are gone", async () => {
    const report = await c.as(c.admin, "contact_gaps_report", null, null, null, 20, 0);
    expect(report).toMatchObject({ state: "on", role: "act" });
    expect(report.series_counts).toBeUndefined();
    expect(report.rows[0].series).toBeUndefined();
    const file = await c.as(c.admin, "contact_gaps_export");
    expect(Object.keys(file[0]).sort()).toEqual(["asks", "cause", "last_asked", "leader", "name", "tribe"]);
    await expectCode(c.as(c.admin, "contact_gaps_report", null, null, null, 20, 0, null), "42883");
    await expectCode(c.as(leader.id, "tribe_reach", leader.tribe), "42883");
    await expectCode(c.as(leader.id, "reach_ask_tribe", leader.tribe, null), "42883");
    await expectCode(c.as(leader.id, "tribe_note_send", leader.tribe, "Hello"), "42883");
    await expectCode(c.anon("worker_reach_tick", "x".repeat(40)), "42883");
    await expectCode(c.anon("worker_reach_info", "x".repeat(40), "a".repeat(64)), "42883");
    await expectCode(c.anon("worker_placed_reach", "x".repeat(40), "a".repeat(64)), "42883");
    // A single ask still works for someone with a gap
    expect(await c.as(leader.id, "contact_ask_send", asked)).toMatchObject({ ok: true });
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
    expect(await count("people")).toBe(before.people);
  });
});
