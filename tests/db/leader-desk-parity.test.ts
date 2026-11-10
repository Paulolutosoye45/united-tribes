import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readyMember } from "./placement-kit";
import { makeCast, type Cast } from "./profiles-kit";

// The parity test the blueprint asks for ("Same flow for everyone"). A member who arrives through the Leader Desk is placed by the same function, checked by the same
// rules and emailed by the same templates as a member who arrives any other way, so nothing downstream can tell the two routes apart except the Desk's own line in the
// log and the link from its draft group to the tribe (the "formed by the Desk" tag, which is for reports only).
//
// Two identical tribes, each with an approved card and a certified leader, and two identical members. One member is placed the ordinary way (the owner places one person).
// The other goes through "Open tribe" on a draft group that was formed for the other tribe. Then everything the placement left behind is compared: the seat, the run, the
// item, the team, every message queued (to the member and to the leader), the notices, and every line in the log. If a later package changes one route and forgets the
// other, this fails.

let c: Cast;

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SLOT = "weeknight-evening";

/** Everything that may differ between two placements for a reason that has nothing to do with the route: ids, names, times. */
const DROP = new Set([
  "id", "person_id", "tribe_id", "circle_id", "run_id", "placed_by_run", "placement_id", "created_at", "updated_at", "placed_at", "planned_at", "approved_at", "at",
  "joined_at", "last_seen_at", "confirm_by", "first_meeting_by", "hold_until", "token_hash", "seat_id", "season_id", "seq",
]);
const norm = (row: Obj | undefined) =>
  row
    ? Object.fromEntries(
        Object.entries(row)
          .filter(([k, v]) => !DROP.has(k) && !k.endsWith("_at") && !k.endsWith("_by") && !(typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)))
          // the covenant a member agrees to carries the tribe's own name; that is the one field that is meant to differ between two tribes
          .map(([k, v]) => [k, k === "covenant" && v && typeof v === "object" ? JSON.stringify(Object.fromEntries(Object.entries(v).filter(([ck]) => ck !== "name").sort())) : v !== null && typeof v === "object" ? JSON.stringify(v) : v])
          .sort(([a], [b]) => (a < b ? -1 : 1)),
      )
    : undefined;

async function twin(name: string) {
  const t = await c.k.tribe(c.season, { name, capacity: 8, status: "approved", slot: SLOT });
  const m = await readyMember(c.db, c.k, c.season, `Par${name}`, { daysAgo: 20, times: [SLOT] });
  return { t, m };
}

