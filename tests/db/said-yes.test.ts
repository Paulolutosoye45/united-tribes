import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type TestDb } from "./helpers";
import { anon, asUser, FORM_VERSION, linkFor, openSeason, placeRun, readyMember, rows, workerToken } from "./placement-kit";

// Count only members who said yes, and keep the WhatsApp group closed until they do (fixes 1 and 2 of the review).
//
//   * a seat the church placed counts as "waiting" until the member presses "Yes, I'm in"; a seat the member chose counts at once
//   * the headline, the church page, the tribe's own page and the Insight views all use the same rule, and say how many are waiting beside it
//   * the leader's WhatsApp group list: people who said yes are ready to add (with the number only where the person allows it), people still to
//     answer are names, people who left are listed to be taken out; the ticks are the leader's own record
//   * nobody else can read the list or tick it, and a person cannot be ticked as added before they have said yes

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let wt: string;
let A: Awaited<ReturnType<Kit["tribe"]>>;
let B: Awaited<ReturnType<Kit["tribe"]>>;
let director: string;
let selfSeated: string;
const am: { id: string; name: string }[] = [];

const sql = (text: string, params: unknown[] = []) => rows(db, text, params);
const yes = async (p: { id: string }) => expect(await anon(db, "worker_placed_confirm", wt, (await linkFor(db, p.id))!, FORM_VERSION)).toMatchObject({ ok: true });
const dash = () => asUser(db, director, "dashboard", season);
const list = (uid: string, tribe: string) => asUser(db, uid, "tribe_group_list", tribe);
const mark = (uid: string, tribe: string, person: string, kind: string, done = true) => asUser(db, uid, "tribe_group_mark", tribe, person, kind, done);

type Admit = { person_id: string; name: string; whatsapp: string | null; private: boolean; admitted: boolean };
const admitByName = (l: { admit: Admit[] }) => Object.fromEntries(l.admit.map((a) => [a.name, a]));

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  wt = await workerToken(db);
  director = (await k.staff("Director", "director")).id;
  await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
  A = await k.tribe(season, { capacity: 12, name: "Yes A", assistant: "certified" });
  B = await k.tribe(season, { capacity: 12, name: "Yes B", slot: "sunday-afternoon" });
  selfSeated = (await k.seat(A.tribe, season, "Chose", { profile: { times: ["weeknight-evening"] } })).id;
  // six members for tribe A. AM2 gave no number.
  for (let i = 0; i < 6; i++) {
    const m = await readyMember(db, k, season, `AM${i}`, {
      times: ["weeknight-evening"],
      daysAgo: 40 - i,
      whatsapp: i === 2 ? undefined : `+23480700000${String(i).padStart(2, "0")}`,
    });
    am.push({ id: m.id, name: `AM${i} Test` });
  }
  await o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  await placeRun(db, o, {});
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("the counts", () => {
  let members0: number;

  it("keeps the church's placements out of the member count until each member says yes, and shows them as waiting beside it", async () => {
    const placed = (await sql("select count(*)::int c from public.tribe_members where tribe_id = $1 and placement_source = 'auto' and status = 'active'", [A.tribe]))[0].c;
    expect(placed).toBe(6);
    const d = await dash();
    members0 = d.headline.members;
    expect(d.headline.waiting).toBe(6);
    // the one who chose their own seat is counted, and none of the six is
    expect(members0).toBe(1);
    const mine = d.tribes.find((t: { tribe_id: string }) => t.tribe_id === A.tribe);
    expect(mine).toMatchObject({ members: 1, waiting: 6 });
  });

  it("counts a member the moment they say yes, and takes them off the waiting figure", async () => {
    await yes(am[0]);
    const d = await dash();
    expect(d.headline.members).toBe(members0 + 1);
    expect(d.headline.waiting).toBe(5);
    expect(d.tribes.find((t: { tribe_id: string }) => t.tribe_id === A.tribe)).toMatchObject({ members: 2, waiting: 5 });
  });

  it("uses the same rule on the church page: the funnel step, the seats placed and the people still waiting", async () => {
    const f = Object.fromEntries((await dash()).funnel.map((x: { key: string; label: string; count: number }) => [x.key, x]));
    expect(f.chose.label).toBe("Said yes to a tribe");
    expect(f.chose.count).toBe(2);
    const s = (await dash()).supply;
    expect(s.waiting).toBe(5);
    expect(s.placed).toBe(2);
  });

  it("shows the leader of the tribe its own count with the waiting people beside it, and no pace for them", async () => {
    const p = await asUser(db, A.leader.id, "tribe_progress", A.tribe);
    expect(p.waiting).toBe(5);
    const waiting = p.member_rows.filter((m: { waiting?: boolean }) => m.waiting === true);
    expect(waiting).toHaveLength(5);
    for (const m of waiting) expect(m.pace ?? null).toBeNull();
    expect(p.member_rows.filter((m: { waiting?: boolean }) => !m.waiting).length).toBe(2);
  });

  it("counts a seat the member chose, whatever else is true of it", async () => {
    const mine = (await sql("select public.seat_said_yes('self', null) as r"))[0].r;
    expect(mine).toBe(true);
    expect((await sql("select public.seat_said_yes('auto', null) as r"))[0].r).toBe(false);
    expect((await sql("select public.seat_said_yes('auto', now()) as r"))[0].r).toBe(true);
  });

  it("keeps the helper out of the client's reach", async () => {
    await expectCode(db.asUser(director, (q) => q("select public.seat_said_yes('self', null)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.seat_said_yes('self', null)")), "42501");
  });
});

