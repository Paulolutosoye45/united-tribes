import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { kit, type Kit, type Person } from "./builders";
import { parseLog, parseOverview, parsePrefs, noticeTitle } from "@/lib/admin/notices";
import { countsByHref, parseAttention } from "@/lib/admin/today";
import { menuFor } from "@/lib/admin/nav";

// The notice system: what is sent to the office, the pastors, the leaders and members, and when.
//
// Time is never the wall clock. Every sweep is given its own time (`when`), so these tests give the same answer at noon and at 3 am.
// What they pin down:
//   - a group that is Off writes nothing; Rehearsal writes to the log and sends nothing; On queues email
//   - one email per event per person, even for someone who holds several roles; one digest with a part for each role
//   - a role taken away stops that person's notices that day
//   - the owner and anyone under 18 are never written to
//   - a notice that cannot be queued never blocks the thing that happened
//   - nothing sensitive is in what is queued
//   - the Admin pages read what each person's roles allow, merged

let db: TestDb;
let k: Kit;
let mary: Person; // admin and pastor
let pastor: Person; // pastor only
let director: Person;
let admin: Person; // admin only
let coach: Person;
let second: string; // a second centre

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const as = async (who: Person | string, text: string, params: unknown[] = []) => (await db.asUser(typeof who === "string" ? who : who.id, (q) => q(text, params))).rows;
const call = async (who: Person | string, fn: string, params: unknown[] = []) =>
  (await as(who, `select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params))[0]?.r;

const GROUPS = ["admin", "pastors", "directors", "care", "coaches", "leaders", "champions", "data_lead", "members", "applicants", "referees"];
const mode = (group: string | "all", m: "off" | "rehearsal" | "on") =>
  sql("update public.notice_settings set mode = $2 where $1 = 'all' or group_key = $1", [group, m]);
const on = (...groups: string[]) => Promise.all(groups.map((g) => mode(g, "on")));

/** A time on the Lagos clock: `days` from today, at `hour`. With `monday`, the first Monday on or after that day. */
async function when(days: number, hour = 9, monday = false): Promise<string> {
  const r = await sql(
    `select ((d + make_interval(hours => $2)) at time zone 'Africa/Lagos') as t
       from (select (public.today_lagos() + $1::int + case when $3 then ((8 - extract(isodow from public.today_lagos() + $1::int)::int) % 7) else 0 end) as d) x`,
    [days, hour, monday],
  );
  return (r[0].t as Date).toISOString();
}
const sweep = async (at: string) => (await sql("select public.notice_sweep($1::timestamptz) as r", [at]))[0].r as { queued: number; digests: number; problems: string[] };

const items = (where = "true", params: unknown[] = []) =>
  sql(`select i.*, p.preferred_name as who from public.notice_items i join public.people p on p.id = i.person_id where ${where} order by i.id`, params);
const mails = (where = "true", params: unknown[] = []) =>
  sql(`select m.*, p.preferred_name as who from public.messages m left join public.people p on p.id = m.person_id
        where m.params ? 'notice_group' and ${where} order by m.created_at, m.id`, params);
const escalated = async (event: string) => (await items("i.kind = 'staff_escalation' and i.event like $1", [`${event}:%`])).map((r) => r.who as string).sort();
const whoGot = async (kind: string) => (await items("i.kind = $1", [kind])).map((r) => r.who as string).sort();

/** Every test starts from the same place: everything Off, the five people holding the roles they began with, and no leftovers of the last test. */
async function clean() {
  await mode("all", "off");
  await sql("delete from public.person_roles where role <> 'member'");
  for (const [who, roles] of [[mary, ["admin", "pastor"]], [pastor, ["pastor"]], [director, ["director"]], [admin, ["admin"]], [coach, ["coach"]]] as [Person, string[]][]) {
    for (const r of roles) await sql("insert into public.person_roles (person_id, role, centre_id) select id, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [who.id, r]);
  }
  await sql("delete from public.erasure_requests");
  await sql("delete from public.interview_slots");
  await sql("delete from public.leader_applications");
  await sql("delete from public.messages where status = 'failed' and error = 'x'");
  await wipe();
}
/** Forget what the notice system has written so far (a test's own set-up should not count), and keep everything else as it is. */
async function wipe() {
  await sql("delete from public.notice_items");
  await sql("delete from public.notice_pending");
  await sql("delete from public.notice_faults");
  await sql("delete from public.notice_prefs");
  await sql("delete from public.messages where params ? 'notice_group' or template in ('staff_digest', 'member_deletion_done')");
}
const parentOf = (person: string, token: string) =>
  sql(
    `insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, token_hash, token_expires_at)
     values ($1, 'Parent Person', 'mother', 'parent@example.org', $2, now() + interval '7 days') returning id`,
    [person, token],
  );

let n = 0;
async function applicant(name: string, status: "submitted" | "interviewed" = "submitted") {
  const u = await k.person(name);
  const rows = await sql("insert into public.leader_applications (person_id, consent_version, status) values ($1, 'v1', $2) returning id", [u.id, status]);
  return { ...u, application: rows[0].id as string };
}
const interview = (applicationId: string) => sql("update public.leader_applications set status = 'interviewed' where id = $1", [applicationId]);

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

describe("the switches", () => {
  it("are all Off to begin with, and a group that is Off writes nothing at all", async () => {
    expect((await sql("select group_key, mode from public.notice_settings order by group_key")).map((r) => [r.group_key, r.mode])).toEqual(GROUPS.slice().sort().map((g) => [g, "off"]));
    const a = await applicant("Ada");
    await interview(a.application);
    expect(await items()).toEqual([]);
    expect(await mails()).toEqual([]);
    expect(await sql("select * from public.notice_faults")).toEqual([]);
  });

  it("in Rehearsal write to the log only: nothing is queued, so nothing can be sent", async () => {
    await mode("pastors", "rehearsal");
    const a = await applicant("Ada");
    await interview(a.application);
    await sweep(await when(1, 9));
    const rows = await mails();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.status).toBe("skipped");
      expect(r.error).toMatch(/^Rehearsal/);
    }
    expect(rows.filter((r) => r.status === "queued")).toEqual([]);
  });

  it("when On queue email, and only email", async () => {
    await on("pastors");
    const a = await applicant("Ada");
    await interview(a.application);
    await sweep(await when(1, 9));
    const digests = await mails("m.template = 'staff_digest'");
    expect(digests.map((r) => r.who).sort()).toEqual(["Mary", "Pastor2"]);
    for (const r of digests) {
      expect(r.status).toBe("queued");
      expect(r.force_channel).toBe("email");
    }
  });

  it("read as Off when the settings cannot be read: the strictest answer, and the work still goes through", async () => {
    await mode("all", "on");
    await sql("alter table public.notice_settings rename to notice_settings_away");
    try {
      const a = await applicant("Ada");
      await interview(a.application);
      expect((await sql("select status from public.leader_applications where id = $1", [a.application]))[0].status).toBe("interviewed");
    } finally {
      await sql("alter table public.notice_settings_away rename to notice_settings");
    }
    expect(await items()).toEqual([]);
  });

  it("never email the owner, whoever is asking, and never someone under 18", async () => {
    await on("pastors", "members");
    const owner = await k.staff("Hiddenowner", "pastor");
    await sql("update public.people set hidden = true where id = $1", [owner.id]);
    const a = await applicant("Ada");
    await interview(a.application);
    expect((await whoGot("pastor_decision_ready"))).toEqual(["Mary", "Pastor2"]);

    const teen = await k.person("Teeny");
    await parentOf(teen.id, "x");
    const season = await k.season("S", 10);
    const { tribe } = await k.tribe(season, { certified: true });
    await sql(
      "insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit, status) values ($1, $2, 1, 'A long private story.', 'tribe', 'first_name', 'submitted')",
      [teen.id, tribe],
    );
    await sql("update public.testimonies set status = 'tribe_approved' where person_id = $1", [teen.id]);
    expect(await items("i.person_id = $1", [teen.id])).toEqual([]);
    await sql("delete from public.person_roles where person_id = $1", [owner.id]);
  });

  it("never stop the thing that happened: a notice that cannot be queued is a fault on the log, not an error", async () => {
    await on("pastors");
    await sql(`create function public.t_break() returns trigger language plpgsql as $$ begin raise exception 'break'; end $$`);
    await sql("create trigger t_break before insert on public.notice_items for each row execute function public.t_break()");
    try {
      const a = await applicant("Ada");
      await interview(a.application);
      expect((await sql("select status from public.leader_applications where id = $1", [a.application]))[0].status).toBe("interviewed");
      const faults = await sql("select source, message from public.notice_faults");
      expect(faults.map((f) => f.source)).toContain("application");
    } finally {
      await sql("drop trigger t_break on public.notice_items");
      await sql("drop function public.t_break()");
    }
  });
});

describe("one email per event, whoever holds which roles", () => {
  it("tells the pastors an application is ready: someone who is admin and pastor hears once, a pastor in another centre not at all, the applicant not at all", async () => {
    await on("pastors", "admin");
    const other = await k.staff("Faraway", "pastor");
    await sql("delete from public.person_roles where person_id = $1", [other.id]);
    await sql("update public.people set centre_id = $2 where id = $1", [other.id, second]);
    await sql("insert into public.person_roles (person_id, role, centre_id) values ($1, 'pastor', $2)", [other.id, second]);
    const a = await applicant("Ada");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1", [a.id]);
    await wipe();
    await on("pastors", "admin");
    await interview(a.application);
    expect(await whoGot("pastor_decision_ready")).toEqual(["Mary", "Pastor2"]);
    const m = await items("i.person_id = $1", [mary.id]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ group_key: "pastors", delivery: "digest", path: "/review" });
  });

  it("does not tell the applicant, who is also a pastor, about their own application", async () => {
    await on("pastors");
    const a = await applicant("Selfie");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1", [a.id]);
    await wipe();
    await on("pastors");
    await interview(a.application);
    expect(await items("i.person_id = $1", [a.id])).toEqual([]);
  });

  it("gives a coach who is also a pastor one email for a submitted Tribe Card, not two", async () => {
    await on("pastors", "directors", "coaches");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'coach', centre_id from public.people where id = $1", [pastor.id]);
    await wipe();
    await on("pastors", "directors", "coaches");
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "draft", coach: pastor.id, certified: true });
    await sql("update public.tribes set status = 'submitted', submitted_at = now() where id = $1", [tribe]);
    const got = await items("i.event like 'card:%'");
    expect(got.filter((r) => r.who === "Pastor2")).toHaveLength(1);
    expect(got.filter((r) => r.who === "Mary")).toHaveLength(1);
    expect(got.filter((r) => r.who === "Dir")).toHaveLength(1);
    expect(got.filter((r) => r.person_id === leader.id)).toHaveLength(0);
    expect(got.filter((r) => r.who === "Cody")).toHaveLength(0);
    await sql("delete from public.person_roles where person_id = $1 and role = 'coach'", [pastor.id]);
  });

  it("tells the tribe's coach when the coach is not a pastor", async () => {
    await on("pastors", "directors", "coaches");
    const season = await k.season("S", 10);
    const { tribe } = await k.tribe(season, { status: "draft", coach: coach.id });
    await sql("update public.tribes set status = 'submitted', submitted_at = now() where id = $1", [tribe]);
    expect(await whoGot("coach_card_submitted")).toEqual(["Cody"]);
  });
});

describe("what each event tells whom", () => {
  it("tells a leader their card was approved, and that the tribe is open once they are certified", async () => {
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "submitted", certified: true });
    await on("leaders");
    await sql("update public.tribes set status = 'approved' where id = $1", [tribe]);
    const got = await items("i.person_id = $1", [leader.id]);
    expect(got.map((r) => r.kind).sort()).toEqual(["leader_card_approved", "leader_tribe_open"]);
  });

  it("holds 'the tribe is open' until the certificate arrives, then says it", async () => {
    await on("leaders");
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "submitted", certified: false });
    await sql("update public.tribes set status = 'approved' where id = $1", [tribe]);
    expect((await items("i.person_id = $1", [leader.id])).map((r) => r.kind)).toEqual(["leader_card_approved"]);
    await sql("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
    expect((await items("i.person_id = $1", [leader.id])).map((r) => r.kind).sort()).toEqual(["leader_card_approved", "leader_certified", "leader_tribe_open"]);
  });

  it("asks a leader for changes without putting the pastor's note in the email", async () => {
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "submitted" });
    await on("leaders");
    await sql("update public.tribes set status = 'changes_requested', review_note = 'PRIVATE-REVIEW-NOTE-77' where id = $1", [tribe]);
    expect((await items("i.person_id = $1", [leader.id])).map((r) => r.kind)).toEqual(["leader_card_changes"]);
    await sweep(await when(1, 9));
    expect(JSON.stringify(await sql("select params, label from public.messages m, public.notice_items i where i.person_id = m.person_id"))).not.toMatch(/PRIVATE-REVIEW-NOTE/);
    expect(JSON.stringify(await items())).not.toMatch(/PRIVATE-REVIEW-NOTE/);
    expect(JSON.stringify(await mails())).not.toMatch(/PRIVATE-REVIEW-NOTE/);
  });

  it("tells the new coach, and the leader whose assistant was added", async () => {
    await on("coaches", "leaders");
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "approved" });
    await sql("update public.tribes set coach_id = $2 where id = $1", [tribe, coach.id]);
    expect(await whoGot("coach_new_leader")).toEqual(["Cody"]);
    const helper = await k.staff("Helper", "assistant_leader");
    await sql("update public.tribes set assistant_id = $2 where id = $1", [tribe, helper.id]);
    expect((await items("i.kind = 'leader_assistant_added'")).map((r) => r.person_id)).toEqual([leader.id]);
  });

  it("warns a leader when two seats are left and when the tribe is full", async () => {
    await on("leaders");
    const season = await k.season("S", 10);
    const { tribe, leader } = await k.tribe(season, { status: "approved", capacity: 4 });
    await k.seat(tribe, season, "One", { profile: false });
    expect(await items("i.kind = 'leader_seats'")).toEqual([]);
    await k.seat(tribe, season, "Two", { profile: false });
    expect((await items("i.kind = 'leader_seats'")).map((r) => r.event)).toEqual([`seats:${tribe}:2`]);
    await k.seat(tribe, season, "Three", { profile: false });
    await k.seat(tribe, season, "Four", { profile: false });
    expect((await items("i.kind = 'leader_seats'")).map((r) => r.event)).toEqual([`seats:${tribe}:2`, `seats:${tribe}:0`]);
    expect((await items("i.kind = 'leader_seats'")).every((r) => r.person_id === leader.id)).toBe(true);
  });

  it("tells members about a changed meeting once things have been quiet, and not at all when it is put back", async () => {
    await on("members");
    const season = await k.season("S", 10);
    const { tribe } = await k.tribe(season, { status: "approved" });
    const a = await k.seat(tribe, season, "Memb1", { profile: false });
    await k.seat(tribe, season, "Memb2", { profile: false });
    await sql("update public.tribes set meeting_time = '19:00' where id = $1", [tribe]);
    await sql("update public.tribes set meeting_time = '18:00' where id = $1", [tribe]);
    expect(await sql("select * from public.notice_pending where kind = 'meeting_changed'")).toHaveLength(1);
    const q = await sweep(await when(1, 9));
    expect(q.problems).toEqual([]);
    expect((await items("i.kind = 'member_meeting_changed'")).map((r) => r.who).sort()).toEqual(["Memb1", "Memb2"]);
    expect(await sql("select * from public.notice_pending")).toEqual([]);

    // put back the way it was before the edits: nothing to announce
    await wipe();
    await on("members");
    await sql("update public.tribes set meeting_time = '17:00' where id = $1", [tribe]);
    await sql("update public.tribes set meeting_time = '18:00' where id = $1", [tribe]);
    await sweep(await when(1, 9));
    expect(await items("i.kind = 'member_meeting_changed' and i.person_id = $1", [a.id])).toEqual([]);
  });

  it("tells directors when an offer is answered", async () => {
    await on("directors");
    const season = await k.season("S", 10);
    const goal = await k.goalOf("professionals");
    const person = await k.person("Offered");
    const rows = await sql(
      "insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer) values ($1, $2, $3, 9) returning id",
      [goal, person.id, season],
    );
    await sql("update public.leader_offers set status = 'accepted', answered_at = now() where id = $1", [rows[0].id]);
    expect(await whoGot("director_offer_answered")).toEqual(["Dir"]);
  });

  it("tells the office about a booked interview and the person who opened the slot", async () => {
    await on("directors", "pastors");
    const a = await applicant("Ada");
    const slot = await sql(
      "insert into public.interview_slots (starts_at, minutes, mode, place, created_by) values (now() + interval '3 days', 30, 'online', 'Zoom', $1) returning id",
      [pastor.id],
    );
    await sql("update public.interview_slots set application_id = $2, booked_at = now() where id = $1", [slot[0].id, a.application]);
    expect(await whoGot("director_interview_booked")).toEqual(["Dir", "Pastor2"]);
  });

  it("tells pastors a fit model is waiting for approval", async () => {
    await on("pastors");
    await sql("insert into public.leader_fit_models (version, weights, active) select 'v-test', weights, false from public.leader_fit_models limit 1");
    expect(await whoGot("pastor_fit_model_waiting")).toEqual(["Mary", "Pastor2"]);
  });

  it("tells a leader's coach when every module is passed and the practice assessment has not been done", async () => {
    await on("coaches");
    const season = await k.season("S", 10);
    const { leader } = await k.tribe(season, { status: "approved", coach: coach.id });
    for (const m of await sql("select id from public.academy_modules where active")) {
      await sql("insert into public.academy_progress (person_id, module_id, passed_at, best_score, attempts) values ($1, $2, now(), 90, 1)", [leader.id, m.id]);
    }
    expect(await whoGot("coach_practice_ready")).toEqual(["Cody"]);
  });

  it("tells the author their testimony was shared, without a word of it", async () => {
    await on("members");
    const season = await k.season("S", 10);
    const { tribe } = await k.tribe(season, { status: "approved" });
    const author = await k.seat(tribe, season, "Author", { profile: false });
    await sql(
      "insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit, status) values ($1, $2, 1, 'PRIVATE-TESTIMONY-WORDS', 'tribe', 'first_name', 'submitted')",
      [author.id, tribe],
    );
    await sql("update public.testimonies set status = 'tribe_approved' where person_id = $1", [author.id]);
    expect(await whoGot("member_testimony_shared")).toEqual(["Author"]);
    expect(JSON.stringify(await items()) + JSON.stringify(await mails())).not.toMatch(/PRIVATE-TESTIMONY/);
  });
});

describe("what a referee, a held reference and a parent's permission say: nothing but that they happened", () => {
  async function reference(person: { application: string }) {
    const r = await sql(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, token_hash, token_expires_at)
       values ($1, 1, 'Rita Referee', 'friend', 'rita@example.org', $2, now() + interval '10 days') returning id`,
      [person.application, `h${++n}`],
    );
    return r[0].id as string;
  }

  it("tells the pastors at once that a referee raised a concern, with no text", async () => {
    await on("pastors");
    const a = await applicant("Ada", "submitted");
    const ref = await reference(a);
    await sql(
      "insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern, concern_note) values ($1, 3, 3, 3, 3, true, 'SECRET-CONCERN-TEXT')",
      [ref],
    );
    expect(await whoGot("pastor_referee_concern")).toEqual(["Mary", "Pastor2"]);
    const rows = await items("i.kind = 'pastor_referee_concern'");
    expect(rows.every((r) => r.delivery === "instant" && r.sent_at !== null)).toBe(true);
    const text = JSON.stringify(await items()) + JSON.stringify(await mails());
    expect(text).not.toMatch(/SECRET-CONCERN/);
    expect(text).not.toMatch(/Ada/);
  });

  it("tells the applicant and thanks the referee when a reference comes in", async () => {
    await on("applicants", "referees");
    const a = await applicant("Ada", "submitted");
    const ref = await reference(a);
    await sql("update public.leader_references set submitted_at = now(), contact_kind = 'email', contact_norm = 'rita@example.org' where id = $1", [ref]);
    expect(await whoGot("applicant_reference_in")).toEqual(["Ada"]);
    const thanks = await mails("m.template = 'referee_thanks'");
    expect(thanks).toHaveLength(1);
    expect(thanks[0]).toMatchObject({ to_email: "rita@example.org", person_id: null, status: "queued" });
  });

  it("tells the pastors that a reference is held, and not why", async () => {
    await on("pastors");
    const a = await applicant("Ada", "submitted");
    const ref = await reference(a);
    await sql("insert into public.leader_reference_flags (reference_id, kind, severity, detail) values ($1, 'same_browser', 'hold', 'SECRET-FLAG-DETAIL')", [ref]);
    expect(await whoGot("pastor_reference_held")).toEqual(["Mary", "Pastor2"]);
    expect(JSON.stringify(await items()) + JSON.stringify(await mails())).not.toMatch(/SECRET-FLAG|same_browser/);
  });

  it("tells the care team that a parent's permission needs its call, with no name and no age", async () => {
    await on("care");
    const teen = await k.person("Youngster");
    const rows = await parentOf(teen.id, "z");
    await sql("update public.guardian_consents set status = 'approved', consent_version = 'v1', answered_at = now() where id = $1", [rows[0].id]);
    // there is no care lead, so the directors are the care team
    expect(await whoGot("care_teen_confirm")).toEqual(["Dir"]);
    const text = JSON.stringify(await items()) + JSON.stringify(await mails());
    expect(text).not.toMatch(/Youngster|Parent Person/);
  });
});

