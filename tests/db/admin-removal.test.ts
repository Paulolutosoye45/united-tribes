import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// Remove a member from a tribe, from Admin (Package 5b). What these prove:
//   * only the owner, an admin and a director can remove, put back or read the lists; nobody else, and nobody signed out
//   * Remove needs a reason of 10 to 300 characters, releases the seat, sends the member back to the pile (a three-day hold, the match looked at afresh),
//     blocks that tribe for them, tells the member kindly (no appeal) and the leader (first name only), and keeps the reason out of every message and the log
//   * a young person, a member with an open care matter, yourself, a seat that is already gone and a closed season are refused in plain words; 20 a day
//     is the most an admin or a director removes, the owner is not held to it, and two clicks remove one person once
//   * Put back works for 14 days, only when the tribe is open and has room and the person has not joined another, and undoes the block and the hold
//   * the reason is cleared after 12 months, and the leader's removal requests are not touched

let c: Cast;
let n = 0;
let careLead: string;
let coach: string;
let token: string;

beforeAll(async () => {
  c = await makeCast();
  careLead = (await c.k.staff("CareLead", "care_lead")).id;
  coach = (await c.k.staff("Coach", "coach")).id;
  token = (await c.one("select public.bootstrap_worker_token('test-admin-removal') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("delete from public.messages");
  await c.sql("delete from public.placement_holds");
  await c.sql("delete from public.admin_removals");
  await c.sql("delete from public.removal_blocks");
});

const WHY = "Moved away from Lagos and asked to step back";
type Fresh = { leader: string; tribe: string; members: string[] };

/** A tribe with a leader and two seated members. */
async function fresh(over: { capacity?: number; seats?: number } = {}): Promise<Fresh> {
  const t = await c.k.tribe(c.season, { name: `Remove ${++n}`, track: "builders", capacity: over.capacity ?? 12 });
  const members: string[] = [];
  for (let i = 0; i < (over.seats ?? 2); i++) members.push((await c.k.seat(t.tribe, c.season, `Seated${++n}`)).id);
  await c.sql("delete from public.messages");
  return { leader: t.leader.id, tribe: t.tribe, members };
}

const remove = (who: string, f: Fresh, person = f.members[0], reason: string | null = WHY) => c.as(who, "admin_remove_member", f.tribe, person, reason);
const putBack = (who: string, id: string) => c.as(who, "admin_put_back", id);
const seat = async (person: string, tribe: string) => c.one("select status, release_reason, released_at from public.tribe_members where person_id = $1 and tribe_id = $2", [person, tribe]);
const row = async (id: string) => c.one("select * from public.admin_removals where id = $1", [id]);
const mails = (template: string, person?: string) =>
  c.sql("select person_id, params, force_channel, channel, dedupe_key from public.messages where template = $1 and ($2::uuid is null or person_id = $2) order by created_at", [template, person ?? null]);
const candidates = async (person: string) => (await c.sql("select r_tribe from public.match_candidates($1)", [person])).map((r) => r.r_tribe as string);
const blocks = (person: string, tribe: string) => c.sql("select * from public.removal_blocks where person_id = $1 and tribe_id = $2", [person, tribe]);
const hold = async (person: string) => (await c.sql("select * from public.placement_holds where person_id = $1", [person]))[0];

describe("who may use it", () => {
  it("is the owner, an admin and a director; nobody else, and nobody signed out", async () => {
    const f = await fresh();
    const calls: [string, unknown[]][] = [
      ["admin_remove_member", [f.tribe, f.members[0], WHY]],
      ["admin_put_back", [NOBODY]],
      ["admin_tribe_members", [f.tribe]],
      ["admin_removal_person", [f.members[0]]],
    ];
    for (const who of [c.pastor, coach, careLead, f.members[1], f.leader, c.member]) {
      for (const [fn, args] of calls) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of calls) await expectCode(c.anon(fn, ...args), "42501");
    expect(await c.sql("select 1 from public.admin_removals")).toHaveLength(0);
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");

    expect((await c.as(c.admin, "admin_tribe_members", f.tribe)).role).toBe("admin");
    expect((await c.as(c.director, "admin_tribe_members", f.tribe)).role).toBe("director");
    expect((await c.o.call("admin_tribe_members", f.tribe)).role).toBe("owner");
    expect((await c.as(c.admin, "admin_removal_person", f.members[0])).seat).toMatchObject({ tribe: f.tribe, self: false, care_only: false });
  });

  it("keeps its helper functions out of everyone's reach", async () => {
    await expectCode(c.as(c.admin, "admin_removal_tidy"), "42501");
    await expectCode(c.anon("admin_removal_tidy"), "42501");
    await expectCode(c.as(c.admin, "admin_removal_lately", null, null), "42501");
    await expectCode(c.anon("admin_removal_lately", null, null), "42501");
  });
});

describe("Remove", () => {
  it("releases the seat, blocks that tribe for them, puts them in the pile with a three-day hold, and keeps who and why for the office", async () => {
    const f = await fresh();
    const m = f.members[0];
    expect(await candidates(m)).toContain(f.tribe);
    const r = await remove(c.admin, f);
    expect(r).toMatchObject({ ok: true });
    expect(r.until).toBeTruthy();

    expect(await seat(m, f.tribe)).toMatchObject({ status: "released", release_reason: "Removed by the church" });
    expect((await seat(f.members[1], f.tribe)).status).toBe("active");
    const rec = await row(r.removal);
    expect(rec).toMatchObject({ tribe_id: f.tribe, person_id: m, removed_by: c.admin, removed_role: "admin", reason: WHY, member_told: true, put_back_at: null });
    const b = await blocks(m, f.tribe);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ admin_removal_id: r.removal, request_id: null, lifted_at: null });

    // The pile: a hold of three days that belongs to the removal, and the tribe is never offered again
    const h = await hold(m);
    expect(h).toMatchObject({ source: "removal", request_id: r.removal, note: null });
    const days = (await c.one("select extract(epoch from ($1::timestamptz - now())) / 86400 as d", [h.until])).d;
    expect(Number(days)).toBeGreaterThan(2.9);
    expect(Number(days)).toBeLessThan(3.1);
    expect(await candidates(m)).not.toContain(f.tribe);
    expect(await candidates(f.members[1])).toContain(f.tribe);
    const view = await c.as(m, "match_me", true);
    expect(view.tribes.map((t: { tribe: { id: string } }) => t.tribe.id)).not.toContain(f.tribe);
  });

  it("tells the member kindly with no appeal, and the leader by first name, and never the reason", async () => {
    const f = await fresh();
    const r = await remove(c.director, f);
    const told = await mails("removal_member_told", f.members[0]);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ force_channel: "email", dedupe_key: `adminremoval:${r.removal}:member` });
    expect(told[0].params).toMatchObject({ appeal_days: 0, contact_first: "CareLead" });
    expect(told[0].params.tribe).toMatch(/^Remove \d+$/);
    const lead = await mails("removal_leader_decided", f.leader);
    expect(lead).toHaveLength(1);
    expect(lead[0]).toMatchObject({ dedupe_key: `adminremoval:${r.removal}:leader`, force_channel: "email" });
    expect(lead[0].params).toMatchObject({ decision: "removed" });
    expect(lead[0].params.member_first).toMatch(/^Seated/);
    // no one else is written to
    expect(await c.sql("select 1 from public.messages")).toHaveLength(2);
    // the reason is in neither message and not in the event log; the log keeps the fact and the role, never a name or a word
    expect(JSON.stringify(await c.sql("select params from public.messages"))).not.toContain("Lagos");
    const events = await c.sql("select actor_id, action, entity, meta from public.event_log where action = 'removal.admin' and entity_id = $1", [r.removal]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: c.director, entity: "admin_removal", meta: { role: "director" } });
    expect(JSON.stringify(events)).not.toMatch(/Lagos|Seated/);
  });

  it("works for the owner too, recorded as the owner, with no name in the visible log", async () => {
    const f = await fresh();
    const r = await c.o.call("admin_remove_member", f.tribe, f.members[0], WHY);
    expect(r).toMatchObject({ ok: true });
    expect((await row(r.removal)).removed_role).toBe("owner");
    expect((await seat(f.members[0], f.tribe)).status).toBe("released");
  });

  it("needs a reason of 10 to 300 characters, and changes nothing without one", async () => {
    const f = await fresh();
    for (const reason of [null, "", "   ", "too short", "x".repeat(301)]) await expectCode(remove(c.admin, f, f.members[0], reason), "22023");
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    expect(await c.sql("select 1 from public.admin_removals")).toHaveLength(0);
    expect(await c.sql("select 1 from public.messages")).toHaveLength(0);
    expect(await hold(f.members[0])).toBeUndefined();
    // the edges are allowed, and the reason is trimmed
    const r = await remove(c.admin, f, f.members[0], `  ${"y".repeat(300)}  `);
    expect((await row(r.removal)).reason).toBe("y".repeat(300));
    const g = await fresh();
    expect(await remove(c.admin, g, g.members[0], "1234567890")).toMatchObject({ ok: true });
  });

  it("leaves everything the member wrote or agreed to exactly as it was", async () => {
    const f = await fresh();
    const m = f.members[0];
    const before = {
      profile: (await c.one("select count(*)::int n from public.member_profiles where person_id = $1", [m])).n,
      consents: (await c.one("select count(*)::int n from public.consents where person_id = $1", [m])).n,
      people: (await c.one("select count(*)::int n from public.people")).n,
      roles: (await c.one("select count(*)::int n from public.person_roles where person_id = $1", [m])).n,
    };
    await remove(c.admin, f);
    expect({
      profile: (await c.one("select count(*)::int n from public.member_profiles where person_id = $1", [m])).n,
      consents: (await c.one("select count(*)::int n from public.consents where person_id = $1", [m])).n,
      people: (await c.one("select count(*)::int n from public.people")).n,
      roles: (await c.one("select count(*)::int n from public.person_roles where person_id = $1", [m])).n,
    }).toEqual(before);
  });

  it("puts the removed member on the leader's list of people to take out of the WhatsApp group, without the reason", async () => {
    const f = await fresh();
    await c.sql("update public.tribe_members set confirmed_at = now() where tribe_id = $1", [f.tribe]);
    await remove(c.admin, f);
    const list = await c.as(f.leader, "tribe_group_list", f.tribe);
    expect(list.remove.map((x: { person_id: string }) => x.person_id)).toEqual([f.members[0]]);
    expect(JSON.stringify(list)).not.toContain("Lagos");
  });

  it("is placed by hand at once: the office can put the removed member in another tribe, accepting the hold the church made", async () => {
    const f = await fresh();
    const g = await fresh();
    await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    await remove(c.admin, f);
    const chk = await c.as(c.admin, "placement_one_check", f.members[0], g.tribe);
    expect(chk.blockers.map((b: { code: string }) => b.code)).toEqual([]);
    expect(chk.warnings.find((w: { code: string }) => w.code === "held")).toMatchObject({ source: "removal" });
    // and the tribe they were taken out of stays closed to them
    const back = await c.as(c.admin, "placement_one_check", f.members[0], f.tribe);
    expect(back.blockers.map((b: { code: string }) => b.code)).toContain("removed_from");
  });

  it("leaves a hold the owner put there as the owner's", async () => {
    const f = await fresh();
    await c.sql("insert into public.placement_holds (person_id, note, source) values ($1, 'owner note', 'owner')", [f.members[0]]);
    await remove(c.admin, f);
    expect(await hold(f.members[0])).toMatchObject({ source: "owner", note: "owner note" });
  });

  it("does not run twice when two hands click together: the second waits, then finds the seat gone", async () => {
    const f = await fresh();
    const m = f.members[0];
    const hand = async (uid: string) => {
      const cl = new Client({ host: "127.0.0.1", port: inject("pgPort"), user: "postgres", password: "postgres", database: c.db.name });
      await cl.connect();
      await cl.query("begin");
      await cl.query("set local role authenticated");
      await cl.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      await cl.query("select set_config('request.jwt.claims', '', true)");
      return cl;
    };
    const attempt = (cl: Client) =>
      cl.query("select public.admin_remove_member($1, $2, $3) as r", [f.tribe, m, WHY]).then(
        () => ({ ok: true as const, message: "" }),
        (e: Error) => ({ ok: false as const, message: e.message }),
      );
    const one = await hand(c.admin);
    const two = await hand(c.director);
    expect((await attempt(one)).ok).toBe(true);
    const second = attempt(two); // waits for the first to finish
    await new Promise((r) => setTimeout(r, 400));
    await one.query("commit");
    const result = await second;
    await two.query("rollback");
    await one.end();
    await two.end();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not in this tribe any more/);
    expect(await c.sql("select 1 from public.admin_removals")).toHaveLength(1);
    expect(await mails("removal_member_told")).toHaveLength(1);
    expect(await mails("removal_leader_decided")).toHaveLength(1);
  });
});

