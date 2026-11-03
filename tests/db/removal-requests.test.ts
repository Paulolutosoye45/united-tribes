import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// WhatsApp that cannot fail quietly, stage 4: leader removal requests. What these prove:
//   * it ships Off, and Off means no function answers, nothing is written, and the matching is as it was
//   * only the leader of a tribe (not the assistant) can ask, with a reason, 20 to 500 characters, "I have spoken to them", and at most two open
//   * the Care Lead, a director or an admin decides; the coach of the tribe only RECOMMENDS an ordinary request (a request about safety, someone under 18
//     or a member with an open care flag is not the coach's to recommend on); a pastor reads all; nobody decides their own or one about themselves
//   * approve / decline / ask the leader a question, always with a note; silence never removes anyone
//   * approved: the seat is released, nothing the member wrote or did is touched, the member is told kindly (never the reason or the note) and offered other tribes
//     but never that one, the leader is told; declined: the member is told nothing
//   * the member has 14 days to ask the Care Lead to look again, and the seat can be put back
//   * reminders at day 3, escalation at day 7, the leader's words cleared after 12 months
//   * Rehearsal walks the whole road with nothing released and no one written to

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
  token = (await c.one("select public.bootstrap_worker_token('test-removal-requests') as t")).t;
}, 120_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.reset();
  await c.sql("delete from public.removal_requests");
  await c.sql("delete from public.messages");
  await c.sql("delete from public.notice_items");
  await c.sql("update public.notice_settings set mode = 'off'");
});

const REASON = "Trying removal requests with everyone";
/** Switches it On the way the owner does (which also starts the staff email groups that take part), then puts the groups back as they were so each test says for itself when notices go out. */
const on = async () => {
  const before = await c.sql("select group_key, mode from public.notice_settings");
  await c.set("removal_requests", "on", { reason: REASON });
  for (const g of before) await c.sql("update public.notice_settings set mode = $2 where group_key = $1", [g.group_key, g.mode]);
};
const rehearse = () => c.set("removal_requests", "rehearsal", { reason: REASON });
const NOTE = "He has missed five weeks and does not answer calls, and I have asked twice.";
const WHY = "Looked at this carefully and agree with the leader.";

type Fresh = { leader: string; tribe: string; members: string[]; assistant: string | null };

/** A tribe with a leader, the coach, and two members who fit it (so the matching can offer it). */
async function fresh(over: { assistant?: boolean; coach?: string | null } = {}): Promise<Fresh> {
  const t = await c.k.tribe(c.season, { name: `Tribe ${++n}`, track: "builders", assistant: over.assistant ? "certified" : undefined });
  await c.sql("update public.tribes set coach_id = $2 where id = $1", [t.tribe, over.coach === undefined ? coach : over.coach]);
  const a = await c.k.seat(t.tribe, c.season, `Seated${++n}`);
  const b = await c.k.seat(t.tribe, c.season, `Seated${++n}`);
  await c.sql("delete from public.messages");
  return { leader: t.leader.id, tribe: t.tribe, members: [a.id, b.id], assistant: t.assistant?.id ?? null };
}

const ask = (f: Fresh, member = f.members[0], over: { reason?: string; note?: string; spoken?: boolean; urgent?: boolean; by?: string } = {}) =>
  c.as(over.by ?? f.leader, "removal_ask", f.tribe, member, over.reason ?? "repeated_absence", over.note ?? NOTE, over.spoken ?? true, over.urgent ?? false);
const decide = (id: string, who: string, decision: string, note = WHY) => c.as(who, "removal_decide", id, decision, note);
const seat = async (person: string, tribe: string) => (await c.one("select status, release_reason from public.tribe_members where person_id = $1 and tribe_id = $2", [person, tribe]));
const mails = (template: string, person?: string) =>
  c.sql("select person_id, params, force_channel, channel from public.messages where template = $1 and ($2::uuid is null or person_id = $2) order by created_at", [template, person ?? null]);
const candidates = async (person: string) => (await c.sql("select r_tribe from public.match_candidates($1)", [person])).map((r) => r.r_tribe as string);
const placers = async (person: string) => (await c.sql("select r_tribe from public.placement_candidates($1, null)", [person])).map((r) => r.r_tribe as string);
const row = async (id: string) => c.one("select * from public.removal_requests where id = $1", [id]);
const backdate = (id: string, days: number) => c.sql("update public.removal_requests set created_at = now() - make_interval(days => $2::int) where id = $1", [id, days]);

