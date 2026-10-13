import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase 1: the first check on a leader application. These tests drive the database directly, the way the app does:
// applicants and the panel through their own sign-in, the sending service through its token.

let db: TestDb;
let token: string;

const FIELDS = ["goalStory", "why", "walked", "walkNote", "obstacles"] as const;
const NEW_WORDING = "2026-12-l2";
const OLD_WORDING = "2026-10-l1";

beforeAll(async () => {
  db = await createTestDb();
  token = (await db.admin.query("select public.bootstrap_worker_token('test') as t")).rows[0].t;
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.admin.query(
    `update public.leader_ai_settings set mode = 'off', clear_min_score = 2.5, min_question_score = 2, min_confidence = 0.60,
       min_words = 8, max_step_tries = 3, max_rewrites = 2, rewrite_gap_hours = 24, audit_pct = 10,
       consent_version = '${NEW_WORDING}', ai_consent_covers_old = false, activated_at = null`,
  );
  await db.admin.query("delete from public.leader_applications");
});

// ---------------------------------------------------------------------------------------------------- builders

const BEST = { s1: "b", s2: "b", s3: "a", s4: "a", s5: "a", s6: "a" } as Record<string, string>;
const WORST = { s1: "d", s2: "c", s3: "d", s4: "c", s5: "b", s6: "c" } as Record<string, string>;
const picks = Object.fromEntries(Object.keys(BEST).map((k) => [k, { best: BEST[k], worst: WORST[k] }]));

const TEXT = {
  goalStory: "I have been stepping into leadership at work this year and I am still learning how to do it well.",
  why: "I want to help other people grow into what God has put in them, not to be seen by anyone.",
  walked: "I walked with a friend through a job loss. I listened a lot and did not give him advice.",
  walkNote: "Steady, though I get tired in busy seasons and pray less than I want to these days.",
  obstacles: "Work travel in the second half of the season could get in the way of the weekly meeting.",
};

function answers(over: Partial<Record<(typeof FIELDS)[number], string>> = {}) {
  return {
    eligibility: { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true },
    calling: {
      track: "builders",
      community: "professionals",
      goal: "step-into-a-leadership-role",
      goalRelation: "pursuing",
      walkRating: 4,
      ...TEXT,
      ...over,
    },
    scenarios: picks,
    style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
    contact: { whatsapp: "+2348031234567" },
  };
}

async function person(role?: string) {
  const user = await db.createUser();
  if (role) await db.grant(user.id, role);
  return user;
}

async function draft(userId: string, opts: { consent?: string; over?: Partial<Record<(typeof FIELDS)[number], string>> } = {}) {
  const { rows } = await db.asUser(userId, (q) =>
    q(
      `insert into public.leader_applications (person_id, step, answers, consent_version)
       values ($1, 'welcome', $2::jsonb, $3) returning id`,
      [userId, JSON.stringify(answers(opts.over)), opts.consent ?? NEW_WORDING],
    ),
  );
  const appId = rows[0].id as string;
  await db.asUser(userId, (q) => q("select public.set_referee($1, 1, 'Pastor Ife', 'Unit head', 'ife@example.org', true)", [appId]));
  await db.asUser(userId, (q) => q("select public.set_referee($1, 2, 'Sister Bola', 'Friend', 'bola@example.org', false)", [appId]));
  return appId;
}

const worker = (sql: string, params: unknown[] = []) => db.asAnon((q) => q(sql, [token, ...params]));
const setMode = (mode: string) => db.admin.query("update public.leader_ai_settings set mode = $1", [mode]);

async function recordCheck(appId: string, field: string, text: string, o: { ok?: boolean; relevance?: string; reasons?: string[]; note?: string } = {}) {
  const { rows } = await worker("select public.worker_record_answer_check($1, $2, $3, $4, $5, $6, $7, $8, true, 'mock', 'mock-1', 50) as r", [
    appId,
    field,
    text,
    o.ok ?? true,
    o.reasons ?? [],
    o.relevance ?? "pass",
    o.note ?? null,
  ]);
  return rows[0].r as Row;
}

async function checkAll(appId: string) {
  const a = (await db.admin.query("select answers from public.leader_applications where id = $1", [appId])).rows[0].answers;
  for (const f of FIELDS) await recordCheck(appId, f, a.calling[f]);
}

const submit = (userId: string, appId: string) => db.asUser(userId, (q) => q("select public.submit_leader_application($1)", [appId]));

/** A sent application in "on" mode: quick checks done, queued for the AI. */
async function sentOn(opts: { over?: Partial<Record<(typeof FIELDS)[number], string>> } = {}) {
  await setMode("on");
  const user = await person();
  const appId = await draft(user.id, { over: opts.over });
  await checkAll(appId);
  await submit(user.id, appId);
  return { user, appId };
}

const GOOD = { q1: 4, q2: 4, q3: 4, q4: 4, q5: 4, q6: 4 };
const result = (over: Row = {}) => ({
  ai_ran: true,
  scores: GOOD,
  evidence: { q1: [{ field: "why", quote: "help other people grow" }] },
  reasons: { q1: "Clear and specific." },
  feedback: {},
  flags: [] as string[],
  confidence: 0.9,
  provider: "mock",
  model: "mock-1",
  latency_ms: 120,
  input_tokens: 900,
  output_tokens: 200,
  ...over,
});

async function claim(limit = 10) {
  const { rows } = await worker("select public.worker_pending_leader_jobs($1, $2) as r", [limit]);
  return rows[0].r as Row[];
}
async function save(job: string, res: Row) {
  const { rows } = await worker("select public.worker_save_leader_ai_score($1, $2, $3::jsonb) as r", [job, JSON.stringify(res)]);
  return rows[0].r as Row;
}
/** Claim this application's job and save a result for it. */
async function score(appId: string, res: Row = result()) {
  const all = await claim();
  const job = all.find((j) => j.application === appId);
  // Hand back any other jobs picked up by the same call, so a test can take them one at a time
  for (const other of all.filter((j) => j !== job)) await db.admin.query("update public.leader_ai_jobs set locked_until = now() - interval '1 second' where id = $1", [other.job]);
  if (!job) throw new Error("no job waiting for this application");
  return { job, saved: await save(job.job, res) };
}

const state = async (appId: string) =>
  (await db.admin.query("select * from public.leader_ai_state where application_id = $1", [appId])).rows[0] as Row | undefined;
