import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type TestDb } from "./helpers";
import { anon, asUser, linkFor, openSeason, placeRun, readyMember, rows, workerToken } from "./placement-kit";

// Placement: the God Mode board (the placement mix-up fix, part D).
//
//   * the board gives every tribe its seated, sent, waiting, failed and holding counts, when its hold ends, and one state in the words of
//     Check 4 of the blueprint: it agrees with that query row for row
//   * Open now opens one tribe: members who have not answered are shared with the leader, a member who held back stays held back, and the
//     leader is emailed their team; nobody else is touched, and the tribe can no longer be undone
//   * Open all does the same for every tribe that is fully placed and not yet told; both are the owner's alone
//   * the heartbeat line moves each time the heartbeat runs

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let A: Awaited<ReturnType<Kit["tribe"]>>;
let B: Awaited<ReturnType<Kit["tribe"]>>;
let C: Awaited<ReturnType<Kit["tribe"]>>;
let D: Awaited<ReturnType<Kit["tribe"]>>;
let run: string;
let wt: string;
const links: Record<string, string> = {};
const am: { id: string }[] = [];
const bm: { id: string }[] = [];
const cm: { id: string }[] = [];
const dm: { id: string }[] = [];

const sql = (text: string, params: unknown[] = []) => rows(db, text, params);
const one = async (text: string, params: unknown[] = []) => (await sql(text, params))[0];
const roster = (uid: string, tribe: string) => asUser(db, uid, "tribe_roster_marked", tribe);
type Team = { tribe: string; name: string; state: string; sent: number; waiting: number; failed: number; holding: number; unanswered: number; opens_at: string | null; contact_opened_at: string | null; mail_queued_at: string | null };
const view = async () => (await o.call("placement_run_view", run)) as { heartbeat_at: string | null; mode: string; teams: Team[] };
const team = async (t: { tribe: string }) => (await view()).teams.find((x) => x.tribe === t.tribe)!;
const setMsg = (person: string, status: string, hoursAgo: number | null) =>
  db.admin.query(
    `update public.messages set status = $2, sent_at = case when $3::int is null then null else now() - make_interval(hours => $3::int) end
      where template = 'placement_your_tribe' and person_id = $1`,
    [person, status, hoursAgo],
  );
const teamMails = () => sql("select person_id, params from public.messages where template = 'placement_your_team' order by created_at, id");

// Check 4 of the blueprint, as written there, for the latest live run
const CHECK_4 = `with r as (select * from public.placement_runs where not rehearsal and status in ('placing','placed','undone') order by seq desc limit 1)
select t.id as tribe,
       case when pt.mail_queued_at is not null then 'leader already told'
            when count(*) filter (where m.id is null or m.status in ('queued','sending')) > 0 then 'waiting for member emails to go out'
            when count(*) filter (where m.status in ('sent','delivered','read')) = 0 then 'no member email has gone out'
            when max(m.sent_at) + make_interval(hours => (select hold_hours from r)) < now()
              then 'due now: opens on the next heartbeat (if it stays like this, the switch is not On or the heartbeat is not running)'
            else 'in the hold, opens ' || to_char((max(m.sent_at) + make_interval(hours => (select hold_hours from r))) at time zone 'Africa/Lagos', 'DD Mon HH24:MI') || ' Lagos' end as state
  from r
  join public.placement_teams pt on pt.run_id = r.id and pt.cancelled_at is null
  join public.tribes t on t.id = pt.tribe_id
  join public.tribe_members tm on tm.tribe_id = pt.tribe_id and tm.placed_by_run = r.id and tm.status = 'active'
  left join public.placement_items i on i.placement_id = tm.id
  left join public.messages m on m.id = i.member_message
 group by t.id, pt.mail_queued_at`;
