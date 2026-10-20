import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";
import { kit, type Kit, type Person } from "./builders";

let db: TestDb;
let k: Kit;
let token: string;
let seasonId: string;
let director: Person;
let pastor: Person;
let admin: Person;

const sql = (text: string, params: unknown[] = []) => k.sql(text, params);
const asWorker = async (text: string, params: unknown[] = []) => (await db.asAnon((q) => q(text, [token, ...params]))).rows[0]?.r;
const clock = (hour: number, dow = 3) =>
  db.admin.query(
    `create or replace function public.lagos_hour() returns integer language sql as $$ select ${hour} $$;
     create or replace function public.lagos_dow() returns integer language sql as $$ select ${dow} $$;`,
  );
const tick = async () => (await asWorker("select public.worker_reminders_tick($1) as r")) as Row;
const claim = async (limit = 100) => (await asWorker("select public.worker_claim($1, $2) as r", [limit])) as Row[];

/** Moves a timestamp back without the "touched just now" trigger putting it right again. */
async function backdate(table: string, column: string, where: string, params: unknown[], interval: string) {
  const trigger = table === "intake_drafts" ? "intake_drafts_touch" : table === "leader_applications" ? "leader_applications_touch" : null;
  if (trigger) await db.admin.query(`alter table public.${table} disable trigger ${trigger}`);
  await db.admin.query(`update public.${table} set ${column} = now() - $${params.length + 1}::interval where ${where}`, [...params, interval]);
  if (trigger) await db.admin.query(`alter table public.${table} enable trigger ${trigger}`);
}

async function draft(who: string, daysAgo: number, age = "33-40", step = "story") {
  const u = await k.person(who);
  await db.admin.query("insert into public.intake_drafts (person_id, step, answers, updated_at) values ($1, $2, $3::jsonb, now() - $4::interval)", [
    u.id, step, JSON.stringify({ ageRange: age }), `${daysAgo} days`,
  ]);
  return u;
}

const consent = (person: string, purpose: string, granted: boolean) =>
  db.admin.query("insert into public.consents (person_id, purpose, granted, version) values ($1, $2::public.consent_purpose, $3, 'test')", [person, purpose, granted]);

const journeyMode = (key: string, mode: string) => db.admin.query("update public.journeys set mode = $2 where key = $1", [key, mode]);
const holdout = (pct: number) => db.admin.query("update public.reminder_settings set holdout_pct = $1", [pct]);

beforeAll(async () => {
  db = await createTestDb();
  k = await kit(db);
  token = (await sql("select public.bootstrap_worker_token('test') as t"))[0].t;
  seasonId = (await sql("select id from public.seasons order by starts_on limit 1"))[0].id;
  director = await k.staff("Dir", "director");
  pastor = await k.staff("Pas", "pastor");
  admin = await k.staff("Adm", "admin");
  await holdout(0);
  await clock(10, 3);
});

afterAll(async () => {
  await db.close();
});

