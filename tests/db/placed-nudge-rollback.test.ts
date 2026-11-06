import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// The way back from "the placed-member nudge", rehearsed.
//
// Two databases: the one as it stood before this migration (every file up to 20270112000100) and the one with everything applied. The migration replaces nine
// functions that already existed and must not have changed any other. The rollback file must put those nine back exactly as they were, drop the 22 functions,
// the guard on announcements and the four tables it added, take the switch off the Switchboard, cancel any nudge that was unfinished and withdraw the nudge
// emails still waiting, keep every consent, number, confirmed seat and message already sent, and change nothing the second time.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20270112000100";
const THIS = "20270113000100_placed_nudge";
/** Anything built after this feature is rolled back first (newest first), found by name, as the older rollback tests do. */
const LATER_DOWN = fs
  .readdirSync(ROLLBACK)
  .filter((f) => f.endsWith(".down.sql") && f.slice(0, 14) > "20270113000100")
  .sort()
  .reverse();
const REPLACED = ["placement_token_mint", "retry_message", "audience_clean", "audience_base", "audience_members", "broadcasts_release", "claim_prepare", "broadcast_results", "contact_gaps_export"];
const ADDED = [
  "placed_nudge_cfg",
  "placed_is_waiting",
  "placed_nudge_seat",
  "placed_email_at",
  "placed_waiting_rows",
  "placed_nudge_any",
  "placed_nudge_blocker",
  "number_fp",
  "number_confirmed",
  "placed_nudge_selfcheck",
  "broadcasts_placed_guard",
  "placed_held_number",
  "placed_nudge_state",
  "placed_nudge_overview",
  "tribe_nudge_marks",
  "number_confirmed_for",
  "whatsapp_confirmed_counts",
  "worker_placed_link_state",
  "worker_placed_nudge_info",
  "worker_placed_choose",
  "worker_placed_new_link",
  "god_placed_nudge_settings",
  "god_placed_nudge_settings_set",
];
const TABLES = ["placed_nudges", "placed_links", "number_confirmations", "placed_nudge_settings"];

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
const exists = async (table: string) => (await c.one("select to_regclass($1) as t", [`public.${table}`])).t !== null;
/** Put the clock functions back exactly as the database had them before the test stood in for them. */
async function restoreClock() {
  const defs = await baseline.query("select pg_get_functiondef(p.oid) as d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('lagos_hour', 'lagos_dow')");
  for (const r of defs.rows) await c.db.admin.query(r.d as string);
}
const real = (n: number) => `+23480${String(41000000 + n * 7919).slice(0, 8)}`;

