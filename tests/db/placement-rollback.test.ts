import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import type { Row, TestDb } from "./helpers";
import { openSeason, placeRun, readyMember } from "./placement-kit";

// The way back from automatic placement, bulk leaders and assistant recommendations, rehearsed.
//
// Two databases: the one as it stood before these migrations (every file up to 20261225000200) and the one with everything applied. The new
// migrations must not have changed any function that already existed. The two rollback files, run in the order the apply guide gives, must
// leave exactly the baseline's functions and triggers, keep every row of every table they added (and every placed member seated), change
// nothing the second time, and leave the platform doing what it did.

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACK = path.join(ROOT, "supabase/rollback");
const LAST_BEFORE = "20261225000200";
/** Run in this order: the assistants first (they stand alone), then placement. */
const DOWN = [
  "20261226000200_assistant_recommendations.down.sql",
  "20261226000100_auto_placement.down.sql",
];
const TABLES = [
  "placement_settings",
  "placement_runs",
  "placement_items",
  "placement_teams",
  "placement_tokens",
  "placement_holds",
  "placement_leader_runs",
  "placement_leader_items",
  "assistant_recommendations",
];

let k: Kit;
let o: OwnerKit;
let db: TestDb;
let baseline: Client;
let baselineName: string;
let rootClient: Client;
let season: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> =>
  (await db.admin.query(text, params)).rows;