describe("it ships Off", () => {
  it("is on the Switchboard for the whole church, starts Off, and offers Off, Rehearsal and On", async () => {
    const r = await c.one("select * from public.feature_registry where key = 'removal_requests'");
    expect(r).toMatchObject({ default_mode: "off", available: true, platform_only: true, stage: 8 });
    expect(r.modes).toEqual(["off", "rehearsal", "on"]);
    expect((await c.one("select public.feature_platform_state('removal_requests') as s")).s).toBe("off");
  });

  it("changes nothing: no door opens, nothing is kept, and the matching is as it was", async () => {
    const f = await fresh();
    await expectCode(ask(f), "22023");
    expect(await c.as(f.leader, "removal_mine", f.tribe)).toMatchObject({ state: "off", can_ask: false, requests: [] });
    expect(await c.as(careLead, "removal_board")).toEqual({ state: "off", requests: [] });
    expect(await c.as(f.members[0], "my_removal")).toBeNull();
    expect(await c.sql("select 1 from public.removal_requests")).toHaveLength(0);
    expect(await c.one("select public.removal_tick() as r").then((r) => r.r)).toMatchObject({ on: false });
    expect(await candidates(f.members[0])).toContain(f.tribe);
  });
});

describe("the ask", () => {
  it("is recorded with its reason, note and the leader's word that they have spoken", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    expect(r).toMatchObject({ ok: true, rehearsal: false, restricted: false });
    expect(await row(r.id)).toMatchObject({ tribe_id: f.tribe, member_id: f.members[0], asked_by: f.leader, reason: "repeated_absence", status: "open", waiting_on: "approver", spoken: true, rehearsal: false });
    expect((await row(r.id)).note).toBe(NOTE);
    // the event log keeps the fact, never the note
    const events = await c.sql("select action, meta from public.event_log where action like 'removal.%' order by id");
    expect(events.map((e) => e.action)).toContain("removal.asked");
    expect(JSON.stringify(events)).not.toMatch(/five weeks|does not answer/);
  });

  it("is only the tribe's leader to ask: not the assistant, a member, the coach, or the office", async () => {
    await on();
    const f = await fresh({ assistant: true });
    await expectCode(ask(f, f.members[0], { by: f.assistant! }), "42501");
    await expectCode(ask(f, f.members[0], { by: f.members[1] }), "42501");
    await expectCode(ask(f, f.members[0], { by: coach }), "42501");
    await expectCode(ask(f, f.members[0], { by: c.admin }), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.removal_ask($1, $2, 'other', $3, true, false)", [f.tribe, f.members[0], NOTE])), "42501");
    expect(await c.sql("select 1 from public.removal_requests")).toHaveLength(0);
  });

  it("needs a real member of the tribe, a reason, 20 to 500 characters and the word that they have spoken", async () => {
    await on();
    const f = await fresh();
    const other = await fresh();
    await expectCode(ask(f, other.members[0]), "22023"); // not in this tribe
    await expectCode(ask(f, f.leader), "22023"); // themselves
    await expectCode(ask(f, f.members[0], { reason: "because" }), "22023");
    await expectCode(ask(f, f.members[0], { note: "Too short." }), "22023");
    await expectCode(ask(f, f.members[0], { note: "x".repeat(501) }), "22023");
    await expectCode(ask(f, f.members[0], { spoken: false }), "22023");
    await expect(ask(f, f.members[0], { spoken: false })).rejects.toThrow(/speak to this person first/);
    expect(await c.sql("select 1 from public.removal_requests")).toHaveLength(0);
    await ask(f, f.members[0], { note: "x".repeat(20) });
  });

  it("allows two open requests at most, one per member, and a withdrawn one frees the place", async () => {
    await on();
    const f = await fresh();
    const third = await c.k.seat(f.tribe, c.season, `Third${++n}`);
    const one = await ask(f, f.members[0]);
    await expectCode(ask(f, f.members[0]), "22023"); // already waiting
    await ask(f, f.members[1]);
    await expectCode(ask(f, third.id), "22023"); // two open already
    await expect(ask(f, third.id)).rejects.toThrow(/two requests waiting/);
    await c.as(f.leader, "removal_withdraw", one.id);
    expect((await row(one.id)).status).toBe("withdrawn");
    await ask(f, third.id);
  });

  it("goes to the narrow list for safety or conduct, for someone under 18, and for a member with an open care flag", async () => {
    await on();
    const f = await fresh();
    expect((await ask(f, f.members[0], { reason: "safety_or_conduct" })).restricted).toBe(true);
    // someone under 18 (the teen track is closed in the test database, so the range is set the way the activity tests do)
    await c.db.admin.query("begin");
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [f.members[1]]);
    await c.db.admin.query("commit");
    expect((await ask(f, f.members[1])).restricted).toBe(true);
    const g = await fresh();
    expect((await ask(g, g.members[0])).restricted).toBe(false);
    const h = await fresh();
    await c.sql("insert into public.care_flags (tribe_id, person_id, kind, status) values ($1, $2, 'missed_twice', 'open')", [h.tribe, h.members[0]]);
    expect((await ask(h, h.members[0])).restricted).toBe(true);
    await c.sql("update public.care_flags set status = 'closed' where tribe_id = $1", [h.tribe]);
    expect((await ask(h, h.members[1])).restricted).toBe(false);
  });

  it("raises the existing urgent care alert when marked urgent, and only then", async () => {
    await on();
    const f = await fresh();
    await ask(f, f.members[0]);
    expect(await c.sql("select 1 from public.care_tasks where tribe_id = $1 and kind = 'urgent'", [f.tribe])).toHaveLength(0);
    await ask(f, f.members[1], { urgent: true });
    const t = await c.sql("select person_id, status from public.care_tasks where tribe_id = $1 and kind = 'urgent'", [f.tribe]);
    expect(t).toEqual([{ person_id: f.members[1], status: "open" }]);
    expect((await mails("care_urgent")).length).toBeGreaterThan(0);
  });

  it("tells the people who decide through the notice engine, without a name or a reason", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const r = await ask(f);
    const items = await c.sql("select person_id, group_key, kind, path from public.notice_items where event = $1 order by kind", [`removal:${r.id}`]);
    // the Care Team, the coach and (new) every admin and director, each once
    expect(items.map((i) => i.kind)).toEqual(["admin_removal_ask", "admin_removal_ask", "care_removal_ask", "coach_removal_ask"]);
    expect(items.find((i) => i.kind === "coach_removal_ask")!.person_id).toBe(coach);
    expect(items.filter((i) => i.kind === "admin_removal_ask").map((i) => i.person_id).sort()).toEqual([c.admin, c.director].sort());
    expect(items.filter((i) => i.kind === "admin_removal_ask").map((i) => i.group_key).sort()).toEqual(["admin", "directors"]);
    expect(items.every((i) => i.path === "/growth/removals")).toBe(true);
    // the narrow list: the Care Team and the office, but not the coach, who has no part in these
    await c.sql("delete from public.notice_items");
    const g = await fresh();
    const r2 = await ask(g, g.members[0], { reason: "safety_or_conduct" });
    expect((await c.sql("select kind from public.notice_items where event = $1 order by kind", [`removal:${r2.id}`])).map((i) => i.kind)).toEqual(["admin_removal_ask", "admin_removal_ask", "care_removal_ask"]);
  });

  it("is the leader's own view: their requests, how many are waiting, and the question put to them", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    const mine = await c.as(f.leader, "removal_mine", f.tribe);
    expect(mine).toMatchObject({ state: "on", can_ask: true, open: 1, max: 2 });
    expect(mine.requests).toHaveLength(1);
    expect(mine.requests[0]).toMatchObject({ id: r.id, status: "open", waiting_on: "approver", question: null });
    // nobody else sees it, and an assistant cannot ask
    expect(await c.as(coach, "removal_mine", f.tribe)).toMatchObject({ can_ask: false, requests: [] });
    expect(await c.as(f.members[1], "removal_mine", f.tribe)).toMatchObject({ can_ask: false, requests: [] });
  });
});

