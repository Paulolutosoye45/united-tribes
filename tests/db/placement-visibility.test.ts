import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type TestDb } from "./helpers";
import { anon, asUser, linkFor, openSeason, placeRun, planRun, proposedCount, readyMember, resolveAll, rows, workerToken } from "./placement-kit";

// Placement: one rule for who sees a church-placed member, and when (the placement mix-up fix, parts A, B and C).
//
//   * a leader sees every church-placed member by name from the moment of placing, on every screen, with no number
//   * a member's number opens on that member's own clock: they said yes, or agreed on the form, or their own email went and 24 hours passed
//   * a member who held back stays held back; a member whose email never went is "not yet reached" and never opens by itself
//   * the raw lists apply the rule themselves
//   * the leader's email goes tribe by tribe, when nobody in the tribe is waiting for an email or sitting in the hold, or 72 hours after
//     the tribe's last planned email, whatever is still stuck
//   * the finishing step keeps running when the switch is Off or Rehearsal; Off with nothing to finish does nothing
//   * the group link follows the member's answer, and is a God Mode setting

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let season: string;
let wt: string;
let A: Awaited<ReturnType<Kit["tribe"]>>;
let B: Awaited<ReturnType<Kit["tribe"]>>;
let C: Awaited<ReturnType<Kit["tribe"]>>;
let run: string;
let selfSeated: string;
const am: { id: string; name: string }[] = [];
const bm: { id: string }[] = [];
const cm: { id: string }[] = [];

const GROUP = "https://chat.whatsapp.com/VisibilityGroupA";
const sql = (text: string, params: unknown[] = []) => rows(db, text, params);
const one = async (text: string, params: unknown[] = []) => (await sql(text, params))[0];
const roster = (uid: string, tribe: string) => asUser(db, uid, "tribe_roster_marked", tribe);
type RosterMember = { person_id: string; name: string; whatsapp: string | null; placement?: string; contact?: string; contact_opens_at?: string | null; withheld?: boolean };
const byName = (r: { members: RosterMember[] }) => Object.fromEntries(r.members.map((m) => [m.name, m])) as Record<string, RosterMember>;
const setMsg = (person: string, status: string, hoursAgo: number | null, extra = "") =>
  db.admin.query(
    `update public.messages set status = $2, sent_at = case when $3::int is null then null else now() - make_interval(hours => $3::int) end ${extra}
      where template = 'placement_your_tribe' and person_id = $1`,
    [person, status, hoursAgo],
  );
const teamMails = () =>
  sql("select person_id, params, tribe_id from public.messages where template = 'placement_your_team' order by created_at, id");