const functions = async (c: Client) =>
  new Map(
    (
      await c.query(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, pg_get_functiondef(p.oid) as def
                       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')`)
    ).rows.map((r) => [r.sig as string, r.def as string]),
  );
const triggers = async (c: Client) =>
  (
    await c.query(`select c.relname || '.' || g.tgname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid
                    where not g.tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)
  ).rows.map((r) => r.t as string);
const counts = async () => {
  const out: Record<string, number> = {};
  for (const t of TABLES)
    out[t] = (await sql(`select count(*)::int n from public.${t}`))[0].n;
  out.placed = (
    await sql(
      "select count(*)::int n from public.tribe_members where placed_by_run is not null and status = 'active'",
    )
  )[0].n;
  return out;
};

beforeAll(async () => {
  const port = inject("pgPort");
  baselineName = `pbase_${Date.now().toString(36)}`;
  rootClient = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await rootClient.connect();
  await rootClient.query(
    `create database ${baselineName} template ut_before_tribes`,
  );
  baseline = new Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password: "postgres",
    database: baselineName,
  });
  await baseline.connect();
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter(
      (f) =>
        f.endsWith(".sql") &&
        f >= "20261210000100" &&
        f.slice(0, 14) <= LAST_BEFORE,
    )
    .sort();
  for (const f of files)
    await baseline.query(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
}, 300_000);

afterAll(async () => {
  await baseline?.end();
  await rootClient?.query(
    `drop database if exists ${baselineName} with (force)`,
  );
  await rootClient?.end();
  await db?.close();
});

describe("the way back from automatic placement and assistant recommendations", () => {
  let before: Map<string, string>;
  let triggersBefore: string[];
  let rowsBefore: Record<string, number>;

  it("is what the migrations added and nothing else: no function that existed before was changed", async () => {
    const base = await functions(baseline);
    before = await functions(db.admin);
    expect(
      [...base]
        .filter(([sig, def]) => before.get(sig) !== def)
        .map(([sig]) => sig),
    ).toEqual([]);
    const created = new Set<string>();
    for (const f of fs
      .readdirSync(MIGRATIONS)
      .filter(
        (x) => x.slice(0, 14) > LAST_BEFORE && x.slice(0, 8) === "20261226",
      )) {
      for (const m of fs
        .readFileSync(path.join(MIGRATIONS, f), "utf8")
        .matchAll(
          /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi,
        )) {
        created.add(m[1].toLowerCase());
      }
    }
    const extra = [...before.keys()]
      .filter((sig) => !base.has(sig))
      .map((sig) => sig.split("(")[0]);
    expect(extra.length).toBeGreaterThan(60);
    expect(extra.filter((name) => !created.has(name))).toEqual([]);
  });

  it("runs a real placement and an assistant recommendation, so there is something to keep", async () => {
    await sql(
      "update public.tribes set status = 'closed' where status = 'approved'",
    );
    const t = await k.tribe(season, {
      capacity: 12,
      name: "Rollback A",
      assistant: "certified",
    });
    for (let i = 0; i < 8; i++)
      await readyMember(db, k, season, `Back${i}`, {
        times: ["weeknight-evening"],
        daysAgo: 30 - i,
      });
    await o.call(
      "placement_settings_save",
      JSON.stringify({ mode: "on", min_tribe: 4 }),
    );
    const { n } = await placeRun(db, o, {});
    expect(n).toBeGreaterThan(3);
    const nominee = await k.staff("Nominee", "assistant_leader");
    await db.asUser(t.leader.id, (q) =>
      q("select public.assistant_recommend($1, $2, null, 'Good.')", [
        t.tribe,
        nominee.id,
      ]),
    );
    rowsBefore = await counts();
    expect(rowsBefore.placement_runs).toBeGreaterThan(0);
    expect(rowsBefore.placement_items).toBeGreaterThan(3);
    expect(rowsBefore.placement_tokens).toBeGreaterThan(3);
    expect(rowsBefore.assistant_recommendations).toBe(1);
    expect(rowsBefore.placed).toBe(n);
    triggersBefore = await triggers(db.admin);
    const base = await triggers(baseline);
    expect(triggersBefore.filter((x) => !base.includes(x)).sort()).toEqual([
      "placement_runs.placement_runs_guard",
      "tribe_members.tribe_members_placement_released",
    ]);
  });

  it("runs the two rollback files, and they run without error and only drop functions and triggers", async () => {
    for (const f of DOWN) {
      const text = fs.readFileSync(path.join(ROLLBACK, f), "utf8");
      expect(text, f).toMatch(/^-- /);
      expect(text, f).toMatch(/\bbegin;/);
      expect(text, f).toMatch(/\bcommit;\s*$/);
      const code = text
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n");
      expect(code, f).not.toMatch(/\b(delete|truncate|insert|update)\b\s/i);
      expect(code, f).not.toMatch(/\bdrop\s+(table|column|schema|type)\b/i);
      expect(code, f).not.toMatch(/\balter\s+table\b/i);
      await db.admin.query(text);
    }
  });

  it("leaves exactly the functions and triggers the database had before, each unchanged", async () => {
    const base = await functions(baseline);
    const now = await functions(db.admin);
    expect([...now.keys()].filter((sig) => !base.has(sig))).toEqual([]);
    expect([...base.keys()].filter((sig) => !now.has(sig))).toEqual([]);
    expect(
      [...base]
        .filter(([sig, def]) => now.get(sig) !== def)
        .map(([sig]) => sig),
    ).toEqual([]);
    expect(await triggers(db.admin)).toEqual(await triggers(baseline));
  });

  it("keeps every row, and every placed member stays seated", async () => {
    expect(await counts()).toEqual(rowsBefore);
    expect(
      (await sql("select mode from public.placement_settings"))[0].mode,
    ).toBe("on");
    expect(
      (
        await sql(
          "select count(*)::int n from public.tribe_members where placement_source = 'auto' and status = 'active'",
        )
      )[0].n,
    ).toBe(rowsBefore.placed);
  });

  it("changes nothing when run a second time", async () => {
    const first = await functions(db.admin);
    const firstTriggers = await triggers(db.admin);
    for (const f of DOWN)
      await db.admin.query(fs.readFileSync(path.join(ROLLBACK, f), "utf8"));
    const again = await functions(db.admin);
    expect([...again].filter(([sig, def]) => first.get(sig) !== def)).toEqual(
      [],
    );
    expect(again.size).toBe(first.size);
    expect(await triggers(db.admin)).toEqual(firstTriggers);
    expect(await counts()).toEqual(rowsBefore);
  });

  it("leaves the platform doing what it did: a member joins a tribe, is welcomed, and can leave it", async () => {
    const t = await k.tribe(season, { capacity: 12, name: "Rollback B" });
    const person = await k.person("Joiner");
    const tm = (
      await sql(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14) returning id`,
        [t.tribe, person.id, season],
      )
    )[0].id;
    expect(
      (
        await sql(
          "select count(*)::int n from public.messages where dedupe_key = $1",
          [`welcome:${tm}`],
        )
      )[0].n,
    ).toBe(1);
    await sql(
      "update public.tribe_members set status = 'released' where id = $1",
      [tm],
    );
    expect(
      (
        await sql("select status from public.tribe_members where id = $1", [tm])
      )[0].status,
    ).toBe("released");
    // the old roster still answers the leader, as before
    const roster = await db.asUser(t.leader.id, (q) =>
      q("select public.tribe_roster($1) as r", [t.tribe]),
    );
    expect(roster.rows[0].r).toBeTruthy();
    // and the new pages' functions are gone, as the apply guide says they will be
    await expect(
      db.admin.query("select public.placement_overview()"),
    ).rejects.toThrow(/does not exist/);
    await expect(
      db.admin.query("select public.assistant_requests()"),
    ).rejects.toThrow(/does not exist/);
  });
});
