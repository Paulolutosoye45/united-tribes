import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { expectCode } from "./helpers";
import { markSent, placeRun, readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// Place or move one person from Admin (fix 14). What these prove:
//   * the owner, an admin and a director use the same checks and the same placement; nobody else can;
//   * a person placed by an admin or a director is treated exactly as a church run treats them (field by field), and is recorded with who, in what
//     role, and by which door;
//   * an admin or a director may accept only "joining has closed", "they have not agreed to matching" (with a tick that they told you so) and a hold
//     the church put there; everything else is the owner's, asked for in writing, answered within 7 days, with every check run again;
//   * a blocker refuses everyone, including a tribe the church took the person out of and the placer themselves;
//   * a move gives up the old seat by the routine of a swap, tells the old leader, is all-or-nothing, and is undone by putting the old seat back;
//   * one person gets one seat however many hands click, the last seat in a tribe goes to one person, and 30 placements a day is the most one person makes;
//   * Undo is open to the placer, any admin, any director and the owner until the leader is told, and a church-wide run stays the owner's alone.

let c: Cast;
let admin2: string;
let director2: string;
let coach: string;
let tag = 0;

const started = (n: number) => c.k.moveSeason(c.season, n);
const REASON = "Asked me in person after church";

async function world(members = 1, capacity = 12) {
  tag++;
  await c.sql("update public.tribes set status = 'closed' where status = 'approved'");
  const C = await c.k.tribe(c.season, { capacity, name: `Office ${tag}`, assistant: "certified" });
  const mem: { id: string }[] = [];
  for (let i = 0; i < members; i++) mem.push(await readyMember(c.db, c.k, c.season, `Off${tag}x${i}`, { times: ["weeknight-evening"], daysAgo: 40 - i }));
  return { C, mem };
}

/** A second tribe next to the first (the first stays open). */
async function sister(name: string, capacity = 12) {
  return c.k.tribe(c.season, { capacity, name: `${name} ${++tag}`, assistant: "certified" });
}

const codes = (chk: { warnings: { code: string }[] }) => chk.warnings.map((w) => w.code).sort();
const seatOf = async (person: string) => (await c.sql("select * from public.tribe_members where person_id = $1 and status = 'active'", [person]))[0];
const runOf = async (id: string) => c.one("select * from public.placement_runs where id = $1", [id]);
const place = (who: string, person: string, tribe: string, accept: string[] = [], reason: string | null = null, agreed = false) =>
  c.as(who, "placement_one_place", person, tribe, accept, reason, agreed);
const move = (who: string, person: string, tribe: string, accept: string[] = [], reason: string | null = null, agreed = false) =>
  c.as(who, "placement_one_move", person, tribe, accept, reason, agreed);
const ownerPlace = (person: string, tribe: string, accept: string[] = [], reason: string | null = null, agreed = false) =>
  c.o.call("placement_one_place", person, tribe, accept, reason, agreed);

beforeAll(async () => {
  c = await makeCast();
  admin2 = (await c.k.staff("AdminTwo", "admin")).id;
  director2 = (await c.k.staff("DirectorTwo", "director")).id;
  coach = (await c.k.staff("OfficeCoach", "coach")).id;
  await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
}, 180_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  it("is open to the owner, an admin and a director, and to no one else", async () => {
    const w = await world(1);
    const m = w.mem[0].id;
    const calls: [string, unknown[]][] = [
      ["placement_one_options", [m]],
      ["placement_one_check", [m, w.C.tribe]],
      ["placement_move_check", [m, w.C.tribe]],
      ["placement_one_place", [m, w.C.tribe, [], null, false]],
      ["placement_one_move", [m, w.C.tribe, [], null, false]],
      ["placement_find", ["off"]],
      ["placement_office_person", [m]],
      ["placement_office_tribes", []],
      ["placement_office_tribe", [w.C.tribe]],
      ["placement_requests_list", []],
      ["placement_office_ask", [m, w.C.tribe, [], REASON, false, false]],
    ];
    for (const who of [c.pastor, coach, m, w.C.leader.id, c.member]) {
      for (const [fn, args] of calls) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of calls) await expectCode(c.anon(fn, ...args), "42501");
    for (const who of [c.admin, c.director]) {
      expect(Array.isArray(await c.as(who, "placement_one_options", m))).toBe(true);
      expect((await c.as(who, "placement_one_check", m, w.C.tribe)).who).toBe(who === c.admin ? "admin" : "director");
      expect(await c.as(who, "placement_find", "off")).toBeInstanceOf(Array);
      expect((await c.as(who, "placement_office_tribes")).role).toBe(who === c.admin ? "admin" : "director");
    }
    expect((await c.o.call("placement_one_check", m, w.C.tribe)).who).toBe("owner");
    // the counts and the answers belong to the owner alone
    for (const who of [c.admin, c.director]) {
      await expectCode(c.as(who, "placement_office_counts"), "42501");
      await expectCode(c.as(who, "placement_request_check", c.member), "42501");
      await expectCode(c.as(who, "placement_request_decide", c.member, "approve", [], null), "42501");
    }
    expect(await c.o.call("placement_office_counts")).toMatchObject({ requests_open: 0 });
  });

  it("is switched On by the owner: while Placement is Off or in Rehearsal nobody places, moves or asks", async () => {
    const w = await world(1);
    const m = w.mem[0].id;
    for (const mode of ["rehearsal", "off"]) {
      await c.o.call("placement_settings_save", JSON.stringify({ mode }));
      await expect(place(c.admin, m, w.C.tribe)).rejects.toThrow(/switched On/);
      await expect(move(c.director, m, w.C.tribe)).rejects.toThrow(/switched On/);
      await expect(c.as(c.admin, "placement_office_ask", m, w.C.tribe, [], REASON, false, false)).rejects.toThrow(/switched On/);
    }
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    expect((await c.as(c.admin, "placement_office_tribes")).mode).toBe("on");
  });
});