const messages = async (userId: string, template?: string) =>
  (await db.admin.query("select template, params, dedupe_key from public.messages where person_id = $1 and ($2::text is null or template = $2)", [userId, template ?? null]))
    .rows;
const status = async (userId: string, appId: string) =>
  (await db.asUser(userId, (q) => q("select public.leader_ai_status($1) as r", [appId]))).rows[0].r as Row;

// ---------------------------------------------------------------------------------------------------- off

describe("with the switch off", () => {
  it("behaves exactly as before: short answers send, nothing is queued, readiness comes from people", async () => {
    const user = await person();
    const appId = await draft(user.id, { over: { goalStory: "Twenty characters or more of anything here." } });
    await submit(user.id, appId);
    expect(await state(appId)).toBeUndefined();
    expect((await db.admin.query("select count(*)::int as n from public.leader_ai_jobs")).rows[0].n).toBe(0);
    const readiness = (await db.admin.query("select public.application_readiness($1) as r", [appId])).rows[0].r;
    expect(readiness.calling_source).toBe("people");
    expect(await status(user.id, appId)).toMatchObject({ mode: "off", state: "none", referees_open: true });
  });

  it("hands the heartbeat nothing", async () => {
    await setMode("shadow");
    const user = await person();
    const appId = await draft(user.id);
    await submit(user.id, appId);
    await setMode("off");
    expect(await claim()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------- who can do what

describe("who can see and change it", () => {
  it("lets only a pastor or the director read the numbers and use the switch", async () => {
    const coach = await person("coach");
    const member = await person();
    const pastor = await person("pastor");
    const director = await person("director");
    for (const who of [coach, member]) {
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_ai_overview()")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_ai_set_mode('on')")), "42501");
      await expectCode(db.asUser(who.id, (q) => q("select public.leader_ai_list('held')")), "42501");
    }
    const overview = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_overview() as r"))).rows[0].r;
    expect(overview.settings.mode).toBe("off");
    expect(overview.settings.min_words).toBe(8);
    await db.asUser(director.id, (q) => q("select public.leader_ai_set_mode('shadow')"));
    expect((await db.admin.query("select mode, activated_at from public.leader_ai_settings")).rows[0]).toMatchObject({ mode: "shadow", activated_at: null });
    await expectCode(db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('maybe')")), "22023");
  });

  it("checks thresholds are in range and keeps the consent wording for the director", async () => {
    const pastor = await person("pastor");
    const director = await person("director");
    await db.asUser(pastor.id, (q) => q(`select public.leader_ai_set_settings('{"clear_min_score": 3, "min_words": 10}'::jsonb)`));
    expect((await db.admin.query("select clear_min_score::float as c, min_words from public.leader_ai_settings")).rows[0]).toEqual({ c: 3, min_words: 10 });
    await expectCode(db.asUser(pastor.id, (q) => q(`select public.leader_ai_set_settings('{"min_words": 500}'::jsonb)`)), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q(`select public.leader_ai_set_settings('{"min_words": "many"}'::jsonb)`)), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q(`select public.leader_ai_set_settings('{"mode": "on"}'::jsonb)`)), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q(`select public.leader_ai_set_settings('{"ai_consent_covers_old": true}'::jsonb)`)), "42501");
    await db.asUser(director.id, (q) => q(`select public.leader_ai_set_settings('{"ai_consent_covers_old": true}'::jsonb)`));
    expect((await db.admin.query("select ai_consent_covers_old from public.leader_ai_settings")).rows[0].ai_consent_covers_old).toBe(true);
    const logged = (await db.admin.query("select count(*)::int as n from public.event_log where action = 'leader.ai_settings'")).rows[0].n;
    expect(logged).toBe(2);
  });

  it("refuses the sending service's functions without the token, and to applicants", async () => {
    const user = await person();
    const appId = await draft(user.id);
    for (const sql of [
      "select public.worker_pending_leader_jobs($1, 5)",
      "select public.worker_leader_ai_alerts($1)",
      `select public.worker_leader_check_state($1, '${appId}', 'why', 'text')`,
    ]) {
      await expectCode(db.asAnon((q) => q(sql, ["not-the-token-not-the-token-not-the-token"])), "42501");
      await expectCode(db.asUser(user.id, (q) => q(sql, ["short"])), "42501");
    }
  });
});

// ---------------------------------------------------------------------------------------------------- the quick check