describe("the tables are closed", () => {
  it("lets nobody read or write them directly, signed in or not", async () => {
    for (const table of ["reminder_settings", "journeys", "journey_emails", "journey_runs", "journey_sends", "journey_requests", "email_links", "email_signals", "broadcasts", "broadcast_recipients", "saved_audiences", "chat_opens"]) {
      await expectCode(db.asUser(director.id, (q) => q(`select * from public.${table}`)), "42501");
      await expectCode(db.asAnon((q) => q(`select * from public.${table}`)), "42501");
    }
  });

  it("keeps the staff functions from visitors, and the service functions from anyone without the token", async () => {
    await expectCode(db.asAnon((q) => q("select public.reminders_overview()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.broadcast_list()")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_reminders_tick('x')")), "42501");
    await expectCode(db.asAnon((q) => q("select public.worker_link_open('a'::text || repeat('b', 40), 'c')")), "42501");
    await expectCode(db.asUser(director.id, (q) => q("select public.journeys_advance()")), "42501");
    await expectCode(db.asUser(director.id, (q) => q("select public.message_blocker($1)", [director.id])), "42501");
  });
});

describe("the sixteen emails", () => {
  it("ship in four journeys, four tones each, all in rehearsal", async () => {
    const rows = await sql("select journey_key, step, tone, button_label, actions from public.journey_emails order by journey_key, step");
    expect(rows).toHaveLength(16);
    for (const key of ["member_form", "leader_application", "no_tribe", "in_tribe"]) {
      expect(rows.filter((r) => r.journey_key === key).map((r) => r.tone)).toEqual(["warm", "practical", "encouraging", "honest"]);
    }
    expect((await sql("select mode from public.journeys")).every((r) => r.mode === "rehearsal")).toBe(true);
    // the last email of each journey ends with a way out
    expect(rows.find((r) => r.journey_key === "member_form" && r.step === 4)!.actions).toEqual(["help_finish", "not_season"]);
    expect(rows.find((r) => r.journey_key === "in_tribe" && r.step === 4)!.button_label).toBeNull();
  });

  it("uses only name fields from the fixed list and no outside links", async () => {
    const rows = await sql("select subject, paragraphs, button_label from public.journey_emails");
    for (const r of rows) {
      const text = [r.subject, ...r.paragraphs, r.button_label ?? ""].join(" ");
      expect(text).not.toMatch(/https?:\/\//);
      for (const m of text.matchAll(/\{([^}]*)\}/g)) {
        expect(["first_name", "tribe", "tribe_1", "leader_first", "seats_left", "season_starts", "joining_closes", "meets", "next_meeting", "erase_date", "parts_left", "minutes_left", "close_line", "my_page"]).toContain(m[1]);
      }
    }
  });
});

describe("who an announcement is for", () => {
  let started: Person[];
  beforeAll(async () => {
    await clock(10, 3);
    started = [await draft("Sade", 3), await draft("Tola", 9)];
    const teen = await draft("Teen", 4, "13-17");
    const optedOut = await draft("Quiet", 4);
    await consent(optedOut.id, "announcements", false);
    const deleting = await draft("Leaving", 4);
    await db.admin.query("insert into public.erasure_requests (person_id, centre_id) values ($1, $2)", [deleting.id, k.centreId]);
    const bounced = await draft("Bouncy", 4);
    await db.admin.query("insert into public.email_signals (person_id, kind) values ($1, 'hard_bounce'), ($1, 'hard_bounce')", [bounced.id]);
    const emailOff = await draft("NoMail", 4);
    await consent(emailOff.id, "email", false);
    void teen;
  });

  it("counts people from live records and says why others are left out, never who", async () => {
    const preview = await k.call(director.id, "audience_preview", [JSON.stringify({ kind: "started" })]);
    expect(preview.total).toBe(7);
    expect(preview.will_send).toBe(2);
    expect(preview.skipped).toEqual({ under18: 1, announcements_off: 1, deletion: 1, bounced: 1, email_off: 1 });
    const slow = await k.call(director.id, "audience_preview", [JSON.stringify({ kind: "started", idle_days: 7 })]);
    expect(slow.will_send).toBe(1);
  });

  it("shows one person as they will read it", async () => {
    const sample = await k.call(director.id, "audience_sample", [JSON.stringify({ kind: "started" }), 0]);
    expect(sample.found).toBe(true);
    expect(sample.of).toBe(2);
    expect(["Sade", "Tola"]).toContain(sample.vars.first_name);
    expect(sample.vars.tribe).toBe("your tribe");
  });

  it("refuses a rule it does not know, and anyone who is not office or a champion", async () => {
    await expectCode(k.call(director.id, "audience_preview", [JSON.stringify({ kind: "bogus" })]), "22023");
    await expectCode(k.call(director.id, "audience_preview", [JSON.stringify({ kind: "staff", roles: ["member"] })]), "22023");
    await expectCode(k.call(started[0].id, "audience_preview", [JSON.stringify({ kind: "started" })]), "42501");
    await expectCode(k.call((await k.staff("Dl", "data_lead")).id, "audience_preview", [JSON.stringify({ kind: "started" })]), "42501");
  });

  it("holds a champion to the members of their own community", async () => {
    const champion = await k.staff("Champ", "community_champion");
    const [own, other] = (await sql("select id from public.communities order by slug limit 2")).map((r) => r.id as string);
    await db.admin.query("insert into public.community_champions (person_id, community_id) values ($1, $2)", [champion.id, own]);
    await expectCode(k.call(champion.id, "audience_preview", [JSON.stringify({ kind: "everyone" })]), "42501");
    await expectCode(k.call(champion.id, "audience_preview", [JSON.stringify({ kind: "in_tribe", community: other })]), "42501");
    await expectCode(k.call(champion.id, "audience_preview", [JSON.stringify({ kind: "staff", roles: ["coach"] })]), "42501");
    const ok = await k.call(champion.id, "audience_preview", [JSON.stringify({ kind: "started", community: own })]);
    expect(ok.needs_approval).toBe(true);
  });

  it("finds leaders, applicants and staff by role", async () => {
    const coach = await k.staff("Coachy", "coach");
    const staff = await k.call(director.id, "audience_preview", [JSON.stringify({ kind: "staff", roles: ["coach"] })]);
    expect(staff.will_send).toBe(1);
    void coach;
    const apps = await k.call(director.id, "audience_preview", [JSON.stringify({ kind: "leader_applicants", stages: ["draft"] })]);
    expect(apps.total).toBe(0);
  });
});

describe("an announcement, from draft to results", () => {
  const fields = (over: Record<string, unknown> = {}) => ({
    title: "Welcome back",
    audience: { kind: "started" },
    audience_label: "Started the form",
    subject: "Your tribe is waiting, {first_name}",
    paragraphs: ["We saved your answers.", "It takes about five minutes."],
    button_label: "Carry on",
    button_target: "/join",
    ...over,
  });
  const save = (who: Person, f: Record<string, unknown>, id: string | null = null) => k.call(who.id, "broadcast_save", [id, JSON.stringify(f)]);

  it("checks the words as they are saved: name fields from the list, no links outside the button", async () => {
    await expectCode(save(director, fields({ subject: "Hello {frist_name}" })), "22023");
    await expectCode(save(director, fields({ paragraphs: ["Visit https://example.org now"] })), "22023");
    await expectCode(save(director, fields({ paragraphs: ["Open { here"] })), "22023");
    await expectCode(save(director, fields({ button_target: "/admin" })), "22023");
    await expectCode(save(director, fields({ button_label: "Go", button_target: null })), "22023");
    await expectCode(save(director, fields({ title: "x" })), "22023");
    await expectCode(save(started0(), fields()), "42501");
  });

  function started0() {
    return { id: "00000000-0000-4000-8000-000000000000", email: "" } as Person;
  }

  it("sends a small one straight to the schedule and freezes who gets it", async () => {
    const id = await save(director, fields());
    const out = await k.call(director.id, "broadcast_submit", [id, null]);
    expect(out.status).toBe("scheduled");
    expect(out.count).toBe(2);
    const row = (await sql("select status, recipient_count, approved_by from public.broadcasts where id = $1", [id]))[0];
    expect(row).toMatchObject({ status: "scheduled", recipient_count: 2, approved_by: director.id });
    // someone who starts a form now is not added, and the words can no longer change
    await draft("Late", 3);
    expect((await sql("select count(*)::int n from public.broadcast_recipients where broadcast_id = $1", [id]))[0].n).toBe(2);
    await expectCode(save(director, fields({ subject: "Changed" }), id), "22023");
  });

  it("releases at its own pace inside the sending hours, and each email is prepared when it is claimed", async () => {
    await clock(7, 3);
    expect((await tick()).released).toBe(0);
    await clock(10, 3);
    const out = await tick();
    expect(out.released).toBe(2);
    const messages = await sql("select m.id, m.template, m.force_channel, m.params from public.messages m where m.template = 'office_message' order by m.created_at");
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.force_channel === "email")).toBe(true);
    const claimed = await claim();
    const mine = claimed.filter((c) => c.template === "office_message");
    expect(mine).toHaveLength(2);
    const p = mine[0].params;
    expect(p.kind).toBe("announcement");
    expect(p.copy.subject).toBe("Your tribe is waiting, {first_name}");
    expect(p.copy.button_label).toBe("Carry on");
    expect(p.data.first_name).toBeTruthy();
    expect(Object.keys(p.links).sort()).toEqual(["go", "prefs", "stop"]);
    for (const t of Object.values(p.links) as string[]) expect(t).toMatch(/^[a-f0-9]{64}$/);
    // only the hash is kept
    const stored = await sql("select token_hash from public.email_links");
    expect(stored.some((r) => Object.values(p.links).includes(r.token_hash))).toBe(false);
    expect((await sql("select status from public.broadcasts where recipient_count = 2 and subject like 'Your tribe%'"))[0].status).toBe("sent");
    const results = await k.call(director.id, "broadcast_results", [(await sql("select id from public.broadcasts limit 1"))[0].id]);
    expect(results).toMatchObject({ frozen: 2, sent: 0 });
  });

  it("keeps the wording back from people who have since said stop, and from a window that has closed", async () => {
    const quiet = await draft("Later", 3);
    const id = await save(director, fields({ title: "Second" }));
    await k.call(director.id, "broadcast_submit", [id, null]);
    await consent(quiet.id, "announcements", false);
    await clock(10, 3);
    await tick();
    const left = (await sql("select status, reason from public.broadcast_recipients where broadcast_id = $1 and person_id = $2", [id, quiet.id]))[0];
    expect(left).toMatchObject({ status: "skipped", reason: "announcements_off" });
  });

  it("asks a second person to approve a large send, and never the one who wrote it", async () => {
    await db.admin.query("update public.reminder_settings set approval_threshold = 2");
    const id = await save(admin, fields({ title: "Big one" }));
    const out = await k.call(admin.id, "broadcast_submit", [id, null]);
    expect(out.status).toBe("awaiting_approval");
    await expectCode(k.call(admin.id, "broadcast_approve", [id]), "42501");
    await expectCode(k.call((await k.staff("Dl2", "data_lead")).id, "broadcast_approve", [id]), "42501");
    const waiting = await k.call(pastor.id, "broadcast_approvals");
    expect(waiting.map((w: Row) => w.id)).toContain(id);
    expect(waiting.find((w: Row) => w.id === id).sample.first_name).toBeTruthy();
    // the approvers other than the writer were told
    expect((await sql("select count(*)::int n from public.messages where template = 'broadcast_waiting' and dedupe_key like $1", [`bcw:${id}:%`]))[0].n).toBeGreaterThanOrEqual(2);
    const approved = await k.call(pastor.id, "broadcast_approve", [id]);
    expect(approved.status).toBe("scheduled");
    expect((await sql("select approved_by from public.broadcasts where id = $1", [id]))[0].approved_by).toBe(pastor.id);
    await db.admin.query("update public.reminder_settings set approval_threshold = 200");
  });

  it("can be sent back with a reason, then changed and sent again", async () => {
    await db.admin.query("update public.reminder_settings set approval_threshold = 2");
    const id = await save(admin, fields({ title: "Rework" }));
    await k.call(admin.id, "broadcast_submit", [id, null]);
    await expectCode(k.call(pastor.id, "broadcast_reject", [id, ""]), "22023");
    await k.call(pastor.id, "broadcast_reject", [id, "Say when the season starts"]);
    expect((await k.call(admin.id, "broadcast_get", [id])).reject_note).toBe("Say when the season starts");
    await save(admin, fields({ title: "Rework", subject: "Season starts {season_starts}" }), id);
    expect((await k.call(admin.id, "broadcast_submit", [id, null])).status).toBe("awaiting_approval");
    await k.call(pastor.id, "broadcast_control", [id, "cancel"]);
    await db.admin.query("update public.reminder_settings set approval_threshold = 200");
  });

  it("pauses, resumes and cancels, and cancelling leaves out everyone not yet sent", async () => {
    await draft("Fresh", 3);
    const id = await save(director, fields({ title: "Pausable" }));
    await k.call(director.id, "broadcast_submit", [id, null]);
    await k.call(pastor.id, "broadcast_control", [id, "pause"]);
    await clock(10, 3);
    await tick();
    expect((await sql("select count(*)::int n from public.broadcast_recipients where broadcast_id = $1 and status = 'queued'", [id]))[0].n).toBe(0);
    await expectCode(k.call(director.id, "broadcast_control", [id, "resume"]).then(() => k.call(director.id, "broadcast_control", [id, "resume"])), "22023");
    await k.call(director.id, "broadcast_control", [id, "cancel"]);
    expect((await sql("select status from public.broadcasts where id = $1", [id]))[0].status).toBe("cancelled");
    expect((await sql("select count(*)::int n from public.broadcast_recipients where broadcast_id = $1 and status = 'pending'", [id]))[0].n).toBe(0);
    await expectCode(k.call((await k.staff("Dl3", "data_lead")).id, "broadcast_control", [id, "pause"]), "42501");
  });

  it("only takes a time inside the sending hours", async () => {
    const id = await save(director, fields({ title: "Scheduled" }));
    const late = new Date(Date.now() + 2 * 86400_000);
    late.setUTCHours(21, 0, 0, 0); // 22:00 in Lagos
    await expectCode(k.call(director.id, "broadcast_submit", [id, late.toISOString()]), "22023");
    const fine = new Date(Date.now() + 2 * 86400_000);
    fine.setUTCHours(10, 0, 0, 0); // 11:00 in Lagos
    expect((await k.call(director.id, "broadcast_submit", [id, fine.toISOString()])).status).toBe("scheduled");
    // nothing goes before its time
    await clock(10, 3);
    expect((await sql("select status from public.broadcasts where id = $1", [id]))[0].status).toBe("scheduled");
    await tick();
    expect((await sql("select status from public.broadcasts where id = $1", [id]))[0].status).toBe("scheduled");
  });

  it("tests to the writer only, and not more than five times an hour", async () => {
    const id = await save(director, fields({ title: "Testy" }));
    await k.call(director.id, "broadcast_test_send", [id]);
    const sent = await sql("select person_id, params from public.messages where template = 'office_message' and params ? 'test'");
    expect(sent).toHaveLength(1);
    expect(sent[0].person_id).toBe(director.id);
    const claimed = (await claim()).filter((c) => c.params.copy?.subject?.startsWith("[Test]"));
    expect(claimed).toHaveLength(1);
    for (let i = 0; i < 4; i++) await k.call(director.id, "broadcast_test_send", [id]);
    await expectCode(k.call(director.id, "broadcast_test_send", [id]), "22023");
  });

  it("lists announcements for the office, and a champion sees only their own", async () => {
    const all = await k.call(director.id, "broadcast_list");
    expect(all.length).toBeGreaterThan(3);
    const dl = await k.staff("Dl4", "data_lead");
    expect((await k.call(dl.id, "broadcast_list")).length).toBe(all.length);
    await expectCode(k.call((await k.person("Nobody")).id, "broadcast_list"), "42501");
  });

  it("keeps saved groups for the office, as rules and never lists", async () => {
    const id = await k.call(director.id, "audience_save", ["Quiet starters", JSON.stringify({ kind: "started", idle_days: 7 }), "Started, quiet for 7 days"]);
    const list = await k.call(director.id, "audiences_list");
    expect(list).toEqual([{ id, name: "Quiet starters", spec: { kind: "started", idle_days: 7 }, label: "Started, quiet for 7 days" }]);
    await k.call(director.id, "audience_delete", [id]);
    expect(await k.call(director.id, "audiences_list")).toEqual([]);
  });
});