describe("deleting a person", () => {
  it("tells the admins and directors, not the person asking, and confirms receipt to the person", async () => {
    await on("admin", "directors", "members");
    const member = await k.person("Leaving");
    await call(member, "request_erasure", ["I would like to leave"]);
    expect(await whoGot("admin_data_request")).toEqual(["Adminonly", "Dir", "Mary"]);
    expect(await whoGot("member_deletion_received")).toEqual(["Leaving"]);
  });

  it("does not tell the person when the office recorded the request for them", async () => {
    await on("admin", "members");
    const member = await k.person("Phoned");
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [member.id]);
    expect(await whoGot("member_deletion_received")).toEqual([]);
    expect(await whoGot("admin_data_request")).toEqual(["Adminonly", "Mary"]);
  });

  it("sends one last email to the address when the person is erased, then wipes the address", async () => {
    await on("members");
    const member = await k.person("Goodbye");
    const email = (await sql("select email from public.people where id = $1", [member.id]))[0].email as string;
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, false from public.people where id = $1", [member.id]);
    await wipe();
    await on("members");
    const out = await call(admin, "erase_person", [member.id]);
    expect(out).toEqual({ erased: true });
    const last = await sql("select * from public.messages where template = 'member_deletion_done'");
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ person_id: null, to_email: email, status: "queued" });
    expect(JSON.stringify(last[0].params)).not.toMatch(/Goodbye Test/);
    // it goes; later the address is overwritten so nothing about them is kept
    await sql("update public.messages set status = 'sent' where template = 'member_deletion_done'");
    await sweep(await when(1, 9));
    const after = await sql("select to_email, to_name, params from public.messages where template = 'member_deletion_done'");
    expect(after[0]).toMatchObject({ to_email: "erased@erased.invalid", to_name: null, params: { erased: true } });
  });

  it("does not write a goodbye to someone under 18", async () => {
    await on("members");
    const teen = await k.person("Teenleaver");
    await parentOf(teen.id, "q");
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, false from public.people where id = $1", [teen.id]);
    await call(admin, "erase_person", [teen.id]);
    expect(await sql("select * from public.messages where template = 'member_deletion_done'")).toEqual([]);
  });
});

