import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type TestDb } from "./helpers";

let db: TestDb;

/** Role names, alphabetical (enum order is not alphabetical). */
const names = (rows: { role: string }[]) => rows.map((r) => r.role).sort();

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

/** Make a verified person with the given extra role(s). */
async function person(roles: string[] = [], opts: { email?: string; confirmed?: boolean } = {}) {
  const user = await db.createUser(opts);
  for (const role of roles) await db.grant(user.id, role);
  return user;
}

describe("reference data", () => {
  it("loads the blueprint catalogue", async () => {
    const q = (sql: string) => db.admin.query(sql).then((r) => r.rows);

    expect(await q("select count(*)::int as n from public.communities")).toEqual([{ n: 11 }]);
    expect(await q("select count(*)::int as n from public.goal_families")).toEqual([{ n: 6 }]);
    expect(await q("select count(*)::int as n from public.season_goals")).toEqual([{ n: 23 }]);
    expect(await q("select count(*)::int as n from public.age_ranges")).toEqual([{ n: 7 }]);

    const tracks = await q("select slug, active from public.tracks order by sort");
    expect(tracks.map((t) => t.slug)).toEqual(["teens", "rising", "builders", "stewards", "sages"]);
    // Teens stay closed until the guardian-consent release.
    expect(tracks.find((t) => t.slug === "teens")?.active).toBe(false);
  });

  it("gives every community at least two goals, each in a family", async () => {
    const { rows } = await db.admin.query(`
      select t.slug, count(g.id)::int as goals
      from public.communities t left join public.season_goals g on g.community_id = t.id
      group by t.slug order by t.slug`);
    expect(rows).toHaveLength(11);
    for (const row of rows) expect(row.goals, row.slug).toBeGreaterThanOrEqual(2);
  });

  it("maps every age range to a track that covers it", async () => {
    const { rows } = await db.admin.query(`
      select a.label, a.min_age, a.max_age, t.slug as track, t.min_age as t_min, t.max_age as t_max
      from public.age_ranges a join public.tracks t on t.id = a.track_id`);
    for (const r of rows) {
      expect(r.min_age, r.label).toBeGreaterThanOrEqual(r.t_min);
      if (r.t_max !== null) expect(r.max_age, r.label).toBeLessThanOrEqual(r.t_max);
    }
  });

  it("includes a provisional season that starts on a Sunday and lasts 12 weeks", async () => {
    const { rows } = await db.admin.query(
      "select status, weeks, extract(dow from starts_on)::int as dow, (ends_on - starts_on + 1) as days from public.seasons",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "planning", weeks: 12, dow: 0, days: 84 });
  });
});

describe("sign-up", () => {
  it("creates a person with the member role and logs it", async () => {
    const user = await db.createUser({
      email: "Ada.Obi@Example.org",
      meta: { full_name: "Ada Obi", picture: "https://example.org/a.png" },
    });

    const { rows: people } = await db.admin.query("select * from public.people where id = $1", [user.id]);
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      email: "ada.obi@example.org",
      full_name: "Ada Obi",
      preferred_name: "Ada",
      avatar_url: "https://example.org/a.png",
    });

    const { rows: roles } = await db.admin.query("select role from public.person_roles where person_id = $1", [user.id]);
    expect(roles).toEqual([{ role: "member" }]);

    const { rows: events } = await db.admin.query(
      "select action from public.event_log where entity_id = $1 and action = 'person.created'",
      [user.id],
    );
    expect(events).toHaveLength(1);
  });

  it("works for a person with no name (email sign-in)", async () => {
    const user = await db.createUser();
    const { rows } = await db.admin.query("select full_name, preferred_name from public.people where id = $1", [user.id]);
    expect(rows[0]).toEqual({ full_name: null, preferred_name: null });
  });

  it("keeps the person's email in step when the sign-in email changes", async () => {
    const user = await db.createUser();
    await db.admin.query("update auth.users set email = 'New.Address@Example.org' where id = $1", [user.id]);
    const { rows } = await db.admin.query("select email from public.people where id = $1", [user.id]);
    expect(rows[0].email).toBe("new.address@example.org");
  });
});

describe("what a visitor who is not signed in can do", () => {
  it("can read nothing and call nothing", async () => {
    for (const table of ["people", "person_roles", "invitations", "event_log", "communities", "seasons"]) {
      await expectCode(db.asAnon((q) => q(`select * from public.${table}`)), "42501");
    }
    await expectCode(db.asAnon((q) => q("select public.my_roles()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.claim_invitations()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.invite_person('a@b.co', 'leader')")), "42501");
  });
});

