import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// The platform owner: one hidden account that, once unlocked, can open and change everything, and that nobody below can
// see, find, count, name or promote.

let db: TestDb;
let k: Kit;
let S: string;
let admin: { id: string; email: string };
let director: { id: string; email: string };
let pastor: { id: string; email: string };
let member: { id: string; email: string };
let owner: { id: string; email: string };
let tribe: string;

const PHRASE = "river-lantern-mango-cobalt";
const ALL_ROLES = ["member", "leader", "assistant_leader", "coach", "community_champion", "care_lead", "data_lead", "director", "pastor", "admin"];

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const call = (who: string, fn: string, ...params: unknown[]) => k.call(who, fn, params);
/** As the owner, on a given sign-in session. */
const asOwner = <T,>(session: string, fn: Parameters<typeof db.asUser<T>>[1]) => db.asUser(owner.id, fn, { session });
const callAs = (session: string, fn: string, ...params: unknown[]) =>
  asOwner(session, async (q) => (await q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params)).rows[0]?.r);

/** The pg driver hands back an array of enum values as text, "{member,admin}". */
const roles = (value: unknown): string[] => String(value).replace(/[{}]/g, "").split(",").filter(Boolean).sort();
const SORTED_ALL = ALL_ROLES.slice().sort();

/** Runs SQL as the database owner but with a person's token, for the internal functions that no API caller can reach. */
async function asSuper<T>(userId: string, session: string | null, text: string, params: unknown[] = []): Promise<T> {
  await db.admin.query("begin");
  try {
    await db.admin.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [userId, session ? JSON.stringify({ sub: userId, session_id: session }) : ""]);
    const r = (await db.admin.query(text, params)).rows[0]?.r as T;
    await db.admin.query("commit");
    return r;
  } catch (e) {
    await db.admin.query("rollback");
    throw e;
  }
}

const SESSION = randomUUID();
const OTHER_SESSION = randomUUID();

async function unlock(session = SESSION, phrase = PHRASE) {
  return (await callAs(session, "god_unlock", phrase)) as Row;
}

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  S = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id;
  admin = await k.staff("Adaeze", "admin");
  director = await k.staff("Dayo", "director");
  pastor = await k.staff("Pastor", "pastor");
  member = await k.person("Ngozi");
  const made = await k.tribe(S, { name: "Lagos Builders" });
  tribe = made.tribe;
  await k.seat(tribe, S, "Seun");

  // The owner signs in once like anyone, then the installer sets them from the SQL editor.
  owner = await db.createUser({ email: "owner@example.org" });
  await sql("update public.people set full_name = 'The Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
});
afterAll(async () => {
  await db?.close();
});

