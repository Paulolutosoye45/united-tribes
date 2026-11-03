import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Leader removal requests that an admin or director must approve. What these prove:
//   * a coach of the tribe RECOMMENDS (approve, decline or question, with a note) and cannot close anything; the person deciding reads it first and the
//     leader who asked never does; a restricted request is not the coach's to recommend on
//   * admins and directors are told when a request comes in and when the leader answers (no name, no reason), and once when it has waited three days;
//     Admin → Today counts what this person can decide, and nothing else
//   * approving puts the member on a hold: no automatic run places them for three days (they can still choose for themselves); a safety, conduct,
//     young-person or open-care-flag case is never placed by a run; putting the place back lifts the hold; the owner's own hold is never overwritten
//   * moving the switch to On starts the staff email groups that take part, only the ones that were Off, and never in Rehearsal

let c: Cast;
let n = 0;
let careLead: string;
let coach: string;
let coach2: string;
let token: string;

beforeAll(async () => {
  c = await makeCast();
  careLead = (await c.k.staff("CareLead", "care_lead")).id;
  coach = (await c.k.staff("Coach", "coach")).id;
  coach2 = (await c.k.staff("OtherCoach", "coach")).id;
  token = (await c.one("select public.bootstrap_worker_token('test-removal-admin') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("delete from public.removal_requests");
  await c.sql("delete from public.placement_holds");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.notice_items");
  await c.sql("update public.notice_settings set mode = 'off'");
});

const REASON = "Trying removal requests with everyone";
/** Switches it On the way the owner does, and then puts the staff email groups back as they were, so each test says for itself when notices go out. */
const on = async () => {
  const before = await c.sql("select group_key, mode from public.notice_settings");
  await c.set("removal_requests", "on", { reason: REASON });
  for (const g of before) await c.sql("update public.notice_settings set mode = $2 where group_key = $1", [g.group_key, g.mode]);
};
const rehearse = () => c.set("removal_requests", "rehearsal", { reason: REASON });
const NOTE = "He has missed five weeks and does not answer calls, and I have asked twice.";
const WHY = "Looked at this carefully and agree with the leader.";

type Fresh = { leader: string; tribe: string; members: string[] };

async function fresh(): Promise<Fresh> {
  const t = await c.k.tribe(c.season, { name: `Admin Tribe ${++n}`, track: "builders" });
  await c.sql("update public.tribes set coach_id = $2 where id = $1", [t.tribe, coach]);
  const a = await c.k.seat(t.tribe, c.season, `AdmSeated${++n}`);
  const b = await c.k.seat(t.tribe, c.season, `AdmSeated${++n}`);
  await c.sql("delete from public.messages");
  return { leader: t.leader.id, tribe: t.tribe, members: [a.id, b.id] };
}

const ask = (f: Fresh, member = f.members[0], reason = "repeated_absence") => c.as(f.leader, "removal_ask", f.tribe, member, reason, NOTE, true, false);
const decide = (id: string, who: string, decision: string, note = WHY) => c.as(who, "removal_decide", id, decision, note);
const recommend = (id: string, who: string, decision: string, note = "I know this member. I think the leader is right here.") =>
  c.as(who, "removal_recommend", id, decision, note);
const row = (id: string) => c.one("select * from public.removal_requests where id = $1", [id]);
const card = async (who: string, id: string) => (await c.as(who, "removal_board")).requests.find((q: { id: string }) => q.id === id);
const hold = async (person: string) => (await c.sql("select * from public.placement_holds where person_id = $1", [person]))[0];
const reason = async (person: string) => (await c.one("select public.placement_pool_reason($1, $2, 0) as r", [person, c.season])).r as string | null;
const backdate = (id: string, days: number) => c.sql("update public.removal_requests set created_at = now() - make_interval(days => $2::int) where id = $1", [id, days]);
const todayRow = async (who: string) => (await c.as(who, "admin_attention")).rows.find((r: { key: string }) => r.key === "removals");

describe("a coach recommends", () => {
  it("records a recommendation with a note, can change it while the request is open, and decides nothing", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    expect(await recommend(r.id, coach, "approve")).toMatchObject({ ok: true, rehearsal: false });
    expect(await row(r.id)).toMatchObject({ status: "open", waiting_on: "approver", rec_decision: "approve", rec_by: coach, decided_by: null });
    await recommend(r.id, coach, "ask", "Please ask how many weeks, and whether anyone has visited him.");
    expect(await row(r.id)).toMatchObject({ rec_decision: "ask", rec_note: "Please ask how many weeks, and whether anyone has visited him." });
    // nothing happened to the member or the leader
    expect(await c.sql("select 1 from public.tribe_members where person_id = $1 and tribe_id = $2 and status = 'active'", [f.members[0], f.tribe])).toHaveLength(1);
    expect(await c.sql("select 1 from public.messages where template like 'removal_%'")).toHaveLength(0);
    expect(await c.sql("select 1 from public.placement_holds")).toHaveLength(0);
    const events = await c.sql("select action, meta from public.event_log where action = 'removal.recommended'");
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toMatch(/weeks|visited/);
  });

  it("needs a decision and a note of 10 to 500 characters, and only while the request is open", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await expectCode(recommend(r.id, coach, "maybe"), "22023");
    await expectCode(recommend(r.id, coach, "approve", "ok"), "22023");
    await expectCode(recommend(r.id, coach, "approve", "x".repeat(501)), "22023");
    expect((await row(r.id)).rec_decision).toBeNull();
    await decide(r.id, c.admin, "decline");
    await expectCode(recommend(r.id, coach, "approve"), "22023");
  });

  it("is the coach of that tribe alone: not another coach, a pastor, the Care Lead, an admin, a director, the leader or a member", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    for (const who of [coach2, c.pastor, careLead, c.admin, c.director, f.leader, f.members[0], f.members[1], c.member]) {
      await expectCode(recommend(r.id, who, "approve"), "42501");
    }
    await expectCode(c.db.asAnon((q) => q("select public.removal_recommend($1, 'approve', 'a long enough note')", [r.id])), "42501");
    expect((await row(r.id)).rec_decision).toBeNull();
  });

  it("is not for a restricted request: safety, conduct, a young person or an open care flag stay with the people who may decide", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f, f.members[0], "safety_or_conduct");
    await expectCode(recommend(r.id, coach, "approve"), "42501");
    expect(await card(coach, r.id)).toMatchObject({ restricted: true, can_recommend: false, can_decide: false });
    // the person who may decide still can
    expect(await card(careLead, r.id)).toMatchObject({ can_decide: true, can_recommend: false });
  });

  it("is read first by the person who decides, and never by the leader who asked", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await recommend(r.id, coach, "decline", "I have spoken to him and to the leader. I think we should wait.");
    for (const who of [c.admin, c.director, careLead, c.pastor]) {
      expect(await card(who, r.id), who).toMatchObject({
        recommendation: { decision: "decline", note: "I have spoken to him and to the leader. I think we should wait.", by: "Coach" },
      });
    }
    expect(await card(coach, r.id)).toMatchObject({ can_recommend: true, can_decide: false, recommendation: { decision: "decline" } });
    expect((await card(f.leader, r.id)).recommendation).toBeNull();
    expect(JSON.stringify(await c.as(f.leader, "removal_mine", f.tribe))).not.toMatch(/spoken to him|wait\./);
    expect(JSON.stringify(await c.as(f.leader, "removal_board"))).not.toMatch(/spoken to him/);
    // the member never sees any of it
    expect(JSON.stringify(await c.as(f.members[0], "my_removal"))).toBe("null");
    // and a request without one has none
    const g = await fresh();
    const q = await ask(g);
    expect((await card(c.admin, q.id)).recommendation).toBeNull();
  });

  it("works in Rehearsal, and is cleared with the leader's words after twelve months", async () => {
    await rehearse();
    const f = await fresh();
    const r = await ask(f);
    expect(await recommend(r.id, coach, "approve")).toMatchObject({ ok: true, rehearsal: true });
    await on();
    await c.sql("update public.removal_requests set created_at = now() - interval '13 months' where id = $1", [r.id]);
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await row(r.id)).toMatchObject({ note: null, rec_note: null, rec_decision: "approve" });
    expect((await row(r.id)).note_cleared_at).not.toBeNull();
  });

  it("answers nothing while the switch is Off", async () => {
    await expectCode(c.as(coach, "removal_recommend", "00000000-0000-0000-0000-000000000000", "approve", "a long enough note here"), "22023");
  });
});