describe("what it refuses", () => {
  it("a person who is not in that tribe, and a tribe that does not exist", async () => {
    const f = await fresh();
    const g = await fresh();
    await expect(remove(c.admin, f, g.members[0])).rejects.toThrow(/not in this tribe any more/);
    await expect(c.as(c.admin, "admin_remove_member", NOBODY, f.members[0], WHY)).rejects.toThrow(/No such tribe/);
    await remove(c.admin, f);
    await expect(remove(c.admin, f)).rejects.toThrow(/not in this tribe any more/);
  });

  it("a young person: only the Care Lead's own route changes that place", async () => {
    const f = await fresh();
    await c.db.admin.query("begin");
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [f.members[0]]);
    await c.db.admin.query("commit");
    await expect(remove(c.admin, f)).rejects.toThrow(/only through the Care Lead/);
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    expect((await c.as(c.admin, "admin_tribe_members", f.tribe)).members.find((m: { person: string }) => m.person === f.members[0])).toMatchObject({ care_only: true });
    expect((await c.as(c.admin, "admin_removal_person", f.members[0])).seat).toMatchObject({ care_only: true });
  });

  it("a member with an open care matter in that tribe, until it is closed", async () => {
    const f = await fresh();
    await c.sql("insert into public.care_flags (tribe_id, person_id, kind, status) values ($1, $2, 'missed_twice', 'open')", [f.tribe, f.members[0]]);
    await expect(remove(c.admin, f)).rejects.toThrow(/only through the Care Lead/);
    // the other member of the same tribe is not affected
    expect(await remove(c.admin, f, f.members[1])).toMatchObject({ ok: true });
    await c.sql("update public.care_flags set status = 'closed' where tribe_id = $1", [f.tribe]);
    expect(await remove(c.admin, f)).toMatchObject({ ok: true });
  });

  it("yourself", async () => {
    const f = await fresh();
    await c.sql("insert into public.person_roles (person_id, centre_id, role) select id, centre_id, 'admin' from public.people where id = $1", [f.members[0]]);
    await expect(remove(f.members[0], f)).rejects.toThrow(/cannot take yourself out/);
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    expect((await c.as(f.members[0], "admin_tribe_members", f.tribe)).members.find((m: { person: string }) => m.person === f.members[0])).toMatchObject({ self: true });
    // another admin can
    expect(await remove(c.admin, f)).toMatchObject({ ok: true });
  });

  it("a season that is closed", async () => {
    const f = await fresh();
    const was = (await c.one("select status from public.seasons where id = $1", [c.season])).status;
    await c.sql("update public.seasons set status = 'closed' where id = $1", [c.season]);
    try {
      await expect(remove(c.admin, f)).rejects.toThrow(/season is closed/);
    } finally {
      await c.sql("update public.seasons set status = $2 where id = $1", [c.season, was]);
    }
  });

  it("more than 20 in a day for an admin or a director, counted for each person; the owner is not held to it", async () => {
    const f = await fresh({ seats: 3 });
    const first = await remove(c.admin, f, f.members[0]);
    // 19 more, as if they had been made today (the table's own rows are what is counted)
    for (let i = 0; i < 19; i++) {
      await c.sql(
        "insert into public.admin_removals (seat_id, tribe_id, person_id, removed_by, removed_role, reason) select seat_id, tribe_id, person_id, removed_by, removed_role, reason from public.admin_removals where id = $1",
        [first.removal],
      );
    }
    await expect(remove(c.admin, f, f.members[1])).rejects.toThrow(/20 people out of tribes today/);
    expect((await seat(f.members[1], f.tribe)).status).toBe("active");
    // another admin or a director has their own count, and so has the owner's door
    expect(await remove(c.director, f, f.members[1])).toMatchObject({ ok: true });
    expect(await c.o.call("admin_remove_member", f.tribe, f.members[2], WHY)).toMatchObject({ ok: true });
    // a removal made yesterday does not count today
    await c.sql("update public.admin_removals set created_at = now() - interval '2 days' where removed_by = $1", [c.admin]);
    const g = await fresh();
    expect(await remove(c.admin, g)).toMatchObject({ ok: true });
  });
});

