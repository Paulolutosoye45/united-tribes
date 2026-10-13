import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

let db: TestDb;
let token: string;

beforeAll(async () => {
  db = await createTestDb();
  token = (await db.admin.query("select public.bootstrap_worker_token('ops-test') as t")).rows[0].t;
});

afterAll(async () => {
  await db.close();
});

const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
const asWorker = async (text: string, params: unknown[] = [], tok = token) => (await db.asAnon((q) => q(text, [tok, ...params]))).rows[0]?.r;

async function person(name: string, email?: string) {
  const u = await db.createUser();
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3, email = coalesce($4, email) where id = $1", [u.id, `${name} Test`, name, email ?? null]);
  return u;
}
const consent = (id: string, purpose: string, granted: boolean) =>
  db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, $2, $3, 'test')", [id, purpose, granted]);

describe("ping", () => {
  it("answers a visitor with a bare yes", async () => {
    const r = (await db.asAnon((q) => q("select public.ping() as r"))).rows[0].r;
    expect(r).toEqual({ ok: true });
  });
});

describe("worker_status", () => {
  it("refuses a wrong or missing token", async () => {
    await expectCode(db.asAnon((q) => q("select public.worker_status($1)", ["x".repeat(40)])), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_status(null)")), "42501");
  });

  it("counts what is due, stuck and failed, without any names", async () => {
    const u = await person("Ada");
    await db.admin.query("insert into public.messages (person_id, template, scheduled_for) values ($1, 'welcome', now() - interval '30 minutes')", [u.id]);
    await db.admin.query("insert into public.messages (person_id, template, status, claimed_at) values ($1, 'welcome', 'sending', now() - interval '20 minutes')", [u.id]);
    await db.admin.query("insert into public.messages (person_id, template, status, error) values ($1, 'welcome', 'failed', 'x')", [u.id]);
    const r = await asWorker("select public.worker_status($1) as r");
    expect(r.due).toBeGreaterThanOrEqual(1);
    expect(r.oldest_due_minutes).toBeGreaterThanOrEqual(29);
    expect(r.stuck).toBe(1);
    expect(r.failed_24h).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/Ada/);
  });
});

describe("a number given in the join form", () => {
  it("becomes the number we reach the person on, and follows a change", async () => {
    const u = await person("Chi");
    const one = async (table: string, slug: string) => (await sql(`select id from public.${table} where slug = $1`, [slug]))[0].id as string;
    const community = await one("communities", "professionals");
    const goal = await one("season_goals", "step-into-a-leadership-role");
    const age = await one("age_ranges", "33-40");
    await consent(u.id, "matching", true);
    await consent(u.id, "whatsapp", true);
    await db.admin.query(
      `insert into public.member_profiles (person_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id,
          goal_baseline, meeting_mode, meeting_times, duration_seconds, whatsapp)
       values ($1, $2, 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'online', array['sunday-afternoon'], 280, '+2348031234567')`,
      [u.id, age, community, goal],
    );
    expect((await sql("select phone, preferred from public.contact_preferences where person_id = $1", [u.id]))[0]).toEqual({ phone: "+2348031234567", preferred: "whatsapp" });

    await db.admin.query("update public.member_profiles set whatsapp = '+2348099999999' where person_id = $1", [u.id]);
    expect((await sql("select phone from public.contact_preferences where person_id = $1", [u.id]))[0].phone).toBe("+2348099999999");

    // Withdrawing WhatsApp clears the profile copy; the person's chosen contact details are theirs to change.
    await consent(u.id, "whatsapp", false);
    expect((await sql("select whatsapp from public.member_profiles where person_id = $1", [u.id]))[0].whatsapp).toBeNull();
    expect((await sql("select public.consent_granted($1, 'whatsapp') as r", [u.id]))[0].r).toBe(false);
  });
});

describe("worker_opt_out", () => {
  it("withdraws WhatsApp for the person with that number, and for nobody else", async () => {
    const a = await person("Dayo");
    const b = await person("Efe");
    for (const [u, phone] of [[a, "+2348011111111"], [b, "+2348022222222"]] as const) {
      await db.admin.query("insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, 'whatsapp')", [u.id, phone]);
      await consent(u.id, "whatsapp", true);
    }
    // Meta sends the number without the plus sign
    const n = await asWorker("select public.worker_opt_out($1, $2, null, 'whatsapp') as r", ["2348011111111"]);
    expect(n).toBe(1);
    const latest = async (id: string) =>
      (await sql("select granted from public.consents where person_id = $1 and purpose = 'whatsapp' order by id desc limit 1", [id]))[0].granted;
    expect(await latest(a.id)).toBe(false);
    expect(await latest(b.id)).toBe(true);
    // saying it twice changes nothing
    expect(await asWorker("select public.worker_opt_out($1, $2, null, 'whatsapp') as r", ["2348011111111"])).toBe(0);
    expect(await sql("select 1 from public.event_log where action = 'contact.opt_out' and actor_id = $1", [a.id])).not.toHaveLength(0);
  });

  it("stops email to an address that marked a message as spam", async () => {
    const u = await person("Gozie", "gozie@example.org");
    expect(await asWorker("select public.worker_opt_out($1, null, $2, 'email') as r", ["GOZIE@example.org"])).toBe(1);
    expect((await sql("select public.email_opted_out($1) as r", [u.id]))[0].r).toBe(true);
  });

  it("refuses an unknown channel, a wrong token, and matches nobody on a too-short value", async () => {
    await expectCode(db.asAnon((q) => q("select public.worker_opt_out($1, '2348011111111', null, 'pigeon')", [token])), "22023");
    await expectCode(db.asAnon((q) => q("select public.worker_opt_out($1, '2348011111111', null, 'sms')", ["y".repeat(40)])), "42501");
    expect(await asWorker("select public.worker_opt_out($1, '123', null, 'sms') as r")).toBe(0);
  });
});