describe("who decides", () => {
  it("lets the Care Lead, a director and an admin decide an ordinary request, and not the coach, a pastor, a stranger, the leader or the member", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    for (const who of [coach, coach2, c.pastor, f.members[1], c.member, f.leader, f.members[0]]) await expectCode(decide(r.id, who, "decline"), "42501");
    expect(await row(r.id)).toMatchObject({ status: "open" });
    // the coach's own board does not offer to decide, only to recommend
    expect((await c.as(coach, "removal_board")).requests.find((q: { id: string }) => q.id === r.id)).toMatchObject({ can_decide: false, can_recommend: true });
    await decide(r.id, c.admin, "decline");
    for (const who of [careLead, c.director, c.admin]) {
      const g = await fresh();
      const q = await ask(g);
      await decide(q.id, who, "decline");
      expect((await row(q.id)).status).toBe("declined");
    }
  });

  it("keeps a restricted request to the Care Lead, a director and an admin: the coach can read it but not decide it", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f, f.members[0], { reason: "safety_or_conduct" });
    await expectCode(decide(r.id, coach, "approve"), "42501");
    await expectCode(decide(r.id, c.pastor, "approve"), "42501");
    const asCoach = (await c.as(coach, "removal_board")).requests.find((q: { id: string }) => q.id === r.id);
    expect(asCoach).toMatchObject({ restricted: true, can_decide: false, can_recommend: false });
    expect((await c.as(c.pastor, "removal_board")).requests.find((q: { id: string }) => q.id === r.id)).toMatchObject({ can_decide: false });
    expect((await c.as(careLead, "removal_board")).requests.find((q: { id: string }) => q.id === r.id)).toMatchObject({ can_decide: true });
    await decide(r.id, careLead, "approve");
    expect((await row(r.id)).status).toBe("approved");
  });

  it("never lets anyone decide a request they asked or that is about them, whatever their role", async () => {
    await on();
    const f = await fresh();
    // the leader is also the coach of their own tribe, and the member is also a Care Lead
    await c.sql("update public.tribes set coach_id = leader_id where id = $1", [f.tribe]);
    await c.db.grant(f.members[0], "care_lead");
    await c.db.grant(f.leader, "director");
    try {
      const r = await ask(f);
      await expectCode(decide(r.id, f.leader, "approve"), "42501");
      await expectCode(decide(r.id, f.members[0], "decline"), "42501");
      expect((await c.as(f.members[0], "removal_board")).requests.map((q: { id: string }) => q.id)).not.toContain(r.id);
      await decide(r.id, careLead, "decline");
    } finally {
      await c.sql("delete from public.person_roles where person_id = any($1::uuid[]) and role in ('care_lead', 'director')", [[f.members[0], f.leader]]);
    }
  });

  it("shows the board to those who may read: the coach of the tribe only, every pastor, the Care Lead, directors and admins, never the member", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    const ids = async (who: string) => (await c.as(who, "removal_board")).requests.map((q: { id: string }) => q.id);
    for (const who of [coach, c.pastor, careLead, c.director, c.admin, f.leader]) expect(await ids(who), who).toContain(r.id);
    for (const who of [coach2, c.member, f.members[0], f.members[1]]) expect(await ids(who), who).not.toContain(r.id);
    const card = (await c.as(careLead, "removal_board")).requests.find((q: { id: string }) => q.id === r.id);
    expect(card).toMatchObject({ tribe: expect.any(String), reason: "repeated_absence", note: NOTE, can_decide: true, status: "open", under_18: false });
    expect(card.attendance).toEqual({ present: 0, absent: 0, excused: 0 });
  });
});