describe("the lists the pages read", () => {
  it("shows a tribe's members and what the office took out of it, with the reason, to the office only", async () => {
    const f = await fresh({ seats: 3 });
    const r = await remove(c.admin, f, f.members[2]);
    const view = await c.as(c.director, "admin_tribe_members", f.tribe);
    expect(view.members.map((m: { person: string }) => m.person).sort()).toEqual([f.members[0], f.members[1]].sort());
    expect(view.members[0]).toMatchObject({ care_only: false, self: false });
    expect(view.lately).toHaveLength(1);
    expect(view.lately[0]).toMatchObject({ id: r.removal, person: f.members[2], tribe: f.tribe, reason: WHY, put_back_at: null, can_put_back: true });
    const person = await c.as(c.admin, "admin_removal_person", f.members[2]);
    expect(person.seat).toBeNull();
    expect(person.lately.map((x: { id: string }) => x.id)).toEqual([r.removal]);
    // an older removal is not listed
    await c.sql("update public.admin_removals set created_at = now() - interval '31 days' where id = $1", [r.removal]);
    expect((await c.as(c.admin, "admin_tribe_members", f.tribe)).lately).toEqual([]);
  });
});

describe("Put back", () => {
  it("returns the seat, lifts the block and the hold, and tells the member and the leader", async () => {
    const f = await fresh();
    const m = f.members[0];
    const r = await remove(c.admin, f);
    await c.sql("delete from public.messages");
    const back = await putBack(c.director, r.removal);
    expect(back).toMatchObject({ ok: true });
    expect(await seat(m, f.tribe)).toMatchObject({ status: "active", release_reason: null, released_at: null });
    expect((await blocks(m, f.tribe))[0].lifted_at).not.toBeNull();
    expect(await hold(m)).toBeUndefined();
    expect(await row(r.removal)).toMatchObject({ put_back_by: c.director });
    expect((await row(r.removal)).put_back_at).not.toBeNull();
    expect(await candidates(m)).toContain(f.tribe);
    const told = await mails("removal_member_reinstated", m);
    expect(told).toHaveLength(1);
    expect(told[0].dedupe_key).toBe(`adminremoval:${r.removal}:back:member`);
    const lead = await mails("removal_leader_decided", f.leader);
    expect(lead).toHaveLength(1);
    expect(lead[0].params).toMatchObject({ decision: "reinstated" });
    expect((await c.as(c.admin, "admin_tribe_members", f.tribe)).lately[0]).toMatchObject({ can_put_back: false });
    expect((await c.as(c.admin, "admin_tribe_members", f.tribe)).members.map((x: { person: string }) => x.person)).toContain(m);
    // once only
    await expect(putBack(c.admin, r.removal)).rejects.toThrow(/put back already/);
  });

  it("is open to the owner, any admin and any director, and to no one else", async () => {
    const f = await fresh();
    const r = await remove(c.admin, f);
    for (const who of [c.pastor, coach, careLead, f.leader, f.members[1]]) await expectCode(putBack(who, r.removal), "42501");
    await expectCode(c.anon("admin_put_back", r.removal), "42501");
    expect((await seat(f.members[0], f.tribe)).status).toBe("released");
    expect(await c.o.call("admin_put_back", r.removal)).toMatchObject({ ok: true });
  });

  it("stops after 14 days", async () => {
    const f = await fresh();
    const r = await remove(c.admin, f);
    await c.sql("update public.admin_removals set created_at = now() - interval '15 days' where id = $1", [r.removal]);
    await expect(putBack(c.admin, r.removal)).rejects.toThrow(/more than 14 days/);
    expect((await seat(f.members[0], f.tribe)).status).toBe("released");
    await expect(putBack(c.admin, NOBODY)).rejects.toThrow(/does not exist/);
  });

  it("will not squeeze into a full tribe, a closed tribe, or over a seat they have taken elsewhere", async () => {
    const f = await fresh({ capacity: 4, seats: 4 });
    const r = await remove(c.admin, f);
    // the freed seat is taken by someone else
    const other = await c.k.seat(f.tribe, c.season, "Newcomer");
    await expect(putBack(c.admin, r.removal)).rejects.toThrow(/tribe is full/);
    await c.sql("update public.tribe_members set status = 'released' where person_id = $1", [other.id]);

    await c.sql("update public.tribes set status = 'closed' where id = $1", [f.tribe]);
    await expect(putBack(c.admin, r.removal)).rejects.toThrow(/not open any more/);
    await c.sql("update public.tribes set status = 'approved' where id = $1", [f.tribe]);

    const g = await fresh();
    await c.sql("insert into public.tribe_members (tribe_id, person_id, season_id, agreement_version, covenant, first_meeting_by) select $1, $2, $3, agreement_version, covenant, first_meeting_by from public.tribe_members where person_id = $4 and tribe_id = $5 limit 1", [g.tribe, f.members[0], c.season, g.members[0], g.tribe]);
    await expect(putBack(c.admin, r.removal)).rejects.toThrow(/joined another tribe/);
    expect((await seat(f.members[0], f.tribe)).status).toBe("released");
    expect(await hold(f.members[0])).toBeDefined();
    expect((await blocks(f.members[0], f.tribe))[0].lifted_at).toBeNull();
  });
});