describe("the leader's WhatsApp group list", () => {
  beforeAll(async () => {
    await yes(am[1]);
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, am[1].id))!)).toEqual({ ok: true, late: false }); // said yes, keeps the number private
    await yes(am[2]); // no number given
    // AM3 has not answered and their hold ran out; AM4 has not answered and their email is still queued
    await db.admin.query(
      "update public.messages set status = 'sent', sent_at = now() - interval '30 hours' where template = 'placement_your_tribe' and person_id = $1",
      [am[3].id],
    );
    // AM5 said yes, then left the tribe
    await yes(am[5]);
    await db.admin.query("update public.tribe_members set status = 'released', released_at = now() where tribe_id = $1 and person_id = $2", [A.tribe, am[5].id]);
  });

  it("lists the people who said yes as ready to add, with a number only where the person allows it", async () => {
    const l = await list(A.leader.id, A.tribe);
    const by = admitByName(l);
    expect(Object.keys(by).sort()).toEqual(["AM0 Test", "AM1 Test", "AM2 Test", "Chose Test"]);
    expect(by["AM0 Test"]).toMatchObject({ whatsapp: "+2348070000000", private: false, admitted: false });
    expect(by["AM1 Test"]).toMatchObject({ whatsapp: null, private: true }); // said yes, kept the number private
    expect(by["AM2 Test"]).toMatchObject({ whatsapp: null, private: false }); // gave no number
    expect(l.has_link).toBe(false);
  });

  it("lists the people who have not answered by name and nothing else, whatever the clock says", async () => {
    const l = await list(A.leader.id, A.tribe);
    expect([...l.waiting].sort()).toEqual(["AM3 Test", "AM4 Test"]);
    expect(JSON.stringify(l.waiting)).not.toMatch(/\+234|@/);
    expect(Object.keys(admitByName(l))).not.toContain("AM3 Test");
  });

  it("lists the people who left, and never the reason they left", async () => {
    const l = await list(A.leader.id, A.tribe);
    expect(l.remove).toEqual([{ person_id: am[5].id, name: "AM5 Test", removed: false }]);
    expect(JSON.stringify(l)).not.toMatch(/reason|released|note/i);
  });

  it("gives the assistant the same list, and refuses another tribe's leader, a member, and a visitor", async () => {
    expect(await list(A.assistant!.id, A.tribe)).toEqual(await list(A.leader.id, A.tribe));
    for (const who of [B.leader.id, am[0].id, director]) await expectCode(db.asUser(who, (q) => q("select public.tribe_group_list($1)", [A.tribe])), "42501");
    await expectCode(db.asAnon((q) => q("select public.tribe_group_list($1)", [A.tribe])), "42501");
    await expectCode(db.asUser(A.leader.id, (q) => q("select public.tribe_group_list($1)", ["00000000-0000-4000-8000-000000000000"])), "P0002");
  });

  it("lets the leader tick a person as added, and untick them, and records who did it", async () => {
    expect(await mark(A.leader.id, A.tribe, am[0].id, "admitted")).toEqual({ ok: true });
    expect(admitByName(await list(A.leader.id, A.tribe))["AM0 Test"].admitted).toBe(true);
    // the assistant sees the leader's tick, so the same person is not added twice
    expect(admitByName(await list(A.assistant!.id, A.tribe))["AM0 Test"].admitted).toBe(true);
    expect(await mark(A.assistant!.id, A.tribe, am[0].id, "admitted", false)).toEqual({ ok: true });
    expect(admitByName(await list(A.leader.id, A.tribe))["AM0 Test"].admitted).toBe(false);
    expect((await sql("select count(*)::int n from public.event_log where action = 'group.admitted' and entity_id = $1 and actor_id = $2", [A.tribe, A.leader.id]))[0].n).toBe(1);
  });

  it("will not tick a person as added before they have said yes", async () => {
    await expectCode(mark(A.leader.id, A.tribe, am[3].id, "admitted"), "22023");
    await expectCode(mark(A.leader.id, A.tribe, am[4].id, "admitted"), "22023");
    expect((await sql("select count(*)::int n from public.tribe_members where group_admitted_at is not null and person_id = any($1)", [[am[3].id, am[4].id]]))[0].n).toBe(0);
  });

  it("lets the leader tick a person who left as taken out of the group, and only a person who left", async () => {
    expect(await mark(A.leader.id, A.tribe, am[5].id, "removed")).toEqual({ ok: true });
    expect((await list(A.leader.id, A.tribe)).remove[0]).toMatchObject({ person_id: am[5].id, removed: true });
    await expectCode(mark(A.leader.id, A.tribe, am[0].id, "removed"), "22023"); // still in the tribe
    await expectCode(mark(A.leader.id, A.tribe, am[0].id, "banished"), "22023");
  });

  it("refuses the tick to anyone who does not run the tribe", async () => {
    for (const who of [B.leader.id, am[0].id, director]) await expectCode(db.asUser(who, (q) => q("select public.tribe_group_mark($1, $2, 'admitted', true)", [A.tribe, am[0].id])), "42501");
    await expectCode(db.asAnon((q) => q("select public.tribe_group_mark($1, $2, 'admitted', true)", [A.tribe, am[0].id])), "42501");
  });

  it("shows the member who chose their own seat as ready to add at once", async () => {
    expect(admitByName(await list(A.leader.id, A.tribe))["Chose Test"]).toMatchObject({ person_id: selfSeated, admitted: false });
  });
});