describe("the answer", () => {
  it("needs a note, and one of approve, decline or ask", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await expectCode(decide(r.id, c.admin, "approve", "ok"), "22023");
    await expectCode(decide(r.id, c.admin, "decline", "x".repeat(501)), "22023");
    await expectCode(decide(r.id, c.admin, "maybe"), "22023");
    expect((await row(r.id)).status).toBe("open");
  });

  it("asks the leader a question, hears the answer, and does not decide anything meanwhile", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "ask", "How many weeks has he missed, and has anyone visited him?");
    expect(await row(r.id)).toMatchObject({ status: "open", waiting_on: "leader" });
    await expectCode(decide(r.id, c.admin, "ask", "Another question for you again."), "22023");
    expect((await c.as(f.leader, "removal_mine", f.tribe)).requests[0]).toMatchObject({ waiting_on: "leader", question: "How many weeks has he missed, and has anyone visited him?" });
    const told = await mails("removal_leader_decided", f.leader);
    expect(told).toHaveLength(1);
    expect(told[0].params).toMatchObject({ decision: "question", member_first: expect.any(String), tribe: expect.any(String) });
    expect(JSON.stringify(told[0].params)).not.toContain("five weeks");
    // only the leader answers, and only while a question is waiting
    await expectCode(c.as(coach, "removal_answer", r.id, "I am the coach"), "42501");
    await c.as(f.leader, "removal_answer", r.id, "Five weeks. Two of us have visited and phoned.");
    expect(await row(r.id)).toMatchObject({ status: "open", waiting_on: "approver" });
    await expectCode(c.as(f.leader, "removal_answer", r.id, "Again?"), "22023");
    const thread = (await c.as(careLead, "removal_board")).requests.find((q: { id: string }) => q.id === r.id).thread;
    expect(thread.map((t: { side: string }) => t.side)).toEqual(["approver", "leader"]);
    // the member knows nothing of this
    expect(await c.sql("select 1 from public.messages where person_id = $1", [f.members[0]])).toHaveLength(0);
  });

  it("declines: the leader is told, the member is told nothing, and the seat stays", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "decline", "Please keep visiting him. He is going through a hard time.");
    expect(await row(r.id)).toMatchObject({ status: "declined", decided_by: c.admin });
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    const told = await mails("removal_leader_decided", f.leader);
    expect(told[0].params).toMatchObject({ decision: "declined" });
    expect(told[0].force_channel).toBe("email");
    expect(await c.sql("select 1 from public.messages where person_id = $1", [f.members[0]])).toHaveLength(0);
    expect((await c.as(f.leader, "removal_mine", f.tribe)).requests[0]).toMatchObject({ status: "declined", decision_note: "Please keep visiting him. He is going through a hard time." });
    expect(await c.as(f.members[0], "my_removal")).toBeNull();
    // asking again later is allowed
    await ask(f);
  });

  it("is answered once, and a withdrawn request cannot be answered", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "decline");
    await expectCode(decide(r.id, careLead, "approve"), "22023");
    const g = await fresh();
    const q = await ask(g);
    await c.as(g.leader, "removal_withdraw", q.id);
    await expectCode(decide(q.id, c.admin, "approve"), "22023");
    await expectCode(c.as(f.leader, "removal_withdraw", q.id), "42501");
  });

  it("approves: the seat is released and nothing the member wrote or did is touched", async () => {
    await on();
    const f = await fresh();
    const m = f.members[0];
    await c.sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 'test')", [m]);
    await c.k.meetings(f.tribe, f.leader, 3, [[m, 2]]);
    await c.sql("insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit) values ($1, $2, 1, $3, 'tribe', 'first_name')", [m, f.tribe, "God was good to me in week one of this tribe, truly."]);
    const before = {
      attendance: (await c.one("select count(*)::int n from public.tribe_attendance where person_id = $1", [m])).n,
      testimonies: (await c.one("select count(*)::int n from public.testimonies where person_id = $1", [m])).n,
      consents: (await c.one("select count(*)::int n from public.consents where person_id = $1", [m])).n,
      profile: (await c.one("select count(*)::int n from public.member_profiles where person_id = $1", [m])).n,
    };
    expect(before).toEqual({ attendance: 3, testimonies: 1, consents: 1, profile: 1 });
    const r = await ask(f);
    await decide(r.id, c.admin, "approve");
    expect(await seat(m, f.tribe)).toMatchObject({ status: "released", release_reason: "Place changed by the church" });
    expect((await row(r.id)).status).toBe("approved");
    expect((await c.one("select count(*)::int n from public.tribe_attendance where person_id = $1", [m])).n).toBe(before.attendance);
    expect((await c.one("select count(*)::int n from public.testimonies where person_id = $1", [m])).n).toBe(before.testimonies);
    expect((await c.one("select count(*)::int n from public.consents where person_id = $1", [m])).n).toBe(before.consents);
    expect((await c.one("select count(*)::int n from public.member_profiles where person_id = $1", [m])).n).toBe(before.profile);
    // the roster no longer lists them; the other member stays
    const roster = await c.as(f.leader, "tribe_roster", f.tribe);
    expect(roster.members.map((x: { person_id: string }) => x.person_id)).toEqual([f.members[1]]);
    expect((await c.as(m, "my_match")).placement).toBeNull();
  });

  it("tells the member kindly with a named person, never the reason or the leader's note, and tells the leader", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f, f.members[0], { reason: "conflict" });
    await decide(r.id, c.admin, "approve", "Agreed, the note is clear. Handled with care.");
    const told = await mails("removal_member_told", f.members[0]);
    expect(told).toHaveLength(1);
    expect(told[0].force_channel).toBe("email");
    expect(told[0].params).toMatchObject({ tribe: expect.any(String), contact_first: "CareLead", appeal_days: 14 });
    const text = JSON.stringify(told[0].params);
    expect(text).not.toContain("conflict");
    expect(text).not.toContain("five weeks");
    expect(text).not.toContain("Handled with care");
    expect(Object.keys(told[0].params).sort()).toEqual(["appeal_days", "contact_first", "tribe"]);
    const leader = await mails("removal_leader_decided", f.leader);
    expect(leader).toHaveLength(1);
    expect(leader[0].params).toMatchObject({ decision: "approved" });
    expect(Object.keys(leader[0].params).sort()).toEqual(["decision", "member_first", "tribe"]);
    // the other member and the tribe's staff are told nothing by message
    expect(await c.sql("select 1 from public.messages where person_id in ($1, $2)", [f.members[1], coach])).toHaveLength(0);
  });

  it("offers the member other tribes but never that one, in the matching and in the placement", async () => {
    await on();
    const f = await fresh();
    const other = await fresh();
    const m = f.members[0];
    expect(await candidates(m)).toEqual(expect.arrayContaining([f.tribe, other.tribe]));
    expect(await placers(m)).toEqual(expect.arrayContaining([f.tribe, other.tribe]));
    const r = await ask(f);
    await decide(r.id, c.admin, "approve");
    const after = await candidates(m);
    expect(after).toContain(other.tribe);
    expect(after).not.toContain(f.tribe);
    expect(await placers(m)).not.toContain(f.tribe);
    // and the other member of the tribe is not affected
    expect(await candidates(f.members[1])).toContain(f.tribe);
    // a fresh look at the tribes is made for them, without the old ones
    const view = await c.as(m, "match_me", true);
    expect(view.ran).toBe(true);
    expect(view.tribes.map((t: { tribe: { id: string } }) => t.tribe.id)).not.toContain(f.tribe);
  });

  it("does not write to a young person: the Care Lead speaks to their parent or guardian", async () => {
    await on();
    const f = await fresh();
    await c.db.admin.query("begin");
    await c.db.admin.query("set local session_replication_role = replica");
    await c.db.admin.query("update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1", [f.members[0]]);
    await c.db.admin.query("commit");
    const r = await ask(f);
    expect(r.restricted).toBe(true);
    await expectCode(decide(r.id, coach, "approve"), "42501");
    await decide(r.id, careLead, "approve");
    expect((await seat(f.members[0], f.tribe)).status).toBe("released");
    expect(await mails("removal_member_told")).toHaveLength(0);
    expect(await c.as(f.members[0], "my_removal")).toBeNull();
    expect(await mails("removal_leader_decided", f.leader)).toHaveLength(1);
  });
});

