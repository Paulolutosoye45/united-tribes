import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { answers, calling } from "./pipeline-kit";

// "Let them choose": the owner unlocks the goal (and, if ticked, the community) on the Tribe Card of a leader the owner appointed, and the
// leader picks from a list on their own card. Only the owner, only for leaders the owner appointed, only while the card is a draft or sent
// back and nobody has joined. Sensitive goals stay gated. The leader's own words are kept. The welcome email waits for the pastor's approval.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let pastor: string;
let director: string;
let adminId: string;
let seasonId: string;
let n = 0;

const ZERO = "00000000-0000-0000-0000-000000000000";
const VERSION = "test-v1";

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;
const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug])).id as string;
const title = async (slug: string) => (await one("select title from public.season_goals where slug = $1", [slug])).title as string;

const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const PIPE = { track: "builders", lead_best: "connection", community: "consulting", goal: "build-a-steady-client-pipeline", relation: "achieved" };
const MARRIAGE = { track: "builders", lead_best: "connection", community: "marriage-relationships", goal: "strengthen-our-marriage", relation: "achieved", care_cleared: true };
const MENTOR = "find-a-mentor-and-become-one";
const REPUTATION = "build-a-reputation-for-excellent-work";
const LEADERSHIP = "step-into-a-leadership-role";

async function candidate(name = `Candidate${++n}`) {
  const u = await k.person(name);
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Surname`, name]);
  return u;
}

/** Appoints a new person through the owner's door and returns the person and their tribe. */
async function appoint(form: Record<string, unknown>, name?: string) {
  const p = await candidate(name);
  const r = await o.call("god_appoint_leader", p.id, JSON.stringify(form), await goalId(String(form.goal)), null);
  return { person: p.id as string, tribe: r.tribe as string, appointment: r.appointment as string };
}
/** A consulting leader started on the given goal. */
const consulting = (goal: string, name?: string) => appoint({ ...PIPE, goal }, name);

const unlock = (tribes: string[], community = false, welcome = false, version: string | null = null) => o.call("god_unlock_goal", tribes, community, welcome, version);
const lock = (tribes: string[]) => o.call("god_lock_goal", tribes);
const view = async (tribes: string[]) => {
  const rows = (await o.call("god_goal_unlock_view", tribes)) as Row[];
  return new Map(rows.map((r) => [r.tribe as string, r]));
};
const save = (person: string, tribe: string, fields: Record<string, unknown>) => call(person, "save_tribe_card", [tribe, JSON.stringify(fields)]);
const tribeRow = async (id: string) =>
  one(
    `select t.*, g.slug as goal_slug, c.slug as community_slug from public.tribes t
       left join public.season_goals g on g.id = t.season_goal_id left join public.communities c on c.id = t.community_id where t.id = $1`,
    [id],
  );
const template = async (slug: string) => one("select * from public.tribe_card_templates where slug = $1", [slug]);
const lines = (t: Row) => ({ god: t.loving_god, others: t.loving_others, life: t.loving_life });
const cardLines = (c: Row) => ({ god: c.loving_god, others: c.loving_others, life: c.loving_life });

/** Fills in what a card needs before it can be sent, then sends it (as the leader's send button would leave it). */
async function send(tribe: string) {
  await sql(
    `update public.tribes set story = coalesce(story, repeat('x', 50)), meeting_day = 3, meeting_time = '20:00', slot = 'weeknight-evening',
            meeting_mode = 'in_person', zone = 'mainland' where id = $1`,
    [tribe],
  );
  await sql("update public.tribes set status = 'submitted', submitted_at = now() where id = $1", [tribe]);
}
const sendBack = (tribe: string) => sql("update public.tribes set status = 'changes_requested' where id = $1", [tribe]);

/** A member joins the tribe (with the platform's other triggers out of the way, as other tests seat people). */
async function join(tribe: string) {
  const p = await k.person(`Joiner${++n}`);
  await db.admin.query("begin");
  try {
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
      [tribe, p.id, seasonId],
    );
    await db.admin.query("commit");
  } catch (error) {
    await db.admin.query("rollback");
    throw error;
  }
}

async function waiting(slug: string, howMany: number) {
  const g = await goalId(slug);
  for (let i = 0; i < howMany; i++) {
    const u = await k.person(`Waiting${++n}`);
    await sql(
      "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, $2, g.id, g.community_id, 'any', 0 from public.season_goals g where g.id = $3",
      [u.id, seasonId, g],
    );
  }
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  adminId = (await k.staff("Admin", "admin")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
  await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  await waiting(MENTOR, 5);
  await waiting(REPUTATION, 2);
  await waiting("build-a-steady-client-pipeline", 6);
  await waiting("land-my-first-three-clients", 4);
  await waiting("strengthen-our-marriage", 3);
}, 300_000);

afterAll(async () => {
  await db?.close();
});

describe("who may use it", () => {
  const CALLS: [string, unknown[]][] = [
    ["god_unlock_goal", [[ZERO], false, false, null]],
    ["god_unlock_goal_run", [ZERO, false, false, null]],
    ["god_lock_goal", [[ZERO]]],
    ["god_goal_unlock_view", [[ZERO]]],
    ["god_welcome_settings_get", [VERSION]],
    ["god_welcome_settings_save", ["Wale Ekundayo", "Pastor TCN Iganmu Center"]],
    ["god_welcome_approve", [VERSION]],
    ["god_welcome_withdraw", []],
    ["god_welcome_send", [[ZERO], VERSION, false]],
  ];
  const text = (fn: string, args: unknown[]) => `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`;

  it("refuses everyone who is not the owner, whatever their role", async () => {
    const leader = await k.staff("SomeLeader", "leader");
    const member = await k.person("Plain");
    for (const who of [adminId, director, pastor, leader.id, member.id]) {
      for (const [fn, args] of CALLS) await expectCode(db.asUser(who, (q) => q(text(fn, args), args)), "42501");
    }
    for (const [fn, args] of CALLS) await expectCode(db.asAnon((q) => q(text(fn, args), args)), "42501");
  });

  it("refuses the owner too, until they have unlocked on this sign-in", async () => {
    for (const [fn, args] of CALLS) await expectCode(db.asUser(o.owner.id, (q) => q(text(fn, args), args), { session: randomUUID() }), "42501");
  });

  it("keeps the three tables closed to every client, with row level security on and no policy", async () => {
    for (const t of ["leader_goal_unlock", "leader_welcome_settings", "leader_welcome_sends"]) {
      for (const who of [adminId, pastor, o.owner.id]) await expectCode(db.asUser(who, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${t}`)), "42501");
      const r = await one("select c.relrowsecurity rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) pol from pg_class c where c.oid = $1::regclass", [`public.${t}`]);
      expect(r).toEqual({ rls: true, pol: 0 });
    }
  });

  it("closes the internal functions and the trigger function to every client", async () => {
    for (const statement of ["select public.leader_goal_unlock_why_not($1)", "select public.leader_welcome_queue($1, 'x', false)"]) {
      await expectCode(db.asUser(o.owner.id, (q) => q(statement, [ZERO]), { session: o.session }), "42501");
      await expectCode(db.asUser(adminId, (q) => q(statement, [ZERO])), "42501");
      await expectCode(db.asAnon((q) => q(statement, [ZERO])), "42501");
    }
    const r = await one(
      `select has_function_privilege('authenticated', p.oid, 'execute') a, has_function_privilege('anon', p.oid, 'execute') b
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'leader_goal_guard'`,
    );
    expect(r).toEqual({ a: false, b: false });
  });

  it("limits the leader's list to the leader, and the reviewer's note to the office", async () => {
    await expectCode(db.asAnon((q) => q("select public.tribe_goal_hints($1)", [ZERO])), "42501");
    await expectCode(db.asAnon((q) => q("select public.tribe_goal_choice_note($1)", [ZERO])), "42501");
    const member = await k.person("Plain2");
    await expectCode(db.asUser(member.id, (q) => q("select public.tribe_goal_choice_note($1)", [ZERO])), "42501");
  });
});