describe("what an ordinary member can do", () => {
  it("sees only their own person record and roles", async () => {
    const me = await person();
    const other = await person();

    const { rows } = await db.asUser(me.id, (q) => q("select id from public.people"));
    expect(rows).toEqual([{ id: me.id }]);

    const roles = await db.asUser(me.id, (q) => q("select person_id from public.person_roles"));
    expect(new Set(roles.rows.map((r) => r.person_id))).toEqual(new Set([me.id]));
    expect(other.id).not.toBe(me.id);
  });

  it("can read the catalogues but not change them", async () => {
    const me = await person();
    const { rows } = await db.asUser(me.id, (q) => q("select count(*)::int as n from public.communities"));
    expect(rows[0].n).toBe(11);

    await expectCode(
      db.asUser(me.id, (q) => q("insert into public.communities (slug, name) values ('sneaky', 'Sneaky')")),
      "42501",
    );
    const update = await db.asUser(me.id, (q) => q("update public.communities set name = 'Hacked'"));
    expect(update.rowCount).toBe(0);
    const del = await db.asUser(me.id, (q) => q("delete from public.season_goals"));
    expect(del.rowCount).toBe(0);
    const centre = await db.asUser(me.id, (q) => q("update public.centres set name = 'Mine'"));
    expect(centre.rowCount).toBe(0);
  });

  it("can change how they are named, nothing else", async () => {
    const me = await person();
    const other = await person();

    const ok = await db.asUser(me.id, (q) => q("update public.people set preferred_name = 'Zee' where id = $1", [me.id]));
    expect(ok.rowCount).toBe(1);

    const notMine = await db.asUser(me.id, (q) => q("update public.people set preferred_name = 'Nope' where id = $1", [other.id]));
    expect(notMine.rowCount).toBe(0);

    await expectCode(db.asUser(me.id, (q) => q("update public.people set email = 'x@y.co' where id = $1", [me.id])), "42501");
    await expectCode(db.asUser(me.id, (q) => q("update public.people set centre_id = gen_random_uuid() where id = $1", [me.id])), "42501");
    await expectCode(db.asUser(me.id, (q) => q("update public.people set id = gen_random_uuid() where id = $1", [me.id])), "42501");
  });

  it("cannot give themselves a role, an invitation, or an event", async () => {
    const me = await person();
    await expectCode(
      db.asUser(me.id, (q) =>
        q("insert into public.person_roles (person_id, role, centre_id) select id, 'admin', centre_id from public.people where id = $1", [me.id]),
      ),
      "42501",
    );
    await expectCode(
      db.asUser(me.id, (q) =>
        q("insert into public.invitations (email, role, centre_id) select 'x@y.co', 'admin', centre_id from public.people where id = $1", [me.id]),
      ),
      "42501",
    );
    await expectCode(
      db.asUser(me.id, (q) => q("insert into public.event_log (action) values ('forged')")),
      "42501",
    );
    await expectCode(db.asUser(me.id, (q) => q("delete from public.person_roles")), "42501");
  });

  it("cannot invite, revoke or read the office's records", async () => {
    const me = await person();
    await expectCode(db.asUser(me.id, (q) => q("select public.invite_person('a@b.co', 'leader')")), "42501");
    await expectCode(db.asUser(me.id, (q) => q("select public.revoke_role($1, 'leader')", [me.id])), "42501");
    await expectCode(
      db.asUser(me.id, (q) => q("select public.revoke_invitation(gen_random_uuid())")),
      "42501",
    );
    const inv = await db.asUser(me.id, (q) => q("select * from public.invitations"));
    expect(inv.rows).toHaveLength(0);
    const log = await db.asUser(me.id, (q) => q("select * from public.event_log"));
    expect(log.rows).toHaveLength(0);
  });

  it("can write their own events, and only as themselves", async () => {
    const me = await person();
    await db.asUser(me.id, (q) => q("select public.log_event('form.opened', 'form', 'intake', '{\"step\":1}')"));
    const { rows } = await db.admin.query(
      "select actor_id, action, meta from public.event_log where action = 'form.opened' and actor_id = $1",
      [me.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).toEqual({ step: 1 });

    await expectCode(
      db.asUser(me.id, (q) => q("select public.log_event('Bad Action!')")),
      "23514",
    );
  });

  it("reads their roles through my_roles()", async () => {
    const me = await person(["leader"]);
    const { rows } = await db.asUser(me.id, (q) => q("select public.my_roles()::text[] as roles"));
    expect(rows[0].roles.sort()).toEqual(["leader", "member"]);
  });
});

describe("what the office can see", () => {
  it("lets an admin or director see everyone; a leader still sees only themselves", async () => {
    const admin = await person(["admin"]);
    const director = await person(["director"]);
    const leader = await person(["leader"]);
    await person();

    const count = async (id: string) =>
      (await db.asUser(id, (q) => q("select count(*)::int as n from public.people"))).rows[0].n as number;

    expect(await count(admin.id)).toBeGreaterThan(3);
    expect(await count(director.id)).toBeGreaterThan(3);
    expect(await count(leader.id)).toBe(1);
  });

  it("lets a data lead read the event log but not people or invitations", async () => {
    const dataLead = await person(["data_lead"]);
    await person();
    const log = await db.asUser(dataLead.id, (q) => q("select count(*)::int as n from public.event_log"));
    expect(log.rows[0].n).toBeGreaterThan(0);
    const people = await db.asUser(dataLead.id, (q) => q("select count(*)::int as n from public.people"));
    expect(people.rows[0].n).toBe(1);
  });

  it("lets an admin or director change the catalogues", async () => {
    const director = await person(["director"]);
    const res = await db.asUser(director.id, (q) =>
      q("insert into public.goal_families (slug, name, sort) values ('test-family', 'Test family', 99) returning id"),
    );
    expect(res.rows).toHaveLength(1);
  });
});

describe("invitations", () => {
  it("lets an admin invite a new person, who gets the role once they sign in", async () => {
    const admin = await person(["admin"]);
    const invite = await db.asUser(admin.id, (q) => q("select public.invite_person('  New.Leader@Example.org ', 'leader') as r"));
    expect(invite.rows[0].r).toMatchObject({ status: "pending", granted_now: false });

    const stored = await db.admin.query("select email, role, status from public.invitations where email = 'new.leader@example.org'");
    expect(stored.rows).toEqual([{ email: "new.leader@example.org", role: "leader", status: "pending" }]);

    // The person signs in later with the same address in a different case.
    const user = await db.createUser({ email: "NEW.LEADER@example.org" });
    const claimed = await db.asUser(user.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBe(1);

    const roles = await db.admin.query("select role from public.person_roles where person_id = $1 order by role", [user.id]);
    expect(names(roles.rows)).toEqual(["leader", "member"]);

    const after = await db.admin.query("select status, resolved_by from public.invitations where email = 'new.leader@example.org'");
    expect(after.rows[0]).toEqual({ status: "accepted", resolved_by: user.id });

    // Claiming twice does nothing.
    const again = await db.asUser(user.id, (q) => q("select public.claim_invitations() as n"));
    expect(again.rows[0].n).toBe(0);
  });

  it("grants at once when the person already has a verified account", async () => {
    const admin = await person(["admin"]);
    const existing = await person([], { email: "already.here@example.org" });
    const res = await db.asUser(admin.id, (q) => q("select public.invite_person('already.here@example.org', 'coach') as r"));
    expect(res.rows[0].r).toMatchObject({ status: "accepted", granted_now: true });
    const roles = await db.admin.query("select role from public.person_roles where person_id = $1 order by role", [existing.id]);
    expect(names(roles.rows)).toEqual(["coach", "member"]);
  });

  it("never grants a role to an unverified email", async () => {
    const admin = await person(["admin"]);
    const squatter = await db.createUser({ email: "target@example.org", confirmed: false });

    // Inviting does not grant: the account has not proved it owns the address.
    const res = await db.asUser(admin.id, (q) => q("select public.invite_person('target@example.org', 'leader') as r"));
    expect(res.rows[0].r).toMatchObject({ status: "pending", granted_now: false });

    // Claiming does not grant either.
    const claimed = await db.asUser(squatter.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBe(0);
    let roles = await db.admin.query("select role from public.person_roles where person_id = $1", [squatter.id]);
    expect(names(roles.rows)).toEqual(["member"]);

    // After the address is verified, claiming works.
    await db.admin.query("update auth.users set email_confirmed_at = now() where id = $1", [squatter.id]);
    const later = await db.asUser(squatter.id, (q) => q("select public.claim_invitations() as n"));
    expect(later.rows[0].n).toBe(1);
    roles = await db.admin.query("select role from public.person_roles where person_id = $1 order by role", [squatter.id]);
    expect(names(roles.rows)).toEqual(["leader", "member"]);
  });

  it("ignores someone else's invitation", async () => {
    const admin = await person(["admin"]);
    await db.asUser(admin.id, (q) => q("select public.invite_person('intended@example.org', 'leader')"));
    const other = await person();
    const claimed = await db.asUser(other.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBe(0);
  });

  it("lets invitations expire", async () => {
    const admin = await person(["admin"]);
    await db.asUser(admin.id, (q) => q("select public.invite_person('late@example.org', 'leader')"));
    await db.admin.query("update public.invitations set expires_at = now() - interval '1 day' where email = 'late@example.org'");
    const user = await db.createUser({ email: "late@example.org" });
    const claimed = await db.asUser(user.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBe(0);
    const { rows } = await db.admin.query("select status from public.invitations where email = 'late@example.org'");
    expect(rows[0].status).toBe("expired");
  });

  it("re-inviting refreshes the pending invitation instead of duplicating it", async () => {
    const admin = await person(["admin"]);
    await db.asUser(admin.id, (q) => q("select public.invite_person('twice@example.org', 'leader')"));
    await db.asUser(admin.id, (q) => q("select public.invite_person('twice@example.org', 'leader')"));
    const { rows } = await db.admin.query("select count(*)::int as n from public.invitations where email = 'twice@example.org'");
    expect(rows[0].n).toBe(1);
  });

  it("rejects bad input", async () => {
    const admin = await person(["admin"]);
    await expectCode(db.asUser(admin.id, (q) => q("select public.invite_person('not-an-email', 'leader')")), "22023");
    await expectCode(db.asUser(admin.id, (q) => q("select public.invite_person('', 'leader')")), "22023");
    await expectCode(db.asUser(admin.id, (q) => q("select public.invite_person('a@b.co', 'member')")), "22023");
    await expectCode(db.asUser(admin.id, (q) => q("select public.invite_person(null, 'leader')")), "22023");
  });

  it("keeps oversight roles for admins", async () => {
    const admin = await person(["admin"]);
    const director = await person(["director"]);

    // A director can invite programme roles...
    const ok = await db.asUser(director.id, (q) => q("select public.invite_person('lead1@example.org', 'leader') as r"));
    expect(ok.rows[0].r.status).toBe("pending");

    // ...but not oversight roles.
    for (const role of ["admin", "director", "pastor"]) {
      await expectCode(
        db.asUser(director.id, (q) => q("select public.invite_person('lead2@example.org', $1::public.app_role)", [role])),
        "42501",
      );
    }

    // An admin can.
    const res = await db.asUser(admin.id, (q) => q("select public.invite_person('pastor@example.org', 'pastor') as r"));
    expect(res.rows[0].r.status).toBe("pending");
  });

  it("lets staff revoke a pending invitation, and then it cannot be claimed", async () => {
    const admin = await person(["admin"]);
    const res = await db.asUser(admin.id, (q) => q("select public.invite_person('changed.mind@example.org', 'leader') as r"));
    const id = res.rows[0].r.invitation_id;

    await db.asUser(admin.id, (q) => q("select public.revoke_invitation($1)", [id]));
    const user = await db.createUser({ email: "changed.mind@example.org" });
    const claimed = await db.asUser(user.id, (q) => q("select public.claim_invitations() as n"));
    expect(claimed.rows[0].n).toBe(0);

    // Revoking twice says so.
    await expectCode(db.asUser(admin.id, (q) => q("select public.revoke_invitation($1)", [id])), "P0002");
  });

  it("stops a director revoking an admin invitation", async () => {
    const admin = await person(["admin"]);
    const director = await person(["director"]);
    const res = await db.asUser(admin.id, (q) => q("select public.invite_person('future.admin@example.org', 'admin') as r"));
    await expectCode(
      db.asUser(director.id, (q) => q("select public.revoke_invitation($1)", [res.rows[0].r.invitation_id])),
      "42501",
    );
  });

  it("rejects invitation rows that skip the rules", async () => {
    await expectCode(
      db.admin.query(
        "insert into public.invitations (email, role, centre_id) select 'UPPER@example.org', 'leader', id from public.centres limit 1",
      ),
      "23514",
    );
    await expectCode(
      db.admin.query(
        "insert into public.invitations (email, role, centre_id) select 'x@example.org', 'member', id from public.centres limit 1",
      ),
      "23514",
    );
  });

  it("writes every grant to the event log", async () => {
    const admin = await person(["admin"]);
    await db.asUser(admin.id, (q) => q("select public.invite_person('logged@example.org', 'coach')"));
    const user = await db.createUser({ email: "logged@example.org" });
    await db.asUser(user.id, (q) => q("select public.claim_invitations()"));
    const { rows } = await db.admin.query(
      "select action, meta from public.event_log where action in ('invitation.created','role.granted') and (entity_id = $1 or actor_id = $2) order by id",
      [user.id, admin.id],
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("invitation.created");
    expect(actions).toContain("role.granted");
  });
});

describe("removing roles", () => {
  it("lets an admin remove a leader role and logs it", async () => {
    const admin = await person(["admin"]);
    const leader = await person(["leader"]);
    await db.asUser(admin.id, (q) => q("select public.revoke_role($1, 'leader')", [leader.id]));
    const { rows } = await db.admin.query("select role from public.person_roles where person_id = $1", [leader.id]);
    expect(rows.map((r) => r.role)).toEqual(["member"]);
    const log = await db.admin.query("select 1 from public.event_log where action = 'role.revoked' and entity_id = $1", [leader.id]);
    expect(log.rowCount).toBe(1);
  });

  it("never removes the member role", async () => {
    const admin = await person(["admin"]);
    const someone = await person();
    await expectCode(db.asUser(admin.id, (q) => q("select public.revoke_role($1, 'member')", [someone.id])), "22023");
  });

  it("stops a director removing an oversight role", async () => {
    const admin = await person(["admin", "pastor"]);
    const director = await person(["director"]);
    await expectCode(db.asUser(director.id, (q) => q("select public.revoke_role($1, 'admin')", [admin.id])), "42501");
    await expectCode(db.asUser(director.id, (q) => q("select public.revoke_role($1, 'pastor')", [admin.id])), "42501");
  });

  it("refuses to remove the last admin, but allows it once there are two", async () => {
    // Start from a clean database so we know exactly how many admins there are.
    const clean = await createTestDb();
    try {
      const first = await clean.createUser();
      await clean.grant(first.id, "admin");
      await expectCode(clean.asUser(first.id, (q) => q("select public.revoke_role($1, 'admin')", [first.id])), "23514");

      const second = await clean.createUser();
      await clean.grant(second.id, "admin");
      await clean.asUser(first.id, (q) => q("select public.revoke_role($1, 'admin')", [second.id]));

      // Back to one admin: protected again.
      await expectCode(clean.asUser(first.id, (q) => q("select public.revoke_role($1, 'admin')", [first.id])), "23514");
    } finally {
      await clean.close();
    }
  });

  it("says so when the person does not exist", async () => {
    const admin = await person(["admin"]);
    await expectCode(db.asUser(admin.id, (q) => q("select public.revoke_role(gen_random_uuid(), 'leader')")), "P0002");
  });
});

describe("first admin setup", () => {
  it("cannot be called from the app", async () => {
    const me = await person();
    await expectCode(db.asUser(me.id, (q) => q("select public.bootstrap_first_admin('me@example.org')")), "42501");
    await expectCode(db.asAnon((q) => q("select public.bootstrap_first_admin('me@example.org')")), "42501");
  });

  it("invites the first admin, then locks itself once an admin exists", async () => {
    const clean = await createTestDb();
    try {
      const msg = await clean.admin.query("select public.bootstrap_first_admin('Founder@Example.org') as m");
      expect(msg.rows[0].m).toMatch(/Invitation created/);

      const founder = await clean.createUser({ email: "founder@example.org" });
      const claimed = await clean.asUser(founder.id, (q) => q("select public.claim_invitations() as n"));
      expect(claimed.rows[0].n).toBe(1);
      const roles = await clean.admin.query("select role from public.person_roles where person_id = $1 order by role", [founder.id]);
      expect(names(roles.rows)).toEqual(["admin", "member"]);

      await expectCode(clean.admin.query("select public.bootstrap_first_admin('someone.else@example.org')"), "23505");
    } finally {
      await clean.close();
    }
  });

  it("grants straight away to an existing verified account", async () => {
    const clean = await createTestDb();
    try {
      const founder = await clean.createUser({ email: "founder2@example.org" });
      const msg = await clean.admin.query("select public.bootstrap_first_admin('founder2@example.org') as m");
      expect(msg.rows[0].m).toMatch(/Admin granted/);
      const roles = await clean.admin.query("select role from public.person_roles where person_id = $1 order by role", [founder.id]);
      expect(names(roles.rows)).toEqual(["admin", "member"]);
    } finally {
      await clean.close();
    }
  });

  it("rejects a bad email", async () => {
    const clean = await createTestDb();
    try {
      await expectCode(clean.admin.query("select public.bootstrap_first_admin('nope')"), "22023");
    } finally {
      await clean.close();
    }
  });
});

describe("locked-down defaults", () => {
  it("leaves no table readable or writable by visitors", async () => {
    const { rows } = await db.admin.query(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'`);
    expect(rows).toEqual([]);
  });

  it("has row level security on every public table", async () => {
    const { rows } = await db.admin.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it("makes every security-definer function pin its search path", async () => {
    const { rows } = await db.admin.query(`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it("starts future tables locked", async () => {
    await db.admin.query("create table public.future_table (id int)");
    const me = await person();
    await expectCode(db.asUser(me.id, (q) => q("select * from public.future_table")), "42501");
    await expectCode(db.asAnon((q) => q("select * from public.future_table")), "42501");
  });

  it("exposes only the functions the app calls, and to visitors only the referee and guardian links and the sending service", async () => {
    const allowed = new Set([
      "has_role",
      "has_any_role",
      "my_roles",
      "log_event",
      "invite_person",
      "revoke_invitation",
      "revoke_role",
      "claim_invitations",
      "has_consent",
      "intake_stats",
      // Phase 2: the Leader Portal
      "check_leader_eligibility",
      "set_referee",
      "submit_leader_application",
      "review_queue",
      "review_application",
      "save_review",
      "invite_to_interview",
      "clear_reference_concern",
      "decide_application",
      "add_interview_slot",
      "remove_interview_slot",
      "review_interviews",
      "my_interview_options",
      "book_interview_slot",
      "cancel_interview_booking",
      "leader_stats",
      // Round 2, Phase 1: the first check on a leader application
      "leader_ai_public_config",
      "leader_ai_status",
      "accept_leader_ai_consent",
      "resubmit_leader_answers",
      "ask_leader_person_look",
      "leader_ai_scorecard",
      "leader_ai_queue",
      "leader_ai_list",
      "leader_ai_overview",
      "leader_ai_set_settings",
      "leader_ai_set_mode",
      "leader_ai_clear",
      "leader_ai_send_back",
      "submit_reference",
      // Phase 3: the Leader Academy and Tribe Cards
      "my_academy",
      "academy_module",
      "submit_quiz",
      "sign_safeguarding",
      "add_academy_session",
      "remove_academy_session",
      "book_academy_session",
      "cancel_academy_booking",
      "mark_attendance",
      "academy_sessions_admin",
      "record_practice",
      "academy_cohort",
      "start_tribe_card",
      "my_tribe",
      "save_tribe_card",
      "submit_tribe_card",
      "tribe_queue",
      "suggest_assistants",
      "review_tribe",
      "decide_tribe_card",
      "pair_assistant",
      "unpair_assistant",
      "assign_coach",
      "academy_stats",
      // Phase 4: matching, choosing and joining
      "my_match",
      "match_me",
      "join_starter_list",
      "choose_tribe",
      "release_my_seat",
      "tribe_roster",
      "save_tribe_onboarding",
      "mark_member_called",
      "match_stats",
      // Phase 5: the weekly rhythm
      "my_week",
      "save_week_step",
      "save_checkin",
      "save_pulse",
      "submit_testimony",
      "withdraw_testimony",
      "tribe_testimonies",
      "review_testimony",
      "pending_testimonies",
      "tribe_week",
      "save_tribe_log",
      "record_call",
      "raise_concern",
      "refine_success_picture",
      "rhythm_digest",
      "care_queue",
      // Phase 6: dashboards and KPIs
      "dashboard",
      "tribe_progress",
      "my_progress",
      // Stage 2: messaging
      "my_contact",
      "save_contact",
      "save_checkin",
      "create_worker_token",
      "list_worker_tokens",
      "revoke_worker_token",
      "message_log",
      "message_stats",
      "retry_message",
      "save_tribe_meeting",
      // Stage 3: the season engine
      "tribe_log_extras",
      "answer_prayer",
      "remove_prayer",
      "my_care_tasks",
      "complete_care_task",
      "reassign_care_task",
      "care_task_stats",
      "care_task_options",
      "testimony_wall",
      "forward_testimony",
      "week_layer",
      // Stage 4: portraits
      "set_my_photo",
      "remove_my_photo",
      "my_photo_info",
      "photo_of",
      // Stage 5: insight
      "set_kpi_target",
      "reset_kpi_target",
      "kpi_target_list",
      "my_word_days",
      "save_word_days",
      "assign_community_champion",
      "remove_community_champion",
      "community_champion_list",
      "insight",
      "community_dashboard",
      "list_reports",
      "get_report",
      "generate_report",
      "set_report_summary",
      "bi_refresh",
      "bi_status",
      // Stage 6: the centres
      "my_centres",
      "switch_centre",
      "create_centre",
      // Stage 6: learning and scaling
      "retrain_preview",
      "list_models",
      "retrain_model",
      "activate_model",
      "discard_model",
      "my_swap",
      "request_swap",
      "start_swap_for",
      "cancel_swap",
      "swap_queue",
      "swap_members",
      "offer_swap",
      "decline_swap",
      "answer_swap",
      "multiplication_board",
      "plan_multiplication",
      "clear_multiplication_plan",
      "teen_track_open",
      "my_guardian",
      "request_guardian_consent",
      "guardian_overview",
      "verify_guardian",
      "reopen_guardian_request",
      // the office's own controls (Stage 7)
      "church_settings",
      "save_church_settings",
      "admin_seasons",
      "save_season",
      "set_season_status",
      "admin_catalogue",
      "save_community",
      "save_goal_family",
      "save_goal",
      "set_goal_active",
      "set_track_active",
      "goal_write_ins",
      "adopt_write_in",
      "dismiss_write_in",
      "admin_guides",
      "admin_guide",
      "save_week_guide",
      "mark_guide_reviewed",
      "admin_layers",
      "save_community_prompt",
      "save_goal_idea",
      "find_people",
      "platform_status",
      "launch_checklist",
      // a member's own copy of their data, and asking for erasure; the office answers (Stage 8)
      "export_my_data",
      "my_erasure_request",
      "request_erasure",
      "withdraw_erasure_request",
      "erasure_queue",
      "record_erasure_request",
      "decline_erasure",
      "erase_person",
      // the platform owner: every one of these refuses anyone who is not the owner and unlocked (Stage 9)
      "god_state",
      "god_unlock",
      "god_lock",
      "god_set_phrase",
      "god_overview",
      "god_feed",
      "god_people",
      "god_person",
      "god_tribes",
      "god_tribe",
      "god_log_list",
      // a parent or guardian answers by private link (the visitors below)
      "get_guardian_request",
      "answer_guardian_request",
      // The sending service has no account: its token is the credential (the visitors below)
      "worker_claim",
      "worker_report",
      "worker_provider_event",
      "worker_reply_info",
      "worker_checkin_reply",
      "worker_tick",
      "worker_status",
      "worker_opt_out",
      "worker_pending_summaries",
      "worker_set_summary",
      "worker_leader_check_state",
      "worker_record_answer_check",
      "worker_leader_print",
      "worker_pending_leader_jobs",
      "worker_save_leader_ai_score",
      "worker_fail_leader_job",
      "worker_leader_ai_alerts",
      // Round 2, Phase 6: sign-in codes. The website proves itself with the sending token; the office page checks the role itself
      "worker_signin_network_gate",
      "worker_signin_gate",
      "worker_signin_record",
      "worker_signin_hold",
      "worker_signin_release",
      "worker_signin_receipt",
      "worker_signin_stop",
      "worker_signin_sender_signal",
      "worker_signin_status",
      "worker_signin_tick",
      "signin_channel_status",
      "signin_admin_overview",
      "signin_admin_update",
      "signin_admin_reset",
      // Messages & reminders: office screens, and the sending token's calls
      "audience_preview",
      "audience_sample",
      "broadcast_save",
      "broadcast_get",
      "broadcast_submit",
      "broadcast_approve",
      "broadcast_reject",
      "broadcast_control",
      "broadcast_test_send",
      "broadcast_list",
      "broadcast_results",
      "broadcast_approvals",
      "audiences_list",
      "audience_save",
      "audience_delete",
      "my_email_switches",
      "save_email_switches",
      "reminders_overview",
      "journey_set_mode",
      "reminders_master",
      "journey_set_days",
      "reminder_settings_save",
      "journey_email_edit",
      "journey_email_approve",
      "journey_email_discard",
      "journey_email_history",
      "chat_open",
      "journey_people",
      "asks_queue",
      "ask_close",
      "worker_reminders_tick",
      "worker_link_open",
      "worker_link_confirm",
      "worker_unsubscribe_oneclick",
      "worker_prefs_save",
      "worker_email_signal",
      // Round 2, Phase 2: proving the referee is the person named
      "request_referee_send",
      "referee_note_applicant",
      "referee_import_preview",
      "referee_import_apply",
      "referee_import_undo",
      "referee_import_history",
      "referee_directory_list",
      "referee_directory_export",
      "referee_directory_save",
      "referee_directory_set_active",
      "referee_directory_delete",
      "referee_overview",
      "referee_settings_save",
      "referee_review",
      "referee_confirm_standing",
      "referee_flags_clear",
      "referee_unverified_list",
      "referee_reverify_send",
      "referee_reverify_all",
      "referee_callbacks_open",
      "referee_callback_close",
      "referee_open",
      "referee_ask_code",
      "referee_check_code",
      "referee_reverify_answer",
      "worker_referee_tick",
      // Round 2, Phase 5: the owner's activity dashboard. Every report refuses anyone who is not the unlocked owner (god_only);
      // the one door lets a signed-in person say which screen they opened; the heartbeat's refresh needs the sending token.
      "activity_track",
      "activity_pulse",
      "activity_brief",
      "activity_funnels",
      "activity_funnel_people",
      "activity_compare",
      "activity_retention",
      "activity_heatmap",
      "activity_stakeholders",
      "activity_integrity",
      "activity_messages",
      "activity_audit",
      "activity_audit_areas",
      "activity_settings_get",
      "activity_threshold_set",
      "activity_settings_set",
      "activity_viewed",
      "worker_activity_refresh",
      "ping",
      // Notices and the new Admin: what is waiting for the signed-in person, the switches, the log, and each team member's own choices.
      // Each checks the role itself; the engine behind them is not reachable at all.
      "admin_attention",
      "notice_overview",
      "notice_set_mode",
      "notice_log",
      "my_notice_prefs",
      "save_notice_pref",
      // Phase A: the switchboard for becoming a leader. Each of these checks the role itself.
      "leader_pipeline_public",
      "leader_pipeline_set",
      "leader_pipeline_preset",
      "leader_pipeline_log_list",
      "my_application_modes",
      "clear_referee",
      "set_evidence_note",
      "academy_switch",
      // Phase B: the Tribe Card catalogue and the compatibility test for leaders. Each of these checks the role itself.
      "card_template_list",
      "card_template_save",
      "card_template_sign_off",
      "card_template_sign_off_community",
      "card_template_retire",
      "card_template_create_for_goal",
      "card_template_for_tribe",
      "card_template_prefill",
      "leader_fit_run",
      "leader_fit_choose",
      "leader_fit_state",
      "leader_fit_panel",
      "leader_fit_models_list",
      "leader_fit_model_save",
      "leader_fit_model_activate",
      "leader_fit_quiet_all",
      "leader_fit_mine",
      "leader_fit_status",
      "god_appointment_find",
      "god_appointment_suggest",
      "god_appoint_leader",
      "god_appointment_list",
      "god_appointment_step_down",
      "tribe_appointment_note",
      "leader_board",
      "leader_suggest",
      "leader_offer_send",
      "leader_offer_withdraw",
      "leader_offers_list",
      "my_leader_offers",
      "leader_offer_respond",
      // God Mode oversight: each is owner-only (god_only first).
      "god_desks",
      "god_role_people",
      "god_messages",
      "god_chat_opens",
      "god_announcements",
      "god_looked",
      // Automatic placement, bulk leaders and assistant recommendations: the console's functions each begin god_only(); the leader's and
      // member's own calls check who is asking; the office's assistant functions check the role
      "god_start_leader_card",
      "placement_adjust",
      "placement_hold_clear",
      "placement_hold_set",
      "placement_holds_list",
      "placement_leaders_adjust",
      "placement_leaders_apply",
      "placement_leaders_approve",
      "placement_leaders_cancel",
      "placement_leaders_options",
      "placement_leaders_plan",
      "placement_leaders_view",
      "placement_options",
      "placement_overview",
      "placement_resolve_small",
      "placement_run_approve",
      "placement_run_cancel",
      "placement_run_items",
      "placement_run_new",
      "placement_run_place",
      "placement_run_step",
      "placement_run_view",
      "placement_settings_get",
      "placement_settings_save",
      "placement_undo",
      "my_placement",
      "placement_my_confirm",
      "placement_my_withhold",
      "tribe_roster_marked",
      "tribe_week_marked",
      "assistant_recommend",
      "assistant_withdraw",
      "assistant_my_state",
      "assistant_requests",
      "assistant_decide",
    ]);
    // The only things someone who is not signed in may do: open a referee or guardian link and
    // answer it, and the sending service's calls. Each needs a secret: the link's, or the sending token.
    const visitors = new Set([
      "referee_open",
      "referee_ask_code",
      "referee_check_code",
      "referee_reverify_answer",
      "worker_referee_tick",
      "submit_reference",
      "get_guardian_request",
      "answer_guardian_request",
      "worker_claim",
      "worker_report",
      "worker_provider_event",
      "worker_reply_info",
      "worker_checkin_reply",
      "worker_tick",
      "worker_status",
      "worker_opt_out",
      "worker_pending_summaries",
      "worker_set_summary",
      "worker_leader_check_state",
      "worker_record_answer_check",
      "worker_leader_print",
      "worker_pending_leader_jobs",
      "worker_save_leader_ai_score",
      "worker_fail_leader_job",
      "worker_leader_ai_alerts",
      // Round 2, Phase 6: sign-in codes. Anyone may ask whether WhatsApp sign-in is on; the rest need the sending token
      "worker_signin_network_gate",
      "worker_signin_gate",
      "worker_signin_record",
      "worker_signin_hold",
      "worker_signin_release",
      "worker_signin_receipt",
      "worker_signin_stop",
      "worker_signin_sender_signal",
      "worker_signin_status",
      "worker_signin_tick",
      "signin_channel_status",
      // Messages & reminders: the email pages and the sending service, each behind a secret
      "worker_reminders_tick",
      "worker_link_open",
      "worker_link_confirm",
      "worker_unsubscribe_oneclick",
      "worker_prefs_save",
      "worker_email_signal",
      // Round 2, Phase 5: the heartbeat rebuilds the owner's activity summaries (needs the sending token)
      "worker_activity_refresh",
      // The heartbeat sweeps for the team's timed notices and summaries (needs the sending token)
      "worker_notice_sweep",
      // The private "your tribe" page and the heartbeat's placement and assistant steps (each needs the sending token or the link's secret)
      "worker_placed_change",
      "worker_placed_confirm",
      "worker_placed_info",
      "worker_placed_withhold",
      "worker_placement_tick",
      "worker_assistant_tick",
      "ping",
    ]);
    const { rows } = await db.admin.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.anon, `${row.proname} visitor access`).toBe(visitors.has(row.proname));
      expect(row.authenticated, `${row.proname} access`).toBe(allowed.has(row.proname));
    }
  });
});