describe("rehearsal", () => {
  it("walks the road as practice: nothing is released, no one is written to, and practice does not count against the leader's two", async () => {
    await rehearse();
    const f = await fresh();
    const r = await ask(f, f.members[0], { urgent: true });
    expect(r.rehearsal).toBe(true);
    expect(await c.sql("select 1 from public.care_tasks where tribe_id = $1", [f.tribe])).toHaveLength(0);
    await decide(r.id, c.admin, "ask", "A practice question for you here.");
    await c.as(f.leader, "removal_answer", r.id, "A practice answer back to you.");
    await decide(r.id, c.admin, "approve");
    expect(await row(r.id)).toMatchObject({ status: "approved", rehearsal: true });
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    expect(await c.sql("select 1 from public.removal_blocks")).toHaveLength(0);
    expect(await c.sql("select 1 from public.messages where template like 'removal_%' or template = 'care_urgent'")).toHaveLength(0);
    expect(await c.as(f.members[0], "my_removal")).toBeNull();
    expect(await candidates(f.members[0])).toContain(f.tribe);
    // the practice ones are not counted once it is On
    await ask(f, f.members[1]);
    await on();
    expect(await c.as(f.leader, "removal_mine", f.tribe)).toMatchObject({ state: "on", open: 0 });
    await ask(f, f.members[0]);
    await ask(f, f.members[1]);
  });
});

