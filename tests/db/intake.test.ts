import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Q, type TestDb } from "./helpers";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const idOf = async (table: string, slug: string) =>
  (await db.admin.query(`select id from public.${table} where slug = $1`, [slug])).rows[0].id as string;

async function member(opts: { consent?: boolean } = {}) {
  const user = await db.createUser();
  if (opts.consent !== false) await consent(user.id, "matching", true);
  return user;
}

const consent = (id: string, purpose: string, granted: boolean) =>
  db.asUser(id, (q) =>
    q("insert into public.consents (person_id, purpose, granted, version) values ($1, $2, $3, '2026-10-v1')", [
      id,
      purpose,
      granted,
    ]),
  );

/** A complete, valid profile row for this person. */
async function profile(personId: string, overrides: Record<string, unknown> = {}) {
  const community = await idOf("communities", "professionals");
  const goal = await idOf("season_goals", "step-into-a-leadership-role");
  const age = await idOf("age_ranges", "33-40");
  const row: Record<string, unknown> = {
    person_id: personId,
    age_range_id: age,
    gender: "female",
    tribe_mix: "mixed",
    zone: "mainland",
    community_id: community,
    faith_journey: "growing",
    season_goal_id: goal,
    goal_baseline: 3,
    meeting_mode: "online",
    meeting_times: ["sunday-afternoon"],
    duration_seconds: 280,
    ...overrides,
  };
  return row;
}

