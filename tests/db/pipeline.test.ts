import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase A, part one: the settings row, who may change it, the change log, the presets and the policy record.
// Nothing reads the switches yet, so these tests are about the switchboard itself.

let db: TestDb;
let k: Kit;
let admin: { id: string; email: string };
let director: { id: string; email: string };
let pastor: { id: string; email: string };
let leader: { id: string; email: string };
let member: { id: string; email: string };
let owner: { id: string; email: string };

const PHRASE = "river-lantern-mango-cobalt";
const SESSION = randomUUID();

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const call = (who: string, fn: string, ...params: unknown[]) => k.call(who, fn, params);
const callAsOwner = async (fn: string, ...params: unknown[]) =>
  (await db.asUser(owner.id, async (q) => (await q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params)).rows[0]?.r, { session: SESSION }));

const ELIG = ["member6", "foundation", "serving", "age21", "time", "safeguarding", "confidentiality"];
const TODAY = {
  eligibility: Object.fromEntries(ELIG.map((e) => [e, "required"])),
  references: "required",
  interview: "required",
  tribe_fit: "off",
  academy: "required",
  declaration: "required",
};
const stripped = (positions: Row) => {
  const { preset: _preset, updated_at: _updatedAt, ...rest } = positions; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};
const logRows = async () => sql("select * from public.leader_pipeline_log order by id");
const reset = async () => {
  await db.admin.query("delete from public.leader_pipeline_log");
  await db.admin.query("delete from public.event_log where action like 'leader.pipeline_%'");
  await db.admin.query("delete from public.god_log where action like 'leader.pipeline_%'");
  await db.admin.query(
    `update public.leader_pipeline_settings set elig_member6 = 'required', elig_foundation = 'required', elig_serving = 'required',
       elig_age21 = 'required', elig_time = 'required', elig_safeguarding = 'required', elig_confidentiality = 'required',
       references_mode = 'required', interview_mode = 'required', tribe_fit = 'off', academy_mode = 'required',
       declaration_mode = 'required', preset = 'full', updated_by = null`,
  );
};

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  admin = await k.staff("Adaeze", "admin");
  director = await k.staff("Dayo", "director");
  pastor = await k.staff("Pastor", "pastor");
  leader = await k.staff("Lola", "leader");
  member = await k.person("Ngozi");
  owner = await db.createUser({ email: "owner@example.org" });
  await sql("update public.people set full_name = 'The Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
});

afterAll(async () => {
  await db?.close();
});