describe("setting the owner", () => {
  it("refuses a short passphrase, an unknown address, and an account that is already part of the programme", async () => {
    await expectCode(db.admin.query("select public.bootstrap_platform_owner($1, 'short')", [owner.email]), "22023");
    await expectCode(db.admin.query("select public.bootstrap_platform_owner('nobody@example.org', $1)", [PHRASE]), "P0002");
    await expectCode(db.admin.query("select public.bootstrap_platform_owner($1, $2)", [admin.email, PHRASE]), "22023");
    await expectCode(db.admin.query("select public.bootstrap_platform_owner($1, $2)", [(await sql("select email from public.people where id = $1", [(await k.sql("select leader_id from public.tribes where id = $1", [tribe]))[0].leader_id]))[0].email, PHRASE]), "22023");
    const unverified = await db.createUser({ email: "unverified@example.org", confirmed: false });
    await expectCode(db.admin.query("select public.bootstrap_platform_owner($1, $2)", [unverified.email, PHRASE]), "P0002");
  });

  it("can only be done by the database owner, never through the API", async () => {
    await expectCode(db.asUser(admin.id, (q) => q("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE])), "42501");
    await expectCode(db.asUser(owner.id, (q) => q("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE])), "42501");
    await expectCode(db.asAnon((q) => q("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE])), "42501");
    await expectCode(db.asUser(admin.id, (q) => q("select public.remove_platform_owner()")), "42501");
    await expectCode(db.asUser(admin.id, (q) => q("select * from public.platform_owner")), "42501");
    await expectCode(db.asUser(admin.id, (q) => q("select * from public.god_log")), "42501");
  });

  it("sets one owner, keeps only a hash of the passphrase, and refuses a second", async () => {
    const said = (await sql("select public.bootstrap_platform_owner($1, $2) as r", [owner.email, PHRASE]))[0].r as string;
    expect(said).toMatch(/Platform owner set/);

    const row = (await sql("select person_id, phrase_hash from public.platform_owner"))[0];
    expect(row.person_id).toBe(owner.id);
    expect(row.phrase_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(row.phrase_hash).not.toContain(PHRASE);
    expect((await sql("select hidden from public.people where id = $1", [owner.id]))[0].hidden).toBe(true);
    expect(await sql("select 1 from public.person_roles where person_id = $1", [owner.id])).toHaveLength(0);

    await expectCode(db.admin.query("select public.bootstrap_platform_owner($1, $2)", [admin.email, PHRASE]), "23505");
    // The table itself cannot hold a second row.
    await expectCode(db.admin.query("insert into public.platform_owner (singleton, person_id, phrase_hash) values (false, $1, 'x')", [admin.id]), "23514");
    await expectCode(db.admin.query("insert into public.platform_owner (person_id, phrase_hash) values ($1, 'x')", [admin.id]), "23505");
  });

  it("cannot have its account deleted from under it, and takes no roles", async () => {
    await expectCode(db.admin.query("delete from auth.users where id = $1", [owner.id]), "23503");
    await db.grant(owner.id, "admin");
    await db.grant(owner.id, "member");
    expect(await sql("select 1 from public.person_roles where person_id = $1", [owner.id])).toHaveLength(0);
  });
});

describe("before the passphrase the owner is nobody", () => {
  it("has no roles, no powers and no console", async () => {
    expect(roles(await call(owner.id, "my_roles"))).toEqual([]);
    expect(await call(owner.id, "has_any_role", ["admin"])).toBe(false);
    expect(await call(owner.id, "god_state")).toBe("locked");
    await expectCode(callAs(SESSION, "god_overview"), "42501");
    await expectCode(callAs(SESSION, "god_feed"), "42501");
    await expectCode(callAs(SESSION, "intake_stats"), "42501");
    await expectCode(db.asUser(owner.id, (q) => q("select * from public.event_log")), "42501").catch(async () => {
      // Reading the log needs a role; with none, the table shows nothing rather than failing.
      const rows = (await db.asUser(owner.id, (q) => q("select * from public.event_log"))).rows;
      expect(rows).toHaveLength(0);
    });
  });

  it("says the same to everyone else: there is nothing here", async () => {
    for (const who of [admin, director, pastor, member]) {
      expect(await call(who.id, "god_state")).toBe("none");
      await expectCode(db.asUser(who.id, (q) => q("select public.god_overview()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.god_feed()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.god_people()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.god_log_list()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.god_set_phrase('a', 'b')")), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.god_state()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.god_unlock('x')")), "42501");
  });
});

describe("the passphrase", () => {
  it("counts wrong tries, locks after five, and keeps the count even though the answer is a refusal", async () => {
    let r = (await unlock(SESSION, "wrong-guess-number-one")) as Row;
    expect(r).toMatchObject({ ok: false, reason: "wrong", tries_left: 4 });
    expect((await sql("select failed_tries from public.platform_owner"))[0].failed_tries).toBe(1);
    for (let i = 0; i < 3; i++) await unlock(SESSION, `wrong-guess-${i}-again`);
    r = await unlock(SESSION, "wrong-guess-number-five");
    expect(r).toMatchObject({ ok: false, reason: "wrong", tries_left: 0 });
    expect((await sql("select locked_until > now() as locked from public.platform_owner"))[0].locked).toBe(true);

    // The right passphrase does not open a locked door.
    r = await unlock();
    expect(r).toMatchObject({ ok: false, reason: "locked" });
    expect(r.message).toMatch(/Too many tries/);
    expect(await call(owner.id, "god_state")).toBe("locked");

    // Time passes (a person at the database lifts the lock): the count is still there, so the next wrong try locks again.
    await sql("update public.platform_owner set locked_until = now() - interval '1 minute'");
    r = await unlock(SESSION, "wrong-guess-six");
    expect(r.ok).toBe(false);
    expect((await sql("select locked_until > now() as locked from public.platform_owner"))[0].locked).toBe(true);
    expect((await sql("select failed_tries from public.platform_owner"))[0].failed_tries).toBe(6);
    await sql("update public.platform_owner set locked_until = null");
  });

  it("opens with the right passphrase, resets the count, and writes every try down", async () => {
    const r = await unlock();
    expect(r.ok).toBe(true);
    expect((await sql("select failed_tries, locked_until from public.platform_owner"))[0]).toMatchObject({ failed_tries: 0, locked_until: null });
    expect(await call(owner.id, "god_state")).toBe("locked"); // no session in this call: not open here
    expect(await callAs(SESSION, "god_state")).toBe("open");

    const log = (await callAs(SESSION, "god_log_list")) as Row[];
    const kinds = log.map((l) => l.kind);
    expect(kinds).toContain("wrong");
    expect(kinds).toContain("unlock");
    expect(kinds).toContain("refused");
    expect(kinds).toContain("owner_set");
    // Nothing in the record holds a passphrase.
    expect(JSON.stringify(log)).not.toContain(PHRASE);
    expect(JSON.stringify(log)).not.toContain("wrong-guess");
  });

  it("is bound to the one sign-in it was given on, and ends on time or on request", async () => {
    expect(roles(await callAs(SESSION, "my_roles"))).toEqual(SORTED_ALL);
    // Another sign-in of the same account, a token with no session, and a stale one are all still nobody.
    expect(roles(await callAs(OTHER_SESSION, "my_roles"))).toEqual([]);
    expect(await callAs(OTHER_SESSION, "god_state")).toBe("locked");
    expect(roles(await call(owner.id, "my_roles"))).toEqual([]);

    await sql("update public.platform_owner set unlocked_until = now() - interval '1 second'");
    expect(roles(await callAs(SESSION, "my_roles"))).toEqual([]);
    expect(await callAs(SESSION, "god_state")).toBe("locked");

    await unlock();
    expect(await callAs(SESSION, "god_state")).toBe("open");
    await callAs(SESSION, "god_lock");
    expect(await callAs(SESSION, "god_state")).toBe("locked");
    expect(roles(await callAs(SESSION, "my_roles"))).toEqual([]);
  });

  it("is asked of nobody else: a stranger's attempt looks like a wrong passphrase and is noted for the owner", async () => {
    const r = (await call(admin.id, "god_unlock", PHRASE)) as Row;
    expect(r).toMatchObject({ ok: false, reason: "wrong", message: "That did not work." });
    expect(r.tries_left).toBeUndefined();
    expect(await call(admin.id, "god_state")).toBe("none");
    // Even the right passphrase from the wrong account does nothing.
    expect(roles(await call(admin.id, "my_roles"))).toEqual(["admin", "member"]);

    await unlock();
    const log = (await callAs(SESSION, "god_log_list")) as Row[];
    const probes = log.filter((l) => l.kind === "probe");
    expect(probes).toHaveLength(1);
    expect(probes[0].detail.person).toBe("Adaeze Test");
    // And a stranger trying again at once does not fill the record.
    await call(admin.id, "god_unlock", "again");
    expect(((await callAs(SESSION, "god_log_list")) as Row[]).filter((l) => l.kind === "probe")).toHaveLength(1);
  });

  it("can be changed from inside, with the old one, and the old one stops working", async () => {
    await unlock();
    expect(await callAs(SESSION, "god_set_phrase", "not-the-old-one", "brand-new-phrase-here")).toMatchObject({ ok: false });
    expect(await callAs(SESSION, "god_set_phrase", PHRASE, "short")).toMatchObject({ ok: false });
    expect(await callAs(SESSION, "god_set_phrase", PHRASE, PHRASE)).toMatchObject({ ok: false });
    expect(await callAs(SESSION, "god_set_phrase", PHRASE, "brand-new-phrase-here")).toMatchObject({ ok: true });

    await callAs(SESSION, "god_lock");
    expect(await unlock(SESSION, PHRASE)).toMatchObject({ ok: false });
    expect(await unlock(SESSION, "brand-new-phrase-here")).toMatchObject({ ok: true });
    // Put it back for the tests that follow.
    await callAs(SESSION, "god_set_phrase", "brand-new-phrase-here", PHRASE);
    await callAs(SESSION, "god_lock");
    expect(await unlock()).toMatchObject({ ok: true });
  });
});

describe("above every role", () => {
  it("passes every role check and every office function, and reads what the office reads", async () => {
    expect(await callAs(SESSION, "has_any_role", ["pastor"])).toBe(true);
    expect(await callAs(SESSION, "has_any_role", ["care_lead", "data_lead"])).toBe(true);
    expect(await callAs(SESSION, "has_role", "admin")).toBe(true);

    const stats = (await callAs(SESSION, "intake_stats")) as Row;
    expect(stats.members).toBeGreaterThan(0);
    await callAs(SESSION, "launch_checklist");
    await callAs(SESSION, "platform_status");
    await callAs(SESSION, "erasure_queue");
    await callAs(SESSION, "review_queue");
    await callAs(SESSION, "tribe_queue");

    const people = await asOwner(SESSION, (q) => q("select id from public.people"));
    expect(people.rows.map((r) => r.id)).toContain(member.id);
    expect(people.rows.map((r) => r.id)).toContain(admin.id);
    const events = await asOwner(SESSION, (q) => q("select count(*)::int as n from public.event_log"));
    expect(events.rows[0].n).toBeGreaterThan(0);
    const tribes = await asOwner(SESSION, (q) => q("select id from public.tribes"));
    expect(tribes.rows.map((r) => r.id)).toContain(tribe);
    expect(await asSuper<boolean>(owner.id, SESSION, "select public.can_lead_tribe($1) as r", [tribe])).toBe(true);
    expect(await asSuper<boolean>(member.id, SESSION, "select public.can_lead_tribe($1) as r", [tribe])).toBe(false);
  });

  it("can give and take away any role, including admin, through the same office functions", async () => {
    const helper = await k.person("Helper");
    const res = (await callAs(SESSION, "invite_person", helper.email, "admin")) as Row;
    expect(res.granted_now).toBe(true);
    expect(roles(await call(helper.id, "my_roles"))).toContain("admin");
    await callAs(SESSION, "revoke_role", helper.id, "admin");
    expect(roles(await call(helper.id, "my_roles"))).not.toContain("admin");
  });

  it("does not change what anyone else can do", async () => {
    expect(roles(await call(admin.id, "my_roles"))).toEqual(["admin", "member"]);
    expect(await call(member.id, "has_any_role", ["admin"])).toBe(false);
    await expectCode(db.asUser(member.id, (q) => q("select public.intake_stats()")), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.erasure_queue()")), "42501");
  });
});

describe("nobody below can see the owner", () => {
  it("is not in any list the office can read, and not found by search", async () => {
    for (const who of [admin, director]) {
      const rows = (await db.asUser(who.id, (q) => q("select id, email from public.people"))).rows;
      expect(rows.map((r) => r.id)).not.toContain(owner.id);
      expect(rows.map((r) => r.email)).not.toContain(owner.email);
      expect(rows.length).toBeGreaterThan(3);
    }
    expect(await call(admin.id, "find_people", "owner")).toEqual([]);
    expect(await call(admin.id, "find_people", "example.org")).toSatisfy((r: Row[]) => r.every((p) => p.id !== owner.id));
    expect((await db.asUser(admin.id, (q) => q("select * from public.person_roles where person_id = $1", [owner.id]))).rows).toHaveLength(0);
    expect((await db.asUser(admin.id, (q) => q("select * from public.people where id = $1", [owner.id]))).rows).toHaveLength(0);
  });

  it("is not counted as a member", async () => {
    const total = Number((await sql("select count(*) as n from public.people where not hidden"))[0].n);
    const seen = ((await call(admin.id, "intake_stats")) as Row).members;
    expect(seen).toBe(total);
    expect(total).toBe(Number((await sql("select count(*) as n from public.people"))[0].n) - 1);
  });

  it("has only ever one name for everyone else: the office", async () => {
    const name = (who: string, session: string | null, fn: string, of: string) => asSuper<string>(who, session, `select public.${fn}($1) as r`, [of]);
    expect(await name(admin.id, null, "person_display_name", owner.id)).toBe("The office");
    expect(await name(member.id, null, "first_name_of", owner.id)).toBe("The office");
    expect(await name(owner.id, SESSION, "person_display_name", owner.id)).toBe("The Owner");
    expect(await name(owner.id, null, "person_display_name", owner.id)).toBe("The office");
    expect(await name(admin.id, null, "person_display_name", member.id)).toBe("Ngozi Test");
  });

  it("is not found by an invitation, and cannot be given a role by one", async () => {
    const r = (await call(admin.id, "invite_person", owner.email, "director")) as Row;
    // Exactly what an address that has not signed in yet looks like.
    expect(r).toMatchObject({ status: "pending", granted_now: false });
    expect(await sql("select 1 from public.person_roles where person_id = $1", [owner.id])).toHaveLength(0);
    // When the owner signs in next, the waiting invitation finds nothing it may give.
    await db.asUser(owner.id, (q) => q("select public.claim_invitations()"));
    expect(await sql("select 1 from public.person_roles where person_id = $1", [owner.id])).toHaveLength(0);
  });

  it("cannot be asked about for erasure, and cannot be erased", async () => {
    await expectCode(db.asUser(admin.id, (q) => q("select public.record_erasure_request($1, 'please')", [owner.email])), "P0002");
    await sql("insert into public.erasure_requests (person_id, centre_id, status, by_office) select $1, centre_id, 'open', true from public.people where id = $1", [owner.id]);
    await expectCode(db.asUser(admin.id, (q) => q("select public.erase_person($1)", [owner.id])), "P0002");
    expect(await sql("select 1 from public.people where id = $1", [owner.id])).toHaveLength(1);
    await sql("delete from public.erasure_requests where person_id = $1", [owner.id]);
  });

  it("acts without leaving a name: the event log shows no one, the owner's own record shows everything", async () => {
    await unlock();
    const before = ((await callAs(SESSION, "god_log_list")) as Row[]).filter((l) => l.kind === "action").length;
    await callAs(SESSION, "invite_person", "someone.new@example.org", "coach");

    const events = await sql("select actor_id, action from public.event_log where action = 'invitation.created' order by id desc limit 1");
    expect(events[0].actor_id).toBeNull();
    // The office reads the same log and finds nobody to blame, and nothing that is the owner's.
    const seen = (await db.asUser(admin.id, (q) => q("select actor_id from public.event_log where actor_id = $1", [owner.id]))).rows;
    expect(seen).toHaveLength(0);

    const after = ((await callAs(SESSION, "god_log_list")) as Row[]).filter((l) => l.kind === "action");
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ action: "invitation.created" });
    // The same call by an ordinary admin is recorded under their name, as before.
    await call(admin.id, "invite_person", "second.new@example.org", "coach");
    const ordinary = await sql("select actor_id from public.event_log where action = 'invitation.created' order by id desc limit 1");
    expect(ordinary[0].actor_id).toBe(admin.id);
  });
});

describe("the console", () => {
  it("shows what the platform is doing right now", async () => {
    await unlock();
    const o = (await callAs(SESSION, "god_overview")) as Row;
    expect(o.people.total).toBe(Number((await sql("select count(*) as n from public.people where not hidden"))[0].n));
    expect(o.tribes.approved).toBeGreaterThanOrEqual(1);
    expect(o.seats).toBeGreaterThanOrEqual(1);
    expect(o).toHaveProperty("messages.queued");
    expect(o).toHaveProperty("assistant.calls_24h");
    expect(o).toHaveProperty("attempts.wrong_7d");
    expect(new Date(o.open_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("lists everything that happened, with names, newest first, and can be searched and paged", async () => {
    await call(member.id, "log_event", "page.opened", "page", "home");
    const feed = (await callAs(SESSION, "god_feed", 50)) as Row[];
    expect(feed.length).toBeGreaterThan(5);
    expect(feed[0].id).toBeGreaterThan(feed[feed.length - 1].id);
    const opened = feed.find((e) => e.action === "page.opened");
    expect(opened).toMatchObject({ actor_name: "Ngozi Test", entity: "page" });
    const created = feed.find((e) => e.action === "person.created" && e.subject_name);
    expect(created?.subject_name).toBeTruthy();
    // Never the owner: not as a subject and not as an actor.
    expect(JSON.stringify(feed)).not.toContain(owner.email);

    const only = (await callAs(SESSION, "god_feed", 50, null, "page.")) as Row[];
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((e) => e.action.startsWith("page."))).toBe(true);
    const older = (await callAs(SESSION, "god_feed", 3, feed[3].id)) as Row[];
    expect(older.every((e) => e.id < feed[3].id)).toBe(true);
  });

  it("finds anyone, shows where they are in the programme, and never the owner", async () => {
    const all = (await callAs(SESSION, "god_people", null, 200)) as Row;
    const ids = (all.people as Row[]).map((p) => p.id);
    expect(ids).toContain(member.id);
    expect(ids).not.toContain(owner.id);
    expect(all.total).toBe(ids.length);

    const found = (await callAs(SESSION, "god_people", "ngozi")) as Row;
    expect(found.people).toHaveLength(1);
    expect(found.people[0]).toMatchObject({ id: member.id, form: "new" });
    const adminRow = (all.people as Row[]).find((p) => p.id === admin.id)!;
    expect(adminRow.roles).toEqual(["admin"]);
    const seated = (all.people as Row[]).filter((p) => p.tribe === "Lagos Builders");
    expect(seated.length).toBeGreaterThanOrEqual(1);
    expect(seated.every((p) => p.form === "complete")).toBe(true);
  });

  it("opens one person fully, but leaves the sealed notes sealed", async () => {
    const seat = (await sql("select person_id from public.tribe_members where tribe_id = $1 limit 1", [tribe]))[0].person_id as string;
    await sql("update public.member_profiles set support_enc = 'sealed-support-blob', leader_note_enc = 'sealed-note-blob', story = 'a story' where person_id = $1", [seat]);
    await sql("insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 'v1'), ($1, 'ai_assist', false, 'v1')", [seat]);
    await sql("insert into public.ai_calls (person_id, field, provider, model, latency_ms, fallback) values ($1, 'community', 'mock', 'm', 30, false)", [seat]);

    const p = (await callAs(SESSION, "god_person", seat)) as Row;
    expect(p.person.id).toBe(seat);
    expect(p.form).toMatchObject({ state: "complete" });
    expect(p.form.community).toBeTruthy();
    expect(p.placement).toMatchObject({ tribe: "Lagos Builders", status: "active" });
    expect(p.consents).toEqual(expect.arrayContaining([expect.objectContaining({ purpose: "matching", granted: true }), expect.objectContaining({ purpose: "ai_assist", granted: false })]));
    expect(p.assistant.calls).toBe(1);
    expect(p.roles).toContain("member");
    const text = JSON.stringify(p);
    expect(text).not.toContain("sealed-support-blob");
    expect(text).not.toContain("sealed-note-blob");
    expect(text).not.toContain("a story");

    const lead = (await callAs(SESSION, "god_person", (await sql("select leader_id from public.tribes where id = $1", [tribe]))[0].leader_id)) as Row;
    expect(lead.leads[0]).toMatchObject({ name: "Lagos Builders", members: 1 });

    await expectCode(callAs(SESSION, "god_person", owner.id), "P0002");
    await expectCode(callAs(SESSION, "god_person", randomUUID()), "P0002");
  });

  it("shows every tribe and opens any one of them", async () => {
    const list = (await callAs(SESSION, "god_tribes")) as Row[];
    const ours = list.find((c) => c.id === tribe)!;
    expect(ours).toMatchObject({ name: "Lagos Builders", status: "approved", members: 1 });
    expect(ours.leader).toMatch(/Leader/);
    expect(((await callAs(SESSION, "god_tribes", "closed")) as Row[]).find((c) => c.id === tribe)).toBeUndefined();

    const one = (await callAs(SESSION, "god_tribe", tribe)) as Row;
    expect(one.tribe.name).toBe("Lagos Builders");
    expect(one.members).toHaveLength(1);
    expect(one.members[0].name).toMatch(/Seun/);
    await expectCode(callAs(SESSION, "god_tribe", randomUUID()), "P0002");
  });
});

describe("taking the owner away", () => {
  it("makes the account an ordinary visible member again, and frees the seat for a different owner", async () => {
    await sql("select public.remove_platform_owner()");
    expect((await sql("select hidden from public.people where id = $1", [owner.id]))[0].hidden).toBe(false);
    expect(roles(await call(owner.id, "my_roles"))).toEqual(["member"]);
    expect(await call(owner.id, "god_state")).toBe("none");
    await expectCode(callAs(SESSION, "god_overview"), "42501");
    const visible = (await db.asUser(admin.id, (q) => q("select id from public.people"))).rows.map((r) => r.id);
    expect(visible).toContain(owner.id);
    // The record of what happened stays.
    expect((await sql("select 1 from public.god_log where kind = 'owner_removed'")).length).toBe(1);
    await expectCode(sql("select public.remove_platform_owner()"), "P0002");
  });
});
