import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wordingProblems } from "./contract";
import { expectCode, type Row, type TestDb } from "./helpers";
import { newKit, type Kit, type Person } from "./builders";

// Stage 6b: changing tribe. A member who is not at home in their tribe can ask to move in the first weeks of a
// season. The reason goes to the coach and the Care Lead, never to the tribe's leader. A coach picks from the
// tribes that still fit, the member agrees to the new tribe's Covenant, and only then is the move made.
//
// The world (season A began nine days ago, so it is in its second week; the first four weeks are for changing):
//   Alpha   coach Coach, weeknights: M1..M7 (M1 will move)           week 1 held, everyone there
//   Beta    coach Coach, weeknights: open seats                       a fit
//   Gamma   coach Other, Saturday mornings                            not a fit (members can only do weeknights)
//   Delta   coach Coach, weeknights, full (4 of 4)                    not a fit
//   Epsilon weeknights, leader not certified                          not a fit
//   Eta     coach Coach, weeknights, one seat left (3 of 4)           for the race
//   Omega   no coach: its requests go to the Care Team
//   Lambda  Season L, 40 days in (week 6): too late for members to ask, a coach may still start one
//   Future  a season that has not started

let db: TestDb;
let k: Kit;
let A: string;
let coach: Person;
let other: Person;
let careLead: Person;
let director: Person;
let admin: Person;
let outsider: Person;
let alpha: Awaited<ReturnType<Kit["tribe"]>>;
let beta: Awaited<ReturnType<Kit["tribe"]>>;
let gamma: Awaited<ReturnType<Kit["tribe"]>>;
let delta: Awaited<ReturnType<Kit["tribe"]>>;
let epsilon: Awaited<ReturnType<Kit["tribe"]>>;
let eta: Awaited<ReturnType<Kit["tribe"]>>;
let omega: Awaited<ReturnType<Kit["tribe"]>>;
let lambda: Awaited<ReturnType<Kit["tribe"]>>;
let future: Awaited<ReturnType<Kit["tribe"]>>;
const M: Person[] = [];
let omegaMember: Person;
let lateMember: Person;
let futureMember: Person;

beforeAll(async () => {
  ({ db, k } = await newKit());
  coach = await k.staff("Coach", "coach");
  other = await k.staff("Other", "coach");
  careLead = await k.staff("Carer", "care_lead");
  director = await k.staff("Dir", "director");
  admin = await k.staff("Adm", "admin");
  outsider = await k.person("Outsider");

  A = await k.season("A", 9);
  alpha = await k.tribe(A, { name: "Alpha", coach: coach.id });
  beta = await k.tribe(A, { name: "Beta", coach: coach.id });
  gamma = await k.tribe(A, { name: "Gamma", coach: other.id, slot: "saturday-morning" });
  delta = await k.tribe(A, { name: "Delta", coach: coach.id, capacity: 4 });
  epsilon = await k.tribe(A, { name: "Epsilon", coach: coach.id, certified: false });
  eta = await k.tribe(A, { name: "Eta", coach: coach.id, capacity: 4 });
  omega = await k.tribe(A, { name: "Omega" });

  for (let i = 1; i <= 7; i++) M.push(await k.seat(alpha.tribe, A, `M${i}`));
  await k.meetings(alpha.tribe, alpha.leader.id, 1, M.map((m) => [m.id, 1] as [string, number]));
  await k.pulse(alpha.tribe, M[0].id, 1, 4, 3, 3, 3);
  for (let i = 0; i < 4; i++) await k.seat(delta.tribe, A, `D${i}`, { profile: false });
  // A tribe with one seat left must still be able to end up balanced (two established believers; quiet and lively members),
  // or the engine will not offer it, so Eta's members are chosen to leave room
  await k.seat(eta.tribe, A, "E0", { profile: { faith: "established", social: -1 } });
  await k.seat(eta.tribe, A, "E1", { profile: { faith: "established", social: 1 } });
  await k.seat(eta.tribe, A, "E2", { profile: { faith: "growing", social: 0 } });
  omegaMember = await k.seat(omega.tribe, A, "Zed");

  const L = await k.season("L", 40);
  lambda = await k.tribe(L, { name: "Lambda", coach: coach.id });
  lateMember = await k.seat(lambda.tribe, L, "Late");
  const F = await k.season("Future", -20);
  future = await k.tribe(F, { name: "Future tribe", coach: coach.id });
  futureMember = await k.seat(future.tribe, F, "Early");
});