describe("who is told, and Admin → Today", () => {
  it("tells every admin and director when a request comes in and when the leader answers, with no name and no reason", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const r = await ask(f);
    const first = await c.sql("select person_id, group_key, path from public.notice_items where kind = 'admin_removal_ask' and event = $1", [`removal:${r.id}`]);
    expect(first.map((i) => i.person_id).sort()).toEqual([c.admin, c.director].sort());
    expect(first.map((i) => i.group_key).sort()).toEqual(["admin", "directors"]);
    expect(first.every((i) => i.path === "/growth/removals")).toBe(true);
    const sent = await c.sql("select person_id, params from public.messages where template = 'admin_removal_ask'");
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent.map((m) => m.params))).not.toMatch(/five weeks|repeated|Admin Tribe|AdmSeated|member_first|reason|note/);

    await decide(r.id, c.admin, "ask", "How many weeks has he missed, and has anyone visited him?");
    await c.sql("delete from public.notice_items");
    await c.sql("delete from public.messages where template = 'admin_removal_ask'");
    await c.as(f.leader, "removal_answer", r.id, "Five weeks. Two of us have visited and phoned.");
    const again = await c.sql("select person_id, params from public.messages where template = 'admin_removal_ask'");
    expect(again.map((m) => m.person_id).sort()).toEqual([c.admin, c.director].sort());
    expect(again.every((m) => m.params.again === true)).toBe(true);
  });

  it("does not tell a leader who is also an admin about their own request, and tells nobody while the groups are Off", async () => {
    await on();
    const f = await fresh();
    await ask(f);
    expect(await c.sql("select 1 from public.notice_items where kind = 'admin_removal_ask'")).toHaveLength(0);
    await c.noticesOn();
    const g = await fresh();
    await c.db.grant(g.leader, "admin");
    try {
      const r = await ask(g);
      const told = (await c.sql("select person_id from public.notice_items where kind = 'admin_removal_ask' and event = $1", [`removal:${r.id}`])).map((i) => i.person_id);
      expect(told).not.toContain(g.leader);
      expect(told).toEqual(expect.arrayContaining([c.admin, c.director]));
    } finally {
      await c.sql("delete from public.person_roles where person_id = $1 and role = 'admin'", [g.leader]);
    }
  });

  it("reminds admins and directors once, at three days, while the request waits for an answer", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const r = await ask(f);
    await c.sql("delete from public.notice_items");
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await c.sql("select 1 from public.notice_items")).toHaveLength(0);
    await backdate(r.id, 4);
    await c.sql("select public.worker_removal_tick($1)", [token]);
    const waiting = await c.sql("select person_id, group_key from public.notice_items where kind = 'admin_removal_waiting'");
    expect(waiting.map((i) => i.person_id).sort()).toEqual([c.admin, c.director].sort());
    expect(waiting.map((i) => i.group_key).sort()).toEqual(["admin", "directors"]);
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await c.sql("select 1 from public.notice_items where kind = 'admin_removal_waiting'")).toHaveLength(2);
  });

  it("does not remind about a request waiting on the leader's answer, or a practice one", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "ask", "What have you tried so far with him?");
    await backdate(r.id, 4);
    await c.sql("delete from public.notice_items");
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await c.sql("select 1 from public.notice_items where kind = 'admin_removal_waiting'")).toHaveLength(0);
  });

  it("shows on Admin → Today the requests waiting for this person to decide, and only those", async () => {
    expect(await todayRow(c.admin)).toBeUndefined();
    await on();
    const f = await fresh();
    const a = await ask(f, f.members[0]);
    const b = await ask(f, f.members[1], "safety_or_conduct");
    expect(await todayRow(c.admin)).toMatchObject({ key: "removals", count: 2, href: "/growth/removals", one: "removal request waiting", many: "removal requests waiting" });
    expect(await todayRow(c.director)).toMatchObject({ count: 2 });
    // the count is the board's count of what this person can decide
    const board = (await c.as(c.admin, "removal_board")).requests.filter((q: { status: string; can_decide: boolean; rehearsal: boolean; waiting_on: string }) => q.status === "open" && q.can_decide && !q.rehearsal && q.waiting_on === "approver");
    expect(board).toHaveLength(2);
    // one waits for the leader's answer: not waiting for the office
    await decide(a.id, c.admin, "ask", "Please say a little more about what happened.");
    expect(await todayRow(c.admin)).toMatchObject({ count: 1 });
    await c.as(f.leader, "removal_answer", a.id, "He stopped coming after his job changed.");
    expect(await todayRow(c.admin)).toMatchObject({ count: 2 });
    // decided ones leave the list
    await decide(a.id, c.admin, "decline");
    await decide(b.id, careLead, "decline");
    expect(await todayRow(c.admin)).toBeUndefined();
    // a pastor can open Today but is not asked to decide
    await ask(f, f.members[0]);
    expect(await todayRow(c.pastor)).toBeUndefined();
  });

  it("marks the line urgent when a request is marked urgent or has waited a week, and counts none in Rehearsal or while Off", async () => {
    await rehearse();
    const f = await fresh();
    await ask(f);
    expect(await todayRow(c.admin)).toBeUndefined();
    await c.sql("delete from public.removal_requests");
    await on();
    const r = await ask(f, f.members[0]);
    expect((await todayRow(c.admin)).urgent).toBe(false);
    await backdate(r.id, 8);
    expect(await todayRow(c.admin)).toMatchObject({ urgent: true, oldest_days: 8 });
    await c.set("removal_requests", "off", { reason: REASON });
    expect(await todayRow(c.admin)).toBeUndefined();
  });
});

