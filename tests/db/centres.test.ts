import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Stage 6a: the groundwork for a second centre. The switch is off by default; with it on, roles and
// season-based views are scoped to the centre a person is working in.

let db: TestDb;
let centreA: string;
let seasonA: string;

beforeAll(async () => {
  db = await createTestDb();
  centreA = (await db.admin.query("select id from public.centres limit 1")).rows[0].id;
  seasonA = (await db.admin.query("select id from public.seasons limit 1")).rows[0].id;
});
afterAll(async () => {
  await db.close();
});

const call = async (userId: string, fn: string, params: unknown[] = []) =>
  (await db.asUser(userId, (q) => q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params))).rows[0]?.r;
const staff = async (...roles: string[]) => {
  const u = await db.createUser();
  for (const r of roles) await db.grant(u.id, r);
  return u;
};
const roleList = (v: unknown) => String(v).replace(/[{}]/g, "").split(",").filter(Boolean).sort();
const flag = (on: boolean) => db.admin.query("update public.platform_flags set enabled = $1 where key = 'multi_centre'", [on]);

describe("with the switch off (the default)", () => {
  it("shows one centre and refuses to open or switch to another", async () => {
    const admin = await staff("admin");
    const mine = (await call(admin.id, "my_centres")) as Row;
    expect(mine.multi).toBe(false);
    expect(mine.current.id).toBe(centreA);
    expect(mine.centres).toHaveLength(1);
    await expectCode(call(admin.id, "create_centre", ["tcn-ikeja", "TCN Ikeja"]), "22023");
    await expectCode(call(admin.id, "switch_centre", [centreA]), "22023");
  });

  it("is off in a fresh database and no one can flip it through the API", async () => {
    const rows = (await db.admin.query("select enabled from public.platform_flags where key = 'multi_centre'")).rows;
    expect(rows).toEqual([{ enabled: false }]);
    const admin = await staff("admin");
    await expect(db.asUser(admin.id, (q) => q("update public.platform_flags set enabled = true"))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(admin.id, (q) => q("select public.platform_flag('multi_centre')"))).rejects.toMatchObject({ code: "42501" });
  });

  it("needs a signed-in person", async () => {
    await expectCode(db.asAnon((q) => q("select public.my_centres()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.create_centre('abc-def', 'Name')")), "42501");
  });
});