beforeAll(async () => {
  ({ db, k } = await newKit());
  season = await openSeason(db);
  o = await makeOwner(db);
  wt = await workerToken(db);
  await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");
  A = await k.tribe(season, { capacity: 12, name: "Vis A", assistant: "certified" });
  B = await k.tribe(season, { capacity: 12, name: "Vis B", slot: "sunday-afternoon" });
  C = await k.tribe(season, { capacity: 12, name: "Vis C", slot: "saturday-morning" });
  await db.admin.query("update public.tribes set whatsapp_group_url = $2 where id = $1", [A.tribe, GROUP]);
  selfSeated = (await k.seat(A.tribe, season, "Chose", { profile: { times: ["weeknight-evening"] } })).id;
  // Tribe A: nine members, each with a number. AM6 ticked the contact line on the form, AM8 said no there.
  for (let i = 0; i < 9; i++) {
    const m = await readyMember(db, k, season, `AM${i}`, {
      times: ["weeknight-evening"],
      daysAgo: 40 - i,
      whatsapp: `+23480200000${String(i).padStart(2, "0")}`,
      share: i === 6 ? true : i === 8 ? false : undefined,
    });
    am.push({ id: m.id, name: `AM${i} Test` });
  }
  for (let i = 0; i < 5; i++) bm.push(await readyMember(db, k, season, `BM${i}`, { times: ["sunday-afternoon"], daysAgo: 30 - i, whatsapp: `+23480300000${i}` }));
  for (let i = 0; i < 5; i++) cm.push(await readyMember(db, k, season, `CM${i}`, { times: ["saturday-morning"], daysAgo: 20 - i, whatsapp: `+23480400000${i}` }));
  await o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
  // The plan, with its order scrambled so that the tribes alternate (in a real run the hardest-to-place members belong to many tribes), then
  // approved and placed the way the page does it
  run = await planRun(o, {});
  await resolveAll(db, o, run, "keep");
  await db.admin.query("update public.placement_items set seq = seq + 1000000 where run_id = $1", [run]);
  await db.admin.query(
    `update public.placement_items i set seq = x.rk
       from (select y.id, (row_number() over (order by y.within, y.tribe_id, y.id))::int as rk
               from (select id, tribe_id, row_number() over (partition by tribe_id order by seq, id) as within
                       from public.placement_items where run_id = $1 and tribe_id is not null) y) x
      where i.id = x.id`,
    [run],
  );
  await o.call("placement_run_approve", run, await proposedCount(db, run));
  for (let step = 0; step < 40; step++) if ((await o.call("placement_run_place", run)).left === 0) break;
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("right after God Mode places people", () => {
  it("seats nine in tribe A, and says so", async () => {
    const placed = await sql("select person_id from public.tribe_members where tribe_id = $1 and placed_by_run = $2 and status = 'active'", [A.tribe, run]);
    expect(placed.length).toBe(9);
    expect((await sql("select count(*)::int c from public.tribe_members where placed_by_run = $1 and status = 'active'", [run]))[0].c).toBeGreaterThanOrEqual(19);
  });

  it("shows the leader every placed member by name on My tribe, the weekly log, the Lead page and the Dashboard, and none shows a number", async () => {
    const everyone = (await sql("select person_id from public.tribe_members where tribe_id = $1 and status = 'active'", [A.tribe])).map((r) => r.person_id as string).sort();
    expect(everyone.length).toBe(10);
    const mine = await roster(A.leader.id, A.tribe);
    expect(mine.members.map((m: RosterMember) => m.person_id).sort()).toEqual(everyone);
    const week = await asUser(db, A.leader.id, "tribe_week_marked", A.tribe);
    expect(week.members.map((m: RosterMember) => m.person_id).sort()).toEqual(everyone);
    const leading = await asUser(db, A.leader.id, "my_leading");
    expect(leading.members).toBe(10);
    const dash = await asUser(db, A.leader.id, "tribe_progress", A.tribe);
    expect(dash.member_rows.map((m: { person_id: string }) => m.person_id).sort()).toEqual(everyone);
    // the same people on all four, and no number for anyone the church placed (AM6 agreed on the form, so theirs is open: see below)
    for (const m of mine.members as RosterMember[]) {
      if (m.person_id === selfSeated) continue;
      expect(m.placement).toBe("pending");
      if (m.name !== "AM6 Test") expect(m.whatsapp).toBeNull();
    }
    for (const m of week.members as RosterMember[]) {
      if (m.person_id === selfSeated || m.name === "AM6 Test") continue;
      expect(m.whatsapp).toBeNull();
    }
    expect(JSON.stringify(dash)).not.toMatch(/\+234/);
  });

  it("marks each as placed by the church, and leaves the member who chose their own seat exactly as they were", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["Chose Test"]).not.toHaveProperty("placement");
    expect(by["Chose Test"]).not.toHaveProperty("contact");
    expect(by["AM0 Test"]).toMatchObject({ placement: "pending", contact: "waiting", whatsapp: null });
  });

  it("opens at once the contact of a member who agreed on the form, and withholds a member who said no there", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["AM6 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000006" });
    expect(by["AM8 Test"]).toMatchObject({ contact: "withheld", withheld: true, whatsapp: null });
  });

  it("gives the leader's assistant the same list, and refuses another tribe's leader and visitors", async () => {
    const a = await roster(A.assistant!.id, A.tribe);
    expect(a.members.length).toBe(10);
    await expectCode(db.asUser(B.leader.id, (q) => q("select public.tribe_roster_marked($1)", [A.tribe])), "42501");
    await expectCode(db.asAnon((q) => q("select public.tribe_roster_marked($1)", [A.tribe])), "42501");
  });
});

