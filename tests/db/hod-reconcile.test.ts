import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectCode } from "./helpers";
import { makeCast, type Cast } from "./profiles-kit";

// Fix 7: the report of the heads-of-department list. What these prove:
//   * only the office makes, tags from, sends from and deletes a report; the data lead reads it without the contacts; nobody else reads anything
//   * each row of the list gets one honest result: appointed, has an account, no account, a duplicate, or unclear; an email or a number written any usual way finds the same person
//   * leaders on the platform who are not on the list are named
//   * making a report sends nothing and changes nobody; tagging only adds a department a leader has none of; inviting sends once, to people with no account who gave an email
//   * the report is read fresh each time, the contacts can be deleted, and the event log never holds them

let c: Cast;
let look: string;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const run = async (rows: unknown[], who = c.admin, note: string | null = null) => (await c.as(who, "hod_reconcile_run", JSON.stringify(rows), note)) as { id: string; counts: Record<string, number> };
const get = async (id: string, who = c.admin) => (await c.as(who, "hod_reconcile_get", id)) as Row;
const byLine = (r: Row, line: number): Row => r.rows.find((x: Row) => x.line === line);
const emailOf = async (id: string) => (await c.one("select email from public.people where id = $1", [id])).email as string;
const count = async (table: string) => Number((await c.one(`select count(*) as n from public.${table}`)).n);

beforeAll(async () => {
  c = await makeCast();
  look = (await c.k.staff("Data lead", "data_lead")).id;
}, 240_000);

afterAll(async () => {
  await c?.db.close();
});

beforeEach(async () => {
  await c.sql("delete from public.hod_reconciles");
  await c.sql("delete from public.leader_departments");
  await c.sql("delete from public.invitations");
  await c.sql("delete from public.contact_preferences");
  await c.sql("update auth.users set phone = null");
});