const WORDS: Record<string, string> = {
  waiting: "waiting for member emails to go out",
  none_sent: "no member email has gone out",
  due: "due now",
  holding: "in the hold",
  told: "leader already told",
  opened: "leader already told",
};
const check4 = async () => Object.fromEntries((await sql(CHECK_4)).map((r) => [r.tribe as string, (r.state as string).split(":")[0].split(",")[0]]));

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
  A = await k.tribe(season, { capacity: 12, name: "Board A", slot: "weeknight-evening" });
  B = await k.tribe(season, { capacity: 12, name: "Board B", slot: "sunday-afternoon" });
  C = await k.tribe(season, { capacity: 12, name: "Board C", slot: "saturday-morning" });
  D = await k.tribe(season, { capacity: 12, name: "Board D", slot: "sunday-evening" });
  for (let i = 0; i < 6; i++) am.push(await readyMember(db, k, season, `BA${i}`, { times: ["weeknight-evening"], daysAgo: 40 - i, whatsapp: `+23480600000${i}` }));
  for (let i = 0; i < 5; i++) bm.push(await readyMember(db, k, season, `BB${i}`, { times: ["sunday-afternoon"], daysAgo: 30 - i, whatsapp: `+23480700000${i}` }));
  for (let i = 0; i < 5; i++) cm.push(await readyMember(db, k, season, `BC${i}`, { times: ["saturday-morning"], daysAgo: 20 - i, whatsapp: `+23480800000${i}` }));
  for (let i = 0; i < 4; i++) dm.push(await readyMember(db, k, season, `BD${i}`, { times: ["sunday-evening"], daysAgo: 10 - i, whatsapp: `+23480900000${i}` }));
  await o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  ({ run } = await placeRun(db, o, {}));
  wt = await workerToken(db);
  // a member's private link is cleared from the message an hour after it is sent, so keep the ones the tests use
  for (const m of [bm[2], cm[0], dm[0]]) links[m.id] = (await linkFor(db, m.id))!;
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("the board says why each tribe is closed", () => {
  it("gives every tribe its seated members and the state of their emails, from the moment of placing", async () => {
    const v = await view();
    expect(v.mode).toBe("on");
    expect(v.teams.length).toBe(4);
    for (const t of v.teams) {
      expect(t).toMatchObject({ state: "waiting", sent: 0, failed: 0, holding: 0, mail_queued_at: null, contact_opened_at: null });
      expect(t.waiting).toBeGreaterThanOrEqual(4);
      expect(t.unanswered).toBe(t.waiting);
    }
  });

  it("agrees with Check 4 row for row while every email is waiting", async () => {
    const c4 = await check4();
    for (const t of (await view()).teams) expect(c4[t.tribe]).toBe(WORDS[t.state]);
  });

  it("notes the heartbeat, and the line moves each time it runs", async () => {
    const before = (await view()).heartbeat_at;
    await new Promise((r) => setTimeout(r, 15));
    await sql("select public.placement_tick()");
    const after = (await view()).heartbeat_at;
    expect(after).toBeTruthy();
    expect(new Date(after as string).getTime()).toBeGreaterThan(before ? new Date(before).getTime() : 0);
  });

  it("says due, in the hold with the date it ends, still waiting, and no email has gone, each as Check 4 says it", async () => {
    // A: every email went 30 hours ago. B: every email went 2 hours ago. C: one email failed and the rest are still queued.
    // D: every email failed.
    for (const m of am) await setMsg(m.id, "sent", 30);
    for (const m of bm) await setMsg(m.id, "sent", 2);
    await setMsg(cm[0].id, "failed", null);
    for (const m of dm) await setMsg(m.id, "failed", null);
    const a = await team(A);
    const b = await team(B);
    const c = await team(C);
    const d = await team(D);
    expect(a).toMatchObject({ state: "due", sent: 6, waiting: 0, failed: 0, holding: 0, unanswered: 6 }); // the hold is over, and nobody has said yes
    expect(b).toMatchObject({ state: "holding", sent: 5, waiting: 0, holding: 5, unanswered: 5 });
    expect(Math.abs(new Date(b.opens_at as string).getTime() - (Date.now() + 22 * 3600 * 1000))).toBeLessThan(10 * 60 * 1000);
    expect(c).toMatchObject({ state: "waiting", sent: 0, waiting: 4, failed: 1, unanswered: 5 });
    expect(d).toMatchObject({ state: "none_sent", sent: 0, waiting: 0, failed: 4, unanswered: 4 });
    const c4 = await check4();
    for (const t of [a, b, c, d]) expect(c4[t.tribe]).toBe(WORDS[t.state]);
  });

  it("does not count a member who agreed on the form as answered: only a yes does", async () => {
    await db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, 'team_contact', true, 't')", [bm[0].id]);
    expect(await team(B)).toMatchObject({ state: "holding", holding: 5, unanswered: 5 });
  });
});

