import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wordingProblems } from "./contract";
import { expectCode, type Row, type TestDb } from "./helpers";
import { newKit, type Kit, type Person } from "./builders";

// Stage 6b: the teen track. Young people aged 13 to 17 can join a tribe only when the track has been opened on
// purpose, a parent or guardian has said yes from a private link sent to THEIR phone or email, a member of staff has
// phoned that parent or guardian to check, and the tribe is a teen tribe led by two adults. Adults and teens are
// never placed in each other's tribes. A parent or guardian can take their permission back at any time.

let db: TestDb;
let k: Kit;
let S: string;
let careLead: Person;
let director: Person;
let admin: Person;
let pastor: Person;
let coach: Person;
let adult: Person;
let teenA: Tribe; // teen tribe, two adults
let teenB: Tribe; // teen tribe, one adult only
let grown: Tribe; // an ordinary Builders tribe
let rising: Tribe; // an ordinary Rising tribe
type Tribe = Awaited<ReturnType<Kit["tribe"]>>;

beforeAll(async () => {
  ({ db, k } = await newKit());
  careLead = await k.staff("Carer", "care_lead");
  director = await k.staff("Dir", "director");
  admin = await k.staff("Adm", "admin");
  pastor = await k.staff("Pas", "pastor");
  coach = await k.staff("Coa", "coach");
  adult = await k.person("Grownup");
  S = await k.season("S", -20);
});

afterAll(async () => {
  await db.close();
});

const call = (who: Person, fn: string, params: unknown[] = []) => k.call(who.id, fn, params);
const mine = async (who: Person) => (await call(who, "my_guardian")) as Row;
const sql = (text: string, params: unknown[] = []) => k.sql(text, params);
const flag = (on: boolean) => db.admin.query("update public.platform_flags set enabled = $1 where key = 'teen_track'", [on]);
const track = (active: boolean) => db.admin.query("update public.tracks set active = $1 where slug = 'teens'", [active]);
const lastToken = async () =>
  (await sql("select params ->> 'token' as t from public.messages where template = 'guardian_request' and params ? 'token' order by created_at desc limit 1"))[0]?.t as string;