describe("the check", () => {
  it("gives an admin and a director exactly what it gives the owner, and marks what only the owner may accept", async () => {
    const w = await world(1);
    await started(5);
    const good = w.mem[0].id;
    const asOwner = await c.o.call("placement_one_check", good, w.C.tribe);
    const asAdmin = await c.as(c.admin, "placement_one_check", good, w.C.tribe);
    const asDirector = await c.as(c.director, "placement_one_check", good, w.C.tribe);
    expect(asAdmin.ok).toBe(true);
    expect(asAdmin.warnings).toEqual([]);
    expect({ ...asAdmin, who: "owner" }).toEqual(asOwner);
    expect({ ...asDirector, who: "owner" }).toEqual(asOwner);

    const sunday = await readyMember(c.db, c.k, c.season, `OffSun${tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    let chk = await c.as(c.admin, "placement_one_check", sunday.id, w.C.tribe);
    expect(chk.warnings).toMatchObject([{ code: "no_score", owner_only: true }]);
    chk = await c.o.call("placement_one_check", sunday.id, w.C.tribe);
    expect(chk.warnings).toMatchObject([{ code: "no_score", owner_only: false }]);

    const blank = await c.k.person(`OffBlank${tag}`);
    chk = await c.as(c.director, "placement_one_check", blank.id, w.C.tribe);
    expect(chk.warnings.every((x: { owner_only: boolean }) => x.owner_only)).toBe(true);
    expect(codes(chk)).toEqual(["needs_form", "no_score"]);

    const noc = await readyMember(c.db, c.k, c.season, `OffNoC${tag}`, { times: ["weeknight-evening"], daysAgo: 30, matching: false });
    chk = await c.as(c.admin, "placement_one_check", noc.id, w.C.tribe);
    expect(chk.warnings).toMatchObject([{ code: "no_consent", owner_only: false }]);

    await started(20);
    chk = await c.as(c.admin, "placement_one_check", good, w.C.tribe);
    expect(chk.warnings).toMatchObject([{ code: "after_cutoff", owner_only: false }]);
    await started(-30);
  });

  it("treats a hold the church put there as the office's to accept, and a hold the owner put there as the owner's", async () => {
    const w = await world(1);
    const m = w.mem[0].id;
    const held = async () => (await c.as(c.admin, "placement_one_check", m, w.C.tribe)).warnings.find((x: { code: string }) => x.code === "held");
    await c.sql("delete from public.placement_holds where person_id = $1", [m]);
    await c.sql("insert into public.placement_holds (person_id, source, until) values ($1, 'removal', now() + interval '3 days')", [m]);
    expect(await held()).toMatchObject({ source: "removal", owner_only: false });
    await c.sql("update public.placement_holds set source = 'care', until = null where person_id = $1", [m]);
    expect(await held()).toMatchObject({ source: "care", owner_only: false });
    await c.sql("update public.placement_holds set source = 'owner' where person_id = $1", [m]);
    expect(await held()).toMatchObject({ source: "owner", owner_only: true });
    await c.sql("delete from public.placement_holds where person_id = $1", [m]);
  });

  it("refuses everyone alike at a blocker, and refuses the placer who tries to place themselves", async () => {
    const w = await world(1);
    const m = w.mem[0].id;
    await started(5);
    for (const who of [c.admin, c.director]) {
      const leader = await c.as(who, "placement_one_check", w.C.leader.id, w.C.tribe);
      expect(leader.blockers.map((x: { code: string }) => x.code)).toContain("leader");
      const self = await c.as(who, "placement_one_check", who, w.C.tribe);
      expect(self.blockers.map((x: { code: string }) => x.code)).toContain("self");
      await expect(place(who, w.C.leader.id, w.C.tribe, ["leader"], REASON)).rejects.toThrow(/lead or assist|not a member/);
    }
    await c.sql("update public.tribes set status = 'closed' where id = $1", [w.C.tribe]);
    for (const chk of [await c.as(c.admin, "placement_one_check", m, w.C.tribe), await c.o.call("placement_one_check", m, w.C.tribe)]) {
      expect(chk.blockers.map((x: { code: string }) => x.code)).toContain("tribe_closed");
    }
    await expect(place(c.admin, m, w.C.tribe)).rejects.toThrow(/not open/);
    await c.sql("update public.tribes set status = 'approved' where id = $1", [w.C.tribe]);
    await started(-30);
  });
});

describe("placing one person", () => {
  it("places them as the church does and records who placed them, in what role and by which door", async () => {
    const w = await world(3);
    await started(5);
    const [a, b, d] = w.mem.map((x) => x.id);
    const byAdmin = await place(c.admin, a, w.C.tribe);
    const byDirector = await place(c.director, b, w.C.tribe);
    const byOwner = await ownerPlace(d, w.C.tribe);
    expect([byAdmin.ok, byDirector.ok, byOwner.ok]).toEqual([true, true, true]);

    expect(await runOf(byAdmin.run)).toMatchObject({ single: true, status: "placed", placed_by: c.admin, placed_role: "admin", placed_via: "office", approved_by: null, moved_from: null, pool: 1, rehearsal: false });
    expect(await runOf(byDirector.run)).toMatchObject({ placed_by: c.director, placed_role: "director", placed_via: "office" });
    expect(await runOf(byOwner.run)).toMatchObject({ placed_role: "owner", placed_via: "owner", approved_by: null });
    expect((await runOf(byOwner.run)).placed_by).toBeTruthy();

    const ev = await c.one("select meta from public.event_log where action = 'placement.single' and entity_id = $1", [byAdmin.run]);
    expect(ev.meta).toMatchObject({ by: c.admin, role: "admin", via: "office", move: false });
    await started(-30);
  });

  it("is the same for the member whoever places them, and the same as an automatic run, field by field", async () => {
    const w = await world(1);
    await started(5);
    const auto = w.mem[0].id;
    const run = await placeRun(c.db, c.o, {});
    await markSent(c.db, 30);
    expect((await seatOf(auto)).placed_by_run).toBe(run.run);
    const rest: { id: string }[] = [];
    for (const who of ["a", "b", "c"]) rest.push(await readyMember(c.db, c.k, c.season, `Par${who}${tag}`, { times: ["weeknight-evening"], daysAgo: 30 }));
    await ownerPlace(rest[0].id, w.C.tribe);
    await place(c.admin, rest[1].id, w.C.tribe);
    await place(c.director, rest[2].id, w.C.tribe);

    const shape = async (person: string) => {
      const seat = await seatOf(person);
      const msgs = await c.sql(
        "select template, force_channel, status, (reply_token is not null) as token, (select array_agg(k order by k) from jsonb_object_keys(params) k) as keys from public.messages where person_id = $1 and template like 'placement_%' order by template",
        [person],
      );
      return {
        seat: {
          chosen_rank: seat.chosen_rank, model_version: seat.model_version, agreement_version: seat.agreement_version, covenant: Object.keys(seat.covenant).sort(),
          placement_source: seat.placement_source, contact_withheld: seat.contact_withheld, confirmed: seat.confirmed_at !== null, hasRun: seat.run_id !== null,
          hasPlacedByRun: seat.placed_by_run !== null, firstMeeting: seat.first_meeting_by !== null, degreeSet: seat.degree !== null,
        },
        messages: msgs,
        tokens: (await c.one("select count(*)::int n from public.placement_tokens where person_id = $1", [person])).n,
        matchRuns: (await c.one("select count(*)::int n from public.match_runs where person_id = $1", [person])).n,
        chosen: (await c.one("select count(*)::int n from public.match_recommendations where person_id = $1 and chosen", [person])).n,
        item: (await c.one("select status, moved, override from public.placement_items where placement_id = $1", [seat.id])),
        welcome: (await c.one("select count(*)::int n from public.messages where person_id = $1 and template in ('tribe_welcome', 'member_welcome', 'welcome')", [person])).n,
      };
    };
    const baseline = await shape(auto);
    for (const r of rest) {
      const got = await shape(r.id);
      expect(got.seat).toEqual(baseline.seat);
      expect(got.messages).toEqual(baseline.messages.map((m) => ({ ...m, status: m.status === "sent" ? "queued" : m.status })));
      expect(got.tokens).toBe(baseline.tokens);
      expect(got.matchRuns).toBe(baseline.matchRuns);
      expect(got.chosen).toBe(baseline.chosen);
      expect(got.welcome).toBe(baseline.welcome);
      expect(got.item.status).toBe(baseline.item.status);
    }
    await started(-30);
  });

  it("will not place anyone until each warning is ticked and a reason is given, and not past what only the owner may accept", async () => {
    const w = await world(1);
    await started(5);
    const sunday = await readyMember(c.db, c.k, c.season, `OffSun2${tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    await expect(place(c.admin, sunday.id, w.C.tribe)).rejects.toThrow(/tick/);
    await expect(place(c.admin, sunday.id, w.C.tribe, ["no_score"], REASON)).rejects.toThrow(/Only the owner/);
    expect(await c.sql("select 1 from public.tribe_members where person_id = $1", [sunday.id])).toHaveLength(0);
    // the owner can
    const done = await ownerPlace(sunday.id, w.C.tribe, ["no_score"], REASON);
    expect(done.ok).toBe(true);
    await started(-30);
  });

  it("lets the office accept 'joining has closed' with a reason, and 'they have not agreed to matching' only with the tick that they said so", async () => {
    const w = await world(2);
    await started(20);
    const [a, b] = w.mem.map((x) => x.id);
    await expect(place(c.admin, a, w.C.tribe, ["after_cutoff"], null)).rejects.toThrow(/Say why/);
    const one = await place(c.admin, a, w.C.tribe, ["after_cutoff"], "Moved here last week");
    expect(await runOf(one.run)).toMatchObject({ after_cutoff: true, note: "Moved here last week", placed_by: c.admin });

    const noc = await readyMember(c.db, c.k, c.season, `OffNoC2${tag}`, { times: ["weeknight-evening"], daysAgo: 30, matching: false });
    const all = ["after_cutoff", "no_consent"];
    await expect(place(c.director, noc.id, w.C.tribe, all, "On the phone", false)).rejects.toThrow(/agree/);
    const two = await place(c.director, noc.id, w.C.tribe, all, "On the phone", true);
    const item = await c.one("select agreed, override, override_reason from public.placement_items where run_id = $1", [two.run]);
    expect(item).toMatchObject({ agreed: true, override_reason: "On the phone" });
    expect([...item.override].sort()).toEqual(all);
    // who told, and when, is on the run; it records their word, not the member's agreement
    expect(await runOf(two.run)).toMatchObject({ placed_by: c.director, placed_role: "director" });
    expect((await runOf(two.run)).planned_at).toBeTruthy();
    expect((await c.one("select count(*)::int n from public.consents where person_id = $1 and purpose = 'matching' and granted", [noc.id])).n).toBe(0);
    expect(b).toBeTruthy();
    await started(-30);
  });

  it("places a person the church took out of a tribe, with the hold's warning accepted, and puts the hold back if it is undone", async () => {
    const w = await world(1);
    await started(5);
    const m = w.mem[0].id;
    await c.sql("insert into public.placement_holds (person_id, source, until, note) values ($1, 'care', null, 'kept')", [m]);
    await expect(place(c.admin, m, w.C.tribe)).rejects.toThrow(/tick/);
    const done = await place(c.admin, m, w.C.tribe, ["held"], "Spoke to her; she wants this tribe");
    expect((await runOf(done.run)).held_before).toMatchObject({ source: "care", until: null });
    // the maintenance sweep ends a care hold once the person has a seat
    await c.sql("delete from public.placement_holds where person_id = $1", [m]);
    await c.as(c.director, "placement_undo", done.run);
    expect(await c.sql("select source, until from public.placement_holds where person_id = $1", [m])).toEqual([{ source: "care", until: null }]);
    await c.sql("delete from public.placement_holds where person_id = $1", [m]);
    await started(-30);
  });

  it("will not put a person back in a tribe the church took them out of, from the person page or from the owner's", async () => {
    const w = await world(2);
    await started(5);
    const [a, b] = w.mem.map((x) => x.id);
    // a real removal, the way a leader asks and an admin approves
    await ownerPlace(a, w.C.tribe);
    await c.set("removal_requests", "on", { reason: "Trying removal requests with everyone" });
    const asked = await c.as(w.C.leader.id, "removal_ask", w.C.tribe, a, "repeated_absence", "He has missed five weeks and does not answer calls, and I have asked twice.", true, false);
    await c.as(c.admin, "removal_decide", asked.id, "approve", "Looked at this carefully and agree with the leader.");
    expect(await seatOf(a)).toBeUndefined();
    for (const chk of [
      await c.as(c.admin, "placement_one_check", a, w.C.tribe),
      await c.as(c.director, "placement_one_check", a, w.C.tribe),
      await c.o.call("placement_one_check", a, w.C.tribe),
    ]) {
      expect(chk.blockers.map((x: { code: string }) => x.code)).toContain("removed_from");
    }
    await expect(place(c.admin, a, w.C.tribe, ["no_score", "held"], REASON)).rejects.toThrow(/took them out/);
    await expect(ownerPlace(a, w.C.tribe, ["no_score", "held"], REASON)).rejects.toThrow(/took them out/);
    const list = await c.as(c.admin, "placement_one_options", a);
    expect(list.find((x: { tribe: string }) => x.tribe === w.C.tribe)).toMatchObject({ removed: true });
    // somebody else is not affected
    expect((await place(c.admin, b, w.C.tribe)).ok).toBe(true);
    await started(-30);
  });

  it("limits one person to 30 placements a day, and does not count the owner", async () => {
    const w = await world(2);
    await started(5);
    const [a, b] = w.mem.map((x) => x.id);
    await c.sql(
      `insert into public.placement_runs (season_id, status, phase, single, grace_days, seats_free, min_tribe, pace_per_hour, send_from, send_until, hold_hours, planned_at, placed_by, placed_role, placed_via)
       select $1, 'placed', 'ready', true, 0, 0, 4, 30, 8, 18, 24, now(), $2, 'admin', 'office' from generate_series(1, 30)`,
      [c.season, c.admin],
    );
    await expect(place(c.admin, a, w.C.tribe)).rejects.toThrow(/30 people today/);
    expect((await place(admin2, a, w.C.tribe)).ok).toBe(true);
    expect((await ownerPlace(b, w.C.tribe)).ok).toBe(true);
    await c.sql("delete from public.placement_runs where placed_by = $1 and placed_via = 'office' and status = 'placed' and phase = 'ready' and note is null and pool = 0", [c.admin]);
    await started(-30);
  });
});

describe("one hand at a time", () => {
  /** A second connection, signed in as one person, inside a transaction that is not yet finished. */
  async function hand(uid: string) {
    const cl = new Client({ host: "127.0.0.1", port: inject("pgPort"), user: "postgres", password: "postgres", database: c.db.name });
    await cl.connect();
    await cl.query("begin");
    await cl.query("set local role authenticated");
    await cl.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await cl.query("select set_config('request.jwt.claims', '', true)");
    return cl;
  }
  const attempt = (cl: Client, person: string, tribe: string) =>
    cl.query("select public.placement_one_place($1, $2, '{}'::text[], null, false) as r", [person, tribe]).then(
      (r) => ({ ok: true as const, run: r.rows[0].r.run as string }),
      (e: Error) => ({ ok: false as const, message: e.message }),
    );
  const pause = () => new Promise((r) => setTimeout(r, 400));

  it("gives a person one seat when two people click for them at once, even for two different tribes", async () => {
    const w = await world(1);
    const other = await sister("Twin");
    await started(5);
    const m = w.mem[0].id;
    const one = await hand(c.admin);
    const two = await hand(c.director);
    const first = await attempt(one, m, w.C.tribe);
    expect(first.ok).toBe(true);
    const second = attempt(two, m, other.tribe); // waits for the first to finish
    await pause();
    await one.query("commit");
    const result = await second;
    await two.query("rollback");
    await one.end();
    await two.end();
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/already have a seat/);
    expect(await c.sql("select 1 from public.tribe_members where person_id = $1 and status = 'active'", [m])).toHaveLength(1);
    expect(await c.sql("select 1 from public.placement_runs where single and placed_by in ($1, $2) and status = 'placed' and id in (select run_id from public.placement_items where person_id = $3)", [c.admin, c.director, m])).toHaveLength(1);
    await started(-30);
  });

  it("gives the last seat to one of two people and tells the other, in plain words, that the tribe has just filled up", async () => {
    // eleven seats of twelve are taken, by established believers of every style, so the matching still offers the twelfth
    const w = await world(2);
    for (let i = 0; i < 11; i++) {
      await c.k.seat(w.C.tribe, c.season, `Held${tag}x${i}`, { profile: { faith: "established", social: i === 0 ? -1 : i === 1 ? 1 : 0 } });
    }
    await started(5);
    const [a, b] = w.mem.map((x) => x.id);
    expect((await c.as(c.admin, "placement_one_check", a, w.C.tribe)).warnings).toEqual([]);
    expect((await c.as(c.admin, "placement_one_check", b, w.C.tribe)).warnings).toEqual([]);
    const one = await hand(c.admin);
    const two = await hand(c.director);
    const first = await attempt(one, a, w.C.tribe);
    expect(first.ok).toBe(true);
    const second = attempt(two, b, w.C.tribe); // waits for the tribe
    await pause();
    await one.query("commit");
    const result = await second;
    await two.query("rollback");
    await one.end();
    await two.end();
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/this tribe has just filled up\. Nothing was changed/);
    expect((await c.one("select count(*)::int n from public.tribe_members where tribe_id = $1 and status = 'active'", [w.C.tribe])).n).toBe(12);
    expect(await c.sql("select 1 from public.tribe_members where person_id = $1", [b])).toHaveLength(0);
    expect(await c.sql("select 1 from public.placement_items where person_id = $1", [b])).toHaveLength(0);
    await started(-30);
  });
});