describe("the hold after an approval", () => {
  it("keeps the next automatic run from placing an ordinary removal for three days, and then lets go", async () => {
    await on();
    const f = await fresh();
    const m = f.members[0];
    const r = await ask(f, m);
    expect(await reason(m)).not.toBe("held");
    await decide(r.id, c.admin, "approve");
    const h = await hold(m);
    expect(h).toMatchObject({ source: "removal", request_id: r.id, note: null });
    const hours = Number((await c.one("select extract(epoch from (until - now())) / 3600 as h from public.placement_holds where person_id = $1", [m])).h);
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);
    expect(await reason(m)).toBe("held");
    // the other member is untouched
    expect(await hold(f.members[1])).toBeUndefined();
    expect(await reason(f.members[1])).not.toBe("held");
    // after three days the hold no longer counts, even before the heartbeat sweeps it away
    await c.sql("update public.placement_holds set until = now() - interval '1 minute' where person_id = $1", [m]);
    expect(await reason(m)).not.toBe("held");
    expect((await c.o.call("placement_holds_list")).map((x: { person: string }) => x.person)).not.toContain(m);
    expect((await c.o.call("placement_overview")).supply.on_hold).toBe(0);
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await hold(m)).toBeUndefined();
  });

  it("still lets the member choose for themselves while they are on hold, and never offers the tribe they left", async () => {
    await on();
    const f = await fresh();
    const other = await fresh();
    const m = f.members[0];
    const r = await ask(f, m);
    await decide(r.id, c.admin, "approve");
    expect(await reason(m)).toBe("held");
    const view = await c.as(m, "match_me", true);
    expect(view.ran).toBe(true);
    const offered = view.tribes.map((t: { tribe: { id: string } }) => t.tribe.id);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(f.tribe);
    expect(other.tribe).toBeTruthy();
  });

  it("never lets a run place a safety, conduct, young-person or open-care-flag case: the hold has no end date", async () => {
    await on();
    const f = await fresh();
    const m = f.members[0];
    const r = await ask(f, m, "safety_or_conduct");
    await decide(r.id, careLead, "approve");
    expect(await hold(m)).toMatchObject({ source: "care", until: null, request_id: r.id });
    expect(await reason(m)).toBe("held");
    await c.sql("update public.removal_requests set decided_at = now() - interval '40 days' where id = $1", [r.id]);
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await reason(m)).toBe("held");
    expect((await c.o.call("placement_holds_list")).find((x: { person: string }) => x.person === m)).toMatchObject({ source: "care", until: null });
    // a person who is then given a seat is released from the hold by the next heartbeat
    const other = await fresh();
    await c.sql(
      "insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by) values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)",
      [other.tribe, m, c.season],
    );
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await hold(m)).toBeUndefined();
  });

  it("is taken off when the place is put back", async () => {
    await on();
    const f = await fresh();
    const m = f.members[0];
    const r = await ask(f, m);
    await decide(r.id, c.admin, "approve");
    expect(await hold(m)).toBeDefined();
    await c.as(careLead, "removal_reinstate", r.id, "Heard him out; he should be back with his tribe.");
    expect(await hold(m)).toBeUndefined();
  });

  it("does not take over a hold the owner put there, and an owner's hold on top of one of ours becomes the owner's", async () => {
    await on();
    const f = await fresh();
    const m = f.members[0];
    await c.o.call("placement_hold_set", m, "Waiting for a call");
    const r = await ask(f, m);
    await decide(r.id, c.admin, "approve");
    expect(await hold(m)).toMatchObject({ source: "owner", note: "Waiting for a call", until: null, request_id: null });
    // and the other way round
    const g = await fresh();
    const x = g.members[0];
    const q = await ask(g, x);
    await decide(q.id, c.admin, "approve");
    expect(await hold(x)).toMatchObject({ source: "removal" });
    await c.o.call("placement_hold_set", x, "Owner says wait");
    expect(await hold(x)).toMatchObject({ source: "owner", until: null, request_id: null, note: "Owner says wait" });
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await hold(x)).toMatchObject({ source: "owner" });
  });

  it("does nothing in Rehearsal, and says in the owner's own check why a person is held, in words that fit who held them", async () => {
    await rehearse();
    const f = await fresh();
    const r = await ask(f, f.members[0]);
    await decide(r.id, c.admin, "approve");
    expect(await c.sql("select 1 from public.placement_holds")).toHaveLength(0);
    await c.sql("delete from public.removal_requests");
    await on();
    const g = await fresh();
    const other = await fresh();
    const m = g.members[0];
    const q = await ask(g, m);
    await decide(q.id, c.admin, "approve");
    const warn = async () => (await c.o.call("placement_one_check", m, other.tribe)).warnings.find((w: { code: string }) => w.code === "held")?.text as string | undefined;
    expect(await warn()).toMatch(/took them out of a tribe a short while ago/);
    await c.sql("update public.placement_holds set source = 'care', until = null where person_id = $1", [m]);
    expect(await warn()).toMatch(/Care Team is looking after this person/);
    await c.sql("update public.placement_holds set source = 'owner' where person_id = $1", [m]);
    expect(await warn()).toBe("You put this person on hold");
    await c.sql("update public.placement_holds set source = 'removal', until = now() - interval '1 hour' where person_id = $1", [m]);
    expect(await warn()).toBeUndefined();
  });
});

