import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Fix 8: the weekly guide opens for leaders on the Saturday before its week. What these prove:
//   * the setting starts Off (a leader may open any week, as before) and only the office changes it, with a check on the numbers and a line in the log
//   * when it is On, a leader reads this week's guide and the weeks already opened and nothing later; a later week says when it opens and carries none of its content
//   * the pastor and the director (the office) read every week, so the guides can be read through before they open
//   * the moment a week opens is the day before it starts, at the set time, Lagos time; week 1 is open from the start; after the season every week is open
//   * everything else on the leader's weekly page is exactly as it was

let c: Cast;
let look: string;

const setting = (weekly: boolean, hour = 8, minute = 0) => c.sql("update public.guide_release_settings set weekly = $1, release_hour = $2, release_minute = $3", [weekly, hour, minute]);
const start = (daysAgo: number, weeks = 12) => c.sql("update public.seasons set starts_on = public.today_lagos() - $2::int, ends_on = public.today_lagos() - $2::int + ($3::int * 7 - 1), weeks = $3 where id = $1", [c.season, daysAgo, weeks]);
const week = (who: string, w: number | null) => c.as(who, "tribe_week", c.seasoned.tribe, w) as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  c = await makeCast();
  look = (await c.k.staff("Data lead", "data_lead")).id;
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await setting(false);
  await c.sql("update public.guide_release_settings set changed_by = null, changed_at = null");
  await start(10);
});