describe("the member's side", () => {
  async function removed() {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "approve");
    return { f, id: r.id as string, m: f.members[0] };
  }

  it("is told in the app too: the tribe, the day, a named person and the days left to ask", async () => {
    const { m, id } = await removed();
    const v = await c.as(m, "my_removal");
    expect(v).toMatchObject({ id, contact_first: "CareLead", reinstated: false, appeal: null, can_appeal: true });
    expect(v.tribe).toEqual(expect.any(String));
    expect(JSON.stringify(v)).not.toMatch(/five weeks|repeated_absence|note/i);
    // another member sees nothing
    expect(await c.as(c.member, "my_removal")).toBeNull();
  });

  it("can ask the Care Lead to look again within 14 days, once", async () => {
    await c.noticesOn();
    const { m, id } = await removed();
    await c.as(m, "removal_appeal", id, "I was ill and did not know how to say so.");
    expect(await row(id)).toMatchObject({ appeal_status: "open", appeal_note: "I was ill and did not know how to say so." });
    expect((await c.as(m, "my_removal")).appeal).toMatchObject({ status: "open" });
    await expectCode(c.as(m, "removal_appeal", id, "Again"), "22023");
    expect((await c.sql("select kind from public.notice_items where kind = 'care_removal_appeal'")).length).toBeGreaterThan(0);
  });

  it("cannot ask after 14 days, or for someone else's, or for a request that was declined", async () => {
    const { f, m, id } = await removed();
    await c.sql("update public.removal_requests set decided_at = now() - interval '15 days' where id = $1", [id]);
    await expectCode(c.as(m, "removal_appeal", id, null), "22023");
    expect((await c.as(m, "my_removal")).can_appeal).toBe(false);
    await expectCode(c.as(f.members[1], "removal_appeal", id, null), "22023");
    const g = await fresh();
    const q = await ask(g);
    await decide(q.id, c.admin, "decline");
    await expectCode(c.as(g.members[0], "removal_appeal", q.id, null), "22023");
  });

  it("stops showing after 30 days", async () => {
    const { m, id } = await removed();
    await c.sql("update public.removal_requests set decided_at = now() - interval '31 days' where id = $1", [id]);
    expect(await c.as(m, "my_removal")).toBeNull();
  });
});