describe("no door around the rule", () => {
  it("makes the raw lists apply it: a leader calling them directly gets the same people with the same numbers withheld", async () => {
    const marked = await roster(A.leader.id, A.tribe);
    const raw = await asUser(db, A.leader.id, "tribe_roster", A.tribe);
    expect(raw.members).toEqual(marked.members);
    const rawWeek = await asUser(db, A.leader.id, "tribe_week", A.tribe);
    const markedWeek = await asUser(db, A.leader.id, "tribe_week_marked", A.tribe);
    expect(rawWeek.members).toEqual(markedWeek.members);
    expect(JSON.stringify(rawWeek.members)).not.toMatch(/\+2348020000000/);
    expect(byName(raw)["AM0 Test"].whatsapp).toBeNull();
  });

  it("applies it to the follow-up list in the weekly log too", async () => {
    await db.admin.query("insert into public.care_flags (tribe_id, person_id, kind, week) values ($1, $2, 'low_belonging', 1)", [A.tribe, am[0].id]);
    const week = await asUser(db, A.leader.id, "tribe_week", A.tribe);
    const flag = week.follow_ups.find((f: { person_id: string }) => f.person_id === am[0].id);
    expect(flag).toBeDefined();
    expect(flag.whatsapp).toBeNull();
    expect(flag.contact).toBe("waiting");
    await db.admin.query("delete from public.care_flags where tribe_id = $1", [A.tribe]);
  });

  it("is unchanged for a coach or a pastor, who are the church's own people", async () => {
    const director = await k.staff("Director", "director");
    const raw = await asUser(db, director.id, "tribe_roster", A.tribe);
    expect(byName(raw)["AM0 Test"].whatsapp).toBe("+2348020000000");
    expect(byName(raw)["AM0 Test"].placement).toBe("pending");
    expect(byName(raw)["AM8 Test"].whatsapp).toBeNull(); // a member who held back is held back for everyone
  });
});

describe("each member's own clock", () => {
  beforeAll(async () => {
    await setMsg(am[0].id, "sent", 30); // hold over
    await setMsg(am[1].id, "sent", 2); // in the hold
    await setMsg(am[2].id, "failed", null, ", error = 'bounced'"); // never reached
    // AM3 stays queued: still waiting
    await setMsg(am[4].id, "sent", 2);
    await setMsg(am[5].id, "sent", 2);
    await setMsg(am[7].id, "sent", 2);
    expect(await anon(db, "worker_placed_confirm", wt, (await linkFor(db, am[4].id))!, "2026-12-v4")).toMatchObject({ ok: true });
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, am[5].id))!)).toEqual({ ok: true, late: false });
  });

  it("opens a member's number when their own hold has run out, said yes, or agreed on the form", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["AM0 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000000" }); // 30 hours since their email
    expect(by["AM4 Test"]).toMatchObject({ contact: "open", placement: "confirmed", whatsapp: "+2348020000004" }); // said yes
    expect(by["AM6 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000006" }); // agreed on the form
  });

  it("keeps a member in the hold closed, and says when it ends", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    for (const n of ["AM1 Test", "AM7 Test"]) {
      expect(by[n]).toMatchObject({ contact: "holding", whatsapp: null, placement: "pending" });
      const opens = new Date(by[n].contact_opens_at as string).getTime();
      expect(Math.abs(opens - (Date.now() + 22 * 3600 * 1000))).toBeLessThan(10 * 60 * 1000); // 24 hours after an email sent 2 hours ago
    }
  });

  it("lists a member whose email failed, or has not gone yet, with no number, and never opens it by itself", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["AM2 Test"]).toMatchObject({ contact: "not_reached", whatsapp: null });
    expect(by["AM3 Test"]).toMatchObject({ contact: "waiting", whatsapp: null });
    // a week later, still no email: still closed
    await db.admin.query("update public.placement_runs set hold_hours = 1 where id = $1", [run]);
    await db.admin.query("update public.messages set scheduled_for = now() - interval '200 hours', created_at = now() - interval '200 hours' where template = 'placement_your_tribe' and person_id = $1", [am[3].id]);
    expect(byName(await roster(A.leader.id, A.tribe))["AM2 Test"]).toMatchObject({ contact: "not_reached", whatsapp: null });
    await db.admin.query("update public.placement_runs set hold_hours = 24 where id = $1", [run]);
  });

  it("never gives a leader the number of a member who held back", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["AM5 Test"]).toMatchObject({ contact: "withheld", withheld: true, whatsapp: null }); // from the link
    expect(by["AM8 Test"]).toMatchObject({ contact: "withheld", withheld: true, whatsapp: null }); // on the form
    // not even after their hold would have run out, nor when God Mode opens the tribe
    await db.admin.query("update public.messages set status = 'sent', sent_at = now() - interval '90 hours' where template = 'placement_your_tribe' and person_id = any($1)", [[am[5].id, am[8].id]]);
    expect(byName(await roster(A.leader.id, A.tribe))["AM5 Test"].whatsapp).toBeNull();
    await db.admin.query("update public.placement_teams set contact_opened_at = now() where run_id = $1 and tribe_id = $2", [run, A.tribe]);
    const opened = byName(await roster(A.leader.id, A.tribe));
    expect(opened["AM5 Test"]).toMatchObject({ contact: "withheld", whatsapp: null });
    expect(opened["AM8 Test"]).toMatchObject({ contact: "withheld", whatsapp: null });
    // God Mode's opening reaches the members who had not answered, and only them
    expect(opened["AM1 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000001" });
    expect(opened["AM3 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000003" });
    await db.admin.query("update public.placement_teams set contact_opened_at = null where run_id = $1 and tribe_id = $2", [run, A.tribe]);
  });

  it("lets a member hold back until their own details have opened, and not after", async () => {
    // AM1 is in the hold: still in time
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, am[1].id))!)).toEqual({ ok: true, late: false });
    expect(byName(await roster(A.leader.id, A.tribe))["AM1 Test"]).toMatchObject({ contact: "withheld", whatsapp: null });
    // AM4 said yes and nobody has been given their number by the clock: still in time
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, am[4].id))!)).toEqual({ ok: true, late: false });
    // AM0's hold ran out 6 hours ago: too late, and nothing changes for them
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, am[0].id))!)).toEqual({ ok: true, late: true });
    expect(byName(await roster(A.leader.id, A.tribe))["AM0 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000000" });
    // a member whose email failed, or has not gone yet, is never late
    await setMsg(cm[3].id, "failed", null, ", error = 'bounced'");
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, cm[3].id))!)).toEqual({ ok: true, late: false });
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, cm[4].id))!)).toEqual({ ok: true, late: false });
  });
});