describe("roles", () => {
  it("welcomes someone given a staff role at once, and tells the other admins; a leader role is no news", async () => {
    await on("pastors", "admin", "coaches", "leaders");
    const fresh = await k.person("Fresh");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1", [fresh.id]);
    const welcome = await items("i.kind = 'staff_role_welcome'");
    expect(welcome.map((r) => [r.who, r.delivery])).toEqual([["Fresh", "instant"]]);
    expect((await items("i.kind = 'admin_role_changed'")).map((r) => r.who).sort()).toEqual(["Adminonly", "Mary"]);
    expect((await items("i.kind = 'admin_role_changed'")).every((r) => r.delivery === "instant")).toBe(true);
    await wipe();
    await on("pastors", "admin", "coaches", "leaders");
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'leader', centre_id from public.people where id = $1", [fresh.id]);
    expect(await items()).toEqual([]);
  });

  it("stops a person's notices the day a role is taken away, even a digest already waiting", async () => {
    await on("pastors", "admin");
    const a = await applicant("Ada");
    await interview(a.application);
    expect((await items("i.person_id = $1 and i.sent_at is null", [pastor.id])).length).toBe(1);
    await sql("delete from public.person_roles where person_id = $1 and role = 'pastor'", [pastor.id]);
    expect(await items("i.person_id = $1 and i.sent_at is null", [pastor.id])).toEqual([]);
    expect((await items("i.person_id = $1 and i.kind = 'pastor_decision_ready'", [pastor.id]))[0].note).toBe("role removed");
    await sweep(await when(1, 9));
    expect((await mails("m.template = 'staff_digest' and m.person_id = $1", [pastor.id]))).toEqual([]);
    expect((await mails("m.template = 'staff_digest' and m.person_id = $1", [mary.id]))).toHaveLength(1);
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1", [pastor.id]);
  });

  it("keeps an admin's notices when only their pastor role is taken away", async () => {
    await on("pastors", "admin");
    const dual = await k.staff("Dual", "admin", "pastor");
    await wipe();
    await on("pastors", "admin");
    const a = await applicant("Ada");
    await interview(a.application);
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [(await k.person("Gone")).id]);
    expect((await items("i.person_id = $1 and i.sent_at is null", [dual.id])).map((r) => r.group_key).sort()).toEqual(["admin", "pastors"]);
    await sql("delete from public.person_roles where person_id = $1 and role = 'pastor'", [dual.id]);
    expect((await items("i.person_id = $1 and i.sent_at is null", [dual.id])).map((r) => r.group_key)).toEqual(["admin"]);
    await sql("delete from public.person_roles where person_id = $1", [dual.id]);
  });
});