const consentOf = async (p: Person) => (await sql("select * from public.guardian_consents where person_id = $1", [p.id]))[0];
const messagesTo = (id: string, template: string) => sql("select * from public.messages where person_id = $1 and template = $2 order by created_at", [id, template]);
const teenProfile = async (name: string, o: { adjacent?: boolean } = {}) => {
  const t = await k.person(name);
  await k.profile(t.id, S, { age: "13-17", adjacent: o.adjacent });
  return t;
};
const guardianInfo = (name: string, extra: Record<string, unknown> = {}) => ({ name, relationship: "mother", email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.org`, phone: null as string | null, ...extra });
const request = (who: Person, g = guardianInfo("Mrs Okafor")) => call(who, "request_guardian_consent", [g.name, g.relationship, g.email, g.phone]);
const yes = (token: string, note: string | null = null) => k.anon("answer_guardian_request", [token, true, true, "consent-1", note]) as Promise<Row>;
const no = (token: string, note: string | null = null) => k.anon("answer_guardian_request", [token, false, null, null, note]) as Promise<Row>;
const shown = (m: Row) => (m.tribes as Row[]).map((c) => c.tribe.id);

describe("while the teen track is closed (the default)", () => {
  it("is off in a fresh database and no one can open it from the app", async () => {
    expect((await sql("select enabled from public.platform_flags where key = 'teen_track'"))[0].enabled).toBe(false);
    expect((await sql("select active from public.tracks where slug = 'teens'"))[0].active).toBe(false);
    expect(await call(adult, "teen_track_open")).toBe(false);
    await expect(db.asUser(admin.id, (q) => q("update public.platform_flags set enabled = true"))).rejects.toMatchObject({ code: "42501" });
    // an admin screen cannot switch the track on while the platform switch is off
    await expect(db.asUser(admin.id, (q) => q("update public.tracks set active = true where slug = 'teens'"))).rejects.toMatchObject({ code: "22023" });
    await expect(track(true)).rejects.toMatchObject({ code: "22023" });
  });

  it("does not accept a profile for a 13 to 17 year old", async () => {
    const t = await k.person("TooSoon");
    await expect(k.profile(t.id, S, { age: "13-17" })).rejects.toMatchObject({ code: "22023", message: expect.stringContaining("not open") });
    expect(await sql("select 1 from public.member_profiles where person_id = $1", [t.id])).toHaveLength(0);
  });

  it("asks nothing of an adult", async () => {
    await k.profile(adult.id, S, { age: "33-40" });
    expect(await mine(adult)).toMatchObject({ needed: false, state: "not_needed", track_open: false });
    await expectCode(request(adult), "22023");
    await expectCode(db.asAnon((q) => q("select public.my_guardian()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.teen_track_open()")), "42501");
  });
});

describe("opening the track", () => {
  it("needs the platform switch first, then the track", async () => {
    await flag(true);
    expect(await call(adult, "teen_track_open")).toBe(false); // the track itself is still closed
    await track(true);
    expect(await call(adult, "teen_track_open")).toBe(true);

    teenA = await k.tribe(S, { name: "Teens Alpha", track: "teens", assistant: "certified" });
    teenB = await k.tribe(S, { name: "Teens Beta", track: "teens" });
    grown = await k.tribe(S, { name: "Builders Tribe" });
    rising = await k.tribe(S, { name: "Rising Tribe", track: "rising" });
  });
});

describe("a young person before their parent or guardian has said yes", () => {
  let tolu: Person;
  beforeAll(async () => {
    tolu = await teenProfile("Tolu");
  });

  it("is told what is needed", async () => {
    expect(await mine(tolu)).toMatchObject({ needed: true, track_open: true, state: "none", can_send: true, sends_left_today: 3 });
  });

  it("cannot look at tribes or take a seat", async () => {
    await expectCode(call(tolu, "match_me", [true]), "22023");
    await expectCode(call(tolu, "choose_tribe", [teenA.tribe, true, "cov-1"]), "22023");
    expect(await sql("select 1 from public.match_runs where person_id = $1", [tolu.id])).toHaveLength(0);
    expect(await sql("select 1 from public.match_demand where person_id = $1", [tolu.id])).toHaveLength(0);
  });

  it("must give a name, who they are, and an address or number of their own for the parent or guardian", async () => {
    await expectCode(request(tolu, guardianInfo("X")), "22023");
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { relationship: "uncle" })), "22023");
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { email: null, phone: null })), "22023");
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { email: "not an email" })), "22023");
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { email: null, phone: "12345" })), "22023");
    // not their own address or number: that would let them say yes to themselves
    const me = (await sql("select email from public.people where id = $1", [tolu.id]))[0].email;
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { email: me.toUpperCase() })), "22023");
    await db.admin.query("insert into public.contact_preferences (person_id, phone) values ($1, '+2348031230001')", [tolu.id]);
    await expectCode(request(tolu, guardianInfo("Mrs Okafor", { email: null, phone: "08031230001" })), "22023");
    expect(await consentOf(tolu)).toBeUndefined();
    await db.admin.query("delete from public.contact_preferences where person_id = $1", [tolu.id]);
  });

  it("sends the request to the parent or guardian, with a private link the young person never sees", async () => {
    const s = (await request(tolu)) as Row;
    expect(s).toMatchObject({ state: "requested", guardian_name: "Mrs Okafor", relationship: "mother", can_send: true, sends_left_today: 2 });
    expect(s.sent_to).toBe("m•••@example.org"); // enough to tell it is the right one, not enough to read it
    const token = await lastToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    // nothing the young person can call or read has the link or its fingerprint
    expect(JSON.stringify(s)).not.toContain(token);
    const fingerprint = (await consentOf(tolu)).token_hash;
    expect(JSON.stringify(s)).not.toContain(fingerprint);
    expect(fingerprint).not.toBe(token);
    expect((await sql("select public.referee_token_hash($1) as h", [token]))[0].h).toBe(fingerprint);
    await expect(db.asUser(tolu.id, (q) => q("select * from public.guardian_consents"))).rejects.toMatchObject({ code: "42501" });
    await expect(db.asUser(tolu.id, (q) => q("select * from public.messages"))).rejects.toMatchObject({ code: "42501" });

    // the message goes to the parent or guardian's own address, not to the young person
    const sent = (await sql("select * from public.messages where template = 'guardian_request' order by created_at desc limit 1"))[0];
    expect(sent.person_id).toBeNull();
    expect(sent.to_email).toBe("mrs.okafor@example.org");
    expect(sent.to_name).toBe("Mrs Okafor");
    expect(sent.params).toMatchObject({ guardian: "Mrs Okafor", teen_first: "Tolu", relationship: "mother" });
    expect(await messagesTo(tolu.id, "guardian_request")).toHaveLength(0);
    expect((await sql("select meta from public.event_log where action = 'guardian.requested' and entity_id = $1", [tolu.id]))[0].meta).toEqual({});
  });

  it("can send again with a new link, three times a day; the old link stops working", async () => {
    const first = await lastToken();
    await request(tolu, guardianInfo("Mrs Okafor", { email: null, phone: "08031230002" }));
    const second = await lastToken();
    expect(second).not.toBe(first);
    expect(await k.anon("get_guardian_request", [first])).toBeNull();
    expect(await k.anon("get_guardian_request", [second])).not.toBeNull();
    expect((await consentOf(tolu)).guardian_phone).toBe("+2348031230002");
    const s = (await request(tolu)) as Row;
    expect(s.sends_left_today).toBe(0);
    expect(s.can_send).toBe(false);
    await expectCode(request(tolu), "22023");
    // a day later they can again
    await db.admin.query("update public.messages set created_at = created_at - interval '2 days' where template = 'guardian_request'");
    expect((await mine(tolu)).can_send).toBe(true);
  });

  it("is told when the link has run out, and can send a fresh one", async () => {
    await db.admin.query("update public.guardian_consents set token_expires_at = now() - interval '1 hour' where person_id = $1", [tolu.id]);
    expect(await mine(tolu)).toMatchObject({ state: "expired", can_send: true });
    const old = await lastToken();
    expect(await k.anon("get_guardian_request", [old])).toMatchObject({ expired: true });
    await expectCode(k.anon("answer_guardian_request", [old, true, true, "consent-1", null]), "22023");
    await request(tolu);
    expect((await mine(tolu)).state).toBe("requested");
  });
});

describe("the parent or guardian's page", () => {
  let tolu: Person;
  beforeAll(async () => {
    tolu = (await sql("select person_id as id from public.guardian_consents limit 1")).map((r) => ({ id: r.id, email: "" }))[0];
  });

  it("shows only the young person's first name, and only to someone with the link", async () => {
    const token = await lastToken();
    const info = (await k.anon("get_guardian_request", [token])) as Row;
    expect(info).toMatchObject({ teen_first: "Tolu", guardian: "Mrs Okafor", relationship: "mother", status: "requested", expired: false, tribe: null });
    expect(JSON.stringify(info)).not.toMatch(/Tolu Test|@example/);
    for (const bad of ["", "abc", "A".repeat(64), "z".repeat(64), "a".repeat(63), `${token}x`]) expect(await k.anon("get_guardian_request", [bad])).toBeNull();
    expect(await k.anon("get_guardian_request", ["a".repeat(64)])).toBeNull();
    expect(await k.anon("get_guardian_request", [null])).toBeNull();
    expect(tolu.id).toBeTruthy();
  });

  it("needs the box ticked, the wording version and a short note to say yes", async () => {
    const token = await lastToken();
    await expectCode(k.anon("answer_guardian_request", [token, true, null, "consent-1", null]), "22023");
    await expectCode(k.anon("answer_guardian_request", [token, true, false, "consent-1", null]), "22023");
    await expectCode(k.anon("answer_guardian_request", [token, true, true, null, null]), "22023");
    await expectCode(k.anon("answer_guardian_request", [token, true, true, "bad version!", null]), "22023");
    await expectCode(k.anon("answer_guardian_request", [token, true, true, "consent-1", "x".repeat(301)]), "22023");
    await expectCode(k.anon("answer_guardian_request", [token, null, true, "consent-1", null]), "P0002");
    await expectCode(k.anon("answer_guardian_request", ["a".repeat(64), true, true, "consent-1", null]), "P0002");
    await expectCode(k.anon("answer_guardian_request", ["not a token", true, true, "consent-1", null]), "P0002");
    expect((await sql("select status from public.guardian_consents limit 1"))[0].status).toBe("requested");
  });
});

describe("a yes", () => {
  let tolu: Person;
  beforeAll(async () => {
    tolu = { id: (await sql("select person_id from public.guardian_consents limit 1"))[0].person_id, email: "" };
  });

  it("is recorded with the wording they saw, and the Care Team is told to phone them", async () => {
    const token = await lastToken();
    const info = await yes(token, "Please can the leader be a woman?");
    expect(info.status).toBe("approved");
    expect(info.consent_version).toBe("consent-1");
    const row = await consentOf(tolu);
    expect(row).toMatchObject({ status: "approved", consent_version: "consent-1", guardian_note: "Please can the leader be a woman?", verified_at: null, answers: 1 });
    const told = await messagesTo(careLead.id, "guardian_update");
    expect(told).toHaveLength(1);
    expect(told[0].params).toEqual({ teen_first: "Tolu", what: "approved" });
    // saying it twice changes nothing
    await yes(token);
    expect((await consentOf(tolu)).answers).toBe(1);
    expect(await messagesTo(careLead.id, "guardian_update")).toHaveLength(1);
    expect(await mine(tolu)).toMatchObject({ state: "approved" });
  });

  it("is not enough by itself: a person on staff must phone first", async () => {
    await expectCode(call(tolu, "match_me", [true]), "22023");
    await expectCode(call(tolu, "choose_tribe", [teenA.tribe, true, "cov-1"]), "22023");
  });

  it("is shown to the Care Team, with the number to phone", async () => {
    for (const who of [careLead, pastor, director, admin]) {
      const o = (await call(who, "guardian_overview")) as Row;
      expect(o.track_open).toBe(true);
      expect(o.to_call).toHaveLength(1);
      expect(o.to_call[0]).toMatchObject({ person_id: tolu.id, teen: "Tolu Test", guardian: "Mrs Okafor", relationship: "mother", note: "Please can the leader be a woman?" });
      expect(o.to_call[0].email ?? o.to_call[0].phone).toBeTruthy();
      expect(o.waiting).toEqual([]);
    }
    for (const who of [coach, adult, tolu]) {
      await expectCode(call(who, "guardian_overview"), "42501");
      await expectCode(call(who, "verify_guardian", [tolu.id]), "42501");
      await expectCode(call(who, "reopen_guardian_request", [tolu.id]), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.guardian_overview()")), "42501");
  });

  it("is confirmed by a phone call, which a young person cannot do for themselves", async () => {
    await expectCode(call(careLead, "verify_guardian", [tolu.id, "x".repeat(201)]), "22023");
    await expectCode(call(careLead, "verify_guardian", [adult.id]), "P0002");
    const o = (await call(careLead, "verify_guardian", [tolu.id, "Spoke to Mrs Okafor on her own number"])) as Row;
    expect(o.to_call).toEqual([]);
    expect(o.ready).toBe(1);
    const row = await consentOf(tolu);
    expect(row.verified_by).toBe(careLead.id);
    expect(row.verified_note).toBe("Spoke to Mrs Okafor on her own number");
    expect(await mine(tolu)).toMatchObject({ state: "ready" });
    expect((await sql("select 1 from public.event_log where action = 'guardian.verified' and entity_id = $1", [tolu.id])).length).toBe(1);
  });
});

describe("matching a young person", () => {
  let tolu: Person;
  beforeAll(async () => {
    tolu = { id: (await sql("select person_id from public.guardian_consents limit 1"))[0].person_id, email: "" };
  });

  it("shows only teen tribes with two adults, never an adult tribe", async () => {
    // even a young person who said a neighbouring life stage would be fine
    await db.admin.query("update public.member_profiles set open_to_adjacent = true where person_id = $1", [tolu.id]);
    const m = (await call(tolu, "match_me", [true])) as Row;
    expect(shown(m)).toEqual([teenA.tribe]);
    const candidates = (await sql("select r_tribe from public.match_candidates($1)", [tolu.id])).map((r) => r.r_tribe);
    expect(candidates).toEqual([teenA.tribe]);
    expect(candidates).not.toContain(teenB.tribe); // one adult only
    expect(candidates).not.toContain(grown.tribe);
    expect(candidates).not.toContain(rising.tribe);
  });

  it("offers a teen tribe as soon as it has a second adult", async () => {
    await db.admin.query("update public.tribes set assistant_id = $2 where id = $1", [teenB.tribe, (await k.person("Helper")).id]);
    const candidates = (await sql("select r_tribe from public.match_candidates($1)", [tolu.id])).map((r) => r.r_tribe);
    expect(new Set(candidates)).toEqual(new Set([teenA.tribe, teenB.tribe]));
    await db.admin.query("update public.tribes set assistant_id = null where id = $1", [teenB.tribe]);
  });

  it("never offers a teen tribe to an adult, even one who would take a neighbouring life stage", async () => {
    const young = await k.person("Young");
    await k.profile(young.id, S, { age: "18-25", adjacent: true });
    const candidates = (await sql("select r_tribe from public.match_candidates($1)", [young.id])).map((r) => r.r_tribe);
    expect(candidates).toContain(rising.tribe);
    expect(candidates).toContain(grown.tribe); // the next life stage up is still fine for an adult
    expect(candidates).not.toContain(teenA.tribe);
    expect(candidates).not.toContain(teenB.tribe);
    expect(shown((await call(young, "match_me", [true])) as Row)).not.toContain(teenA.tribe);
  });

  it("seats them, and the parent or guardian can see who they will meet with", async () => {
    await call(tolu, "choose_tribe", [teenA.tribe, true, "cov-1"]);
    const token = await lastToken();
    const info = (await k.anon("get_guardian_request", [token])) as Row;
    expect(info.tribe).toMatchObject({ name: "Teens Alpha", leader: expect.any(String), assistant: expect.any(String), mode: "in_person" });
    expect(info.tribe.day).toBe(3);
    expect(info.tribe.time).toBe("20:00");
  });

  it("is flagged to the Care Team if a tribe with young people ever loses its second adult", async () => {
    await db.admin.query("update public.tribes set assistant_id = null where id = $1", [teenA.tribe]);
    const o = (await call(careLead, "guardian_overview")) as Row;
    expect(o.tribes_short).toEqual([{ id: teenA.tribe, name: "Teens Alpha", members: 1 }]);
    await db.admin.query("update public.tribes set assistant_id = $2 where id = $1", [teenA.tribe, teenA.assistant!.id]);
    expect(((await call(careLead, "guardian_overview")) as Row).tribes_short).toEqual([]);
  });
});

describe("taking permission back", () => {
  let tolu: Person;
  beforeAll(async () => {
    tolu = { id: (await sql("select person_id from public.guardian_consents limit 1"))[0].person_id, email: "" };
  });

  it("ends the seat, the same day, and tells the Care Team", async () => {
    const token = await lastToken();
    // a request to change tribe that was open goes with it
    await db.admin.query(
      `insert into public.swap_requests (person_id, season_id, from_tribe, reason, asked_by)
       values ($1, $2, $3, 'time', $1)`,
      [tolu.id, S, teenA.tribe],
    );
    const info = await no(token, "We have changed our minds");
    expect(info.status).toBe("withdrawn");
    const seat = (await sql("select status, release_reason from public.tribe_members where person_id = $1", [tolu.id]))[0];
    expect(seat).toEqual({ status: "released", release_reason: "parent or guardian withdrew permission" });
    expect((await sql("select status from public.swap_requests where person_id = $1", [tolu.id]))[0].status).toBe("withdrawn");
    expect((await sql("select chosen from public.match_recommendations where person_id = $1", [tolu.id])).every((r) => r.chosen === false)).toBe(true);
    const row = await consentOf(tolu);
    expect(row).toMatchObject({ status: "withdrawn", verified_at: null, answers: 2 });
    const told = await messagesTo(careLead.id, "guardian_update");
    expect(told.map((m) => m.params.what)).toEqual(["approved", "withdrawn"]);
    expect(await mine(tolu)).toMatchObject({ state: "withdrawn", can_send: false });
  });

  it("closes the door again until the parent or guardian says yes and is phoned again", async () => {
    await expectCode(call(tolu, "match_me", [true]), "22023");
    await expectCode(request(tolu), "22023"); // the young person cannot ask again by themselves
    const token = await lastToken();
    await yes(token);
    expect(await mine(tolu)).toMatchObject({ state: "approved" }); // not 'ready': the phone call has to be made again
    await expectCode(call(tolu, "match_me", [true]), "22023");
    await call(careLead, "verify_guardian", [tolu.id]);
    expect(((await call(tolu, "match_me", [true])) as Row).tribes.length).toBe(1);
    await call(tolu, "choose_tribe", [teenA.tribe, true, "cov-2"]);
    expect((await sql("select status from public.tribe_members where person_id = $1 and status = 'active'", [tolu.id])).length).toBe(1);
  });
});

describe("a no", () => {
  it("is final for the young person, until the Care Team opens it up again", async () => {
    const dayo = await teenProfile("Dayo");
    await request(dayo, guardianInfo("Mr Bello", { relationship: "father" }));
    const info = await no(await lastToken());
    expect(info.status).toBe("declined");
    expect(await mine(dayo)).toMatchObject({ state: "declined", can_send: false });
    await expectCode(request(dayo), "22023");
    await expectCode(call(dayo, "match_me", [true]), "22023");
    const told = await messagesTo(careLead.id, "guardian_update");
    expect(told.at(-1)!.params).toEqual({ teen_first: "Dayo", what: "declined" });
    // no seat to release
    expect(await sql("select 1 from public.tribe_members where person_id = $1", [dayo.id])).toHaveLength(0);

    const o = (await call(careLead, "guardian_overview")) as Row;
    expect((o.said_no as Row[]).map((r) => r.teen)).toContain("Dayo Test");
    await expectCode(call(careLead, "reopen_guardian_request", [adult.id]), "P0002");
    await call(director, "reopen_guardian_request", [dayo.id]);
    expect(await consentOf(dayo)).toBeUndefined();
    expect((await mine(dayo)).state).toBe("none");
    await request(dayo, guardianInfo("Mr Bello", { relationship: "father" }));
    expect((await mine(dayo)).state).toBe("requested");
  });

  it("can be changed by the parent or guardian from the same link", async () => {
    const lola = await teenProfile("Lola");
    await request(lola, guardianInfo("Mrs Ade"));
    const token = await lastToken();
    await no(token);
    const changed = await yes(token);
    expect(changed.status).toBe("approved");
    expect((await mine(lola)).state).toBe("approved");
  });

  it("is waiting, in the Care Team's list, until the parent or guardian answers", async () => {
    const o = (await call(careLead, "guardian_overview")) as Row;
    expect((o.waiting as Row[]).map((r) => r.teen)).toContain("Dayo Test");
    expect((o.waiting as Row[])[0]).toHaveProperty("expired", false);
    // cannot confirm what has not been agreed
    const dayoId = (await sql("select id from public.people where full_name = 'Dayo Test'"))[0].id;
    await expectCode(call(careLead, "verify_guardian", [dayoId]), "22023");
  });
});

describe("the link in the outbox", () => {
  it("is removed once the message has been sent or has failed, and cannot be sent again", async () => {
    const dayo = (await sql("select id from public.people where full_name = 'Dayo Test'"))[0].id;
    const queued = await sql("select id, params from public.messages where template = 'guardian_request' and params ? 'token' and to_email = 'mr.bello@example.org' order by created_at desc limit 1");
    expect(queued[0].params.token).toMatch(/^[a-f0-9]{64}$/);
    await db.admin.query("update public.messages set status = 'sent', sent_at = now() where id = $1", [queued[0].id]);
    expect((await sql("select params from public.messages where id = $1", [queued[0].id]))[0].params).toEqual({ scrubbed: true });

    await db.admin.query("update public.messages set status = 'failed' where id = $1", [queued[0].id]);
    await expectCode(db.admin.query("update public.messages set status = 'queued' where id = $1", [queued[0].id]), "22023");
    await expectCode(k.call(admin.id, "retry_message", [queued[0].id]), "22023");
    expect(dayo).toBeTruthy();
    // every other message keeps its params
    const other = await sql("select count(*)::int as n from public.messages where template = 'guardian_request' and not (params ? 'scrubbed')");
    expect(other[0].n).toBeGreaterThan(0);
  });

  it("is scrubbed from every kind of ending: failed, skipped, delivered", async () => {
    for (const status of ["failed", "skipped", "delivered"]) {
      const id = (await sql("select public.enqueue_message(null, 'guardian_request', jsonb_build_object('guardian', 'G', 'teen_first', 'T', 'token', repeat('c', 64)), null, $1, null, 'normal', null, 'g@example.org', null, 'G') as id", [`t:${status}`]))[0].id;
      await db.admin.query("update public.messages set status = $2 where id = $1", [id, status]);
      expect((await sql("select params from public.messages where id = $1", [id]))[0].params).toEqual({ scrubbed: true });
    }
  });
});

describe("keeping contact details only as long as they are needed", () => {
  it("removes a parent or guardian's details once they are no longer needed, and keeps them while a young person is in a tribe", async () => {
    const old = await teenProfile("Oldest");
    await request(old, guardianInfo("Mrs Old"));
    const tolu = (await sql("select id from public.people where full_name = 'Tolu Test'"))[0].id;
    const lola = (await sql("select id from public.people where full_name = 'Lola Test'"))[0].id;
    const dayo = (await sql("select id from public.people where full_name = 'Dayo Test'"))[0].id;
    // Tolu is in a tribe now; Lola said yes but never took a seat; Oldest never got an answer
    await db.admin.query("update public.guardian_consents set requested_at = now() - interval '300 days' where person_id = any($1)", [[tolu, lola, old.id]]);
    const removed = (await sql("select public.guardian_retention(90) as n"))[0].n;
    expect(removed).toBe(2);
    expect(await consentOf(old)).toBeUndefined();
    expect((await sql("select 1 from public.guardian_consents where person_id = $1", [lola]))).toHaveLength(0);
    expect((await sql("select 1 from public.guardian_consents where person_id = $1", [tolu]))).toHaveLength(1);
    // a recent request is kept
    expect((await sql("select 1 from public.guardian_consents where person_id = $1", [dayo]))).toHaveLength(1);
    // and no one can call it from the app
    await expect(db.asUser(admin.id, (q) => q("select public.guardian_retention(90)"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("the wording", () => {
  it("agrees with the messages the database queued", async () => {
    const rows = await sql("select * from public.messages where template in ('guardian_request', 'guardian_update')");
    expect(new Set(rows.map((r) => r.template))).toEqual(new Set(["guardian_request", "guardian_update"]));
    expect(rows.some((r) => r.params?.scrubbed)).toBe(true);
    expect(await wordingProblems(rows)).toEqual([]);
  });
});