describe("who may do what", () => {
  it("lets the office make, read, list, tag from, send from and delete a report", async () => {
    for (const who of [c.admin, c.director, c.pastor]) {
      const r = await run([{ name: "A", email: await emailOf(c.member) }], who);
      expect(r.id).toBeTruthy();
      expect(await get(r.id, who)).toMatchObject({ role: "act" });
      expect((await c.as(who, "hod_reconcile_list")).runs.length).toBeGreaterThan(0);
      await c.as(who, "hod_reconcile_tag", r.id);
      await c.as(who, "hod_reconcile_delete", r.id);
    }
  });

  it("lets the data lead read a report and the list, without the contacts, and do nothing else", async () => {
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id), phone: "08031234567", department: "Ushers" }]);
    const seen = await get(r.id, look);
    expect(seen.role).toBe("look");
    expect(seen.rows[0]).toMatchObject({ name: "Seasoned", department: "Ushers", result: "appointed" });
    expect(seen.rows[0].email).toBeUndefined();
    expect(seen.rows[0].phone).toBeUndefined();
    expect((await c.as(look, "hod_reconcile_list")).runs).toHaveLength(1);
    await expectCode(c.as(look, "hod_reconcile_run", JSON.stringify([{ name: "x" }]), null), "42501");
    await expectCode(c.as(look, "hod_reconcile_tag", r.id), "42501");
    await expectCode(c.as(look, "hod_reconcile_invite", r.id), "42501");
    await expectCode(c.as(look, "hod_reconcile_delete", r.id), "42501");
    const admin = await get(r.id);
    expect(admin.rows[0].email).toBeTruthy();
    expect(admin.rows[0].phone).toBe("08031234567");
  });

  it("keeps everyone else out, a leader and a member included, and anyone not signed in", async () => {
    const r = await run([{ name: "A", email: "a@example.org" }]);
    for (const who of [c.member, c.seasoned.id, c.appointed.id]) {
      await expectCode(c.as(who, "hod_reconcile_run", JSON.stringify([{ name: "x" }]), null), "42501");
      await expectCode(c.as(who, "hod_reconcile_get", r.id), "42501");
      await expectCode(c.as(who, "hod_reconcile_list"), "42501");
      await expectCode(c.as(who, "hod_reconcile_tag", r.id), "42501");
      await expectCode(c.as(who, "hod_reconcile_invite", r.id), "42501");
      await expectCode(c.as(who, "hod_reconcile_delete", r.id), "42501");
    }
    await expectCode(c.anon("hod_reconcile_run", JSON.stringify([{ name: "x" }]), null), "42501");
    await expectCode(c.anon("hod_reconcile_get", r.id), "42501");
    await expectCode(c.anon("hod_reconcile_list"), "42501");
    await expectCode(c.anon("hod_reconcile_tag", r.id), "42501");
    await expectCode(c.anon("hod_reconcile_invite", r.id), "42501");
    await expectCode(c.anon("hod_reconcile_delete", r.id), "42501");
  });

  it("lets only an admin or a director send invitations, as inviting anyone does", async () => {
    const r = await run([{ name: "New", email: "new.hod@example.org" }]);
    await expectCode(c.as(c.pastor, "hod_reconcile_invite", r.id), "42501");
    expect(await c.as(c.director, "hod_reconcile_invite", r.id)).toEqual({ invited: 1 });
    const r2 = await run([{ name: "New2", email: "new2.hod@example.org" }]);
    expect(await c.as(c.admin, "hod_reconcile_invite", r2.id)).toEqual({ invited: 1 });
  });

  it("keeps the tables and the helper functions out of reach of everyone who is not the database", async () => {
    for (const t of ["hod_reconciles", "hod_reconcile_rows"]) {
      const row = await c.one(`select has_table_privilege('authenticated', 'public.${t}', 'select') as a, has_table_privilege('anon', 'public.${t}', 'select') as b`);
      expect(row, t).toEqual({ a: false, b: false });
    }
    for (const fn of ["hod_email_norm(text)", "hod_results(uuid)"]) {
      const row = await c.one(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a, has_function_privilege('anon', 'public.${fn}', 'execute') as b`);
      expect(row, fn).toEqual({ a: false, b: false });
    }
  });
});

describe("making a report", () => {
  it("refuses an empty list, a list that is not a list, and more than 500 rows", async () => {
    await expectCode(c.as(c.admin, "hod_reconcile_run", "[]", null), "22023");
    await expectCode(c.as(c.admin, "hod_reconcile_run", "{}", null), "22023");
    await expectCode(c.as(c.admin, "hod_reconcile_run", "null", null), "22023");
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `P${i}`, email: `p${i}@example.org` }));
    await expectCode(c.as(c.admin, "hod_reconcile_run", JSON.stringify(many), null), "22023");
    expect(await count("hod_reconciles")).toBe(0);
    const ok = Array.from({ length: 500 }, (_, i) => ({ name: `P${i}`, email: `p${i}@example.org` }));
    expect((await run(ok)).counts).toEqual({ no_account: 500 });
  });

  it("sends nothing and changes nobody", async () => {
    const before = {
      roles: await count("person_roles"),
      people: await count("people"),
      messages: await count("messages"),
      invitations: await count("invitations"),
      departments: await count("leader_departments"),
    };
    await run([
      { name: "Seasoned", email: await emailOf(c.seasoned.id), department: "Ushers" },
      { name: "Plain", email: await emailOf(c.member) },
      { name: "Nobody", email: "nobody.at.all@example.org" },
    ]);
    expect({
      roles: await count("person_roles"),
      people: await count("people"),
      messages: await count("messages"),
      invitations: await count("invitations"),
      departments: await count("leader_departments"),
    }).toEqual(before);
  });

  it("keeps the note and the line numbers as given, fills a missing line number, and cuts what is too long", async () => {
    const r = await run([{ line: 7, name: "x".repeat(300), email: "a@example.org", department: "d".repeat(100) }, { name: "Second", email: "b@example.org" }], c.admin, "  First list  ");
    const got = await get(r.id);
    expect(got.run).toMatchObject({ rows: 2, note: "First list" });
    expect(got.rows.map((x: Row) => x.line)).toEqual([2, 7]);
    expect(byLine(got, 7).name).toHaveLength(120);
    expect(byLine(got, 7).department).toHaveLength(60);
  });

  it("writes one line in the log with the counts and none of the contacts", async () => {
    const r = await run([{ name: "Nobody", email: "secret.person@example.org", phone: "08090000001" }]);
    const log = await c.one("select meta::text as m from public.event_log where action = 'hod.reconcile' order by at desc limit 1");
    expect(JSON.parse(log.m)).toEqual({ rows: 1, counts: { no_account: 1 } });
    expect(log.m).not.toContain("secret.person");
    expect(log.m).not.toContain("08090000001");
    expect(r.counts).toEqual({ no_account: 1 });
  });
});

describe("where each person stands", () => {
  it("says appointed for a leader with a tribe, found by email in any case and with spaces round it", async () => {
    const r = await run([{ name: "Seasoned", email: `  ${(await emailOf(c.seasoned.id)).toUpperCase()} ` }]);
    expect(byLine(await get(r.id), 1)).toMatchObject({ result: "appointed" });
  });

  it("says appointed for a leader the office appointed, found by a phone number written the usual ways", async () => {
    await c.sql("insert into public.contact_preferences (person_id, phone) values ($1, '+2348031234567') on conflict (person_id) do update set phone = excluded.phone", [c.appointed.id]);
    for (const written of ["08031234567", "0803 123 4567", "+234 803 123 4567", "2348031234567", "+2340 803 123 4567", "803-123-4567"]) {
      const r = await run([{ name: "Ada", phone: written }]);
      expect(byLine(await get(r.id), 1), written).toMatchObject({ result: "appointed" });
    }
  });

  it("finds a person by the number they signed in with", async () => {
    await c.sql("update auth.users set phone = '2348077700001' where id = $1", [c.member]);
    const r = await run([{ name: "Plain", phone: "0807 770 0001" }]);
    expect(byLine(await get(r.id), 1)).toMatchObject({ result: "has_account" });
  });

  it("says has_account for a person with an account who is not a leader, and says so when they already hold the role", async () => {
    const holder = (await c.k.person("Holder")).id;
    await c.db.grant(holder, "leader");
    const r = await run([{ name: "Plain", email: await emailOf(c.member) }, { name: "Holder", email: await emailOf(holder) }]);
    const got = await get(r.id);
    expect(byLine(got, 1)).toMatchObject({ result: "has_account" });
    expect(byLine(got, 1).note).toBeUndefined();
    expect(byLine(got, 2)).toMatchObject({ result: "has_account", note: "Already holds the leader role" });
  });

  it("says no_account when nobody has the email or the number, and says when there is no email to invite", async () => {
    const r = await run([{ name: "Nobody", email: "nobody@example.org" }, { name: "Number only", phone: "08099999999" }, { name: "Both", email: "both@example.org", phone: "08088888888" }]);
    const got = await get(r.id);
    expect(byLine(got, 1)).toMatchObject({ result: "no_account" });
    expect(byLine(got, 1).note).toBeUndefined();
    expect(byLine(got, 2)).toMatchObject({ result: "no_account", note: "There is no email address to invite" });
    expect(byLine(got, 3)).toMatchObject({ result: "no_account" });
    expect(byLine(got, 3).note).toBeUndefined();
  });

  it("says duplicate for the same person again, whichever way they were found, and points at the first line", async () => {
    await c.sql("insert into public.contact_preferences (person_id, phone) values ($1, '+2348031234567') on conflict (person_id) do update set phone = excluded.phone", [c.seasoned.id]);
    const e = await emailOf(c.seasoned.id);
    const r = await run([
      { name: "Seasoned", email: e },
      { name: "Seasoned again", email: e.toUpperCase() },
      { name: "Seasoned by number", phone: "0803 123 4567" },
      { name: "Nobody", email: "dup@example.org" },
      { name: "Nobody again", email: " DUP@example.org" },
      { name: "Number only", phone: "08099999999" },
      { name: "Number only again", phone: "+234 809 999 9999" },
    ]);
    const got = await get(r.id);
    expect(byLine(got, 1).result).toBe("appointed");
    expect(byLine(got, 2)).toMatchObject({ result: "duplicate", note: "The same person as line 1" });
    expect(byLine(got, 3)).toMatchObject({ result: "duplicate", note: "The same person as line 1" });
    expect(byLine(got, 4).result).toBe("no_account");
    expect(byLine(got, 5)).toMatchObject({ result: "duplicate", note: "The same person as line 4" });
    expect(byLine(got, 6).result).toBe("no_account");
    expect(byLine(got, 7)).toMatchObject({ result: "duplicate", note: "The same person as line 6" });
    expect(r.counts).toEqual({ appointed: 1, duplicate: 4, no_account: 2 });
  });

  it("says unclear for an empty row, an email that is not one, a number that is not one, and an email and number that belong to different people", async () => {
    await c.sql("insert into public.contact_preferences (person_id, phone) values ($1, '+2348031234567') on conflict (person_id) do update set phone = excluded.phone", [c.member]);
    const r = await run([
      { name: "   " },
      { name: "Bad email", email: "not an email" },
      { name: "Bad number", phone: "call me" },
      { name: "Two people", email: await emailOf(c.seasoned.id), phone: "08031234567" },
      { name: "Name only" },
    ]);
    const got = await get(r.id);
    expect(byLine(got, 1)).toMatchObject({ result: "unclear", note: "There is nothing on this row to go on" });
    expect(byLine(got, 2)).toMatchObject({ result: "unclear", note: "This is not an email address" });
    expect(byLine(got, 3)).toMatchObject({ result: "unclear", note: "This is not a phone number we can read" });
    expect(byLine(got, 4)).toMatchObject({ result: "unclear", note: "The email and the number belong to different people" });
    expect(byLine(got, 5)).toMatchObject({ result: "unclear", note: "There is no email address or number" });
    expect(r.counts).toEqual({ unclear: 5 });
  });

  it("never finds anyone in another centre, and another centre's office cannot reach the report", async () => {
    const other = (await c.one("insert into public.centres (slug, name) values ('hod-other', 'Other') returning id")).id as string;
    const stranger = await c.k.person("Stranger");
    await c.sql("update public.people set centre_id = $2 where id = $1", [stranger.id, other]);
    const foreignAdmin = await c.k.person("Foreign admin");
    await c.sql("update public.people set centre_id = $2 where id = $1", [foreignAdmin.id, other]);
    await c.db.grant(foreignAdmin.id, "admin");
    const r = await run([{ name: "Stranger", email: stranger.email }]);
    expect(byLine(await get(r.id), 1).result).toBe("no_account");
    await expectCode(get(r.id, foreignAdmin.id), "P0002");
    await expectCode(c.as(foreignAdmin.id, "hod_reconcile_tag", r.id), "P0002");
    await expectCode(c.as(foreignAdmin.id, "hod_reconcile_invite", r.id), "P0002");
    await expectCode(c.as(foreignAdmin.id, "hod_reconcile_delete", r.id), "P0002");
    expect((await c.as(foreignAdmin.id, "hod_reconcile_list")).runs).toEqual([]);
  });

  it("shows the department the leader already has beside the one on the list", async () => {
    await c.sql("insert into public.leader_departments (person_id, department) values ($1, 'Media')", [c.seasoned.id]);
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id), department: "Ushers" }]);
    expect(byLine(await get(r.id), 1)).toMatchObject({ department: "Ushers", leader_dept: "Media" });
  });

  it("is read fresh each time: a person who has since signed up shows as having an account", async () => {
    const r = await run([{ name: "Late", email: "late.hod@example.org" }]);
    expect(byLine(await get(r.id), 1).result).toBe("no_account");
    await c.db.createUser({ email: "late.hod@example.org" });
    expect(byLine(await get(r.id), 1).result).toBe("has_account");
    expect((await c.as(c.admin, "hod_reconcile_list")).runs[0].counts).toEqual({ no_account: 1 });
  });
});

describe("leaders who are not on the list", () => {
  it("names each leader on the platform the list left out, and none that it holds", async () => {
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id) }]);
    const got = await get(r.id);
    const names = got.missing.map((m: Row) => m.name);
    const seasonedName = (await c.one("select full_name from public.people where id = $1", [c.seasoned.id])).full_name;
    expect(names).toContain("Ada1 Test");
    expect(names).not.toContain(seasonedName);
    for (const m of got.missing) expect(m.email).toBeUndefined();
  });

  it("is empty when the list holds every leader", async () => {
    const rows = await c.sql("select p.email from public.people p where p.id = any($1)", [[c.seasoned.id, c.appointed.id]]);
    const leaders = (await c.sql("select person_id from public.leader_card_rows((select centre_id from public.people where id = $1))", [c.admin])).map((x) => x.person_id);
    const emails = (await c.sql("select email from public.people where id = any($1)", [leaders])).map((x) => ({ name: "L", email: x.email }));
    expect(rows.length).toBe(2);
    expect((await get((await run(emails)).id)).missing).toEqual([]);
  });

  it("is told the same to the data lead, by name, tribe and department only", async () => {
    await c.sql("insert into public.leader_departments (person_id, department) values ($1, 'Media')", [c.appointed.id]);
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id) }]);
    const m = (await get(r.id, look)).missing.find((x: Row) => x.name === "Ada1 Test");
    expect(m).toMatchObject({ department: "Media" });
    expect(Object.keys(m).sort()).toEqual(["department", "name", "state", "tribe"]);
  });
});

describe("tagging the departments", () => {
  it("puts the department on the list on each appointed leader who has none, and nobody else", async () => {
    const r = await run([
      { name: "Seasoned", email: await emailOf(c.seasoned.id), department: "  Ushers " },
      { name: "Ada", email: await emailOf(c.appointed.id), department: "Media" },
      { name: "Plain", email: await emailOf(c.member), department: "Choir" },
      { name: "Nobody", email: "nobody@example.org", department: "Prayer" },
    ]);
    expect(await c.as(c.admin, "hod_reconcile_tag", r.id)).toEqual({ tagged: 2, differs: 0 });
    const rows = await c.sql("select person_id, department from public.leader_departments order by department");
    expect(rows.map((x) => x.department)).toEqual(["Media", "Ushers"]);
    expect(rows.find((x) => x.department === "Ushers")?.person_id).toBe(c.seasoned.id);
    expect((await c.one("select tagged_at is not null as t, tagged_by from public.hod_reconciles where id = $1", [r.id]))).toMatchObject({ t: true, tagged_by: c.admin });
  });

  it("never changes a department already set, and says how many differ", async () => {
    await c.sql("insert into public.leader_departments (person_id, department) values ($1, 'Media')", [c.seasoned.id]);
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id), department: "Ushers" }, { name: "Ada", email: await emailOf(c.appointed.id), department: "Media" }]);
    expect(await c.as(c.pastor, "hod_reconcile_tag", r.id)).toEqual({ tagged: 1, differs: 1 });
    expect((await c.one("select department from public.leader_departments where person_id = $1", [c.seasoned.id])).department).toBe("Media");
    expect(await c.as(c.pastor, "hod_reconcile_tag", r.id)).toEqual({ tagged: 0, differs: 1 });
  });

  it("skips a department that is empty or too short or too long, and the same leader twice takes the first line", async () => {
    const e = await emailOf(c.seasoned.id);
    const r = await run([{ name: "Seasoned", email: e, department: "Ushers" }, { name: "Again", email: e, department: "Choir" }, { name: "Ada", email: await emailOf(c.appointed.id), department: "x" }]);
    expect(await c.as(c.admin, "hod_reconcile_tag", r.id)).toEqual({ tagged: 1, differs: 0 });
    expect((await c.one("select department from public.leader_departments where person_id = $1", [c.seasoned.id])).department).toBe("Ushers");
    expect(await count("leader_departments")).toBe(1);
  });

  it("changes nothing else about the leader and writes a line in the log", async () => {
    const before = { roles: await count("person_roles"), tribes: await c.sql("select id, status, leader_id from public.tribes order by id"), appointments: await count("leader_appointments") };
    const r = await run([{ name: "Seasoned", email: await emailOf(c.seasoned.id), department: "Ushers" }]);
    await c.as(c.admin, "hod_reconcile_tag", r.id);
    expect({ roles: await count("person_roles"), tribes: await c.sql("select id, status, leader_id from public.tribes order by id"), appointments: await count("leader_appointments") }).toEqual(before);
    const log = await c.one("select meta from public.event_log where action = 'hod.tag' order by at desc limit 1");
    expect(log.meta).toEqual({ tagged: 1, differs: 0 });
  });

  it("refuses a report that is not there", async () => {
    await expectCode(c.as(c.admin, "hod_reconcile_tag", "00000000-0000-0000-0000-000000000000"), "P0002");
  });
});

describe("sending the invitations", () => {
  it("invites each person with no account who gave an email, once, as a leader", async () => {
    const r = await run([
      { name: "New one", email: "new.one@example.org" },
      { name: "New one again", email: "NEW.ONE@example.org" },
      { name: "New two", email: "new.two@example.org" },
      { name: "Number only", phone: "08099999999" },
      { name: "Plain", email: await emailOf(c.member) },
      { name: "Seasoned", email: await emailOf(c.seasoned.id) },
      { name: "Bad", email: "not an email" },
    ]);
    const mails = async () => Number((await c.one("select count(*) as n from public.messages where template = 'role_invitation'")).n);
    const msgs = await mails();
    expect(await c.as(c.admin, "hod_reconcile_invite", r.id)).toEqual({ invited: 2 });
    const inv = await c.sql("select email, role, status from public.invitations order by email");
    expect(inv).toEqual([
      { email: "new.one@example.org", role: "leader", status: "pending" },
      { email: "new.two@example.org", role: "leader", status: "pending" },
    ]);
    expect(await mails()).toBe(msgs + 2);
    const row = await c.one("select invited_at is not null as a, invited_by, invited_n from public.hod_reconciles where id = $1", [r.id]);
    expect(row).toMatchObject({ a: true, invited_by: c.admin, invited_n: 2 });
    await expectCode(c.as(c.admin, "hod_reconcile_invite", r.id), "22023");
    expect(await count("invitations")).toBe(2);
  });

  it("invites nobody when everyone on the list already has an account, and still counts as sent", async () => {
    const r = await run([{ name: "Plain", email: await emailOf(c.member) }]);
    expect(await c.as(c.admin, "hod_reconcile_invite", r.id)).toEqual({ invited: 0 });
    expect(await count("invitations")).toBe(0);
  });

  it("writes one line in the log with the number invited and no address", async () => {
    const r = await run([{ name: "New one", email: "log.check@example.org" }]);
    await c.as(c.admin, "hod_reconcile_invite", r.id);
    const log = await c.one("select meta::text as m from public.event_log where action = 'hod.invite' order by at desc limit 1");
    expect(JSON.parse(log.m)).toEqual({ invited: 1 });
  });

  it("refuses a report that is not there", async () => {
    await expectCode(c.as(c.admin, "hod_reconcile_invite", "00000000-0000-0000-0000-000000000000"), "P0002");
  });
});

describe("deleting a report", () => {
  it("removes the report and the contacts it holds, and nothing else", async () => {
    const keep = await run([{ name: "Keep", email: "keep@example.org" }]);
    const gone = await run([{ name: "Gone", email: "gone@example.org", phone: "08011112222" }]);
    expect(await c.as(c.admin, "hod_reconcile_delete", gone.id)).toEqual({ ok: true });
    expect(await count("hod_reconciles")).toBe(1);
    expect((await c.sql("select run_id from public.hod_reconcile_rows")).map((x) => x.run_id)).toEqual([keep.id]);
    await expectCode(c.as(c.admin, "hod_reconcile_get", gone.id), "P0002");
    await expectCode(c.as(c.admin, "hod_reconcile_delete", gone.id), "P0002");
  });

  it("lists the newest twenty reports, newest first", async () => {
    for (let i = 0; i < 22; i++) await run([{ name: `P${i}`, email: `p${i}@example.org` }], c.admin, `Report ${i}`);
    const list = (await c.as(c.admin, "hod_reconcile_list")).runs as Row[];
    expect(list).toHaveLength(20);
    expect(list[0].note).toBe("Report 21");
    expect(list[19].note).toBe("Report 2");
  });
});