describe("the leader's email", () => {
  it("does not go while someone in the tribe is waiting for an email or sitting in the hold", async () => {
    // A: AM3 waiting, AM7 holding. B and C: every email still queued.
    expect((await sql("select public.placement_team_mail($1) as r", [run]))[0].r).toBe(0);
    expect((await teamMails()).length).toBe(0);
  });

  it("is held back by one stuck email only until 72 hours after the tribe's last planned email, then goes with everyone listed", async () => {
    await db.admin.query(
      "update public.messages m set scheduled_for = now() - interval '73 hours' where m.template = 'placement_your_tribe' and m.person_id in (select person_id from public.tribe_members where tribe_id = $1 and placed_by_run = $2)",
      [A.tribe, run],
    );
    expect((await sql("select public.placement_team_mail($1) as r", [run]))[0].r).toBe(1); // tribe A only: B and C's emails are still being sent
    const mails = await teamMails();
    expect(new Set(mails.map((m) => m.person_id))).toEqual(new Set([A.leader.id, A.assistant!.id]));
    const members = mails[0].params.members as { name: string; state: string; email: string | null; whatsapp: string | null; withheld: boolean; opens_on: string | null }[];
    expect(members.length).toBe(9);
    const m = Object.fromEntries(members.map((x) => [x.name, x]));
    expect(m["AM0 Test"]).toMatchObject({ state: "open", whatsapp: "+2348020000000" });
    expect(m["AM0 Test"].email).toMatch(/@/);
    expect(m["AM2 Test"]).toMatchObject({ state: "not_reached", email: null, whatsapp: null });
    expect(m["AM3 Test"]).toMatchObject({ state: "waiting", email: null, whatsapp: null });
    expect(m["AM7 Test"]).toMatchObject({ state: "holding", email: null, whatsapp: null });
    expect(m["AM7 Test"].opens_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m["AM1 Test"]).toMatchObject({ state: "withheld", withheld: true, email: null, whatsapp: null });
    expect(m["AM8 Test"]).toMatchObject({ state: "withheld", withheld: true, email: null, whatsapp: null });
    // said once
    expect((await sql("select public.placement_team_mail($1) as r", [run]))[0].r).toBe(0);
  });

  it("does not open a member's number by being sent: the member in the hold stays closed after the email", async () => {
    const by = byName(await roster(A.leader.id, A.tribe));
    expect(by["AM7 Test"]).toMatchObject({ contact: "holding", whatsapp: null });
    expect(by["AM2 Test"]).toMatchObject({ contact: "not_reached", whatsapp: null });
    // and when the member's own hold ends, the number is on the page without another email
    await db.admin.query("update public.messages set sent_at = now() - interval '26 hours' where template = 'placement_your_tribe' and person_id = $1", [am[7].id]);
    expect(byName(await roster(A.leader.id, A.tribe))["AM7 Test"]).toMatchObject({ contact: "open", whatsapp: "+2348020000007" });
    expect((await teamMails()).length).toBe(2);
  });

  it("goes on time when a member's email failed: the failed member is listed without a number", async () => {
    // tribe B: four emails sent 30 hours ago, one failed
    const b = (await sql("select person_id from public.tribe_members where tribe_id = $1 and placed_by_run = $2 and status = 'active' order by person_id", [B.tribe, run])).map((r) => r.person_id as string);
    expect(b.length).toBe(5);
    for (const p of b.slice(0, 4)) await setMsg(p, "sent", 30);
    await setMsg(b[4], "failed", null, ", error = 'bounced'");
    expect((await sql("select public.placement_team_mail($1) as r", [run]))[0].r).toBe(1);
    const mail = (await teamMails()).find((m) => m.person_id === B.leader.id)!;
    const states = (mail.params.members as { state: string }[]).map((x) => x.state).sort();
    expect(states).toEqual(["not_reached", "open", "open", "open", "open"]);
  });
});