describe("the setting", () => {
  it("starts Off, at 8 am, and says so to the office", async () => {
    const row = await c.one("select * from public.guide_release_settings");
    expect(row).toMatchObject({ weekly: false, release_hour: 8, release_minute: 0 });
    expect(await c.as(c.admin, "guide_release_get")).toMatchObject({ weekly: false, hour: 8, minute: 0, can_edit: true });
    expect(await c.as(look, "guide_release_get")).toMatchObject({ weekly: false, can_edit: false });
  });

  it("is seen and changed only by the office", async () => {
    await expectCode(c.as(c.member, "guide_release_get"), "42501");
    await expectCode(c.as(c.seasoned.id, "guide_release_get"), "42501");
    await expectCode(c.as(c.member, "guide_release_set", true, 8, 0), "42501");
    await expectCode(c.as(c.seasoned.id, "guide_release_set", true, 8, 0), "42501");
    await expectCode(c.as(look, "guide_release_set", true, 8, 0), "42501");
    await expectCode(c.anon("guide_release_get"), "42501");
    await expectCode(c.anon("guide_release_set", true, 8, 0), "42501");
    for (const who of [c.admin, c.director, c.pastor]) await c.as(who, "guide_release_set", false, 8, 0);
  });

  it("refuses an hour or a quarter that does not exist, and a missing On or Off", async () => {
    for (const bad of [[true, 24, 0], [true, -1, 0], [true, 8, 10], [true, 8, 60], [true, null, 0], [true, 8, null], [null, 8, 0]]) {
      await expectCode(c.as(c.admin, "guide_release_set", ...bad), "22023");
    }
    expect(await c.one("select weekly from public.guide_release_settings")).toMatchObject({ weekly: false });
  });

  it("saves the setting, says who changed it, and writes a line in the log without a person's name in it", async () => {
    await c.as(c.director, "guide_release_set", true, 17, 30);
    expect(await c.as(c.admin, "guide_release_get")).toMatchObject({ weekly: true, hour: 17, minute: 30 });
    expect((await c.as(c.admin, "guide_release_get")).changed_by).toBeTruthy();
    const log = await c.one("select meta from public.event_log where action = 'guides.release' order by at desc limit 1");
    expect(log.meta).toEqual({ weekly: true, hour: 17, minute: 30 });
  });

  it("keeps the helper functions out of reach of everyone who is not the database", async () => {
    for (const fn of ["guide_release_weekly()", "guide_opens_at(uuid, integer)", "guide_open_week(uuid)", "guide_release_view(uuid)"]) {
      const row = await c.one(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a, has_function_privilege('anon', 'public.${fn}', 'execute') as b`);
      expect(row, fn).toEqual({ a: false, b: false });
    }
  });
});

describe("when the moment is", () => {
  it("is the day before the week starts, at the time set, Lagos time, and nothing for week 1", async () => {
    await c.sql("update public.seasons set starts_on = '2026-11-01' where id = $1", [c.season]);
    const at = async (w: number | null) => (await c.one("select public.guide_opens_at($1, $2) as t", [c.season, w])).t as Date | null;
    expect(await at(1)).toBeNull();
    expect(await at(null)).toBeNull();
    expect((await at(2))?.toISOString()).toBe("2026-11-07T07:00:00.000Z"); // Saturday 7 November, 8 am in Lagos (UTC+1)
    expect((await at(3))?.toISOString()).toBe("2026-11-14T07:00:00.000Z");
    expect((await at(12))?.toISOString()).toBe("2027-01-16T07:00:00.000Z");
    await setting(true, 17, 30);
    expect((await at(2))?.toISOString()).toBe("2026-11-07T16:30:00.000Z");
    await setting(true, 0, 0);
    expect((await at(2))?.toISOString()).toBe("2026-11-06T23:00:00.000Z");
  });
});

describe("what a leader can read", () => {
  it("while it is Off, any week, as before", async () => {
    for (const w of [1, 2, 7, 12]) {
      const g = (await week(c.seasoned.id, w)).guide;
      expect(g.locked, `week ${w}`).toBeUndefined();
      expect(g.title, `week ${w}`).toBeTruthy();
    }
    expect((await week(c.seasoned.id, 3)).release).toMatchObject({ weekly: false, open_week: 12, next_week: null, next_opens_at: null });
  });

  it("while it is On, this week and the weeks already open, and nothing later", async () => {
    await start(7); // week 2 has just begun; week 2 opened yesterday; week 3 opens in six days
    await setting(true);
    const now = await week(c.seasoned.id, null);
    expect(now.current_week).toBe(2);
    expect(now.week).toBe(2);
    expect(now.guide.title).toBeTruthy();
    expect(now.release).toMatchObject({ weekly: true, open_week: 2, next_week: 3 });
    expect(new Date(now.release.next_opens_at).getTime()).toBeGreaterThan(Date.now());
    expect((await week(c.seasoned.id, 1)).guide.title).toBeTruthy();
    expect((await week(c.seasoned.id, 2)).guide.title).toBeTruthy();
    for (const w of [3, 4, 12]) {
      const g = (await week(c.seasoned.id, w)).guide;
      expect(g, `week ${w}`).toMatchObject({ week: w, locked: true });
      expect(Object.keys(g).sort(), `week ${w}`).toEqual(["locked", "opens_at", "week"]);
      expect(new Date(g.opens_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("the Saturday itself, once the time has come, opens next week; the day before it does not", async () => {
    await setting(true, 0, 0);
    await start(6); // today is the Saturday before week 2, and midnight has passed
    expect((await week(c.seasoned.id, null)).release).toMatchObject({ open_week: 2, next_week: 3 });
    expect((await week(c.seasoned.id, 2)).guide.title).toBeTruthy();
    expect((await week(c.seasoned.id, 3)).guide.locked).toBe(true);
    await start(5); // tomorrow is the Saturday: week 2 is still closed, whatever the hour
    expect((await week(c.seasoned.id, null)).release).toMatchObject({ open_week: 1, next_week: 2 });
    expect((await week(c.seasoned.id, 2)).guide.locked).toBe(true);
    expect((await week(c.seasoned.id, 1)).guide.title).toBeTruthy();
  });

  it("before the season starts, week 1 only; after it ends, every week", async () => {
    await setting(true);
    await start(-10);
    expect((await week(c.seasoned.id, null)).guide.title).toBeTruthy();
    expect((await week(c.seasoned.id, 2)).guide.locked).toBe(true);
    await start(200);
    for (const w of [1, 6, 12]) expect((await week(c.seasoned.id, w)).guide.title, `week ${w}`).toBeTruthy();
    expect((await week(c.seasoned.id, null)).release).toMatchObject({ open_week: 12, next_week: null, next_opens_at: null });
  });

  it("the office reads every week while it is On, and the rest of the page is the same for everyone", async () => {
    await start(7);
    await setting(true);
    for (const who of [c.pastor, c.director]) {
      const g = (await week(who, 9)).guide;
      expect(g.locked, who).toBeUndefined();
      expect(g.title, who).toBeTruthy();
    }
    const leader = await week(c.seasoned.id, 9);
    const office = await week(c.pastor, 9);
    // what differs is who the viewer is (a leader may edit and log, the office may not edit), never the guide rule
    const same = (page: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const { guide, can_edit, log_open, picture, ...rest } = page; // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest;
    };
    expect(same(leader)).toEqual(same(office));
    expect(Object.keys(leader).sort()).toEqual(Object.keys(office).sort());
    expect(leader.members).toHaveLength(2);
  });

  it("a week that is not locked has the same guide with the rule On as with it Off", async () => {
    await start(30);
    const before = await week(c.seasoned.id, 3);
    await setting(true);
    const after = await week(c.seasoned.id, 3);
    expect(after.guide).toEqual(before.guide);
  });

  it("someone who does not run the tribe still reads nothing of it", async () => {
    await setting(true);
    await expectCode(c.as(c.member, "tribe_week", c.seasoned.tribe, 2), "42501");
    await expectCode(c.anon("tribe_week", c.seasoned.tribe, 2), "42501");
  });
});