describe("digests", () => {
  it("send one email to someone who is admin and pastor, with a part for each role", async () => {
    await on("pastors", "admin");
    const a = await applicant("Ada");
    await interview(a.application);
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [(await k.person("Gone")).id]);
    const r = await sweep(await when(1, 9));
    expect(r.problems).toEqual([]);
    const forMary = await mails("m.template = 'staff_digest' and m.person_id = $1", [mary.id]);
    expect(forMary).toHaveLength(1);
    expect((forMary[0].params.sections as { title: string }[]).map((s) => s.title)).toEqual(["Admin", "Pastor"]);
    expect(forMary[0].params.total).toBe(2);
    // pastor only: one part; admin only: one part
    const forPastor = await mails("m.template = 'staff_digest' and m.person_id = $1", [pastor.id]);
    expect((forPastor[0].params.sections as { title: string }[]).map((s) => s.title)).toEqual(["Pastor"]);
    const forAdmin = await mails("m.template = 'staff_digest' and m.person_id = $1", [admin.id]);
    expect((forAdmin[0].params.sections as { title: string }[]).map((s) => s.title)).toEqual(["Admin"]);
    // and nobody gets two
    const all = await mails("m.template = 'staff_digest'");
    expect(new Set(all.map((x) => x.person_id)).size).toBe(all.length);
  });

  it("go out once a day: a second sweep the same day adds nothing", async () => {
    await on("pastors");
    const a = await applicant("Ada");
    await interview(a.application);
    await sweep(await when(1, 9));
    const first = (await mails("m.template = 'staff_digest'")).length;
    await sweep(await when(1, 12));
    expect((await mails("m.template = 'staff_digest'")).length).toBe(first);
  });

  it("wait for Monday when a person chose a weekly digest", async () => {
    await on("pastors");
    await call(pastor, "save_notice_pref", ["pastors", "weekly"]);
    const a = await applicant("Ada");
    await interview(a.application);
    const tuesday = await when(1, 9, true).then(async (m) => new Date(new Date(m).getTime() + 86_400_000).toISOString());
    await sweep(tuesday);
    expect(await mails("m.template = 'staff_digest' and m.person_id = $1", [pastor.id])).toEqual([]);
    expect(await mails("m.template = 'staff_digest' and m.person_id = $1", [mary.id])).toHaveLength(1);
    await sweep(await when(1, 9, true));
    const mine = await mails("m.template = 'staff_digest' and m.person_id = $1", [pastor.id]);
    expect(mine).toHaveLength(1);
    expect(mine[0].params.period).toBe("weekly");
  });

  it("do not repeat what was already sent at once", async () => {
    await on("pastors", "admin");
    const a = await applicant("Ada");
    const ref = (
      await sql(
        `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, token_hash, token_expires_at)
         values ($1, 1, 'Rita', 'friend', 'rita@example.org', $2, now() + interval '10 days') returning id`,
        [a.application, `u${++n}`],
      )
    )[0].id;
    await sql("insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern, concern_note) values ($1, 3, 3, 3, 3, true, 'a note')", [ref]);
    expect((await mails("m.template = 'pastor_referee_concern'")).length).toBe(2);
    await sweep(await when(1, 9));
    expect(await mails("m.template = 'staff_digest'")).toEqual([]);
  });

  it("show at most 25 lines and say how many more there are", async () => {
    await on("pastors");
    for (let i = 0; i < 30; i++) {
      await sql("insert into public.notice_items (person_id, group_key, kind, event, label, path, delivery) values ($1, 'pastors', 'pastor_decision_ready', $2, 'Line', '/review', 'digest')", [pastor.id, `bulk:${i}`]);
    }
    await sweep(await when(1, 9));
    const d = (await mails("m.template = 'staff_digest' and m.person_id = $1", [pastor.id]))[0];
    expect(d.params.total).toBe(30);
    expect(d.params.more).toBe(5);
    expect((d.params.sections as { items: unknown[] }[])[0].items).toHaveLength(25);
    expect(JSON.stringify(d.params).length).toBeLessThan(6000);
  });

  it("are not sent at night: the sweep holds them until the day", async () => {
    await on("pastors");
    const a = await applicant("Ada");
    await interview(a.application);
    await sweep(await when(1, 23));
    expect(await mails("m.template = 'staff_digest'")).toEqual([]);
    await sweep(await when(2, 9));
    expect((await mails("m.template = 'staff_digest'")).length).toBe(2);
  });
});