describe("the settings row", () => {
  it("starts at today's positions, exactly", async () => {
    const row = (await sql("select * from public.leader_pipeline_settings"))[0];
    for (const e of ELIG) expect(row[`elig_${e}`], e).toBe("required");
    expect(row.references_mode).toBe("required");
    expect(row.interview_mode).toBe("required");
    expect(row.tribe_fit).toBe("off");
    expect(row.academy_mode).toBe("required");
    expect(row.declaration_mode).toBe("required");
    expect(row.preset).toBe("full");
    expect(stripped(await call(member.id, "leader_pipeline_public"))).toEqual(TODAY);
  });

  it("cannot hold a second row, and refuses a bad value whatever calls it", async () => {
    await expectCode(db.admin.query("insert into public.leader_pipeline_settings (id) values (true)"), "23505");
    await expectCode(db.admin.query("insert into public.leader_pipeline_settings (id) values (false)"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set elig_age21 = 'maybe'"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set references_mode = 'on'"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set tribe_fit = 'optional'"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set declaration_mode = 'optional'"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set academy_mode = 'on'"), "23514");
    await expectCode(db.admin.query("update public.leader_pipeline_settings set preset = 'custom'"), "23514");
    expect(await sql("select 1 from public.leader_pipeline_settings")).toHaveLength(1);
  });

  it("is invisible to everyone but the functions", async () => {
    for (const who of [member, leader, pastor, director, admin]) {
      await expectCode(db.asUser(who.id, (q) => q("select * from public.leader_pipeline_settings")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select * from public.leader_pipeline_log")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select * from public.leader_application_policy")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("update public.leader_pipeline_settings set tribe_fit = 'on'")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select * from public.leader_pipeline_settings")), "42501");
    // The internal ones cannot be called through the API at all
    for (const fn of ["leader_pipeline_cfg()", "leader_fit_ready()", "leader_pipeline_label('tribe_fit')"]) {
      await expectCode(db.asUser(admin.id, (q) => q(`select public.${fn}`)), "42501");
    }
  });
});

describe("reading the positions", () => {
  it("any signed-in person can read them, a visitor cannot, and no names or log come with them", async () => {
    for (const who of [member, leader, pastor, director, admin]) {
      const r = (await call(who.id, "leader_pipeline_public")) as Row;
      expect(stripped(r)).toEqual(TODAY);
      expect(Object.keys(r).sort()).toEqual(["academy", "declaration", "eligibility", "interview", "preset", "references", "tribe_fit", "updated_at"]);
    }
    await expectCode(db.asAnon((q) => q("select public.leader_pipeline_public()")), "42501");
  });
});

describe("changing a switch", () => {
  it("lets the director and an administrator, and nobody else", async () => {
    for (const who of [director, admin]) {
      await reset();
      const r = (await call(who.id, "leader_pipeline_set", { references_mode: "optional" }, "testing")) as Row;
      expect(r.changed).toBe(1);
      expect(r.positions.references).toBe("optional");
    }
    for (const who of [pastor, leader, member]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ interview_mode: "off" }])), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_pipeline_preset('open_door')")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ interview_mode: "off" }])), "42501");
    await reset();
    expect((await sql("select interview_mode from public.leader_pipeline_settings"))[0].interview_mode).toBe("required");
  });

  it("writes one log row for a real change, with the old and new values, and none for setting what is already set", async () => {
    await reset();
    const same = (await call(director.id, "leader_pipeline_set", { elig_age21: "required", interview_mode: "required" }, "nothing")) as Row;
    expect(same.changed).toBe(0);
    expect(await logRows()).toHaveLength(0);
    expect(await sql("select 1 from public.event_log where action = 'leader.pipeline_set'")).toHaveLength(0);

    const r = (await call(director.id, "leader_pipeline_set", { elig_member6: "off", interview_mode: "optional" }, "  We will see the person ourselves.  ")) as Row;
    expect(r.changed).toBe(2);
    const rows = await logRows();
    expect(rows).toHaveLength(2);
    const bySetting = Object.fromEntries(rows.map((x) => [x.setting, x]));
    expect(bySetting.elig_member6).toMatchObject({ old_value: "required", new_value: "off", preset: "empty", reason: "We will see the person ourselves.", changed_by: director.id });
    expect(bySetting.interview_mode).toMatchObject({ old_value: "required", new_value: "optional" });
    expect(rows[0].batch).toBe(rows[1].batch);
    expect(rows[0].shown_as).toContain("Dayo");
    expect(await sql("select 1 from public.event_log where action = 'leader.pipeline_set' and actor_id = $1", [director.id])).toHaveLength(1);
    expect((await sql("select preset, updated_by from public.leader_pipeline_settings"))[0]).toMatchObject({ preset: "empty", updated_by: director.id });
  });

  it("refuses an unknown switch or a value it does not take, and changes nothing at all", async () => {
    await reset();
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ elig_age21: "off", nonsense: "off" }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ elig_age21: "off", references_mode: "on" }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ declaration_mode: "optional" }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ tribe_fit: "required" }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ elig_age21: true }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ preset: "full" }])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{}])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [[]])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_set(null, null)")), "22023");
    expect(stripped(await call(director.id, "leader_pipeline_public"))).toEqual(TODAY);
    expect(await logRows()).toHaveLength(0);
  });

  it("refuses to turn Find your tribe on while it is not ready, and says so in words", async () => {
    await reset();
    await expect(db.asUser(director.id, (q) => q("select public.leader_pipeline_set($1::jsonb, null)", [{ tribe_fit: "on", interview_mode: "off" }]))).rejects.toThrow(/Find your tribe cannot be switched on/);
    expect(stripped(await call(director.id, "leader_pipeline_public"))).toEqual(TODAY);
    // Setting it to off when it is already off is not a change
    expect(((await call(director.id, "leader_pipeline_set", { tribe_fit: "off" }, null)) as Row).changed).toBe(0);
  });

  it("holds the Academy and the declaration at the positions they are given", async () => {
    await reset();
    const r = (await call(admin.id, "leader_pipeline_set", { academy_mode: "optional", declaration_mode: "off" }, null)) as Row;
    expect(r.positions).toMatchObject({ academy: "optional", declaration: "off" });
    const r2 = (await call(admin.id, "leader_pipeline_set", { academy_mode: "off" }, null)) as Row;
    expect(r2.positions).toMatchObject({ academy: "off", declaration: "off" });
  });
});