describe("with the switch on", () => {
  let admin: { id: string };
  let centreB: string;
  let seasonB: string;

  beforeAll(async () => {
    await flag(true);
    admin = await staff("admin", "director");
    const made = (await call(admin.id, "create_centre", ["tcn-ikeja", "The Covenant Nation, Ikeja"])) as Row;
    centreB = made.centres.find((c: Row) => c.slug === "tcn-ikeja").id;
    seasonB = (
      await db.admin.query(
        `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks)
         values ($1, 'Ikeja Season 1', public.today_lagos() - 20, public.today_lagos() + 63, 12) returning id`,
        [centreB],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await flag(false);
  });

  it("lets an admin open a centre, and makes them its admin and member", async () => {
    const roles = (await db.admin.query("select role from public.person_roles where person_id = $1 and centre_id = $2 order by role", [admin.id, centreB])).rows;
    expect(roles.map((r) => r.role).sort()).toEqual(["admin", "member"]);
    expect((await db.admin.query("select active from public.centres where id = $1", [centreB])).rows[0].active).toBe(true);
    const log = await db.admin.query("select 1 from public.event_log where action = 'centre.created' and entity_id = $1", [centreB]);
    expect(log.rowCount).toBe(1);
  });

  it("checks the short name and the name, and that only an admin may open a centre", async () => {
    await expectCode(call(admin.id, "create_centre", ["Bad Name!", "Valid name"]), "22023");
    await expectCode(call(admin.id, "create_centre", ["ab", "Valid name"]), "22023");
    await expectCode(call(admin.id, "create_centre", ["valid-slug", "No"]), "22023");
    await expectCode(call(admin.id, "create_centre", ["tcn-ikeja", "Same slug again"]), "22023");
    const director = await staff("director");
    await expectCode(call(director.id, "create_centre", ["tcn-lekki", "TCN Lekki"]), "42501");
  });

  it("switches only to a centre where the person holds a role", async () => {
    const other = await staff("director");
    await expectCode(call(other.id, "switch_centre", [centreB]), "42501");
    const switched = (await call(admin.id, "switch_centre", [centreB])) as Row;
    expect(switched.current.id).toBe(centreB);
    expect((await db.admin.query("select centre_id from public.people where id = $1", [admin.id])).rows[0].centre_id).toBe(centreB);
    // back again
    const back = (await call(admin.id, "switch_centre", [centreA])) as Row;
    expect(back.current.id).toBe(centreA);
  });

  it("counts a role only in the centre the person is working in", async () => {
    const both = await staff("director"); // a director in A
    await db.admin.query("insert into public.person_roles (person_id, role, centre_id) values ($1, 'member', $2), ($1, 'pastor', $2)", [both.id, centreB]);
    const inA = async (role: string) => (await db.asUser(both.id, (q) => q("select public.has_any_role(array[$1]::public.app_role[]) as r", [role]))).rows[0].r;
    expect(await inA("director")).toBe(true);
    expect(await inA("pastor")).toBe(false);
    expect(roleList(await call(both.id, "my_roles"))).toEqual(["director", "member"]);

    await call(both.id, "switch_centre", [centreB]);
    expect(await inA("director")).toBe(false);
    expect(await inA("pastor")).toBe(true);
    expect(roleList(await call(both.id, "my_roles"))).toEqual(["member", "pastor"]);
    await call(both.id, "switch_centre", [centreA]);
    expect(await inA("pastor")).toBe(false);
  });

  it("scopes the dashboard to the centre's own seasons", async () => {
    const director = await staff("director");
    const a = (await call(director.id, "dashboard", [null])) as Row;
    expect(a.season.id).toBe(seasonA);
    expect((a.seasons as Row[]).map((x) => x.id)).toEqual([seasonA]);
    // asking for the other centre's season shows nothing, rather than its numbers
    const leak = (await call(director.id, "dashboard", [seasonB])) as Row;
    expect(leak.state).toBe("none");
    expect(JSON.stringify(leak)).not.toContain("Ikeja");

    await call(admin.id, "switch_centre", [centreB]);
    const b = (await call(admin.id, "dashboard", [null])) as Row;
    expect(b.season.id).toBe(seasonB);
    expect(((await call(admin.id, "dashboard", [seasonA])) as Row).state).toBe("none");
    expect((b.seasons as Row[]).map((x) => x.id)).toEqual([seasonB]);
    await call(admin.id, "switch_centre", [centreA]);
  });

  it("keeps reports, the community page and community champions inside one centre", async () => {
    const dir = await staff("director");
    const community = (await db.admin.query("select id from public.communities where slug = 'professionals'")).rows[0].id;
    // a report in each centre
    await db.admin.query("insert into public.reports (centre_id, kind, period_start, period_end, season_id, data) values ($1, 'programme', date '2026-09-01', date '2026-09-30', $2, '{}'::jsonb)", [centreA, seasonA]);
    await db.admin.query("insert into public.reports (centre_id, kind, period_start, period_end, season_id, data) values ($1, 'programme', date '2026-09-01', date '2026-09-30', $2, '{}'::jsonb)", [centreB, seasonB]);
    const aList = (await call(dir.id, "list_reports")) as Row[];
    expect(aList.map((r) => r.season)).not.toContain("Ikeja Season 1");
    const bId = (await db.admin.query("select id from public.reports where centre_id = $1", [centreB])).rows[0].id;
    await expectCode(call(dir.id, "get_report", [bId]), "P0002");
    await expectCode(call(dir.id, "set_report_summary", [bId, "Not mine"]), "P0002");

    // a champion must be a person of the same centre
    const outsider = await db.createUser();
    await db.admin.query("update public.people set centre_id = $2 where id = $1", [outsider.id, centreB]);
    await expectCode(call(dir.id, "assign_community_champion", [outsider.id, community]), "P0002");
    const insider = await db.createUser();
    await call(dir.id, "assign_community_champion", [insider.id, community]);
    const list = (await call(dir.id, "community_champion_list")) as Row[];
    expect(list.map((c) => c.person_id)).toEqual([insider.id]);
  });

  it("sends a report-ready message only to people of the report's centre", async () => {
    const dirA = await staff("director");
    const dirB = await db.createUser();
    await db.admin.query("update public.people set centre_id = $2 where id = $1", [dirB.id, centreB]);
    await db.admin.query("insert into public.person_roles (person_id, role, centre_id) values ($1, 'director', $2), ($1, 'member', $2)", [dirB.id, centreB]);
    const rows = (await db.admin.query("select * from public.report_recipients('programme', null, $1)", [centreA])).rows.map((r) => Object.values(r)[0]);
    expect(rows).toContain(dirA.id);
    expect(rows).not.toContain(dirB.id);
  });
});
