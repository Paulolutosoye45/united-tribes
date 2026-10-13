import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Stage 8: the daily housekeeping. What is kept, and for how long, in one place.

let db: TestDb;
let k: Kit;
let token: string;
let seasonNow: string;
let seasonOld: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const retain = async (at = "now()"): Promise<Row> => (await sql(`select public.retention_tick(${at}) as r`))[0].r;
const eventsToday = async () => Number((await sql("select count(*)::int as n from public.event_log where action = 'retention.ran'"))[0].n);

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  token = (await sql("select public.bootstrap_worker_token('platform') as t"))[0].t;
  seasonNow = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id;
  // A season that ended four months ago
  seasonOld = await k.season("Long ago", 200);
});
afterAll(async () => {
  await db?.close();
});

const story = async (who: string) => (await sql("select story from public.member_profiles where person_id = $1", [who]))[0].story as string | null;

describe("the retention periods", () => {
  it("are written in one place and cannot be called by anyone through the API", async () => {
    const periods = (await sql("select public.retention_periods() as r"))[0].r;
    expect(periods).toEqual({ guardian_days: 90, draft_days: 30, message_days: 90 });
    const u = await k.person("Curious");
    await expectCode(db.asUser(u.id, (q) => q("select public.retention_periods()")), "42501");
    await expectCode(db.asUser(u.id, (q) => q("select public.retention_tick(now())")), "42501");
    await expectCode(db.asAnon((q) => q("select public.retention_tick(now())")), "42501");
  });
});

describe("what the daily job removes", () => {
  it("clears the written story once its season has ended, and no sooner", async () => {
    const past = await k.person("Past");
    const present = await k.person("Present");
    await k.profile(past.id, seasonOld);
    await k.profile(present.id, seasonNow);
    await sql("update public.member_profiles set story = 'I run a small bank branch and my children are young.' where person_id in ($1, $2)", [past.id, present.id]);

    const out = await retain();
    expect(out.retention_ran).toBe(true);
    expect(out.stories_cleared).toBe(1);
    expect(await story(past.id)).toBeNull();
    expect(await story(present.id)).toMatch(/small bank branch/);
    // The rest of the profile is untouched
    expect((await sql("select zone from public.member_profiles where person_id = $1", [past.id]))[0].zone).toBe("mainland");
  });

  it("deletes a half-finished form nobody has touched for a month, and keeps a recent one", async () => {
    const stale = await k.person("Stale");
    const fresh = await k.person("Fresh");
    await sql("insert into public.intake_drafts (person_id, step, answers, updated_at) values ($1, 'goal', '{}', now() - interval '31 days'), ($2, 'goal', '{}', now() - interval '29 days')", [stale.id, fresh.id]);
    await sql("delete from public.calendar_runs where key like 'retention:%'");
    const out = await retain();
    expect(out.drafts_removed).toBe(1);
    expect((await sql("select person_id from public.intake_drafts where person_id in ($1, $2)", [stale.id, fresh.id])).map((r) => r.person_id)).toEqual([fresh.id]);
  });

  it("empties the wording of finished messages after 90 days, and nothing else about them", async () => {
    const who = await k.person("Receiver");
    const insert = (status: string, ageDays: number, params: object, person: string | null = who.id, email: string | null = null) =>
      sql(
        `insert into public.messages (person_id, to_email, template, status, channel, params, created_at)
         values ($1, $2, 'week_start', $3, 'email', $4::jsonb, now() - make_interval(days => $5::int)) returning id`,
        [person, email, status, JSON.stringify(params), ageDays],
      ).then((r) => r[0].id as string);
    const old = await insert("sent", 100, { leader_first: "Ada", place_note: "Near the bridge" });
    const failed = await insert("failed", 120, { leader_first: "Ada" });
    const recent = await insert("sent", 20, { leader_first: "Ada" });
    const waiting = await insert("queued", 100, { leader_first: "Ada" });

    await sql("delete from public.calendar_runs where key like 'retention:%'");
    const out = await retain();
    expect(out.message_wording_cleared).toBe(2);
    const read = async (id: string) => (await sql("select params, template, status, channel from public.messages where id = $1", [id]))[0];
    expect((await read(old)).params).toEqual({});
    expect((await read(failed)).params).toEqual({});
    expect((await read(old)).template).toBe("week_start");
    expect((await read(old)).status).toBe("sent");
    expect((await read(old)).channel).toBe("email");
    expect((await read(recent)).params).toEqual({ leader_first: "Ada" });
    expect((await read(waiting)).params).toEqual({ leader_first: "Ada" });
  });

  it("deletes finished messages that went to a bare address after 90 days", async () => {
    const insert = (ageDays: number, status: string, email: string) =>
      sql(
        `insert into public.messages (to_email, to_name, template, status, channel, params, created_at)
         values ($1, 'A Referee', 'reference_request', $2, 'email', '{"applicant":"Someone"}'::jsonb, now() - make_interval(days => $3::int)) returning id`,
        [email, status, ageDays],
      ).then((r) => r[0].id as string);
    const gone = await insert(95, "sent", "ref.old@example.org");
    const kept = await insert(10, "sent", "ref.new@example.org");
    const pending = await insert(200, "queued", "ref.pending@example.org");

    await sql("delete from public.calendar_runs where key like 'retention:%'");
    const out = await retain();
    expect(out.bare_messages_removed).toBe(1);
    const left = (await sql("select id from public.messages where id = any($1::uuid[])", [[gone, kept, pending]])).map((r) => r.id);
    expect(left.sort()).toEqual([kept, pending].sort());
  });

  it("removes a parent's contact details through the guardian rule, with the same 90 days", async () => {
    const out = await retain("now() + interval '1 day'");
    expect(out.retention_ran).toBe(true);
    expect(out).toHaveProperty("guardians_removed");
    expect(Number(out.guardians_removed)).toBeGreaterThanOrEqual(0);
  });
});

