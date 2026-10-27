import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeOwner, type OwnerKit } from "./activity-kit";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// An appointed leader can see that they were appointed (the tribe's name, where its card stands, whether they are certified) and nothing
// else, and cannot start an application they do not need. Everything an appointment already did is left as it was.

let db: TestDb;
let k: Kit;
let o: OwnerKit;
let pastor: string;
let n = 0;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;

const FORM = { track: "builders", lead_best: "connection", community: "professionals", goal: "step-into-a-leadership-role", relation: "achieved" };
const NOTE = "Known to the church for years, asked by the pastor.";
const goalId = async (slug: string) => (await one("select id from public.season_goals where slug = $1", [slug])).id as string;

async function candidate(name = `Candidate${++n}`) {
  const u = await k.person(name);
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Surname`, name]);
  return u;
}
async function appoint(name: string, note: string | null = NOTE) {
  const p = await candidate(name);
  const r = await o.call("god_appoint_leader", p.id, JSON.stringify(FORM), await goalId(FORM.goal), note);
  expect(r).toMatchObject({ ok: true });
  return { ...p, appointment: (await one("select id, tribe_id from public.leader_appointments where person_id = $1 and status = 'active'", [p.id])) as Row };
}
const apply = (uid: string) =>
  db.asUser(uid, (q) => q("insert into public.leader_applications (person_id, step, answers, consent_version) values ($1, 'eligibility', '{}'::jsonb, 'test')", [uid]));

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  o = await makeOwner(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  for (const c of await sql("select id from public.communities")) await call(pastor, "card_template_sign_off_community", [c.id]);
  for (const t of await sql("select slug from public.tribe_card_templates where status <> 'signed_off'")) await call(pastor, "card_template_sign_off", [t.slug]);
  // The pastorate has approved a fit model, as it must before anyone can be appointed
  await call(pastor, "leader_fit_model_activate", ["lf-1"]);
  for (const [slug, waiting] of [["build-a-steady-client-pipeline", 6], ["land-my-first-three-clients", 4], ["strengthen-our-marriage", 3], ["grow-a-network-that-opens-doors", 2]] as const) {
    const g = await goalId(slug);
    for (let i = 0; i < waiting; i++) {
      const u = await k.person(`Waiting${++n}`);
      await sql(
        "insert into public.match_demand (person_id, season_id, season_goal_id, community_id, tribe_kind, shown) select $1, s.id, g.id, g.community_id, 'any', 0 from public.season_goals g, public.seasons s where g.id = $2 and s.status in ('planning','open') order by s.starts_on limit 1",
        [u.id, g],
      );
    }
  }
});

afterAll(async () => {
  await db?.close();
});

describe("who can ask", () => {
  it("gives nothing to a member, to a leader who was not appointed, or to a pastor", async () => {
    const member = await k.person("Plain");
    const lead = await k.staff("Ordinary", "leader");
    for (const who of [member.id, lead.id, pastor]) expect(await call(who, "my_appointment")).toBeNull();
  });

  it("is closed to visitors", async () => {
    await expectCode(db.asAnon((q) => q("select public.my_appointment()")), "42501");
  });

  it("keeps the guard function out of every client's reach", async () => {
    const r = await one(
      "select has_function_privilege('authenticated', 'public.guard_application_appointee()', 'execute') a, has_function_privilege('anon', 'public.guard_application_appointee()', 'execute') b",
    );
    expect(r).toEqual({ a: false, b: false });
  });
});

describe("what an appointed leader is told", () => {
  it("says which tribe, where its card stands, and that they are not certified yet, and nothing more", async () => {
    const ada = await appoint("Ada");
    const mine = await call(ada.id, "my_appointment");
    expect(mine).toEqual({ tribe_name: "Ada’s Professionals tribe", tribe_status: "draft", certified: false });
  });

  it("never says who appointed them, the owner's note, or the form the owner filled in", async () => {
    const bea = await appoint("Bea");
    const mine = await call(bea.id, "my_appointment");
    expect(Object.keys(mine).sort()).toEqual(["certified", "tribe_name", "tribe_status"]);
    const text = JSON.stringify(mine);
    for (const secret of [o.owner.id, "The Owner", "Owner", "owner@", NOTE, "Known to the church", "appointed_by", "lead_best", "connection", "care_cleared"]) {
      expect(text, secret).not.toContain(secret);
    }
    // and the function itself never reads those columns
    const def = (await one("select pg_get_functiondef('public.my_appointment()'::regprocedure) as d")).d as string;
    expect(def).not.toMatch(/appointed_by|\.note|\.form|care_cleared|platform_owner|god_log/);
  });

  it("follows the card and the certificate", async () => {
    const cal = await appoint("Cal");
    const tribe = cal.appointment.tribe_id as string;
    // A card in front of the pastorate must be complete, so the leader's own part is filled in first
    await sql(
      "update public.tribes set story = $2, meeting_day = 0, meeting_time = '16:00', slot = 'sunday-afternoon', meeting_mode = 'online', zone = 'mainland' where id = $1",
      [tribe, "We walk through leading with others, week by week, in a small group."],
    );
    for (const status of ["submitted", "changes_requested", "approved"] as const) {
      await sql("update public.tribes set status = $2 where id = $1", [tribe, status]);
      expect((await call(cal.id, "my_appointment")).tribe_status).toBe(status);
    }
    await sql("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [cal.id]);
    expect(await call(cal.id, "my_appointment")).toEqual({ tribe_name: "Cal’s Professionals tribe", tribe_status: "approved", certified: true });
  });

  it("says nothing about a card that was closed, but still says they are appointed", async () => {
    const dee = await appoint("Dee");
    await sql("update public.tribes set status = 'closed' where id = $1", [dee.appointment.tribe_id]);
    expect(await call(dee.id, "my_appointment")).toEqual({ tribe_name: null, tribe_status: null, certified: false });
  });

  it("is only for the person themselves: nobody sees another leader's appointment", async () => {
    const eve = await appoint("Eve");
    const fay = await appoint("Fay");
    expect((await call(eve.id, "my_appointment")).tribe_name).toBe("Eve’s Professionals tribe");
    expect((await call(fay.id, "my_appointment")).tribe_name).toBe("Fay’s Professionals tribe");
  });

  it("goes quiet when the appointment ends, and when the leader role is gone", async () => {
    const gus = await appoint("Gus");
    expect(await call(gus.id, "my_appointment")).not.toBeNull();
    await o.call("god_appointment_step_down", gus.appointment.id, "Changed jobs");
    expect(await call(gus.id, "my_appointment")).toBeNull();

    const hal = await appoint("Hal");
    await sql("delete from public.person_roles where person_id = $1 and role = 'leader'", [hal.id]);
    expect(await call(hal.id, "my_appointment")).toBeNull();
  });
});

describe("no application for someone who has been appointed", () => {
  it("refuses a new application, in words, and writes nothing", async () => {
    const ivy = await appoint("Ivy");
    await expect(apply(ivy.id)).rejects.toThrow(/appointed to lead, so there is no application to send/);
    await expectCode(apply(ivy.id), "22023");
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1", [ivy.id])).toBe(0);
  });

  it("does not tell the office a new application was sent, because none was", async () => {
    const jon = await appoint("Jon");
    const before = await count("select count(*)::int c from public.notice_items where kind = 'admin_application_sent'");
    await apply(jon.id).catch(() => undefined);
    expect(await count("select count(*)::int c from public.notice_items where kind = 'admin_application_sent'")).toBe(before);
  });

  it("leaves everyone else free to apply", async () => {
    const plain = await candidate("Plain2");
    await apply(plain.id);
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1 and status = 'draft'", [plain.id])).toBe(1);
    const lead = await k.staff("Ordinary2", "leader");
    await apply(lead.id);
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1", [lead.id])).toBe(1);
  });

  it("leaves an application begun before the appointment alone, and lets them delete it", async () => {
    const kim = await candidate("Kim");
    await apply(kim.id);
    const r = await o.call("god_appoint_leader", kim.id, JSON.stringify(FORM), await goalId(FORM.goal), null);
    expect(r).toMatchObject({ ok: true });
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1", [kim.id])).toBe(1);
    expect((await call(kim.id, "my_appointment")).tribe_name).toBe("Kim’s Professionals tribe");
    const gone = await db.asUser(kim.id, (q) => q("delete from public.leader_applications where person_id = $1 returning id", [kim.id]));
    expect(gone.rowCount).toBe(1);
  });

  it("lets the office load an application directly, as before", async () => {
    const lou = await appoint("Lou");
    await sql(
      "insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at) values ($1, 'not_approved', 'review', '{}'::jsonb, 'test', now(), now())",
      [lou.id],
    );
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1", [lou.id])).toBe(1);
  });

  it("lets them apply again after they have stepped down", async () => {
    const meg = await appoint("Meg");
    await expect(apply(meg.id)).rejects.toThrow(/appointed to lead/);
    await o.call("god_appointment_step_down", meg.appointment.id, null);
    await apply(meg.id);
    expect(await count("select count(*)::int c from public.leader_applications where person_id = $1", [meg.id])).toBe(1);
  });
});

describe("the owner's own view is unchanged", () => {
  it("still lists the appointment, with the note, and the office still sees the same sentence", async () => {
    const list = await o.call("god_appointment_list");
    expect(list.some((a: Row) => a.note === NOTE)).toBe(true);
    const ada = list.find((a: Row) => a.person.name === "Ada Surname");
    const note = await call(pastor, "tribe_appointment_note", [ada.tribe.id]);
    expect(note.text).toBe("This leader was appointed by an administrator. There is no application behind this card.");
  });

  it("is not described to the owner's own session, which has no appointment", async () => {
    expect(await db.asUser(o.owner.id, (q) => q("select public.my_appointment() as r"), { session: randomUUID() }).then((r) => r.rows[0].r)).toBeNull();
  });
});