describe("the presets", () => {
  it("full process sets today's positions and nothing else", async () => {
    await reset();
    await call(director.id, "leader_pipeline_set", { elig_age21: "off", references_mode: "off", interview_mode: "optional", academy_mode: "off", declaration_mode: "off" }, null);
    await db.admin.query("delete from public.leader_pipeline_log");
    const r = (await call(director.id, "leader_pipeline_preset", "full")) as Row;
    expect(stripped(r.positions)).toEqual(TODAY);
    expect(r.positions.preset).toBe("full");
    expect(r.changed).toBe(5);
    const rows = await logRows();
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((x) => x.batch)).size).toBe(1);
    expect(new Set(rows.map((x) => x.preset))).toEqual(new Set(["full"]));
  });

  it("open door sets the exact positions, in one press, and keeps training on", async () => {
    await reset();
    const r = (await call(admin.id, "leader_pipeline_preset", "open_door")) as Row;
    expect(r.positions.preset).toBe("open_door");
    expect(stripped(r.positions)).toEqual({
      eligibility: { member6: "off", foundation: "off", serving: "off", age21: "required", time: "required", safeguarding: "required", confidentiality: "required" },
      references: "off",
      interview: "off",
      tribe_fit: "off",
      academy: "required",
      declaration: "required",
    });
    expect(r.note).toMatch(/Find your tribe stays off/);
    expect(r.changed).toBe(5);
    const rows = await logRows();
    expect(rows.map((x) => x.setting).sort()).toEqual(["elig_foundation", "elig_member6", "elig_serving", "interview_mode", "references_mode"]);
    expect(new Set(rows.map((x) => x.batch)).size).toBe(1);
    expect(rows.every((x) => x.preset === "open_door" && x.new_value === "off" && x.old_value === "required")).toBe(true);
  });

  it("never turns training off, even from a state where it was turned off by hand", async () => {
    await reset();
    await call(director.id, "leader_pipeline_set", { academy_mode: "off", declaration_mode: "off" }, null);
    for (const preset of ["open_door", "full"]) {
      const r = (await call(director.id, "leader_pipeline_preset", preset)) as Row;
      expect(r.positions).toMatchObject({ academy: "required", declaration: "required" });
    }
  });

  it("pressing the same preset twice writes nothing the second time, and an unknown preset is refused", async () => {
    await reset();
    await call(director.id, "leader_pipeline_preset", "open_door");
    const before = (await logRows()).length;
    const again = (await call(director.id, "leader_pipeline_preset", "open_door")) as Row;
    expect(again.changed).toBe(0);
    expect(await logRows()).toHaveLength(before);
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_preset('wide_open')")), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.leader_pipeline_preset(null)")), "22023");
  });

  it("a hand change after a preset marks the settings as set by hand", async () => {
    await reset();
    await call(director.id, "leader_pipeline_preset", "open_door");
    expect(((await call(member.id, "leader_pipeline_public")) as Row).preset).toBe("open_door");
    await call(director.id, "leader_pipeline_set", { elig_member6: "optional" }, null);
    expect(((await call(member.id, "leader_pipeline_public")) as Row).preset).toBe("empty");
  });

  it("Open door turns Find your tribe on once it is ready, and not before", async () => {
    await reset();
    await db.admin.query("create or replace function public.leader_fit_ready() returns boolean language sql stable security definer set search_path = '' as $$ select true $$");
    try {
      const r = (await call(director.id, "leader_pipeline_preset", "open_door")) as Row;
      expect(r.positions.tribe_fit).toBe("on");
      expect(r.note).toBeNull();
      expect(r.changed).toBe(6);
      // ...and the full process turns it back off
      expect(((await call(director.id, "leader_pipeline_preset", "full")) as Row).positions.tribe_fit).toBe("off");
      expect(((await call(director.id, "leader_pipeline_set", { tribe_fit: "on" }, null)) as Row).positions.tribe_fit).toBe("on");
    } finally {
      await db.admin.query("create or replace function public.leader_fit_ready() returns boolean language sql stable security definer set search_path = '' as $$ select false $$");
      await reset();
    }
  });
});

