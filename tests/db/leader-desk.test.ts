import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The Leader Desk in God Mode, Phase 1 (see). What these prove:
//   * it is the owner's alone, and it is closed until the Switchboard opens it; its helpers are closed to every signed-in person;
//   * it lists the members who finished the form and still have no seat, with the list they belong to, the reason no tribe has fitted them
//     (and that reason agrees with what the matching itself would show), and a masked phone number that never carries the full number;
//   * a full number opens one at a time, in calling hours only, at most 60 an hour, and the log of openings never holds the number;
//   * a draft group is scored by the same rules as a real tribe: for the same members and the same settings the score is the same number, and a
//     person the matching would never show that tribe is a person the draft refuses, or warns about;
//   * the leadership signal is built from the five things the church knows and from nothing else;
//   * it sends nothing and changes no member, seat, tribe, message or notice.

let c: Cast;
let n = 0;
const PHONE = "+2348031924657";
const REASON = "Trying the Leader Desk with real people";

const owner = (fn: string, ...args: unknown[]) => c.o.call(fn, ...args);
const admin = (text: string, params: unknown[] = []) => c.sql(text, params);
const lagosHour = async (h: number | null) => {
  // The calling window reads the hour of the day in Lagos; a test fixes that hour instead of waiting for it
  await admin(
    h === null
      ? "create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select extract(hour from (now() at time zone 'Africa/Lagos'))::integer; $f$"
      : `create or replace function public.lagos_hour() returns integer language sql stable set search_path to '' as $f$ select ${h}; $f$`,
  );
};

/** Closes every open tribe and opens the ones given, so a test knows exactly which tribes the matching can see. */
async function only(...tribes: Parameters<Cast["k"]["tribe"]>[1][]) {
  await admin("update public.tribes set status = 'closed' where status = 'approved'");
  const made = [];
  for (const t of tribes) made.push(await c.k.tribe(c.season, { name: `Desk tribe ${++n}`, ...t }));
  return made;
}

/** A member who finished the form this season, waiting, with the answers a test changes. */
async function waiting(name: string, o: Parameters<typeof readyMember>[4] = {}, set: Record<string, unknown> = {}) {
  const u = await readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 5, ...o });
  for (const [col, val] of Object.entries(set)) await admin(`update public.member_profiles set ${col} = $2 where person_id = $1`, [u.id, val]);
  return u;
}

const waitingRows = async (chip: string | null = null) => (await owner("desk_waiting", chip, 100, 0)).rows as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
const rowOf = async (id: string) => (await waitingRows()).find((r) => r.person_id === id);
const block = async (id: string) => (await admin("select public.desk_block_reason($1) as b", [id]))[0].b as { code: string; text: string } | null;
const candidates = async (id: string) => admin("select * from public.match_candidates($1)", [id]);
const fit = async (person: string, group: string) => (await admin("select public.desk_group_fit($1, $2) as f", [person, group]))[0].f as { degree: number; blocked: { code: string }[]; watch: { code: string }[] };

const GROUP = { name: "Wednesday night builders", slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8 };
type GroupOpts = { name?: string; slot?: string; mode?: string; zone?: string | null; type?: string; capacity?: number; track?: string; community?: string | null; goal?: string | null; note?: string | null };
async function makeGroup(o: GroupOpts = {}) {
  const g = { ...GROUP, ...o };
  const track = o.track ?? (await c.k.lookup("tracks", "builders"));
  const community = o.community === undefined ? await c.k.lookup("communities", "professionals") : o.community;
  const goal = o.goal === undefined ? await c.k.goalOf("professionals") : o.goal;
  return (await owner("desk_group_save", null, `${g.name} ${++n}`, track, community, goal, g.slot, g.mode, g.zone, g.type, g.capacity, o.note ?? null)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  c = await makeCast();
  // The season has begun, but joining is still open
  await c.k.moveSeason(c.season, 3);
  await c.set("leader_desk", "rehearsal", { reason: REASON });
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["desk_overview", []],
    ["desk_waiting", [null, 10, 0]],
    ["desk_leaders", ["ready", 10, 0]],
    ["desk_lead_signal", [NOBODY]],
    ["desk_phone_reveal", [NOBODY]],
    ["desk_group_view", [NOBODY]],
    ["desk_groups_list", []],
    ["desk_group_save", [null, "A group", NOBODY, null, null, "sunday-evening", "online", null, "mixed", 8, null]],
    ["desk_group_archive", [NOBODY]],
    ["desk_group_member_add", [NOBODY, NOBODY]],
    ["desk_group_member_remove", [NOBODY, NOBODY]],
    ["desk_group_suggest", [NOBODY, 5]],
    ["desk_clusters", []],
  ];

  it("is the owner's alone: an admin, a director, the pastor, a member and a visitor are all turned away", async () => {
    const m = await waiting("Plain");
    for (const who of [c.admin, c.director, c.pastor, m.id, c.member]) {
      for (const [fn, args] of CALLS) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps its helpers closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["leader_desk_any", []],
      ["desk_need", []],
      ["desk_base", [c.season]],
      ["desk_waiting_base", [c.season]],
      ["desk_lead_base", [c.season]],
      ["desk_block_reason", [NOBODY]],
      ["desk_group_fit", [NOBODY, NOBODY]],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
      await expectCode(c.anon(fn, ...args), "42501");
    }
  });

  it("is closed while the Switchboard has it Off, and opens in Rehearsal and On", async () => {
    await c.set("leader_desk", "off", { reason: REASON });
    await expectCode(owner("desk_overview"), "42501");
    await expectCode(owner("desk_waiting", null, 10, 0), "42501");
    await c.set("leader_desk", "on", { reason: REASON });
    expect((await owner("desk_overview")).mode).toBe("on");
    await c.set("leader_desk", "rehearsal", { reason: REASON });
    expect((await owner("desk_overview")).mode).toBe("rehearsal");
    // The master pause shuts it too
    await admin("update public.feature_master set paused = true");
    await expectCode(owner("desk_overview"), "42501");
    await admin("update public.feature_master set paused = false");
  });

  it("is on the Switchboard for the owner only, Off to begin with", async () => {
    const row = (await admin("select * from public.feature_registry where key = 'leader_desk'"))[0];
    expect(row).toMatchObject({ platform_only: true, default_mode: "off", available: true, stage: 8 });
    expect(row.modes).toEqual(["off", "rehearsal", "on"]);
  });
});