afterAll(async () => {
  await db.close();
});

const call = (who: Person, fn: string, params: unknown[] = []) => k.call(who.id, fn, params);
const queue = async (who: Person) => (await call(who, "swap_queue")) as Row;
const itemOf = (q: Row, personId: string) => (q.items as Row[]).find((i) => i.person.id === personId);
const mine = async (who: Person) => (await call(who, "my_swap")) as Row;
const messagesFor = (personId: string, template: string) =>
  k.sql("select * from public.messages where person_id = $1 and template = $2 order by created_at", [personId, template]);

describe("what a member sees", () => {
  it("is whether they can ask, and nothing else, before they have", async () => {
    const s = await mine(M[0]);
    expect(s.in_tribe).toBe(true);
    expect(s.tribe.name).toBe("Alpha");
    expect(s.week).toBe(2);
    expect(s.window).toEqual({ open: true, weeks: 4 });
    expect(s.request).toBeNull();
    expect((await mine(outsider)).in_tribe).toBe(false);
    await expectCode(db.asAnon((q) => q("select public.my_swap()")), "42501");
  });

  it("is closed once the first weeks are over", async () => {
    const s = await mine(lateMember);
    expect(s.week).toBe(6);
    expect(s.window.open).toBe(false);
  });
});

describe("asking", () => {
  it("needs a reason from the list, a short note, and a tribe that is open to move to", async () => {
    await expectCode(call(M[0], "request_swap", ["boredom"]), "22023");
    await expectCode(call(M[0], "request_swap", [null]), "22023");
    await expectCode(call(M[0], "request_swap", ["time", "x".repeat(301)]), "22023");
    await expectCode(call(M[0], "request_swap", ["time", null, alpha.tribe]), "22023"); // their own
    await expectCode(call(M[0], "request_swap", ["time", null, future.tribe]), "22023"); // another season
    const draft = await k.tribe(A, { name: "Draft", status: "draft" });
    await expectCode(call(M[0], "request_swap", ["time", null, draft.tribe]), "22023");
    expect(await k.sql("select 1 from public.swap_requests")).toHaveLength(0);
  });

  it("is for people in a tribe, in a season that has started and is still in its first weeks", async () => {
    await expectCode(call(outsider, "request_swap", ["time"]), "22023");
    await expectCode(call(futureMember, "request_swap", ["time"]), "22023");
    await expectCode(call(lateMember, "request_swap", ["time"]), "22023");
    await expectCode(db.asAnon((q) => q("select public.request_swap('time')")), "42501");
  });

  it("is a request the coach hears about, with no reason in the message", async () => {
    const s = (await call(M[0], "request_swap", ["conflict", "It is about someone in the tribe", beta.tribe])) as Row;
    expect(s.request.status).toBe("requested");
    expect(s.request.reason).toBe("conflict");
    expect(s.request.by_coach).toBe(false);
    await expectCode(call(M[0], "request_swap", ["time"]), "22023"); // one at a time

    const toCoach = await messagesFor(coach.id, "swap_requested");
    expect(toCoach).toHaveLength(1);
    expect(toCoach[0].params).toMatchObject({ person_first: "M1", tribe: "Alpha" });
    expect(JSON.stringify(toCoach[0].params)).not.toMatch(/conflict|someone in the tribe/);
    // the tribe's own leader is not told
    expect(await k.sql("select 1 from public.messages where person_id = $1 and template like 'swap_%'", [alpha.leader.id])).toHaveLength(0);
    expect(await k.sql("select 1 from public.messages where person_id = $1 and template like 'swap_%'", [other.id])).toHaveLength(0);
  });

  it("goes to the Care Team when the tribe has no coach", async () => {
    await call(omegaMember, "request_swap", ["place"]);
    const team = (await k.sql("select * from public.care_team() as person")).map((r) => r.person);
    expect(team).toEqual([careLead.id]);
    const sent = await messagesFor(careLead.id, "swap_requested");
    expect(sent).toHaveLength(1);
    expect(sent[0].params.tribe).toBe("Omega");
    await call(omegaMember, "cancel_swap");
  });
});