describe("the log", () => {
  it("is read by administrators, the director and pastors, newest first, and by no one else", async () => {
    await reset();
    await call(director.id, "leader_pipeline_set", { elig_time: "optional" }, "first");
    await call(admin.id, "leader_pipeline_set", { elig_time: "off" }, "second");
    for (const who of [admin, director, pastor]) {
      const list = (await call(who.id, "leader_pipeline_log_list", 10)) as Row[];
      expect(list.map((x) => x.reason)).toEqual(["second", "first"]);
      expect(list[0]).toMatchObject({ setting: "elig_time", label: "Time each week", old_value: "optional", new_value: "off" });
      expect(Object.keys(list[0]).sort()).toEqual(["at", "batch", "label", "new_value", "old_value", "preset", "reason", "setting", "shown_as"]);
    }
    for (const who of [leader, member]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_pipeline_log_list(10)")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.leader_pipeline_log_list(10)")), "42501");
    expect(((await call(admin.id, "leader_pipeline_log_list", 1)) as Row[]).length).toBe(1);
    expect(((await call(admin.id, "leader_pipeline_log_list", 0)) as Row[]).length).toBe(1);
    expect(((await call(admin.id, "leader_pipeline_log_list", 10000)) as Row[]).length).toBe(2);
  });
});

describe("the platform owner", () => {
  it("is nobody until unlocked, then changes switches but is only ever shown as an administrator", async () => {
    await reset();
    await sql("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);
    // Locked: no powers
    await expectCode(callAsOwner("leader_pipeline_set", { elig_age21: "off" }, null), "42501");
    expect(await callAsOwner("god_unlock", PHRASE)).toBeTruthy();

    const r = (await callAsOwner("leader_pipeline_set", { elig_age21: "off" }, "a change made by the office")) as Row;
    expect(r.changed).toBe(1);
    const rows = await logRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ setting: "elig_age21", changed_by: null, shown_as: "an administrator", reason: "a change made by the office" });
    // Nothing in the normal event log carries the owner's name or id
    expect(await sql("select 1 from public.event_log where action = 'leader.pipeline_set'")).toHaveLength(1);
    expect(await sql("select 1 from public.event_log where action = 'leader.pipeline_set' and actor_id is not null")).toHaveLength(0);
    expect(await sql("select 1 from public.god_log where action = 'leader.pipeline_set'")).toHaveLength(1);

    // An administrator reading the log sees "an administrator" and nothing that points to the owner
    const list = (await call(admin.id, "leader_pipeline_log_list", 10)) as Row[];
    expect(JSON.stringify(list)).not.toMatch(/The Owner|owner@example/i);
    expect(list[0].shown_as).toBe("an administrator");

    const p = (await callAsOwner("leader_pipeline_preset", "full")) as Row;
    expect(p.positions.preset).toBe("full");
    const after = await logRows();
    expect(after.every((x) => x.changed_by === null && x.shown_as === "an administrator")).toBe(true);
  });
});

describe("the policy record", () => {
  it("exists for each application but only once something writes it; none is made for the applications already there", async () => {
    const before = await sql("select count(*)::int n from public.leader_application_policy");
    expect(before[0].n).toBe(0);
    const u = await k.person("Applicant");
    const { rows } = await db.admin.query("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', '{}'::jsonb, 'v1') returning id", [u.id]);
    expect((await sql("select count(*)::int n from public.leader_application_policy"))[0].n).toBe(0);
    await db.admin.query("insert into public.leader_application_policy (application_id, at_send) values ($1, '{}'::jsonb)", [rows[0].id]);
    const row = (await sql("select * from public.leader_application_policy"))[0];
    expect(row.evidence).toBe("full");
    await expectCode(db.admin.query("update public.leader_application_policy set evidence = 'thin'"), "23514");
    await db.admin.query("delete from public.leader_applications where id = $1", [rows[0].id]);
    expect((await sql("select count(*)::int n from public.leader_application_policy"))[0].n).toBe(0);
  });
});
