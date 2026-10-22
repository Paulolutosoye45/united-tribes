import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Row, type TestDb } from "./helpers";
import { kit, type Kit, type Person } from "./builders";
import { uniqueEmail } from "./referee-kit";

// "A new leader application was sent" (admins and directors), and the fix that keeps the hidden owner's name out of the role-change email.
//
//   - the moment an application's status becomes "submitted", every admin and director of that centre is told, except the applicant
//   - a person who holds both roles is told once; pastors and coaches are not told by this notice
//   - each button goes to a page that person can open: the review list for anyone who can review, the figures page for an admin who cannot
//   - Off writes nothing, Rehearsal only writes to the log, On queues email
//   - nothing the applicant wrote is in what is queued; a young applicant or the hidden owner is never named
//   - a notice that cannot be queued never stops the application from being sent
//   - when the owner gives someone a role in God Mode, nobody is told the owner's name, and the owner is never written about

let db: TestDb;
let k: Kit;
let mary: Person; // admin and pastor
let pastor: Person;
let director: Person;
let admin: Person; // admin only
let coach: Person;
let second: string;

const PHRASE = "river-lantern-mango-cobalt";
const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const mode = (group: string | "all", m: "off" | "rehearsal" | "on") =>
  sql("update public.notice_settings set mode = $2 where $1 = 'all' or group_key = $1", [group, m]);
const items = (kind: string) =>
  sql(`select i.*, p.preferred_name as who from public.notice_items i join public.people p on p.id = i.person_id where i.kind = $1 order by i.id`, [kind]);
const mails = (kind: string) =>
  sql(`select m.*, p.preferred_name as who from public.messages m left join public.people p on p.id = m.person_id
        where m.params ? 'notice_group' and m.template = $1 order by m.created_at, m.id`, [kind]);
const whoGot = async (kind: string) => (await items(kind)).map((r) => r.who as string).sort();

async function clean() {
  await mode("all", "off");
  await sql("delete from public.person_roles where role <> 'member'");
  for (const [who, roles] of [[mary, ["admin", "pastor"]], [pastor, ["pastor"]], [director, ["director"]], [admin, ["admin"]], [coach, ["coach"]]] as [Person, string[]][]) {
    for (const r of roles) await sql("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [who.id, r]);
  }
  await sql("delete from public.leader_applications");
  await sql("delete from public.notice_items");
  await sql("delete from public.notice_pending");
  await sql("delete from public.notice_faults");
  await sql("delete from public.messages where params ? 'notice_group'");
}

/** A person who has started an application. Sending it is a separate step: `send`. */
async function drafting(name: string, answers: Record<string, unknown> = {}) {
  const u = await k.person(name);
  const rows = await sql("insert into public.leader_applications (person_id, consent_version, status, answers) values ($1, 'v1', 'draft', $2) returning id", [u.id, JSON.stringify(answers)]);
  return { ...u, application: rows[0].id as string };
}
/** The platform owner, made once for this file, with a God Mode session already unlocked. */
let owner: { id: string; email: string; session: string } | null = null;
async function theOwner() {
  if (owner) return owner;
  const u = await db.createUser({ email: "owner@example.org" });
  await sql("update public.people set full_name = 'Secret Owner', preferred_name = 'Secret' where id = $1", [u.id]);
  await sql("select public.bootstrap_platform_owner($1, $2)", [u.email, PHRASE]);
  const session = randomUUID();
  await db.asUser(u.id, (q) => q("select public.god_unlock($1)", [PHRASE]), { session });
  owner = { id: u.id, email: u.email, session };
  return owner;
}
const send = (applicationId: string) => sql("update public.leader_applications set status = 'submitted', submitted_at = now() where id = $1", [applicationId]);

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  mary = await k.staff("Mary", "admin", "pastor");
  pastor = await k.staff("Pastor2", "pastor");
  director = await k.staff("Dir", "director");
  admin = await k.staff("Adminonly", "admin");
  coach = await k.staff("Cody", "coach");
  second = (await sql("insert into public.centres (slug, name) values ('other', 'Other') returning id"))[0].id as string;
}, 120_000);

afterAll(async () => {
  await db.close();
});

beforeEach(clean);