describe("the quick check on each written answer", () => {
  it("tells the server when to check, and when not to", async () => {
    const user = await person();
    const appId = await draft(user.id);
    // Off and shadow never ask the applicant for anything
    expect((await worker(`select public.worker_leader_check_state($1, $2, 'why', 'some text') as r`, [appId])).rows[0].r).toEqual({ ok: false, reason: "off" });
    await setMode("shadow");
    expect((await worker(`select public.worker_leader_check_state($1, $2, 'why', 'some text') as r`, [appId])).rows[0].r.reason).toBe("off");
    await setMode("on");
    const ready = (await worker(`select public.worker_leader_check_state($1, $2, 'why', 'some text') as r`, [appId])).rows[0].r;
    expect(ready).toMatchObject({ ok: true, round: 0, attempt: 1, max_tries: 3, min_words: 8, rate_limited: false, cached: null });
    // Not agreed to the new wording yet
    const old = await person();
    const oldApp = await draft(old.id, { consent: OLD_WORDING });
    expect((await worker(`select public.worker_leader_check_state($1, $2, 'why', 'x') as r`, [oldApp])).rows[0].r.reason).toBe("consent");
  });

  it("records one result per version of the text, and gives the same answer when asked again", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    const first = await recordCheck(appId, "why", TEXT.why);
    expect(first).toMatchObject({ passes: true, forced: false, attempt: 1 });
    // Spaces and capitals do not make a new version
    const again = await recordCheck(appId, "why", `  ${TEXT.why.toUpperCase()}  `);
    expect(again).toMatchObject({ passes: true, attempt: 1 });
    expect((await db.admin.query("select count(*)::int as n from public.leader_answer_checks where application_id = $1", [appId])).rows[0].n).toBe(1);
    const cached = (await worker(`select public.worker_leader_check_state($1, $2, 'why', $3) as r`, [appId, TEXT.why])).rows[0].r;
    expect(cached.cached).toMatchObject({ passes: true, attempt: 1 });
  });

  it("stops a failing answer, counts the tries, and lets a real answer through only after the last one, marked", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    const mash = (n: number) => `asdf jkl qwer uiop zxcv bnm ${n} lorem ipsum dolor sit amet consectetur`;
    const one = await recordCheck(appId, "why", mash(1), { ok: false, reasons: ["mashing"], note: "That does not read like an answer yet." });
    expect(one).toMatchObject({ passes: false, forced: false, attempt: 1, tries_left: 2, note: "That does not read like an answer yet." });
    // A relevance failure counts the same
    const two = await recordCheck(appId, "why", `${TEXT.why} and then some more`, { ok: true, relevance: "fail" });
    expect(two).toMatchObject({ passes: false, attempt: 2, tries_left: 1 });
    const three = await recordCheck(appId, "why", mash(3), { ok: false, reasons: ["mashing"] });
    expect(three).toMatchObject({ passes: true, forced: true, attempt: 3, tries_left: 0 });
    // Tries are counted per answer
    expect((await recordCheck(appId, "obstacles", mash(9), { ok: false })).attempt).toBe(1);
  });

  it("never lets a too-short answer through, however many tries", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    for (let i = 1; i <= 5; i++) {
      const r = await recordCheck(appId, "why", `ok fine ${i} yes`, { ok: true });
      expect(r.passes).toBe(false);
      expect(r.forced).toBe(false);
    }
    const reasons = (await db.admin.query("select reasons from public.leader_answer_checks where application_id = $1 limit 1", [appId])).rows[0].reasons;
    expect(reasons).toContain("too_short");
  });

  it("counts a word as letters, including Yoruba and Igbo letters", async () => {
    const { rows } = await db.admin.query(
      `select public.leader_word_count('Mo fẹ́ ràn àwọn ènìyàn lọ́wọ́ ... !!! 123 ọmọ ṣe') as n, public.leader_word_count('asdf') as one, public.leader_word_count('   ') as none`,
    );
    expect(rows[0]).toEqual({ n: 8, one: 1, none: 0 });
  });

  it("slows down someone trying forty different versions in a day", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    for (let i = 0; i < 40; i++) await recordCheck(appId, FIELDS[i % 5], `try number ${i} of a very long list of different words to type`, { ok: false });
    const state = (await worker(`select public.worker_leader_check_state($1, $2, 'why', 'a brand new version of this answer') as r`, [appId])).rows[0].r;
    expect(state.rate_limited).toBe(true);
    // ...but an answer it has already seen is still answered
    const seen = (await worker(`select public.worker_leader_check_state($1, $2, 'why', 'try number 1 of a very long list of different words to type') as r`, [appId])).rows[0].r;
    expect(seen.rate_limited).toBe(false);
  });
});

describe("sending in 'on' mode", () => {
  it("refuses an application whose answers have not had their quick check, one by one", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    await expectCode(submit(user.id, appId), "22023");
    for (const f of FIELDS.slice(0, 4)) await recordCheck(appId, f, TEXT[f]);
    await expectCode(submit(user.id, appId), "22023");
    await recordCheck(appId, "obstacles", TEXT.obstacles, { ok: false });
    await expectCode(submit(user.id, appId), "22023");
  });

  it("refuses the text if it was changed after it was checked", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id);
    await checkAll(appId);
    await db.asUser(user.id, (q) =>
      q(
        `update public.leader_applications set answers = jsonb_set(answers, '{calling,why}', to_jsonb($2::text)) where id = $1`,
        [appId, "A completely different answer typed after the check was done and never checked."],
      ),
    );
    await expectCode(submit(user.id, appId), "22023");
  });

  it("refuses twenty characters of anything, and a person who has not agreed to the new wording", async () => {
    await setMode("on");
    const user = await person();
    const appId = await draft(user.id, { over: { why: "asdfasdfasdfasdfasdfasdf" } });
    await recordCheck(appId, "why", "asdfasdfasdfasdfasdfasdf", { ok: true });
    await expectCode(submit(user.id, appId), "22023");
    const old = await person();
    const oldApp = await draft(old.id, { consent: OLD_WORDING });
    await expectCode(submit(old.id, oldApp), "22023");
    await db.asUser(old.id, (q) => q("select public.accept_leader_ai_consent($1)", [oldApp]));
    await checkAll(oldApp);
    await submit(old.id, oldApp);
    expect(await state(oldApp)).toMatchObject({ state: "checking", basis: "ai" });
  });

  it("queues the AI's reading and puts the application in 'checking'", async () => {
    const { appId, user } = await sentOn();
    expect(await state(appId)).toMatchObject({ state: "checking", basis: "ai" });
    const jobs = (await db.admin.query("select origin, shadow, status from public.leader_ai_jobs where application_id = $1", [appId])).rows;
    expect(jobs).toEqual([{ origin: "submit", shadow: false, status: "queued" }]);
    expect(await status(user.id, appId)).toMatchObject({ state: "checking", referees_open: false });
  });
});

// ---------------------------------------------------------------------------------------------------- the reading

