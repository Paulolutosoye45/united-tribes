import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { wordingProblems } from "./contract";

let db: TestDb;
let seasonId: string;
let trackId: string;
let communityId: string;
let goalId: string;
let token: string;
let n = 0;
const NOON = "create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select 12 $$";

// A Sunday, so "Monday" is day 1 of the week, "Friday" day 5, and so on.
const START = "2027-02-14";
/** Lagos wall-clock time on a given day offset from the season start. */
const lagos = (dayOffset: number, hhmm: string) => {
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00+01:00`;
};

beforeAll(async () => {
  db = await createTestDb();
  const season = (await db.admin.query("select id from public.seasons order by starts_on limit 1")).rows[0];
  seasonId = season.id;
  await db.admin.query("update public.seasons set starts_on = $2, ends_on = ($2::date + 83) where id = $1", [seasonId, START]);
  trackId = (await db.admin.query("select id from public.tracks where slug = 'builders'")).rows[0].id;
  communityId = (await db.admin.query("select id from public.communities where slug = 'professionals'")).rows[0].id;
  goalId = (await db.admin.query("select id from public.season_goals where slug = 'step-into-a-leadership-role'")).rows[0].id;
  token = (await db.admin.query("select public.bootstrap_worker_token('test') as t")).rows[0].t;
  // Midday in Lagos for every test, so none depends on the hour it is run (between 22:00 and 06:00 only urgent messages go out). The one test of the
  // quiet hours sets its own hour and puts this one back.
  await db.admin.query(NOON);
});

afterAll(async () => {
  await db.close();
});

async function person(name: string, opts: { roles?: string[] } = {}) {
  const u = await db.createUser();
  await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Test`, name]);
  for (const r of opts.roles ?? []) await db.grant(u.id, r);
  return u;
}

async function makeTribe(o: { coach?: string; assistant?: string; day?: number; time?: string } = {}) {
  const leader = await person(`Leader${++n}`, { roles: ["leader"] });
  const { rows } = await db.admin.query(
    `insert into public.tribes (season_id, leader_id, assistant_id, coach_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
        meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
     values ($1, $2, $3, $4, 'approved', $5, $6, $7, $8, '{}', 'mixed', 'My story.', $9, $10, 'weeknight-evening', 'online', 'mainland',
             'Online', 12, 'Pray daily.', 'Call each other.', 'Take one step a week.', now())
     returning id`,
    [seasonId, leader.id, o.assistant ?? null, o.coach ?? null, `Tribe ${n}`, trackId, communityId, goalId, o.day ?? 3, o.time ?? "20:00"],
  );
  return { leader, tribe: rows[0].id as string };
}

async function join(tribe: string, name: string) {
  const u = await person(name);
  await db.admin.query(
    `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
     values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
    [tribe, u.id, seasonId],
  );
  return u;
}

const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
const msgs = (template: string, tribe?: string) =>
  sql(
    `select m.*, public.first_name_of(m.person_id) as who from public.messages m
      where m.template = $1 and ($2::uuid is null or m.tribe_id = $2) order by m.created_at, m.id`,
    [template, tribe ?? null],
  );
const tick = async (at: string) => (await sql("select public.run_calendar($1::timestamptz) as r", [at]))[0].r as { queued: number };
const asWorker = async (text: string, params: unknown[] = [], tok = token) =>
  (await db.asAnon((q) => q(text, [tok, ...params]))).rows[0]?.r;
const claim = (limit = 50) => asWorker("select public.worker_claim($1, $2) as r", [limit]) as Promise<Row[]>;
const report = (id: string, outcome: string, provider: string | null = null, error: string | null = null) =>
  asWorker("select public.worker_report($1, $2, $3, $4, $5)", [id, outcome, provider, error]);
const consent = (person: string, purpose: string, granted: boolean) =>
  db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, $2, $3, 'test')", [person, purpose, granted]);
const setPhone = (person: string, phone: string, preferred = "whatsapp") =>
  db.admin.query(
    "insert into public.contact_preferences (person_id, phone, preferred) values ($1, $2, $3) on conflict (person_id) do update set phone = $2, preferred = $3",
    [person, phone, preferred],
  );
const enqueue = (person: string, template: string, extra: { dedupe?: string; urgency?: string; force?: string; params?: object } = {}) =>
  sql("select public.enqueue_message($1, $2, $3::jsonb, null, $4, null, $5, $6) as id", [
    person, template, JSON.stringify(extra.params ?? {}), extra.dedupe ?? null, extra.urgency ?? "normal", extra.force ?? null,
  ]).then((r) => r[0].id as string | null);
const status = async (id: string) => (await sql("select * from public.messages where id = $1", [id]))[0];

// ---------------------------------------------------------------------------

describe("contact preferences", () => {
  it("saves a number and records each yes or no in the consent ledger", async () => {
    const u = await person("Ada");
    const r = (await db.asUser(u.id, (q) => q("select public.save_contact('+234 803 123 4567', 'whatsapp', true, false, true) as r"))).rows[0].r;
    expect(r).toMatchObject({ phone: "+2348031234567", preferred: "whatsapp", whatsapp: true, sms: false, email_ok: true });
    const ledger = await sql("select purpose, granted from public.consents where person_id = $1 order by id", [u.id]);
    expect(ledger).toEqual([{ purpose: "whatsapp", granted: true }]);
    // changing nothing adds nothing
    await db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'whatsapp', true, false, true)"));
    expect(await sql("select 1 from public.consents where person_id = $1", [u.id])).toHaveLength(1);
    // withdrawing is recorded
    await db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'email', false, false, true)"));
    expect((await sql("select granted from public.consents where person_id = $1 and purpose = 'whatsapp' order by id desc limit 1", [u.id]))[0].granted).toBe(false);
  });

  it("refuses a number it cannot use, and a channel with no number", async () => {
    const u = await person("Bayo");
    await expectCode(db.asUser(u.id, (q) => q("select public.save_contact('0803', 'whatsapp', true, false, true)")), "22023");
    await expectCode(db.asUser(u.id, (q) => q("select public.save_contact(null, 'whatsapp', true, false, true)")), "22023");
    await expectCode(db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'carrier-pigeon', true, false, true)")), "22023");
    await expectCode(db.asAnon((q) => q("select public.my_contact()")), "42501");
  });

  it("moves the preferred channel off one the person switched off", async () => {
    const u = await person("Chi");
    const r = (await db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'sms', false, false, true) as r"))).rows[0].r;
    expect(r.preferred).toBe("email");
  });

  it("keeps the number a leader sees in step, and takes it away on withdrawal", async () => {
    const u = await person("Dami");
    await db.admin.query("update public.seasons set starts_on = $1 where id = $2", [START, seasonId]);
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id, goal_baseline, meeting_mode)
       select $1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either'`,
      [u.id, seasonId, communityId, goalId],
    );
    await db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'whatsapp', true, false, true)"));
    expect((await sql("select whatsapp from public.member_profiles where person_id = $1", [u.id]))[0].whatsapp).toBe("+2348031234567");
    await db.asUser(u.id, (q) => q("select public.save_contact('+2348031234567', 'email', false, false, true)"));
    expect((await sql("select whatsapp from public.member_profiles where person_id = $1", [u.id]))[0].whatsapp).toBeNull();
  });
});