describe("a new leader application was sent", () => {
  it("writes nothing while its groups are Off", async () => {
    const a = await drafting("Ada");
    await send(a.application);
    expect(await items("admin_application_sent")).toEqual([]);
    expect(await mails("admin_application_sent")).toEqual([]);
    expect(await sql("select * from public.notice_faults")).toEqual([]);
  });

  it("in Rehearsal writes to the log only: nobody is emailed", async () => {
    await mode("admin", "rehearsal");
    await mode("directors", "rehearsal");
    const a = await drafting("Ada");
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
    const sent = await mails("admin_application_sent");
    expect(sent).toHaveLength(3);
    for (const m of sent) {
      expect(m.status).toBe("skipped");
      expect(m.error).toMatch(/^Rehearsal/);
    }
  });

  it("tells every admin and director, once each, and no pastor or coach", async () => {
    await mode("all", "on");
    const a = await drafting("Ada");
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
    const sent = await mails("admin_application_sent");
    expect(sent.map((m) => m.who).sort()).toEqual(["Adminonly", "Dir", "Mary"]);
    for (const m of sent) {
      expect(m.force_channel).toBe("email");
      expect(m.params.applicant).toBe("Ada");
      expect(m.params.waiting).toBe(1);
    }
  });

  it("sends it at once, not in the summary, whatever the person chose", async () => {
    await mode("all", "on");
    await sql("insert into public.notice_prefs (person_id, group_key, delivery) values ($1, 'directors', 'weekly')", [director.id]);
    const a = await drafting("Ada");
    await send(a.application);
    const rows = await items("admin_application_sent");
    expect(rows.every((r) => r.delivery === "instant" && r.sent_at !== null)).toBe(true);
  });

  it("sends each person to a page they can open", async () => {
    await mode("all", "on");
    const a = await drafting("Ada");
    await send(a.application);
    const path = Object.fromEntries((await items("admin_application_sent")).map((r) => [r.who as string, r.path as string]));
    expect(path).toEqual({ Dir: "/review", Mary: "/review", Adminonly: "/admin/figures" });
  });

  it("respects each group's switch separately", async () => {
    await mode("directors", "on");
    const a = await drafting("Ada");
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Dir"]);
    await sql("delete from public.notice_items");
    await mode("directors", "off");
    await mode("admin", "on");
    const b = await drafting("Bola");
    await send(b.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Mary"]);
  });

  it("tells someone who is both an admin and a director once", async () => {
    await mode("all", "on");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'director', centre_id from public.people where id = $1", [admin.id]);
    const a = await drafting("Ada");
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
    const own = (await items("admin_application_sent")).find((r) => r.who === "Adminonly");
    expect(own?.path).toBe("/review");
  });

  it("does not tell the applicant about their own application, even if they are an admin", async () => {
    await mode("all", "on");
    const a = await drafting("Ada");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'admin', centre_id from public.people where id = $1", [a.id]);
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
  });

  it("does not tell the team of another centre", async () => {
    await mode("all", "on");
    const other = await k.person("Faraway");
    await sql("update public.people set centre_id = $2 where id = $1", [other.id, second]);
    await sql("insert into public.person_roles (person_id, role, centre_id) values ($1, 'director', $2)", [other.id, second]);
    const a = await drafting("Ada");
    await send(a.application);
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
  });

  it("says how many applications are waiting for an invitation, counting this one", async () => {
    await mode("all", "on");
    const a = await drafting("Ada");
    const b = await drafting("Bola");
    await send(a.application);
    await send(b.application);
    const waits = (await mails("admin_application_sent")).filter((m) => m.who === "Dir").map((m) => m.params.waiting);
    expect(waits).toEqual([1, 2]);
  });

  it("is not sent a second time for the same sending", async () => {
    await mode("all", "on");
    const a = await drafting("Ada");
    await send(a.application);
    await sql("update public.leader_applications set status = 'submitted', step = 'done' where id = $1", [a.application]);
    expect(await items("admin_application_sent")).toHaveLength(3);
  });

  it("carries nothing the applicant wrote", async () => {
    await mode("all", "on");
    const a = await drafting("Ada", { why: "SECRET-WORDS-ABOUT-MY-PAST", goalStory: "PRIVATE-STORY" });
    await send(a.application);
    const text = JSON.stringify(await mails("admin_application_sent")) + JSON.stringify(await items("admin_application_sent"));
    expect(text).not.toMatch(/SECRET-WORDS|PRIVATE-STORY/);
    expect(Object.keys((await mails("admin_application_sent"))[0].params).sort()).toEqual(["applicant", "notice_group", "notice_kind", "path", "waiting"]);
  });

  it("does not name a young applicant", async () => {
    await mode("all", "on");
    const teen = await drafting("Teeny");
    await sql(
      `insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, token_hash, token_expires_at)
       values ($1, 'Parent Person', 'mother', 'parent@example.org', 'tok-young', now() + interval '7 days')`,
      [teen.id],
    );
    await send(teen.application);
    const sent = await mails("admin_application_sent");
    expect(sent).toHaveLength(3);
    for (const m of sent) expect(m.params.applicant).toBeNull();
    expect(JSON.stringify(sent)).not.toMatch(/Teeny/);
  });

  it("never stops the application from being sent: a notice that cannot be queued is a line on the log", async () => {
    await mode("all", "on");
    await sql(`create function public.t_break() returns trigger language plpgsql as $$ begin raise exception 'break'; end $$`);
    await sql("create trigger t_break before insert on public.notice_items for each row execute function public.t_break()");
    try {
      const a = await drafting("Ada");
      await send(a.application);
      expect((await sql("select status from public.leader_applications where id = $1", [a.application]))[0].status).toBe("submitted");
      expect((await sql("select source from public.notice_faults")).map((f) => f.source)).toContain("application_sent");
    } finally {
      await sql("drop trigger t_break on public.notice_items");
      await sql("drop function public.t_break()");
    }
  });

  it("is not reachable through the API", async () => {
    const rows = await sql(
      `select has_function_privilege('authenticated', 'public.notice_trg_application_sent()', 'execute') as a,
              has_function_privilege('anon', 'public.notice_trg_application_sent()', 'execute') as b`,
    );
    expect(rows[0]).toEqual({ a: false, b: false });
  });
});

describe("the hidden owner is never named in an email", () => {
  it("does not say who gave a role when the owner did it from God Mode, and still tells the admins", async () => {
    await mode("all", "on");
    const target = await k.person("Tunde");
    const o = await theOwner();
    await db.asUser(o.id, (q) => q("select public.invite_person($1, 'coach')", [target.email]), { session: o.session });

    const told = await mails("admin_role_changed");
    expect(told.map((m) => m.who).sort()).toEqual(["Adminonly", "Mary"]);
    for (const m of told) {
      expect(m.params.person).toBe("Tunde");
      expect(m.params.role).toBe("coach");
      expect(m.params.by).toBeNull();
    }
    const everything = JSON.stringify(await sql("select params, template from public.messages where params ? 'notice_group'"))
      + JSON.stringify(await sql("select label, kind from public.notice_items"));
    expect(everything).not.toMatch(/Secret/);
    expect(await sql("select * from public.notice_faults")).toEqual([]);
  });

  it("still credits an ordinary admin by first name", async () => {
    await mode("all", "on");
    const target = await k.person("Chidi");
    await db.asUser(admin.id, (q) => q("select public.invite_person($1, 'coach')", [target.email]));
    const told = await mails("admin_role_changed");
    expect(told.length).toBeGreaterThan(0);
    for (const m of told) expect(m.params.by).toBe("Adminonly");
  });

  it("writes nothing when the hidden owner is the one who receives a role", async () => {
    await mode("all", "on");
    const o = await theOwner();
    await sql("delete from public.notice_items");
    await sql("delete from public.messages where params ? 'notice_group'");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1 on conflict do nothing", [o.id]);
    expect(await sql("select * from public.notice_items")).toEqual([]);
    expect(await sql("select * from public.messages where params ? 'notice_group'")).toEqual([]);
    await sql("delete from public.person_roles where person_id = $1", [o.id]);
  });
});

describe("when the applicant really presses Send", () => {
  // The same answers the leader-application tests use, sent through the real function: this is the path a person takes, not a row edited by hand.
  const BEST: Record<string, string> = { s1: "b", s2: "b", s3: "a", s4: "a", s5: "a", s6: "a" };
  const WORST: Record<string, string> = { s1: "d", s2: "c", s3: "d", s4: "c", s5: "b", s6: "c" };
  const picks = Object.fromEntries(Object.keys(BEST).map((key) => [key, { best: BEST[key], worst: WORST[key] }]));
  const answers = {
    eligibility: { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true },
    calling: {
      track: "builders", community: "professionals", goal: "step-into-a-leadership-role", goalRelation: "pursuing", walkRating: 4,
      goalStory: "I have been stepping into leadership at work this year and I am still learning how to do it well.",
      why: "I want to help other people grow into what God has put in them, not to be seen by anyone.",
      walked: "I walked with a friend through a job loss. I listened a lot and did not give him advice.",
      walkNote: "Steady, though I get tired in busy seasons and pray less than I want to these days.",
      obstacles: "Work travel in the second half of the season could get in the way of the weekly meeting.",
    },
    scenarios: picks,
    style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
    contact: { whatsapp: "+2348031234567" },
  };

  it("emails the admins and directors through the real send function", async () => {
    await mode("all", "on");
    const user = await db.createUser();
    const consent = (await sql("select consent_version as v from public.leader_ai_settings"))[0].v as string;
    const rows = (await db.asUser(user.id, (q) =>
      q("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'welcome', $2::jsonb, $3) returning id", [user.id, JSON.stringify(answers), consent]),
    )).rows;
    const appId = rows[0].id as string;
    await db.asUser(user.id, (q) => q("select public.set_referee($1, 1, 'Pastor Ife', 'Unit head', $2, true)", [appId, uniqueEmail("ife")]));
    await db.asUser(user.id, (q) => q("select public.set_referee($1, 2, 'Sister Bola', 'Friend', $2, false)", [appId, uniqueEmail("bola")]));
    expect(await items("admin_application_sent")).toEqual([]); // a draft tells no one

    await db.asUser(user.id, (q) => q("select public.submit_leader_application($1)", [appId]));
    expect((await sql("select status from public.leader_applications where id = $1", [appId]))[0].status).toBe("submitted");
    expect(await whoGot("admin_application_sent")).toEqual(["Adminonly", "Dir", "Mary"]);
    expect((await sql("select * from public.notice_faults"))).toEqual([]);
    // Nothing the applicant wrote travels in the email
    expect(JSON.stringify(await mails("admin_application_sent"))).not.toMatch(/stepping into leadership|job loss|weekly meeting/);
  });
});