describe("the AI's reading", () => {
  it("hands the heartbeat the answers once, with what it needs to judge them", async () => {
    const { appId } = await sentOn();
    const jobs = await claim();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      application: appId,
      origin: "submit",
      shadow: false,
      ai_allowed: true,
      run: 1,
      rewrites_used: 0,
      track: "builders",
      goal_relation: "pursuing",
    });
    expect(jobs[0].answers.why).toBe(TEXT.why);
    expect(jobs[0].community_name).toBeTruthy();
    expect(jobs[0].goal_title).toBeTruthy();
    // Running jobs are not handed out again until the lock runs out
    expect(await claim()).toEqual([]);
    await db.admin.query("update public.leader_ai_jobs set locked_until = now() - interval '1 minute'");
    expect(await claim()).toHaveLength(1);
  });

  it("clears a good application: the AI's score takes the first calling place, referees open, an invitation needs no two reviewers", async () => {
    const { user, appId } = await sentOn();
    const { saved } = await score(appId);
    expect(saved).toMatchObject({ ok: true, outcome: "clear", state: "clear" });
    expect(await state(appId)).toMatchObject({ state: "clear", basis: "ai" });
    expect((await messages(user.id, "leader_check_clear"))[0].dedupe_key).toBe(`ai:${appId}:clear:1`);
    expect(await status(user.id, appId)).toMatchObject({ state: "clear", referees_open: true });

    const readiness = (await db.admin.query("select public.application_readiness($1) as r", [appId])).rows[0].r;
    expect(readiness).toMatchObject({ calling: 80, calling_source: "ai", calling_reviews: 0 });

    // Referees answer, then the pastor invites without two reviewers scoring first
    for (const slot of [1, 2]) {
      const ref = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = $2", [appId, slot])).rows[0].id;
      const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [ref]))).rows[0].s;
      await db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, false, null)", [secret]));
    }
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    expect((await db.admin.query("select status from public.leader_applications where id = $1", [appId])).rows[0].status).toBe("interview_invited");
  });

  it("keeps referee links and the invitation closed until the first check is clear", async () => {
    const { user, appId } = await sentOn();
    const ref = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = 1", [appId])).rows[0].id;
    await expectCode(db.asUser(user.id, (q) => q("select public.renew_referee_link($1)", [ref])), "22023");
    const pastor = await person("pastor");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.invite_to_interview($1)", [appId])), "22023");
    await score(appId);
    await db.asUser(user.id, (q) => q("select public.renew_referee_link($1)", [ref]));
  });

  it("asks for more on weak answers, in the AI's words, and tells the applicant only the notes", async () => {
    const { user, appId } = await sentOn();
    const notes = { why: "Tell us what draws you to lead, in your own words.", obstacles: "Say what you would do about the travel." };
    const { saved } = await score(appId, result({ scores: { ...GOOD, q2: 1, q5: 1 }, feedback: notes, flags: ["low_effort"] }));
    expect(saved).toMatchObject({ outcome: "strengthen", state: "strengthen" });
    const s = await status(user.id, appId);
    expect(s).toMatchObject({ state: "strengthen", notes, rewrites_left: 2, can_rewrite_now: true, referees_open: false });
    expect(JSON.stringify(s)).not.toMatch(/score|flag|quote|evidence|low_effort/);
    expect(await messages(user.id, "leader_check_strengthen")).toHaveLength(1);
  });

  it("holds for a person when asking would be pointless: no note to give, or an integrity flag", async () => {
    const a = await sentOn();
    expect((await score(a.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: {} }))).saved.outcome).toBe("held");
    const b = await sentOn();
    expect((await score(b.appId, result({ flags: ["instruction_attempt"] }))).saved).toMatchObject({ outcome: "held", state: "held" });
    // The applicant is told "with people", never "held" or why
    expect(await status(b.user.id, b.appId)).toMatchObject({ state: "with_people" });
    const c = await sentOn();
    expect((await score(c.appId, result({ confidence: 0.4 }))).saved.outcome).toBe("held");
  });

  it("treats gibberish as a hold at submit, but a kind request to people already waiting", async () => {
    const a = await sentOn();
    expect((await score(a.appId, result({ ai_ran: false, scores: null, flags: ["gibberish"] }))).saved.outcome).toBe("held");
    // Someone already in the batch when the switch went on
    await setMode("off");
    const user = await person();
    const appId = await draft(user.id, { consent: OLD_WORDING });
    await submit(user.id, appId);
    await db.admin.query("update public.leader_applications set consent_version = $2 where id = $1", [appId, NEW_WORDING]);
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('on')"));
    const fb = { why: "Please say a little more about why you want to lead." };
    const { saved } = await score(appId, result({ ai_ran: false, scores: null, flags: ["gibberish"], feedback: fb }));
    expect(saved.outcome).toBe("strengthen");
  });

  it("decides from the thresholds, not from the AI's own verdict", async () => {
    const decide = async (scores: Row | null, flags: string[], conf: number, rewrites = 0, origin = "submit") =>
      (await db.admin.query("select public.leader_ai_decide($1::jsonb, $2::text[], $3, $4, $5) as r", [scores ? JSON.stringify(scores) : null, flags, conf, rewrites, origin])).rows[0].r;
    const all = (n: number) => ({ q1: n, q2: n, q3: n, q4: n, q5: n, q6: n });
    expect(await decide(all(3), [], 0.9)).toBe("clear");
    expect(await decide(all(2), [], 0.9)).toBe("strengthen"); // mean 2 is under the 2.5 bar
    expect(await decide(all(2), [], 0.9, 2)).toBe("held"); // no updates left
    expect(await decide({ ...all(4), q3: 1 }, [], 0.9)).toBe("strengthen"); // one weak written answer
    expect(await decide({ ...all(4), q6: 1 }, [], 0.9)).toBe("held"); // fit is for a person
    expect(await decide(all(5), ["generic_boilerplate"], 0.9)).toBe("strengthen");
    expect(await decide(all(5), ["copied_or_templated"], 0.9)).toBe("held");
    expect(await decide(all(5), ["duplicate_of_other"], 0.95)).toBe("held");
    expect(await decide(all(5), ["unverified_evidence"], 0.95)).toBe("held");
    expect(await decide(all(5), ["forced_through"], 0.95)).toBe("held");
    expect(await decide(all(5), [], 0.59)).toBe("held");
    expect(await decide(null, [], 0.9)).toBe("unscored");
    expect(await decide(null, ["gibberish"], 0.9)).toBe("held");
    expect(await decide(null, ["gibberish"], 0.9, 0, "batch")).toBe("strengthen");
    expect(await decide(null, ["gibberish"], 0.9, 2, "batch")).toBe("held");
  });

  it("gives the same answer in SQL and in TypeScript for every combination tried, under two sets of thresholds", async () => {
    const { decide } = await import("@/lib/leaders/quality/decide");
    const vectors: (Record<string, number> | null)[] = [
      null,
      { q1: 5, q2: 5, q3: 5, q4: 5, q5: 5, q6: 5 },
      { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 3 },
      { q1: 2, q2: 2, q3: 2, q4: 2, q5: 2, q6: 2 },
      { q1: 4, q2: 4, q3: 1, q4: 4, q5: 4, q6: 4 },
      { q1: 4, q2: 4, q3: 4, q4: 4, q5: 4, q6: 1 },
      { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 5 },
      { q1: 3, q2: 2, q3: 3, q4: 2, q5: 3, q6: 2 },
    ];
    const flagSets = [[], ["low_effort"], ["off_topic"], ["generic_boilerplate", "low_effort"], ["gibberish"], ["poor_fit"], ["copied_or_templated"], ["forced_through", "off_topic"]];
    const sets = [
      { sql: {}, ts: { clearMinScore: 2.5, minQuestionScore: 2, minConfidence: 0.6, maxRewrites: 2 } },
      { sql: { clear_min_score: 3.5, min_question_score: 3, min_confidence: 0.8, max_rewrites: 0 }, ts: { clearMinScore: 3.5, minQuestionScore: 3, minConfidence: 0.8, maxRewrites: 0 } },
    ];
    let compared = 0;
    for (const set of sets) {
      for (const [k, v] of Object.entries(set.sql)) await db.admin.query(`update public.leader_ai_settings set ${k} = $1`, [v]);
      for (const scores of vectors) for (const flags of flagSets) for (const conf of [0.3, 0.6, 0.85]) for (const rewrites of [0, 1, 2]) for (const origin of ["submit", "batch"] as const) {
        const sql = (await db.admin.query("select public.leader_ai_decide($1::jsonb, $2::text[], $3, $4, $5) as r", [scores ? JSON.stringify(scores) : null, flags, conf, rewrites, origin])).rows[0].r;
        const ts = decide(scores, flags as never[], conf, rewrites, origin, set.ts);
        if (sql !== ts) throw new Error(`SQL says ${sql}, TypeScript says ${ts} for ${JSON.stringify({ scores, flags, conf, rewrites, origin, t: set.ts })}`);
        compared += 1;
      }
    }
    expect(compared).toBe(2 * 8 * 8 * 3 * 3 * 2);
  });

  it("rejects a result that is not valid, and an unscored result for a real application", async () => {
    const { appId } = await sentOn();
    const job = (await claim())[0];
    await expectCode(save(job.job, result({ scores: { ...GOOD, q3: 9 } })), "22023");
    await expectCode(save(job.job, result({ scores: { q1: 3 } })), "22023");
    await expectCode(save(job.job, result({ ai_ran: false, scores: null })), "22023");
    // An unknown flag is dropped, not stored
    const ok = await save(job.job, result({ flags: ["made_up_flag"] }));
    expect(ok.outcome).toBe("clear");
    expect((await db.admin.query("select flags from public.leader_ai_scores where application_id = $1", [appId])).rows[0].flags).toEqual([]);
    // Saving twice does nothing the second time
    expect(await save(job.job, result())).toMatchObject({ duplicate: true });
    expect((await db.admin.query("select count(*)::int as n from public.leader_ai_scores where application_id = $1", [appId])).rows[0].n).toBe(1);
  });

  it("leaves the applicant's state alone when a person stepped in during the reading", async () => {
    const { appId } = await sentOn();
    const job = (await claim())[0];
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_clear($1, 'I know her')", [appId]));
    const saved = await save(job.job, result({ flags: ["instruction_attempt"] }));
    expect(saved.state).toBe("cleared_by_person");
    expect(await state(appId)).toMatchObject({ state: "cleared_by_person", basis: "person" });
    expect((await db.admin.query("select count(*)::int as n from public.leader_ai_scores where application_id = $1", [appId])).rows[0].n).toBe(1);
  });

  it("goes to a person after repeated failures, with a growing wait, and says so after an hour", async () => {
    const { appId } = await sentOn();
    const job = (await claim())[0];
    await worker("select public.worker_fail_leader_job($1, $2, 'provider down')", [job.job]);
    let row = (await db.admin.query("select status, attempts, last_error, run_after > now() as later from public.leader_ai_jobs where application_id = $1", [appId])).rows[0];
    expect(row).toMatchObject({ status: "queued", attempts: 1, last_error: "provider down", later: true });
    expect(await claim()).toEqual([]);
    for (let i = 0; i < 12; i++) {
      await db.admin.query("update public.leader_ai_jobs set run_after = now() - interval '1 minute' where application_id = $1 and status = 'queued'", [appId]);
      const next = await claim();
      if (next[0]) await worker("select public.worker_fail_leader_job($1, $2, 'provider down')", [next[0].job]);
    }
    row = (await db.admin.query("select status from public.leader_ai_jobs where application_id = $1", [appId])).rows[0];
    expect(row.status).toBe("failed");
    expect(await state(appId)).toMatchObject({ state: "held" });
    expect((await worker("select public.worker_leader_ai_alerts($1) as r")).rows[0].r).toMatchObject({ stuck: 0, failed_24h: 1 });
    await db.admin.query("update public.leader_ai_jobs set status = 'queued', created_at = now() - interval '2 hours', finished_at = null");
    expect((await worker("select public.worker_leader_ai_alerts($1) as r")).rows[0].r.stuck).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------- rewriting

describe("adding to an answer after sending", () => {
  async function strengthenState() {
    await db.admin.query("update public.leader_ai_settings set rewrite_gap_hours = 0");
    const ctx = await sentOn();
    await score(ctx.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "Tell us what draws you to lead." } }));
    return ctx;
  }
  const NEW_WHY = "What draws me is watching someone who felt stuck take one small step, and being able to sit beside them while they do it.";
  const resubmit = (userId: string, appId: string, body: Row) =>
    db.asUser(userId, (q) => q("select public.resubmit_leader_answers($1, $2::jsonb) as r", [appId, JSON.stringify(body)]));

  it("takes only the answers asked for, only if they changed, and only after the quick check", async () => {
    const { user, appId } = await strengthenState();
    await expectCode(resubmit(user.id, appId, {}), "22023");
    await expectCode(resubmit(user.id, appId, { obstacles: NEW_WHY }), "22023"); // not asked
    await expectCode(resubmit(user.id, appId, { why: TEXT.why }), "22023"); // unchanged
    await expectCode(resubmit(user.id, appId, { why: "too short" }), "22023");
    await expectCode(resubmit(user.id, appId, { why: NEW_WHY }), "22023"); // no quick check yet
    await recordCheck(appId, "why", NEW_WHY, { ok: false });
    await expectCode(resubmit(user.id, appId, { why: NEW_WHY }), "22023"); // failed check
  });

  it("replaces the answer, keeps the old one for the panel, and queues another reading", async () => {
    const { user, appId } = await strengthenState();
    await recordCheck(appId, "why", NEW_WHY);
    const r = (await resubmit(user.id, appId, { why: NEW_WHY })).rows[0].r;
    expect(r).toMatchObject({ ok: true, round: 1 });
    const app = (await db.admin.query("select answers #>> '{calling,why}' as why from public.leader_applications where id = $1", [appId])).rows[0];
    expect(app.why).toBe(NEW_WHY);
    expect((await db.admin.query("select field, round, body from public.leader_answer_versions where application_id = $1", [appId])).rows).toEqual([
      { field: "why", round: 0, body: TEXT.why },
    ]);
    expect(await state(appId)).toMatchObject({ state: "checking", rewrites_used: 1 });
    const job = (await claim()).find((j) => j.application === appId)!;
    expect(job).toMatchObject({ origin: "rewrite", rewrites_used: 1, run: 2 });
    expect((await save(job.job, result())).outcome).toBe("clear");
  });

  it("waits between updates, and stops after the last one", async () => {
    await db.admin.query("update public.leader_ai_settings set rewrite_gap_hours = 24");
    const ctx = await sentOn();
    await score(ctx.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "Tell us what draws you to lead." } }));
    expect((await status(ctx.user.id, ctx.appId)).can_rewrite_now).toBe(true);
    await recordCheck(ctx.appId, "why", NEW_WHY);
    await resubmit(ctx.user.id, ctx.appId, { why: NEW_WHY });
    await score(ctx.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "Add a real example of helping someone." } }));
    const s = await status(ctx.user.id, ctx.appId);
    expect(s).toMatchObject({ state: "strengthen", can_rewrite_now: false, rewrites_left: 1 });
    expect(s.next_rewrite_at).toBeTruthy();
    const again = `${NEW_WHY} For example, last month I drove to a friend's house every evening for a week to help with her CV.`;
    await recordCheck(ctx.appId, "why", again);
    await expectCode(resubmit(ctx.user.id, ctx.appId, { why: again }), "22023");
    await db.admin.query("update public.leader_ai_state set last_rewrite_at = now() - interval '25 hours'");
    await resubmit(ctx.user.id, ctx.appId, { why: again });
    // Weak again with no updates left: a person decides
    const last = await score(ctx.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "More please." + " x".repeat(6) } }));
    expect(last.saved).toMatchObject({ outcome: "held", state: "held" });
  });

  it("lets the applicant hand it to a person instead", async () => {
    const { user, appId } = await strengthenState();
    await db.asUser(user.id, (q) => q("select public.ask_leader_person_look($1)", [appId]));
    expect(await state(appId)).toMatchObject({ state: "held" });
    expect((await state(appId))!.asked_person_at).not.toBeNull();
    await expectCode(db.asUser(user.id, (q) => q("select public.ask_leader_person_look($1)", [appId])), "22023");
    const other = await person();
    await expectCode(db.asUser(other.id, (q) => q("select public.ask_leader_person_look($1)", [appId])), "P0002");
  });

  it("lets a pastor send an application back in their own words, with one more update", async () => {
    const { user, appId } = await strengthenState();
    await db.admin.query("update public.leader_ai_state set state = 'held', rewrites_used = 2, last_rewrite_at = now()");
    const pastor = await person("pastor");
    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.leader_ai_send_back($1, array['why'], 'Please say more about this.')", [appId])), "42501");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.leader_ai_send_back($1, array['why'], 'short')", [appId])), "22023");
    await expectCode(db.asUser(pastor.id, (q) => q("select public.leader_ai_send_back($1, array['nonsense'], 'Please say more about this.')", [appId])), "22023");
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_send_back($1, array['why', 'obstacles'], 'Pastor here: say more about the travel and why you want to lead.')", [appId]));
    const s = await status(user.id, appId);
    expect(s).toMatchObject({ state: "strengthen", rewrites_left: 1, can_rewrite_now: true });
    expect(Object.keys(s.notes as Row).sort()).toEqual(["obstacles", "why"]);
  });
});