describe("keeping the reason", () => {
  it("clears it after 12 months and keeps the fact, from the heartbeat's own round", async () => {
    const f = await fresh();
    const r = await remove(c.admin, f);
    await c.sql("update public.admin_removals set created_at = now() - interval '11 months' where id = $1", [r.removal]);
    await c.anon("worker_removal_tick", token);
    expect((await row(r.removal)).reason).toBe(WHY);
    await c.sql("update public.admin_removals set created_at = now() - interval '13 months' where id = $1", [r.removal]);
    await c.anon("worker_removal_tick", token);
    expect(await row(r.removal)).toMatchObject({ reason: null, tribe_id: f.tribe, person_id: f.members[0], removed_by: c.admin });
    expect((await row(r.removal)).reason_cleared_at).not.toBeNull();
    await expectCode(c.anon("worker_removal_tick", "x".repeat(40)), "42501");
  });

  it("ends the three-day hold by the heartbeat like any other removal hold", async () => {
    const f = await fresh();
    await remove(c.admin, f);
    await c.sql("update public.placement_holds set until = now() - interval '1 minute' where person_id = $1", [f.members[0]]);
    await c.anon("worker_removal_tick", token);
    expect(await hold(f.members[0])).toBeUndefined();
  });
});

describe("the leader's removal requests", () => {
  it("still work beside it: their blocks are untouched and a request's block is still one per request", async () => {
    await c.set("removal_requests", "on", { reason: "Trying removal requests with everyone" });
    const f = await fresh();
    await c.sql("update public.tribes set coach_id = $2 where id = $1", [f.tribe, coach]);
    const ask = await c.as(f.leader, "removal_ask", f.tribe, f.members[0], "other", "He has missed many weeks and does not answer our calls.", true, false);
    await c.as(careLead, "removal_decide", ask.id, "approve", "Looked at this carefully and agree with the leader.");
    const asked = await c.sql("select request_id, admin_removal_id from public.removal_blocks where person_id = $1 and tribe_id = $2", [f.members[0], f.tribe]);
    expect(asked).toEqual([{ request_id: ask.id, admin_removal_id: null }]);
    // the office removes the other one at the same time; the two kinds of block live in the same table without touching each other
    const r = await remove(c.admin, f, f.members[1]);
    expect(await c.sql("select request_id, admin_removal_id from public.removal_blocks order by created_at")).toHaveLength(2);
    expect(await blocks(f.members[1], f.tribe)).toMatchObject([{ admin_removal_id: r.removal, request_id: null }]);
    // a row must come from exactly one of them
    await expect(c.sql("insert into public.removal_blocks (person_id, tribe_id, season_id) select person_id, tribe_id, season_id from public.removal_blocks limit 1")).rejects.toThrow(/removal_blocks_one_source/);
    // and a leader's request that is reinstated lifts only its own block
    await c.as(careLead, "removal_reinstate", ask.id, "Looked again and the place should be back.");
    expect((await blocks(f.members[0], f.tribe))[0].lifted_at).not.toBeNull();
    expect((await blocks(f.members[1], f.tribe))[0].lifted_at).toBeNull();
  });
});