describe("a move", () => {
  async function pair(capacity = 12) {
    const A = await world(1, capacity);
    const B = await sister("Move");
    await started(5);
    const m = A.mem[0].id;
    await ownerPlace(m, A.C.tribe);
    await c.sql("delete from public.messages where template = 'swap_moved'");
    return { A, B, m };
  }

  it("needs a seat to move from, a different tribe, and never takes a tribe the person was removed from", async () => {
    const { A, B, m } = await pair();
    const unseated = await readyMember(c.db, c.k, c.season, `Unseated${tag}`, { times: ["weeknight-evening"], daysAgo: 30 });
    expect((await c.as(c.admin, "placement_move_check", unseated.id, B.tribe)).blockers.map((x: { code: string }) => x.code)).toContain("no_seat");
    expect((await c.as(c.admin, "placement_move_check", m, A.C.tribe)).blockers.map((x: { code: string }) => x.code)).toContain("same_tribe");
    const chk = await c.as(c.admin, "placement_move_check", m, B.tribe);
    expect(chk).toMatchObject({ ok: true, move: true, from: { id: A.C.tribe } });
    // a plain placement is for a person without a seat
    expect((await c.as(c.admin, "placement_one_check", m, B.tribe)).blockers.map((x: { code: string }) => x.code)).toContain("has_seat");
    await expect(place(c.admin, m, B.tribe)).rejects.toThrow(/already have a seat|already has a seat|They already/);
    await expect(move(c.admin, unseated.id, B.tribe)).rejects.toThrow(/do not have a seat/);
    await started(-30);
  });

  it("gives up the old seat, places them in the new tribe like any other, and tells the old leader", async () => {
    const { A, B, m } = await pair();
    const oldSeat = await seatOf(m);
    const done = await move(c.admin, m, B.tribe);
    expect(done).toMatchObject({ ok: true, moved: true });
    expect(await c.one("select status, release_reason from public.tribe_members where id = $1", [oldSeat.id])).toEqual({ status: "released", release_reason: "Moved by the church" });
    const seat = await seatOf(m);
    expect(seat).toMatchObject({ tribe_id: B.tribe, placement_source: "auto", placed_by_run: done.run });
    expect(seat.confirmed_at).toBeNull();
    expect(await runOf(done.run)).toMatchObject({ moved_from: A.C.tribe, moved_from_seat: oldSeat.id, placed_by: c.admin, placed_via: "office" });
    const told = await c.sql("select params from public.messages where template = 'swap_moved' and person_id = $1", [A.C.leader.id]);
    expect(told).toHaveLength(1);
    expect(told[0].params).toMatchObject({ direction: "out" });
    // the member is emailed their new tribe exactly as for any placement, and the new leader's team email is waiting
    expect(await c.sql("select 1 from public.messages where template = 'placement_your_tribe' and person_id = $1 and dedupe_key = $2", [m, `placement:${seat.id}`])).toHaveLength(1);
    expect((await c.one("select count(*)::int n from public.placement_teams where run_id = $1 and tribe_id = $2 and mail_queued_at is null", [done.run, B.tribe])).n).toBe(1);
    await started(-30);
  });

  it("is all or nothing: if the new seat cannot be taken, the old seat is still theirs and nobody is told", async () => {
    const { A, B, m } = await pair();
    await c.sql("create or replace function public.zz_block() returns trigger language plpgsql as $$ begin raise exception 'blocked for the test'; end; $$");
    await c.sql("create trigger zz_block before insert on public.tribe_members for each row when (new.tribe_id = '" + B.tribe + "') execute function public.zz_block()");
    const before = (await c.one("select count(*)::int n from public.placement_runs")).n;
    await expect(move(c.admin, m, B.tribe)).rejects.toThrow(/blocked for the test/);
    await c.sql("drop trigger zz_block on public.tribe_members");
    expect((await seatOf(m)).tribe_id).toBe(A.C.tribe);
    expect((await c.one("select count(*)::int n from public.placement_runs")).n).toBe(before);
    expect(await c.sql("select 1 from public.messages where template = 'swap_moved'")).toHaveLength(0);
    await started(-30);
  });

  it("is undone by putting the old seat back, and the old leader is told; and refused, changing nothing, if the old tribe has filled", async () => {
    const { A, B, m } = await pair(4);
    const oldSeat = await seatOf(m);
    const done = await move(c.admin, m, B.tribe);
    const undone = await c.as(director2, "placement_undo", done.run);
    expect(undone).toMatchObject({ status: "undone", released: 1, restored: true });
    expect((await seatOf(m)).id).toBe(oldSeat.id);
    expect(await c.sql("select params from public.messages where template = 'swap_moved' and person_id = $1 and params->>'direction' = 'in'", [A.C.leader.id])).toHaveLength(1);

    // again, and this time the old tribe fills before the undo
    const again = await move(c.admin, m, B.tribe);
    for (let i = 0; i < 4; i++) await c.k.seat(A.C.tribe, c.season, `Filler${tag}x${i}`);
    await expect(c.as(c.admin, "placement_undo", again.run)).rejects.toThrow(/no room/);
    expect((await seatOf(m)).tribe_id).toBe(B.tribe);
    expect((await runOf(again.run)).status).toBe("placed");
    await started(-30);
  });
});