function insertProfile(q: Q, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const params = cols.map((c) => row[c]);
  return q(
    `insert into public.member_profiles (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    params,
  );
}

describe("consent ledger", () => {
  it("says no until someone agrees, and follows the latest answer", async () => {
    const u = await member({ consent: false });
    const has = (id: string, purpose: string) =>
      db.asUser(id, async (q) => (await q("select public.has_consent($1) as ok", [purpose])).rows[0].ok as boolean);

    expect(await has(u.id, "matching")).toBe(false);
    await consent(u.id, "matching", true);
    expect(await has(u.id, "matching")).toBe(true);
    expect(await has(u.id, "ai_assist")).toBe(false);
    await consent(u.id, "matching", false);
    expect(await has(u.id, "matching")).toBe(false);
  });

  it("is append-only and private", async () => {
    const a = await member();
    const b = await member();

    // Cannot record consent on someone else's behalf
    await expectCode(
      db.asUser(a.id, (q) =>
        q("insert into public.consents (person_id, purpose, granted, version) values ($1, 'ai_assist', true, 'v1')", [b.id]),
      ),
      "42501",
    );

    // Cannot edit or erase the record
    await expectCode(db.asUser(a.id, (q) => q("update public.consents set granted = false")), "42501");
    await expectCode(db.asUser(a.id, (q) => q("delete from public.consents")), "42501");

    // Sees only their own
    const mine = await db.asUser(a.id, (q) => q("select person_id from public.consents"));
    expect(mine.rows.every((r) => r.person_id === a.id)).toBe(true);

    // Visitors see nothing
    await expectCode(db.asAnon((q) => q("select * from public.consents")), "42501");
  });

  it("rejects a malformed wording version", async () => {
    const u = await member({ consent: false });
    await expectCode(
      db.asUser(u.id, (q) => q("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 'bad version!')", [u.id])),
      "23514",
    );
  });
});

describe("drafts (save and resume)", () => {
  it("cannot be saved before consent", async () => {
    const u = await member({ consent: false });
    await expectCode(
      db.asUser(u.id, (q) => q("insert into public.intake_drafts (person_id, step, answers) values ($1, 'age', '{}')", [u.id])),
      "42501",
    );
  });

  it("saves, updates and resumes for the owner only", async () => {
    const a = await member();
    const b = await member();
    await db.asUser(a.id, (q) =>
      q("insert into public.intake_drafts (person_id, step, answers) values ($1, 'name', $2)", [a.id, JSON.stringify({ ageRange: "33-40" })]),
    );
    await db.asUser(a.id, (q) =>
      q("update public.intake_drafts set step = 'gender', active_seconds = 40 where person_id = $1", [a.id]),
    );

    const mine = await db.asUser(a.id, (q) => q("select step, answers, active_seconds from public.intake_drafts"));
    expect(mine.rows).toEqual([{ step: "gender", answers: { ageRange: "33-40" }, active_seconds: 40 }]);

    // Another member sees nothing and changes nothing
    expect((await db.asUser(b.id, (q) => q("select * from public.intake_drafts"))).rows).toHaveLength(0);
    const touched = await db.asUser(b.id, (q) => q("update public.intake_drafts set step = 'age'"));
    expect(touched.rowCount).toBe(0);
    const removed = await db.asUser(b.id, (q) => q("delete from public.intake_drafts"));
    expect(removed.rowCount).toBe(0);

    // Cannot write a draft in someone else's name
    await expectCode(
      db.asUser(b.id, (q) => q("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [a.id])),
      "42501",
    );
  });

  it("limits size and step names", async () => {
    const u = await member();
    await expectCode(
      db.asUser(u.id, (q) =>
        q("insert into public.intake_drafts (person_id, step, answers) values ($1, 'story', $2)", [u.id, JSON.stringify({ x: "a".repeat(21000) })]),
      ),
      "23514",
    );
    await expectCode(
      db.asUser(u.id, (q) => q("insert into public.intake_drafts (person_id, step) values ($1, 'Robert; drop table')", [u.id])),
      "23514",
    );
  });
});

describe("member profiles", () => {
  it("accepts a complete profile once consent is given", async () => {
    const u = await member();
    const row = await profile(u.id, {
      birthday_day: 29,
      birthday_month: 2,
      story: "I just got retrenched and I'm trusting God for the next thing.",
      support_load: 1,
      support_enc: "v1.sealed",
      whatsapp: "+2348031234567",
      style_social: 1,
      style_structure: -1,
      style_learning: 0,
      open_to_serving: "maybe",
    });
    await db.asUser(u.id, (q) => insertProfile(q, row));
    const { rows } = await db.asUser(u.id, (q) => q("select gender, zone, goal_baseline, whatsapp from public.member_profiles"));
    expect(rows).toEqual([{ gender: "female", zone: "mainland", goal_baseline: 3, whatsapp: "+2348031234567" }]);
  });

  it("refuses a profile without consent", async () => {
    const u = await member({ consent: false });
    await expectCode(db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id))), "42501");
  });

  it("refuses anything outside the allowed shape", async () => {
    const u = await member();
    const bad: [string, Record<string, unknown>][] = [
      ["a birthday on 31 April", { birthday_day: 31, birthday_month: 4 }],
      ["a day without a month", { birthday_day: 10 }],
      ["a baseline of 6", { goal_baseline: 6 }],
      ["a style value of 2", { style_social: 2 }],
      ["an unknown area", { zone: "narnia" }],
      ["an unknown meeting time", { meeting_times: ["monday-3am"] }],
      ["a malformed WhatsApp number", { whatsapp: "08031234567" }],
      ["an over-long story", { story: "x".repeat(1501) }],
      ["no community at all", { community_id: null, season_goal_id: null, goal_other: "My own goal" }],
      ["no goal at all", { season_goal_id: null }],
    ];
    for (const [label, override] of bad) {
      await expectCode(
        db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id, override))).catch((e) => {
          throw Object.assign(new Error(`${label}: ${e.message}`), { code: e.code });
        }),
        "23514",
      );
    }
  });

  it("only takes a goal that belongs to the chosen community", async () => {
    const u = await member();
    const otherCommunityGoal = await idOf("season_goals", "launch-or-formalise-a-business");
    await expectCode(
      db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id, { season_goal_id: otherCommunityGoal }))),
      "23503",
    );
  });

  it("takes a community or goal in the person's own words", async () => {
    const u = await member();
    await db.asUser(u.id, async (q) =>
      insertProfile(
        q,
        await profile(u.id, { community_id: null, community_other: "Pastors' wives", season_goal_id: null, goal_other: "Start a ministry to young mothers" }),
      ),
    );
  });

  it("is private to its owner, even from admins", async () => {
    const a = await member();
    const b = await member();
    const admin = await member();
    await db.grant(admin.id, "admin");
    await db.asUser(a.id, async (q) => insertProfile(q, await profile(a.id, { support_enc: "v1.private" })));

    expect((await db.asUser(b.id, (q) => q("select * from public.member_profiles"))).rows).toHaveLength(0);
    expect((await db.asUser(admin.id, (q) => q("select * from public.member_profiles"))).rows).toHaveLength(0);
    await expectCode(db.asAnon((q) => q("select * from public.member_profiles")), "42501");

    // Nobody else can write over it
    expect((await db.asUser(b.id, (q) => q("update public.member_profiles set support_enc = 'x'"))).rowCount).toBe(0);
    expect((await db.asUser(admin.id, (q) => q("delete from public.member_profiles"))).rowCount).toBe(0);
    await expectCode(db.asUser(b.id, async (q) => insertProfile(q, await profile(a.id))), "42501");
  });

  it("lets the owner change and delete their answers", async () => {
    const u = await member();
    await db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id)));
    await db.asUser(u.id, (q) => q("update public.member_profiles set zone = 'island-lekki' where person_id = $1", [u.id]));
    expect((await db.asUser(u.id, (q) => q("select zone from public.member_profiles"))).rows[0].zone).toBe("island-lekki");
    await db.asUser(u.id, (q) => q("delete from public.member_profiles"));
    expect((await db.asUser(u.id, (q) => q("select * from public.member_profiles"))).rows).toHaveLength(0);
  });

  it("is erased when matching consent is withdrawn", async () => {
    const u = await member();
    await db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id)));
    await db.asUser(u.id, (q) => q("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [u.id]));

    await consent(u.id, "matching", false);

    expect((await db.admin.query("select 1 from public.member_profiles where person_id = $1", [u.id])).rowCount).toBe(0);
    expect((await db.admin.query("select 1 from public.intake_drafts where person_id = $1", [u.id])).rowCount).toBe(0);
    // And nothing new can be saved
    await expectCode(db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id))), "42501");
  });

  it("drops the WhatsApp number when that consent is withdrawn, and keeps the rest", async () => {
    const u = await member();
    await consent(u.id, "whatsapp", true);
    await db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id, { whatsapp: "+2348031234567" })));
    await consent(u.id, "whatsapp", false);
    const { rows } = await db.admin.query("select whatsapp, zone from public.member_profiles where person_id = $1", [u.id]);
    expect(rows).toEqual([{ whatsapp: null, zone: "mainland" }]);
  });

  it("is removed with the person", async () => {
    const u = await member();
    await db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id)));
    await db.admin.query("delete from auth.users where id = $1", [u.id]);
    for (const table of ["member_profiles", "intake_drafts", "consents", "ai_calls"]) {
      expect((await db.admin.query(`select 1 from public.${table} where person_id = $1`, [u.id])).rowCount, table).toBe(0);
    }
  });
});

describe("assistant usage log", () => {
  const log = (q: Q, id: string, extra: Record<string, unknown> = {}) =>
    q(
      `insert into public.ai_calls (person_id, field, provider, model, latency_ms, fallback, reason, suggested, dropped)
       values ($1, $2, 'mock', 'mock-1', $3, $4, $5, $6, 0)`,
      [id, extra.field ?? "community", extra.latency ?? 900, extra.fallback ?? false, extra.reason ?? null, extra.suggested ?? 2],
    );

  it("records counts for the owner, readable by them and the office only", async () => {
    const a = await member();
    const b = await member();
    const office = await member();
    await db.grant(office.id, "data_lead");

    await db.asUser(a.id, (q) => log(q, a.id));
    await db.asUser(a.id, (q) => log(q, a.id, { fallback: true, reason: "timeout", suggested: 0 }));
    await expectCode(db.asUser(b.id, (q) => log(q, a.id)), "42501");

    expect((await db.asUser(a.id, (q) => q("select * from public.ai_calls"))).rows).toHaveLength(2);
    expect((await db.asUser(b.id, (q) => q("select * from public.ai_calls"))).rows).toHaveLength(0);
    expect((await db.asUser(office.id, (q) => q("select * from public.ai_calls"))).rows).toHaveLength(2);

    // It is a log: no edits, no erasing
    await expectCode(db.asUser(a.id, (q) => q("update public.ai_calls set latency_ms = 1")), "42501");
    await expectCode(db.asUser(a.id, (q) => q("delete from public.ai_calls")), "42501");
  });

  it("has no column that could hold what the person wrote", async () => {
    const { rows } = await db.admin.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_calls' order by 1",
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "at", "dropped", "fallback", "field", "id", "latency_ms", "model", "person_id", "provider", "reason", "suggested",
    ]);
  });
});

describe("intake totals for the office", () => {
  it("are refused to ordinary members and leaders", async () => {
    const u = await member();
    await db.grant(u.id, "leader");
    await expectCode(db.asUser(u.id, (q) => q("select public.intake_stats()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.intake_stats()")), "42501");
  });

  it("count completions, speed and mix without any personal detail", async () => {
    // Start from an empty form so the totals are exact.
    await db.admin.query("delete from public.member_profiles; delete from public.intake_drafts; delete from public.ai_calls;");
    const office = await member();
    await db.grant(office.id, "data_lead");
    const people = [await member(), await member(), await member()];
    const speeds = [200, 300, 500];
    for (const [i, p] of people.entries()) {
      await db.asUser(p.id, async (q) => insertProfile(q, await profile(p.id, { duration_seconds: speeds[i], story: `secret story ${i}` })));
    }
    const drafter = await member();
    await db.asUser(drafter.id, (q) => q("insert into public.intake_drafts (person_id, step) values ($1, 'age')", [drafter.id]));

    const stats = (await db.asUser(office.id, (q) => q("select public.intake_stats() as s"))).rows[0].s;
    expect(stats.completed).toBe(3);
    expect(stats.started).toBe(4);
    expect(stats.median_seconds).toBe(300);
    expect(stats.within_six_minutes).toBe(2);
    expect(stats.by_track).toEqual([{ label: "Builders", count: 3 }]);
    expect(stats.by_community).toEqual([{ label: "Professionals", count: 3 }]);
    expect(JSON.stringify(stats)).not.toMatch(/@|secret story/);
  });
});

describe("the rest of the smart form", () => {
  it("stores relationship, children, work, group roles, a second community and the sealed notes", async () => {
    const u = await member();
    const second = await idOf("communities", "marriage-relationships");
    await db.asUser(u.id, async (q) =>
      insertProfile(
        q,
        await profile(u.id, {
          relationship: "married",
          children: ["under_12", "teens"],
          work_status: "employed",
          work_field: "finance",
          group_roles: ["host", "peacemaker"],
          second_community_id: second,
          open_to_adjacent: true,
          area_slug: "yaba",
          support_load: 2,
          support_enc: "v1.aaaa.bbbb.cccc",
          leader_note_enc: "v1.dddd.eeee.ffff",
        }),
      ),
    );
    const { rows } = await db.asUser(u.id, (q) =>
      q("select relationship, children, work_field, group_roles, open_to_adjacent, support_load from public.member_profiles"),
    );
    expect(rows).toEqual([
      { relationship: "married", children: ["under_12", "teens"], work_field: "finance", group_roles: ["host", "peacemaker"], open_to_adjacent: true, support_load: 2 },
    ]);
  });

  it("refuses answers outside the lists, a third role and a second community that repeats the first", async () => {
    const u = await member();
    const same = await idOf("communities", "professionals");
    const bad: Record<string, unknown>[] = [
      { relationship: "it is complicated" },
      { children: ["many"] },
      { work_status: "wizard" },
      { work_field: "magic" },
      { group_roles: ["host", "peacemaker", "thinker"] },
      { group_roles: ["boss"] },
      { second_community_id: same },
      { support_load: 3 },
      { area_slug: "Yaba, Lagos!" },
    ];
    for (const override of bad) {
      await expectCode(db.asUser(u.id, async (q) => insertProfile(q, await profile(u.id, override))), "23514");
    }
  });

  it("no longer has anywhere to keep support needs in plain text", async () => {
    const u = await member();
    await expectCode(db.asUser(u.id, (q) => q("select support_needs from public.member_profiles")), "42703");
  });

  it("keeps the sealed draft notes private to their owner", async () => {
    const a = await member();
    const b = await member();
    await db.asUser(a.id, (q) => q("insert into public.intake_drafts (person_id, step, sealed) values ($1, 'care', 'v1.x.y.z')", [a.id]));
    expect((await db.asUser(a.id, (q) => q("select sealed from public.intake_drafts"))).rows).toEqual([{ sealed: "v1.x.y.z" }]);
    expect((await db.asUser(b.id, (q) => q("select sealed from public.intake_drafts"))).rows).toHaveLength(0);
    expect((await db.asUser(b.id, (q) => q("update public.intake_drafts set sealed = null"))).rowCount).toBe(0);
    await expectCode(
      db.asUser(a.id, (q) => q("update public.intake_drafts set sealed = $1", ["x".repeat(4001)])),
      "23514",
    );
  });
});