describe("the timed checks", () => {
  it("nudge the pastors when a decision has waited a week, and the directors when it has waited two", async () => {
    await on("pastors", "directors");
    await applicant("Ada", "interviewed");
    await sweep(await when(3, 9));
    expect(await whoGot("pastor_decision_overdue")).toEqual([]);
    await sweep(await when(8, 9));
    expect(await whoGot("pastor_decision_overdue")).toEqual(["Mary", "Pastor2"]);
    expect(await escalated("esc-decisions")).toEqual([]);
    await sweep(await when(15, 9));
    expect(await escalated("esc-decisions")).toEqual(["Dir"]);
  });

  it("nudge the pastors about a Tribe Card that has waited, and the directors if it keeps waiting", async () => {
    await on("pastors", "directors");
    const season = await k.season("S", 10);
    const { tribe } = await k.tribe(season, { status: "draft" });
    await sql("update public.tribes set status = 'submitted', submitted_at = now() where id = $1", [tribe]);
    await wipe();
    await on("pastors", "directors");
    await sweep(await when(6, 9));
    expect(await whoGot("pastor_card_overdue")).toEqual(["Mary", "Pastor2"]);
    await sweep(await when(11, 9));
    expect(await escalated("esc-cards")).toEqual(["Dir"]);
  });

  it("tell the directors the evening before an interview, once, and not in the middle of the night", async () => {
    await on("directors");
    const a = await applicant("Ada");
    const evening = await when(0, 18);
    const slotAt = await when(1, 10);
    const slot = await sql("insert into public.interview_slots (starts_at, minutes, mode, place) values ($1, 30, 'online', 'Zoom') returning id", [slotAt]);
    await sql("update public.interview_slots set application_id = $2 where id = $1", [slot[0].id, a.application]);
    await wipe();
    await on("directors");
    await sweep(await when(0, 12));
    expect(await whoGot("director_interviews_tomorrow")).toEqual([]);
    await sweep(evening);
    await sweep(evening);
    expect(await whoGot("director_interviews_tomorrow")).toEqual(["Dir"]);
  });

  it("flag an interview that ended two hours ago with no outcome", async () => {
    await on("directors", "pastors");
    const a = await applicant("Ada");
    await sql("update public.leader_applications set status = 'interview_booked' where id = $1", [a.application]);
    const startsAt = await when(0, 10);
    const slot = await sql("insert into public.interview_slots (starts_at, minutes, mode, place, created_by) values ($1, 30, 'online', 'Zoom', $2) returning id", [startsAt, pastor.id]);
    await sql("update public.interview_slots set application_id = $2 where id = $1", [slot[0].id, a.application]);
    await wipe();
    await on("directors", "pastors");
    await sweep(await when(0, 11));
    expect(await whoGot("director_interview_no_outcome")).toEqual([]);
    await sweep(await when(0, 13));
    expect(await whoGot("director_interview_no_outcome")).toEqual(["Dir", "Pastor2"]);
  });

  it("warn the admins as a deletion request nears its deadline, at once, and leave out the person asking", async () => {
    await on("admin", "directors");
    const asker = await k.staff("Askeradmin", "admin");
    await call(asker, "request_erasure", ["bye"]);
    await wipe();
    await on("admin", "directors");
    await sweep(await when(22, 9));
    expect(await whoGot("admin_data_request_due")).toEqual([]);
    await sweep(await when(24, 9));
    expect(await whoGot("admin_data_request_due")).toEqual(["Adminonly", "Mary"]);
    expect((await items("i.kind = 'admin_data_request_due'")).every((r) => r.delivery === "instant")).toBe(true);
    await sweep(await when(29, 9));
    expect(await whoGot("admin_data_request_due")).toEqual(["Adminonly", "Adminonly", "Dir", "Mary", "Mary"]);
    await sql("delete from public.erasure_requests");
    await sql("delete from public.person_roles where person_id = $1", [asker.id]);
  });

  it("tell the admins when many messages are failing, once for each stretch of the day", async () => {
    await on("admin");
    const at = await when(0, 10);
    const person = await k.person("Failing");
    for (let i = 0; i < 12; i++) {
      await sql("insert into public.messages (person_id, template, status, error, claimed_at) values ($1, 'welcome', 'failed', 'x', $2::timestamptz - interval '10 minutes')", [person.id, at]);
    }
    await sweep(at);
    await sweep(at);
    expect(await whoGot("admin_messages_failing")).toEqual(["Adminonly", "Mary"]);
    await sql("delete from public.messages where person_id = $1", [person.id]);
  });

  it("remind the pastors on Mondays, and only on Mondays, about ready-made cards", async () => {
    await on("pastors");
    expect((await sql("select count(*)::int c from public.tribe_card_templates where status = 'draft'"))[0].c).toBeGreaterThan(0);
    const monday = await when(1, 9, true);
    const tuesday = new Date(new Date(monday).getTime() + 86_400_000).toISOString();
    await sweep(tuesday);
    expect(await whoGot("pastor_templates_waiting")).toEqual([]);
    await sweep(monday);
    expect(await whoGot("pastor_templates_waiting")).toEqual(["Mary", "Pastor2"]);
  });

  it("run every check on a busy centre without one of them failing, at every hour that matters", async () => {
    await mode("all", "on");
    const season = await k.season("Busy", -5, 12);
    const { tribe } = await k.tribe(season, { status: "submitted", coach: coach.id });
    await sql("update public.tribes set submitted_at = now() where id = $1", [tribe]);
    await interview((await applicant("Ada")).application);
    for (const at of [await when(1, 9, true), await when(3, 12), await when(4, 18), await when(5, 19), await when(6, 22), await when(7, 3), await when(30, 9, true)]) {
      const r = await sweep(at);
      expect(r.problems, at).toEqual([]);
    }
    expect(await sql("select source, message from public.notice_faults")).toEqual([]);
  });
});

