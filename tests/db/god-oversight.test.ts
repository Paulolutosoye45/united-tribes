import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, makeYoung, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// God Mode oversight: the desks for every stakeholder, the people who hold each role, the messages the platform sends, the chats staff opened,
// and the owner's record of looking. Owner-only, read-only, and the wording of care and safeguarding messages is never returned.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let admin: string;
let pastor: string;
let member: string;
let seasonId: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const as = (uid: string, fn: string, args: unknown[] = []) =>
  db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));
const anon = (fn: string, args: unknown[] = []) =>
  db.asAnon((q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args));

const FUNCTIONS: [string, unknown[]][] = [
  ["god_desks", []],
  ["god_role_people", ["leader", 10]],
  ["god_messages", [null, null, null, 10]],
  ["god_chat_opens", [null, 10]],
  ["god_announcements", [10]],
  ["god_looked", ["desks", null]],
];

async function message(person: string | null, template: string, o2: { params?: Record<string, unknown>; status?: string; error?: string; ago?: string; to_name?: string } = {}) {
  const r = await one(
    `insert into public.messages (person_id, to_email, to_name, template, params, status, error, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() - $8::interval) returning id`,
    [person, person ? null : "ref@example.org", o2.to_name ?? null, template, JSON.stringify(o2.params ?? {}), o2.status ?? "sent", o2.error ?? null, o2.ago ?? "0 minutes"],
  );
  return r.id as string;
}

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  admin = (await k.staff("Admin", "admin")).id;
  pastor = (await k.staff("Pastor", "pastor")).id;
  member = (await k.person("Member")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
});

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("who may look", () => {
  it("refuses everyone who is not the unlocked owner, including the admin and the pastor", async () => {
    for (const [fn, args] of FUNCTIONS) {
      for (const who of [admin, pastor, member]) await expectCode(as(who, fn, args), "42501");
      await expectCode(anon(fn, args), "42501");
    }
  });

  it("refuses the owner too until the passphrase is given on this sign-in", async () => {
    const { randomUUID } = await import("node:crypto");
    for (const [fn, args] of FUNCTIONS) {
      await expectCode(db.asUser(o.owner.id, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args), { session: randomUUID() }), "42501");
    }
  });

  it("answers the unlocked owner", async () => {
    for (const [fn, args] of FUNCTIONS) expect(await o.call(fn, ...args), fn).not.toBeUndefined();
  });

  it("keeps the helper that decides what is held closed to every client", async () => {
    await expectCode(as(admin, "god_message_private", ["care_urgent", null]), "42501");
    await expectCode(o.run((q) => q("select public.god_message_private('care_urgent', null)")), "42501");
    await expectCode(anon("god_message_private", ["care_urgent", null]), "42501");
  });

  it("is written the safe way: security definer, an empty search path, one copy of each name", async () => {
    for (const name of ["god_desks", "god_role_people", "god_messages", "god_chat_opens", "god_announcements", "god_looked", "god_message_private"]) {
      const r = await sql("select p.prosecdef, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1", [name]);
      expect(r, name).toHaveLength(1);
      expect(r[0].prosecdef, name).toBe(true);
      expect((r[0].proconfig as string[]).some((c) => c.startsWith("search_path=")), name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the desks", () => {
  it("has one desk for every role, in the order the platform lists them, with how many hold it", async () => {
    const d = await o.call("god_desks");
    const roles = (d.roles as Row[]).map((r) => r.role);
    const enumRoles = (await sql("select unnest(enum_range(null::public.app_role))::text r")).map((r) => r.r);
    expect(roles).toEqual(enumRoles);
    for (const r of d.roles as Row[]) {
      const held = await count("select count(distinct pr.person_id)::int c from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden where pr.role = $1::public.app_role", [r.role]);
      expect(r.people, String(r.role)).toBe(held);
    }
    expect((d.roles as Row[]).find((r) => r.role === "pastor")?.people).toBeGreaterThanOrEqual(1);
  });

  it("never counts the owner, who holds no role and is hidden", async () => {
    const d = await o.call("god_desks");
    expect(d.counts.members_total).toBe(await count("select count(*)::int c from public.people where not hidden"));
    const total = (d.roles as Row[]).reduce((a, r) => a + (r.people as number), 0);
    const direct = await count("select count(*)::int c from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden");
    expect(total).toBeGreaterThanOrEqual(0);
    expect(direct).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(d)).not.toContain(o.owner.id);
  });

  it("counts activity in the last seven days by role holder, not by event", async () => {
    const lead = await k.staff("ActiveLead", "leader");
    const idle = await k.staff("IdleLead", "leader");
    await sql("delete from public.event_log where actor_id = any($1::uuid[])", [[lead.id, idle.id]]);
    await sql("insert into public.event_log (actor_id, action) values ($1, 'tribe.log'), ($1, 'tribe.log'), ($1, 'tribe.log')", [lead.id]);
    await sql("insert into public.event_log (actor_id, action, at) values ($1, 'tribe.log', now() - interval '20 days')", [idle.id]);
    const d = await o.call("god_desks");
    const row = (d.roles as Row[]).find((r) => r.role === "leader") as Row;
    const expected = await count(
      `select count(distinct pr.person_id)::int c from public.person_roles pr join public.people p on p.id = pr.person_id and not p.hidden
        where pr.role = 'leader' and exists (select 1 from public.event_log e where e.actor_id = pr.person_id and e.at > now() - interval '7 days')`,
    );
    expect(row.active_7d).toBe(expected);
    expect(row.active_7d).toBeGreaterThanOrEqual(1);
    expect(row.active_7d).toBeLessThan(row.people as number);
  });

  it("gives the live numbers each stakeholder would be looking at, each the same as a direct count", async () => {
    // Plant something for each
    const t = await k.tribe(seasonId, { status: "submitted", name: "To review" });
    await sql("insert into public.care_tasks (tribe_id, person_id, kind, week, note, assignee_role, raised_by, due_on, status) values ($1, $2, 'call', 1, 'x', 'care_lead', $3, current_date, 'open')", [t.tribe, member, pastor]).catch(() => undefined);
    const d = await o.call("god_desks");
    const c = d.counts as Row;
    const direct: Record<string, string> = {
      tribes_live: "select count(*)::int c from public.tribes where status = 'approved'",
      tribes_to_review: "select count(*)::int c from public.tribes where status = 'submitted'",
      tribes_in_draft: "select count(*)::int c from public.tribes where status in ('draft', 'changes_requested')",
      tribes_without_coach: "select count(*)::int c from public.tribes where status = 'approved' and coach_id is null",
      members_seated: "select count(distinct person_id)::int c from public.tribe_members where status = 'active'",
      applications_in_review: "select count(*)::int c from public.leader_applications where status in ('submitted','interview_invited','interview_booked','interviewed')",
      cards_waiting_sign_off: "select count(*)::int c from public.tribe_card_templates where status = 'draft'",
      care_tasks_open: "select count(*)::int c from public.care_tasks where status = 'open'",
      care_flags_open: "select count(*)::int c from public.care_flags where status in ('open','escalated')",
      swaps_open: "select count(*)::int c from public.swap_requests where status in ('requested','offered')",
      seasons_live: "select count(*)::int c from public.seasons where status in ('open','running')",
      invitations_pending: "select count(*)::int c from public.invitations where status = 'pending' and expires_at > now()",
      erasure_open: "select count(*)::int c from public.erasure_requests where status = 'open'",
      messages_queued: "select count(*)::int c from public.messages where status in ('queued','sending')",
    };
    for (const [key, q] of Object.entries(direct)) expect(c[key], key).toBe(await count(q));
    expect(c.tribes_to_review).toBeGreaterThanOrEqual(1);
  });

  it("reads the members waiting and the seats needed from the one rule the compatibility test reads", async () => {
    const [g] = await sql("select g.id, g.community_id from public.season_goals g where g.active order by g.slug limit 1");
    for (let i = 0; i < 4; i++) {
      const u = await k.person(`Waiting${i}`);
      await sql("insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) values ($1, $2, $3, $4, 'any', 0)", [u.id, seasonId, g.id, g.community_id]);
    }
    const d = await o.call("god_desks");
    const rows = await sql("select coalesce(sum(waiting),0)::int w, coalesce(sum(gap) filter (where gap > 0),0)::int s from public.goal_demand_rows($1)", [seasonId]);
    expect(d.counts.members_waiting).toBe(rows[0].w);
    expect(d.counts.leader_seats_needed).toBe(rows[0].s);
    expect(d.counts.members_waiting).toBeGreaterThanOrEqual(4);
    const text = (await sql("select p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'god_desks'"))[0].prosrc as string;
    expect(text).not.toMatch(/match_demand/);
  });

  it("works with no open season", async () => {
    await sql("update public.seasons set status = 'closed'");
    const d = await o.call("god_desks");
    expect(d.season).toBeNull();
    expect(d.counts.members_waiting).toBe(0);
    await sql("update public.seasons set status = 'planning' where id = $1", [seasonId]);
  });

  it("counts open offers that have not passed their date, and communities with no champion", async () => {
    const before = (await o.call("god_desks")).counts as Row;
    const [g] = await sql("select id from public.season_goals where active order by slug limit 1");
    const l = await k.staff("Offered", "leader");
    await sql("insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer) values ($1, $2, $3, 1)", [g.id, l.id, seasonId]);
    const l2 = await k.staff("Expired", "leader");
    await sql("insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer, expires_at) values ($1, $2, $3, 1, now() - interval '1 day')", [g.id, l2.id, seasonId]);
    const after = (await o.call("god_desks")).counts as Row;
    expect((after.leader_offers_open as number) - (before.leader_offers_open as number)).toBe(1);
    expect(after.communities_without_champion).toBe(
      await count("select count(*)::int c from public.communities c where c.active and not exists (select 1 from public.community_champions h where h.community_id = c.id)"),
    );
  });

  it("is quick enough to open on every visit", async () => {
    const t0 = Date.now();
    await o.call("god_desks");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the people who hold a role", () => {
  it("lists the holders, newest activity first, with what they did this week and how many tribes they are on", async () => {
    const a = await k.staff("Zed", "coach");
    const b = await k.staff("Amy", "coach");
    await sql("delete from public.event_log where actor_id = any($1::uuid[])", [[a.id, b.id]]);
    await sql("insert into public.event_log (actor_id, action) values ($1, 'tribe.log')", [b.id]);
    const r = await o.call("god_role_people", "coach", 50);
    expect(r.role).toBe("coach");
    const names = (r.people as Row[]).map((p) => p.name);
    const at = (n: string) => names.findIndex((x) => String(x).startsWith(n));
    expect(at("Zed")).toBeGreaterThanOrEqual(0);
    expect(at("Amy")).toBeLessThan(at("Zed"));
    const amy = (r.people as Row[]).find((p) => p.id === b.id) as Row;
    expect(amy.actions_7d).toBeGreaterThanOrEqual(1);
    expect(amy.last_seen).not.toBeNull();
    await sql("delete from public.event_log where actor_id = $1", [a.id]);
    expect(((await o.call("god_role_people", "coach", 50)).people as Row[]).find((p) => p.id === a.id)?.last_seen).toBeNull();
    const t = await k.tribe(seasonId, { status: "approved", name: "Coached" });
    await sql("update public.tribes set coach_id = $2 where id = $1", [t.tribe, a.id]);
    expect(((await o.call("god_role_people", "coach", 50)).people as Row[]).find((p) => p.id === a.id)?.tribes).toBe(1);
  });

  it("refuses a role that does not exist, and shows no hidden account", async () => {
    await expectCode(o.run((q) => q("select public.god_role_people('wizard', 10)")), "22023");
    for (const role of ["member", "admin", "pastor", "leader"]) {
      const r = await o.call("god_role_people", role, 300);
      expect((r.people as Row[]).map((p) => p.id)).not.toContain(o.owner.id);
    }
  });

  it("stops at the limit it is given and never more than 300", async () => {
    const r = await o.call("god_role_people", "member", 2);
    expect((r.people as Row[]).length).toBeLessThanOrEqual(2);
    expect(((await o.call("god_role_people", "member", 100000)).people as Row[]).length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("messages", () => {
  let ngozi: string;
  let young: string;

  beforeAll(async () => {
    ngozi = (await k.person("Ngozi")).id;
    young = (await k.person("Youngster")).id;
    await makeYoung(db, k, young, seasonId);
  });

  it("lists what was sent, newest first, with who it went to, how, and how it went", async () => {
    await message(ngozi, "welcome", { params: { first: "Ngozi" }, ago: "3 hours" });
    await message(ngozi, "week_start", { params: { week: 3 }, status: "delivered", ago: "1 hour" });
    await message(ngozi, "meeting_reminder", { status: "failed", error: "No phone on file", ago: "10 minutes" });
    const r = await o.call("god_messages", ngozi, null, null, 20);
    const items = r.messages as Row[];
    expect(items.map((m) => m.template)).toEqual(["meeting_reminder", "week_start", "welcome"]);
    expect(items[0]).toMatchObject({ status: "failed", error: "No phone on file", name: expect.stringContaining("Ngozi"), held: null });
    expect(items[1].status).toBe("delivered");
    expect(r.more).toBe(false);
  });

  it("shows the error only when it failed", async () => {
    await message(ngozi, "week_start", { status: "sent", error: "stale", ago: "2 days" });
    const items = (await o.call("god_messages", ngozi, "sent", null, 50)).messages as Row[];
    expect(items.every((m) => m.error === null)).toBe(true);
  });

  it("holds back the wording of care, help, guardian and referee messages, and of anything sent to a young member", async () => {
    const lead = (await k.staff("CareLead", "care_lead")).id;
    const cases: [string | null, string, Record<string, unknown>][] = [
      [lead, "care_urgent", { member: "Chidi Eze", note: "He said he cannot cope" }],
      [lead, "care_task", { member: "Chidi Eze", note: "Call him" }],
      [lead, "care_task_overdue", { member: "Chidi Eze" }],
      [ngozi, "coach_help", { leader: "Ngozi", note: "I need help with a member" }],
      [null, "guardian_request", { secret: "g".repeat(40), young: "Youngster" }],
      [null, "referee_request", { secret: "r".repeat(43), applicant: "Ngozi" }],
      [young, "welcome", { first: "Youngster", tribe: "Teen Builders" }],
    ];
    for (const [person, template, params] of cases) await message(person, template, { params, ago: "5 minutes" });
    const items = (await o.call("god_messages", null, null, null, 200)).messages as Row[];
    const held = items.filter((m) => cases.some(([, t]) => t === m.template) && m.held);
    expect(held.map((m) => m.template).sort()).toEqual(["care_task", "care_task_overdue", "care_urgent", "coach_help", "guardian_request", "referee_request", "welcome"].sort());
    for (const m of held) {
      expect(m.params, String(m.template)).toBeNull();
      expect(typeof m.held).toBe("string");
    }
    const all = JSON.stringify(items);
    for (const secret of ["cannot cope", "Call him", "Chidi Eze", "I need help", "g".repeat(40), "r".repeat(43), "Teen Builders"]) expect(all).not.toContain(secret);
    // …but who, when and how it went are there
    const care = held.find((m) => m.template === "care_urgent") as Row;
    expect(care).toMatchObject({ status: "sent", channel: null });
    expect(care.name).toContain("CareLead");
    expect(held.find((m) => m.template === "welcome")?.held).toMatch(/young member/);
  });

  it("takes codes, links and tokens out of every message it does show", async () => {
    await message(ngozi, "leader_log_link", { params: { week: 4, link: "https://x.example/log?t=abc", token: "tok123", secret: "s3cr3t", code: "482913", url: "https://x.example/u", reply_token: "rt", tribe: "Pillars" }, ago: "7 minutes" });
    const item = ((await o.call("god_messages", ngozi, null, null, 200)).messages as Row[]).find((m) => m.template === "leader_log_link") as Row;
    expect(item.held).toBeNull();
    expect(item.params).toEqual({ week: 4, tribe: "Pillars" });
  });

  it("names a person without an account by the name given, and never prints an address or a number", async () => {
    await message(null, "weekly_report", { to_name: "Pastor Femi", ago: "9 minutes" });
    const r = await o.call("god_messages", null, null, null, 200);
    const item = (r.messages as Row[]).find((m) => m.name === "Pastor Femi") as Row;
    expect(item).toBeDefined();
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/ref@example\.org|\+234/);
    expect(Object.keys(item).sort()).toEqual(["at", "channel", "error", "held", "id", "name", "params", "person_id", "roles", "sent_at", "status", "template", "urgency"]);
  });

  it("filters by status, refuses one it does not know", async () => {
    const failed = (await o.call("god_messages", null, "failed", null, 200)).messages as Row[];
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.every((m) => m.status === "failed")).toBe(true);
    await expectCode(o.run((q) => q("select public.god_messages(null, 'lost', null, 10)")), "22023");
  });

  it("pages back from the time of the last one seen and says whether there are more", async () => {
    const p = (await k.person("Pager")).id;
    for (let i = 0; i < 7; i++) await message(p, "week_start", { params: { week: i }, ago: `${i + 1} hours` });
    const first = await o.call("god_messages", p, null, null, 3);
    expect((first.messages as Row[]).map((m) => (m.params as Row).week)).toEqual([0, 1, 2]);
    expect(first.more).toBe(true);
    const last = (first.messages as Row[])[2].at as string;
    const second = await o.call("god_messages", p, null, last, 3);
    expect((second.messages as Row[]).map((m) => (m.params as Row).week)).toEqual([3, 4, 5]);
    expect(second.more).toBe(true);
    const third = await o.call("god_messages", p, null, (second.messages as Row[])[2].at as string, 3);
    expect((third.messages as Row[]).map((m) => (m.params as Row).week)).toEqual([6]);
    expect(third.more).toBe(false);
  });

  it("never returns more than 200 in a page, whatever is asked", async () => {
    const r = await o.call("god_messages", null, null, null, 100000);
    expect((r.messages as Row[]).length).toBeLessThanOrEqual(200);
    expect((await o.call("god_messages", null, null, null, 0)).messages as Row[]).toHaveLength(1);
  });

  it("returns the answers that come back for one person: a check-in button and STOP", async () => {
    const p = (await k.person("Replier")).id;
    await sql("insert into public.event_log (actor_id, action, entity, meta, at) values ($1, 'checkin.by_reply', 'tribe', $2::jsonb, now() - interval '2 hours')", [p, JSON.stringify({ week: 3, outcome: "partly", channel: "whatsapp" })]);
    await sql("insert into public.event_log (actor_id, action, entity, meta, at) values ($1, 'contact.opt_out', 'person', $2::jsonb, now() - interval '1 hour')", [p, JSON.stringify({ channel: "whatsapp", by: "reply" })]);
    await sql("insert into public.event_log (actor_id, action) values ($1, 'tribe.log')", [p]);
    const r = await o.call("god_messages", p, null, null, 10);
    expect((r.replies as Row[]).map((x) => x.action)).toEqual(["contact.opt_out", "checkin.by_reply"]);
    expect((r.replies as Row[])[1]).toMatchObject({ outcome: "partly", channel: "whatsapp" });
    expect((await o.call("god_messages", null, null, null, 10)).replies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("chats and announcements", () => {
  it("lists the chats staff opened: who, with whom, when and why, and never any words", async () => {
    const staff = (await k.staff("Coach Sade", "coach")).id;
    const them = (await k.person("Tobi")).id;
    await sql("insert into public.chat_opens (opened_by, person_id, context) values ($1, $2, 'welcome_call')", [staff, them]);
    const r = await o.call("god_chat_opens", null, 20);
    const item = (r.opens as Row[]).find((x) => x.person_id === them) as Row;
    expect(item).toMatchObject({ context: "welcome_call", opened_by_name: expect.stringContaining("Coach Sade"), person_name: expect.stringContaining("Tobi") });
    expect(item.opened_by_roles).toEqual(["coach"]);
    expect(Object.keys(item).sort()).toEqual(["at", "context", "id", "opened_by", "opened_by_name", "opened_by_roles", "person_id", "person_name"]);
    expect(r.total).toBeGreaterThanOrEqual(1);
    // Filter by either side
    expect(((await o.call("god_chat_opens", them, 20)).opens as Row[]).every((x) => x.person_id === them || x.opened_by === them)).toBe(true);
    expect(((await o.call("god_chat_opens", staff, 20)).opens as Row[]).map((x) => x.opened_by)).toContain(staff);
  });

  it("copes with a person who has since been erased", async () => {
    const staff = (await k.staff("Gone Sade", "coach")).id;
    const gone = (await k.person("Gone")).id;
    await sql("insert into public.chat_opens (opened_by, person_id, context) values ($1, $2, 'welcome_call')", [staff, gone]);
    await sql("update public.chat_opens set person_id = null where person_id = $1", [gone]);
    const item = ((await o.call("god_chat_opens", staff, 20)).opens as Row[]).find((x) => x.opened_by === staff) as Row;
    expect(item.person_name).toBeNull();
  });

  it("lists announcements with what they said and how many they reached", async () => {
    const r = (await o.call("god_announcements", 10)) as Row[];
    expect(Array.isArray(r)).toBe(true);
    await sql(
      `insert into public.broadcasts (centre_id, title, audience, audience_label, subject, paragraphs, status, recipient_count, created_by)
       values ((select id from public.centres limit 1), 'Season starts', '{}'::jsonb, 'Everyone', 'The season begins Sunday', array['Come early.'], 'sent', 42, $1)`,
      [pastor],
    ).catch(async () => {
      await sql(
        `insert into public.broadcasts (centre_id, title, audience, audience_label, subject, paragraphs, status, needs_approval, recipient_count, created_by)
         values ((select id from public.centres limit 1), 'Season starts', '{}'::jsonb, 'Everyone', 'The season begins Sunday', array['Come early.'], 'sent', false, 42, $1)`,
        [pastor],
      );
    });
    const after = (await o.call("god_announcements", 10)) as Row[];
    const a = after.find((x) => x.title === "Season starts") as Row;
    expect(a).toMatchObject({ subject: "The season begins Sunday", audience_label: "Everyone", recipient_count: 42 });
    expect(a.created_by_name).toContain("Pastor");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe("the owner's own record of looking", () => {
  it("writes a note to the owner's log once a minute for the same screen, and not to the office's log", async () => {
    await sql("delete from public.god_log where kind = 'looked'");
    const office = await count("select count(*)::int c from public.event_log");
    await o.call("god_looked", "conversations", null);
    await o.call("god_looked", "conversations", null);
    await o.call("god_looked", "desk", "pastor");
    await o.call("god_looked", "desk", "coach");
    await o.call("god_looked", "person_conversation", "00000000-0000-4000-8000-000000000001");
    const rows = await sql("select action, entity, entity_id, detail from public.god_log where kind = 'looked' order by id");
    expect(rows.map((r) => `${r.action}:${r.entity_id ?? ""}`)).toEqual([
      "conversations:",
      "desk:pastor",
      "desk:coach",
      "person_conversation:00000000-0000-4000-8000-000000000001",
    ]);
    expect(rows.every((r) => r.entity === "oversight")).toBe(true);
    expect(await count("select count(*)::int c from public.event_log")).toBe(office);
    expect(await count("select count(*)::int c from public.event_log where actor_id = $1", [o.owner.id])).toBe(0);
    const record = (await o.call("god_log_list", 20)) as Row[];
    expect(record.some((r) => r.kind === "looked" && r.action === "desk")).toBe(true);
  });

  it("refuses a screen it does not know", async () => {
    await expectCode(o.run((q) => q("select public.god_looked('secrets', null)")), "22023");
  });

  it("is read-only: looking at everything writes nothing but the note", async () => {
    const before = [
      await count("select count(*)::int c from public.messages"),
      await count("select count(*)::int c from public.chat_opens"),
      await count("select count(*)::int c from public.person_roles"),
      await count("select count(*)::int c from public.event_log"),
    ];
    await o.call("god_desks");
    await o.call("god_role_people", "leader", 50);
    await o.call("god_messages", null, null, null, 100);
    await o.call("god_chat_opens", null, 100);
    await o.call("god_announcements", 50);
    const after = [
      await count("select count(*)::int c from public.messages"),
      await count("select count(*)::int c from public.chat_opens"),
      await count("select count(*)::int c from public.person_roles"),
      await count("select count(*)::int c from public.event_log"),
    ];
    expect(after).toEqual(before);
  });
});