describe("the switch", () => {
  it("keeps finishing the people already placed when the switch is Rehearsal, so a flipped switch never leaves a tribe closed", async () => {
    const c = (await sql("select person_id from public.tribe_members where tribe_id = $1 and placed_by_run = $2 and status = 'active'", [C.tribe, run])).map((r) => r.person_id as string);
    for (const p of c) await setMsg(p, "sent", 30);
    await o.call("placement_settings_save", JSON.stringify({ mode: "rehearsal" }));
    const t = (await sql("select public.placement_tick() as r"))[0].r;
    expect(t).toMatchObject({ mode: "rehearsal", teams: 1 });
    expect((await teamMails()).some((m) => m.person_id === C.leader.id)).toBe(true);
  });

  it("with the switch Off and a live run waiting, still opens a tribe that is due, and starts nothing new", async () => {
    // a second run for two new members, approved but not placed; the first run's tribes are all told by now
    await readyMember(db, k, season, "Late0", { times: ["sunday-afternoon"], daysAgo: 30 });
    await readyMember(db, k, season, "Late1", { times: ["sunday-afternoon"], daysAgo: 29 });
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    const second = await placeRun(db, o, {});
    // everything placed in the second run: its team waits for their emails; make them due, then switch Off
    const late = (await sql("select person_id from public.tribe_members where placed_by_run = $1 and status = 'active'", [second.run])).map((r) => r.person_id as string);
    expect(late.length).toBeGreaterThan(0);
    for (const p of late) await setMsg(p, "sent", 30);
    await o.call("placement_settings_save", JSON.stringify({ mode: "off" }));
    const before = (await teamMails()).length;
    const t = (await sql("select public.placement_tick() as r"))[0].r;
    expect(t.mode).toBe("off");
    expect(t.teams).toBeGreaterThanOrEqual(1);
    expect(t.batches).toBe(0);
    expect((await teamMails()).length).toBeGreaterThan(before);
  });

  it("starts nothing new with the switch Off: an approved run is not placed by the heartbeat", async () => {
    await readyMember(db, k, season, "Late2", { times: ["saturday-morning"], daysAgo: 28 });
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    const plan = await (async () => {
      const made = await o.call("placement_run_new", JSON.stringify({}));
      for (let i = 0; i < 60; i++) if ((await o.call("placement_run_step", made.run)).status !== "planning") break;
      return made.run as string;
    })();
    const n = (await one("select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed'", [plan])).n;
    expect(n).toBeGreaterThan(0);
    await o.call("placement_run_approve", plan, n);
    await o.call("placement_settings_save", JSON.stringify({ mode: "off" }));
    const t = (await sql("select public.placement_tick() as r"))[0].r;
    expect(t.mode).toBe("off");
    expect((await one("select status from public.placement_runs where id = $1", [plan])).status).toBe("approved");
    expect((await one("select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed'", [plan])).n).toBe(n);
    await o.call("placement_settings_save", JSON.stringify({ mode: "on" }));
    await o.call("placement_run_cancel", plan);
    await o.call("placement_settings_save", JSON.stringify({ mode: "off" }));
  });

  it("does exactly what it did with the switch Off when nothing live is waiting", async () => {
    await db.admin.query("update public.placement_teams set mail_queued_at = coalesce(mail_queued_at, now()) where cancelled_at is null");
    expect((await sql("select public.placement_tick() as r"))[0].r).toEqual({ mode: "off" });
    expect((await one("select public.placement_mode() as m")).m).toBe("off");
  });

  it("notes when the heartbeat ran, every time", async () => {
    const first = (await one("select last_tick_at from public.placement_settings")).last_tick_at as Date;
    expect(first).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 15));
    await sql("select public.placement_tick()");
    const second = (await one("select last_tick_at from public.placement_settings")).last_tick_at as Date;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(((await o.call("placement_settings_get")) as { last_tick_at: string }).last_tick_at).toBeTruthy();
  });
});

