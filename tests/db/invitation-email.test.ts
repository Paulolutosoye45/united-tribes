import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { newKit, type Kit } from "./builders";
import { expectCode, type Row, type TestDb } from "./helpers";

// Inviting someone sends them an email. Before, invite_person saved the invitation and told nobody.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let admin: { id: string; email: string };

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const invite = async (who: string, email: string, role: string) =>
  (await db.asUser(who, (q) => q("select public.invite_person($1, $2) as r", [email, role]))).rows[0].r as Row;
const mail = (email: string, role?: string) =>
  sql(
    `select m.* from public.messages m where m.template = 'role_invitation' and (lower(m.to_email) = lower($1) or m.person_id in (select id from public.people where lower(email) = lower($1)))
        and ($2::text is null or m.params ->> 'role' = $2) order by m.created_at`,
    [email, role ?? null],
  );
const channels = async (id: string) => (await sql("select public.message_channels($1) as c", [id]))[0].c as string[];

beforeAll(async () => {
  ({ db, k } = await newKit());
  admin = await k.staff("Admina", "admin");
  o = await makeOwner(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("an invitation for an address with no account", () => {
  it("queues one email to that address, by email only, and the invitation is still saved", async () => {
    const r = await invite(admin.id, "  New.Leader@Example.org ", "leader");
    expect(r).toMatchObject({ status: "pending", granted_now: false });
    const m = await mail("new.leader@example.org");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      person_id: null,
      to_email: "new.leader@example.org",
      force_channel: "email",
      status: "queued",
      urgency: "normal",
    });
    expect(m[0].params).toEqual({ role: "leader", existing: false, days: 30 });
    expect(await channels(m[0].id)).toEqual(["email"]);
    expect(await sql("select status from public.invitations where email = 'new.leader@example.org'")).toEqual([{ status: "pending" }]);
  });

  it("carries only the role: it never names the person who invited, and never the owner", async () => {
    const m = await mail("new.leader@example.org");
    expect(Object.keys(m[0].params).sort()).toEqual(["days", "existing", "role"]);
    expect(JSON.stringify(m[0])).not.toMatch(/Admina|Owner|owner@example/i);
  });

  it("is not sent twice on the same day if the same invitation is made again, but the invitation is extended", async () => {
    await invite(admin.id, "new.leader@example.org", "leader");
    expect(await mail("new.leader@example.org", "leader")).toHaveLength(1);
  });

  it("is sent again the next day when the invitation is made again", async () => {
    await sql("update public.messages set dedupe_key = dedupe_key || ':yesterday' where template = 'role_invitation' and to_email = 'new.leader@example.org'");
    await invite(admin.id, "new.leader@example.org", "leader");
    expect(await mail("new.leader@example.org", "leader")).toHaveLength(2);
  });

  it("is a separate email for a separate role", async () => {
    await invite(admin.id, "new.leader@example.org", "coach");
    const coach = await mail("new.leader@example.org", "coach");
    expect(coach).toHaveLength(1);
    expect(coach[0].params.role).toBe("coach");
  });

  it("says how long is left when the invitation is extended, never more than 30 days", async () => {
    const days = (await mail("new.leader@example.org")).map((m) => m.params.days as number);
    expect(days.every((d) => d >= 1 && d <= 30)).toBe(true);
  });

  it("is sent for an address whose account has not verified it, to the address", async () => {
    await db.createUser({ email: "unverified@example.org", confirmed: false });
    await invite(admin.id, "unverified@example.org", "leader");
    const m = await mail("unverified@example.org");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ person_id: null, to_email: "unverified@example.org" });
    expect(m[0].params.existing).toBe(false);
  });

  it("reads the same for the owner's address as for any other, and tells the person who invited nothing different", async () => {
    const a = await invite(admin.id, "nobody.yet@example.org", "coach");
    const b = await invite(admin.id, o.owner.email, "coach");
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    expect(b).toMatchObject({ status: "pending", granted_now: false });
  });
});