describe("the way back from 'the placed-member nudge'", () => {
  let before: Record<string, number>;
  let member: { id: string; tm: string; tribe: string };
  let number: string;
  let link: string;
  let nudgeId: string;
  let unfinishedId: string;
  let workerToken: string;

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
    if (c && baseline) await restoreClock();
    await baseline?.end();
    await rootClient?.query(`drop database if exists ${baselineName} with (force)`);
    await rootClient?.end();
    await c?.db.close();
  });

  it("is what the migration added: nine functions replaced, 23 new, the rest untouched, and one new trigger", async () => {
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
    const baseT = await triggers(baseline);
    expect((await triggers(c.db.admin)).filter((t) => !baseT.includes(t))).toEqual(["broadcasts.broadcasts_placed_guard"]);
    const nowT = await triggers(c.db.admin);
    expect(baseT.filter((t) => !nowT.includes(t))).toEqual([]);
    for (const t of TABLES) expect(await exists(t)).toBe(true);
    expect((await c.sql("select 1 from public.feature_registry where key = 'placed_nudge'")).length).toBe(1);
  });

  it("starts with something to keep: a member who said yes to WhatsApp, a sent message, and a nudge waiting in the outbox", async () => {
    await c.reset();
    await c.set("placed_nudge", "on", { reason: "Trying the placed nudge" });
    await c.db.admin.query(
      `create or replace function public.lagos_hour() returns integer language sql as $$ select 10 $$;
       create or replace function public.lagos_dow() returns integer language sql as $$ select 3 $$;`,
    );
    const t = await c.k.tribe(c.season, { name: "Way back nudge", capacity: 12 });
    const make = async (name: string, n: number) => {
      const id = (await c.k.seat(t.tribe, c.season, name)).id;
      await c.db.admin.query("begin");
      await c.db.admin.query("set local session_replication_role = replica");
      await c.db.admin.query("update public.tribe_members set placement_source = 'auto', placed_by_run = gen_random_uuid(), confirmed_at = null where person_id = $1", [id]);
      await c.db.admin.query("commit");
      const tm = (await c.one("select id from public.tribe_members where person_id = $1 and tribe_id = $2", [id, t.tribe])).id as string;
      await c.sql("insert into public.messages (person_id, template, params, status, dedupe_key, scheduled_for, sent_at) values ($1, 'placement_your_tribe', '{}', 'sent', $2, now(), now() - interval '30 hours')", [
        id,
        `placement:${tm}`,
      ]);
      void n;
      return { id, tm, tribe: t.tribe };
    };
    const agreed = await make("WayAgreed", 1);
    member = await make("WayWaiting", 2);
    number = real(1);
    link = (await c.one("select public.placement_token_mint($1, $2, 60) as t", [agreed.tm, agreed.id])).t as string;
    const token = (await c.one("select public.bootstrap_worker_token('placed-nudge-rollback') as t")).t as string;
    workerToken = token;
    expect(await c.anon("worker_placed_choose", token, link, "whatsapp", number, false, "v1")).toMatchObject({ ok: true, mode: "whatsapp" });
    // a nudge announcement released to the outbox for the one who still waits
    const fields = {
      title: "Nudge the placed",
      audience: { kind: "placed_waiting", tribe: t.tribe },
      audience_label: "Placed by the church, waiting for a reply",
      subject: "One tap keeps your place in {tribe}",
      paragraphs: ["Your place in {tribe} is being held for you.", "One tap tells us you are in."],
    };
    nudgeId = (await c.as(c.director, "broadcast_save", null, JSON.stringify(fields))) as string;
    await c.as(c.director, "broadcast_submit", nudgeId, null);
    await c.sql("update public.broadcasts set scheduled_for = now() - interval '1 minute' where id = $1", [nudgeId]);
    await c.sql("select public.broadcasts_release()");
    expect((await c.sql("select 1 from public.messages where template = 'office_message' and person_id = $1 and status = 'queued'", [member.id])).length).toBe(1);
    expect((await c.sql("select 1 from public.placed_nudges where person_id = $1", [member.id])).length).toBe(1);
    expect((await c.one("select status from public.broadcasts where id = $1", [nudgeId])).status).toBe("sent");
    await restoreClock();
    // and a second nudge, approved but not yet released, for someone placed since
    await make("WayLater", 3);
    unfinishedId = (await c.as(c.director, "broadcast_save", null, JSON.stringify({ ...fields, title: "Nudge the later ones" }))) as string;
    await c.as(c.director, "broadcast_submit", unfinishedId, null);
    expect((await c.one("select status from public.broadcasts where id = $1", [unfinishedId])).status).toBe("scheduled");
    before = {
      people: await count("people"),
      seats: await count("tribe_members"),
      consents: await count("consents"),
      sent: (await c.one("select count(*)::int n from public.messages where status = 'sent'")).n,
      prefs: await count("contact_preferences"),
      broadcasts: await count("broadcasts"),
    };
    expect((await c.sql("select 1 from public.consents where person_id = $1 and purpose = 'whatsapp' and version = 'placed-v1'", [agreed.id])).length).toBe(1);
  });

  it("runs the rollback file without error, and it only drops what was added, cancels and withdraws, deletes only the switch, and puts nine functions back", async () => {
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
    expect(own).not.toMatch(/\b(truncate|insert)\b\s/i);
    expect([...own.matchAll(/\bdelete\s+from\s+(public\.[a-z_]+)/gi)].map((m) => m[1]).sort()).toEqual(["public.feature_registry", "public.feature_settings"]);
    expect([...own.matchAll(/\bupdate\s+(public\.[a-z_]+)/gi)].map((m) => m[1]).sort()).toEqual(["public.broadcasts", "public.messages"]);
    expect(own).not.toMatch(/\bdrop\s+(schema|type|column)\b/i);
    expect(own).not.toMatch(/\balter\s+table\b/i);
    expect([...own.matchAll(/\bdrop\s+table\s+if\s+exists\s+public\.([a-z_]+)/gi)].map((m) => m[1]).sort()).toEqual([...TABLES].sort());
    expect([...code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]).sort()).toEqual([...REPLACED].sort());
    const dropped = [...code.matchAll(/\bdrop\s+function\s+if\s+exists\s+public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
    expect([...new Set(dropped)].sort()).toEqual([...ADDED].sort());
    expect(code).toMatch(/drop trigger if exists broadcasts_placed_guard on public\.broadcasts;/);
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

  it("drops the four tables and takes the switch off the Switchboard", async () => {
    for (const t of TABLES) expect(await exists(t)).toBe(false);
    expect((await c.sql("select 1 from public.feature_registry where key = 'placed_nudge'")).length).toBe(0);
    expect((await c.sql("select 1 from public.feature_settings where feature = 'placed_nudge'")).length).toBe(0);
  });

  it("cancels the unfinished nudge and withdraws its email from the outbox", async () => {
    expect((await c.one("select status from public.broadcasts where id = $1", [unfinishedId])).status).toBe("cancelled");
    expect((await c.one("select status from public.broadcasts where id = $1", [nudgeId])).status).toBe("sent");
    const m = await c.sql("select status, error, reply_token from public.messages where template = 'office_message' and person_id = $1", [member.id]);
    expect(m).toEqual([{ status: "skipped", error: "the placed nudge was taken away", reply_token: null }]);
  });

  it("keeps every person, seat, consent, saved number and message already sent, and the member's yes", async () => {
    expect(await count("people")).toBe(before.people);
    expect(await count("tribe_members")).toBe(before.seats);
    expect(await count("consents")).toBe(before.consents);
    expect(await count("contact_preferences")).toBe(before.prefs);
    expect(await count("broadcasts")).toBe(before.broadcasts);
    expect((await c.one("select count(*)::int n from public.messages where status = 'sent'")).n).toBe(before.sent);
    const agreed = (await c.sql("select person_id from public.consents where purpose = 'whatsapp' and version = 'placed-v1'"))[0].person_id as string;
    expect((await c.one("select phone, preferred from public.contact_preferences where person_id = $1", [agreed])).phone).toBe(number);
    expect((await c.one("select confirmed_at from public.tribe_members where person_id = $1", [agreed])).confirmed_at).not.toBeNull();
    // the private link the church sent earlier still opens the page it did before
    expect(await c.anon("worker_placed_info", workerToken, link)).toBeDefined();
  });

  it("goes back to how announcements and the private page were: the new audience and screens are gone", async () => {
    await expectCode(c.as(c.admin, "placed_nudge_state"), "42883");
    await expectCode(c.as(c.admin, "placed_nudge_overview"), "42883");
    await expectCode(c.as(c.admin, "audience_preview", { kind: "placed_waiting" }), "22023");
    await expectCode(c.anon("worker_placed_nudge_info", workerToken, link), "42883");
    await expectCode(c.anon("worker_placed_choose", workerToken, link, "email", null, false, "v1"), "42883");
    // an ordinary announcement still goes out
    const id = (await c.as(c.director, "broadcast_save", null, JSON.stringify({ title: "Plain", audience: { kind: "everyone" }, audience_label: "Everyone", subject: "A note", paragraphs: ["Hello {first_name}."] }))) as string;
    expect(id).toBeTruthy();
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(c.db.admin);
    const firstTriggers = await triggers(c.db.admin);
    await c.db.admin.query(rollbackText());
    const again = await functions(c.db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual([]);
    expect(again.size).toBe(first.size);
    expect(await triggers(c.db.admin)).toEqual(firstTriggers);
    expect(await count("people")).toBe(before.people);
    expect(await count("consents")).toBe(before.consents);
  });
});