/** What a placement left behind, with every id and time taken out: the same for the same route. */
async function left(person: string, leader: string, run: string, from: number, since: Date) {
  const seat = (await c.sql("select * from public.tribe_members where person_id = $1 and status = 'active'", [person]))[0];
  const mail = async (who: string) =>
    (
      await c.sql(
        `select template, channel, status, urgency, force_channel, reply_token, (select array_agg(k order by k) from jsonb_object_keys(params) k) as keys
           from public.messages where person_id = $1 and created_at >= $2 order by template, channel`,
        [who, since],
      )
    ).map((r) => ({ template: r.template, channel: r.channel, status: r.status, urgency: r.urgency, force: r.force_channel, token: r.reply_token !== null, keys: r.keys }));
  const events = (await c.sql("select action, entity, meta from public.event_log where id > $1 order by id", [from])) as Obj[];
  return {
    seat: norm(seat),
    run: norm((await c.sql("select * from public.placement_runs where id = $1", [run]))[0]),
    item: norm((await c.sql("select * from public.placement_items where run_id = $1", [run]))[0]),
    team: norm((await c.sql("select * from public.placement_teams where run_id = $1", [run]))[0]),
    toMember: await mail(person),
    toLeader: await mail(leader),
    tokens: (await c.sql("select count(*)::int n from public.placement_tokens where person_id = $1", [person]))[0].n,
    seats: (await c.sql("select count(*)::int n from public.tribe_members where person_id = $1", [person]))[0].n,
    events,
  };
}
const now = async () => (await c.one("select clock_timestamp() as t")).t as Date;
const lastEvent = async () => (await c.one("select coalesce(max(id), 0)::bigint as n from public.event_log")).n as number;

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await c.set("leader_desk", "on", { reason: "Trying the parity of the two routes" });
  await c.o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  await c.sql("update public.desk_settings set daily_cap = 300");
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("a member placed through the Desk and a member placed the ordinary way", () => {
  it("end up in identical tribes with identical seats, messages, notices and log lines, apart from the Desk's own line and its link to the tribe", async () => {
    await c.sql("update public.tribes set status = 'closed' where status = 'approved'");
    const ordinary = await twin("Ordinary");
    const formed = await twin("Formed");
    // a draft group formed for the second tribe, with its leader found and the member in the draft
    const track = await c.k.lookup("tracks", "builders");
    const comm = await c.k.lookup("communities", "professionals");
    const goal = await c.k.goalOf("professionals");
    const g = (await c.o.call("desk_group_save", null, "Parity group", track, comm, goal, SLOT, "in_person", "mainland", "mixed", 8, null)) as Obj;
    await c.sql("update public.desk_groups set leader_id = $1, tribe_id = $2, leader_found_at = now() where id = $3", [formed.t.leader.id, formed.t.tribe, g.id]);
    await c.o.call("desk_group_member_add", g.id, formed.m.id);

    // The ordinary route: the owner places one person
    const before1 = await lastEvent();
    const since1 = await now();
    const r1 = (await c.o.call("placement_one_place", ordinary.m.id, ordinary.t.tribe, [], null, false)) as Obj;
    const a = await left(ordinary.m.id, ordinary.t.leader.id, r1.run, before1, since1);

    // The Desk route: Open tribe, which calls the same function once for the member
    const before2 = await lastEvent();
    const since2 = await now();
    const r2 = (await c.o.call("desk_open_tribe", g.id)) as Obj;
    expect(r2).toMatchObject({ ok: true, placed: 1, not_placed: [] });
    const run2 = (await c.one("select placed_by_run from public.tribe_members where person_id = $1 and status = 'active'", [formed.m.id])).placed_by_run as string;
    const b = await left(formed.m.id, formed.t.leader.id, run2, before2, since2);

    // the seat, the run, the item, the team, the tokens
    expect(b.seat).toEqual(a.seat);
    expect(b.run).toEqual(a.run);
    expect(b.item).toEqual(a.item);
    expect(b.team).toEqual(a.team);
    expect(b.tokens).toBe(a.tokens);
    expect(b.seats).toBe(1);
    expect(a.seats).toBe(1);
    // the messages queued to the member and to the leader: the same templates, channels, pacing and fields
    expect(a.toMember.length).toBeGreaterThan(0);
    expect(b.toMember).toEqual(a.toMember);
    expect(b.toLeader).toEqual(a.toLeader);

    // the log: the Desk adds exactly one line, its own, and every other line is the ordinary one
    // (an id in a line, such as the run it belongs to, is different for any two placements; everything else in it is compared)
    const isId = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v);
    const shape = (rows: Obj[]) =>
      rows.map((e) => ({ action: e.action, entity: e.entity, meta: JSON.stringify(Object.fromEntries(Object.entries(e.meta as Obj).filter(([k, v]) => k !== "tribe" && !isId(v)))) }));
    const extra = b.events.filter((e) => e.action.startsWith("desk."));
    expect(extra.map((e) => e.action)).toEqual(["desk.open_tribe"]);
    expect(shape(b.events.filter((e) => !e.action.startsWith("desk."))).sort((x, y) => (x.action < y.action ? -1 : 1))).toEqual(shape(a.events).sort((x, y) => (x.action < y.action ? -1 : 1)));

    // and the tag: only the Desk's tribe is linked from a draft group, which is all a report needs to tell the two routes apart
    const tagged = await c.sql("select tribe_id from public.desk_groups where tribe_id is not null");
    expect(tagged.map((r) => r.tribe_id)).toEqual([formed.t.tribe]);
    // The tribes themselves are ordinary: the same shape row for row
    const shapeOf = async (id: string) => norm((await c.sql("select * from public.tribes where id = $1", [id]))[0]);
    const ta = await shapeOf(ordinary.t.tribe);
    const tb = await shapeOf(formed.t.tribe);
    for (const k of ["status", "fixed", "capacity", "slot", "meeting_mode", "zone", "tribe_type"]) expect(tb?.[k], k).toEqual(ta?.[k]);
  });

  it("is the same when a member is turned away: the same words, and nothing left behind by either route", async () => {
    await c.sql("update public.tribes set status = 'closed' where status = 'approved'");
    const ordinary = await twin("OrdinaryNo");
    const formed = await twin("FormedNo");
    // both members are already seated in a third tribe, which both routes refuse in the same words
    const third = await c.k.tribe(c.season, { name: "Third tribe", status: "approved" });
    await c.o.call("placement_one_place", ordinary.m.id, third.tribe, [], null, false);
    await c.o.call("placement_one_place", formed.m.id, third.tribe, [], null, false);
    const track = await c.k.lookup("tracks", "builders");
    const comm = await c.k.lookup("communities", "professionals");
    const goal = await c.k.goalOf("professionals");
    const g = (await c.o.call("desk_group_save", null, "Parity refusal group", track, comm, goal, SLOT, "in_person", "mainland", "mixed", 8, null)) as Obj;
    await c.sql("update public.desk_groups set leader_id = $1, tribe_id = $2, leader_found_at = now() where id = $3", [formed.t.leader.id, formed.t.tribe, g.id]);
    await c.sql("insert into public.desk_group_members (group_id, person_id) values ($1, $2)", [g.id, formed.m.id]);
    const seatsBefore = (await c.one("select count(*)::int n from public.tribe_members")).n;

    const chk1 = (await c.o.call("placement_one_check", ordinary.m.id, ordinary.t.tribe)) as Obj;
    const word1 = chk1.blockers[0].text as string;
    await expect(c.o.call("placement_one_place", ordinary.m.id, ordinary.t.tribe, [], null, false)).rejects.toThrow(word1);
    const r = (await c.o.call("desk_open_tribe", g.id)) as Obj;
    expect(r).toMatchObject({ ok: true, placed: 0, closed: false });
    expect(r.not_placed).toHaveLength(1);
    // the Desk names them with the placement's own blocker, with the other tribe's name in it as the ordinary route has it
    expect((r.not_placed[0].text as string).replace("Third tribe", "")).toBe(word1.replace("Third tribe", ""));
    expect((await c.one("select count(*)::int n from public.tribe_members")).n).toBe(seatsBefore);
  });
});
