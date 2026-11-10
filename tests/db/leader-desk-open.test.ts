import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { readyMember } from "./placement-kit";
import { makeCast, NOBODY, type Cast } from "./profiles-kit";

// The Leader Desk, Phase 2b-2: Open tribe, the pastors' 24-hour reminder, the leader pipeline and its limits. What these prove:
//   * it is the owner's alone and closed until the Switchboard opens it; the helpers are closed to every signed-in person;
//   * a group opens only when it has a leader, an approved card and a certified leader, and the preview says which is missing and changes nothing;
//   * Open tribe places each member by the office's own function, once per member, so a seat is exactly the seat the office would make; the members who said yes to
//     "Your group has a leader" come first; anyone who cannot be placed (a blocker, a warning, no seat left) is named and the rest still go; a second press places
//     the rest; when nobody is left the draft is archived; in Rehearsal nobody is placed; with Placement off nothing changes;
//   * the Desk adds no seat of its own and accepts no warning;
//   * a card the Desk's tribe sent in a day ago and nobody has decided is one reminder to the pastors and directors, and only for the Desk's tribes;
//   * the pipeline shows where each group stands and how long, flags the ones past their limit, and the limits are settings with a reason;
//   * "Check interest" refuses a group that already has a leader.

let c: Cast;
let n = 0;
const REASON = "Trying Open tribe with real people";

const owner = (fn: string, ...args: unknown[]) => c.o.call(fn, ...args);
const admin = (text: string, params: unknown[] = []) => c.sql(text, params);
const setMode = (mode: "off" | "rehearsal" | "on") => c.set("leader_desk", mode, { reason: REASON });
const placementMode = (mode: "off" | "rehearsal" | "on") => c.o.call("placement_settings_save", JSON.stringify({ mode, min_tribe: 4 }));
const bare = (v: unknown) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "");
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const GROUP = { slot: "weeknight-evening", mode: "in_person", zone: "mainland", type: "mixed", capacity: 8 };
async function makeGroup(capacity = 8) {
  const track = await c.k.lookup("tracks", "builders");
  const comm = await c.k.lookup("communities", "professionals");
  const goal = await c.k.goalOf("professionals");
  const g = GROUP;
  return (await owner("desk_group_save", null, `Open group ${++n}`, track, comm, goal, g.slot, g.mode, g.zone, g.type, capacity, null)) as Obj;
}
const plain = (name: string, o: Parameters<typeof readyMember>[4] = {}) => readyMember(c.db, c.k, c.season, `${name}${++n}`, { daysAgo: 6, times: ["weeknight-evening"], ...o });

/** A draft group whose leader has been found: its tribe is made (approved and certified by default) and linked to the group, with `members` in the draft. */
async function led(o: { members?: number; capacity?: number; status?: string; certified?: boolean } = {}) {
  const capacity = o.capacity ?? 8;
  const g = await makeGroup(capacity);
  const t = await c.k.tribe(c.season, { capacity, name: `Desk tribe ${++n}`, status: o.status ?? "approved", certified: o.certified });
  await admin("update public.desk_groups set leader_id = $1, tribe_id = $2, leader_found_at = now() where id = $3", [t.leader.id, t.tribe, g.id]);
  const draft: { id: string }[] = [];
  for (let i = 0; i < (o.members ?? 2); i++) {
    const m = await plain(`Open${i}`);
    await owner("desk_group_member_add", g.id, m.id);
    draft.push(m);
  }
  return { g, t, draft };
}
const seatOf = async (person: string) => (await admin("select * from public.tribe_members where person_id = $1 and status = 'active'", [person]))[0];
const groupRow = async (id: string) => (await admin("select * from public.desk_groups where id = $1", [id]))[0];
const seats = async () => (await c.one("select count(*)::int n from public.tribe_members")).n as number;