describe("putting the seat back", () => {
  async function removed() {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "approve");
    return { f, id: r.id as string, m: f.members[0] };
  }

  it("is done by the Care Lead, a director, an admin or whoever approved it, with a note, and tells the member and the leader", async () => {
    for (const who of [careLead, c.director, c.admin]) {
      const { f, id, m } = await removed();
      await c.sql("delete from public.messages");
      await expectCode(c.as(who, "removal_reinstate", id, "short"), "22023");
      await c.as(who, "removal_reinstate", id, "Heard her out; she should be back with her tribe.");
      expect((await seat(m, f.tribe)).status).toBe("active");
      expect(await row(id)).toMatchObject({ reinstated_by: who });
      expect((await c.sql("select lifted_at from public.removal_blocks where request_id = $1", [id]))[0].lifted_at).not.toBeNull();
      expect(await mails("removal_member_reinstated", m)).toHaveLength(1);
      expect((await mails("removal_leader_decided", f.leader))[0].params).toMatchObject({ decision: "reinstated" });
      expect(await candidates(m)).toContain(f.tribe);
      expect((await c.as(m, "my_removal")).reinstated).toBe(true);
    }
  });

  it("is not for the leader, the member, a pastor, or another coach", async () => {
    const { f, id, m } = await removed();
    for (const who of [f.leader, m, c.pastor, coach2, c.member]) await expectCode(c.as(who, "removal_reinstate", id, "Put them back please."), "42501");
    await c.as(careLead, "removal_reinstate", id, "Put them back please.");
    await expectCode(c.as(careLead, "removal_reinstate", id, "Put them back again."), "22023");
  });

  it("closes an appeal that was waiting, and an appeal can be kept by the Care Lead alone", async () => {
    const { m, id } = await removed();
    await c.as(m, "removal_appeal", id, "Please look again at this decision.");
    await expectCode(c.as(coach, "removal_appeal_uphold", id, "Kept the decision, with care."), "42501");
    await c.as(careLead, "removal_reinstate", id, "Listened to her and she is right.");
    expect(await row(id)).toMatchObject({ appeal_status: "reinstated", appeal_decided_by: careLead });
    const x = await removed();
    await c.as(x.m, "removal_appeal", x.id, null);
    await c.as(c.director, "removal_appeal_uphold", x.id, "Looked again and the decision stands.");
    expect(await row(x.id)).toMatchObject({ appeal_status: "upheld" });
    await expectCode(c.as(c.director, "removal_appeal_uphold", x.id, "Looked again and the decision stands."), "22023");
  });

  it("refuses when the tribe is full or the person has joined another tribe", async () => {
    const { f, id } = await removed();
    await c.sql("update public.tribes set capacity = 4 where id = $1", [f.tribe]);
    for (let i = 0; i < 3; i++) await c.k.seat(f.tribe, c.season, `Filler${++n}`);
    await expectCode(c.as(careLead, "removal_reinstate", id, "Back to the tribe they love."), "22023");
    await expect(c.as(careLead, "removal_reinstate", id, "Back to the tribe they love.")).rejects.toThrow(/tribe is full/);
    await c.sql("update public.tribes set capacity = 12 where id = $1", [f.tribe]);
    const other = await fresh();
    await c.sql(
      "insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by) values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)",
      [other.tribe, f.members[0], c.season],
    );
    await expect(c.as(careLead, "removal_reinstate", id, "Back to the tribe they love.")).rejects.toThrow(/joined another tribe/);
  });
});