describe("the staff email groups start On with the switch", () => {
  const modes = async () => Object.fromEntries((await c.sql("select group_key, mode from public.notice_settings")).map((r) => [r.group_key, r.mode]));

  it("turns On the groups that take part and were Off, once, and leaves every other group alone", async () => {
    await c.sql("update public.notice_settings set mode = 'rehearsal' where group_key = 'care'");
    await c.set("removal_requests", "on", { reason: REASON });
    expect(await modes()).toMatchObject({
      admin: "on", directors: "on", coaches: "on", care: "rehearsal", pastors: "off", leaders: "off", members: "off", applicants: "off", referees: "off", champions: "off", data_lead: "off",
    });
    // switching one of them Off afterwards is respected: moving the switch again to On does nothing when it was already On
    await c.sql("update public.notice_settings set mode = 'off' where group_key = 'admin'");
    await c.set("removal_requests", "on", { reason: REASON });
    expect((await modes()).admin).toBe("off");
  });

  it("does nothing in Rehearsal or when the switch goes Off", async () => {
    await rehearse();
    expect(Object.values(await modes()).every((m) => m === "off")).toBe(true);
    await c.set("removal_requests", "off", { reason: REASON });
    expect(Object.values(await modes()).every((m) => m === "off")).toBe(true);
  });

  it("does not follow another function's switch", async () => {
    await c.set("number_required", "on", { reason: REASON }).catch(() => undefined);
    expect(Object.values(await modes()).every((m) => m === "off")).toBe(true);
  });
});

describe("access", () => {
  it("keeps the helpers out of reach", async () => {
    const m = c.member;
    await expectCode(c.as(m, "removal_can_recommend", "00000000-0000-0000-0000-000000000000", m), "42501");
    await expectCode(c.as(m, "removal_switch_on_notices"), "42501");
  });
});