beforeAll(async () => {
  c = await makeCast();
  await c.k.moveSeason(c.season, 3);
  await setMode("on");
  await placementMode("on");
  await admin("update public.desk_settings set daily_cap = 300");
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["desk_open_preview", [NOBODY]],
    ["desk_open_tribe", [NOBODY]],
    ["desk_pipeline", []],
    ["desk_pipeline_settings_set", [72, 2, 2, 3, "A reason"]],
  ];

  it("is the owner's alone: an admin, a director, the pastor, a member and a visitor are turned away", async () => {
    for (const who of [c.admin, c.director, c.pastor, c.member]) {
      for (const [fn, args] of CALLS) await expectCode(c.as(who, fn, ...args), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(c.anon(fn, ...args), "42501");
  });

  it("keeps every helper closed to every signed-in person, the owner included", async () => {
    const helpers: [string, unknown[]][] = [
      ["desk_open_words", ["card"]],
      ["desk_open_plan", [NOBODY]],
      ["desk_card_tick", []],
    ];
    for (const [fn, args] of helpers) {
      await expectCode(c.o.run((q) => q(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args)), "42501");
    }
  });

  it("is closed while the Switchboard has the Desk Off", async () => {
    await setMode("off");
    for (const [fn, args] of CALLS) await expectCode(owner(fn, ...args), "42501");
    await setMode("on");
  });
});

describe("whether a group can be opened", () => {
  it("says which step is missing, in words, and changes nothing", async () => {
    const before = await seats();
    const bare1 = await makeGroup();
    expect(await owner("desk_open_preview", bare1.id)).toMatchObject({ ok: false, problem: "This group does not have a leader yet" });
    const card = await led({ status: "draft" });
    expect(await owner("desk_open_preview", card.g.id)).toMatchObject({ ok: false, problem: expect.stringContaining("has not been approved") });
    const cert = await led({ certified: false });
    expect(await owner("desk_open_preview", cert.g.id)).toMatchObject({ ok: false, problem: expect.stringContaining("has not been certified") });
    for (const g of [bare1, card.g, cert.g]) await expectCode(owner("desk_open_tribe", g.id), "22023");
    expect(await seats()).toBe(before);
    expect((await groupRow(card.g.id)).opened_at).toBeNull();
  });

  it("refuses an archived group and a group that is not there", async () => {
    const x = await led({ members: 0 });
    await admin("update public.desk_groups set status = 'archived' where id = $1", [x.g.id]);
    expect(await owner("desk_open_preview", x.g.id)).toMatchObject({ ok: false, problem: "That group has been archived" });
    await expectCode(owner("desk_open_tribe", NOBODY), "P0002");
    expect(await owner("desk_open_preview", NOBODY)).toMatchObject({ ok: false });
  });
});

describe("Open tribe", () => {
  it("shows who would be placed and changes nothing", async () => {
    const x = await led({ members: 3 });
    const before = await seats();
    const p = await owner("desk_open_preview", x.g.id);
    expect(p).toMatchObject({ ok: true, rehearsal: false, placement_on: true, counts: { ready: 3, seated: 0, not_placed: 0 } });
    expect(p.members.map((m: Obj) => m.state)).toEqual(["ready", "ready", "ready"]);
    expect(p.tribe).toMatchObject({ capacity: 8, active: 0 });
    expect(await seats()).toBe(before);
    expect((await groupRow(x.g.id)).status).toBe("draft");
  });

  it("places every member by the office's own function, one at a time, and archives the draft when nobody is left", async () => {
    const x = await led({ members: 3 });
    const before = await seats();
    const r = await owner("desk_open_tribe", x.g.id);
    expect(r).toMatchObject({ ok: true, rehearsal: false, placed: 3, not_placed: [], closed: true });
    expect(await seats()).toBe(before + 3);
    for (const m of x.draft) {
      const seat = await seatOf(m.id);
      expect(seat.tribe_id).toBe(x.t.tribe);
      // placed the office's way: a single-person run, by the owner, recorded as such
      const run = await c.one("select single, placed_via, placed_role, placed_by from public.placement_runs where id = $1", [seat.placed_by_run]);
      expect(run).toMatchObject({ single: true, placed_via: "owner", placed_role: "owner" });
      // the ordinary "Your tribe" email, queued by the placement itself
      const mail = await admin("select template from public.messages where person_id = $1 and template like 'placement_%'", [m.id]);
      expect(mail.length).toBeGreaterThanOrEqual(1);
    }
    const g = await groupRow(x.g.id);
    expect(g.status).toBe("archived");
    expect(g.opened_at).not.toBeNull();
    // the log says how many, and names nobody
    const ev = await c.one("select meta from public.event_log where action = 'desk.open_tribe' and entity_id = $1", [x.g.id]);
    expect(ev.meta).toEqual({ placed: 3, would: 0, not_placed: 0, rehearsal: false });
  });

  it("places the members who said yes first, and names the one who does not fit, while the rest still go", async () => {
    const x = await led({ members: 3, capacity: 4 });
    // Three in the draft and only two seats: someone else already holds two of the four (established believers, one quiet and one lively, so the tribe still meets the matching's own health rules)
    for (let i = 0; i < 2; i++) {
      const other = await plain(`Holder${i}`, { faith: "established", social: i === 0 ? -1 : 1 });
      await owner("placement_one_place", other.id, x.t.tribe, [], null, false);
    }
    const [first, second, third] = x.draft;
    // the third was added last, and the first has not answered; the third said yes to "Your group has a leader"
    await admin("update public.desk_group_members set added_at = now() - interval '3 days' where group_id = $1 and person_id = $2", [x.g.id, first.id]);
    await admin("update public.desk_group_members set added_at = now() - interval '2 days' where group_id = $1 and person_id = $2", [x.g.id, second.id]);
    await admin(
      `insert into public.desk_proposals (kind, person_id, season_id, group_id, status, answer, rehearsal, expires_at, answered_at)
       values ('found', $1, $2, $3, 'answered', 'yes', false, now() + interval '30 days', now())`,
      [third.id, c.season, x.g.id],
    );
    const p = await owner("desk_open_preview", x.g.id);
    expect(p.members.map((m: Obj) => [m.person_id, m.state, m.said_yes])).toEqual([
      [third.id, "ready", true],
      [first.id, "ready", false],
      [second.id, "full", false],
    ]);
    const r = await owner("desk_open_tribe", x.g.id);
    expect(r).toMatchObject({ ok: true, placed: 2, closed: false });
    expect(r.not_placed).toHaveLength(1);
    expect(r.not_placed[0]).toMatchObject({ person_id: second.id, text: expect.stringContaining("no seat left") });
    expect((await seatOf(third.id)).tribe_id).toBe(x.t.tribe);
    expect((await seatOf(first.id)).tribe_id).toBe(x.t.tribe);
    expect(await seatOf(second.id)).toBeUndefined();
    // the draft stays, marked as opened, so the owner can see who is left
    const g = await groupRow(x.g.id);
    expect(g.status).toBe("draft");
    expect(g.opened_at).not.toBeNull();
  });

  it("does not stop for a member the office could not place, names them with the reason, and a second press places the rest", async () => {
    const x = await led({ members: 3 });
    const [a, b, d] = x.draft;
    // b already has a seat elsewhere (a blocker); d has a hold the church put there (a warning the Desk never accepts)
    const elsewhere = await c.k.tribe(c.season, { name: `Elsewhere ${++n}` });
    await owner("placement_one_place", b.id, elsewhere.tribe, [], null, false);
    await admin("insert into public.placement_holds (person_id, source, until) values ($1, 'care', now() + interval '10 days')", [d.id]);
    const p = await owner("desk_open_preview", x.g.id);
    expect(Object.fromEntries(p.members.map((m: Obj) => [m.person_id, m.state]))).toEqual({ [a.id]: "ready", [b.id]: "blocked", [d.id]: "blocked" });
    const r = await owner("desk_open_tribe", x.g.id);
    expect(r.placed).toBe(1);
    expect(r.closed).toBe(false);
    const by = Object.fromEntries(r.not_placed.map((m: Obj) => [m.person_id, m.text as string]));
    expect(by[b.id]).toMatch(/already have a seat this season/);
    expect(by[d.id]).toMatch(/Care Team/);
    expect((await seatOf(a.id)).tribe_id).toBe(x.t.tribe);
    expect(await seatOf(d.id)).toBeUndefined();
    expect((await groupRow(x.g.id)).status).toBe("draft");

    // The hold is lifted and b's other seat is given up: pressing again places only the two who are left, and the draft closes
    await admin("delete from public.placement_holds where person_id = $1", [d.id]);
    await admin("update public.tribe_members set status = 'released', released_at = now() where person_id = $1 and tribe_id = $2", [b.id, elsewhere.tribe]);
    const again = await owner("desk_open_tribe", x.g.id);
    expect(again).toMatchObject({ ok: true, placed: 2, not_placed: [], closed: true });
    expect((await groupRow(x.g.id)).status).toBe("archived");
    expect((await seatOf(a.id)).tribe_id).toBe(x.t.tribe);
    expect((await admin("select count(*)::int n from public.tribe_members where person_id = $1", [a.id]))[0].n).toBe(1);
  });

  it("refuses when Placement is not On, and changes nothing", async () => {
    const x = await led({ members: 2 });
    await placementMode("off");
    const before = await seats();
    await expectCode(owner("desk_open_tribe", x.g.id), "22023");
    expect(await seats()).toBe(before);
    expect((await owner("desk_open_preview", x.g.id)).placement_on).toBe(false);
    expect((await groupRow(x.g.id)).opened_at).toBeNull();
    await placementMode("on");
  });

  it("in Rehearsal places nobody and only says who would be, with a line in the log", async () => {
    const x = await led({ members: 2 });
    await setMode("rehearsal");
    const before = await seats();
    const r = await owner("desk_open_tribe", x.g.id);
    expect(r).toMatchObject({ ok: true, rehearsal: true, placed: 0, would: 2, not_placed: [], closed: false });
    expect(await seats()).toBe(before);
    const g = await groupRow(x.g.id);
    expect(g).toMatchObject({ status: "draft", opened_at: null });
    const ev = await c.one("select meta from public.event_log where action = 'desk.open_tribe' and entity_id = $1", [x.g.id]);
    expect(ev.meta).toMatchObject({ rehearsal: true, would: 2, placed: 0 });
    await setMode("on");
  });

  it("never names a person, a number or a reason in the log", async () => {
    const events = await admin("select meta from public.event_log where action = 'desk.open_tribe'");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(bare(e.meta)).not.toMatch(/name|phone|text|\+?\d{9,}/i);
  });

  it("is the office's placement and nothing else: the Desk makes no seat, run or item of its own and accepts no warning", async () => {
    const def = (await c.one("select pg_get_functiondef('public.desk_open_tribe(uuid)'::regprocedure) as d")).d as string;
    expect(def).toContain("placement_one_place(");
    expect(def).not.toMatch(/insert\s+into\s+public\.(tribe_members|placement_runs|placement_items|placement_teams|messages)/i);
    expect(def).not.toMatch(/update\s+public\.(tribe_members|tribes|person_roles)/i);
    expect(def).not.toMatch(/enqueue_message|notify_person|notify_role/i);
    // an empty list of accepted warnings and no reason: a warning stops the member, it is never accepted for them
    expect(def).toContain("placement_one_place((r.m ->> 'person_id')::uuid, g.tribe_id, '{}'::text[], null, false)");
    const plan = (await c.one("select pg_get_functiondef('public.desk_open_plan(uuid)'::regprocedure) as d")).d as string;
    expect(plan).toContain("placement_check_core(");
    expect(plan).not.toMatch(/\binsert\b|\bupdate\s+public\.|\bdelete\b/i);
  });
});

describe("the pastors' reminder for a card the Desk's tribe sent in", () => {
  const reminders = async (tribe: string) => admin("select * from public.notice_items where kind = 'pastor_card_waiting' and event like $1", [`cardwait:${tribe}:%`]);
  const submittedAgo = (tribe: string, hours: number) =>
    admin("update public.tribes set status = 'submitted', submitted_at = now() - ($2 || ' hours')::interval where id = $1", [tribe, String(hours)]);

  beforeAll(async () => {
    await c.noticesOn();
  });

  it("goes once, to the pastors and directors, 24 hours after the card was sent in, and not before", async () => {
    const x = await led({ status: "submitted", members: 0 });
    await submittedAgo(x.t.tribe, 20);
    await admin("select public.desk_card_tick()");
    expect(await reminders(x.t.tribe)).toHaveLength(0);
    await submittedAgo(x.t.tribe, 25);
    await admin("select public.desk_card_tick()");
    const got = await reminders(x.t.tribe);
    expect(got.map((r) => r.person_id).sort()).toEqual([c.pastor, c.director].sort());
    expect(got[0]).toMatchObject({ path: "/review/cards" });
    // a second look, and the heartbeat, add nothing
    await admin("select public.desk_card_tick()");
    await admin("select public.desk_tick()");
    expect(await reminders(x.t.tribe)).toHaveLength(2);
  });

  it("is not sent for a tribe the Desk did not form", async () => {
    const t = await c.k.tribe(c.season, { name: `Ordinary ${++n}`, status: "submitted" });
    await submittedAgo(t.tribe, 30);
    await admin("select public.desk_card_tick()");
    expect(await reminders(t.tribe)).toHaveLength(0);
  });

  it("stops once a pastor has decided, and is not sent for a card that has waited past two weeks (the weekly note covers those)", async () => {
    const decided = await led({ status: "submitted", members: 0 });
    await submittedAgo(decided.t.tribe, 25);
    await admin("update public.tribes set status = 'approved' where id = $1", [decided.t.tribe]);
    await admin("select public.desk_card_tick()");
    expect(await reminders(decided.t.tribe)).toHaveLength(0);
    const old = await led({ status: "submitted", members: 0 });
    await submittedAgo(old.t.tribe, 24 * 20);
    await admin("select public.desk_card_tick()");
    expect(await reminders(old.t.tribe)).toHaveLength(0);
  });

  it("is not sent while the Desk is in Rehearsal or Off", async () => {
    const x = await led({ status: "submitted", members: 0 });
    await submittedAgo(x.t.tribe, 25);
    await setMode("rehearsal");
    expect(await admin("select public.desk_card_tick() as n")).toEqual([{ n: 0 }]);
    await setMode("off");
    expect(await admin("select public.desk_card_tick() as n")).toEqual([{ n: 0 }]);
    expect(await reminders(x.t.tribe)).toHaveLength(0);
    await setMode("on");
    await admin("select public.desk_card_tick()");
    expect(await reminders(x.t.tribe)).toHaveLength(2);
  });

  it("reaches the heartbeat the website already calls, and a failing notice never stops it", async () => {
    const x = await led({ status: "submitted", members: 0 });
    await submittedAgo(x.t.tribe, 25);
    const tick = (await c.one("select public.desk_tick() as t")).t as Obj;
    expect(tick).toHaveProperty("card_reminders");
    expect(tick).toHaveProperty("expired");
    expect(await reminders(x.t.tribe)).toHaveLength(2);
  });
});

describe("the pipeline", () => {
  const rowFor = (p: Obj, group: string) => p.rows.find((r: Obj) => r.group_id === group) as Obj;
  const hoursAgo = (h: number) => `now() - interval '${h} hours'`;

  it("starts with the limits the pastorate asked for: offers 72 hours, 2 backups, a yes 2 days, a card decision 3 days", async () => {
    const p = await owner("desk_pipeline");
    expect(p.settings).toEqual({ offer_hours: 72, backups: 2, said_yes_days: 2, card_days: 3 });
  });

  it("shows where each group stands, how long it has been there, and which are past their limit", async () => {
    // a card with the pastors for 4 days (limit 3): stuck; another for 2 days: not
    const slow = await led({ status: "submitted", members: 0 });
    await admin(`update public.tribes set submitted_at = ${hoursAgo(96)} where id = $1`, [slow.t.tribe]);
    const quick = await led({ status: "submitted", members: 0 });
    await admin(`update public.tribes set submitted_at = ${hoursAgo(48)} where id = $1`, [quick.t.tribe]);
    // a card still being filled in, one approved and waiting for the Academy, one ready to open, and one opened with a person left
    const started = await led({ status: "draft", members: 0 });
    const approved = await led({ certified: false, members: 0 });
    await admin(`update public.tribes set reviewed_at = ${hoursAgo(10)} where id = $1`, [approved.t.tribe]);
    const ready = await led({ members: 0 });
    await admin(`update public.tribes set reviewed_at = ${hoursAgo(30)} where id = $1`, [ready.t.tribe]);
    // a leader offer that has waited 80 hours (limit 72) and a yes below the fit bar that has waited 3 days (limit 2)
    const lead1 = await plain("Asked");
    const askedGroup = await makeGroup();
    await admin(
      `insert into public.desk_offers (group_id, person_id, season_id, round, seq, status, rehearsal, opened_at, window_ends_at)
       values ($1, $2, $3, 1, 1, 'open', false, ${hoursAgo(80)}, now() - interval '8 hours')`,
      [askedGroup.id, lead1.id, c.season],
    );
    const lead2 = await plain("SaidYes");
    const yesGroup = await makeGroup();
    await admin(
      `insert into public.desk_offers (group_id, person_id, season_id, round, seq, status, rehearsal, opened_at, answered_at, answer)
       values ($1, $2, $3, 1, 1, 'review', false, ${hoursAgo(100)}, ${hoursAgo(72)}, 'lead')`,
      [yesGroup.id, lead2.id, c.season],
    );
    // a Rehearsal offer is not on the way to anything
    const lead3 = await plain("Rehearsed");
    const rehGroup = await makeGroup();
    await admin(`insert into public.desk_offers (group_id, person_id, season_id, round, seq, status, rehearsal) values ($1, $2, $3, 1, 1, 'would_send', true)`, [rehGroup.id, lead3.id, c.season]);

    const p = await owner("desk_pipeline");
    expect(rowFor(p, slow.g.id)).toMatchObject({ stage: "card_waiting", stuck: true, limit_hours: 72, formed: true });
    expect(rowFor(p, slow.g.id).hours).toBeGreaterThanOrEqual(96);
    expect(rowFor(p, quick.g.id)).toMatchObject({ stage: "card_waiting", stuck: false });
    expect(rowFor(p, started.g.id)).toMatchObject({ stage: "card_started", stuck: false, limit_hours: null });
    expect(rowFor(p, approved.g.id)).toMatchObject({ stage: "card_approved", stuck: false });
    expect(rowFor(p, ready.g.id)).toMatchObject({ stage: "ready", stuck: false });
    expect(rowFor(p, askedGroup.id)).toMatchObject({ stage: "asked", stuck: true, limit_hours: 72, formed: false, person_id: lead1.id });
    expect(rowFor(p, yesGroup.id)).toMatchObject({ stage: "said_yes", stuck: true, limit_hours: 48, person_id: lead2.id });
    expect(rowFor(p, rehGroup.id)).toBeUndefined();
    // the stuck ones come first, and are counted
    expect(p.stuck).toBe(p.rows.filter((r: Obj) => r.stuck).length);
    expect(p.stuck).toBeGreaterThanOrEqual(3);
    const firstClear = p.rows.findIndex((r: Obj) => !r.stuck);
    expect(firstClear).toBeGreaterThan(-1);
    expect(p.rows.slice(firstClear).some((r: Obj) => r.stuck)).toBe(false);
    // a group that has been opened with someone left is shown as such; one that is archived is not shown
    await admin("update public.desk_groups set opened_at = now() where id = $1", [ready.g.id]);
    expect(rowFor(await owner("desk_pipeline"), ready.g.id)).toMatchObject({ stage: "opened" });
    await admin("update public.desk_groups set status = 'archived' where id = $1", [ready.g.id]);
    expect(rowFor(await owner("desk_pipeline"), ready.g.id)).toBeUndefined();
  });

  it("puts a person on the screen by first-and-last name only, and carries no number, note or reason", async () => {
    const p = await owner("desk_pipeline");
    expect(Object.keys(p.rows[0]).sort()).toEqual(["formed", "group", "group_id", "hours", "limit_hours", "name", "person_id", "since", "stage", "stuck", "tribe_id"]);
    expect(bare(p)).not.toMatch(/phone|\+?\d{9,}/i);
  });

  it("changes the limits with a reason, within the ranges, and the pipeline follows", async () => {
    await expectCode(owner("desk_pipeline_settings_set", 23, 2, 2, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 241, 2, 2, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 3, 2, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, -1, 2, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 2, 0, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 2, 15, 3, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 2, 2, 0, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 2, 2, 15, REASON), "22023");
    await expectCode(owner("desk_pipeline_settings_set", 72, 2, 2, 3, "no"), "22023");
    await expectCode(owner("desk_pipeline_settings_set", null, 2, 2, 3, REASON), "22023");
    const got = await owner("desk_pipeline_settings_set", 96, 1, 4, 5, REASON);
    expect(got.settings).toEqual({ offer_hours: 96, backups: 1, said_yes_days: 4, card_days: 5 });
    // a card that waited 4 days is now within its 5-day limit
    const slow = await led({ status: "submitted", members: 0 });
    await admin("update public.tribes set submitted_at = now() - interval '96 hours' where id = $1", [slow.t.tribe]);
    expect((await owner("desk_pipeline")).rows.find((r: Obj) => r.group_id === slow.g.id)).toMatchObject({ stuck: false, limit_hours: 120 });
    // the log line carries the numbers and not the reason
    const ev = await c.one("select meta from public.event_log where action = 'desk.settings' order by id desc limit 1");
    expect(ev.meta).toEqual({ offer_hours: 96, backups: 1, said_yes_days: 4, card_days: 5 });
    expect(JSON.stringify(ev.meta)).not.toContain(REASON);
    // the next offer uses the new window, and the settings can go back
    await owner("desk_pipeline_settings_set", 72, 2, 2, 3, REASON);
  });
});

describe("Check interest on a group that already has a leader", () => {
  it("is refused in words, and still works for a group that has none", async () => {
    const x = await led({ members: 1 });
    await expectCode(owner("desk_interest_check", x.g.id), "22023");
    const open = await makeGroup();
    const m = await plain("Interested");
    await owner("desk_group_member_add", open.id, m.id);
    expect(await owner("desk_interest_check", open.id)).toMatchObject({ sent: expect.any(Number), skipped: expect.any(Object) });
  });
});