describe("unlocking one leader's goal", () => {
  let ada: { person: string; tribe: string; appointment: string };

  it("starts from a card with the community, goal and life stage locked", async () => {
    ada = await appoint(FORM, "Ada");
    const t = await tribeRow(ada.tribe);
    expect(t.fixed.slice().sort()).toEqual(["community", "goal", "track"]);
    expect(t).toMatchObject({ goal_slug: LEADERSHIP, community_slug: "professionals", name: "Ada’s Professionals tribe" });
  });

  it("gives the leader no list while the goal is locked, and refuses a card that is not theirs with the message a wrong id gets", async () => {
    expect(await call(ada.person, "tribe_goal_hints", [ada.tribe])).toBeNull();
    await expect(call(ada.person, "tribe_goal_hints", [ZERO])).rejects.toThrow(/Tribe Card not found/);
  });

  it("reports that it can be unlocked, and why not for a tribe that was not appointed", async () => {
    const lead = await k.tribe(seasonId, { community: "consulting" });
    const v = await view([ada.tribe, lead.tribe, ZERO]);
    expect(v.get(ada.tribe)).toMatchObject({ can_unlock: true, can_lock: false, state: "none", why: null, welcome: [] });
    expect(v.get(lead.tribe)).toMatchObject({ can_unlock: false, why: "Only a leader you appointed can be given the choice" });
    expect(v.has(ZERO)).toBe(false); // no such tribe: nothing is said about it
  });

  it("unlocks the goal only: the community and life stage stay locked, and no email goes", async () => {
    const mailBefore = await count("select count(*)::int c from public.messages");
    const r = await unlock([ada.tribe]);
    expect(r).toMatchObject({ unlocked: 1, skipped: 0, mail: [] });
    const t = await tribeRow(ada.tribe);
    expect(t.fixed.slice().sort()).toEqual(["community", "track"]);
    expect(t.goal_slug).toBe(LEADERSHIP);
    expect(await count("select count(*)::int c from public.messages")).toBe(mailBefore);
    const rec = await one("select * from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]);
    expect(rec).toMatchObject({ state: "open", community_too: false, care_cleared: false, picks: 0, chosen_goal_id: null, appointment_id: ada.appointment });
    expect(rec.fixed_before.slice().sort()).toEqual(["community", "goal", "track"]);
    expect(rec.started_goal_id).toBe(await goalId(LEADERSHIP));
    expect(rec.unlocked_by).toBe(o.owner.id);
  });

  it("records it for the owner alone: the private record names the goal, the office's trail has no name", async () => {
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.goal_unlocked'")).toBe(1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.goal_unlocked' and actor_id is not null")).toBe(0);
    const g = await one("select detail from public.god_log where action = 'leader.goal_unlocked'");
    expect(g.detail).toMatchObject({ goal: await title(LEADERSHIP), community_too: false });
  });

  it("changes nothing when pressed again", async () => {
    const before = await one("select * from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]);
    const r = await unlock([ada.tribe]);
    expect(r.results[0]).toMatchObject({ ok: true, already: true });
    expect(await one("select * from public.leader_goal_unlock where tribe_id = $1", [ada.tribe])).toEqual(before);
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.goal_unlocked'")).toBe(1);
  });

  it("reports the state to the owner: waiting for a pick", async () => {
    const v = (await view([ada.tribe])).get(ada.tribe)!;
    expect(v).toMatchObject({ state: "waiting", can_lock: true, can_unlock: false, picks: 0, started: await title(LEADERSHIP), chosen: null });
  });

  it("refuses an ordinary tribe, a card already sent, one with a member and a closed tribe, and goes ahead with the rest", async () => {
    const ordinary = await k.tribe(seasonId, { community: "consulting" });
    const ordinaryFixed = (await tribeRow(ordinary.tribe)).fixed;
    const sent = await consulting("price-and-package-my-expertise", "Sent");
    await send(sent.tribe);
    const joined = await consulting("turn-one-off-projects-into-retainers", "Joined");
    await join(joined.tribe);
    const closed = await consulting("build-a-visible-expert-brand", "Closed");
    await sql("update public.tribes set status = 'closed' where id = $1", [closed.tribe]);
    const fine = await consulting("set-boundaries-so-clients-do-not-run-my-week", "Fine");
    const r = await unlock([ordinary.tribe, sent.tribe, joined.tribe, closed.tribe, fine.tribe, ZERO]);
    expect(r.unlocked).toBe(1);
    expect(r.skipped).toBe(5);
    const why = new Map((r.results as Row[]).map((x) => [x.tribe, x.reason]));
    expect(why.get(ordinary.tribe)).toBe("Only a leader you appointed can be given the choice");
    expect(why.get(sent.tribe)).toMatch(/has been sent to the pastorate/);
    expect(why.get(joined.tribe)).toMatch(/A member has joined/);
    expect(why.get(closed.tribe)).toBe("That tribe is closed");
    expect(why.get(ZERO)).toBe("We could not find that tribe");
    expect((await tribeRow(fine.tribe)).fixed).not.toContain("goal");
    for (const t of [sent.tribe, joined.tribe, closed.tribe]) expect((await tribeRow(t)).fixed).toContain("goal");
    expect((await tribeRow(ordinary.tribe)).fixed).toEqual(ordinaryFixed);
    expect(await count("select count(*)::int c from public.leader_goal_unlock where tribe_id = any($1)", [[ordinary.tribe, sent.tribe, joined.tribe, closed.tribe]])).toBe(0);
  });

  it("refuses an empty choice and more than 300 at a time", async () => {
    await expectCode(unlock([]), "22023");
    await expectCode(o.call("god_unlock_goal", null, false, false, null), "22023");
    await expectCode(unlock(Array.from({ length: 301 }, () => randomUUID())), "22023");
    await expectCode(lock([]), "22023");
  });

  it("can add the community afterwards, and only then", async () => {
    const x = await consulting("write-proposals-and-contracts-that-protect-me", "Later");
    await unlock([x.tribe]);
    expect((await tribeRow(x.tribe)).fixed.slice().sort()).toEqual(["community", "track"]);
    const r = await unlock([x.tribe], true);
    expect(r.results[0]).toMatchObject({ ok: true, already: true, community_added: true });
    expect((await tribeRow(x.tribe)).fixed).toEqual(["track"]);
    expect((await one("select community_too from public.leader_goal_unlock where tribe_id = $1", [x.tribe])).community_too).toBe(true);
  });
});

describe("the leader's list", () => {
  let ada: { person: string; tribe: string };

  beforeAll(async () => {
    const t = await one("select t.id, t.leader_id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Ada'");
    ada = { person: t.leader_id, tribe: t.id };
  });

  it("holds the goals of their community that have a signed-off card, none of them sensitive, the started goal first and then the most waited for", async () => {
    const hints = await call(ada.person, "tribe_goal_hints", [ada.tribe]);
    const expected = await sql(
      `select g.slug, coalesce(d.waiting, 0)::int as waiting, (g.id = u.started_goal_id) as started
         from public.season_goals g
         join public.communities c on c.id = g.community_id
         join public.tribe_card_templates tp on tp.season_goal_id = g.id and tp.status = 'signed_off'
         join public.leader_goal_unlock u on u.tribe_id = $1
         left join public.goal_demand_rows($2) d on d.goal_id = g.id
        where c.slug = 'professionals' and g.active and not tp.sensitive
        order by 3 desc, 2 desc, c.sort, g.sort, g.title`,
      [ada.tribe, seasonId],
    );
    expect(expected.length).toBeGreaterThanOrEqual(8);
    expect(hints.goals.map((g: Row) => g.slug)).toEqual(expected.map((g) => g.slug));
    expect(hints.goals[0]).toMatchObject({ slug: LEADERSHIP, started: true, waiting: 0, title: await title(LEADERSHIP), community: "professionals" });
    expect(hints.goals[1]).toMatchObject({ slug: MENTOR, started: false, waiting: 5 });
    expect(hints.goals[2]).toMatchObject({ slug: REPUTATION, started: false, waiting: 2 });
    expect(hints.goals.map((g: Row) => g.slug)).not.toContain("handle-workplace-conflict-with-grace"); // sensitive
    expect(hints.goals.every((g: Row) => g.community === "professionals")).toBe(true);
    expect(hints).toMatchObject({ community_too: false, community: "professionals", goal: LEADERSHIP });
    expect(hints.lines.god).toBeTruthy();
  });

  it("gives the same 'waiting' figure the fit engine reads", async () => {
    const hints = await call(ada.person, "tribe_goal_hints", [ada.tribe]);
    for (const g of hints.goals as Row[]) {
      const d = await one("select waiting from public.goal_demand_rows($1) where goal_id = $2", [seasonId, g.id]);
      expect(g.waiting, g.slug).toBe(d.waiting);
    }
  });

  it("is refused to anyone but the leader, and is empty for the leader once the card is sent", async () => {
    await expect(call(adminId, "tribe_goal_hints", [ada.tribe])).rejects.toThrow(/Tribe Card not found/);
    await expect(call(pastor, "tribe_goal_hints", [ada.tribe])).rejects.toThrow(/Tribe Card not found/);
    const other = await candidate("Other");
    await expect(call(other.id, "tribe_goal_hints", [ada.tribe])).rejects.toThrow(/Tribe Card not found/);
    await send(ada.tribe);
    expect(await call(ada.person, "tribe_goal_hints", [ada.tribe])).toBeNull();
    await sendBack(ada.tribe);
    expect((await call(ada.person, "tribe_goal_hints", [ada.tribe])).goals.length).toBeGreaterThan(5);
  });

  it("spans every community, still without the sensitive goals, when the community is unlocked as well", async () => {
    const b = await consulting("build-a-steady-client-pipeline", "Bola");
    await unlock([b.tribe], true);
    const hints = await call(b.person, "tribe_goal_hints", [b.tribe]);
    expect(hints.community_too).toBe(true);
    expect(new Set((hints.goals as Row[]).map((g) => g.community)).size).toBe(11);
    const sensitive = (await sql("select g.slug from public.season_goals g join public.tribe_card_templates tp on tp.season_goal_id = g.id where tp.sensitive")).map((r) => r.slug);
    expect(sensitive.length).toBeGreaterThan(3);
    for (const g of hints.goals as Row[]) expect(sensitive, g.slug).not.toContain(g.slug);
    expect(hints.goals[0]).toMatchObject({ slug: "build-a-steady-client-pipeline", started: true });
    expect(hints.goals[1].waiting).toBeGreaterThanOrEqual(hints.goals[2].waiting);
    expect(hints.goals[1]).toMatchObject({ slug: MENTOR, waiting: 5 });
  });

  it("includes the sensitive goals only for a leader the owner said a pastor cleared, and the goal the church started them on in any case", async () => {
    const c = await appoint(MARRIAGE, "Chi");
    await unlock([c.tribe], true);
    const slugs = ((await call(c.person, "tribe_goal_hints", [c.tribe])).goals as Row[]).map((g) => g.slug);
    expect(slugs[0]).toBe("strengthen-our-marriage");
    expect(slugs).toContain("prepare-well-for-marriage");
    expect(slugs).toContain("reach-a-health-milestone");
    // A leader whose clearance the record does not carry (one a bulk run appointed) keeps the goal they were started on but gets no other sensitive one
    await sql("update public.leader_goal_unlock set care_cleared = false where tribe_id = $1", [c.tribe]);
    const plain = ((await call(c.person, "tribe_goal_hints", [c.tribe])).goals as Row[]).map((g) => g.slug);
    expect(plain).toContain("strengthen-our-marriage");
    expect(plain).not.toContain("prepare-well-for-marriage");
    expect(plain).not.toContain("reach-a-health-milestone");
    await sql("update public.leader_goal_unlock set care_cleared = true where tribe_id = $1", [c.tribe]);
  });

  it("leaves out a goal whose ready-made card is no longer signed off", async () => {
    const slug = "manage-my-time-and-energy-at-work";
    expect(((await call(ada.person, "tribe_goal_hints", [ada.tribe])).goals as Row[]).map((g) => g.slug)).toContain(slug);
    await sql("update public.tribe_card_templates set status = 'retired' where slug = $1", [slug]);
    expect(((await call(ada.person, "tribe_goal_hints", [ada.tribe])).goals as Row[]).map((g) => g.slug)).not.toContain(slug);
    await sql("update public.tribe_card_templates set status = 'signed_off' where slug = $1", [slug]);
  });
});

describe("what the leader picks", () => {
  let ada: { person: string; tribe: string };
  const named = { mentor: "", reputation: "" };

  beforeAll(async () => {
    const t = await one("select t.id, t.leader_id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Ada'");
    ada = { person: t.leader_id, tribe: t.id };
    named.mentor = await title(MENTOR);
    named.reputation = await title(REPUTATION);
  });

  it("changes the goal through the card's own saving, refills the three lines from the new card, and records the pick", async () => {
    const was = await tribeRow(ada.tribe);
    const oldCard = await template(LEADERSHIP);
    expect(lines(was)).toEqual(cardLines(oldCard));
    await save(ada.person, ada.tribe, { goal: MENTOR });
    const t = await tribeRow(ada.tribe);
    const card = await template(MENTOR);
    expect(t.goal_slug).toBe(MENTOR);
    expect(lines(t)).toEqual(cardLines(card));
    expect(t.loving_god).not.toBe(oldCard.loving_god);
    const rec = await one("select * from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]);
    expect(rec).toMatchObject({ picks: 1, waiting_at_pick: 5, seats_open_at_pick: 0, chosen_goal_id: await goalId(MENTOR) });
    expect(rec.chosen_at).not.toBeNull();
  });

  it("keeps a line the leader wrote, and refills the others", async () => {
    await save(ada.person, ada.tribe, { others: "We carry each other in prayer every day, and nobody walks alone." });
    await save(ada.person, ada.tribe, { goal: REPUTATION });
    const t = await tribeRow(ada.tribe);
    const card = await template(REPUTATION);
    expect(t.loving_others).toBe("We carry each other in prayer every day, and nobody walks alone.");
    expect(t.loving_god).toBe(card.loving_god);
    expect(t.loving_life).toBe(card.loving_life);
  });

  it("keeps a line the leader wrote in the same save that changes the goal", async () => {
    await save(ada.person, ada.tribe, { goal: MENTOR, god: "We read the passage and say the confession together, five days a week." });
    const t = await tribeRow(ada.tribe);
    expect(t.loving_god).toBe("We read the passage and say the confession together, five days a week.");
    expect(t.loving_life).toBe((await template(MENTOR)).loving_life);
    expect(t.loving_others).toBe("We carry each other in prayer every day, and nobody walks alone.");
  });

  it("refills a line the leader emptied", async () => {
    await save(ada.person, ada.tribe, { life: "" });
    expect((await tribeRow(ada.tribe)).loving_life).toBeNull();
    await save(ada.person, ada.tribe, { goal: REPUTATION });
    expect((await tribeRow(ada.tribe)).loving_life).toBe((await template(REPUTATION)).loving_life);
  });

  it("counts a change of mind, not a second look at the same goal", async () => {
    const rec = () => one("select picks, waiting_at_pick, chosen_goal_id from public.leader_goal_unlock where tribe_id = $1", [ada.tribe]);
    expect((await rec()).picks).toBe(4);
    await save(ada.person, ada.tribe, { goal: REPUTATION, story: "I have led teams for ten years and want to help others do the same." });
    expect((await rec()).picks).toBe(4);
    await save(ada.person, ada.tribe, { goal: MENTOR });
    expect(await rec()).toMatchObject({ picks: 5, waiting_at_pick: 5, chosen_goal_id: await goalId(MENTOR) });
  });

  it("writes each pick to the owner's private record and to the office's trail as the leader's", async () => {
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.goal_chosen' and entity_id = $1", [ada.tribe])).toBe(5);
    const first = await one("select detail from public.god_log where action = 'leader.goal_chosen' and entity_id = $1 order by id limit 1", [ada.tribe]);
    expect(first.detail).toMatchObject({ goal: named.mentor, was: await title(LEADERSHIP), waiting: 5 });
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.goal_chosen' and actor_id = $1", [ada.person])).toBe(5);
  });

  it("shows the owner what was chosen, from what, and how many were waiting", async () => {
    const v = (await view([ada.tribe])).get(ada.tribe)!;
    expect(v).toMatchObject({
      state: "changed", picks: 5, started: await title(LEADERSHIP), chosen: named.mentor, goal_now: named.mentor, waiting_at_pick: 5,
    });
  });

  it("does not let the leader change the community when only the goal was unlocked", async () => {
    // the community stays what it is, so a goal from another community is not on their list
    await expect(save(ada.person, ada.tribe, { community: "consulting", goal: "build-a-steady-client-pipeline" })).rejects.toThrow(/Choose a Season Goal/);
    await save(ada.person, ada.tribe, { community: "consulting" });
    expect((await tribeRow(ada.tribe)).community_slug).toBe("professionals");
    expect((await tribeRow(ada.tribe)).goal_slug).toBe(MENTOR);
  });

  it("does not let the leader take a goal that does not exist", async () => {
    await expect(save(ada.person, ada.tribe, { goal: "no-such-goal" })).rejects.toThrow(/Choose a Season Goal/);
  });

  it("refuses a goal whose ready-made card is not signed off, even if something else sets it", async () => {
    const slug = "manage-my-time-and-energy-at-work";
    await sql("update public.tribe_card_templates set status = 'retired' where slug = $1", [slug]);
    await expect(save(ada.person, ada.tribe, { goal: slug })).rejects.toThrow(/That goal is not available/);
    await expect(sql("update public.tribes set season_goal_id = $2 where id = $1", [ada.tribe, await goalId(slug)])).rejects.toThrow(/That goal is not available/);
    await sql("update public.tribe_card_templates set status = 'signed_off' where slug = $1", [slug]);
    expect((await tribeRow(ada.tribe)).goal_slug).toBe(MENTOR);
  });

  it("refuses a goal from another community if something else sets it", async () => {
    await expect(sql("update public.tribes set season_goal_id = $2 where id = $1", [ada.tribe, await goalId("build-a-steady-client-pipeline")])).rejects.toThrow(/different community/);
  });

  it("refuses to change after the card is sent, and allows it again if the pastorate sends it back", async () => {
    await send(ada.tribe);
    await expectCode(save(ada.person, ada.tribe, { goal: REPUTATION }), "22023");
    await expectCode(sql("update public.tribes set season_goal_id = $2 where id = $1", [ada.tribe, await goalId(REPUTATION)]), "22023");
    expect((await tribeRow(ada.tribe)).goal_slug).toBe(MENTOR);
    expect((await view([ada.tribe])).get(ada.tribe)).toMatchObject({ state: "sent", can_lock: true });
    await sendBack(ada.tribe);
    await save(ada.person, ada.tribe, { goal: REPUTATION });
    expect((await tribeRow(ada.tribe)).goal_slug).toBe(REPUTATION);
    expect((await view([ada.tribe])).get(ada.tribe)).toMatchObject({ state: "changed", picks: 6 });
  });

  it("refuses a change once a member has joined, even though the card is still a draft", async () => {
    const x = await consulting("turn-one-off-projects-into-retainers", "Joined2");
    await unlock([x.tribe]);
    await join(x.tribe);
    await expect(save(x.person, x.tribe, { goal: "price-and-package-my-expertise" })).rejects.toThrow(/A member has joined this tribe/);
    expect((await tribeRow(x.tribe)).goal_slug).toBe("turn-one-off-projects-into-retainers");
    expect((await view([x.tribe])).get(x.tribe)).toMatchObject({ can_lock: true, why: "A member has joined their tribe" });
  });

  it("leaves a tribe that was never unlocked exactly as it is: the same save changes nothing about the goal", async () => {
    const x = await consulting("build-a-partner-network-or-small-team", "Never");
    const before = await tribeRow(x.tribe);
    await save(x.person, x.tribe, { goal: "price-and-package-my-expertise", god: "Our own words about prayer, written by the leader." });
    const after = await tribeRow(x.tribe);
    expect(after.goal_slug).toBe(before.goal_slug);
    expect(after.loving_god).toBe("Our own words about prayer, written by the leader.");
    // and a change made another way to a tribe with no record is not touched by the guard
    await sql("update public.tribes set season_goal_id = $2 where id = $1", [x.tribe, await goalId("price-and-package-my-expertise")]);
    const changed = await tribeRow(x.tribe);
    expect(changed.goal_slug).toBe("price-and-package-my-expertise");
    expect(changed.loving_god).toBe("Our own words about prayer, written by the leader.");
    expect(await count("select count(*)::int c from public.leader_goal_unlock where tribe_id = $1", [x.tribe])).toBe(0);
  });
});

describe("the community, when it is unlocked as well", () => {
  let b: { person: string; tribe: string };

  beforeAll(async () => {
    const t = await one("select t.id, t.leader_id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Bola'");
    b = { person: t.leader_id, tribe: t.id };
  });

  it("clears the goal when the community changes, as the card already does, and the name the appointment gave follows", async () => {
    expect((await tribeRow(b.tribe)).name).toBe("Bola’s Consulting tribe");
    await save(b.person, b.tribe, { community: "in-between-jobs" });
    const t = await tribeRow(b.tribe);
    expect(t.community_slug).toBe("in-between-jobs");
    expect(t.season_goal_id).toBeNull();
    expect(t.name).toBe("Bola’s In-between Jobs tribe");
    // The lines stay until a goal is picked: they are still the old card's
    expect(t.loving_god).toBe((await template("build-a-steady-client-pipeline")).loving_god);
  });

  it("refills the lines from the first goal picked in the new community", async () => {
    await save(b.person, b.tribe, { goal: "land-my-next-role" });
    const t = await tribeRow(b.tribe);
    const card = await template("land-my-next-role");
    expect(t.goal_slug).toBe("land-my-next-role");
    expect(lines(t)).toEqual(cardLines(card));
    expect(await one("select picks, chosen_goal_id from public.leader_goal_unlock where tribe_id = $1", [b.tribe])).toMatchObject({ picks: 1, chosen_goal_id: await goalId("land-my-next-role") });
  });

  it("changes the community and the goal in one save", async () => {
    await save(b.person, b.tribe, { community: "creative-economy", goal: "turn-my-craft-into-income" });
    const t = await tribeRow(b.tribe);
    expect(t).toMatchObject({ community_slug: "creative-economy", goal_slug: "turn-my-craft-into-income" });
    expect(lines(t)).toEqual(cardLines(await template("turn-my-craft-into-income")));
    expect(t.name).toBe("Bola’s Creative Economy tribe");
  });

  it("keeps a name the leader wrote", async () => {
    await save(b.person, b.tribe, { name: "The Craft Table" });
    await save(b.person, b.tribe, { community: "education", goal: "grow-as-an-educator" });
    expect((await tribeRow(b.tribe)).name).toBe("The Craft Table");
    expect((await tribeRow(b.tribe)).goal_slug).toBe("grow-as-an-educator");
  });

  it("refuses a sensitive goal for a leader who is not cleared", async () => {
    await expect(save(b.person, b.tribe, { community: "marriage-relationships", goal: "prepare-well-for-marriage" })).rejects.toThrow(/sensitive subject/);
    await expect(save(b.person, b.tribe, { community: "health-fitness-sports", goal: "reach-a-health-milestone" })).rejects.toThrow(/sensitive subject/);
    expect((await tribeRow(b.tribe)).goal_slug).toBe("grow-as-an-educator");
    expect((await tribeRow(b.tribe)).community_slug).toBe("education");
  });

  it("allows a sensitive goal for a leader the owner said a pastor cleared, and going back to the one the church started them on", async () => {
    const c = await one("select t.id, t.leader_id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Chi'");
    await save(c.leader_id, c.id, { goal: "prepare-well-for-marriage" });
    expect((await tribeRow(c.id)).goal_slug).toBe("prepare-well-for-marriage");
    await save(c.leader_id, c.id, { goal: "strengthen-our-marriage" });
    expect((await tribeRow(c.id)).goal_slug).toBe("strengthen-our-marriage");
  });

  it("refuses a sensitive goal that is not the one the church started them on, for a leader who is not cleared", async () => {
    const c = await one("select t.id, t.leader_id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Chi'");
    await sql("update public.leader_goal_unlock set care_cleared = false where tribe_id = $1", [c.id]);
    await expect(save(c.leader_id, c.id, { goal: "prepare-well-for-marriage" })).rejects.toThrow(/sensitive subject/);
    await save(c.leader_id, c.id, { goal: "strengthen-our-marriage" }); // the church's own choice is always allowed
    await sql("update public.leader_goal_unlock set care_cleared = true where tribe_id = $1", [c.id]);
  });

  it("refuses to change the community of a leader whose community was not unlocked", async () => {
    const t = await one("select t.id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Ada'");
    await expect(sql("update public.tribes set community_id = (select id from public.communities where slug = 'education'), season_goal_id = null where id = $1", [t.id])).rejects.toThrow(/community is fixed/);
  });
});

describe("locking it again", () => {
  let d: { person: string; tribe: string };

  it("puts the lock back exactly as it was and keeps what the leader picked", async () => {
    d = await consulting("write-proposals-and-contracts-that-protect-me", "Dee");
    await unlock([d.tribe]);
    await save(d.person, d.tribe, { goal: "set-boundaries-so-clients-do-not-run-my-week" });
    const r = await lock([d.tribe]);
    expect(r).toMatchObject({ locked: 1, skipped: 0 });
    const t = await tribeRow(d.tribe);
    expect(t.fixed.slice().sort()).toEqual(["community", "goal", "track"]);
    expect(t.goal_slug).toBe("set-boundaries-so-clients-do-not-run-my-week");
    expect((await view([d.tribe])).get(d.tribe)).toMatchObject({ state: "locked_again", can_lock: false, can_unlock: true, picks: 1 });
    expect(await one("select state, locked_again_by from public.leader_goal_unlock where tribe_id = $1", [d.tribe])).toMatchObject({ state: "locked_again", locked_again_by: o.owner.id });
  });

  it("stops further changes, and refuses the list", async () => {
    await save(d.person, d.tribe, { goal: "price-and-package-my-expertise" });
    expect((await tribeRow(d.tribe)).goal_slug).toBe("set-boundaries-so-clients-do-not-run-my-week");
    expect(await call(d.person, "tribe_goal_hints", [d.tribe])).toBeNull();
  });

  it("skips a tribe that was never unlocked or is already locked, and is written to the owner's record", async () => {
    const r = await lock([d.tribe, ZERO]);
    expect(r).toMatchObject({ locked: 0, skipped: 2 });
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.goal_locked'")).toBe(1);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.goal_locked' and actor_id is not null")).toBe(0);
  });

  it("can be unlocked again, keeps the goal the church started them on, and the pick count carries on", async () => {
    const first = (await one("select started_goal_id from public.leader_goal_unlock where tribe_id = $1", [d.tribe])).started_goal_id;
    await unlock([d.tribe]);
    const rec = await one("select * from public.leader_goal_unlock where tribe_id = $1", [d.tribe]);
    expect(rec).toMatchObject({ state: "open", picks: 1, locked_again_at: null, started_goal_id: first });
    expect(rec.fixed_before.slice().sort()).toEqual(["community", "goal", "track"]);
    await save(d.person, d.tribe, { goal: "price-and-package-my-expertise" });
    expect((await tribeRow(d.tribe)).goal_slug).toBe("price-and-package-my-expertise");
    expect((await one("select picks from public.leader_goal_unlock where tribe_id = $1", [d.tribe])).picks).toBe(2);
  });

  it("restores a lock that had the community open too, exactly", async () => {
    const e = await consulting("build-a-partner-network-or-small-team", "Eve");
    await unlock([e.tribe], true);
    expect((await tribeRow(e.tribe)).fixed).toEqual(["track"]);
    await lock([e.tribe]);
    expect((await tribeRow(e.tribe)).fixed.slice().sort()).toEqual(["community", "goal", "track"]);
  });

  it("locks several at once, skipping those that cannot be", async () => {
    const e = await consulting("land-my-first-three-clients", "Evan");
    await unlock([e.tribe]);
    const r = await lock([e.tribe, d.tribe, ZERO]);
    expect(r).toMatchObject({ locked: 2, skipped: 1 });
    await unlock([d.tribe]);
  });
});

describe("telling the pastor who reviews the card", () => {
  it("says the leader chose their own goal when they picked a different one, never naming anyone", async () => {
    const t = (await one("select t.id from public.tribes t join public.people p on p.id = t.leader_id where p.preferred_name = 'Dee'")).id as string;
    for (const who of [pastor, director, adminId]) {
      const note = await call(who, "tribe_goal_choice_note", [t]);
      expect(note.text).toBe("This leader chose their own goal. The church had started them on a different one.");
      expect(JSON.stringify(note)).not.toMatch(/owner|Dee|Surname|god mode/i);
    }
  });

  it("says nothing for a leader who has not chosen, one who went back to the started goal, or a tribe that was never unlocked", async () => {
    const quiet = await consulting("write-proposals-and-contracts-that-protect-me", "Quiet");
    await unlock([quiet.tribe]);
    expect(await call(pastor, "tribe_goal_choice_note", [quiet.tribe])).toBeNull();
    await save(quiet.person, quiet.tribe, { goal: "price-and-package-my-expertise" });
    expect(await call(pastor, "tribe_goal_choice_note", [quiet.tribe])).not.toBeNull();
    await save(quiet.person, quiet.tribe, { goal: "write-proposals-and-contracts-that-protect-me" });
    expect(await call(pastor, "tribe_goal_choice_note", [quiet.tribe])).toBeNull();
    const lead = await k.tribe(seasonId, { community: "consulting" });
    expect(await call(pastor, "tribe_goal_choice_note", [lead.tribe])).toBeNull();
  });

  it("is for the office only", async () => {
    const t = (await one("select t.id from public.tribes t limit 1")).id as string;
    const leader = await k.staff("RevLeader", "leader");
    await expectCode(db.asUser(leader.id, (q) => q("select public.tribe_goal_choice_note($1)", [t])), "42501");
  });
});

describe("the pastor's name on the welcome email, and his approval", () => {
  it("starts with the name and title exactly as the owner gave them, and not approved", async () => {
    const s = await o.call("god_welcome_settings_get", VERSION);
    expect(s).toMatchObject({ signature_name: "Wale Ekundayo", signature_title: "Pastor TCN Iganmu Center", approved: false, approved_version: null });
  });

  it("refuses names that are not plain words, or are too long or short", async () => {
    for (const [name, pastorTitle] of [["W", "Pastor"], ["Wale", "P"], ["x".repeat(61), "Pastor"], ["Wale", "x".repeat(81)], ["Wale <b>", "Pastor"], ["Wale", "Pastor https://evil.example"], ["wale@evil.example", "Pastor"], ["Wale\u0007", "Pastor"], ["", ""]]) {
      await expectCode(o.call("god_welcome_settings_save", name, pastorTitle), "22023");
    }
    expect((await o.call("god_welcome_settings_get", VERSION)).signature_name).toBe("Wale Ekundayo");
  });

  it("approves the wording for one version, and only that version", async () => {
    await o.call("god_welcome_approve", VERSION);
    expect(await o.call("god_welcome_settings_get", VERSION)).toMatchObject({ approved: true, approved_version: VERSION });
    expect((await o.call("god_welcome_settings_get", "test-v2")).approved).toBe(false);
    expect((await o.call("god_welcome_settings_get", null)).approved).toBe(false);
    await expectCode(o.call("god_welcome_approve", "Not A Version!"), "22023");
    await expectCode(o.call("god_welcome_approve", null), "22023");
  });

  it("takes the approval away when the name or title changes, and not when they are saved unchanged", async () => {
    expect((await o.call("god_welcome_settings_save", "Wale Ekundayo", "Pastor TCN Iganmu Center")).changed).toBe(false);
    expect((await o.call("god_welcome_settings_get", VERSION)).approved).toBe(true);
    expect((await o.call("god_welcome_settings_save", "Wale  Ekundayo ", "Pastor TCN Iganmu Centre")).changed).toBe(true);
    expect((await o.call("god_welcome_settings_get", VERSION)).approved).toBe(false);
    await o.call("god_welcome_settings_save", "Wale Ekundayo", "Pastor TCN Iganmu Center");
    expect(await o.call("god_welcome_settings_get", VERSION)).toMatchObject({ signature_name: "Wale Ekundayo", signature_title: "Pastor TCN Iganmu Center", approved: false });
  });

  it("can be withdrawn", async () => {
    await o.call("god_welcome_approve", VERSION);
    await o.call("god_welcome_withdraw");
    expect((await o.call("god_welcome_settings_get", VERSION)).approved).toBe(false);
  });
});

describe("the welcome email", () => {
  let w: { person: string; tribe: string };
  const mail = (tribe: string) => sql("select * from public.messages where template = 'leader_welcome' and tribe_id = $1 order by created_at, id", [tribe]);

  it("is not queued while the wording is not approved, and the unlock still happens", async () => {
    w = await consulting("turn-one-off-projects-into-retainers", "Wendy");
    const r = await unlock([w.tribe], false, true, VERSION);
    expect(r.unlocked).toBe(1);
    expect(r.mail[0]).toMatchObject({ queued: false, reason: "not_approved", tribe: w.tribe });
    expect(await mail(w.tribe)).toEqual([]);
    expect((await tribeRow(w.tribe)).fixed).not.toContain("goal");
  });

  it("is not queued for a version other than the approved one", async () => {
    await o.call("god_welcome_approve", VERSION);
    const r = await o.call("god_welcome_send", [w.tribe], "test-v2", false);
    expect(r.results[0]).toMatchObject({ queued: false, reason: "not_approved" });
    expect(await mail(w.tribe)).toEqual([]);
  });

  it("is queued by email only, to the leader, in the 'may choose' version, with the signature and nothing that names the owner", async () => {
    const r = await o.call("god_welcome_send", [w.tribe], VERSION, false);
    expect(r).toMatchObject({ queued: 1 });
    const rows = await mail(w.tribe);
    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m).toMatchObject({ person_id: w.person, force_channel: "email", status: "queued" });
    expect(m.params).toMatchObject({
      choose: true, community_free: false, goal: await title("turn-one-off-projects-into-retainers"), community: "Consulting",
      signature_name: "Wale Ekundayo", signature_title: "Pastor TCN Iganmu Center", version: VERSION,
    });
    expect(["required", "optional", "off"]).toContain(m.params.academy);
    expect(["required", "off"]).toContain(m.params.declaration);
    expect(JSON.stringify(m.params)).not.toMatch(/owner|administrator/i);
    expect(JSON.stringify(m.params).length).toBeLessThan(900);
    expect(m.dedupe_key).toBe(`leader-welcome:${w.tribe}:choose:1`);
  });

  it("goes once for each version, and again only when the owner says so", async () => {
    const again = await o.call("god_welcome_send", [w.tribe], VERSION, false);
    expect(again).toMatchObject({ queued: 0 });
    expect(again.results[0]).toMatchObject({ queued: false, reason: "already_sent", variant: "choose" });
    expect(await mail(w.tribe)).toHaveLength(1);
    const explicit = await o.call("god_welcome_send", [w.tribe], VERSION, true);
    expect(explicit).toMatchObject({ queued: 1 });
    const rows = await mail(w.tribe);
    expect(rows).toHaveLength(2);
    expect(rows[1].dedupe_key).toBe(`leader-welcome:${w.tribe}:choose:2`);
  });

  it("is a different email once the goal is locked again: 'chosen for you', and the 'choose' one is not blocked by it", async () => {
    await lock([w.tribe]);
    const r = await o.call("god_welcome_send", [w.tribe], VERSION, false);
    expect(r.results[0]).toMatchObject({ queued: true, variant: "fixed" });
    const rows = await mail(w.tribe);
    expect(rows[2].params).toMatchObject({ choose: false, community_free: false });
    const seen = (await view([w.tribe])).get(w.tribe)!;
    expect((seen.welcome as Row[]).map((x) => `${x.variant}${x.n}`).sort()).toEqual(["choose1", "choose2", "fixed1"]);
    await unlock([w.tribe]);
    const later = await o.call("god_welcome_send", [w.tribe], VERSION, false);
    expect(later.results[0]).toMatchObject({ queued: false, reason: "already_sent", variant: "choose" });
  });

  it("says the community may change too when it was unlocked", async () => {
    const x = await consulting("build-a-visible-expert-brand", "Xena");
    const r = await unlock([x.tribe], true, true, VERSION);
    expect(r.mail[0]).toMatchObject({ queued: true, variant: "choose" });
    expect((await mail(x.tribe))[0].params).toMatchObject({ choose: true, community_free: true });
  });

  it("is queued by the unlock itself when ticked and approved, for each leader unlocked, and for no one skipped", async () => {
    const a = await consulting("build-a-partner-network-or-small-team", "Una");
    const b = await consulting("set-boundaries-so-clients-do-not-run-my-week", "Uri");
    await send(b.tribe);
    const r = await unlock([a.tribe, b.tribe], false, true, VERSION);
    expect(r).toMatchObject({ unlocked: 1, skipped: 1 });
    expect(r.mail).toHaveLength(1);
    expect(await mail(a.tribe)).toHaveLength(1);
    expect(await mail(b.tribe)).toHaveLength(0);
  });

  it("replaces a still-queued short email from a bulk run, and leaves one that has already gone", async () => {
    const a = await consulting("write-proposals-and-contracts-that-protect-me", "Vee");
    const b = await consulting("price-and-package-my-expertise", "Val");
    for (const t of [a, b]) {
      await sql("select public.enqueue_message($1, 'placement_leader_appointed', $2::jsonb, $3, $4, null, 'normal', 'email')", [
        t.person, JSON.stringify({ goal: "x", community: "y", tribe: "z", fit: "Strong" }), t.tribe, `leader-appointed:${t.tribe}`,
      ]);
    }
    expect(await count("select count(*)::int c from public.messages where dedupe_key = any($1) and status = 'queued'", [[`leader-appointed:${a.tribe}`, `leader-appointed:${b.tribe}`]])).toBe(2);
    await sql("update public.messages set status = 'sent', sent_at = now() where dedupe_key = $1", [`leader-appointed:${b.tribe}`]);
    await unlock([a.tribe, b.tribe], false, true, VERSION);
    expect(await one("select status, error from public.messages where dedupe_key = $1", [`leader-appointed:${a.tribe}`])).toMatchObject({ status: "skipped", error: "replaced by the welcome email" });
    expect((await one("select status from public.messages where dedupe_key = $1", [`leader-appointed:${b.tribe}`])).status).toBe("sent");
    expect(await mail(a.tribe)).toHaveLength(1);
    expect(await mail(b.tribe)).toHaveLength(1);
  });

  it("sends nothing for a tribe the owner did not appoint, or one that is not there", async () => {
    const lead = await k.tribe(seasonId, { community: "consulting" });
    const r = await o.call("god_welcome_send", [lead.tribe, ZERO], VERSION, false);
    expect(r.queued).toBe(0);
    expect((r.results as Row[]).map((x) => x.reason)).toEqual(["not_yours", "not_yours"]);
    expect(await mail(lead.tribe)).toEqual([]);
  });

  it("is not queued when the approval is withdrawn, and the unlock still goes ahead", async () => {
    const y = await consulting("land-my-first-three-clients", "Yani");
    await o.call("god_welcome_withdraw");
    const r = await unlock([y.tribe], false, true, VERSION);
    expect(r.unlocked).toBe(1);
    expect(r.mail[0]).toMatchObject({ queued: false, reason: "not_approved" });
    expect(await mail(y.tribe)).toEqual([]);
    await o.call("god_welcome_approve", VERSION);
  });

  it("records what it queued in the owner's private record, without the leader's name or address", async () => {
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.welcome_queued'")).toBeGreaterThan(3);
    const rows = await sql("select detail from public.god_log where action = 'leader.welcome_queued'");
    expect(JSON.stringify(rows)).not.toMatch(/Surname|@/);
    expect(await count("select count(*)::int c from public.event_log where action = 'leader.welcome_queued' and actor_id is not null")).toBe(0);
  });

  it("writes the approval, the withdrawal and the signature to the owner's private record too", async () => {
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.welcome_approved'")).toBeGreaterThanOrEqual(2);
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.welcome_withdrawn'")).toBeGreaterThanOrEqual(2);
    expect(await count("select count(*)::int c from public.god_log where action = 'leader.welcome_signature_saved'")).toBeGreaterThanOrEqual(1);
  });
});

describe("a bulk run", () => {
  it("unlocks everyone the run appointed, welcomes them in one message that replaces the short one, and does nothing the second time", async () => {
    await o.call("god_welcome_approve", VERSION);
    const approved = await candidate("Approved");
    await db.grant(approved.id, "leader");
    await sql(
      "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'approved_leader', 'review', $2::jsonb, 'test', now(), now())",
      [approved.id, JSON.stringify(answers(undefined, { calling: calling({ community: "consulting", goal: "build-a-steady-client-pipeline", goalRelation: "achieved" }) }))],
    );
    const sheet1 = await candidate("Sheeted1");
    const sheet2 = await candidate("Sheeted2");
    const plan = await o.call(
      "placement_leaders_plan",
      JSON.stringify([{ email: sheet1.email, ...PIPE }, { email: sheet2.email, ...PIPE, goal: "land-my-first-three-clients" }]),
      true,
    );
    expect(plan.paired).toBeGreaterThanOrEqual(2);
    // Nobody appointed yet, and a run that is not there
    await expect(o.call("god_unlock_goal_run", plan.run, false, false, null)).rejects.toThrow(/has not appointed anyone yet/);
    await expectCode(o.call("god_unlock_goal_run", ZERO, false, false, null), "P0002");
    await o.call("placement_leaders_approve", plan.run, plan.paired);
    const applied = await o.call("placement_leaders_apply", plan.run);
    expect(applied.done).toBe(plan.paired);
    const items = await sql("select person_id, source, tribe_id from public.placement_leader_items where run_id = $1 and status = 'applied'", [plan.run]);
    const tribes = items.map((i) => i.tribe_id as string);
    expect(items.length).toBe(applied.done);
    expect(await count("select count(*)::int c from public.messages where template = 'placement_leader_appointed' and status = 'queued' and tribe_id = any($1)", [tribes])).toBe(items.length);
    // one of the short emails has already gone
    await sql("update public.messages set status = 'sent', sent_at = now() where dedupe_key = $1", [`leader-appointed:${tribes[0]}`]);

    const r = await o.call("god_unlock_goal_run", plan.run, true, true, VERSION);
    expect(r).toMatchObject({ unlocked: items.length, skipped: 0 });
    expect(await count("select count(*)::int c from public.leader_goal_unlock where tribe_id = any($1) and state = 'open' and community_too", [tribes])).toBe(items.length);
    for (const t of tribes) expect((await tribeRow(t)).fixed).toEqual(["track"]);
    // an approved leader and a sheet leader are both covered, and a bulk-approved leader is never cleared for sensitive subjects
    expect(items.some((i) => i.source === "sheet")).toBe(true);
    for (const i of items.filter((x) => x.source === "approved")) {
      expect(await one("select care_cleared, appointment_id from public.leader_goal_unlock where tribe_id = $1", [i.tribe_id])).toEqual({ care_cleared: false, appointment_id: null });
    }
    for (const i of items.filter((x) => x.source === "sheet")) {
      expect((await one("select appointment_id from public.leader_goal_unlock where tribe_id = $1", [i.tribe_id])).appointment_id).not.toBeNull();
    }
    // the welcome replaced the short email where it had not gone, and left the one that had
    expect(await count("select count(*)::int c from public.messages where template = 'placement_leader_appointed' and status = 'skipped' and tribe_id = any($1)", [tribes])).toBe(items.length - 1);
    expect((await one("select status from public.messages where dedupe_key = $1", [`leader-appointed:${tribes[0]}`])).status).toBe("sent");
    expect(await count("select count(*)::int c from public.messages where template = 'leader_welcome' and tribe_id = any($1)", [tribes])).toBe(items.length);
    // pressing it again changes nothing
    const again = await o.call("god_unlock_goal_run", plan.run, true, true, VERSION);
    expect(again.unlocked).toBe(0);
    expect(await count("select count(*)::int c from public.messages where template = 'leader_welcome' and tribe_id = any($1)", [tribes])).toBe(items.length);
    // and each of them can pick from the list
    const first = items.find((i) => i.source === "sheet")!;
    const hints = await call(first.person_id, "tribe_goal_hints", [first.tribe_id]);
    expect(hints.community_too).toBe(true);
    expect(hints.goals.length).toBeGreaterThan(20);
  });
});

describe("the normal process", () => {
  it("is untouched for a leader the owner never unlocked: the old rules still apply to the card", async () => {
    const x = await consulting("land-my-first-three-clients", "Plain3");
    await save(x.person, x.tribe, { goal: "price-and-package-my-expertise", community: "education", track: "stewards" });
    const t = await tribeRow(x.tribe);
    expect(t.goal_slug).toBe("land-my-first-three-clients");
    expect(t.community_slug).toBe("consulting");
    expect(t.fixed.slice().sort()).toEqual(["community", "goal", "track"]);
    expect(await call(x.person, "tribe_goal_hints", [x.tribe])).toBeNull();
  });

  it("lets a leader who chose their own goal finish the card, send it, and the pastor open it as for any other", async () => {
    const before = await one("select academy_mode, declaration_mode from public.leader_pipeline_settings");
    await sql("update public.leader_pipeline_settings set academy_mode = 'off', declaration_mode = 'off'");
    try {
      const x = await consulting("build-a-partner-network-or-small-team", "Finish");
      await unlock([x.tribe]);
      await save(x.person, x.tribe, {
        goal: "price-and-package-my-expertise", story: "I price my own work now and I want to help others do the same, with honesty.",
        meeting_day: 3, meeting_time: "20:00", mode: "in_person", zone: "mainland",
      });
      await db.asUser(x.person, (q) => q("select public.submit_tribe_card($1)", [x.tribe]));
      expect((await tribeRow(x.tribe)).status).toBe("submitted");
      expect((await tribeRow(x.tribe)).goal_slug).toBe("price-and-package-my-expertise");
      expect(await call(pastor, "review_tribe", [x.tribe])).toBeTruthy();
      expect(await call(pastor, "tribe_goal_choice_note", [x.tribe])).not.toBeNull();
      expect((await view([x.tribe])).get(x.tribe)).toMatchObject({ state: "sent", can_lock: true });
      await expectCode(save(x.person, x.tribe, { goal: "build-a-visible-expert-brand" }), "22023");
    } finally {
      await sql("update public.leader_pipeline_settings set academy_mode = $1, declaration_mode = $2", [before.academy_mode, before.declaration_mode]);
    }
  });
});