describe("an invitation for an address that already has an account", () => {
  it("queues the email to the person, saying the role is already theirs", async () => {
    const here = await k.person("Already");
    const r = await invite(admin.id, here.email, "coach");
    expect(r).toMatchObject({ status: "accepted", granted_now: true });
    const m = await mail(here.email, "coach");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ person_id: here.id, to_email: null, force_channel: "email", status: "queued" });
    expect(m[0].params).toEqual({ role: "coach", existing: true });
    expect(await channels(m[0].id)).toEqual(["email"]);
  });

  it("is also sent when the owner gives the role, and never names the owner", async () => {
    const helper = await k.person("Helper");
    const r = (await o.call("invite_person", helper.email, "care_lead")) as Row;
    expect(r.granted_now).toBe(true);
    const m = await mail(helper.email, "care_lead");
    expect(m).toHaveLength(1);
    expect(m[0].person_id).toBe(helper.id);
    expect(JSON.stringify(m[0])).not.toMatch(/Owner|owner@example|god/i);
  });
});

describe("what it never does", () => {
  it("sends nothing for an invitation nobody made (the system's own)", async () => {
    const centre = (await sql("select id from public.centres limit 1"))[0].id;
    await sql("insert into public.invitations (email, role, centre_id) values ('bootstrap@example.org', 'admin', $1)", [centre]);
    expect(await mail("bootstrap@example.org")).toHaveLength(0);
  });

  it("sends nothing when the person trying is not allowed to invite, and the refusal is unchanged", async () => {
    const plain = await k.person("Plain");
    await expectCode(db.asUser(plain.id, (q) => q("select public.invite_person('x@example.org', 'leader')")), "42501");
    expect(await mail("x@example.org")).toHaveLength(0);
  });

  it("never stops the invitation if the email cannot be queued, and writes down why", async () => {
    await sql("alter table public.messages add constraint temp_no_mail check (false) not valid");
    try {
      const r = await invite(admin.id, "fault@example.org", "leader");
      expect(r).toMatchObject({ status: "pending", granted_now: false });
    } finally {
      await sql("alter table public.messages drop constraint temp_no_mail");
    }
    expect(await sql("select status from public.invitations where email = 'fault@example.org'")).toEqual([{ status: "pending" }]);
    expect(await mail("fault@example.org")).toHaveLength(0);
    expect((await sql("select count(*)::int n from public.notice_faults where source = 'invitation email'"))[0].n).toBeGreaterThan(0);
  });

  it("cannot be called by anyone: it is a trigger function", async () => {
    await expectCode(db.asUser(admin.id, (q) => q("select public.invitation_email_trg()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.invitation_email_trg()")), "42501");
  });

  it("still gives the role when the person signs in with the address (nothing about that changed)", async () => {
    const user = await db.createUser({ email: "NEW.LEADER@example.org" });
    const claimed = await db.asUser(user.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBeGreaterThanOrEqual(2);
    const roles = (await sql("select role from public.person_roles where person_id = $1 order by role", [user.id])).map((r) => r.role);
    expect(roles).toEqual(expect.arrayContaining(["leader", "coach", "member"]));
    // signing in sends no further invitation email
    expect(await mail("new.leader@example.org", "leader")).toHaveLength(2);
  });
});

describe("the way back", () => {
  const down = fs.readFileSync(path.resolve(__dirname, "../../supabase/rollback/20261227000100_invitation_email.down.sql"), "utf8");

  it("stops the email, keeps every invitation, role and email already queued, and is safe to run twice", async () => {
    const before = {
      invitations: (await sql("select count(*)::int n from public.invitations"))[0].n,
      mail: (await sql("select count(*)::int n from public.messages where template = 'role_invitation'"))[0].n,
      roles: (await sql("select count(*)::int n from public.person_roles"))[0].n,
    };
    await db.admin.query(down);
    await db.admin.query(down);
    expect(await sql("select 1 from pg_trigger where tgname = 'invitation_email' and not tgisinternal")).toHaveLength(0);
    expect(await sql("select 1 from pg_proc where proname = 'invitation_email_trg'")).toHaveLength(0);

    const r = await invite(admin.id, "after.rollback@example.org", "leader");
    expect(r).toMatchObject({ status: "pending", granted_now: false });
    expect(await mail("after.rollback@example.org")).toHaveLength(0);

    expect((await sql("select count(*)::int n from public.invitations"))[0].n).toBe(before.invitations + 1);
    expect((await sql("select count(*)::int n from public.messages where template = 'role_invitation'"))[0].n).toBe(before.mail);
    expect((await sql("select count(*)::int n from public.person_roles"))[0].n).toBe(before.roles);
  });
});
