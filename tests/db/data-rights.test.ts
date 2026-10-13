import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// A member's own copy of their data, and the road from "please delete me" to a person being erased.

let db: TestDb;
let k: Kit;
let S: string;
let admin: { id: string; email: string };
let director: { id: string; email: string };
let pastor: { id: string; email: string };

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const call = (who: string, fn: string, ...params: unknown[]) => k.call(who, fn, params);

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id;
  admin = await k.staff("Adaeze", "admin");
  director = await k.staff("Dayo", "director");
  pastor = await k.staff("Pastor", "pastor");
});
afterAll(async () => {
  await db?.close();
});

/** A member who has done a bit of everything a member does. */
async function busyMember(name: string) {
  const { tribe, leader } = await k.tribe(S, { name: `${name} tribe` });
  const me = await k.seat(tribe, S, name);
  const friend = await k.seat(tribe, S, `${name}Friend`);
  await k.meetings(tribe, leader.id, 3, [[me.id, 3], [friend.id, 2]]);
  await k.pulse(tribe, me.id, 1, 4);
  await k.pulse(tribe, friend.id, 1, 5);
  await sql("insert into public.week_steps (person_id, tribe_id, week, when_text, will_text, outcome, reflection) values ($1, $2, 1, 'Saturday morning', 'Call my brother', 'done', 'It went well'), ($3, $2, 1, 'Sunday', 'FRIENDS-STEP-TEXT', null, null)", [me.id, tribe, friend.id]);
  await sql("insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit) values ($1, $2, 2, 'God opened a door at work that I had given up on.', 'tribe', 'first_name')", [me.id, tribe]);
  await sql("insert into public.contact_preferences (person_id, phone, preferred) values ($1, '+2348031112222', 'whatsapp')", [me.id]);
  await sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, '2026-10-v1'), ($1, 'whatsapp', true, '2026-10-v1')", [me.id]);
  await sql("insert into public.ai_calls (person_id, field, provider, model, latency_ms, fallback) values ($1, 'story', 'mock', 'm1', 40, false)", [me.id]);
  await sql("update public.member_profiles set story = 'MY-OWN-STORY', support_enc = 'sealed-support-blob', leader_note_enc = 'sealed-note-blob', ai_assist = '{\"log\":1}'::jsonb where person_id = $1", [me.id]);
  await sql("update public.member_profiles set story = 'FRIENDS-OWN-STORY' where person_id = $1", [friend.id]);
  return { tribe, leader, me, friend };
}

describe("a member's own copy of their data", () => {
  it("holds what they gave and did, and none of what belongs to someone else", async () => {
    const { me, friend } = await busyMember("Ngozi");
    const out = (await call(me.id, "export_my_data")) as Record<string, unknown>;
    const text = JSON.stringify(out);

    expect(out.you).toMatchObject({ name: "Ngozi Test", preferred_name: "Ngozi", email: me.email });
    expect(out.how_we_reach_you).toMatchObject({ phone: "+2348031112222", preferred: "whatsapp" });
    expect((out.agreements as Row[]).map((a) => a.about).sort()).toEqual(["matching", "whatsapp"]);
    expect(out.form_answers).toMatchObject({ story: "MY-OWN-STORY", zone: "mainland", community: expect.stringMatching(/Professional/) });
    expect((out.tribes as Row[])).toHaveLength(1);
    expect((out.tribes as Row[])[0]).toMatchObject({ tribe: "Ngozi tribe", degree_of_compatibility: 90 });
    expect((out.attendance as Row[]).filter((a) => a.status === "present")).toHaveLength(3);
    expect((out.weekly_check_ins as Row[])[0]).toMatchObject({ belonging: 4, week: 1 });
    expect((out.weekly_steps as Row[])[0]).toMatchObject({ what: "Call my brother", how_it_went: "done", reflection: "It went well" });
    expect((out.testimonies as Row[])[0].testimony).toMatch(/opened a door/);
    expect((out.assistant_use as Row[])[0]).toMatchObject({ field: "story", provider: "mock" });
    expect(out).toHaveProperty("held_by_the_church_team");

    // Never someone else's, and never the sealed notes or the assistant's internal log
    expect(text).not.toContain(friend.email);
    expect(text).not.toContain("FRIENDS-OWN-STORY");
    expect(text).not.toContain("FRIENDS-STEP-TEXT");
    expect(text).not.toContain("sealed-support-blob");
    expect(text).not.toContain("sealed-note-blob");
    expect(text).not.toContain("ai_assist");
    expect(text).not.toContain("support_enc");
    expect((out.form_answers as Row).private_notes_saved).toEqual({ what_would_help_care_for_you: true, note_to_your_leader: true });
  });

  it("works for someone who has done nothing yet, and says so with empty lists", async () => {
    const fresh = await k.person("Fresh");
    const out = (await call(fresh.id, "export_my_data")) as Record<string, unknown>;
    expect(out.you).toMatchObject({ email: fresh.email });
    expect(out.form_answers).toBeNull();
    expect(out.tribes).toEqual([]);
    expect(out.attendance).toEqual([]);
    expect(out.agreements).toEqual([]);
  });

  it("is for the signed-in person only", async () => {
    await expectCode(db.asAnon((q) => q("select public.export_my_data()")), "42501");
    const ghost = "00000000-0000-4000-8000-000000000001";
    await expectCode(db.asUser(ghost, (q) => q("select public.export_my_data()")), "P0002");
  });
});