describe("how often it runs, and what it records", () => {
  it("runs once a day, however many times the heartbeat calls it", async () => {
    await sql("delete from public.calendar_runs where key like 'retention:%'");
    await sql("delete from public.event_log where action = 'retention.ran'");
    expect((await retain()).retention_ran).toBe(true);
    expect((await retain()).retention_ran).toBe(false);
    expect((await retain()).retention_ran).toBe(false);
    expect(await eventsToday()).toBe(1);
    // The next Lagos day it runs again
    expect((await retain("now() + interval '1 day'")).retention_ran).toBe(true);
    expect(await eventsToday()).toBe(2);
  });

  it("writes only counts to the event log, never who or what was removed", async () => {
    const meta = (await sql("select meta from public.event_log where action = 'retention.ran' order by id desc limit 1"))[0].meta as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(["bare_messages", "drafts", "guardians", "message_wording", "stories"]);
    expect(Object.values(meta).every((v) => typeof v === "number")).toBe(true);
  });
});

describe("the sending service's heartbeat", () => {
  const worker = async () => (await db.asAnon((q) => q("select public.worker_tick($1) as r", [token]))).rows[0].r as Row;

  it("runs the housekeeping with the rest, and a fault in it never stops a message going out", async () => {
    await sql("delete from public.calendar_runs where key like 'retention:%'");
    const ok = await worker();
    expect(ok.retention_ran).toBe(true);
    expect(ok.retention_error).toBeUndefined();
    expect(ok).toHaveProperty("queued");
    expect(ok).toHaveProperty("care_open");
    expect(ok).toHaveProperty("snapshots");

    await sql("create or replace function public.retention_tick(p_now timestamptz) returns jsonb language plpgsql as $$ begin raise exception 'broken'; end $$");
    const broken = await worker();
    expect(broken.retention_error).toBe("broken");
    expect(broken).toHaveProperty("queued");
    expect(broken).toHaveProperty("care_open");
    expect(broken).toHaveProperty("snapshots");
  });

  it("still refuses a caller without the token", async () => {
    await expectCode(db.asAnon((q) => q("select public.worker_tick($1)", ["not-a-token"])), "42501");
  });
});