describe("undo", () => {
  it("is open to the placer, any admin, any director and the owner until the leader is told, and to nobody else", async () => {
    const w = await world(4);
    await started(5);
    const [a, b, d, e] = w.mem.map((x) => x.id);
    const runs = [await place(c.admin, a, w.C.tribe), await place(c.admin, b, w.C.tribe), await place(c.admin, d, w.C.tribe), await place(c.admin, e, w.C.tribe)];
    await expectCode(c.as(coach, "placement_undo", runs[0].run), "42501");
    await expectCode(c.as(a, "placement_undo", runs[0].run), "42501");
    await expectCode(c.as(w.C.leader.id, "placement_undo", runs[0].run), "42501");
    expect(await c.as(c.admin, "placement_undo", runs[0].run)).toMatchObject({ status: "undone", released: 1 });
    expect(await c.as(admin2, "placement_undo", runs[1].run)).toMatchObject({ status: "undone", released: 1 });
    expect(await c.as(c.director, "placement_undo", runs[2].run)).toMatchObject({ status: "undone", released: 1 });
    expect(await c.o.call("placement_undo", runs[3].run)).toMatchObject({ status: "undone", released: 1 });
    expect(await c.sql("select 1 from public.tribe_members where tribe_id = $1 and status = 'active'", [w.C.tribe])).toHaveLength(0);
    await started(-30);
  });

  it("is closed once the leader has been told, and a church-wide run is the owner's alone", async () => {
    const w = await world(2);
    await started(5);
    const [a] = w.mem.map((x) => x.id);
    const one = await place(c.admin, a, w.C.tribe);
    expect((await c.as(c.admin, "placement_office_person", a)).last).toMatchObject({ run: one.run, undoable: true });
    await markSent(c.db, 30);
    expect((await c.one("select public.placement_team_mail($1) as n", [one.run])).n).toBe(1);
    expect((await c.as(c.admin, "placement_office_person", a)).last).toMatchObject({ run: one.run, undoable: false });
    await expect(c.as(c.admin, "placement_undo", one.run)).rejects.toThrow(/no longer be undone|Every leader/);

    const w2 = await world(2);
    const big = await placeRun(c.db, c.o, {});
    await expectCode(c.as(c.admin, "placement_undo", big.run), "42501");
    await expectCode(c.as(c.director, "placement_undo", big.run), "42501");
    expect(w2.mem).toHaveLength(2);
    await started(-30);
  });
});