describe("Open now", () => {
  it("is the owner's alone: no other role, no visitor", async () => {
    for (const who of [A.leader.id, B.leader.id, bm[0].id]) {
      await expectCode(db.asUser(who, (q) => q("select public.placement_open_now($1, $2)", [run, A.tribe])), "42501");
      await expectCode(db.asUser(who, (q) => q("select public.placement_open_all($1)", [run])), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.placement_open_now($1, $2)", [run, A.tribe])), "42501");
  });

  it("refuses a run that is not live, and a tribe that has no team in it", async () => {
    await expectCode(o.call("placement_open_now", run, "00000000-0000-4000-8000-000000000000"), "P0002");
    await expectCode(o.call("placement_open_now", "00000000-0000-4000-8000-000000000000", A.tribe), "P0002");
  });

  it("opens one tribe: the members who have not said yes are shared, the leader is emailed, and no other tribe moves", async () => {
    expect(await anon(db, "worker_placed_withhold", wt, links[bm[2].id])).toEqual({ ok: true, late: false });
    const b = await team(B);
    expect(b.unanswered).toBe(4); // five seated: one held back just now, four with no yes (one of them ticked the form, which opens nothing)
    const r = await o.call("placement_open_now", run, B.tribe);
    expect(r).toMatchObject({ ok: true, shared: b.unanswered });

    const after = (await roster(B.leader.id, B.tribe)) as { members: { name: string; whatsapp: string | null; contact: string; withheld?: boolean }[] };
    expect(after.members.length).toBe(5);
    for (const m of after.members) {
      if (m.withheld) expect(m).toMatchObject({ whatsapp: null, contact: "withheld" });
      else expect(m).toMatchObject({ contact: "open", whatsapp: expect.stringMatching(/^\+2348070000/) });
    }
    // the leader is emailed their team, once, with everyone listed
    const mails = (await teamMails()).filter((m) => m.person_id === B.leader.id);
    expect(mails.length).toBe(1);
    const listed = mails[0].params.members as { state: string; email: string | null; whatsapp: string | null; withheld: boolean }[];
    expect(listed.length).toBe(5);
    expect(listed.filter((x) => x.state === "open").every((x) => x.email && x.whatsapp)).toBe(true);
    expect(listed.filter((x) => x.withheld).every((x) => !x.email && !x.whatsapp)).toBe(true);
    expect(await team(B)).toMatchObject({ state: "opened" });
    expect((await team(B)).contact_opened_at).toBeTruthy();
    // no other tribe moved: A is due and still waits for the heartbeat; C and D are as they were
    expect((await teamMails()).some((m) => m.person_id !== B.leader.id)).toBe(false);
    expect(await team(A)).toMatchObject({ state: "due", mail_queued_at: null, contact_opened_at: null });
    expect((await team(C)).state).toBe("waiting");
    expect((await team(D)).state).toBe("none_sent");
    expect((await one("select count(*)::int n, max((meta ->> 'shared')::int) as shared from public.event_log where action = 'placement.opened'"))).toMatchObject({ n: 1, shared: 4 });
  });

  it("says it has already been opened if it is pressed again, and shares nothing more", async () => {
    expect(await o.call("placement_open_now", run, B.tribe)).toEqual({ ok: true, already: true, shared: 0 });
    expect((await teamMails()).filter((m) => m.person_id === B.leader.id).length).toBe(1);
  });

  it("is told for that tribe from then on: the leader's email is queued, which is what stops an undo", async () => {
    const t = await one("select mail_queued_at, contact_opened_at from public.placement_teams where run_id = $1 and tribe_id = $2", [run, B.tribe]);
    expect(t.mail_queued_at).toBeTruthy();
    expect(t.contact_opened_at).toBeTruthy();
    expect((await one("select count(*)::int n from public.placement_teams where run_id = $1 and mail_queued_at is not null", [run])).n).toBe(1);
  });

  it("does not open a member who held back, even for the tribe it opens", async () => {
    const held = await one("select contact_withheld from public.tribe_members where person_id = $1 and tribe_id = $2", [bm[2].id, B.tribe]);
    expect(held.contact_withheld).toBe(true);
    const by = Object.fromEntries(((await roster(B.leader.id, B.tribe)) as { members: { person_id: string; whatsapp: string | null }[] }).members.map((m) => [m.person_id, m]));
    expect(by[bm[2].id].whatsapp).toBeNull();
  });

  it("opens a tribe whose emails are still waiting, and emails its leader at once, without waiting for them", async () => {
    // C: four emails still queued, one failed; one member holds back first
    expect(await anon(db, "worker_placed_withhold", wt, links[cm[0].id])).toEqual({ ok: true, late: false });
    const c = await team(C);
    expect(c.state).toBe("waiting");
    const r = await o.call("placement_open_now", run, C.tribe);
    expect(r).toMatchObject({ ok: true, shared: c.unanswered }); // four are shared: the one who held back is not one of them
    expect(c.unanswered).toBe(4);
    const mails = (await teamMails()).filter((m) => m.person_id === C.leader.id);
    expect(mails.length).toBe(1);
    const listed = mails[0].params.members as { state: string; whatsapp: string | null; withheld: boolean }[];
    expect(listed.length).toBe(5);
    expect(listed.filter((x) => x.state === "open").length).toBe(4);
    expect(listed.filter((x) => x.withheld).length).toBe(1);
    expect(await team(C)).toMatchObject({ state: "opened" });
    // still only B and C
    expect((await sql("select count(*)::int n from public.placement_teams where run_id = $1 and mail_queued_at is not null", [run]))[0].n).toBe(2);
    expect((await team(A)).state).toBe("due");
  });
});

describe("Open all", () => {
  it("opens every tribe that is fully placed and not yet told, and reports how many members were shared", async () => {
    const r = await o.call("placement_open_all", run);
    // A is due and nobody there has said yes, so its six are opened by the church; D had no email go out, so its four are opened too. B and C were done.
    expect(r).toMatchObject({ ok: true, tribes: 2, shared: 10 });
    expect((await team(A)).state).toBe("opened");
    expect((await team(D)).state).toBe("opened");
    expect((await teamMails()).some((m) => m.person_id === A.leader.id)).toBe(true);
    expect((await teamMails()).some((m) => m.person_id === D.leader.id)).toBe(true);
    expect((await one("select count(*)::int n, max((meta ->> 'shared')::int) as shared, max((meta ->> 'tribes')::int) as tribes from public.event_log where action = 'placement.opened_all'"))).toMatchObject({ n: 1, shared: 10, tribes: 2 });
    expect((await one("select status from public.placement_runs where id = $1", [run])).status).toBe("closed");
  });

  it("lists the members whose email never went, now with their number, because the church opened them", async () => {
    const by = (await roster(D.leader.id, D.tribe)) as { members: { contact: string; whatsapp: string | null }[] };
    expect(by.members.length).toBe(4);
    for (const m of by.members) expect(m).toMatchObject({ contact: "open", whatsapp: expect.stringMatching(/^\+2348090000/) });
  });

  it("is refused once every tribe has been told and the run is finished", async () => {
    await expectCode(o.call("placement_open_all", run), "22023");
    await expectCode(o.call("placement_open_now", run, A.tribe), "22023");
  });

  it("says it is too late to hold back once the church has opened a member's details", async () => {
    expect(await anon(db, "worker_placed_withhold", wt, links[dm[0].id])).toEqual({ ok: true, late: true });
  });
});