describe("who can see the request", () => {
  it("is the tribe's coach, the Care Lead, directors and the admin", async () => {
    for (const who of [coach, careLead, director, admin]) {
      const item = itemOf(await queue(who), M[0].id);
      expect(item, who.id).toBeDefined();
      expect(item!.reason).toBe("conflict");
      expect(item!.note).toBe("It is about someone in the tribe");
      expect(item!.from.name).toBe("Alpha");
      expect(item!.person.name).toBe("M1 Test");
      expect(item!.wants.name).toBe("Beta");
    }
  });

  it("is not another coach's, a leader's, a member's or a visitor's", async () => {
    expect((await queue(other)).items).toEqual([]);
    for (const who of [alpha.leader, M[0], M[1], outsider]) await expectCode(call(who, "swap_queue"), "42501");
    await expectCode(db.asAnon((q) => q("select public.swap_queue()")), "42501");
  });

  it("is not in any table a person can read", async () => {
    for (const who of [alpha.leader, M[0], coach]) {
      await expect(db.asUser(who.id, (q) => q("select * from public.swap_requests"))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("comes with the tribes that still fit", async () => {
    const item = itemOf(await queue(coach), M[0].id)!;
    const names = (item.options as Row[]).map((o) => o.name);
    expect(names).toContain("Beta");
    expect(names).toContain("Eta");
    // not their own, not full, not at a time they cannot make, not led by someone who is not certified
    for (const no of ["Alpha", "Delta", "Gamma", "Epsilon"]) expect(names, no).not.toContain(no);
    const beta1 = (item.options as Row[]).find((o) => o.name === "Beta")!;
    expect(beta1.degree).toBeGreaterThanOrEqual(60);
    expect(beta1.seats).toBeGreaterThan(0);
    expect(beta1.leader_first_name).toBeTruthy();
  });
});

describe("offering a tribe", () => {
  let requestId: string;

  beforeAll(async () => {
    requestId = (await db.admin.query("select id from public.swap_requests where person_id = $1 and status = 'requested'", [M[0].id])).rows[0].id;
  });

  it("is refused for a tribe that does not fit, and for a request that is not the coach's", async () => {
    await expectCode(call(coach, "offer_swap", [requestId, gamma.tribe]), "22023"); // Saturday mornings
    await expectCode(call(coach, "offer_swap", [requestId, alpha.tribe]), "22023"); // the one they are in
    await expectCode(call(coach, "offer_swap", [requestId, delta.tribe]), "22023"); // full
    await expectCode(call(coach, "offer_swap", [requestId, epsilon.tribe]), "22023"); // leader not certified
    await expectCode(call(other, "offer_swap", [requestId, beta.tribe]), "P0002");
    await expectCode(call(M[0], "offer_swap", [requestId, beta.tribe]), "P0002");
    await expectCode(call(coach, "offer_swap", ["00000000-0000-4000-8000-000000000000", beta.tribe]), "P0002");
  });

  it("tells the member, who sees the tribe and how well it fits", async () => {
    const q = (await call(careLead, "offer_swap", [requestId, beta.tribe])) as Row;
    const item = itemOf(q, M[0].id)!;
    expect(item.status).toBe("offered");
    expect(item.offered.name).toBe("Beta");
    const sent = await messagesFor(M[0].id, "swap_offered");
    expect(sent).toHaveLength(1);
    expect(sent[0].params).toMatchObject({ tribe: "Beta", by_first: "Carer" });

    const s = await mine(M[0]);
    expect(s.request.status).toBe("offered");
    expect(s.request.offered.name).toBe("Beta");
    expect(["excellent", "strong", "good"]).toContain(s.request.offered_label);
    expect(s.request.offered_degree).toBeGreaterThanOrEqual(60);
  });
});

describe("the member's answer", () => {
  it("is only for someone with an offer waiting", async () => {
    await expectCode(call(M[1], "answer_swap", [true, "cov-1"]), "22023");
    await expectCode(db.asAnon((q) => q("select public.answer_swap(true, 'cov-1')")), "42501");
  });

  it("needs them to agree to the new tribe's Covenant, and moves them only then", async () => {
    await expectCode(call(M[0], "answer_swap", [true]), "22023");
    await expectCode(call(M[0], "answer_swap", [true, "bad version!"]), "22023");
    expect((await k.sql("select tribe_id from public.tribe_members where person_id = $1 and status = 'active'", [M[0].id]))[0].tribe_id).toBe(alpha.tribe);

    const s = (await call(M[0], "answer_swap", [true, "cov-1"])) as Row;
    expect(s.request.status).toBe("moved");
    expect(s.tribe.name).toBe("Beta");

    const rows = await k.sql("select * from public.tribe_members where person_id = $1 order by joined_at", [M[0].id]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ tribe_id: alpha.tribe, status: "released", release_reason: "moved to another tribe" });
    expect(rows[1]).toMatchObject({ tribe_id: beta.tribe, status: "active", agreement_version: "cov-1", run_id: null, chosen_rank: null });
    expect(rows[1].degree).toBeGreaterThanOrEqual(60);
    expect(rows[1].covenant).toMatchObject({ name: "Beta" });
    const swap = (await k.sql("select * from public.swap_requests where person_id = $1", [M[0].id]))[0];
    expect(swap).toMatchObject({ status: "moved", moved_to: beta.tribe });
  });

  it("tells both leaders, without the reason and without saying where from or to", async () => {
    const out = await messagesFor(alpha.leader.id, "swap_moved");
    const inn = await messagesFor(beta.leader.id, "swap_moved");
    expect(out).toHaveLength(1);
    expect(inn).toHaveLength(1);
    expect(out[0].params).toEqual({ person_first: "M1", direction: "out" });
    expect(inn[0].params).toEqual({ person_first: "M1", direction: "in" });
    // and the reason is in no message at all
    const all = await k.sql("select params::text as p from public.messages where template like 'swap_%'");
    expect(all.map((r) => r.p).join(" ")).not.toMatch(/conflict|someone in the tribe/);
  });

  it("is not offered a tribe that has since filled", async () => {
    // M2 and M3 both ask; the coach offers both the last seat in Eta
    for (const who of [M[1], M[2]]) await call(who, "request_swap", ["time"]);
    const ids = (await k.sql("select id, person_id from public.swap_requests where person_id = any($1) and status = 'requested'", [[M[1].id, M[2].id]])) as Row[];
    for (const r of ids) await call(coach, "offer_swap", [r.id, eta.tribe]);
    await call(M[1], "answer_swap", [true, "cov-1"]);
    expect((await k.sql("select count(*)::int as n from public.tribe_members where tribe_id = $1 and status = 'active'", [eta.tribe]))[0].n).toBe(4);
    await expectCode(call(M[2], "answer_swap", [true, "cov-1"]), "22023");
    // M3 is still where they were, and can still say no
    expect((await k.sql("select tribe_id from public.tribe_members where person_id = $1 and status = 'active'", [M[2].id]))[0].tribe_id).toBe(alpha.tribe);
    const s = (await call(M[2], "answer_swap", [false])) as Row;
    expect(s.request.status).toBe("member_declined");
    // and the coach can no longer offer Eta
    await call(M[2], "request_swap", ["time"]);
    const rid = (await k.sql("select id from public.swap_requests where person_id = $1 and status = 'requested'", [M[2].id]))[0].id;
    await expectCode(call(coach, "offer_swap", [rid, eta.tribe]), "22023");
    await call(M[2], "cancel_swap");
  });
});

describe("saying no", () => {
  it("lets the coach decline with a note the member can read, and the member ask again", async () => {
    await call(M[3], "request_swap", ["fit", "Not sure I belong"]);
    const rid = (await k.sql("select id from public.swap_requests where person_id = $1 and status = 'requested'", [M[3].id]))[0].id;
    await expectCode(call(coach, "decline_swap", [rid, "x".repeat(301)]), "22023");
    await expectCode(call(other, "decline_swap", [rid]), "P0002");
    const q = (await call(coach, "decline_swap", [rid, "Let us give it two more weeks"])) as Row;
    expect(itemOf(q, M[3].id)!.status).toBe("declined");
    await expectCode(call(coach, "decline_swap", [rid]), "22023");
    await expectCode(call(coach, "offer_swap", [rid, beta.tribe]), "22023");

    const s = await mine(M[3]);
    expect(s.request.status).toBe("declined");
    expect(s.request.decision_note).toBe("Let us give it two more weeks");
    expect(await messagesFor(M[3].id, "swap_declined")).toHaveLength(1);
    // the reason they gave is not shown back to them in the message, and still nobody else can read it
    await call(M[3], "request_swap", ["time"]);
    await call(M[3], "cancel_swap");
  });

  it("lets the member withdraw, once", async () => {
    await call(M[4], "request_swap", ["other"]);
    const s = (await call(M[4], "cancel_swap")) as Row;
    expect(s.request.status).toBe("withdrawn");
    await expectCode(call(M[4], "cancel_swap"), "22023");
    expect(itemOf(await queue(coach), M[4].id)?.status).toBe("withdrawn");
  });
});

describe("a coach asking for a move", () => {
  it("can start one after the first weeks, for a member of their own tribe", async () => {
    await expectCode(call(coach, "start_swap_for", [lateMember.id, "boredom"]), "22023");
    await expectCode(call(other, "start_swap_for", [lateMember.id, "time"]), "P0002");
    await expectCode(call(lateMember, "start_swap_for", [lateMember.id, "time"]), "P0002");
    await expectCode(call(coach, "start_swap_for", [outsider.id, "time"]), "P0002");
    await expectCode(call(coach, "start_swap_for", [futureMember.id, "time"]), "22023"); // the season has not started
    await expectCode(call(coach, "start_swap_for", [lateMember.id, "time", "x".repeat(301)]), "22023");

    const q = (await call(coach, "start_swap_for", [lateMember.id, "time", "Moved to nights at work"])) as Row;
    const item = itemOf(q, lateMember.id)!;
    expect(item.status).toBe("requested");
    expect(item.by_coach).toBe(true);
    await expectCode(call(coach, "start_swap_for", [lateMember.id, "time"]), "22023");
    expect((await mine(lateMember)).request.by_coach).toBe(true);
    // a member can still not start their own after the window
    await expectCode(call(lateMember, "request_swap", ["time"]), "22023");
    await call(lateMember, "cancel_swap");
  });
});

describe("choosing a member to ask for", () => {
  const names = (rows: unknown) => (rows as Row[]).map((r) => r.name as string);

  it("shows a coach the members of their own tribes whose season is running", async () => {
    const rows = (await call(coach, "swap_members")) as Row[];
    expect(names(rows)).toEqual(expect.arrayContaining(["Late Test", "M5 Test"]));
    expect(rows.find((r) => r.name === "Late Test")).toMatchObject({ tribe: "Lambda" });
    // not a season that has not started, not a tribe without this coach, not a leader
    expect(names(rows)).not.toContain("Early Test");
    expect(names(rows)).not.toContain("Zed Test");
    expect(names(await call(other, "swap_members"))).toEqual([]);
  });

  it("leaves out anyone who already has a request open", async () => {
    await call(coach, "start_swap_for", [lateMember.id, "time"]);
    expect(names(await call(coach, "swap_members"))).not.toContain("Late Test");
    await call(lateMember, "cancel_swap");
    expect(names(await call(coach, "swap_members"))).toContain("Late Test");
  });

  it("makes the office look someone up by name", async () => {
    for (const who of [careLead, director, admin]) {
      expect(await call(who, "swap_members")).toEqual([]);
      expect(await call(who, "swap_members", ["x"])).toEqual([]);
      expect(await call(who, "swap_members", ["%"])).toEqual([]);
    }
    expect(names(await call(careLead, "swap_members", ["late"]))).toEqual(["Late Test"]);
    expect(names(await call(director, "swap_members", ["  ZED "]))).toEqual(["Zed Test"]);
  });

  it("is for coaches, the Care Lead and the office only", async () => {
    for (const who of [alpha.leader, M[5], outsider]) await expectCode(call(who, "swap_members"), "42501");
    await expectCode(db.asAnon((q) => q("select public.swap_members(null)")), "42501");
  });
});

describe("a move keeps the member's season", () => {
  it("counts meetings, pulses and steps across both tribes", async () => {
    // Week 1 was held in Alpha (M1 there, with a first pulse). The season moves on to week 5; M1 is in Beta for weeks 2 to 4.
    await k.moveSeason(A, 30);
    await k.meetings(beta.tribe, beta.leader.id, 3, [[M[0].id, 99]], 2);
    const row = (await k.sql("select * from public.kpi_members($1) where km_person = $2", [A, M[0].id]))[0];
    expect(row.km_tribe).toBe(beta.tribe);
    expect(row.km_attended).toBe(4);
    expect(row.km_base).toBe(9);
    expect(row.km_belonging).toBe(4);
    expect(row.km_measured).toBe(true);
    expect(row.km_thriving).toBe(true);
    // one record for the season, not one for each tribe
    expect((await k.sql("select count(*)::int as n from public.kpi_members($1) where km_person = $2", [A, M[0].id]))[0].n).toBe(1);
  });
});

describe("the wording", () => {
  it("agrees with the messages the database queued", async () => {
    const rows = await k.sql("select * from public.messages where template like 'swap_%'");
    expect(new Set(rows.map((r) => r.template))).toEqual(new Set(["swap_requested", "swap_offered", "swap_declined", "swap_moved"]));
    expect(await wordingProblems(rows)).toEqual([]);
  });
});