describe("asking for erasure", () => {
  it("is recorded once, can be taken back, and a second ask while one is waiting changes nothing", async () => {
    const p = await k.person("Asker");
    expect(await call(p.id, "my_erasure_request")).toBeNull();
    await call(p.id, "request_erasure", "  I am leaving the church.  ");
    const first = (await call(p.id, "my_erasure_request")) as Row;
    expect(first).toMatchObject({ status: "open", note: "I am leaving the church.", by_office: false, decision_note: null });

    await sql("update public.erasure_requests set requested_at = requested_at - interval '2 days' where person_id = $1", [p.id]);
    const before = (await sql("select requested_at from public.erasure_requests where person_id = $1", [p.id]))[0].requested_at;
    await call(p.id, "request_erasure", "again");
    const after = (await sql("select requested_at, note from public.erasure_requests where person_id = $1", [p.id]))[0];
    expect(after.requested_at).toEqual(before);
    expect(after.note).toBe("I am leaving the church.");

    await call(p.id, "withdraw_erasure_request");
    expect(await call(p.id, "my_erasure_request")).toBeNull();
    expect(await sql("select 1 from public.erasure_requests where person_id = $1", [p.id])).toHaveLength(0);
  });

  it("keeps a long note out, and asks for nothing from a visitor", async () => {
    const p = await k.person("Wordy");
    await expectCode(db.asUser(p.id, (q) => q("select public.request_erasure($1)", ["x".repeat(601)])), "22023");
    await expectCode(db.asAnon((q) => q("select public.request_erasure('x')")), "42501");
    await expectCode(db.asAnon((q) => q("select public.my_erasure_request()")), "42501");
  });

  it("writes to the event log that a request was made, and nothing about who they are", async () => {
    const p = await k.person("Logged");
    await call(p.id, "request_erasure", "private reason words");
    const rows = await sql("select actor_id, entity_id, meta from public.event_log where action = 'erasure.requested' and entity_id = $1", [p.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toEqual({});
    expect(JSON.stringify(rows)).not.toContain("private reason words");
  });
});

describe("the office's queue", () => {
  it("is open to an admin or director and to nobody else", async () => {
    const asker = await k.person("Queued");
    await call(asker.id, "request_erasure", "Please.");
    for (const who of [admin, director]) {
      const queue = (await call(who.id, "erasure_queue")) as Row[];
      const mine = queue.find((r) => r.person === asker.id)!;
      expect(mine).toMatchObject({ name: "Queued Test", email: asker.email, status: "open", note: "Please.", by_office: false, blockers: [] });
    }
    for (const who of [pastor, asker, await k.staff("Coach", "coach"), await k.staff("Care", "care_lead"), await k.staff("Data", "data_lead")]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.erasure_queue()")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.erasure_queue()")), "42501");
  });

  it("says what the erasure would touch and what stands in the way", async () => {
    const { leader } = await k.tribe(S, { name: "Led tribe" });
    await call(leader.id, "request_erasure", null);
    await call(pastor.id, "request_erasure", null);
    const queue = (await call(admin.id, "erasure_queue")) as Row[];
    expect(queue.find((r) => r.person === leader.id)!.blockers).toEqual(["leads_a_tribe"]);
    expect(queue.find((r) => r.person === leader.id)!.roles).toEqual(["leader"]);
    expect(queue.find((r) => r.person === pastor.id)!.roles).toEqual(["pastor"]);
    // A director sees that this one needs an admin
    const asDirector = (await call(director.id, "erasure_queue")) as Row[];
    expect(asDirector.find((r) => r.person === pastor.id)!.blockers).toEqual(["needs_an_admin"]);
    await call(leader.id, "withdraw_erasure_request");
    await call(pastor.id, "withdraw_erasure_request");
  });

  it("lets the office write down a request made another way, by email address", async () => {
    const p = await k.person("Emailed");
    await call(admin.id, "record_erasure_request", `  ${p.email.toUpperCase()} `, "Asked by email on Monday");
    const mine = ((await call(admin.id, "erasure_queue")) as Row[]).find((r) => r.person === p.id)!;
    expect(mine).toMatchObject({ status: "open", by_office: true, note: "Asked by email on Monday" });
    await expectCode(db.asUser(admin.id, (q) => q("select public.record_erasure_request($1, null)", ["nobody@example.org"])), "P0002");
    await expectCode(db.asUser(p.id, (q) => q("select public.record_erasure_request($1, null)", [p.email])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.record_erasure_request($1, null)", [p.email])), "42501");
  });
});

describe("saying no", () => {
  it("needs a reason the member can read, and lets them ask again", async () => {
    const p = await k.person("Declined");
    await call(p.id, "request_erasure", "Delete me");
    await expectCode(db.asUser(admin.id, (q) => q("select public.decline_erasure($1, '')", [p.id])), "22023");
    await expectCode(db.asUser(p.id, (q) => q("select public.decline_erasure($1, 'I decline myself')", [p.id])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.decline_erasure($1, 'Not my call')", [p.id])), "42501");
    await call(director.id, "decline_erasure", p.id, "We hold a safeguarding record we are required to keep for now. Write to the data protection lead.");

    expect(await call(p.id, "my_erasure_request")).toMatchObject({ status: "declined", decision_note: expect.stringMatching(/safeguarding record/) });
    // Declined requests stay in the queue below the open ones, and cannot be erased
    const queue = (await call(admin.id, "erasure_queue")) as Row[];
    expect(queue.find((r) => r.person === p.id)!.status).toBe("declined");
    await expectCode(db.asUser(admin.id, (q) => q("select public.erase_person($1)", [p.id])), "P0002");
    await expectCode(db.asUser(admin.id, (q) => q("select public.decline_erasure($1, 'Again, no')", [p.id])), "P0002");

    await call(p.id, "request_erasure", "I would still like this done");
    const again = (await call(p.id, "my_erasure_request")) as Row;
    expect(again).toMatchObject({ status: "open", note: "I would still like this done", decision_note: null, decided_at: null });
  });
});

describe("erasing a person", () => {
  it("removes everything about them, leaves everyone else's record whole, and keeps only that it happened", async () => {
    const { tribe, leader, me, friend } = await busyMember("Leaving");
    await sql("insert into public.celebrations (tribe_id, week, kind, person_id, note, created_by, key) values ($1, 1, 'milestone', $2, 'Leaving got promoted', $3, 'k1')", [tribe, me.id, leader.id]);
    await sql("insert into public.prayer_requests (tribe_id, week, body, created_by) values ($1, 1, 'Pray for Leaving at work', $2), ($1, 1, 'Pray for the friend', $3)", [tribe, me.id, friend.id]);
    await sql("insert into public.invitations (email, role, centre_id, invited_by, status, expires_at) values ($1, 'coach', $2, $3, 'pending', now() + interval '7 days')", [me.email, k.centreId, admin.id]);
    await sql("insert into public.messages (to_email, to_name, template, status, channel, params) values ($1, 'Leaving', 'reference_request', 'sent', 'email', '{}'::jsonb)", [me.email]);
    await call(me.id, "request_erasure", "Please delete my account");

    const result = (await call(admin.id, "erase_person", me.id)) as Row;
    expect(result).toEqual({ erased: true });

    // Gone: the sign-in account, the person, and every row that pointed at them
    expect(await sql("select 1 from auth.users where id = $1", [me.id])).toHaveLength(0);
    expect(await sql("select 1 from public.people where id = $1", [me.id])).toHaveLength(0);
    const links = await sql(
      `select c.conrelid::regclass::text as child, a.attname as col
         from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.confrelid = 'public.people'::regclass`,
    );
    expect(links.length).toBeGreaterThan(40);
    for (const l of links) {
      const n = Number((await sql(`select count(*)::int as n from ${l.child} where ${l.col} = $1`, [me.id]))[0].n);
      expect({ table: l.child, column: l.col, rows: n }).toEqual({ table: l.child, column: l.col, rows: 0 });
    }
    // Written about them, with only the name taken out: removed too
    expect(await sql("select 1 from public.celebrations where note like '%Leaving%'")).toHaveLength(0);
    expect(await sql("select 1 from public.prayer_requests where body like '%Leaving%'")).toHaveLength(0);
    expect(await sql("select 1 from public.invitations where lower(email) = lower($1)", [me.email])).toHaveLength(0);
    expect(await sql("select 1 from public.messages where lower(to_email) = lower($1)", [me.email])).toHaveLength(0);

    // Not touched: the tribe, its leader, the friend and what they wrote
    expect(await sql("select 1 from public.tribes where id = $1", [tribe])).toHaveLength(1);
    expect(await sql("select 1 from public.people where id = $1", [leader.id])).toHaveLength(1);
    expect((await sql("select story from public.member_profiles where person_id = $1", [friend.id]))[0].story).toBe("FRIENDS-OWN-STORY");
    expect(await sql("select 1 from public.tribe_attendance where person_id = $1", [friend.id])).toHaveLength(3);
    expect(await sql("select 1 from public.week_steps where person_id = $1", [friend.id])).toHaveLength(1);
    expect(await sql("select 1 from public.prayer_requests where body = 'Pray for the friend'")).toHaveLength(1);

    // What is kept: that it happened, and when, and who did it. Nothing about who the person was.
    const events = await sql("select actor_id, meta from public.event_log where action = 'person.erased' and entity_id = $1", [me.id]);
    expect(events).toEqual([{ actor_id: admin.id, meta: { asked_by_office: false } }]);
    const everything = JSON.stringify(await sql("select * from public.event_log"));
    expect(everything).not.toContain(me.email);
    expect(everything).not.toContain("Leaving Test");
    // ...and the person can no longer ask for anything
    await expectCode(db.asUser(me.id, (q) => q("select public.export_my_data()")), "P0002");
  });

  it("will not erase without an open request, or by anyone who is not an admin or director", async () => {
    const p = await k.person("NoRequest");
    await expectCode(db.asUser(admin.id, (q) => q("select public.erase_person($1)", [p.id])), "P0002");
    await call(p.id, "request_erasure", null);
    for (const who of [p, pastor, await k.staff("Coach2", "coach")]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.erase_person($1)", [p.id])), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.erase_person($1)", [p.id])), "42501");
    expect(await sql("select 1 from public.people where id = $1", [p.id])).toHaveLength(1);
    // A director can
    expect(await call(director.id, "erase_person", p.id)).toEqual({ erased: true });
    expect(await sql("select 1 from public.people where id = $1", [p.id])).toHaveLength(0);
  });

  it("refuses to erase someone who leads a tribe, until the tribe has another leader", async () => {
    const { leader, tribe } = await k.tribe(S, { name: "Orphan tribe" });
    const member = await k.seat(tribe, S, "Stays");
    await call(leader.id, "request_erasure", null);
    await expectCode(db.asUser(admin.id, (q) => q("select public.erase_person($1)", [leader.id])), "22023");
    expect(await sql("select 1 from public.tribes where id = $1", [tribe])).toHaveLength(1);
    expect(await sql("select 1 from public.tribe_members where person_id = $1", [member.id])).toHaveLength(1);
    // Once the tribe has a different leader, it goes ahead and the tribe is untouched
    const other = await k.staff("NewLeader", "leader");
    await sql("update public.tribes set leader_id = $2 where id = $1", [tribe, other.id]);
    expect(await call(admin.id, "erase_person", leader.id)).toEqual({ erased: true });
    expect(await sql("select 1 from public.tribes where id = $1", [tribe])).toHaveLength(1);
    expect(await sql("select 1 from public.tribe_members where person_id = $1", [member.id])).toHaveLength(1);
  });

  it("will not let someone erase their own account, and keeps the top roles for an admin", async () => {
    const admin2 = await k.staff("Second", "admin");
    await call(admin2.id, "request_erasure", null);
    await expectCode(db.asUser(admin2.id, (q) => q("select public.erase_person($1)", [admin2.id])), "22023");
    await expectCode(db.asUser(director.id, (q) => q("select public.erase_person($1)", [admin2.id])), "42501");

    const pastor2 = await k.staff("Pastor2", "pastor");
    await call(pastor2.id, "request_erasure", null);
    await expectCode(db.asUser(director.id, (q) => q("select public.erase_person($1)", [pastor2.id])), "42501");
    expect(await call(admin.id, "erase_person", pastor2.id)).toEqual({ erased: true });

    // An admin can erase another admin, and an admin always remains
    expect(await call(admin.id, "erase_person", admin2.id)).toEqual({ erased: true });
    expect((await sql("select count(*)::int as n from public.person_roles where role = 'admin'"))[0].n).toBeGreaterThanOrEqual(1);
  });

  it("takes a referee's name and contact off the references they gave for others, and leaves the ratings", async () => {
    const applicant = await k.person("Applicant");
    const referee = await k.person("Referee");
    const app = (await sql("insert into public.leader_applications (person_id, status, answers, consent_version, submitted_at) values ($1, 'submitted', '{}'::jsonb, '2026-10-v1', now()) returning id", [applicant.id]))[0].id;
    const ref = (await sql(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at, submitted_at)
       values ($1, 1, 'Referee Test', 'Unit head', $2, true, 'h-' || gen_random_uuid(), now() + interval '30 days', now()) returning id`,
      [app, referee.email],
    ))[0].id;
    await sql("insert into public.leader_reference_answers (reference_id, reliability, warmth, confidentiality, maturity, concern) values ($1, 5, 4, 5, 4, false)", [ref]);

    await call(referee.id, "request_erasure", null);
    await call(admin.id, "erase_person", referee.id);
    const row = (await sql("select referee_name, contact from public.leader_references where id = $1", [ref]))[0];
    expect(row).toEqual({ referee_name: "Former referee", contact: "erased" });
    expect((await sql("select reliability from public.leader_reference_answers where reference_id = $1", [ref]))[0].reliability).toBe(5);
  });
});

describe("who can reach what", () => {
  it("keeps the table behind the functions, and everything callable by a signed-in person only", async () => {
    const u = await k.person("Poker");
    await expectCode(db.asUser(u.id, (q) => q("select * from public.erasure_requests")), "42501");
    await expectCode(db.asUser(u.id, (q) => q("select public.erasure_blockers($1, $1)", [u.id])), "42501");
    for (const fn of ["export_my_data()", "my_erasure_request()", "withdraw_erasure_request()", "erasure_queue()"]) {
      await expectCode(db.asAnon((q) => q(`select public.${fn}`)), "42501");
    }
  });
});