// ---------------------------------------------------------------------------------------------------- switching on and shadow

describe("switching on", () => {
  it("brings in people already waiting, asks the ones who have not agreed to the new wording, and leaves people's work alone", async () => {
    const waiting = await person();
    const waitingApp = await draft(waiting.id, { consent: NEW_WORDING });
    await submit(waiting.id, waitingApp);
    const needsConsent = await person();
    const needsConsentApp = await draft(needsConsent.id, { consent: OLD_WORDING });
    await submit(needsConsent.id, needsConsentApp);
    const reviewed = await person();
    const reviewedApp = await draft(reviewed.id, { consent: NEW_WORDING });
    await submit(reviewed.id, reviewedApp);
    const coach = await person("coach");
    await db.asUser(coach.id, (q) => q(`select public.save_review($1, 'calling', '{"q1":4,"q2":4,"q3":4,"q4":4,"q5":4,"q6":4}'::jsonb, '')`, [reviewedApp]));
    const stillDraft = await person();
    const draftApp = await draft(stillDraft.id, { consent: OLD_WORDING });
    const invited = await person();
    const invitedApp = await draft(invited.id, { consent: OLD_WORDING });
    await submit(invited.id, invitedApp);
    await db.admin.query("update public.leader_applications set status = 'interview_invited' where id = $1", [invitedApp]);

    const pastor = await person("pastor");
    const res = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('on') as r"))).rows[0].r;
    expect(res).toMatchObject({ mode: "on", queued: 2 });
    expect((await db.admin.query("select activated_at is not null as on from public.leader_ai_settings")).rows[0].on).toBe(true);

    expect(await state(waitingApp)).toMatchObject({ state: "checking", basis: "ai" });
    expect(await state(needsConsentApp)).toMatchObject({ state: "consent_needed", basis: "ai" });
    expect(await state(reviewedApp)).toBeUndefined();
    expect(await state(draftApp)).toBeUndefined();
    expect(await state(invitedApp)).toBeUndefined();
    expect(await messages(needsConsent.id, "leader_check_consent")).toHaveLength(1);

    // Agreeing puts them in the queue
    expect(await status(needsConsent.id, needsConsentApp)).toMatchObject({ state: "consent_needed", consent_ok: false });
    await db.asUser(needsConsent.id, (q) => q("select public.accept_leader_ai_consent($1)", [needsConsentApp]));
    expect(await state(needsConsentApp)).toMatchObject({ state: "checking" });
    expect((await db.admin.query("select origin from public.leader_ai_jobs where application_id = $1", [needsConsentApp])).rows[0].origin).toBe("batch");
    expect((await db.admin.query("select count(*)::int as n from public.event_log where action = 'leader.ai_consent' and entity_id = $1", [needsConsentApp])).rows[0].n).toBe(1);

    // Switching on again does nothing twice
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('off')"));
    const again = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('on') as r"))).rows[0].r;
    expect(again.queued).toBe(0);
  });

  it("records every application in play in shadow mode, changes nothing for anyone, and shows what it would have done", async () => {
    const user = await person();
    const appId = await draft(user.id, { consent: OLD_WORDING });
    await submit(user.id, appId);
    const pastor = await person("pastor");
    expect((await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('shadow') as r"))).rows[0].r.queued).toBe(1);

    // Consent not given: the job says so, and only the instant checks may run
    const job = (await claim())[0];
    expect(job).toMatchObject({ shadow: true, ai_allowed: false, origin: "batch" });
    await save(job.job, result({ ai_ran: false, scores: null, flags: ["gibberish"] }));
    expect(await state(appId)).toBeUndefined();
    expect(await status(user.id, appId)).toMatchObject({ state: "none" });

    // New sends in shadow mode are recorded too, and never held
    const second = await person();
    const secondApp = await draft(second.id, { consent: NEW_WORDING });
    await submit(second.id, secondApp);
    await score(secondApp, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "Tell us more about why." } }));
    expect(await state(secondApp)).toBeUndefined();
    expect(await messages(second.id, "leader_check_strengthen")).toHaveLength(0);

    const overview = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_overview() as r"))).rows[0].r;
    expect(overview.shadow).toMatchObject({ applications: 2, would_strengthen: 1, would_hold: 1, instant_only: 1 });
    expect(overview.usage.ai_runs_30d).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------- people stay in charge

describe("people stay in charge", () => {
  it("lets a pastor clear a held application, after which two reviewers score it as before", async () => {
    const { user, appId } = await sentOn();
    await score(appId, result({ flags: ["copied_or_templated"] }));
    expect(await state(appId)).toMatchObject({ state: "held" });
    const pastor = await person("pastor");
    const coach = await person("coach");
    await expectCode(db.asUser(coach.id, (q) => q("select public.leader_ai_clear($1, 'x')", [appId])), "42501");
    await expectCode(db.asUser(user.id, (q) => q("select public.leader_ai_clear($1, 'x')", [appId])), "42501");
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_clear($1, 'Known to me, a long-time member')", [appId]));
    expect(await state(appId)).toMatchObject({ state: "cleared_by_person", basis: "person" });
    expect((await state(appId))!.cleared_by).toBe(pastor.id);
    expect(await status(user.id, appId)).toMatchObject({ state: "clear", referees_open: true });
    // The held screen promises a message when the referee links open: a pastor letting it through sends it
    expect(await messages(user.id, "leader_check_clear")).toHaveLength(1);

    for (const slot of [1, 2]) {
      const ref = (await db.admin.query("select id from public.leader_references where application_id = $1 and slot = $2", [appId, slot])).rows[0].id;
      const secret = (await db.asUser(user.id, (q) => q("select public.renew_referee_link($1) as s", [ref]))).rows[0].s;
      await db.asAnon((q) => q("select public.submit_reference($1, 5, 5, 5, 5, false, null)", [secret]));
    }
    await expectCode(db.asUser(pastor.id, (q) => q("select public.invite_to_interview($1)", [appId])), "22023");
    const director = await person("director");
    for (const who of [coach, director])
      await db.asUser(who.id, (q) => q(`select public.save_review($1, 'calling', '{"q1":4,"q2":4,"q3":4,"q4":4,"q5":4,"q6":4}'::jsonb, '')`, [appId]));
    await db.asUser(pastor.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    const readiness = (await db.admin.query("select public.application_readiness($1) as r", [appId])).rows[0].r;
    expect(readiness).toMatchObject({ calling_source: "people", calling_reviews: 2 });
  });

  it("never lets a pastor clear their own application", async () => {
    await setMode("on");
    const pastor = await person("pastor");
    const appId = await draft(pastor.id);
    await checkAll(appId);
    await submit(pastor.id, appId);
    await expectCode(db.asUser(pastor.id, (q) => q("select public.leader_ai_clear($1, 'me')", [appId])), "P0002");
  });

  it("shows the AI's score to a pastor at once, and to a coach only after the coach has scored", async () => {
    const { appId } = await sentOn();
    await score(appId, result({ flags: ["off_topic"], scores: { ...GOOD, q1: 2 }, feedback: { why: "Tell us what draws you to lead." } }));
    const pastor = await person("pastor");
    const coach = await person("coach");
    const card = (id: string) => db.asUser(id, (q) => q("select public.leader_ai_scorecard($1) as r", [appId])).then((r) => r.rows[0].r as Row);

    const forPastor = await card(pastor.id);
    expect(forPastor).toMatchObject({ visible: true, state: "strengthen", basis: "ai", mode: "on" });
    expect(forPastor.run).toMatchObject({ outcome: "strengthen", calling_pct: 73.33, flags: ["off_topic"], shadow: false });
    expect(forPastor.run.evidence.q1[0].quote).toContain("help other people");
    expect(forPastor.runs).toHaveLength(1);
    expect(forPastor.can_clear).toBe(true);

    const before = await card(coach.id);
    expect(before.visible).toBe(false);
    expect(before.run).toBeNull();
    expect(before.runs).toBeNull();
    expect(before.can_clear).toBe(false);
    expect(before.state).toBe("strengthen");

    await db.asUser(coach.id, (q) => q(`select public.save_review($1, 'calling', '{"q1":3,"q2":3,"q3":3,"q4":3,"q5":3,"q6":3}'::jsonb, '')`, [appId]));
    const after = await card(coach.id);
    expect(after.visible).toBe(true);
    expect(after.run.calling_pct).toBe(73.33);

    const stranger = await person();
    await expectCode(db.asUser(stranger.id, (q) => q("select public.leader_ai_scorecard($1)", [appId])), "42501");
  });

  it("names the other application when the same words turn up twice", async () => {
    const first = await sentOn();
    const second = await sentOn();
    await score(first.appId);
    await score(second.appId, result({ flags: ["duplicate_of_other"], reasons: { duplicate_of: [first.appId] } }));
    const pastor = await person("pastor");
    const card = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_scorecard($1) as r", [second.appId]))).rows[0].r;
    expect(card.duplicates).toHaveLength(1);
    expect(card.duplicates[0].id).toBe(first.appId);
    expect(JSON.stringify(card.run.reasons)).not.toContain(first.appId);
  });

  it("badges the review queue and never shows a person their own application", async () => {
    await setMode("on");
    const { appId } = await sentOn();
    const pastor = await person("pastor");
    const ownApp = await draft(pastor.id);
    await checkAll(ownApp);
    await submit(pastor.id, ownApp);
    const queue = (await db.asUser(pastor.id, (q) => q("select public.leader_ai_queue() as r"))).rows[0].r as Row[];
    expect(queue.find((x) => x.id === appId)).toMatchObject({ state: "checking", basis: "ai" });
    expect(queue.find((x) => x.id === ownApp)).toBeUndefined();
    await expectCode(db.asUser((await person()).id, (q) => q("select public.leader_ai_queue()")), "42501");
  });
});

describe("the held list", () => {
  it("pages, filters and searches, oldest waiting first, asked-for-a-person first of all", async () => {
    const pastor = await person("pastor");
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const ctx = await sentOn();
      await db.admin.query("update public.people set full_name = $2 where id = $1", [ctx.user.id, `Applicant ${String.fromCharCode(65 + i)}`]);
      ids.push(ctx.appId);
      await score(ctx.appId, result({ flags: ["copied_or_templated"] }));
      await db.admin.query("update public.leader_ai_state set state_at = now() - make_interval(days => $2) where application_id = $1", [ctx.appId, 10 - i]);
    }
    const clear = await sentOn();
    await score(clear.appId);
    await db.admin.query("update public.leader_ai_state set asked_person_at = now() where application_id = $1", [ids[5]]);

    const page = (offset: number, filter = "held", search: string | null = null) =>
      db.asUser(pastor.id, (q) => q("select public.leader_ai_list($1, $2, 3, $3) as r", [filter, search, offset])).then((r) => r.rows[0].r as Row);
    const first = await page(0);
    expect(first.total).toBe(7);
    expect(first.counts).toMatchObject({ held: 7, clear: 1 });
    expect(first.rows.map((r: Row) => r.id)).toEqual([ids[5], ids[0], ids[1]]);
    expect(first.rows[0]).toMatchObject({ asked_person_at: expect.any(String), flags: ["copied_or_templated"], outcome: "held", waiting_days: 5 });
    expect((await page(3)).rows.map((r: Row) => r.id)).toEqual([ids[2], ids[3], ids[4]]);
    expect((await page(6)).rows.map((r: Row) => r.id)).toEqual([ids[6]]);
    expect((await page(0, "clear")).total).toBe(1);
    expect((await page(0, "all")).total).toBe(8);
    expect((await page(0, "held", "applicant c")).rows.map((r: Row) => r.id)).toEqual([ids[2]]);
    expect((await page(0, "held", "100%")).total).toBe(0);
    await expectCode(page(0, "everything"), "22023");
  });
});

// ---------------------------------------------------------------------------------------------------- fingerprints

describe("fingerprints", () => {
  const print = (appId: string, field: string, hash: string, sim: string, words = 20) =>
    worker("select public.worker_leader_print($1, $2, $3, $4, $5::bigint, $6) as r", [appId, field, hash, sim, words]).then((r) => r.rows[0].r as Row);
  const h = (c: string) => c.repeat(64);

  it("spots the same words in two answers, and the same or nearly the same words from someone else", async () => {
    const a = await person();
    const b = await person();
    const appA = await draft(a.id);
    const appB = await draft(b.id);
    expect(await print(appA, "why", h("a"), "1000")).toEqual({ same_in_own: [], other_apps: [] });
    expect(await print(appA, "walked", h("a"), "1000")).toEqual({ same_in_own: ["why"], other_apps: [] });
    // Someone else: the identical text, then the same text with a few words changed (simhash differs by a few bits)
    expect(await print(appB, "why", h("a"), "1000")).toMatchObject({ other_apps: [appA] });
    expect(await print(appB, "why", h("b"), "1003")).toMatchObject({ other_apps: [appA] });
    expect(await print(appB, "why", h("c"), "-1")).toMatchObject({ other_apps: [] });
    // Short answers never match, and a person's own earlier application is not "someone else"
    expect(await print(appB, "why", h("a"), "1000", 11)).toEqual({ same_in_own: [], other_apps: [] });
    await db.admin.query("update public.leader_applications set status = 'not_approved' where id = $1", [appA]);
    const appA2 = await draft(a.id);
    await print(appB, "why", h("a"), "1000");
    expect(await print(appA2, "why", h("a"), "1000")).toEqual({ same_in_own: [], other_apps: [appB] });
    // Only the latest print per answer is kept
    expect((await db.admin.query("select count(*)::int as n from public.leader_answer_prints where application_id = $1", [appB])).rows[0].n).toBe(1);
  });
});

describe("the messages", () => {
  it("writes the three applicant messages in every channel from what the database supplies, and never mentions how anything was read", async () => {
    const { wordingProblems } = await import("./contract");
    await db.admin.query("delete from public.messages where template like 'leader_check_%'");
    const strengthen = await sentOn();
    await score(strengthen.appId, result({ scores: { ...GOOD, q2: 1 }, feedback: { why: "Tell us what draws you to lead, in your own words." } }));
    const clear = await sentOn();
    await score(clear.appId);

    const old = await person();
    const oldApp = await draft(old.id, { consent: OLD_WORDING });
    await setMode("off");
    await submit(old.id, oldApp);
    const pastor = await person("pastor");
    await db.asUser(pastor.id, (q) => q("select public.leader_ai_set_mode('on')"));

    const rows = (
      await db.admin.query("select id, template, params, urgency, reply_token from public.messages where template in ('leader_check_consent', 'leader_check_strengthen', 'leader_check_clear')")
    ).rows;
    expect(rows.map((r) => r.template).sort()).toEqual(["leader_check_clear", "leader_check_consent", "leader_check_strengthen"]);
    expect(await wordingProblems(rows)).toEqual([]);

    const { TEMPLATES } = await import("@/lib/messaging/templates");
    const { buildContext, renderEmail, renderSms, renderWhatsApp } = await import("@/lib/messaging/render");
    for (const row of rows) {
      const msg = { id: row.id, template: row.template, channel: "email" as const, params: row.params, urgency: "normal" as const, attempts: 1, reply_token: null, to: { email: "ada@example.org", phone: "+2348031234567", name: "Ada Test", first_name: "Ada" } };
      expect(TEMPLATES[row.template].audience).toBe("applicant");
      const email = renderEmail(msg, "https://unitedtribes.example");
      const everything = [email.subject, email.text, renderSms(msg, "https://unitedtribes.example"), renderWhatsApp(msg, "https://unitedtribes.example").vars.join("\n")].join("\n");
      expect(everything, row.template).not.toMatch(/\b(score|scored|flag|flagged|AI|artificial|computer|algorithm|automated|model|rubric)\b/i);
      expect(buildContext(msg, "https://unitedtribes.example").link("/lead")).toBe("https://unitedtribes.example/lead");
    }
  });
});