describe("the sending token", () => {
  it("is created once from the SQL editor, stored only as a hash, and checked on every call", async () => {
    expect(token).toMatch(/^utw_[0-9a-f]{64}$/);
    const stored = await sql("select token_hash from public.worker_tokens");
    expect(stored.every((r) => r.token_hash !== token && !String(r.token_hash).includes(token))).toBe(true);
    await expectCode(db.admin.query("select public.bootstrap_worker_token('again')"), "23505");
    await expectCode(db.asAnon((q) => q("select public.worker_claim('utw_not_a_real_token_0000000000000000000000', 5)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_claim('short', 5)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_claim(null, 5)")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_tick('utw_not_a_real_token_0000000000000000000000')")), "42501");
    expect(Array.isArray(await claim(1))).toBe(true);
    expect((await sql("select last_used_at from public.worker_tokens"))[0].last_used_at).not.toBeNull();
  });

  it("is managed by an admin only, and a revoked token stops working", async () => {
    const admin = await person("Admin", { roles: ["admin"] });
    const pastor = await person("Pastor", { roles: ["pastor", "director"] });
    for (const call of ["select public.create_worker_token('x1')", "select public.list_worker_tokens()"]) {
      await expectCode(db.asUser(pastor.id, (q) => q(call)), "42501");
    }
    const second = (await db.asUser(admin.id, (q) => q("select public.create_worker_token('second') as t"))).rows[0].t as string;
    expect(second).toMatch(/^utw_/);
    expect(await asWorker("select public.worker_claim($1, 1) as r", [], second)).toEqual([]);
    const list = (await db.asUser(admin.id, (q) => q("select public.list_worker_tokens() as r"))).rows[0].r as Row[];
    expect(list.map((t) => t.label).sort()).toEqual(["second", "test"]);
    expect(JSON.stringify(list)).not.toContain(second);
    const id = list.find((t) => t.label === "second")!.id;
    await expectCode(db.asUser(pastor.id, (q) => q("select public.revoke_worker_token($1)", [id])), "42501");
    await db.asUser(admin.id, (q) => q("select public.revoke_worker_token($1)", [id]));
    await expectCode(db.asAnon((q) => q("select public.worker_claim($1, 1)", [second])), "42501");
    expect(await claim(1)).toBeDefined();
  });

  it("keeps the tables out of the app's reach", async () => {
    const u = await person("Nosy");
    for (const t of ["messages", "worker_tokens", "contact_preferences", "calendar_runs"]) {
      await expectCode(db.asUser(u.id, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${t}`)), "42501");
    }
    await expectCode(db.asUser(u.id, (q) => q("select public.run_calendar(now())")), "42501");
    await expectCode(db.asUser(u.id, (q) => q("select public.enqueue_message($1, 'welcome')", [u.id])), "42501");
  });
});

describe("choosing the channel", () => {
  it("uses email for someone who has agreed to nothing else", async () => {
    const u = await person("Emeka");
    const id = (await enqueue(u.id, "welcome"))!;
    const [m] = await claim();
    expect(m).toMatchObject({ id, template: "welcome", channel: "email" });
    expect(m.to.email).toMatch(/@example\.org$/);
    expect(m.to.first_name).toBe("Emeka");
    expect((await status(id)).status).toBe("sending");
    await report(id, "sent", "email-1");
    expect(await status(id)).toMatchObject({ status: "sent", provider_id: "email-1" });
  });

  it("puts WhatsApp first only when there is a number AND a yes", async () => {
    const a = await person("Funke");
    await setPhone(a.id, "+2348031110001");
    const withoutYes = (await enqueue(a.id, "welcome"))!;
    expect((await claim()).find((x) => x.id === withoutYes)!.channel).toBe("email");

    const b = await person("Gozie");
    await setPhone(b.id, "+2348031110002");
    await consent(b.id, "whatsapp", true);
    const id = (await enqueue(b.id, "welcome"))!;
    const got = (await claim()).find((x) => x.id === id)!;
    expect(got.channel).toBe("whatsapp");
    expect(got.to.phone).toBe("+2348031110002");
  });

  it("honours the preferred channel, and checks the yes at the moment of sending", async () => {
    const u = await person("Halima");
    await setPhone(u.id, "+2348031110003", "email");
    await consent(u.id, "whatsapp", true);
    const first = (await enqueue(u.id, "welcome"))!;
    expect((await claim()).find((x) => x.id === first)!.channel).toBe("email");

    await setPhone(u.id, "+2348031110003", "whatsapp");
    const later = (await enqueue(u.id, "triad_prompt"))!;
    // withdrawn after it was queued, before it was sent
    await consent(u.id, "whatsapp", false);
    expect((await claim()).find((x) => x.id === later)!.channel).toBe("email");
  });

  it("falls back to the next channel when one is rejected, and fails when none are left", async () => {
    const u = await person("Ife");
    await setPhone(u.id, "+2348031110004");
    await consent(u.id, "whatsapp", true);
    const id = (await enqueue(u.id, "welcome"))!;
    expect((await claim()).find((x) => x.id === id)!.channel).toBe("whatsapp");
    await report(id, "rejected", null, "meta 131026");
    expect(await status(id)).toMatchObject({ status: "queued", tried: ["whatsapp"], error: "meta 131026" });
    expect((await claim()).find((x) => x.id === id)!.channel).toBe("email");
    await report(id, "rejected", null, "bounced");
    expect(await status(id)).toMatchObject({ status: "failed", tried: ["whatsapp", "email"] });
  });

  it("sends a text only to someone who agreed to texts", async () => {
    const u = await person("Jide");
    await setPhone(u.id, "+2348031110005", "sms");
    await consent(u.id, "email", false);
    const id = (await enqueue(u.id, "welcome"))!;
    // no yes to texts, email switched off: nothing to send on
    await claim();
    expect(await status(id)).toMatchObject({ status: "skipped" });
    await consent(u.id, "sms", true);
    const again = (await enqueue(u.id, "triad_prompt"))!;
    expect((await claim()).find((x) => x.id === again)!.channel).toBe("sms");
  });

  it("sends an urgent alert on email AND text, whatever the person's own settings", async () => {
    const lead = await person("Kofi", { roles: ["care_lead"] });
    await setPhone(lead.id, "+2348031110006", "email");
    await consent(lead.id, "email", false);
    const email = (await enqueue(lead.id, "care_urgent", { urgency: "urgent", force: "email", dedupe: "u:1:e" }))!;
    const text = (await enqueue(lead.id, "care_urgent", { urgency: "urgent", force: "sms", dedupe: "u:1:s" }))!;
    const got = await claim();
    expect(got.find((x) => x.id === email)!.channel).toBe("email");
    expect(got.find((x) => x.id === text)!.channel).toBe("sms");
  });

  it("marks an urgent message failed, not skipped, when there is no way to reach the person", async () => {
    const lead = await person("Lami", { roles: ["care_lead"] });
    const id = (await enqueue(lead.id, "care_urgent", { urgency: "urgent", force: "sms", dedupe: "u:2" }))!;
    await claim();
    expect(await status(id)).toMatchObject({ status: "failed" });
  });

  it("reaches someone with no account at the address given", async () => {
    const id = (await sql(
      "select public.enqueue_message(null, 'welcome', '{\"tribe\":\"Builders\"}'::jsonb, null, 'ref:x', null, 'normal', null, 'Ref@Example.org', null, 'Pastor Ref') as id",
    ))[0].id;
    const got = (await claim()).find((x) => x.id === id)!;
    expect(got).toMatchObject({ channel: "email", to: { email: "ref@example.org", name: "Pastor Ref", first_name: "Pastor" } });
    await report(id, "sent", "r1");
  });

  it("will not queue a message for no one", async () => {
    expect((await sql("select public.enqueue_message(null, 'welcome') as id"))[0].id).toBeNull();
  });
});

describe("queue behaviour", () => {
  it("queues a message once however many times a rule runs", async () => {
    const u = await person("Mide");
    const first = await enqueue(u.id, "welcome", { dedupe: "same-key" });
    const second = await enqueue(u.id, "welcome", { dedupe: "same-key" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await sql("select 1 from public.messages where dedupe_key = 'same-key'")).toHaveLength(1);
  });

  it("holds ordinary messages overnight in Lagos and lets urgent ones through", async () => {
    const u = await person("Nkem");
    const calm = (await enqueue(u.id, "welcome"))!;
    const urgent = (await enqueue(u.id, "care_urgent", { urgency: "urgent", force: "email", dedupe: "u:night" }))!;
    await db.admin.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 23 $$");
    const night = await claim();
    expect(night.some((x) => x.id === calm)).toBe(false);
    expect(night.some((x) => x.id === urgent)).toBe(true);
    await db.admin.query("create or replace function public.lagos_hour() returns integer language sql as $$ select 6 $$");
    expect((await claim()).some((x) => x.id === calm)).toBe(true);
    await db.admin.query(NOON);
  });

  it("retries a hiccup a little later, three times, then moves on", async () => {
    const u = await person("Ola");
    const id = (await enqueue(u.id, "welcome"))!;
    for (let attempt = 1; attempt <= 2; attempt++) {
      expect((await claim()).some((x) => x.id === id)).toBe(true);
      await report(id, "retry", null, "timeout");
      const row = await status(id);
      expect(row.status).toBe("queued");
      expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now());
      await db.admin.query("update public.messages set scheduled_for = now() where id = $1", [id]);
    }
    expect((await claim()).some((x) => x.id === id)).toBe(true);
    await report(id, "retry", null, "timeout");
    // third failure on the only channel: nothing left
    expect(await status(id)).toMatchObject({ status: "failed", tried: ["email"] });
  });

  it("picks up a message whose sender died, after ten minutes", async () => {
    const u = await person("Pelumi");
    const id = (await enqueue(u.id, "welcome"))!;
    await claim();
    expect((await claim()).some((x) => x.id === id)).toBe(false);
    await db.admin.query("update public.messages set claimed_at = now() - interval '11 minutes' where id = $1", [id]);
    expect((await claim()).some((x) => x.id === id)).toBe(true);
  });

  it("ignores a report for a message that is not being sent", async () => {
    const u = await person("Qudus");
    const id = (await enqueue(u.id, "welcome"))!;
    await report(id, "sent", "early");
    expect((await status(id)).status).toBe("queued");
    await expectCode(asWorker("select public.worker_report($1, $2, 'sparkles')", [id]), "22023");
  });

  it("records delivery and reading, and turns a failure into a fallback", async () => {
    const u = await person("Rita");
    await setPhone(u.id, "+2348031110007");
    await consent(u.id, "whatsapp", true);
    const id = (await enqueue(u.id, "welcome"))!;
    await claim();
    await report(id, "sent", "wamid.AAA");
    await asWorker("select public.worker_provider_event($1, 'wamid.AAA', 'delivered')");
    expect(await status(id)).toMatchObject({ status: "delivered" });
    expect((await status(id)).delivered_at).not.toBeNull();
    await asWorker("select public.worker_provider_event($1, 'wamid.AAA', 'read')");
    expect(await status(id)).toMatchObject({ status: "read" });

    const lost = (await enqueue(u.id, "triad_prompt"))!;
    await claim();
    await report(lost, "sent", "wamid.BBB");
    await asWorker("select public.worker_provider_event($1, 'wamid.BBB', 'failed', 'not on WhatsApp')");
    expect(await status(lost)).toMatchObject({ status: "queued", tried: ["whatsapp"] });
    expect((await claim()).find((x) => x.id === lost)!.channel).toBe("email");
    // news about a message we do not know is ignored
    await asWorker("select public.worker_provider_event($1, 'nothing', 'delivered')");
  });

  it("shows the office what happened, and lets a director try a failed message again", async () => {
    const dir = await person("Dir", { roles: ["director"] });
    const member = await person("Member");
    const id = (await enqueue(member.id, "welcome"))!;
    await db.admin.query("update public.messages set status = 'failed', error = 'bounced' where id = $1", [id]);
    await expectCode(db.asUser(member.id, (q) => q("select public.message_log()")), "42501");
    await expectCode(db.asUser(member.id, (q) => q("select public.message_stats()")), "42501");
    const log = (await db.asUser(dir.id, (q) => q("select public.message_log('failed') as r"))).rows[0].r as Row[];
    expect(log.find((x) => x.id === id)).toMatchObject({ template: "welcome", status: "failed", error: "bounced" });
    expect(JSON.stringify(log)).not.toContain("params");
    const stats = (await db.asUser(dir.id, (q) => q("select public.message_stats(7) as r"))).rows[0].r;
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    await db.asUser(dir.id, (q) => q("select public.retry_message($1)", [id]));
    expect(await status(id)).toMatchObject({ status: "queued", error: null });
    await expectCode(db.asUser(dir.id, (q) => q("select public.retry_message($1)", [id])), "22023");
    await expectCode(db.asUser(member.id, (q) => q("select public.retry_message($1)", [id])), "42501");
  });
});

describe("the Friday check-in by reply", () => {
  async function setup() {
    const { tribe } = await makeTribe();
    const ada = await join(tribe, `Reply${++n}`);
    await db.admin.query(
      "insert into public.week_steps (person_id, tribe_id, week, when_text, will_text) values ($1, $2, 2, 'I wake up', 'pray for five minutes')",
      [ada.id, tribe],
    );
    const id = (await sql(
      "select public.enqueue_message($1, 'friday_checkin', '{\"week\":2}'::jsonb, $2, $3) as id",
      [ada.id, tribe, `fri:${tribe}`],
    ))[0].id as string;
    const reply = (await status(id)).reply_token as string;
    return { ada, tribe, id, reply };
  }

  it("gives only the Friday message a secret, and shows the step before the tap", async () => {
    const { reply, ada } = await setup();
    expect(reply).toMatch(/^[0-9a-f]{64}$/);
    const welcome = (await enqueue(ada.id, "welcome"))!;
    expect((await status(welcome)).reply_token).toBeNull();
    // Friday of week 2 is START + 7 + 5
    const info = await asWorker("select public.worker_reply_info($1, $2) as r", [reply]);
    expect(info).toMatchObject({ found: true, week: 2, step_set: true, will: "pray for five minutes", first_name: expect.stringMatching(/^Reply/) });
    expect(await asWorker("select public.worker_reply_info($1, 'nope') as r")).toEqual({ found: false });
  });

  it("records the answer when the window is open, and says so when it is not", async () => {
    const { reply, ada, tribe } = await setup();
    // Not open yet (the season in this test starts in the past relative to the real clock, so move it)
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 7 - 5, ends_on = public.today_lagos() + 71 where id = $1", [seasonId]);
    const ok = await asWorker("select public.worker_checkin_reply($1, $2, 'done') as r", [reply]);
    expect(ok).toMatchObject({ ok: true, outcome: "done", week: 2 });
    expect((await sql("select outcome from public.week_steps where person_id = $1 and tribe_id = $2 and week = 2", [ada.id, tribe]))[0].outcome).toBe("done");
    expect(await sql("select 1 from public.event_log where action = 'checkin.by_reply'")).not.toHaveLength(0);

    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 7 - 20 where id = $1", [seasonId]);
    expect(await asWorker("select public.worker_checkin_reply($1, $2, 'done') as r", [reply])).toMatchObject({ ok: false, reason: "not_now" });
    expect(await asWorker("select public.worker_checkin_reply($1, 'nope', 'done') as r")).toMatchObject({ ok: false, reason: "unknown" });
    await expectCode(db.asAnon((q) => q("select public.worker_checkin_reply('utw_not_a_real_token_0000000000000000000000', $1, 'done')", [reply])), "42501");
    await db.admin.query("update public.seasons set starts_on = $1, ends_on = ($1::date + 83) where id = $2", [START, seasonId]);
  });
});

describe("the weekly calendar", () => {
  async function tribeOf(count: number, opts: { coach?: boolean; assistant?: boolean } = {}) {
    const coach = opts.coach ? await person(`Coach${++n}`, { roles: ["coach"] }) : null;
    const assistant = opts.assistant ? await person(`Assist${++n}`, { roles: ["assistant_leader"] }) : null;
    const c = await makeTribe({ coach: coach?.id, assistant: assistant?.id });
    const members = [];
    for (let i = 0; i < count; i++) members.push(await join(c.tribe, `M${++n}`));
    return { ...c, members, coach, assistant };
  }

  it("sends Monday's passage to every member and the prep pack to the leader and assistant, once", async () => {
    const { tribe, members, leader, assistant } = await tribeOf(4, { assistant: true });
    const before = (await msgs("week_start", tribe)).length;
    const r = await tick(lagos(1, "08:10"));
    expect(r.queued).toBeGreaterThanOrEqual(4 + 2);
    const start = await msgs("week_start", tribe);
    expect(start.length - before).toBe(4);
    expect(start[0].params).toMatchObject({ week: 1, weeks: 12, title: "Begin with the end in view", passage: "Habakkuk 2:2–3", pulse: true });
    const prep = await msgs("leader_prep", tribe);
    expect(prep.map((p) => p.person_id).sort()).toEqual([leader.id, assistant!.id].sort());
    expect(prep[0].params).toMatchObject({ week: 1, members: 4, tribe: expect.stringMatching(/^Tribe/) });
    // running it again, a quarter of an hour later, adds nothing
    expect((await tick(lagos(1, "08:25"))).queued).toBe(0);
    expect(members).toHaveLength(4);
  });

  it("does not send Monday's message before 07:30 or the morning after it is over", async () => {
    const { tribe } = await tribeOf(2);
    await tick(lagos(1, "07:00"));
    expect(await msgs("week_start", tribe)).toHaveLength(0);
    await tick(lagos(2, "04:00"));
    expect(await msgs("week_start", tribe)).toHaveLength(0);
    await tick(lagos(1, "10:00"));
    expect(await msgs("week_start", tribe)).toHaveLength(2);
  });

  it("points the prep pack at the next meeting when this week's has already happened", async () => {
    // a Sunday tribe: its week-1 meeting is on the first day, so Monday's pack is for week 2
    const leader = await person(`SunLeader${++n}`, { roles: ["leader"] });
    const { rows } = await db.admin.query(
      `insert into public.tribes (season_id, leader_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type, story,
          meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
       values ($1, $2, 'approved', 'Sunday tribe', $3, $4, $5, '{}', 'mixed', 'S', 0, '16:00', 'sunday-afternoon', 'online', 'mainland', 'Online', 12, 'a', 'b', 'c', now()) returning id`,
      [seasonId, leader.id, trackId, communityId, goalId],
    );
    await join(rows[0].id, `Sun${++n}`);
    await tick(lagos(1, "08:30"));
    expect((await msgs("leader_prep", rows[0].id))[0].params).toMatchObject({ week: 2 });
  });

  it("sends the triad prompt on Tuesday with the names of the other two", async () => {
    const { tribe, members } = await tribeOf(6);
    await tick(lagos(2, "12:10"));
    const triad = await msgs("triad_prompt", tribe);
    expect(triad).toHaveLength(6);
    for (const t of triad) expect((t.params.partners as string[]).length).toBe(2);
    const groups = await sql("select triad, count(*)::int as n from public.tribe_members where tribe_id = $1 group by triad order by triad", [tribe]);
    expect(groups).toEqual([{ triad: 1, n: 3 }, { triad: 2, n: 3 }]);
    expect(members).toHaveLength(6);
  });

  it("never leaves anyone alone in a triad", async () => {
    const { tribe } = await tribeOf(7);
    await tick(lagos(2, "12:10"));
    const groups = await sql("select count(*)::int as n from public.tribe_members where tribe_id = $1 group by triad order by n", [tribe]);
    expect(groups.map((g) => g.n)).toEqual([3, 4]);
    const solo = await tribeOf(1);
    await tick(lagos(2, "12:20"));
    expect(await msgs("triad_prompt", solo.tribe)).toHaveLength(0);
  });

  it("reminds members and leaders two hours before the meeting, and not after it has begun", async () => {
    const { tribe, leader } = await tribeOf(3);
    await tick(lagos(3, "17:30"));
    expect(await msgs("meeting_reminder", tribe)).toHaveLength(0);
    await tick(lagos(3, "18:10"));
    const rem = await msgs("meeting_reminder", tribe);
    expect(rem).toHaveLength(3);
    expect(rem[0].params).toMatchObject({ meeting_time: "20:00", mode: "online", week: 1 });
    expect((await msgs("leader_meeting_reminder", tribe)).map((m) => m.person_id)).toEqual([leader.id]);
    const late = await tribeOf(2);
    await tick(lagos(3, "20:30"));
    expect(await msgs("meeting_reminder", late.tribe)).toHaveLength(0);
  });

  it("sends the log link after the meeting, unless it is already logged", async () => {
    const a = await tribeOf(2);
    const b = await tribeOf(2);
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 1, true, $2)", [b.tribe, b.leader.id]);
    await tick(lagos(3, "21:45"));
    expect((await msgs("leader_log_link", a.tribe)).map((m) => m.person_id)).toEqual([a.leader.id]);
    expect(await msgs("leader_log_link", b.tribe)).toHaveLength(0);
  });

  it("sends the recap the next morning, but not when the leader said the tribe did not meet", async () => {
    const met = await tribeOf(2);
    const notMet = await tribeOf(2);
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, highlight, logged_by) values ($1, 1, true, 'We prayed', $2)", [met.tribe, met.leader.id]);
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 1, false, $2)", [notMet.tribe, notMet.leader.id]);
    await db.admin.query(
      "insert into public.week_steps (person_id, tribe_id, week, when_text, will_text) values ($1, $2, 1, 'I wake up', 'read my goal')",
      [met.members[0].id, met.tribe],
    );
    await tick(lagos(4, "08:20"));
    const recap = await msgs("meeting_recap", met.tribe);
    expect(recap).toHaveLength(2);
    expect(recap.find((m) => m.person_id === met.members[0].id)!.params).toMatchObject({ highlight: "We prayed", will: "read my goal" });
    expect(await msgs("meeting_recap", notMet.tribe)).toHaveLength(0);
  });

  it("sends the Friday check-in to those who have not checked in, each with a secret to reply with", async () => {
    const { tribe, members } = await tribeOf(3);
    await db.admin.query(
      "insert into public.week_steps (person_id, tribe_id, week, when_text, will_text, outcome) values ($1, $2, 1, 'I wake up', 'pray', 'done')",
      [members[0].id, tribe],
    );
    await db.admin.query(
      "insert into public.week_steps (person_id, tribe_id, week, when_text, will_text) values ($1, $2, 1, 'I wake up', 'pray')",
      [members[1].id, tribe],
    );
    await tick(lagos(5, "09:10"));
    const fri = await msgs("friday_checkin", tribe);
    expect(fri.map((m) => m.person_id).sort()).toEqual([members[1].id, members[2].id].sort());
    expect(fri.every((m) => /^[0-9a-f]{64}$/.test(m.reply_token))).toBe(true);
    expect(fri.find((m) => m.person_id === members[1].id)!.params).toMatchObject({ step_set: true, will: "pray" });
    expect(fri.find((m) => m.person_id === members[2].id)!.params).toMatchObject({ step_set: false });
  });

  it("sends the weekly report to the leader on Saturday with who was missed and what was done about it", async () => {
    const { tribe, leader, members } = await tribeOf(3);
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 1, true, $2)", [tribe, leader.id]);
    await db.admin.query(
      "insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, 1, $2, 'present'), ($1, 1, $3, 'present'), ($1, 1, $4, 'absent')",
      [tribe, members[0].id, members[1].id, members[2].id],
    );
    await tick(lagos(6, "08:15"));
    const [rep] = await msgs("weekly_report", tribe);
    expect(rep.person_id).toBe(leader.id);
    expect(rep.params.missed).toHaveLength(1);
    expect(rep.params.report).toMatchObject({ present: 2, absent: 1, members: 3, held: true });
    expect(rep.params.messages_sent).toContain("leader_missed_one");
  });

  it("reminds the leader of an unlogged meeting after a day, and tells the coach after two", async () => {
    const { tribe, leader, coach } = await tribeOf(2, { coach: true });
    await tick(lagos(4, "20:30"));
    expect((await msgs("leader_log_reminder", tribe)).map((m) => m.person_id)).toEqual([leader.id]);
    expect(await msgs("coach_log_missing", tribe)).toHaveLength(0);
    await tick(lagos(5, "20:30"));
    const alert = await msgs("coach_log_missing", tribe);
    expect(alert.map((m) => m.person_id)).toEqual([coach!.id]);
    await tick(lagos(5, "20:45"));
    expect(await msgs("coach_log_missing", tribe)).toHaveLength(1);
  });

  it("sends nothing about a log that was filed in time", async () => {
    const { tribe, leader } = await tribeOf(2, { coach: true });
    await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 1, true, $2)", [tribe, leader.id]);
    await tick(lagos(4, "20:30"));
    await tick(lagos(5, "20:30"));
    expect(await msgs("leader_log_reminder", tribe)).toHaveLength(0);
    expect(await msgs("coach_log_missing", tribe)).toHaveLength(0);
  });

  it("gives each coach one digest on Monday covering their tribes, from week 2", async () => {
    const coach = await person("Coachy", { roles: ["coach"] });
    const one = await makeTribe({ coach: coach.id });
    const two = await makeTribe({ coach: coach.id });
    await join(one.tribe, `D${++n}`);
    await join(two.tribe, `D${++n}`);
    await tick(lagos(1, "07:30"));
    expect((await sql("select 1 from public.messages where person_id = $1 and template = 'coach_digest'", [coach.id]))).toHaveLength(0);
    await tick(lagos(8, "07:30"));
    const rows = await sql("select params from public.messages where person_id = $1 and template = 'coach_digest'", [coach.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toMatchObject({ week: 1, weeks: 12 });
    expect(rows[0].params.tribes).toHaveLength(2);
    await tick(lagos(8, "08:30"));
    expect((await sql("select 1 from public.messages where person_id = $1 and template = 'coach_digest'", [coach.id]))).toHaveLength(1);
  });

  it("prompts the leader the day before a birthday and on the day, with no year ever stored", async () => {
    const { tribe, members, leader } = await tribeOf(2);
    // birthday on Wednesday 17 February
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id, goal_baseline, meeting_mode, birthday_day, birthday_month)
       select $1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', 17, 2`,
      [members[0].id, seasonId, communityId, goalId],
    );
    await tick(lagos(2, "07:00"));
    expect(await msgs("birthday_tomorrow", tribe)).toHaveLength(0);
    await tick(lagos(2, "08:30"));
    const before = await msgs("birthday_tomorrow", tribe);
    expect(before.map((m) => m.person_id)).toEqual([leader.id]);
    expect(before[0].params.member_first).toMatch(/^M/);
    await tick(lagos(3, "08:30"));
    const today = await msgs("birthday_today", tribe);
    expect(today.map((m) => m.person_id)).toEqual([leader.id]);
    await tick(lagos(3, "09:30"));
    expect(await msgs("birthday_today", tribe)).toHaveLength(1);
    const cols = await sql("select column_name from information_schema.columns where table_name = 'member_profiles' and column_name like 'birth%'");
    expect(cols.map((c) => c.column_name).sort()).toEqual(["birthday_day", "birthday_month"]);
  });

  it("thanks everyone when the season ends and tells them two days before it starts", async () => {
    const { tribe, members, leader } = await tribeOf(2);
    await tick(lagos(-2, "09:30"));
    const soon = await msgs("season_starts_soon", tribe);
    expect(soon).toHaveLength(2);
    expect(soon[0].params).toMatchObject({ starts_on: START, meeting_day: 3, meeting_time: "20:00" });
    await tick(lagos(84, "10:30"));
    const done = await msgs("season_complete", tribe);
    expect(done.map((m) => m.person_id).sort()).toEqual([leader.id, ...members.map((m) => m.id)].sort());
  });

  it("does nothing for a season that is not near", async () => {
    await tribeOf(2);
    const r = await tick("2028-06-01T10:00:00+01:00");
    expect(r.queued).toBe(0);
  });
});

describe("messages that follow what people do", () => {
  it("welcomes a new member, and tells the leader to call within 72 hours", async () => {
    const { tribe, leader } = await makeTribe();
    const ada = await join(tribe, "Ada");
    const [welcome] = await msgs("welcome", tribe);
    expect(welcome).toMatchObject({ person_id: ada.id });
    expect(welcome.params).toMatchObject({ meeting_day: 3, meeting_time: "20:00", mode: "online" });
    const [heads] = await msgs("new_member", tribe);
    expect(heads.person_id).toBe(leader.id);
    expect(heads.params.member_whatsapp).toBeNull();
    expect(heads.params.call_by).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shares a member's number with the leader only if the member agreed to WhatsApp", async () => {
    const { tribe } = await makeTribe();
    const agreed = await person("Agreed");
    const refused = await person("Refused");
    for (const [u, yes] of [[agreed, true], [refused, false]] as const) {
      await db.admin.query(
        `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id, goal_baseline, meeting_mode, whatsapp)
         select $1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing', $4, 3, 'either', '+2348039990000'`,
        [u.id, seasonId, communityId, goalId],
      );
      if (yes) await consent(u.id, "whatsapp", true);
      await db.admin.query(
        `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
         values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
        [tribe, u.id, seasonId],
      );
    }
    const heads = await msgs("new_member", tribe);
    expect(heads.find((m) => m.params.member_first === "Agreed")!.params.member_whatsapp).toBe("+2348039990000");
    expect(heads.find((m) => m.params.member_first === "Refused")!.params.member_whatsapp).toBeNull();
  });

  it("reminds the leader if the welcome call has not been made in 72 hours, and the coach after a week", async () => {
    const coach = await person("CoachW", { roles: ["coach"] });
    const { tribe, leader } = await makeTribe({ coach: coach.id });
    const ada = await join(tribe, "Ada");
    const bola = await join(tribe, "Bola");
    await db.admin.query("update public.tribe_members set called_at = now() where person_id = $1", [bola.id]);
    await db.admin.query("update public.tribe_members set joined_at = $2::timestamptz - interval '80 hours' where person_id = $1", [ada.id, lagos(1, "10:00")]);
    await tick(lagos(1, "10:00"));
    const due = await msgs("welcome_call_overdue", tribe);
    expect(due.map((m) => [m.person_id, m.params.member_first])).toEqual([[leader.id, "Ada"]]);
    expect(await msgs("coach_welcome_overdue", tribe)).toHaveLength(0);
    await db.admin.query("update public.tribe_members set joined_at = $2::timestamptz - interval '8 days' where person_id = $1", [ada.id, lagos(2, "10:00")]);
    await tick(lagos(2, "10:00"));
    expect((await msgs("coach_welcome_overdue", tribe)).map((m) => m.person_id)).toEqual([coach.id]);
  });

  describe("missed meetings", () => {
    async function held(tribe: string, leader: string, wk: number, absent: string[], present: string[]) {
      await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, $2, true, $3) on conflict do nothing", [tribe, wk, leader]);
      for (const p of absent) await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, $2, $3, 'absent')", [tribe, wk, p]);
      for (const p of present) await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, $2, $3, 'present')", [tribe, wk, p]);
    }

    it("one miss gives the leader a warm message to forward; two, a call prompt and a note to the member; three, the coach", async () => {
      const coach = await person("CoachM", { roles: ["coach"] });
      const { tribe, leader } = await makeTribe({ coach: coach.id });
      const ada = await join(tribe, "Ada");
      const bola = await join(tribe, "Bola");
      await held(tribe, leader.id, 1, [ada.id], [bola.id]);
      const one = await msgs("leader_missed_one", tribe);
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ person_id: leader.id });
      expect(one[0].params).toMatchObject({ member_first: "Ada", week: 1 });
      // held back for half an hour
      expect(new Date(one[0].scheduled_for).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

      await held(tribe, leader.id, 2, [ada.id], [bola.id]);
      expect(await msgs("leader_missed_two", tribe)).toHaveLength(1);
      const note = await msgs("member_missed_two", tribe);
      expect(note.map((m) => m.person_id)).toEqual([ada.id]);
      expect(await msgs("coach_missed_three", tribe)).toHaveLength(0);

      await held(tribe, leader.id, 3, [ada.id], [bola.id]);
      const alert = await msgs("coach_missed_three", tribe);
      expect(alert.map((m) => m.person_id)).toEqual([coach.id]);
      expect(alert[0].params).toMatchObject({ member_first: "Ada", missed: 3 });
      expect(await msgs("leader_missed_one", tribe)).toHaveLength(1);
    });

    it("counts only consecutive meetings that were held, and an excuse or a visit starts the count again", async () => {
      const { tribe, leader } = await makeTribe();
      const ada = await join(tribe, "Ada");
      await held(tribe, leader.id, 1, [ada.id], []);
      await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 2, false, $2)", [tribe, leader.id]);
      await held(tribe, leader.id, 3, [ada.id], []);
      expect(await msgs("leader_missed_two", tribe)).toHaveLength(1);

      const bola = await join(tribe, "Bola");
      await held(tribe, leader.id, 4, [bola.id], []);
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, 5, $2, 'excused')", [tribe, bola.id]).catch(() => {});
      await db.admin.query("insert into public.tribe_logs (tribe_id, week, held, logged_by) values ($1, 5, true, $2)", [tribe, leader.id]);
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, 5, $2, 'excused')", [tribe, bola.id]);
      await held(tribe, leader.id, 6, [bola.id], []);
      expect((await msgs("leader_missed_two", tribe)).filter((m) => m.params.member_first === "Bola")).toHaveLength(0);
    });

    it("sends nothing if the leader fixes the mark straight away", async () => {
      const { tribe, leader } = await makeTribe();
      const ada = await join(tribe, "Ada");
      await held(tribe, leader.id, 1, [ada.id], []);
      expect(await msgs("leader_missed_one", tribe)).toHaveLength(1);
      // the way save_tribe_log edits: delete the marks, add them again
      await db.admin.query("delete from public.tribe_attendance where tribe_id = $1 and week = 1", [tribe]);
      expect(await msgs("leader_missed_one", tribe)).toHaveLength(0);
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, 1, $2, 'present')", [tribe, ada.id]);
      expect(await msgs("leader_missed_one", tribe)).toHaveLength(0);
      // and marking absent again queues it again
      await db.admin.query("delete from public.tribe_attendance where tribe_id = $1 and week = 1", [tribe]);
      await db.admin.query("insert into public.tribe_attendance (tribe_id, week, person_id, status) values ($1, 1, $2, 'absent')", [tribe, ada.id]);
      expect(await msgs("leader_missed_one", tribe)).toHaveLength(1);
    });
  });

  it("alerts the coach when someone's belonging is low", async () => {
    const coach = await person("CoachP", { roles: ["coach"] });
    const { tribe } = await makeTribe({ coach: coach.id });
    const ada = await join(tribe, "Ada");
    await db.admin.query("insert into public.care_flags (tribe_id, person_id, kind, week) values ($1, $2, 'low_belonging', 1)", [tribe, ada.id]);
    const [alert] = await msgs("coach_low_pulse", tribe);
    expect(alert).toMatchObject({ person_id: coach.id });
    expect(alert.params).toMatchObject({ member_name: "Ada Test", week: 1 });
    // a flag of another kind does not
    await db.admin.query("insert into public.care_flags (tribe_id, person_id, kind, week) values ($1, $2, 'not_yet_twice', 2)", [tribe, ada.id]);
    expect(await msgs("coach_low_pulse", tribe)).toHaveLength(1);
  });

  it("tells the leader a testimony is waiting, without the words of it", async () => {
    const { tribe, leader } = await makeTribe();
    const ada = await join(tribe, "Ada");
    await db.admin.query(
      "insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit) values ($1, $2, 1, 'God provided a job after months of waiting.', 'tribe', 'first_name')",
      [ada.id, tribe],
    );
    const [note] = await msgs("testimony_waiting", tribe);
    expect(note).toMatchObject({ person_id: leader.id });
    expect(JSON.stringify(note.params)).not.toContain("God provided");
    expect(note.params.by).toBe("Ada");
  });

  it("writes to an applicant at each stage and copies an approved leader's number as their contact", async () => {
    const u = await person("Applicant");
    const { rows } = await db.admin.query(
      `insert into public.leader_applications (person_id, status, answers, consent_version) values ($1, 'draft', $2::jsonb, 'v1') returning id`,
      [u.id, JSON.stringify({ contact: { whatsapp: "+2348035550000" } })],
    );
    const id = rows[0].id as string;
    for (const s of ["submitted", "interview_invited", "interview_booked", "approved_leader"]) {
      await db.admin.query("update public.leader_applications set status = $2::public.application_status where id = $1", [id, s]);
    }
    const sent = await sql("select template from public.messages where person_id = $1 order by created_at, id", [u.id]);
    expect(sent.map((m) => m.template)).toEqual([
      "application_received", "application_interview_invited", "application_interview_booked", "application_approved",
    ]);
    expect((await sql("select params from public.messages where person_id = $1 and template = 'application_approved'", [u.id]))[0].params).toMatchObject({ role: "tribe leader" });
    expect((await sql("select phone, preferred from public.contact_preferences where person_id = $1", [u.id]))[0]).toEqual({ phone: "+2348035550000", preferred: "email" });
    // the same stage twice is one message
    await db.admin.query("update public.leader_applications set status = 'approved_leader' where id = $1", [id]);
    expect(await sql("select 1 from public.messages where person_id = $1 and template = 'application_approved'", [u.id])).toHaveLength(1);
  });

  it("lets a leader set the meeting link, and nobody else", async () => {
    const { tribe, leader } = await makeTribe();
    const stranger = await person("Stranger");
    await db.asUser(leader.id, (q) => q("select public.save_tribe_meeting($1, 'https://meet.example.org/abc-defg', 'Zoom')", [tribe]));
    expect((await sql("select meeting_link, place_note from public.tribes where id = $1", [tribe]))[0]).toEqual({ meeting_link: "https://meet.example.org/abc-defg", place_note: "Zoom" });
    await expectCode(db.asUser(leader.id, (q) => q("select public.save_tribe_meeting($1, 'http://insecure.example', null)", [tribe])), "22023");
    await expectCode(db.asUser(stranger.id, (q) => q("select public.save_tribe_meeting($1, null, null)", [tribe])), "42501");
    await db.asUser(leader.id, (q) => q("select public.save_tribe_meeting($1, null, null)", [tribe]));
    expect((await sql("select meeting_link from public.tribes where id = $1", [tribe]))[0].meeting_link).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The database decides what to say; src/lib/messaging says how. This checks that
// the two agree: every message the tests above caused to be queued can be
// written in all three channels, from the fields the database really supplied.
// ---------------------------------------------------------------------------

describe("the wording matches what the database queues", () => {
  it("renders every queued message in every channel, with nothing missing", async () => {
    const rows = await sql("select distinct on (template) id, template, params, reply_token, urgency from public.messages where params <> '{}'::jsonb order by template, created_at desc");
    expect(rows.length).toBeGreaterThan(20);
    expect(await wordingProblems(rows)).toEqual([]);
    const seen = new Set(rows.map((r) => r.template));
    // The calendar's own templates are all exercised above.
    for (const t of ["welcome", "week_start", "friday_checkin", "weekly_report", "leader_prep", "coach_digest", "birthday_today", "application_approved"]) {
      expect(seen.has(t), `no ${t} message was queued by the tests`).toBe(true);
    }
  });
});