describe("the group link", () => {
  let G: Awaited<ReturnType<Kit["tribe"]>>;
  const members: { id: string }[] = [];
  let groupRun: string;

  beforeAll(async () => {
    // a fresh tribe and run (the earlier runs are finished)
    G = await k.tribe(season, { capacity: 12, name: "Vis G", slot: "sunday-evening" });
    await db.admin.query("update public.tribes set whatsapp_group_url = 'https://chat.whatsapp.com/VisibilityGroupG' where id = $1", [G.tribe]);
    for (let i = 0; i < 6; i++) {
      members.push(await readyMember(db, k, season, `GM${i}`, { times: ["sunday-evening"], daysAgo: 25 - i, whatsapp: `+23480500000${i}`, share: i === 0 ? true : i === 1 ? false : undefined }));
    }
    await o.call("placement_settings_save", JSON.stringify({ mode: "on", min_tribe: 4 }));
    ({ run: groupRun } = await placeRun(db, o, {}));
  }, 120_000);

  const memberEmail = (person: string) => one("select params from public.messages where template = 'placement_your_tribe' and person_id = $1", [person]);

  it("is on by default, and a God Mode setting that is checked", async () => {
    const s = (await o.call("placement_settings_get")) as { hold_group_link: boolean };
    expect(s.hold_group_link).toBe(true);
    await expectCode(o.run((q) => q("select public.placement_settings_save($1::jsonb)", [JSON.stringify({ hold_group_link: "yes" })])), "22023");
    await expectCode(o.run((q) => q("select public.placement_settings_save($1::jsonb)", [JSON.stringify({ hold_group_link: 1 })])), "22023");
    await expectCode(db.asUser(G.leader.id, (q) => q("select public.placement_settings_save($1::jsonb)", [JSON.stringify({ hold_group_link: false })])), "42501");
  });

  it("keeps the link out of the first email of a member who has not answered, and says it will come", async () => {
    const e = (await memberEmail(members[2].id)).params;
    expect(e.group_url).toBeNull();
    expect(e.group_held).toBe(true);
  });

  it("puts the link in the first email of a member who agreed on the form, or said no there (they have answered)", async () => {
    expect((await memberEmail(members[0].id)).params).toMatchObject({ group_url: "https://chat.whatsapp.com/VisibilityGroupG", group_held: false });
    expect((await memberEmail(members[1].id)).params).toMatchObject({ group_url: "https://chat.whatsapp.com/VisibilityGroupG", group_held: false });
  });

  it("keeps the link off the member's page and the private link page until they say yes, with the date it will come", async () => {
    const link = (await linkFor(db, members[2].id))!;
    await setMsg(members[2].id, "sent", 2);
    const info = await anon(db, "worker_placed_info", wt, link);
    expect(info.group_visible).toBe(false);
    expect(info.tribe.group_url).toBeNull();
    expect(info.contact).toBe("holding");
    expect(info.group_opens_at).toBeTruthy();
    expect(info.contact_opens_at).toBe(info.group_opens_at);
    const match = await asUser(db, members[2].id, "my_match");
    expect(match.placement.group_url).toBeNull();
    const week = await asUser(db, members[2].id, "my_week");
    expect(week.tribe.group_url).toBeNull();
  });

  it("shows the link at once on 'Yes, I'm in', on every page", async () => {
    const link = (await linkFor(db, members[2].id))!;
    expect(await anon(db, "worker_placed_confirm", wt, link, "2026-12-v4")).toMatchObject({ ok: true });
    const info = await anon(db, "worker_placed_info", wt, link);
    expect(info).toMatchObject({ group_visible: true, group_opens_at: null });
    expect(info.tribe.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    expect((await asUser(db, members[2].id, "my_match")).placement.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    expect((await asUser(db, members[2].id, "my_week")).tribe.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
  });

  it("shows the link when the member's hold has ended, without anything else", async () => {
    await setMsg(members[3].id, "sent", 30);
    expect((await asUser(db, members[3].id, "my_match")).placement.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
  });

  it("gives a member who held back the link, with the first-email params that say so, because they have answered", async () => {
    await setMsg(members[4].id, "sent", 2);
    expect((await asUser(db, members[4].id, "my_match")).placement.group_url).toBeNull();
    expect(await anon(db, "worker_placed_withhold", wt, (await linkFor(db, members[4].id))!)).toEqual({ ok: true, late: false });
    expect((await asUser(db, members[4].id, "my_match")).placement.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    const withheld = await one("select params from public.messages where template = 'placement_withheld' and person_id = $1", [members[4].id]);
    expect(withheld.params.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
  });

  it("restores today's behaviour when the setting is Off: the link shows at once, and goes in every first email", async () => {
    await setMsg(members[5].id, "sent", 2);
    expect((await asUser(db, members[5].id, "my_match")).placement.group_url).toBeNull(); // in the hold
    await o.call("placement_settings_save", JSON.stringify({ hold_group_link: false }));
    const fresh = await readyMember(db, k, season, "GMOff", { times: ["sunday-evening"], daysAgo: 24, whatsapp: "+2348050000099" });
    const p = (await one("select public.placement_member_params($1, $2, 80) as p", [G.tribe, fresh.id])).p;
    expect(p.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    expect(p.group_held).toBe(false);
    // and the member still in the hold sees the link now
    expect((await asUser(db, members[5].id, "my_match")).placement.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    expect((await anon(db, "worker_placed_info", wt, (await linkFor(db, members[5].id))!)).group_visible).toBe(true);
    await o.call("placement_settings_save", JSON.stringify({ hold_group_link: true }));
    expect((await asUser(db, members[5].id, "my_match")).placement.group_url).toBeNull();
    expect(groupRun).toBeTruthy();
  });

  it("shows a member who chose their own seat the link at once, whatever the setting", async () => {
    const own = await k.seat(G.tribe, season, "OwnChoice");
    expect((await asUser(db, own.id, "my_match")).placement.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
    expect((await asUser(db, own.id, "my_week")).tribe.group_url).toBe("https://chat.whatsapp.com/VisibilityGroupG");
  });
});

describe("tribe by tribe", () => {
  it("places and sends each tribe's emails in one block, hardest-to-place tribe first, without changing who is in which tribe", async () => {
    const items = await sql(
      "select i.tribe_id, i.seq, i.slot_at from public.placement_items i where i.run_id = $1 and i.status = 'placed' order by i.slot_at, i.id",
      [run],
    );
    expect(items.length).toBeGreaterThanOrEqual(19);
    // read the tribes in the order their emails fall: each appears in one block
    const order: string[] = [];
    for (const it of items) if (order[order.length - 1] !== it.tribe_id) order.push(it.tribe_id as string);
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBe(3);
    // the first block belongs to the tribe holding the hardest-to-place member (the lowest plan sequence)
    const first = await one("select tribe_id from public.placement_items where run_id = $1 and status = 'placed' order by seq limit 1", [run]);
    expect(order[0]).toBe(first.tribe_id);
    // the same people, in the tribes the plan chose
    const wrong = await sql(
      "select count(*)::int c from public.placement_items i join public.tribe_members m on m.id = i.placement_id where i.run_id = $1 and i.status = 'placed' and m.tribe_id <> i.tribe_id",
      [run],
    );
    expect(wrong[0].c).toBe(0);
  });
});