describe("what the Admin pages read", () => {
  async function seed() {
    const a = await applicant("Ada", "interviewed");
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [(await k.person("Gone")).id]);
    const person = await k.person("Failing");
    await sql("insert into public.messages (centre_id, person_id, template, status, error, created_at) select centre_id, id, 'welcome', 'failed', 'x', now() - interval '1 hour' from public.people where id = $1", [person.id]);
    return a;
  }
  const keys = (r: { rows: { key: string }[] }) => r.rows.map((x) => x.key);
  const row = (r: { rows: { key: string; roles: string[] }[] }, key: string) => r.rows.find((x) => x.key === key);

  it("show an admin who is also a pastor both kinds of work in one list, each once, tagged with the roles it belongs to", async () => {
    await seed();
    const r = await call(mary, "admin_attention");
    expect(keys(r)).toEqual(expect.arrayContaining(["decisions", "data_requests", "failed_messages", "ready_made"]));
    expect(new Set(keys(r)).size).toBe(keys(r).length);
    expect(row(r, "decisions")!.roles).toEqual(["pastor"]);
    expect(row(r, "data_requests")!.roles).toEqual(["admin"]);
    expect(row(r, "failed_messages")!.roles).toEqual(["admin"]);
    expect(row(r, "ready_made")!.roles).toEqual(["pastor"]);
    expect(r.roles).toEqual(expect.arrayContaining(["admin", "pastor"]));
  });

  it("show an admin only the admin work and a pastor only the pastor work", async () => {
    await seed();
    const forAdmin = await call(admin, "admin_attention");
    expect(keys(forAdmin)).toEqual(expect.arrayContaining(["data_requests", "failed_messages"]));
    expect(keys(forAdmin)).not.toContain("decisions");
    expect(keys(forAdmin)).not.toContain("ready_made");
    const forPastor = await call(pastor, "admin_attention");
    expect(keys(forPastor)).toEqual(expect.arrayContaining(["decisions", "ready_made"]));
    expect(keys(forPastor)).not.toContain("data_requests");
    expect(keys(forPastor)).not.toContain("failed_messages");
  });

  it("tag work that two of a person's roles share with both roles, still one row", async () => {
    await seed();
    const both = await k.staff("Admindir", "admin", "director");
    const r = await call(both, "admin_attention");
    expect(row(r, "data_requests")!.roles).toEqual(["admin", "director"]);
    expect(keys(r).filter((x) => x === "data_requests")).toHaveLength(1);
  });

  it("put the urgent first, then the oldest, and never count a pastor's own application", async () => {
    const a = await seed();
    await sql("insert into public.person_roles (person_id, role, centre_id) select id, 'pastor', centre_id from public.people where id = $1", [a.id]);
    const mine = await call(a, "admin_attention");
    expect(keys(mine)).not.toContain("decisions");
    const r = await call(mary, "admin_attention");
    const urgent = r.rows.map((x: { urgent: boolean }) => x.urgent);
    expect(urgent).toEqual([...urgent].sort((x, y) => Number(y) - Number(x)));
    await sql("delete from public.person_roles where person_id = $1", [a.id]);
  });

  it("refuse anyone who is not on the office team, and a visitor", async () => {
    const leader = await k.staff("Plain", "leader");
    await expectCode(call(leader, "admin_attention"), "42501");
    await expectCode(db.asAnon((q) => q("select public.admin_attention()")), "42501");
    await expectCode(call(leader, "notice_overview"), "42501");
    await expectCode(call(leader, "notice_log"), "42501");
  });

  it("let admins and directors change a switch, log it, and refuse everyone else", async () => {
    await call(admin, "notice_set_mode", ["pastors", "rehearsal"]);
    expect((await sql("select mode from public.notice_settings where group_key = 'pastors'"))[0].mode).toBe("rehearsal");
    expect((await sql("select count(*)::int c from public.event_log where action = 'notices.mode_changed'"))[0].c).toBe(1);
    await call(director, "notice_set_mode", ["pastors", "on"]);
    await expectCode(call(pastor, "notice_set_mode", ["pastors", "off"]), "42501");
    await expectCode(call(coach, "notice_set_mode", ["pastors", "off"]), "42501");
    await expectCode(call(admin, "notice_set_mode", ["pastors", "sometimes"]), "22023");
    await expectCode(call(admin, "notice_set_mode", ["nobody", "on"]), "P0002");
    await call(admin, "notice_set_mode", ["pastors", "on"]);
    expect((await sql("select count(*)::int c from public.event_log where action = 'notices.mode_changed'"))[0].c).toBe(2);
  });

  it("show who receives each group, without the owner, and say whether each can be reached", async () => {
    const owner = await k.staff("Hiddenboss", "admin");
    await sql("update public.people set hidden = true where id = $1", [owner.id]);
    const o = await call(admin, "notice_overview");
    expect(o.can_edit).toBe(true);
    const adminGroup = o.groups.find((g: { key: string }) => g.key === "admin");
    expect(adminGroup.people.map((p: { name: string }) => p.name)).not.toContain("Hiddenboss");
    expect(adminGroup.people.length).toBeGreaterThanOrEqual(2);
    expect((await call(pastor, "notice_overview")).can_edit).toBe(false);
    await sql("delete from public.person_roles where person_id = $1", [owner.id]);
  });

  it("warn an admin of a group with nobody in it and groups still Off", async () => {
    await mode("all", "off");
    await mode("champions", "on");
    const r = await call(admin, "admin_attention");
    expect(r.notices.off).toBeGreaterThan(0);
    expect(r.notices.empty).toContainEqual({ group: "champions" });
  });

  it("let a team member choose right away, daily or weekly for the groups they receive, and nothing for others", async () => {
    const prefs = await call(mary, "my_notice_prefs");
    expect(prefs.map((p: { group: string }) => p.group)).toEqual(["admin", "pastors"]);
    await call(mary, "save_notice_pref", ["pastors", "weekly"]);
    expect((await call(mary, "my_notice_prefs")).find((p: { group: string }) => p.group === "pastors").delivery).toBe("weekly");
    await expectCode(call(mary, "save_notice_pref", ["coaches", "weekly"]), "42501");
    await expectCode(call(mary, "save_notice_pref", ["pastors", "hourly"]), "22023");
    await expectCode(call(mary, "save_notice_pref", ["leaders", "daily"]), "22023");
    const plain = await k.staff("Plain2", "leader");
    expect(await call(plain, "my_notice_prefs")).toEqual([]);
    await expectCode(call(plain, "save_notice_pref", ["pastors", "daily"]), "42501");
  });

  it("show the log with first names and no addresses", async () => {
    await on("pastors");
    const a = await applicant("Ada");
    await interview(a.application);
    await sweep(await when(1, 9));
    const log = await call(mary, "notice_log", [10]);
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toMatch(/@/);
    expect(log.map((l: { to: string }) => l.to)).toEqual(expect.arrayContaining(["Mary"]));
  });
});