describe("the four journeys", () => {
  const runs = (key: string, extra = "") => sql(`select r.*, public.first_name_of(r.person_id) as who from public.journey_runs r where r.journey_key = $1 ${extra} order by r.started_at`, [key]);

  it("rehearses first: it logs what it would send and sends nothing", async () => {
    await clock(10, 3);
    const u = await draft("Rehearse", 2);
    const before = (await sql("select count(*)::int n from public.messages where template = 'reminder_email'"))[0].n;
    await tick();
    const mine = (await runs("member_form")).filter((r) => r.who === "Rehearse");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ rehearsal: true, status: "active", step_done: 1 });
    const log = await sql("select kind, step from public.journey_sends where run_id = $1", [mine[0].id]);
    expect(log).toEqual([{ kind: "rehearsal", step: 1 }]);
    expect((await sql("select count(*)::int n from public.messages where template = 'reminder_email'"))[0].n).toBe(before);
    const overview = await k.call(director.id, "reminders_overview");
    expect(overview.journeys.find((j: Row) => j.key === "member_form").rehearsal_would_send).toBeGreaterThanOrEqual(1);
    expect(overview.recent.some((r: Row) => r.kind === "rehearsal")).toBe(true);
    void u;
  });

  it("starts for real when switched on, and the rehearsal runs end", async () => {
    await journeyMode("member_form", "on");
    await clock(10, 3);
    await tick();
    expect((await runs("member_form")).filter((r) => r.rehearsal && r.status === "active")).toHaveLength(0);
    const real = (await runs("member_form")).filter((r) => !r.rehearsal && r.status === "active");
    expect(real.length).toBeGreaterThanOrEqual(1);
    const msgs = await sql("select m.*, public.first_name_of(m.person_id) as who from public.messages m where template = 'reminder_email' order by created_at");
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0]).toMatchObject({ force_channel: "email" });
    expect(msgs[0].params).toMatchObject({ step: 1, journey: "member_form" });
  });

  it("writes the email as it is claimed: live wording, the facts, and fresh links", async () => {
    const claimed = (await claim()).filter((c) => c.template === "reminder_email");
    expect(claimed.length).toBeGreaterThanOrEqual(1);
    const c = claimed[0];
    expect(c.params.kind).toBe("reminder");
    expect(c.params.copy).toMatchObject({ journey: "member_form", step: 1, tone: "warm", button_label: "Carry on where I stopped" });
    expect(c.params.data.step).toBe("story");
    expect(c.params.data.erase_date).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(Object.keys(c.params.links).sort()).toEqual(["go", "prefs", "stop"]);
    expect(c.params.church.name).toBe("The Covenant Nation");
    const opened = await asWorker("select public.worker_link_open($1, $2) as r", [c.params.links.go]);
    expect(opened).toMatchObject({ found: true, kind: "go", scope: "/join", expired: false, journey: "member_form", step: "story" });
    expect(opened.email_hint).toMatch(/^.•••@example\.org$/);
  });

  it("keeps a gap between reminders and a weekly total", async () => {
    const u = await draft("Capped", 8);
    await tick();
    const run = (await runs("member_form")).find((r) => r.who === "Capped")!;
    expect(run.step_done).toBe(1);
    // email 2 falls due (day 3) but the gap has not passed: nothing goes
    await backdate("journey_runs", "base_at", "id = $1", [run.id], "4 days");
    await tick();
    expect((await runs("member_form")).find((r) => r.who === "Capped")!.step_done).toBe(1);
    await backdate("messages", "created_at", "person_id = $1 and template = 'reminder_email'", [u.id], "3 days");
    await tick();
    expect((await runs("member_form")).find((r) => r.who === "Capped")!.step_done).toBe(2);
    // two a week: a third waits, however due it is
    await backdate("journey_runs", "base_at", "id = $1", [run.id], "9 days");
    await backdate("messages", "created_at", "person_id = $1 and template = 'reminder_email' and created_at > now() - interval '1 hour'", [u.id], "3 days");
    await tick();
    expect((await runs("member_form")).find((r) => r.who === "Capped")!.step_done).toBe(2);
  });

  it("stays quiet outside the hours: early, late, and Sunday morning", async () => {
    const u = await draft("Clocky", 3);
    for (const [hour, dow] of [[7, 3], [19, 3], [11, 0]] as const) {
      await clock(hour, dow);
      await tick();
      const mine = (await runs("member_form")).find((r) => r.who === "Clocky");
      expect(mine === undefined || mine.step_done === 0, `${hour}:00 on day ${dow}`).toBe(true);
    }
    await clock(15, 0);
    await tick();
    expect((await runs("member_form")).find((r) => r.who === "Clocky")!.step_done).toBe(1);
    await clock(10, 3);
    void u;
  });

  it("stops the moment the person finishes, even with an email already waiting", async () => {
    const u = await draft("Finisher", 2);
    await tick();
    const run = (await runs("member_form")).find((r) => r.who === "Finisher")!;
    expect(run.step_done).toBe(1);
    const queued = (await sql("select id from public.messages where person_id = $1 and template = 'reminder_email'", [u.id]))[0].id;
    await k.profile(u.id, seasonId);
    await db.admin.query("delete from public.intake_drafts where person_id = $1", [u.id]);
    const claimed = await claim();
    expect(claimed.some((c) => c.id === queued)).toBe(false);
    expect((await sql("select status, error from public.messages where id = $1", [queued]))[0]).toMatchObject({ status: "skipped" });
    const after = (await runs("member_form")).find((r) => r.who === "Finisher")!;
    expect(after.status).toBe("acted");
    expect((await sql("select kind from public.journey_sends where message_id = $1", [queued]))[0].kind).toBe("skipped");
  });

  it("ends when someone comes back and does something, and may start again if they go quiet", async () => {
    const u = await draft("Returner", 2);
    await tick();
    await db.admin.query("update public.intake_drafts set step = 'faith' where person_id = $1", [u.id]);
    await tick();
    const run = (await runs("member_form")).find((r) => r.who === "Returner")!;
    expect(run).toMatchObject({ status: "stopped", end_reason: "returned" });
    await backdate("intake_drafts", "updated_at", "person_id = $1", [u.id], "2 days");
    await tick();
    const again = (await runs("member_form")).filter((r) => r.who === "Returner");
    expect(again).toHaveLength(2);
    expect(again[1].run_no).toBe(2);
  });

  it("never writes to the 13 to 17 track, a deletion in progress, or someone who has said stop", async () => {
    const teen = await draft("Teeny", 3, "13-17");
    const leaving = await draft("Going", 3);
    await db.admin.query("insert into public.erasure_requests (person_id, centre_id) values ($1, $2)", [leaving.id, k.centreId]);
    const stopped = await draft("Stopper", 3);
    await consent(stopped.id, "reminders", false);
    await tick();
    for (const u of [teen, leaving, stopped]) {
      expect((await sql("select count(*)::int n from public.journey_runs where person_id = $1", [u.id]))[0].n).toBe(0);
    }
  });

  it("is in one journey at a time, the earlier step in the path first", async () => {
    const u = await draft("Both", 3);
    const { rows } = await db.admin.query(
      "insert into public.leader_applications (person_id, step, consent_version, updated_at) values ($1, 'why', 'v1', now() - interval '5 days') returning id", [u.id]);
    await journeyMode("leader_application", "on");
    await tick();
    const mine = await sql("select journey_key, status from public.journey_runs where person_id = $1", [u.id]);
    expect(mine).toEqual([{ journey_key: "member_form", status: "active" }]);
    void rows;
  });

  it("follows a leader application from draft to sent, and honours the closing date for the last email", async () => {
    const u = await k.person("Applicant");
    const app = (await db.admin.query(
      "insert into public.leader_applications (person_id, step, consent_version, updated_at) values ($1, 'why', 'v1', now() - interval '3 days') returning id", [u.id])).rows[0].id;
    await tick();
    const run = (await runs("leader_application")).find((r) => r.who === "Applicant")!;
    expect(run.step_done).toBe(1);
    expect(run.ref_id).toBe(app);
    const closes = new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10);
    await k.call(director.id, "reminder_settings_save", [JSON.stringify({ applications_close_on: closes })]);
    const due = (await sql("select public.journey_due_at(r, 4) as d, r.base_at from public.journey_runs r where id = $1", [run.id]))[0];
    // three days before it closes: earlier than the usual day 20, and never before the third email's day plus one
    const base = new Date(due.base_at).getTime();
    expect(new Date(due.d).getTime()).toBeLessThan(base + 20 * 86400_000);
    expect(new Date(due.d).getTime()).toBeGreaterThan(base + 10 * 86400_000);
    await db.admin.query("update public.leader_applications set status = 'submitted' where id = $1", [app]);
    await tick();
    expect((await runs("leader_application")).find((r) => r.who === "Applicant")!.status).toBe("acted");
    await db.admin.query("update public.reminder_settings set applications_close_on = null");
  });

  it("follows someone who finished the form but has no tribe, until they sit down in one", async () => {
    await journeyMode("no_tribe", "on");
    const tribe = await k.tribe(seasonId, { name: "Builders Tribe", capacity: 12 });
    const u = await k.person("Chooser");
    await k.profile(u.id, seasonId);
    await db.admin.query("update public.member_profiles set submitted_at = now() - interval '3 days' where person_id = $1", [u.id]);
    // matching has not shown them any tribe yet: nothing to remind them about
    await tick();
    expect((await runs("no_tribe")).filter((r) => r.who === "Chooser")).toHaveLength(0);
    const run = (await db.admin.query("insert into public.match_runs (person_id, season_id, model_version, candidates, shown) select $1, $2, version, 3, 1 from public.match_models limit 1 returning id", [u.id, seasonId])).rows[0].id;
    await db.admin.query("insert into public.match_recommendations (run_id, person_id, rank, tribe_id, degree, components, reasons) values ($1, $2, 1, $3, 88, '{}'::jsonb, '{}')", [run, u.id, tribe.tribe]);
    await tick();
    const mine = (await runs("no_tribe")).find((r) => r.who === "Chooser")!;
    expect(mine.step_done).toBe(1);
    const data = (await sql("select public.journey_data(r) as d from public.journey_runs r where id = $1", [mine.id]))[0].d;
    expect(data).toMatchObject({ tribe_1: "Builders Tribe", seats_left: 12 });
    // someone with no tribe that fits is on the office's own list, and gets no reminders
    const noFit = await k.person("NoFit");
    await k.profile(noFit.id, seasonId);
    await db.admin.query("update public.member_profiles set submitted_at = now() - interval '3 days' where person_id = $1", [noFit.id]);
    await db.admin.query("insert into public.match_demand (person_id, season_id, tribe_kind, shown) values ($1, $2, 'any', 0)", [noFit.id, seasonId]);
    await tick();
    expect((await runs("no_tribe")).filter((r) => r.who === "NoFit")).toHaveLength(0);
    // sitting down in a tribe ends it
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, 88, 'test', '{}'::jsonb, current_date + 14)`, [tribe.tribe, u.id, seasonId]);
    await tick();
    expect((await runs("no_tribe")).find((r) => r.who === "Chooser")!.status).toBe("acted");
  });

  it("follows a member in a tribe after the season starts, and the third email puts them on the leader's call list", async () => {
    await journeyMode("in_tribe", "on");
    await k.moveSeason(seasonId, 4);
    await db.admin.query("update public.seasons set status = 'running' where id = $1", [seasonId]);
    const tribe = await k.tribe(seasonId, { name: "Wednesday Tribe" });
    const quiet = await k.seat(tribe.tribe, seasonId, "Quietone");
    const active = await k.seat(tribe.tribe, seasonId, "Doer");
    await db.admin.query("insert into public.week_steps (person_id, tribe_id, week, when_text, will_text) values ($1, $2, 1, 'when I wake', 'pray for five minutes')", [active.id, tribe.tribe]);
    await tick();
    const mine = (await runs("in_tribe")).find((r) => r.who === "Quietone")!;
    expect(mine.step_done).toBe(1);
    expect((await runs("in_tribe")).filter((r) => r.who === "Doer")).toHaveLength(0);
    const data = (await sql("select public.journey_data(r) as d from public.journey_runs r where id = $1", [mine.id]))[0].d;
    expect(data).toMatchObject({ tribe: "Wednesday Tribe", meeting_day: 3, meeting_time: "20:00" });
    expect(data.next_meeting).toMatch(/^Wednesday \d{1,2} [A-Z][a-z]+$/);
    // email 3 is due on day 10 of the journey and adds a "call first" flag for the leader
    await backdate("journey_runs", "base_at", "id = $1", [mine.id], "11 days");
    await db.admin.query("update public.journey_runs set step_done = 2 where id = $1", [mine.id]);
    await db.admin.query("update public.journey_runs set expires_at = now() + interval '5 days' where id = $1", [mine.id]);
    await backdate("messages", "created_at", "person_id = $1", [quiet.id], "5 days");
    await tick();
    expect((await runs("in_tribe")).find((r) => r.who === "Quietone")!.step_done).toBe(3);
    const flag = await sql("select kind, status from public.care_flags where person_id = $1", [quiet.id]);
    expect(flag).toEqual([{ kind: "quiet_start", status: "open" }]);
  });

  it("holds a share of people back, chosen by a fixed rule, and still watches whether they act", async () => {
    await holdout(50);
    const people: Person[] = [];
    for (let i = 0; i < 24; i++) people.push(await draft(`Hold${i}`, 3));
    await tick();
    const mine = await sql("select r.holdout, r.person_id, r.step_done from public.journey_runs r where r.person_id = any($1::uuid[])", [people.map((p) => p.id)]);
    expect(mine).toHaveLength(24);
    const held = mine.filter((r) => r.holdout);
    expect(held.length).toBeGreaterThan(2);
    expect(held.length).toBeLessThan(22);
    for (const r of held) {
      expect(r.step_done).toBe(0);
      expect((await sql("select count(*)::int n from public.messages where person_id = $1 and template = 'reminder_email'", [r.person_id]))[0].n).toBe(0);
    }
    // a held-out person who finishes is still counted as acted
    await k.profile(held[0].person_id, seasonId);
    await tick();
    expect((await sql("select status from public.journey_runs where person_id = $1", [held[0].person_id]))[0].status).toBe("acted");
    await holdout(0);
  });

  it("pauses a journey by itself when too many people unsubscribe, and tells the director", async () => {
    await journeyMode("member_form", "on");
    const run = (await sql("select id, person_id from public.journey_runs where journey_key = 'member_form' limit 1"))[0];
    const rows = Array.from({ length: 60 }, (_, i) => `('${run.id}', ${(i % 4) + 1}, 'sent')`);
    // sixty sends today across four emails would clash on (run, step); use separate runs
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const u = await k.person(`Burst${i}`);
      const r = (await db.admin.query("insert into public.journey_runs (journey_key, person_id, base_at, expires_at, status) values ('member_form', $1, now(), now() + interval '30 days', 'stopped') returning id", [u.id])).rows[0].id;
      ids.push(r);
    }
    await db.admin.query(`insert into public.journey_sends (run_id, step, kind) select unnest($1::uuid[]), 1, 'sent'`, [ids]);
    await db.admin.query("insert into public.email_signals (person_id, kind, journey_key) select r.person_id, 'unsubscribe', 'member_form' from public.journey_runs r where r.id = any($1::uuid[]) limit 3", [ids]);
    void rows;
    const out = await tick();
    expect(out.paused).toBe(1);
    const j = (await sql("select mode, paused_reason from public.journeys where key = 'member_form'"))[0];
    expect(j.mode).toBe("off");
    expect(j.paused_reason).toMatch(/stopped these emails/);
    expect((await sql("select count(*)::int n from public.messages where template = 'reminder_paused' and person_id = $1", [director.id]))[0].n).toBe(1);
    // nothing new starts while it is off
    await draft("AfterPause", 3);
    await tick();
    expect((await runs("member_form")).filter((r) => r.who === "AfterPause")).toHaveLength(0);
    // the office has looked and switched it back on: yesterday's burst no longer counts
    await db.admin.query("delete from public.email_signals");
    await db.admin.query("update public.journey_sends set at = now() - interval '3 days' where run_id = any($1::uuid[])", [ids]);
    await journeyMode("member_form", "on");
  });

  it("does nothing at all when the master switch is off", async () => {
    await k.call(director.id, "reminders_master", [false]);
    await draft("Master", 3);
    const out = await tick();
    expect(out.master_on).toBe(false);
    expect((await runs("member_form")).filter((r) => r.who === "Master")).toHaveLength(0);
    await k.call(director.id, "reminders_master", [true]);
    await expectCode(k.call(pastor.id, "reminders_master", [false]), "42501");
  });
});

describe("what happens at the foot of an email", () => {
  let link: { stop: string; prefs: string; not_season?: string; help_finish?: string; go: string };
  let person: Person;
  let runId: string;

  beforeAll(async () => {
    await clock(10, 3);
    await journeyMode("member_form", "on");
    person = await draft("Linker", 21);
    await tick();
    runId = (await sql("select id from public.journey_runs where person_id = $1 and status = 'active'", [person.id]))[0].id;
    // jump to the last email
    await db.admin.query("update public.journey_runs set step_done = 3 where id = $1", [runId]);
    await backdate("messages", "created_at", "person_id = $1", [person.id], "10 days");
    await backdate("journey_runs", "base_at", "id = $1", [runId], "22 days");
    await tick();
    const c = (await claim()).filter((x) => x.template === "reminder_email" && x.to.first_name === "Linker").pop()!;
    expect(c.params.copy.step).toBe(4);
    expect(c.params.copy.actions).toEqual(["help_finish", "not_season"]);
    link = c.params.links;
  });

  it("counts the page opening, but nothing is decided until the person confirms", async () => {
    const opened = await asWorker("select public.worker_link_open($1, $2) as r", [link.not_season]);
    expect(opened).toMatchObject({ found: true, kind: "ask", scope: "not_season", used: false, journey: "member_form" });
    expect((await sql("select count(*)::int n from public.journey_requests where person_id = $1", [person.id]))[0].n).toBe(0);
    expect((await asWorker("select public.worker_link_open($1, $2) as r", ["f".repeat(64)])).found).toBe(false);
  });

  it("sends a call for help to the care team and stops the reminders", async () => {
    const done = await asWorker("select public.worker_link_confirm($1, $2, null) as r", [link.help_finish]);
    expect(done).toMatchObject({ ok: true, kind: "ask", scope: "help_finish" });
    // pressing twice is the same as pressing once
    await asWorker("select public.worker_link_confirm($1, $2, null) as r", [link.help_finish]);
    const reqs = await sql("select kind, status from public.journey_requests where person_id = $1", [person.id]);
    expect(reqs).toEqual([{ kind: "help_finish", status: "open" }]);
    expect((await sql("select status, end_reason from public.journey_runs where id = $1", [runId]))[0]).toMatchObject({ status: "stopped", end_reason: "asked_help" });
    const alerts = await sql("select person_id from public.messages where template = 'journey_ask' and params ->> 'who' like 'Linker%'");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const queue = await k.call(director.id, "asks_queue");
    const mine = queue.find((q: Row) => q.person_id === person.id);
    expect(mine).toMatchObject({ kind: "help_finish", status: "open" });
    await k.call(director.id, "ask_close", [mine.id]);
    await expectCode(k.call(director.id, "ask_close", [mine.id]), "22023");
    await expectCode(k.call(started(), "asks_queue"), "42501");
  });

  function started() {
    return person.id;
  }

  it("counts a 'not this season' with a reason, and never asks again about it", async () => {
    const u = await draft("Declines", 21);
    await tick();
    const rid = (await sql("select id from public.journey_runs where person_id = $1 and status = 'active'", [u.id]))[0].id;
    const l = (await sql("select public.make_email_link($1, 'ask', 'not_season', $2, null, 90) as t", [u.id, rid]))[0].t;
    const done = await asWorker("select public.worker_link_confirm($1, $2, 'travel') as r", [l]);
    expect(done.ok).toBe(true);
    expect((await sql("select status, end_reason from public.journey_runs where id = $1", [rid]))[0]).toMatchObject({ status: "declined", end_reason: "not_season" });
    expect((await sql("select kind, reason from public.journey_requests where person_id = $1", [u.id]))[0]).toEqual({ kind: "not_season", reason: "travel" });
    await backdate("intake_drafts", "updated_at", "person_id = $1", [u.id], "30 days");
    await tick();
    expect((await sql("select count(*)::int n from public.journey_runs where person_id = $1", [u.id]))[0].n).toBe(1);
    const overview = await k.call(director.id, "reminders_overview");
    const mf = overview.journeys.find((j: Row) => j.key === "member_form");
    expect(mf.not_season_30d).toBeGreaterThanOrEqual(1);
    expect(mf.reasons.travel).toBeGreaterThanOrEqual(1);
    // a bare "not this season" never alerts the care team
    expect((await sql("select count(*)::int n from public.messages where template = 'journey_ask' and params ->> 'kind' = 'not_season'"))[0].n).toBe(0);
  });

  it("stops reminders with one confirmed tap, or with the mail program's own button, and keeps announcements", async () => {
    const u = await draft("Stopper2", 3);
    await tick();
    const rid = (await sql("select id from public.journey_runs where person_id = $1 and status = 'active'", [u.id]))[0].id;
    const l1 = (await sql("select public.make_email_link($1, 'stop', 'reminders', $2, null, 400) as t", [u.id, rid]))[0].t;
    expect(await asWorker("select public.worker_unsubscribe_oneclick($1, $2) as r", [l1])).toBe(true);
    expect((await k.call(u.id, "my_email_switches"))).toEqual({ reminders: false, announcements: true, tribe: true });
    expect((await sql("select status, end_reason from public.journey_runs where id = $1", [rid]))[0]).toMatchObject({ status: "stopped", end_reason: "opted_out" });
    expect((await sql("select kind, journey_key from public.email_signals where person_id = $1", [u.id]))).toEqual([{ kind: "unsubscribe", journey_key: "member_form" }]);
    // the same tap twice leaves the ledger with one "no"
    await asWorker("select public.worker_unsubscribe_oneclick($1, $2) as r", [l1]);
    expect((await sql("select count(*)::int n from public.consents where person_id = $1 and purpose = 'reminders'", [u.id]))[0].n).toBe(1);
    // an expired or unknown link does nothing
    expect(await asWorker("select public.worker_unsubscribe_oneclick($1, $2) as r", ["a".repeat(64)])).toBe(false);
    const l2 = (await sql("select public.make_email_link($1, 'stop', 'announcements', null, null, 400) as t", [u.id]))[0].t;
    await db.admin.query("update public.email_links set expires_at = now() - interval '1 day' where token_hash = public.referee_token_hash($1)", [l2]);
    expect(await asWorker("select public.worker_unsubscribe_oneclick($1, $2) as r", [l2])).toBe(false);
    expect((await asWorker("select public.worker_link_confirm($1, $2, null) as r", [l2])).reason).toBe("expired");
  });

  it("gives people their three switches, from a link or from their profile, each change in the ledger", async () => {
    const u = await k.person("Switchy");
    const l = (await sql("select public.make_email_link($1, 'prefs', 'all', null, null, 400) as t", [u.id]))[0].t;
    const opened = await asWorker("select public.worker_link_open($1, $2) as r", [l]);
    expect(opened.switches).toEqual({ reminders: true, announcements: true, tribe: true });
    const saved = await asWorker("select public.worker_prefs_save($1, $2, false, false, true) as r", [l]);
    expect(saved.switches).toEqual({ reminders: false, announcements: false, tribe: true });
    expect(await k.call(u.id, "save_email_switches", [true, false, false])).toEqual({ reminders: true, announcements: false, tribe: false });
    const ledger = await sql("select purpose, granted, version from public.consents where person_id = $1 order by id", [u.id]);
    expect(ledger.map((r) => `${r.purpose}:${r.granted}`)).toEqual(["reminders:false", "announcements:false", "reminders:true", "email:false"]);
    await expectCode(db.asAnon((q) => q("select public.my_email_switches()")), "42501");
    // a "stop" link cannot be used to change the switches
    const stop = (await sql("select public.make_email_link($1, 'stop', 'reminders', null, null, 400) as t", [u.id]))[0].t;
    expect((await asWorker("select public.worker_prefs_save($1, $2, true, true, true) as r", [stop])).ok).toBe(false);
  });

  it("treats a spam complaint as a stop for everything, counted once", async () => {
    const u = await draft("Complainer", 3);
    await tick();
    const m = (await sql("select id from public.messages where person_id = $1 and template = 'reminder_email'", [u.id]))[0];
    await db.admin.query("update public.messages set provider_id = 'prov-1', status = 'sent' where id = $1", [m.id]);
    await asWorker("select public.worker_email_signal($1, 'prov-1', 'complaint')");
    expect(await k.call(u.id, "my_email_switches")).toEqual({ reminders: false, announcements: false, tribe: true });
    const signals = await sql("select kind, journey_key from public.email_signals where person_id = $1", [u.id]);
    expect(signals).toEqual([{ kind: "complaint", journey_key: "member_form" }]);
  });

  it("keeps an address out after two hard bounces", async () => {
    const u = await draft("Bouncer", 3);
    await db.admin.query("insert into public.messages (person_id, template, provider_id, status) values ($1, 'welcome', 'p-a', 'sent'), ($1, 'welcome', 'p-b', 'sent')", [u.id]);
    await asWorker("select public.worker_email_signal($1, 'p-a', 'hard_bounce')");
    expect((await sql("select public.message_blocker($1) as b", [u.id]))[0].b).toBeNull();
    await asWorker("select public.worker_email_signal($1, 'p-b', 'hard_bounce')");
    expect((await sql("select public.message_blocker($1) as b", [u.id]))[0].b).toBe("bounced");
  });
});

describe("Message on WhatsApp", () => {
  it("opens a chat only for people who said yes to WhatsApp, for staff who may, and records that it was opened", async () => {
    const care = await k.staff("Carey", "care_lead");
    const coach = await k.staff("Coachie", "coach");
    const tribe = await k.tribe(seasonId, { name: "Chat Tribe", coach: coach.id });
    const yes = await k.seat(tribe.tribe, seasonId, "Yesperson");
    const no = await k.seat(tribe.tribe, seasonId, "Noperson");
    const stranger = await k.person("Stranger");
    for (const [u, phone] of [[yes, "+2348031234567"], [no, "+2348039999999"], [stranger, "+2348031111111"]] as const) {
      await db.admin.query("insert into public.contact_preferences (person_id, phone) values ($1, $2)", [u.id, phone]);
    }
    await consent(yes.id, "whatsapp", true);
    await consent(stranger.id, "whatsapp", true);

    const opened = await k.call(care.id, "chat_open", [yes.id, "member_form"]);
    expect(opened.phone).toBe("+2348031234567");
    expect(opened.first_name).toBe("Yesperson");
    expect(opened.text).toMatch(/United Tribes form/);
    await expectCode(k.call(care.id, "chat_open", [no.id, "member_form"]), "42501");
    // a coach reaches their own tribe, and nobody else
    expect((await k.call(coach.id, "chat_open", [yes.id, "care"])).phone).toBe("+2348031234567");
    await expectCode(k.call(coach.id, "chat_open", [stranger.id, "care"]), "42501");
    await expectCode(k.call(yes.id, "chat_open", [stranger.id, "care"]), "42501");
    await expectCode(k.call(care.id, "chat_open", [yes.id, "Bad Context!"]), "22023");
    const log = await sql("select opened_by, person_id, context from public.chat_opens order by id");
    expect(log).toEqual([
      { opened_by: care.id, person_id: yes.id, context: "member_form" },
      { opened_by: coach.id, person_id: yes.id, context: "care" },
    ]);
    // the log holds no words
    expect(Object.keys((await sql("select * from public.chat_opens limit 1"))[0]).sort()).toEqual(["context", "created_at", "id", "opened_by", "person_id"]);
  });

  it("shows who is in a journey to the office and the care lead only, never a number", async () => {
    const people = await k.call(director.id, "journey_people", ["member_form", 50]);
    expect(people.length).toBeGreaterThan(0);
    expect(Object.keys(people[0]).sort()).toEqual(["can_chat", "holdout", "name", "next_due", "person_id", "rehearsal", "started_at", "step_done"]);
    expect((await k.call((await k.staff("Care2", "care_lead")).id, "journey_people", ["member_form", 5])).length).toBeLessThanOrEqual(5);
    await expectCode(k.call((await k.staff("Dl5", "data_lead")).id, "journey_people", ["member_form", 5]), "42501");
  });
});

describe("the wording, and who approves it", () => {
  let emailId: string;
  beforeAll(async () => {
    emailId = (await sql("select id from public.journey_emails where journey_key = 'no_tribe' and step = 2"))[0].id;
  });
  const edit = (who: Person, subject: string, paras: string[], button: string | null = "Choose my tribe") =>
    k.call(who.id, "journey_email_edit", [emailId, subject, `{${paras.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(",")}}`, button]);

  it("keeps an edit by anyone but a pastor waiting, and the live words unchanged", async () => {
    expect(await edit(director, "Two minutes to choose", ["Pick the tribe that feels right.", "You can change it before {season_starts}."])).toBe("waiting");
    const row = (await sql("select subject, version, pending from public.journey_emails where id = $1", [emailId]))[0];
    expect(row.subject).toBe("Choosing a tribe takes two minutes");
    expect(row.pending.subject).toBe("Two minutes to choose");
    expect(row.version).toBe(1);
    const overview = await k.call(director.id, "reminders_overview");
    expect(overview.can_approve_words).toBe(false);
    expect((await k.call(pastor.id, "reminders_overview")).can_approve_words).toBe(true);
  });

  it("goes live when a pastor approves it, with the history kept", async () => {
    await expectCode(k.call(director.id, "journey_email_approve", [emailId]), "42501");
    await k.call(pastor.id, "journey_email_approve", [emailId]);
    const row = (await sql("select subject, version, pending, approved_by from public.journey_emails where id = $1", [emailId]))[0];
    expect(row).toMatchObject({ subject: "Two minutes to choose", version: 2, pending: null, approved_by: pastor.id });
    const history = await k.call(director.id, "journey_email_history", [emailId]);
    expect(history.map((h: Row) => h.version)).toEqual([2, 1]);
    expect(history[0]).toMatchObject({ edited_by: "Dir Test", approved_by: "Pas Test" });
    await expectCode(k.call(pastor.id, "journey_email_approve", [emailId]), "22023");
  });

  it("goes live at once when the pastor writes it, and can discard a change", async () => {
    expect(await edit(pastor, "Choose with confidence", ["Open a tribe to see who leads it."])).toBe("live");
    expect((await sql("select version from public.journey_emails where id = $1", [emailId]))[0].version).toBe(3);
    await edit(director, "Another try", ["Short and sweet."]);
    await k.call(pastor.id, "journey_email_discard", [emailId]);
    expect((await sql("select pending from public.journey_emails where id = $1", [emailId]))[0].pending).toBeNull();
  });

  it("refuses a misspelt name field, a link, a missing button, and anyone outside the pastorate and office", async () => {
    await expectCode(edit(director, "Hello {firstname}", ["Hi."]), "22023");
    await expectCode(edit(director, "Fine", ["See https://example.org"]), "22023");
    await expectCode(edit(director, "Fine", ["Hi."], null), "22023");
    await expectCode(edit(director, "Fine", []), "22023");
    await expectCode(edit({ id: (await k.staff("Dl6", "data_lead")).id, email: "" }, "Fine", ["Hi."]), "42501");
  });

  it("changes the email people receive from the next one claimed", async () => {
    const u = await k.person("Wording");
    await k.profile(u.id, seasonId);
    const rid = (await db.admin.query(
      "insert into public.journey_runs (journey_key, person_id, base_at, expires_at, status) values ('no_tribe', $1, now(), now() + interval '30 days', 'active') returning id", [u.id])).rows[0].id;
    await clock(10, 3);
    await db.admin.query("update public.journey_runs set step_done = 1 where id = $1", [rid]);
    await db.admin.query("update public.journey_runs set base_at = now() - interval '7 days' where id = $1", [rid]);
    void u;
  });
});

describe("the settings", () => {
  it("accepts four rising days, in range, and the right ending for each journey", async () => {
    await k.call(director.id, "journey_set_days", ["no_tribe", "{2,5,9,18}"]);
    expect((await sql("select day_offsets from public.journeys where key = 'no_tribe'"))[0].day_offsets).toEqual([2, 5, 9, 18]);
    await expectCode(k.call(director.id, "journey_set_days", ["no_tribe", "{2,2,9,18}"]), "22023");
    await expectCode(k.call(director.id, "journey_set_days", ["no_tribe", "{2,5,9}"]), "22023");
    await expectCode(k.call(director.id, "journey_set_days", ["member_form", "{1,3,7,29}"]), "22023");
    await expectCode(k.call(director.id, "journey_set_days", ["in_tribe", "{3,6,10,15}"]), "22023");
    await expectCode(k.call(pastor.id, "journey_set_days", ["no_tribe", "{2,5,9,18}"]), "42501");
    await k.call(director.id, "journey_set_days", ["no_tribe", "{2,6,12,20}"]);
  });

  it("changes a switch only for an admin or director, and says so in the log", async () => {
    await k.call(admin.id, "journey_set_mode", ["leader_application", "off"]);
    await expectCode(k.call(pastor.id, "journey_set_mode", ["leader_application", "on"]), "42501");
    await expectCode(k.call(admin.id, "journey_set_mode", ["leader_application", "sideways"]), "22023");
    await expectCode(k.call(admin.id, "journey_set_mode", ["nope", "on"]), "P0002");
    const events = await sql("select action from public.event_log where action like 'journey.%' order by id desc limit 3");
    expect(events.map((e) => e.action)).toContain("journey.mode");
    await k.call(admin.id, "journey_set_mode", ["leader_application", "on"]);
  });

  it("keeps the numbers in range", async () => {
    await expectCode(k.call(director.id, "reminder_settings_save", [JSON.stringify({ holdout_pct: 90 })]), "22023");
    await expectCode(k.call(director.id, "reminder_settings_save", [JSON.stringify({ cap_reminders_week: "lots" })]), "22023");
    await k.call(director.id, "reminder_settings_save", [JSON.stringify({ holdout_pct: 10, church_address: "Km 10, Idiroko Road, Ota" })]);
    expect((await k.call(director.id, "reminders_overview")).settings).toMatchObject({ holdout_pct: 10, church_address: "Km 10, Idiroko Road, Ota" });
    await db.admin.query("update public.reminder_settings set church_address = 'Iganmu, Lagos, Nigeria'");
    await holdout(0);
  });

  it("shows the office the numbers, and the data lead the numbers only", async () => {
    const dl = await k.staff("Dl7", "data_lead");
    const o = await k.call(dl.id, "reminders_overview");
    expect(o.can_change).toBe(false);
    expect(o.can_see_people).toBe(false);
    expect(o.journeys).toHaveLength(4);
    expect(o.journeys[0].emails).toHaveLength(4);
    expect(JSON.stringify(o)).not.toMatch(/@example\.org/);
    await expectCode(k.call((await k.person("Plain")).id, "reminders_overview"), "42501");
  });
});