describe("ask the owner", () => {
  async function sundayCase(capacity = 12) {
    const w = await world(1, capacity);
    await started(5);
    const sunday = await readyMember(c.db, c.k, c.season, `AskSun${++tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    return { w, sunday: sunday.id };
  }
  const ask = (who: string, person: string, tribe: string, accept: string[], reason: string | null = REASON, told = false, mv = false) =>
    c.as(who, "placement_office_ask", person, tribe, accept, reason, told, mv);
  const request = (id: string) => c.one("select * from public.placement_requests where id = $1", [id]);

  it("takes a request only for what the office may not accept, with every warning ticked and a reason", async () => {
    const { w, sunday } = await sundayCase();
    await expect(ask(c.admin, w.mem[0].id, w.C.tribe, [])).rejects.toThrow(/nothing to ask the owner/);
    await expect(ask(c.admin, sunday, w.C.tribe, [])).rejects.toThrow(/tick/);
    await expect(ask(c.admin, sunday, w.C.tribe, ["no_score"], "  ")).rejects.toThrow(/Say why/);
    await expect(ask(c.admin, sunday, w.C.tribe, ["no_score"], "x".repeat(201))).rejects.toThrow(/200/);
    await expect(c.o.call("placement_office_ask", sunday, w.C.tribe, ["no_score"], REASON, false, false)).rejects.toThrow(/place them yourself/);
    const made = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);
    expect(await request(made.request)).toMatchObject({ status: "open", asked_by: c.admin, asked_role: "admin", codes: ["no_score"], reason: REASON, person_id: sunday, tribe_id: w.C.tribe, move: false });
    expect(((await request(made.request)).expires_at as Date).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    // one request about one person at a time, and a blocker is refused outright
    await expect(ask(c.director, sunday, w.C.tribe, ["no_score"])).rejects.toThrow(/already a request/);
    await expect(ask(c.admin, w.C.leader.id, w.C.tribe, [])).rejects.toThrow(/lead or assist|not a member/);
    // the person who asked can take it back
    await expect(c.as(director2, "placement_request_withdraw", made.request)).rejects.toThrow(/No such request/);
    await c.as(c.admin, "placement_request_withdraw", made.request);
    expect((await request(made.request)).status).toBe("withdrawn");
    await started(-30);
  });

  it("asks about 'they have not agreed to matching' along with a warning the office may not accept, only with the tick that they told you so", async () => {
    const w = await world(1);
    await started(5);
    const blank = await c.k.person(`AskBlank${++tag}`);
    await expect(ask(c.admin, blank.id, w.C.tribe, ["needs_form", "no_score"])).resolves.toMatchObject({ ok: true });
    const noc = await readyMember(c.db, c.k, c.season, `AskNoC${tag}`, { times: ["sunday-afternoon"], daysAgo: 30, matching: false });
    await expect(ask(c.director, noc.id, w.C.tribe, ["no_consent", "no_score"], REASON, false)).rejects.toThrow(/agree/);
    const made = await ask(c.director, noc.id, w.C.tribe, ["no_consent", "no_score"], REASON, true);
    expect(await request(made.request)).toMatchObject({ told: true, asked_role: "director" });
    await started(-30);
  });

  it("shows the owner every request and an admin or a director only their own, and counts them on the owner's page", async () => {
    await c.sql("delete from public.placement_requests");
    const { w, sunday } = await sundayCase();
    const other = await readyMember(c.db, c.k, c.season, `AskSun2${tag}`, { times: ["sunday-afternoon"], daysAgo: 30 });
    const mine = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);
    const theirs = await ask(director2, other.id, w.C.tribe, ["no_score"]);
    expect((await c.as(c.admin, "placement_requests_list")).map((r: { id: string }) => r.id)).toEqual([mine.request]);
    expect((await c.as(director2, "placement_requests_list")).map((r: { id: string }) => r.id)).toEqual([theirs.request]);
    expect((await c.as(c.admin, "placement_requests_list", other.id))).toEqual([]);
    const all = await c.o.call("placement_requests_list");
    expect(all.map((r: { id: string }) => r.id).sort()).toEqual([mine.request, theirs.request].sort());
    expect(all.find((r: { id: string }) => r.id === mine.request)).toMatchObject({ status: "open", asked_role: "admin", codes: ["no_score"], reason: REASON, tribe_name: expect.any(String), mine: false });
    expect(await c.o.call("placement_office_counts")).toMatchObject({ requests_open: 2 });
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });

  it("places the person when the owner approves, as the one who asked, and tells the one who asked", async () => {
    await c.sql("delete from public.placement_requests");
    await c.noticesOn();
    const { w, sunday } = await sundayCase();
    const made = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);
    const look = await c.o.call("placement_request_check", made.request);
    expect(look).toMatchObject({ status: "open" });
    expect(codes(look.check)).toEqual(["no_score"]);
    await expectCode(c.o.call("placement_request_decide", made.request, "maybe", [], null), "22023");
    await expect(c.o.call("placement_request_decide", made.request, "approve", [], null)).rejects.toThrow(/tick/);
    const done = await c.o.call("placement_request_decide", made.request, "approve", ["no_score"], "Fine");
    expect(done).toMatchObject({ ok: true, approved: true });
    expect(await request(made.request)).toMatchObject({ status: "approved", decision_note: "Fine", run_id: done.run });
    expect(await runOf(done.run)).toMatchObject({ placed_by: c.admin, placed_role: "admin", placed_via: "office", note: REASON });
    expect((await runOf(done.run)).approved_by).toBeTruthy();
    expect((await seatOf(sunday)).tribe_id).toBe(w.C.tribe);
    const note = await c.sql("select kind from public.notice_items where person_id = $1 and event = $2", [c.admin, `placement-request:${made.request}`]);
    expect(note).toEqual([{ kind: "admin_placement_answer" }]);
    await expect(c.o.call("placement_request_decide", made.request, "approve", ["no_score"], null)).rejects.toThrow(/already been answered/);
    await started(-30);
  });

  it("tells the one who asked when the owner declines, and places nobody", async () => {
    await c.sql("delete from public.placement_requests");
    const { w, sunday } = await sundayCase();
    const made = await ask(c.director, sunday, w.C.tribe, ["no_score"]);
    const done = await c.o.call("placement_request_decide", made.request, "decline", [], "Not this one");
    expect(done).toMatchObject({ ok: true, approved: false });
    expect(await request(made.request)).toMatchObject({ status: "declined", decision_note: "Not this one", run_id: null });
    expect(await c.sql("select 1 from public.tribe_members where person_id = $1", [sunday])).toHaveLength(0);
    expect((await c.as(c.director, "placement_requests_list"))[0]).toMatchObject({ status: "declined", decision_note: "Not this one" });
    // a declined request does not stop a new one
    expect((await ask(c.director, sunday, w.C.tribe, ["no_score"])).ok).toBe(true);
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });

  it("lapses after 7 days: it cannot be approved, it shows as lapsed, and a new request replaces it", async () => {
    await c.sql("delete from public.placement_requests");
    const { w, sunday } = await sundayCase();
    const made = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);
    await c.sql("update public.placement_requests set expires_at = now() - interval '1 minute' where id = $1", [made.request]);
    expect((await c.as(c.admin, "placement_requests_list"))[0]).toMatchObject({ id: made.request, status: "lapsed" });
    expect(await c.o.call("placement_office_counts")).toMatchObject({ requests_open: 0 });
    await expect(c.o.call("placement_request_decide", made.request, "approve", ["no_score"], null)).rejects.toThrow(/lapsed/);
    expect((await c.o.call("placement_request_check", made.request)).status).toBe("lapsed");
    const again = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);
    expect((await request(made.request)).status).toBe("lapsed");
    expect((await request(again.request)).status).toBe("open");
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });

  it("runs every check again at approval: a closed tribe, a full tribe and a person who has joined another tribe all stop it, and the request stays open", async () => {
    await c.sql("delete from public.placement_requests");
    const { w, sunday } = await sundayCase(4);
    const made = await ask(c.admin, sunday, w.C.tribe, ["no_score"]);

    await c.sql("update public.tribes set status = 'closed' where id = $1", [w.C.tribe]);
    await expect(c.o.call("placement_request_decide", made.request, "approve", ["no_score"], null)).rejects.toThrow(/not open/);
    await c.sql("update public.tribes set status = 'approved' where id = $1", [w.C.tribe]);

    for (let i = 0; i < 4; i++) await c.k.seat(w.C.tribe, c.season, `Fill${tag}x${i}`);
    await expect(c.o.call("placement_request_decide", made.request, "approve", ["no_score"], null)).rejects.toThrow(/This tribe is full \(4 of 4\)/);
    expect(codes((await c.o.call("placement_request_check", made.request)).check)).toEqual(expect.arrayContaining(["full"]));
    await c.sql("update public.tribe_members set status = 'released', released_at = now() where tribe_id = $1 and status = 'active'", [w.C.tribe]);

    const elsewhere = await sister("Elsewhere");
    await ownerPlace(sunday, elsewhere.tribe, ["no_score"], REASON);
    await expect(c.o.call("placement_request_decide", made.request, "approve", ["no_score"], null)).rejects.toThrow(/already have a seat/);
    expect((await request(made.request)).status).toBe("open");
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });

  it("is at most 10 open requests for one person", async () => {
    await c.sql("delete from public.placement_requests");
    const w = await world(1);
    await started(5);
    for (let i = 0; i < 10; i++) {
      const p = await readyMember(c.db, c.k, c.season, `Bulk${tag}x${i}`, { times: ["sunday-afternoon"], daysAgo: 30 });
      expect((await ask(c.admin, p.id, w.C.tribe, ["no_score"])).ok).toBe(true);
    }
    const p = await readyMember(c.db, c.k, c.season, `Bulk${tag}x11`, { times: ["sunday-afternoon"], daysAgo: 30 });
    await expect(ask(c.admin, p.id, w.C.tribe, ["no_score"])).rejects.toThrow(/10 requests/);
    expect((await ask(c.director, p.id, w.C.tribe, ["no_score"])).ok).toBe(true);
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });

  it("can be asked for a move, and the move is made on approval", async () => {
    await c.sql("delete from public.placement_requests");
    const A = await world(1);
    const B = await sister("AskMove");
    await started(5);
    const m = A.mem[0].id;
    await ownerPlace(m, A.C.tribe);
    // a tribe for a different age group is the owner's to allow
    await c.sql("update public.tribes set track_id = (select id from public.tracks where slug = 'stewards') where id = $1", [B.tribe]);
    const chk = await c.as(c.admin, "placement_move_check", m, B.tribe);
    const owner = chk.warnings.filter((x: { owner_only: boolean }) => x.owner_only).map((x: { code: string }) => x.code);
    expect(owner.length).toBeGreaterThan(0);
    await expect(move(c.admin, m, B.tribe, codes(chk), REASON)).rejects.toThrow(/Only the owner/);
    const made = await ask(c.admin, m, B.tribe, codes(chk), REASON, false, true);
    expect(await request(made.request)).toMatchObject({ move: true });
    const done = await c.o.call("placement_request_decide", made.request, "approve", codes(chk), null);
    expect(await runOf(done.run)).toMatchObject({ moved_from: A.C.tribe, placed_by: c.admin });
    expect((await seatOf(m)).tribe_id).toBe(B.tribe);
    await c.sql("delete from public.placement_requests");
    await started(-30);
  });
});

describe("finding a member and the office pages", () => {
  it("finds a member by name, e-mail or number, and shows where they sit", async () => {
    const w = await world(1);
    await started(5);
    const named = await readyMember(c.db, c.k, c.season, `Zephaniah${tag}`, { times: ["weeknight-evening"], daysAgo: 30, whatsapp: "+2348031234567" });
    await place(c.admin, named.id, w.C.tribe);
    for (const q of [`zephaniah${tag}`, `ZEPHANIAH${tag}`.slice(0, 6), "0803 123 4567", "+234 803 123 4567"]) {
      const found = await c.as(c.admin, "placement_find", q);
      const hit = found.find((x: { id: string }) => x.id === named.id);
      expect(hit, q).toMatchObject({ tribe: expect.any(String), has_form: true, leads: false });
    }
    const byMail = await c.as(c.director, "placement_find", (await c.one("select email from public.people where id = $1", [named.id])).email.slice(0, 12));
    expect(byMail.map((x: { id: string }) => x.id)).toContain(named.id);
    // too short a search finds nothing, a leader is marked, and staff who are not members are not offered
    expect(await c.as(c.admin, "placement_find", "z")).toEqual([]);
    expect(await c.as(c.admin, "placement_find", "   ")).toEqual([]);
    const lead = await c.as(c.admin, "placement_find", "Leader");
    expect(lead.filter((x: { leads: boolean }) => x.leads).length).toBeGreaterThan(0);
    expect(JSON.stringify(await c.as(c.admin, "placement_find", "Zephaniah"))).not.toMatch(/2348031234567/);
    await started(-30);
  });

  it("describes one person, one tribe and the tribes of the season", async () => {
    const w = await world(2);
    await started(5);
    const [a, b] = w.mem.map((x) => x.id);
    const done = await place(c.director, a, w.C.tribe);
    const person = await c.as(c.admin, "placement_office_person", a);
    expect(person).toMatchObject({ mode: "on", role: "admin", member: true, leads: false, form: true, seat: { tribe: w.C.tribe }, last: { run: done.run, undoable: true, moved: false } });
    expect(person.person.email).toContain("@");
    expect(await c.as(c.admin, "placement_office_person", b)).toMatchObject({ seat: null, last: null, member: true });
    const tribe = await c.as(c.director, "placement_office_tribe", w.C.tribe);
    expect(tribe).toMatchObject({ role: "director", tribe: { id: w.C.tribe, active: 1, capacity: 12, open: true } });
    expect(tribe.recent).toMatchObject([{ run: done.run, person: a, undoable: true }]);
    const tribes = await c.as(c.admin, "placement_office_tribes");
    expect(tribes.tribes.map((x: { id: string }) => x.id)).toContain(w.C.tribe);
    await expectCode(c.as(c.admin, "placement_office_person", NOBODY), "P0002");
    await started(-30);
  });

  it("shows the owner, by person, what the office has placed and moved and how many it undid", async () => {
    const w = await world(3);
    const adminThree = (await c.k.staff("AdminThree", "admin")).id;
    const directorThree = (await c.k.staff("DirectorThree", "director")).id;
    await started(5);
    const [a, b, d] = w.mem.map((x) => x.id);
    const r1 = await place(adminThree, a, w.C.tribe);
    await place(adminThree, b, w.C.tribe);
    await place(directorThree, d, w.C.tribe);
    await c.as(adminThree, "placement_undo", r1.run);
    const counts = await c.o.call("placement_office_counts");
    const row = (name: string) => counts.by_person.find((x: { name: string }) => x.name.startsWith(name));
    expect(row("AdminThree")).toMatchObject({ role: "admin", placed: 1, moved: 0, undone: 1, today: 2 });
    expect(row("DirectorThree")).toMatchObject({ role: "director", placed: 1, undone: 0, today: 1 });
    await started(-30);
  });
});