describe("the app reads what the database says", () => {
  // The Admin pages read these answers with the app's own readers. A reader that expects a different shape than the database sends shows an
  // empty page, not an error, so this feeds the real answers through the real readers.
  it("makes sense of every answer the Admin pages ask for, for someone who is both an admin and a pastor", async () => {
    await on("pastors", "admin");
    await k.season("Contract Season", -10);
    const a = await applicant("Ada");
    await interview(a.application);
    await sql("insert into public.erasure_requests (person_id, centre_id, by_office) select id, centre_id, true from public.people where id = $1", [(await k.person("Gone")).id]);
    await sweep(await when(1, 9));

    const att = parseAttention(await call(mary, "admin_attention"));
    expect(att).not.toBeNull();
    expect(att!.roles).toEqual(expect.arrayContaining(["admin", "pastor"]));
    const kinds = att!.rows.map((r) => r.key);
    expect(kinds).toEqual(expect.arrayContaining(["decisions", "data_requests"]));
    for (const r of att!.rows) {
      expect(r.count).toBeGreaterThan(0);
      expect(r.roles.length).toBeGreaterThan(0);
      expect(r.href).toMatch(/^\//);
      expect(r.one.length).toBeGreaterThan(0);
    }
    expect(att!.numbers).not.toBeNull();
    expect(att!.coming.length).toBeGreaterThan(0);
    expect(att!.coming.every((c) => /opens|ends|workshop|due/i.test(c.label) && /^\d{4}-\d{2}-\d{2}$/.test(c.on))).toBe(true);
    // every row that has a page in the menu puts its count there
    const menu = menuFor(["admin", "pastor"], countsByHref(att!.rows));
    expect(menu.flatMap((s) => s.pages).find((p) => p.href === "/admin/privacy")!.count).toBeGreaterThan(0);

    const overview = parseOverview(await call(admin, "notice_overview"));
    expect(overview!.canEdit).toBe(true);
    expect(overview!.groups).toHaveLength(11);
    expect(overview!.groups.find((g) => g.key === "pastors")!.mode).toBe("on");
    expect(overview!.groups.find((g) => g.key === "pastors")!.people!.map((p) => p.name)).toEqual(expect.arrayContaining(["Mary Test", "Pastor2 Test"]));
    expect(overview!.groups.find((g) => g.key === "members")!.people).toBeNull();
    expect(overview!.numbers.length).toBeGreaterThanOrEqual(10);

    await mode("pastors", "rehearsal");
    await sql("delete from public.messages where params ? 'notice_group'");
    const b = await applicant("Bisi");
    await interview(b.application);
    await sweep(await when(2, 9));
    const log = parseLog(await call(mary, "notice_log", [20]));
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((l) => l.id.length > 8 && l.to.length > 0 && noticeTitle(l.template).length > 0)).toBe(true);
    expect(log.some((l) => l.rehearsal)).toBe(true);

    const prefs = parsePrefs(await call(mary, "my_notice_prefs"));
    expect(prefs.map((p) => p.group)).toEqual(["admin", "pastors"]);
    expect(prefs.find((p) => p.group === "admin")!.mode).toBe("on");
    expect(prefs.find((p) => p.group === "pastors")!.mode).toBe("rehearsal");
  });
});