describe("waiting, and silence", () => {
  it("reminds at day 3 and escalates at day 7, once each, and never decides anything", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const r = await ask(f);
    await c.sql("delete from public.notice_items");
    // nothing yet
    expect(await c.sql("select public.worker_removal_tick($1) as r", [token]).then((x) => x[0].r)).toMatchObject({ on: true, reminded: 0, escalated: 0 });
    await backdate(r.id, 4);
    expect(await c.sql("select public.worker_removal_tick($1) as r", [token]).then((x) => x[0].r)).toMatchObject({ reminded: 1, escalated: 0 });
    const kinds = async () => (await c.sql("select kind, event from public.notice_items order by kind, event")).map((i) => `${i.kind}`);
    // the Care Team, the coach, and (new) every admin and director are reminded once, each in their own words
    expect(await kinds()).toEqual(["admin_removal_waiting", "admin_removal_waiting", "care_removal_waiting", "coach_removal_waiting"]);
    expect(await c.sql("select public.worker_removal_tick($1) as r", [token]).then((x) => x[0].r)).toMatchObject({ reminded: 0, escalated: 0 });
    await backdate(r.id, 8);
    expect(await c.sql("select public.worker_removal_tick($1) as r", [token]).then((x) => x[0].r)).toMatchObject({ reminded: 0, escalated: 1 });
    const escalated = await c.sql("select kind, person_id from public.notice_items where event like '%escalate' order by kind");
    expect(escalated.map((i) => i.kind)).toEqual(["care_removal_waiting", "director_removal_escalated"]);
    expect(escalated.find((i) => i.kind === "director_removal_escalated")!.person_id).toBe(c.director);
    // silence never removes anyone
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await row(r.id)).toMatchObject({ status: "open" });
    expect((await seat(f.members[0], f.tribe)).status).toBe("active");
    expect(await c.sql("select 1 from public.messages where person_id = $1", [f.members[0]])).toHaveLength(0);
  });

  it("does not remind about practice, a restricted request's coach, or a request already answered", async () => {
    await on();
    await c.noticesOn();
    const f = await fresh();
    const restricted = await ask(f, f.members[0], { reason: "safety_or_conduct" });
    const answered = await ask(f, f.members[1]);
    await decide(answered.id, c.admin, "decline");
    await backdate(restricted.id, 4);
    await backdate(answered.id, 4);
    await c.sql("delete from public.notice_items");
    await c.sql("select public.worker_removal_tick($1)", [token]);
    // a restricted request is not the coach's to recommend on, so the coach is not reminded; the office is
    expect((await c.sql("select kind from public.notice_items order by kind")).map((i) => i.kind)).toEqual(["admin_removal_waiting", "admin_removal_waiting", "care_removal_waiting"]);
    await c.reset();
    await rehearse();
    const g = await fresh();
    const p = await ask(g);
    await backdate(p.id, 9);
    await c.sql("delete from public.notice_items");
    await c.sql("select public.worker_removal_tick($1)", [token]);
    expect(await c.sql("select 1 from public.notice_items")).toHaveLength(0);
  });

  it("clears the leader's words after 12 months, keeping the fact, even when the switch is Off", async () => {
    await on();
    const f = await fresh();
    const r = await ask(f);
    await decide(r.id, c.admin, "ask", "What have you tried so far with her?");
    await c.as(f.leader, "removal_answer", r.id, "Calls, visits and a long talk after the meeting.");
    await decide(r.id, c.admin, "decline", "Please keep trying; we will support you.");
    await c.sql("update public.removal_requests set created_at = now() - interval '13 months' where id = $1", [r.id]);
    await c.set("removal_requests", "off", { reason: REASON });
    expect(await c.sql("select public.worker_removal_tick($1) as r", [token]).then((x) => x[0].r)).toMatchObject({ on: false, cleared: 1 });
    expect(await row(r.id)).toMatchObject({ note: null, decision_note: null, status: "declined", reason: "repeated_absence" });
    expect((await row(r.id)).note_cleared_at).not.toBeNull();
    expect((await c.sql("select body from public.removal_thread where request_id = $1", [r.id])).map((t) => t.body)).toEqual([null, null]);
    await on();
    const card = (await c.as(careLead, "removal_board")).requests.find((q: { id: string }) => q.id === r.id);
    if (card) expect(card.note).toBeNull();
  });
});

describe("access", () => {
  it("keeps the tables out of reach of members and visitors, and the helpers uncallable", async () => {
    const m = c.member;
    for (const t of ["removal_requests", "removal_thread", "removal_blocks"]) {
      await expectCode(c.db.asUser(m, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(c.db.asAnon((q) => q(`select * from public.${t}`)), "42501");
    }
    await expectCode(c.as(m, "removal_state"), "42501");
    await expectCode(c.as(m, "removal_release", "00000000-0000-0000-0000-000000000000"), "42501");
    await expectCode(c.as(m, "removal_can_decide", "00000000-0000-0000-0000-000000000000", m), "42501");
    await expectCode(c.as(m, "removal_tick"), "42501");
  });

  it("answers no visitor", async () => {
    await expectCode(c.db.asAnon((q) => q("select public.removal_board()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.my_removal()")), "42501");
    await expectCode(c.db.asAnon((q) => q("select public.removal_decide($1, 'approve', 'a note here for it')", ["00000000-0000-0000-0000-000000000000"])), "42501");
  });

  it("lets the heartbeat in only with the sending service's token", async () => {
    await expect(c.db.asAnon((q) => q("select public.worker_removal_tick('not-the-token')"))).rejects.toThrow();
    expect(await c.db.asAnon((q) => q("select public.worker_removal_tick($1) as r", [token])).then((x) => x.rows[0].r)).toMatchObject({ on: false });
  });

  it("is moved only by the owner, and only for the whole church", async () => {
    await expectCode(c.as(c.admin, "god_feature_set", "removal_requests", "platform", null, "on", [], REASON, null), "42501");
    await expect(c.set("removal_requests", "on", { scope: "role", roles: ["leader"], reason: REASON })).rejects.toThrow();
    await expect(c.set("removal_requests", "optional", { reason: REASON })).rejects.toThrow();
  });
});