describe("who is waiting", () => {
  it("lists members with a finished form and no seat, and leaves out everyone else", async () => {
    await only({}); // one open tribe: the weeknight, mainland, mixed builders tribe
    const fits = await waiting("Fits");
    const seated = await c.k.seat((await only({}))[0].tribe, c.season, "Seated");
    const under = await waiting("Under", { age: "13-17" }).catch(() => null);
    const held = await waiting("Held");
    await admin("insert into public.placement_holds (person_id, source, note) values ($1, 'owner', 'Waiting on a call')", [held.id]);
    const deleting = await waiting("Deleting");
    await admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [deleting.id, c.k.centreId]);
    const leader = await waiting("Leads");
    await c.db.grant(leader.id, "leader");
    const hidden = await waiting("Hidden");
    await admin("update public.people set hidden = true where id = $1", [hidden.id]);
    const nothing = await c.k.person("NoForm");

    const ids = (await waitingRows()).map((r) => r.person_id);
    expect(ids).toContain(fits.id);
    for (const gone of [seated.id, held.id, deleting.id, leader.id, hidden.id, nothing.id, c.member, c.seasoned.id, c.admin, c.pastor, ...(under ? [under.id] : [])]) {
      expect(ids, gone).not.toContain(gone);
    }
    const total = (await owner("desk_waiting", null, 100, 0)).total;
    expect(total).toBe(ids.length);
  });

  it("puts each member in one list: none shown, a few shown, three shown and not chosen, or never run, with the Starter request alongside", async () => {
    await only({});
    const none = await waiting("None");
    const few = await waiting("Few");
    const chose = await waiting("Chose");
    const never = await waiting("Never");
    const starter = await waiting("Starter");
    const demand = (p: string, shown: number, starterWish = false) =>
      admin(
        `insert into public.match_demand (person_id, season_id, tribe_kind, shown, meeting_times, wants_starter) values ($1, $2, 'mixed', $3, '{}', $4)`,
        [p, c.season, shown, starterWish],
      );
    await demand(none.id, 0);
    await demand(few.id, 2);
    await demand(starter.id, 0, true);
    await admin("insert into public.match_runs (person_id, season_id, model_version, candidates, shown) select $1, $2, version, 3, 3 from public.match_models where active", [chose.id, c.season]);

    const by: Record<string, Record<string, any>> = Object.fromEntries((await waitingRows()).map((r) => [r.person_id, r])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(by[none.id].chip).toBe("none_shown");
    expect(by[few.id].chip).toBe("few_shown");
    expect(by[chose.id].chip).toBe("not_chosen");
    expect(by[never.id].chip).toBe("not_run");
    expect(by[starter.id]).toMatchObject({ chip: "none_shown", starter: true });

    const overview = await owner("desk_overview");
    expect(overview.waiting.all).toBe(Object.keys(by).length);
    for (const chip of ["none_shown", "few_shown", "not_chosen", "not_run"]) {
      expect(overview.waiting[chip]).toBe(Object.values(by).filter((r) => r.chip === chip).length);
      expect((await waitingRows(chip)).every((r) => r.chip === chip)).toBe(true);
      expect((await owner("desk_waiting", chip, 100, 0)).total).toBe(overview.waiting[chip]);
    }
    expect((await waitingRows("starter")).map((r) => r.person_id)).toEqual([starter.id]);
    expect(overview.waiting.starter).toBe(1);
    await expectCode(owner("desk_waiting", "everyone", 10, 0), "22023");
  });

  it("counts days from the day the form was finished, longest first, and pages", async () => {
    await only({});
    const old = await waiting("Old", { daysAgo: 30 });
    const fresh = await waiting("Fresh", { daysAgo: 1 });
    const rows = await waitingRows();
    expect(rows.find((r) => r.person_id === old.id)!.days).toBeGreaterThanOrEqual(30);
    expect(rows.find((r) => r.person_id === fresh.id)!.days).toBeLessThanOrEqual(2);
    expect(rows.findIndex((r) => r.person_id === old.id)).toBeLessThan(rows.findIndex((r) => r.person_id === fresh.id));
    const page1 = (await owner("desk_waiting", null, 2, 0)).rows;
    const page2 = (await owner("desk_waiting", null, 2, 2)).rows;
    expect(page1).toHaveLength(2);
    expect(page1.map((r: any) => r.person_id)).toEqual(rows.slice(0, 2).map((r) => r.person_id)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(page2.map((r: any) => r.person_id)).toEqual(rows.slice(2, 4).map((r) => r.person_id)); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("shows the best-fitting open tribe and its score, and the scores against each draft group", async () => {
    const [T] = await only({ name: "Best fit tribe" });
    const m = await waiting("Scored");
    const g = await makeGroup();
    const r = (await rowOf(m.id))!;
    const cand = (await candidates(m.id)).filter((x) => x.r_tribe === T.tribe);
    expect(r.best).toBe(cand[0].r_degree);
    expect(r.best_tribe).toBe("Best fit tribe");
    expect(r.options).toBe(1);
    expect(r.block).toBeNull();
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({ group_id: g.id, fits: true });
    expect(r.drafts[0].degree).toBe((await fit(m.id, g.id)).degree);
    await owner("desk_group_archive", g.id);
    expect((await rowOf(m.id))!.drafts).toEqual([]);
  });
});

describe("why no tribe has fitted them", () => {
  const ADULT_OTHER = async () =>
    (await admin("select ar.slug from public.age_ranges ar join public.tracks t on t.id = ar.track_id where t.slug <> 'builders' and (ar.max_age is null or ar.max_age >= 18) order by ar.min_age limit 1"))[0].slug as string;

  it("names the first rule that leaves no tribe at all, in the order the matching applies them", async () => {
    await only({}); // weeknight evening, in person, mainland, mixed, builders, capacity 12
    const cases: [string, Parameters<typeof readyMember>[4], Record<string, unknown>, string][] = [
      ["time", { times: ["saturday-morning"] }, {}, "time"],
      ["format", { mode: "online" }, {}, "format"],
      ["area", { mode: "in_person", zone: "abroad" }, {}, "area"],
      ["type", { mix: "same_gender" }, {}, "type"],
      ["track", { age: await ADULT_OTHER() }, {}, "track"],
    ];
    for (const [name, o, set, code] of cases) {
      const m = await waiting(`Block${name}`, o, set);
      expect((await candidates(m.id)).length, name).toBe(0);
      expect((await block(m.id))!.code, name).toBe(code);
      const row = (await rowOf(m.id))!;
      expect(row.options, name).toBe(0);
      expect(row.block.code, name).toBe(code);
      expect(typeof row.block.text, name).toBe("string");
    }
    // A member the tribe would suit has no reason, because there is no problem
    const fine = await waiting("Fine");
    expect((await candidates(fine.id)).length).toBe(1);
    expect(await block(fine.id)).toBeNull();
  });

  it("says there is no tribe when none is open, and that every tribe is full when they are", async () => {
    const m = await waiting("Nowhere");
    await only();
    expect((await block(m.id))!.code).toBe("no_tribes");
    const [T] = await only({ capacity: 4 });
    for (let i = 0; i < 4; i++) await c.k.seat(T.tribe, c.season, `Full${++n}`);
    const m2 = await waiting("Late");
    expect((await candidates(m2.id)).length).toBe(0);
    expect((await block(m2.id))!.code).toBe("room");
  });

  it("says a tribe the church took them out of is not left to them", async () => {
    const [T] = await only({});
    const m = await waiting("Removed");
    expect(await block(m.id)).toBeNull();
    // They had a seat in it and the church took them out
    const seat = (
      await admin(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by, status, released_at)
         values ($1, $2, $3, 1, 80, 't', '{}'::jsonb, current_date, 'released', now()) returning id`,
        [T.tribe, m.id, c.season],
      )
    )[0].id;
    const removal = (
      await admin(
        `insert into public.admin_removals (seat_id, tribe_id, person_id, removed_by, removed_role, reason) values ($1, $2, $3, $4, 'admin', 'Taken out for a test of the desk') returning id`,
        [seat, T.tribe, m.id, c.admin],
      )
    )[0].id;
    await admin("insert into public.removal_blocks (person_id, tribe_id, season_id, admin_removal_id) values ($1, $2, $3, $4)", [m.id, T.tribe, c.season, removal]);
    expect((await candidates(m.id)).length).toBe(0);
    expect((await block(m.id))!.code).toBe("excluded");
    // Put back in a different tribe's reach, they have a reason no more
    await admin("update public.removal_blocks set lifted_at = now() where person_id = $1", [m.id]);
    expect(await block(m.id)).toBeNull();
  });

  it("says a tribe's balance rules are the reason when seating them would break one", async () => {
    const [T] = await only({ capacity: 6 });
    // Two members who need heavy support: a third cannot be seated
    for (let i = 0; i < 2; i++) {
      const s = await c.k.seat(T.tribe, c.season, `Heavy${++n}`);
      await admin("update public.member_profiles set support_load = 2, faith_journey = 'established', style_social = $2 where person_id = $1", [s.id, i === 0 ? -1 : 1]);
    }
    const heavy = await waiting("NeedsMuch", {}, { support_load: 2 });
    expect((await candidates(heavy.id)).length).toBe(0);
    expect((await block(heavy.id))!.code).toBe("room");
    const light = await waiting("Light");
    expect((await candidates(light.id)).length).toBe(1);
    expect(await block(light.id)).toBeNull();
  });

  it("says tribes exist but none scores high enough, when every tribe is below the bar", async () => {
    await only({});
    const m = await waiting("Low", { times: [] });
    expect((await candidates(m.id)).length).toBe(1);
    expect(await block(m.id)).toBeNull();
    await admin("update public.match_models set min_degree = 100 where active");
    try {
      expect((await block(m.id))!.code).toBe("low_score");
      expect((await rowOf(m.id))!.block.code).toBe("low_score");
    } finally {
      await admin("update public.match_models set min_degree = 60 where active");
    }
  });

  it("agrees with the matching itself for every kind of member: a reason when, and only when, no tribe would be shown", async () => {
    await only({}, { slot: "sunday-evening", mode: "online", type: "women" }, { track: "stewards", zone: "island-lekki" });
    const floor = (await admin("select public.placement_floor() as f"))[0].f as number;
    const kinds: Parameters<typeof readyMember>[4][] = [
      {}, { times: ["sunday-evening"], mode: "online", gender: "female" }, { times: [] }, { mode: "in_person", zone: "abroad" },
      { gender: "male", mix: "same_gender" }, { mode: "online", times: ["sunday-evening"], gender: "male" },
      { gender: "female", mix: "same_gender", mode: "online", times: ["sunday-evening"] }, { adjacent: true },
    ];
    for (const k of kinds) {
      const m = await waiting("Kind", k);
      const shown = (await candidates(m.id)).filter((x) => x.r_degree >= floor).length;
      const b = await block(m.id);
      expect(b === null, JSON.stringify(k)).toBe(shown > 0);
      const row = (await rowOf(m.id))!;
      expect(row.options, JSON.stringify(k)).toBe(shown);
    }
  });
});

describe("phone numbers", () => {
  it("shows a masked number, never the full one, in every list", async () => {
    await only({});
    const m = await waiting("Phone", { whatsapp: PHONE });
    const none = await waiting("NoPhone");
    const g = await makeGroup();
    await owner("desk_group_member_add", g.id, m.id);
    const row = (await rowOf(m.id))!;
    expect(row.has_number).toBe(true);
    expect(row.phone).toMatch(/^\+23480 •+ 4657$/);
    expect((await rowOf(none.id))!).toMatchObject({ has_number: false, phone: null });
    const payloads = [
      await owner("desk_waiting", null, 100, 0),
      await owner("desk_group_view", g.id),
      await owner("desk_groups_list"),
      await owner("desk_leaders", "members", 100, 0),
      await owner("desk_overview"),
    ];
    for (const p of payloads) expect(JSON.stringify(p)).not.toContain("8031924657");
    const suggested = await owner("desk_group_suggest", g.id, 20);
    expect(JSON.stringify(suggested)).not.toContain("8031924657");
  });

  it("opens one full number, in calling hours, and writes down who opened it without writing the number", async () => {
    await only({});
    const m = await waiting("Reveal", { whatsapp: PHONE });
    await lagosHour(12);
    try {
      const before = (await admin("select count(*)::int n from public.desk_reveals"))[0].n;
      const r = await owner("desk_phone_reveal", m.id);
      expect(r).toEqual({ ok: true, number: PHONE });
      const log = await admin("select * from public.desk_reveals order by id desc limit 1");
      expect((await admin("select count(*)::int n from public.desk_reveals"))[0].n).toBe(before + 1);
      expect(log[0]).toMatchObject({ person_id: m.id, by_person: c.o.owner.id });
      expect(JSON.stringify(log)).not.toContain("8031924657");
      const ev = await admin("select * from public.event_log where action = 'leader_desk.reveal' order by id desc limit 1");
      expect(ev[0].entity_id).toBe(m.id);
      expect(JSON.stringify(ev)).not.toContain("8031924657");
      // A member without a number gives nothing and writes nothing
      const none = await waiting("NoNumber");
      expect(await owner("desk_phone_reveal", none.id)).toEqual({ ok: true, number: null });
      expect((await admin("select count(*)::int n from public.desk_reveals"))[0].n).toBe(before + 1);
      // Someone who is not on the desk gives nothing
      await expectCode(owner("desk_phone_reveal", c.seasoned.id), "P0002");
      await expectCode(owner("desk_phone_reveal", NOBODY), "P0002");
    } finally {
      await lagosHour(null);
    }
  });

  it("opens none before 8 am or from 8 pm, Lagos time", async () => {
    const m = await waiting("Night", { whatsapp: PHONE });
    for (const h of [3, 7, 20, 23]) {
      await lagosHour(h);
      try {
        await expectCode(owner("desk_phone_reveal", m.id), "22023");
      } finally {
        await lagosHour(null);
      }
    }
    for (const h of [8, 19]) {
      await lagosHour(h);
      try {
        expect((await owner("desk_phone_reveal", m.id)).number).toBe(PHONE);
      } finally {
        await lagosHour(null);
      }
    }
  });

  it("opens at most 60 an hour", async () => {
    const m = await waiting("Many", { whatsapp: PHONE });
    await admin("delete from public.desk_reveals");
    await admin("insert into public.desk_reveals (person_id, by_person) select $1, $2 from generate_series(1, 60)", [m.id, c.o.owner.id]);
    await lagosHour(12);
    try {
      await expectCode(owner("desk_phone_reveal", m.id), "22023");
      await admin("update public.desk_reveals set created_at = now() - interval '2 hours'");
      expect((await owner("desk_phone_reveal", m.id)).number).toBe(PHONE);
    } finally {
      await lagosHour(null);
    }
  });
});

describe("draft groups", () => {
  it("makes a draft, checks every field, and shows it with its checks", async () => {
    await only({});
    const track = await c.k.lookup("tracks", "builders");
    const save = (over: Record<string, unknown> = {}) => {
      const v = { id: null, name: "Draft group", track, community: null, goal: null, slot: "sunday-evening", mode: "online", zone: null, type: "mixed", capacity: 8, note: null, ...over };
      return owner("desk_group_save", v.id, v.name, v.track, v.community, v.goal, v.slot, v.mode, v.zone, v.type, v.capacity, v.note);
    };
    for (const bad of [
      { name: "ab" }, { name: "x".repeat(61) }, { track: null }, { track: NOBODY }, { slot: "monday" }, { mode: "hybrid" },
      { mode: "in_person", zone: null }, { mode: "in_person", zone: "abroad" }, { type: "boys" }, { capacity: 3 }, { capacity: 13 }, { note: "n".repeat(301) },
      { community: NOBODY }, { goal: NOBODY },
    ]) {
      await expectCode(save(bad), "22023");
    }
    const g = await save({ note: "Starts after the first call" });
    expect(g).toMatchObject({ name: "Draft group", status: "draft", slot: "sunday-evening", mode: "online", zone: null, type: "mixed", capacity: 8, size: 0, ready: false });
    expect(g.checks.map((x: any) => x.code)).toEqual(["size", "fit", "score", "heavy", "established", "balance", "numbers"]); // eslint-disable-line @typescript-eslint/no-explicit-any
    // An online group has no area, whatever was sent
    expect((await save({ id: g.id, zone: "mainland" })).zone).toBeNull();
    expect((await save({ id: g.id, mode: "in_person", zone: "island-lekki" }))).toMatchObject({ mode: "in_person", zone: "island-lekki" });
    expect((await owner("desk_groups_list")).map((x: any) => x.id)).toContain(g.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    await expectCode(owner("desk_group_view", NOBODY), "P0002");
  });

  it("makes no member, seat, tribe, message or notice, and sends nothing", async () => {
    await only({});
    const count = async () =>
      (await admin(`select (select count(*) from public.tribe_members) as seats, (select count(*) from public.tribes) as tribes, (select count(*) from public.messages) as messages,
                           (select count(*) from public.notice_items) as notices, (select count(*) from public.consents) as consents,
                           (select count(*) from public.member_profiles) as profiles`))[0];
    const before = await count();
    const m = await waiting("Quiet", { whatsapp: PHONE });
    const m2 = await waiting("Quiet");
    const after1 = await count();
    const g = await makeGroup();
    await owner("desk_group_member_add", g.id, m.id);
    await owner("desk_group_member_add", g.id, m2.id);
    await owner("desk_group_suggest", g.id, 10);
    await owner("desk_clusters");
    await owner("desk_leaders", "ready", 10, 0);
    await owner("desk_overview");
    await owner("desk_group_member_remove", g.id, m2.id);
    await owner("desk_group_archive", g.id);
    const after2 = await count();
    expect(after2).toEqual(after1);
    expect(Number(after1.profiles)).toBe(Number(before.profiles) + 2);
  });

  it("adds a waiting member, refuses one who cannot make the group, one already in another draft, a seated member, and a full group", async () => {
    await only({});
    const g = await makeGroup({ capacity: 4 });
    const g2 = await makeGroup({ name: "Second draft" });
    const ok = await waiting("Can");
    const view = await owner("desk_group_member_add", g.id, ok.id);
    expect(view.size).toBe(1);
    expect(view.members[0]).toMatchObject({ person_id: ok.id });
    expect(view.members[0].degree).toBe((await fit(ok.id, g.id)).degree);
    // Adding again changes nothing
    expect((await owner("desk_group_member_add", g.id, ok.id)).size).toBe(1);
    // The person is in this draft and cannot also be in the other
    await expectCode(owner("desk_group_member_add", g2.id, ok.id), "22023");
    // Each rule that rules a person out is refused, with a reason
    const refused: [string, Parameters<typeof readyMember>[4]][] = [
      ["time", { times: ["saturday-morning"] }],
      ["format", { mode: "online" }],
      ["type", { mix: "same_gender" }],
    ];
    for (const [code, o] of refused) {
      const m = await waiting(`No${code}`, o);
      await expect(owner("desk_group_member_add", g.id, m.id)).rejects.toThrow(/./);
      expect((await fit(m.id, g.id)).blocked.map((b) => b.code)).toContain(code);
    }
    // A seated member is not waiting
    await expectCode(owner("desk_group_member_add", g.id, c.seasoned.members[0]), "22023");
    // A full group takes nobody else
    for (let i = 0; i < 3; i++) await owner("desk_group_member_add", g.id, (await waiting(`Fill${i}`)).id);
    expect((await owner("desk_group_view", g.id)).size).toBe(4);
    await expectCode(owner("desk_group_member_add", g.id, (await waiting("Extra")).id), "22023");
    // Taking someone out frees the seat and lets them join the other draft
    expect((await owner("desk_group_member_remove", g.id, ok.id)).size).toBe(3);
    expect((await owner("desk_group_member_add", g2.id, ok.id)).size).toBe(1);
  });

  it("will not shrink a group below the people already in it, and will not change an archived one", async () => {
    await only({});
    const g = await makeGroup({ capacity: 6 });
    for (let i = 0; i < 5; i++) await owner("desk_group_member_add", g.id, (await waiting(`Seat${i}`)).id);
    const track = await c.k.lookup("tracks", "builders");
    await expectCode(owner("desk_group_save", g.id, "Smaller", track, null, null, "weeknight-evening", "in_person", "mainland", "mixed", 4, null), "22023");
    await owner("desk_group_archive", g.id);
    await expectCode(owner("desk_group_save", g.id, "Changed", track, null, null, "weeknight-evening", "in_person", "mainland", "mixed", 8, null), "22023");
    await expectCode(owner("desk_group_member_add", g.id, (await waiting("Late")).id), "22023");
    await expectCode(owner("desk_group_member_remove", g.id, NOBODY), "22023");
    expect((await owner("desk_groups_list")).map((x: any) => x.id)).not.toContain(g.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Archiving twice changes nothing
    expect(await owner("desk_group_archive", g.id)).toEqual({ ok: true });
    // Members of an archived group are free to join another
    const g2 = await makeGroup();
    const first = (await admin("select person_id from public.desk_group_members where group_id = $1 limit 1", [g.id]))[0].person_id;
    expect((await owner("desk_group_member_add", g2.id, first)).size).toBe(1);
  });

  it("allows 40 drafts in a season and no more", async () => {
    await only({});
    await admin("update public.desk_groups set status = 'archived'");
    for (let i = 0; i < 40; i++) await makeGroup();
    await expectCode(makeGroup(), "22023");
    await admin("update public.desk_groups set status = 'archived'");
  });

  it("checks the group the way the matching checks a tribe: size, fit, score, heavy support, established believers, quiet and lively", async () => {
    await only({});
    const g = await makeGroup({ capacity: 8 });
    const states = (v: any) => Object.fromEntries(v.checks.map((x: any) => [x.code, x.state])); // eslint-disable-line @typescript-eslint/no-explicit-any
    let v = await owner("desk_group_view", g.id);
    expect(states(v)).toMatchObject({ size: "wait", fit: "wait", score: "wait", heavy: "ok", established: "wait", balance: "wait" });
    const add = async (name: string, o: Parameters<typeof readyMember>[4], set: Record<string, unknown>) => {
      const m = await waiting(name, o, set);
      return owner("desk_group_member_add", g.id, m.id);
    };
    // Five growing, middling people: big enough, but no established believers and no quiet or lively voice
    for (let i = 0; i < 5; i++) v = await add(`Mid${i}`, {}, { faith_journey: "growing" });
    expect(states(v)).toMatchObject({ size: "ok", fit: "ok", established: "fix", balance: "fix", heavy: "ok" });
    expect(v.ready).toBe(false);
    // Two established believers, one quiet, one lively
    await admin("update public.member_profiles set faith_journey = 'established', style_social = -1 where person_id = $1", [v.members[0].person_id]);
    await admin("update public.member_profiles set faith_journey = 'leading', style_social = 1 where person_id = $1", [v.members[1].person_id]);
    v = await owner("desk_group_view", g.id);
    expect(states(v)).toMatchObject({ established: "ok", balance: "ok", heavy: "ok" });
    // Three who need heavy support is one too many
    for (const i of [2, 3, 4]) await admin("update public.member_profiles set support_load = 2 where person_id = $1", [v.members[i].person_id]);
    v = await owner("desk_group_view", g.id);
    expect(states(v).heavy).toBe("fix");
    expect(v.ready).toBe(false);
    for (const i of [2, 3, 4]) await admin("update public.member_profiles set support_load = 0 where person_id = $1", [v.members[i].person_id]);
    v = await owner("desk_group_view", g.id);
    expect(states(v)).toMatchObject({ size: "ok", fit: "ok", score: "ok", heavy: "ok", established: "ok", balance: "ok" });
    expect(v.ready).toBe(true);
    // The average score is the average of the members' own scores
    const scores = v.members.map((m: any) => m.degree); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.average).toBe(Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length));
    // A member who can no longer make the time is a fit problem, named
    await admin("update public.member_profiles set meeting_times = '{saturday-morning}' where person_id = $1", [v.members[0].person_id]);
    v = await owner("desk_group_view", g.id);
    expect(states(v).fit).toBe("fix");
    expect(v.members[0].blocked.map((b: any) => b.code)).toContain("time"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(v.ready).toBe(false);
  });

  it("suggests the waiting members who suit a group best, best first, never someone the group rules out, and never someone already in a draft", async () => {
    await only({});
    const g = await makeGroup();
    // In person, on a weeknight evening: the best rhythm the group can have
    const best = await waiting("Best", { community: "professionals", mode: "in_person", times: ["weeknight-evening"] });
    const wrongTime = await waiting("Wrong", { times: ["sunday-evening"] });
    const inDraft = await waiting("Taken");
    const g2 = await makeGroup({ name: "Other draft" });
    await owner("desk_group_member_add", g2.id, inDraft.id);
    const list = await owner("desk_group_suggest", g.id, 40);
    const ids = list.map((x: any) => x.person_id); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ids[0]).toBe(best.id);
    expect(ids).not.toContain(wrongTime.id);
    expect(ids).not.toContain(inDraft.id);
    const degrees = list.map((x: any) => x.degree); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([...degrees].sort((a: number, b: number) => b - a)).toEqual(degrees);
    // Everyone suggested is someone the group's own rules allow, at the score the group gives them
    for (const x of list) {
      const f = await fit(x.person_id, g.id);
      expect(f.blocked, x.person_id).toEqual([]);
      expect(x.degree).toBe(f.degree);
    }
    expect(await owner("desk_group_suggest", g.id, 1)).toHaveLength(1);
  });

  it("lists the groups the waiting members could already fill, leaving out anyone already in a draft", async () => {
    await only({});
    await admin("update public.desk_groups set status = 'archived'");
    // A life stage no other test uses, so the count is this test's own
    const other = (await admin("select ar.slug, t.name from public.age_ranges ar join public.tracks t on t.id = ar.track_id where t.slug <> 'builders' and (ar.max_age is null or ar.max_age >= 18) order by ar.min_age desc limit 1"))[0];
    const min = (await admin("select min_tribe from public.placement_settings limit 1"))[0].min_tribe as number;
    const gang = [];
    for (let i = 0; i < min; i++) gang.push(await waiting(`Gang${i}`, { age: other.slug, times: ["saturday-morning"], mode: "online", gender: "female", mix: "mixed" }));
    const clusters = (await owner("desk_clusters")) as { slot: string; mode: string; type: string; size: number; track: string; track_id: string }[];
    const mine = clusters.filter((x) => x.track === other.name);
    expect(mine.find((x) => x.slot === "saturday-morning" && x.mode === "online" && x.type === "mixed")).toMatchObject({ size: min });
    expect(clusters.every((x) => x.size >= min)).toBe(true);
    // The women's group needs women who did not ask for a mixed tribe, and the men's group needs men
    expect(mine.find((x) => x.type === "women" || x.type === "men")).toBeUndefined();
    // Nobody is counted for a time they cannot make
    expect(mine.find((x) => x.slot !== "saturday-morning")).toBeUndefined();
    // One goes into a draft: the group is now one short of a tribe
    const g = await makeGroup({ track: other.track_id ?? (await c.k.lookup("tracks", (await admin("select slug from public.tracks where name = $1", [other.name]))[0].slug)), slot: "saturday-morning", mode: "online", zone: null });
    await owner("desk_group_member_add", g.id, gang[0].id);
    const after = (await owner("desk_clusters")) as { slot: string; mode: string; type: string; track: string }[];
    expect(after.filter((x) => x.track === other.name)).toEqual([]);
  });
});

describe("one score, one set of rules", () => {
  it("scores a draft group exactly as the matching scores a tribe with the same settings and the same members", async () => {
    // The real tribe: 6 seats, three members (two who need heavy support, one quiet, one lively, two established), led by a certified leader with no application
    const [T, T0] = await only({ capacity: 6, name: "Parity tribe" }, { capacity: 12, name: "Parity empty", slot: "weeknight-evening" });
    const seats = [];
    for (const [i, o] of [
      { support_load: 2, faith_journey: "established", style_social: -1 },
      { support_load: 2, faith_journey: "growing", style_social: 1 },
      { support_load: 0, faith_journey: "established", style_social: 0 },
    ].entries()) {
      const s = await c.k.seat(T.tribe, c.season, `Seat${++n}`);
      await admin("update public.member_profiles set support_load = $2, faith_journey = $3, style_social = $4, group_roles = $5 where person_id = $1", [
        s.id, o.support_load, o.faith_journey, o.style_social, i === 0 ? ["host"] : [],
      ]);
      seats.push(s);
    }
    const tribe = (await admin("select * from public.tribes where id = $1", [T.tribe]))[0];
    const mirror = async (t: any, members: string[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const g = (await owner("desk_group_save", null, `Mirror ${++n}`, t.track_id, t.community_id, t.season_goal_id, t.slot, t.meeting_mode, t.zone, t.tribe_type, t.capacity, null)).id as string;
      for (const m of members) await admin("insert into public.desk_group_members (group_id, person_id) values ($1, $2)", [g, m]);
      return g;
    };
    const G = await mirror(tribe, seats.map((s) => s.id));
    const emptyTribe = (await admin("select * from public.tribes where id = $1", [T0.tribe]))[0];
    const G0 = await mirror(emptyTribe, []);

    // A spread of people: every answer the score reads, varied
    const profiles: [Parameters<typeof readyMember>[4], Record<string, unknown>][] = [
      [{}, {}],
      [{ times: [] }, {}],
      [{ times: ["weeknight-evening", "sunday-evening"] }, { style_social: 1 }],
      [{ mode: "online" }, {}],
      [{ mode: "in_person", zone: "island-lekki" }, { style_social: -1 }],
      [{ mode: "in_person", zone: "iganmu-surulere" }, {}],
      [{ mode: "in_person", zone: "abroad" }, {}],
      [{ gender: "male", mix: "same_gender" }, {}],
      [{ gender: "male", mix: "no_preference" }, { faith_journey: "established" }],
      [{ gender: "female", mix: "same_gender" }, {}],
      [{ community: "professionals", faith: "established" }, { support_load: 2 }],
      [{ community: "professionals", faith: "growing" }, { support_load: 2, style_social: -1 }],
      [{ faith: "exploring" }, { style_social: 1 }],
      [{ faith: "growing" }, { group_roles: ["host", "prayer_warrior"] }],
      [{ faith: "new" }, { group_roles: ["host"], style_structure: 1, style_learning: -1 }],
      [{ adjacent: true }, { style_openness: 1, style_disclosure: 1 }],
      [{ social: 1 }, {}],
    ];
    let seen = 0;
    let both = 0;
    for (const [o, set] of profiles) {
      const m = await waiting("Parity", o, set);
      for (const [tribeId, group] of [[T.tribe, G], [T0.tribe, G0]] as const) {
        const cand = (await candidates(m.id)).find((x) => x.r_tribe === tribeId);
        const f = await fit(m.id, group);
        const clean = f.blocked.length === 0 && f.watch.length === 0;
        // The matching shows this tribe if, and only if, no rule rules the person out and no balance rule is broken
        expect(Boolean(cand), `${JSON.stringify(o)} ${JSON.stringify(set)} -> ${JSON.stringify(f)}`).toBe(clean);
        seen++;
        if (cand) {
          expect(f.degree, `${JSON.stringify(o)} ${JSON.stringify(set)}`).toBe(cand.r_degree);
          both++;
        }
      }
    }
    // The test is only worth something if it compared real scores, and saw both outcomes
    expect(both).toBeGreaterThan(10);
    expect(both).toBeLessThan(seen);
  });
});

describe("the leadership signal", () => {
  async function member(name: string, serving: string | null, faith: string, set: Record<string, unknown> = {}) {
    return waiting(name, { faith }, { open_to_serving: serving, ...set });
  }
  const signal = async (id: string) => (await owner("desk_lead_signal", id)) as { score: number; pool: string; parts: Record<string, number>; notes: string[] };

  it("scores willingness 30, walk of faith 25, attendance 20, being named 15 and weekly steps 10", async () => {
    const [T] = await only({ name: "Signal tribe" });
    const strong = await member("Strong", "yes", "established");
    const unknown = await member("Unknown", "maybe", "growing");
    const mid = await member("Mid", "yes", "growing");
    const no = await member("NotNow", "not_now", "leading");
    // Ten weeks: the strong one was there nine, the mid one five
    await c.k.meetings(T.tribe, T.leader.id, 10, [[strong.id, 9], [mid.id, 5]]);
    for (let w = 1; w <= 10; w++) {
      await admin("insert into public.week_steps (person_id, tribe_id, week, when_text, will_text, outcome) values ($1, $2, $3, 'Monday', 'Call', $4)", [
        strong.id, T.tribe, w, w <= 8 ? "done" : "not_yet",
      ]);
    }
    for (let i = 0; i < 2; i++)
      await admin("insert into public.assistant_recommendations (tribe_id, recommended_by, nominee_id, status, paired_at) values ($1, $2, $3, 'paired', now())", [T.tribe, c.admin, strong.id]);
    // 30 + 25 + 20 x 0.9 + 15 + 10 x 0.8 = 96
    const s = await signal(strong.id);
    expect(s).toMatchObject({ score: 96, pool: "ready", parts: { willingness: 30, walk: 25, reliability: 18, named: 15, progress: 8 } });
    expect(s.notes).toEqual(["Said yes to serving", "Established in faith", "Present in 9 of 10 weeks", "Named by 2 people", "Finished 8 of 10 weekly steps"]);
    // 30 x 0.5 + 25 x 0.6 + 20 x 0.5 (too few weeks to judge) + 0 + 10 x 0.5 = 45
    expect(await signal(unknown.id)).toMatchObject({ score: 45, pool: "members", parts: { willingness: 15, walk: 15, reliability: 10, named: 0, progress: 5 } });
    // 30 + 25 x 0.6 + 20 x 0.5 (present 5 of 10) + 0 + 10 x 0.5 (too few steps to judge) = 60
    expect(await signal(mid.id)).toMatchObject({ score: 60, pool: "almost", parts: { reliability: 10 } });
    // Said not now: never in the ready or almost pools, whatever else is true
    expect(await signal(no.id)).toMatchObject({ pool: "members", parts: { willingness: 0, walk: 25 } });
    expect(await signal(NOBODY)).toBeNull();
  });

  it("lists the pools, best first, with counts that agree with the lists", async () => {
    const overview = await owner("desk_overview");
    for (const pool of ["ready", "almost", "members"]) {
      const l = await owner("desk_leaders", pool, 100, 0);
      expect(l.total).toBe(overview.leaders[pool]);
      expect(l.rows).toHaveLength(Math.min(100, l.total));
      expect(l.rows.every((r: any) => r.pool === pool)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
      const scores = l.rows.map((r: any) => r.score); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
    }
    expect((await owner("desk_leaders", "ready", 100, 0)).rows[0].score).toBe(96);
    await expectCode(owner("desk_leaders", "everyone", 10, 0), "22023");
    // The ready pool needs a yes or maybe, an established or leading walk of faith, and 70 or more
    for (const r of (await owner("desk_leaders", "ready", 100, 0)).rows) {
      expect(["yes", "maybe"]).toContain(r.serving);
      expect(["established", "leading"]).toContain(r.faith);
      expect(r.score).toBeGreaterThanOrEqual(70);
    }
  });

  it("leaves out anyone who already leads or assists, anyone under 18, and anyone asking to be deleted", async () => {
    await only({});
    const lead = await member("AlreadyLeads", "yes", "established");
    await c.db.grant(lead.id, "leader");
    const asst = await member("Assists", "yes", "established");
    await c.db.grant(asst.id, "assistant_leader");
    const gone = await member("Deleting", "yes", "established");
    await admin("insert into public.erasure_requests (person_id, centre_id, status, by_office) values ($1, $2, 'open', false)", [gone.id, c.k.centreId]);
    const ok = await member("Willing", "yes", "established");
    const all = [] as string[];
    for (const pool of ["ready", "almost", "members"]) for (const r of (await owner("desk_leaders", pool, 100, 0)).rows) all.push(r.person_id);
    expect(all).toContain(ok.id);
    for (const x of [lead.id, asst.id, gone.id, c.admin, c.pastor, c.member, c.seasoned.id]) expect(all, x).not.toContain(x);
    expect(await signal(lead.id)).toBeNull();
  });

  it("never reads gender, age, area, health, care notes or how much support someone has needed", async () => {
    const body = (await admin("select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_lead_base'"))[0].prosrc as string;
    for (const word of ["gender", "age_range", "birthday", "zone", "area_note", "area_slug", "support_load", "support_enc", "leader_note_enc", "tribe_mix", "children", "relationship", "work_status"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    // Two members who differ only in those things get the same signal
    const a = await member("TwinA", "yes", "growing");
    const b = await member("TwinB", "yes", "growing", { support_load: 2, zone: "abroad", gender: "male", style_social: -1 });
    expect((await signal(b.id)).score).toBe((await signal(a.id)).score);
    expect((await signal(a.id)).score).toBe(60);
  });

  it("leaves the Lead signal for each waiting member on the waiting list", async () => {
    await only({});
    const m = await member("OnList", "yes", "established");
    const row = (await rowOf(m.id))!;
    expect(row.lead).toMatchObject({ score: (await signal(m.id)).score, pool: (await signal(m.id)).pool });
  });
});

describe("at the size of a church", () => {
  it("lists a page of waiting members in good time when hundreds are waiting", async () => {
    await only({});
    await admin("update public.desk_groups set status = 'archived'");
    for (let i = 0; i < 150; i++) await waiting(`Crowd${i}`, {}, i % 3 === 0 ? { open_to_serving: "yes", faith_journey: "established" } : {});
    const started = Date.now();
    const page = await owner("desk_waiting", null, 50, 0);
    const took = Date.now() - started;
    expect(page.total).toBeGreaterThanOrEqual(150);
    expect(page.rows).toHaveLength(50);
    expect(took).toBeLessThan(15_000);
    const o0 = Date.now();
    const overview = await owner("desk_overview");
    expect(overview.waiting.all).toBe(page.total);
    expect(Date.now() - o0).toBeLessThan(15_000);
  }, 240_000);
});
