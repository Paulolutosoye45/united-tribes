import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { read, tellStory, type Fingerprint, type Story } from "./fingerprint-kit";
import type { TestDb } from "./helpers";

// "Off must mean identical", proved.
//
// The same small church is built and read twice over the life of this file: once on the database as it stood before Profiles and the Weekly
// Rhythm (that was recorded into tests/db/golden/fingerprint-v1.json), and now, on the database with every migration applied and every new
// function Off. The two tellings must match word for word. If they do not, the test names the readers that changed.
//
// Recording (only from the database before stage 1, never from the one under test):
//   UT_UPTO=20261231000100 UT_RECORD=1 npx vitest run --config vitest.db.config.mts tests/db/fingerprint.test.ts

const GOLDEN = path.join(__dirname, "golden", "fingerprint-v1.json");
const RECORDING = process.env.UT_RECORD === "1";

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let story: Story;
let first: Fingerprint;
let hasStage1 = false;

beforeAll(async () => {
  ({ db, k } = await newKit());
  o = await makeOwner(db);
  hasStage1 = ((await db.admin.query("select to_regproc('public.feature_state') is not null as e")).rows[0].e as boolean) === true;
  story = await tellStory(db, k, o);
  first = await read(db, story);
  // UT_DUMP=/some/file writes what was seen, to read a difference by eye
  if (process.env.UT_DUMP) fs.writeFileSync(process.env.UT_DUMP, `${JSON.stringify(first, null, 2)}\n`);
}, 300_000);

afterAll(async () => {
  await db?.close();
});

const golden = (): Fingerprint => JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const changed = (a: Fingerprint, b: Fingerprint) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();

describe("the fingerprint of what the platform does today", () => {
  it("is recorded only from the database before stage 1", () => {
    if (!RECORDING) return;
    expect(hasStage1, "the recording must come from the database before Profiles stage 1: set UT_UPTO=20261231000100").toBe(false);
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, `${JSON.stringify(first, null, 2)}\n`);
  });

  it("says something: the readers were given real people and real numbers, not a wall of refusals", () => {
    const entries = Object.entries(first);
    const refused = entries.filter(([, v]) => v && typeof v === "object" && "refused" in (v as object)).map(([key]) => key);
    // Readers a person is not allowed to use are part of the story too (the refusal is what they would see); the others must have answered
    for (const key of ["my_tribe_leaderA", "my_match_eze", "match_card_alpha", "match_candidates_eze", "tribe_roster_alpha_by_leaderA", "tribe_roster_marked_alpha_by_director", "dashboard_by_director", "kpi_members", "kpi_tribes", "report_movement", "application_readiness", "reminders_overview_by_director", "export_tribe_sheet_by_leaderA", "export_leaders_roster_by_director"]) {
      expect(first[key], key).toBeTruthy();
      expect(JSON.stringify(first[key]), key).not.toMatch(/"refused"/);
    }
    expect(refused.length).toBeLessThan(entries.length / 2);
    expect(entries.length).toBeGreaterThanOrEqual(35);
    const roster = (first.tribe_roster_alpha_by_leaderA as { ok: { members: unknown[] } }).ok;
    expect(roster.members).toHaveLength(3);
    expect((first.tribes as { name: string; status: string }[]).map((t) => `${t.name}:${t.status}`)).toEqual(["Alpha Tribe:approved", "Beta Tribe:approved", "Gamma Tribe:approved"]);
    expect((first.welcome_message as { template: string }[])[0].template).toBe("leader_welcome");
  });

  it("is told the same way twice on the same database (the story does not depend on luck, the clock or the order of ids)", async () => {
    const again = await read(db, story);
    expect(changed(first, again)).toEqual([]);
  });

  it("with every function Off, tells the story exactly as the database before stage 1 told it", () => {
    if (RECORDING) return;
    expect(fs.existsSync(GOLDEN), "tests/db/golden/fingerprint-v1.json is missing: record it from the database before stage 1").toBe(true);
    const was = golden();
    expect(changed(was, first)).toEqual([]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(was));
  });

  it("holds only when everything really is Off: no rule, no pause, nobody left out, nobody asked", async () => {
    if (!hasStage1) return;
    expect((await db.admin.query("select count(*)::int n from public.feature_settings")).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.feature_master where paused")).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.details_checks")).rows[0].n).toBe(0);
    expect((await db.admin.query("select count(*)::int n from public.profile_changes")).rows[0].n).toBe(0);
    // and the welcome email is the one the pastor approved: nothing was added to what it carries
    expect((first.welcome_message as { params: unknown }[])[0].params).toEqual({ goal: "Grow", choose: false });
  });

  it("notices a function switched On, and tells the story as before once it is Off again", async () => {
    if (!hasStage1) return;
    const queue = async () =>
      (await db.admin.query("select public.enqueue_message($1, 'leader_welcome', $2::jsonb, null, 'golden-welcome') as id", [story.leaderA, JSON.stringify({ goal: "Grow", choose: false })])).rows[0].id as string;
    const swap = async () => {
      await db.admin.query("delete from public.messages where id = $1", [story.welcomeId]);
      story.welcomeId = await queue();
    };
    for (const feature of ["my_page", "details_check"]) await o.call("god_feature_set", feature, "platform", null, "on", [], "Trying the whole road with everyone", null);
    await swap();
    expect(changed(first, await read(db, story))).toEqual(["welcome_message"]);
    // Off again: the rules and their log go, the same email is queued, and nothing differs
    await db.admin.query("delete from public.feature_settings");
    await db.admin.query("delete from public.feature_log");
    await swap();
    expect(changed(first, await read(db, story))).toEqual([]);
  });

  it("notices a one-character change in what a reader says, and a one-point change in what it counts", async () => {
    // a word in a reader's answer
    const def = (await db.admin.query("select pg_get_functiondef('public.tribe_roster(uuid)'::regprocedure) as d")).rows[0].d as string;
    expect(def).toContain("'first_name'");
    await db.admin.query(def.replace("'first_name'", "'first_nane'"));
    const worded = await read(db, story);
    expect(changed(first, worded).length).toBeGreaterThan(0);
    expect(changed(first, worded).some((key) => key.startsWith("tribe_roster_marked") || key === "export_tribe_sheet_by_leaderA")).toBe(true);
    await db.admin.query(def);
    expect(changed(first, await read(db, story))).toEqual([]);
    // one point in a number
    await db.admin.query("update public.tribe_members set degree = degree + 1 where person_id = $1", [story.members.ada]);
    expect(changed(first, await read(db, story)).length).toBeGreaterThan(0);
    await db.admin.query("update public.tribe_members set degree = degree - 1 where person_id = $1", [story.members.ada]);
    expect(changed(first, await read(db, story))).toEqual([]);
  });
});