describe("who can call what", () => {
  const internal = [
    "notify_person(uuid, text, text, text, jsonb, text, text, boolean)",
    "notice_sweep(timestamptz)",
    "notice_digest(uuid, timestamptz)",
    "notice_chk_decisions(timestamptz)",
    "notice_fault(text, text)",
    "notice_trg_application()",
  ];

  it("keep the engine away from signed-in people and visitors alike", async () => {
    for (const sig of internal) {
      for (const role of ["anon", "authenticated"]) {
        const r = await sql("select has_function_privilege($1, ('public.' || $2)::regprocedure, 'execute') as ok", [role, sig]);
        expect(r[0].ok, `${role} ${sig}`).toBe(false);
      }
    }
  });

  it("let signed-in people call the Admin page functions, and visitors none of them", async () => {
    for (const sig of ["admin_attention()", "notice_overview()", "notice_set_mode(text, text)", "notice_log(integer)", "my_notice_prefs()", "save_notice_pref(text, text)"]) {
      expect((await sql("select has_function_privilege('authenticated', ('public.' || $1)::regprocedure, 'execute') as ok", [sig]))[0].ok, sig).toBe(true);
      expect((await sql("select has_function_privilege('anon', ('public.' || $1)::regprocedure, 'execute') as ok", [sig]))[0].ok, sig).toBe(false);
    }
  });

  it("let only the sending service with its token run the sweep", async () => {
    const token = (await sql("select public.bootstrap_worker_token('notices') as t"))[0].t as string;
    await expectCode(db.asAnon((q) => q("select public.worker_notice_sweep($1)", ["x".repeat(40)])), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_notice_sweep(null)")), "42501");
    const ok = (await db.asAnon((q) => q("select public.worker_notice_sweep($1) as r", [token]))).rows[0].r;
    expect(ok).toMatchObject({ problems: [] });
    expect((await sql("select has_function_privilege('authenticated', 'public.worker_notice_sweep(text)'::regprocedure, 'execute') as ok"))[0].ok).toBe(false);
  });

  it("keep the notice tables closed: row security on, no grant to anyone", async () => {
    for (const t of ["notice_settings", "notice_prefs", "notice_items", "notice_pending", "notice_faults", "notice_numbers"]) {
      const r = await sql("select c.relrowsecurity as rls from pg_class c where c.oid = ('public.' || $1)::regclass", [t]);
      expect(r[0].rls, t).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        const g = await sql("select has_table_privilege($1, ('public.' || $2)::regclass, 'select,insert,update,delete') as ok", [role, t]);
        expect(g[0].ok, `${role} ${t}`).toBe(false);
      }
    }
  });
});
