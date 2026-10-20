import { expect } from "vitest";
import { makeOwner } from "./activity-kit";
import type { Row, TestDb } from "./helpers";
import { ELIG_KEYS, answers, setPositions, type EligKey, type PipelineKit, type Pos, type Positions } from "./pipeline-kit";

// Phase 8, part one: the combined test matrix. One journey takes an applicant from the first answer to a tribe members can see, under a full
// set of positions of every switch, and the twelve invariants are read after every one. This file holds the combinations, the journey and
// the invariants; matrix.test.ts runs them.

// ---------------------------------------------------------------------------------------------------------------------------------
// The combinations
// ---------------------------------------------------------------------------------------------------------------------------------

export type EligibilitySet = "required" | "open_door" | "off";
export type Declaration = "required" | "off";
export type Combo = {
  eligibility: EligibilitySet;
  references: Pos;
  interview: Pos;
  fit: "on" | "off";
  academy: Pos;
  declaration: Declaration;
};

export const DIMENSIONS = {
  eligibility: ["required", "open_door", "off"] as EligibilitySet[],
  references: ["required", "optional", "off"] as Pos[],
  interview: ["required", "optional", "off"] as Pos[],
  fit: ["off", "on"] as ("on" | "off")[],
  academy: ["required", "optional", "off"] as Pos[],
  declaration: ["required", "off"] as Declaration[],
};

/** Every combination, in a fixed order: 3 x 3 x 3 x 2 x 3 x 2 = 324. */
export function allCombos(): Combo[] {
  const out: Combo[] = [];
  for (const eligibility of DIMENSIONS.eligibility)
    for (const references of DIMENSIONS.references)
      for (const interview of DIMENSIONS.interview)
        for (const fit of DIMENSIONS.fit)
          for (const academy of DIMENSIONS.academy)
            for (const declaration of DIMENSIONS.declaration) out.push({ eligibility, references, interview, fit, academy, declaration });
  return out;
}

const c = (eligibility: EligibilitySet, references: Pos, interview: Pos, fit: "on" | "off", academy: Pos, declaration: Declaration): Combo => ({
  eligibility, references, interview, fit, academy, declaration,
});

/**
 * The twelve that run every day. Together they put every position of every switch at least once: today's, everything on, the open door,
 * everything off, and a spread of the mixed ones in between.
 */
export const REPRESENTATIVE: Combo[] = [
  c("required", "required", "required", "off", "required", "required"), // today
  c("required", "required", "required", "on", "required", "required"), // today, with Find your tribe on
  c("open_door", "off", "off", "on", "required", "required"), // the open door
  c("off", "off", "off", "off", "off", "off"), // everything off
  c("required", "optional", "optional", "off", "optional", "required"),
  c("open_door", "required", "off", "on", "off", "required"),
  c("off", "optional", "required", "on", "optional", "off"),
  c("required", "off", "optional", "off", "off", "off"),
  c("open_door", "optional", "optional", "on", "optional", "off"),
  c("off", "required", "required", "off", "off", "required"),
  c("required", "required", "off", "on", "required", "off"),
  c("open_door", "off", "required", "off", "optional", "required"),
];

export const comboName = (x: Combo) =>
  `questions ${x.eligibility.replace("_", " ")} · references ${x.references} · interview ${x.interview} · Find your tribe ${x.fit} · Academy ${x.academy} · declaration ${x.declaration}`;

export function positionsOf(x: Combo): Positions {
  const eligibility = Object.fromEntries(
    ELIG_KEYS.map((k) => [k, x.eligibility === "off" ? "off" : x.eligibility === "open_door" && ["member6", "foundation", "serving"].includes(k) ? "off" : "required"]),
  ) as Record<EligKey, Pos>;
  return { eligibility, references: x.references, interview: x.interview, academy: x.academy, declaration: x.declaration };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------------------------------------------------------------

/** The rule table for a certificate, written out the long way (the same table the Academy switch tests use). */
export function shouldBeCertified(s: { modules: boolean; practice: boolean; declaration: boolean; card: boolean }, academy: Pos, declaration: Declaration): boolean {
  const modulesOk = academy !== "required" || s.modules;
  const practiceOk = academy !== "required" || s.practice;
  const declarationOk = declaration !== "required" || s.declaration;
  return modulesOk && practiceOk && declarationOk && s.card;
}

/** Every key of a value, however deep. */
export function deepKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) deepKeys(v, into);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      deepKeys(v, into);
    }
  }
  return into;
}

/** What an applicant must never be handed by the Find your tribe screen, whatever else it says. */
export const FIT_SECRET_KEYS = [
  "judgement", "care", "care_flag", "care_bar", "sensitive", "components", "parts", "weights", "demand", "gap", "waiting", "seats_open",
  "interested", "model", "model_version", "closeness", "flags", "first_goal_id", "inputs",
];
/** What a leader must never be handed of the ready-made card behind their own tribe. */
export const CARD_SECRET_KEYS = [
  "sensitive", "who_leads_well", "demand_structure", "demand_connection", "demand_teaching", "demand_doing", "track_slugs", "leadership_profile", "demand",
  "signed_off_by", "status",
];
/** What an applicant must never be handed of their own application. */
export const APPLICANT_SECRET_WORDS = /evidence|reduced|score|readiness|judgement|care_|tag|reason|weights|sensitive|leadership_profile|leads_well/i;

/** The number of rows in every table of the public schema (exact). */
export async function tableCounts(db: TestDb): Promise<Map<string, number>> {
  const { rows } = await db.admin.query(
    `select table_name::text as t,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int as n
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by 1`,
  );
  return new Map(rows.map((r) => [r.t as string, r.n as number]));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------------------------------------------------------------

export const GOOD_CARD = {
  name: "Matrix tribe",
  story: "I was passed over twice before I learned to lead by serving. Now I lead a team of eight and I want to help you do it with your peace intact.",
  meeting_day: 3,
  meeting_time: "20:00",
  mode: "online",
  zone: "mainland",
  place_note: "Yaba side, mostly online",
  capacity: 10,
  god: "Read the week’s passage and say the confession five days a week.",
  others: "Pray for our triad weekly; nobody misses twice without a call.",
  life: "Each of us completes 10 of 12 weekly steps and has one leadership conversation.",
};

export type Staff = Awaited<ReturnType<PipelineKit["panel"]>> & { admin: { id: string } };

export type Failure = { invariant: number; text: string };

export type Env = {
  db: TestDb;
  kit: PipelineKit;
  staff: Staff;
  ownerName: string;
  seasonId: string;
  /** The sign-off helper for the Academy side: passing every module, the declaration, the practice. */
  academy: {
    passModule(userId: string, slug: string): Promise<void>;
    passAll(userId: string): Promise<void>;
    sign(userId: string): Promise<void>;
    practice(personId: string): Promise<void>;
  };
};

export type Outcome = {
  combo: Combo;
  failures: Failure[];
  /** The invariants that were actually read in this journey (all twelve, every time). */
  checked: Set<number>;
  /** The facts the test file asserts for the happy path. */
  facts: {
    decided: Row;
    ready: Row;
    role: boolean;
    certified: boolean;
    offered: boolean;
    held: boolean;
  };
};

const sql = (db: TestDb, text: string, params: unknown[] = []) => db.admin.query(text, params).then((r) => r.rows as Row[]);
const call = async (db: TestDb, uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;

let counter = 0;

/** A member whose answers fit the tribe, asking what the platform would offer them. */
async function offeredTo(env: Env, tribeId: string): Promise<boolean> {
  const { db, seasonId } = env;
  const t = (await sql(db, "select community_id, season_goal_id from public.tribes where id = $1", [tribeId]))[0];
  const member = await db.createUser();
  const id = async (table: string, slug: string) => (await sql(db, `select id from public.${table} where slug = $1`, [slug]))[0].id as string;
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
        season_goal_id, goal_baseline, meeting_mode, meeting_times, style_social, style_structure, support_load, duration_seconds)
     values ($1, $2, $3, 'female', 'mixed', 'mainland', $4, 'growing', $5, 3, 'either', $6, 0, 0, 0, 250)`,
    [member.id, seasonId, await id("age_ranges", "33-40"), t.community_id, t.season_goal_id, ["weeknight-evening"]],
  );
  const m = (await db.asUser(member.id, (q) => q("select public.match_me(true) as r", []))).rows[0].r as { tribes: { tribe: { id: string } }[] };
  return m.tribes.map((x) => x.tribe.id).includes(tribeId);
}

/**
 * One applicant, start to finish, under one set of positions. Returns the invariants that failed (none when all is well) and the facts the
 * test file checks for the plain happy path. Every step is the real function, called as the person who would call it.
 */
export async function journey(env: Env, combo: Combo): Promise<Outcome> {
  const { db, kit, staff } = env;
  const n = ++counter;
  const failures: Failure[] = [];
  const checked = new Set<number>();
  const expectThat = (invariant: number, ok: boolean, text: string) => {
    checked.add(invariant);
    if (!ok) failures.push({ invariant, text });
  };

  // The last journey's tribe is out of the way, so it cannot crowd this one out of a member's list
  await db.admin.query("update public.tribes set status = 'closed' where status = 'approved'");

  const before = await tableCounts(db);

  // -- the positions
  const positions = positionsOf(combo);
  await setPositions(db, positions);
  if (combo.fit === "on") await db.admin.query("update public.leader_pipeline_settings set tribe_fit = 'on'");
  const askedQuestions = ELIG_KEYS.filter((k) => positions.eligibility?.[k] === "required");

  /** Find your tribe, when it is on: look, then choose, as the screen does. Returns what the applicant was shown. */
  const chooseTribe = async (userId: string, app: string) => {
    const run = (await call(db, userId, "leader_fit_run", [app])) as Row;
    expectThat(8, run.status === "ok", `the Find your tribe run did not answer ok: ${JSON.stringify(run).slice(0, 200)}`);
    const top = (run.top as Row[]) ?? [];
    if (top.length === 0) return [run];
    const pick = top[n % top.length];
    const chosen = (await call(db, userId, "leader_fit_choose", [app, pick.goal_id, []])) as Row;
    expectThat(8, chosen.ok === true, "the choice was not saved");
    return [run, chosen, await call(db, userId, "leader_fit_state", [app])];
  };

  // -- the applicant answers exactly what is asked
  const user = await kit.person(undefined, `Matrix${n}`);
  const given: Record<string, boolean> = Object.fromEntries(askedQuestions.map((k) => [k, true]));
  const appId = await kit.startDraft(user.id, answers(askedQuestions.length ? given : undefined));
  if (askedQuestions.length > 0) {
    const e = (await db.asUser(user.id, (q) => q("select public.check_leader_eligibility($1) as r", [appId]))).rows[0].r as Row;
    expectThat(7, e.ok === true, `an applicant who answered every Required question was stopped: ${JSON.stringify(e)}`);
  }

  // -- invariant 7, second applicant: a "no" to any question that is not Required never stops anyone
  {
    const other = await kit.person(undefined, `MatrixNo${n}`);
    const mixed = Object.fromEntries(ELIG_KEYS.map((k) => [k, askedQuestions.includes(k)]));
    const otherApp = await kit.startDraft(other.id, answers(mixed));
    if (askedQuestions.length > 0) {
      const e = (await db.asUser(other.id, (q) => q("select public.check_leader_eligibility($1) as r", [otherApp]))).rows[0].r as Row;
      expectThat(7, e.ok === true, `a "no" to a question that is not Required stopped an applicant: ${JSON.stringify(e)}`);
    }
    const st = (await kit.appRow(otherApp)).status;
    expectThat(7, st !== "ineligible", `that applicant was left ineligible (${st})`);
  }

  // -- Find your tribe, when it is on
  let fitJson = "";
  if (combo.fit === "on") {
    const shown = await chooseTribe(user.id, appId);
    fitJson = JSON.stringify(shown);
    const keys = deepKeys(shown);
    for (const secret of FIT_SECRET_KEYS) expectThat(8, !keys.has(secret), `the applicant's Find your tribe view carries "${secret}"`);
  }

  // -- referees, if asked, then send
  const refMode = combo.references;
  const intMode = combo.interview;
  const referees = refMode === "required" ? 2 : refMode === "optional" ? 1 : 0;
  for (let slot = 1; slot <= referees; slot++) await kit.setReferee(user.id, appId, slot, slot === 1 && refMode === "required");
  const sent = (await kit.send(user.id, appId)).rows[0].r as Row;
  expectThat(6, sent?.ok !== false, `the application could not be sent: ${JSON.stringify(sent)}`);
  for (let slot = 1; slot <= referees; slot++) await kit.answerReference(appId, slot, 5);

  // -- the panel
  await kit.review(staff.coach.id, appId, "calling", 5);
  await kit.review(staff.scorer.id, appId, "calling", 5);
  const hold = intMode === "required" || (intMode === "optional" && n % 2 === 0);
  if (hold) {
    await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [appId]));
    const slot = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [new Date(Date.now() + 5 * 864e5).toISOString()]))).rows[0].id as string;
    await db.asUser(user.id, (q) => q("select public.book_interview_slot($1)", [slot]));
    await kit.review(staff.coach.id, appId, "interview", 5);
    await kit.review(staff.scorer.id, appId, "interview", 5);
  }

  // -- invariant 6: nothing is waiting for a stage that is off
  const modes = (await kit.modes(appId)) as Row;
  expectThat(6, modes.references === refMode && modes.interview === intMode, `the application's own positions are ${JSON.stringify(modes)}`);
  const pending = await sql(
    db,
    `select a.status from public.leader_applications a
      where a.id = $1 and ((a.status in ('interview_invited', 'interview_booked') and $2 = 'off'))`,
    [appId, intMode],
  );
  expectThat(6, pending.length === 0, "the application waits for an interview that is off");
  if (intMode === "off") expectThat(6, (await sql(db, "select 1 from public.interview_slots where application_id = $1", [appId])).length === 0, "an interview slot is held for an interview that is off");

  // -- invariant 2: the thresholds and the weights
  const ready = await kit.readiness(appId);
  {
    const w = ready.weights as Record<string, number>;
    const counted = ready.counted as string[];
    const expectedWeights = { calling: 30, scenarios: 25, references: counted.includes("references") ? 25 : 0, interview: counted.includes("interview") ? 20 : 0 };
    expectThat(2, (Object.keys(expectedWeights) as (keyof typeof expectedWeights)[]).every((k) => w[k] === expectedWeights[k]) && Object.keys(w).length === 4, `the weights are ${JSON.stringify(w)}, not ${JSON.stringify(expectedWeights)}`);
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    const parts = { calling: Number(ready.calling), scenarios: Number(ready.scenarios), references: Number(ready.references), interview: Number(ready.interview) };
    const weighted = (Object.keys(w) as (keyof typeof w)[]).reduce((s, k) => s + (w[k] ? parts[k as keyof typeof parts] * w[k] : 0), 0);
    expectThat(2, Math.abs(weighted / total - Number(ready.readiness)) < 0.06, `the readiness ${ready.readiness} is not the weighted mean ${(weighted / total).toFixed(2)} of its parts`);
    const r = Number(ready.readiness);
    expectThat(2, ready.band === (r >= 75 ? "leader" : r >= 60 ? "assistant_leader" : "below"), `band ${ready.band} for ${r} does not follow the bars 75 and 60`);
  }

  // -- invariant 3: an open concern blocks an approval (a second applicant, who gets a concern from the head referee)
  if (referees >= 1) {
    const other = await kit.person(undefined, `MatrixConcern${n}`);
    const otherApp = await kit.startDraft(other.id, answers(askedQuestions.length ? given : undefined));
    if (combo.fit === "on") await chooseTribe(other.id, otherApp);
    for (let slot = 1; slot <= referees; slot++) await kit.setReferee(other.id, otherApp, slot, slot === 1 && refMode === "required");
    await kit.send(other.id, otherApp);
    await kit.answerReference(otherApp, 1, 5, "I saw a moment of poor judgement with money that has not been dealt with.");
    for (let slot = 2; slot <= referees; slot++) await kit.answerReference(otherApp, slot, 5);
    await kit.review(staff.coach.id, otherApp, "calling", 5);
    await kit.review(staff.scorer.id, otherApp, "calling", 5);
    if (intMode === "required") {
      await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [otherApp]));
      const slot = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [new Date(Date.now() + 6 * 864e5).toISOString()]))).rows[0].id as string;
      await db.asUser(other.id, (q) => q("select public.book_interview_slot($1)", [slot]));
      await kit.review(staff.coach.id, otherApp, "interview", 5);
      await kit.review(staff.scorer.id, otherApp, "interview", 5);
    }
    let refused = false;
    try {
      await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null)", [otherApp]));
    } catch (error) {
      refused = /concern|reference check is not clean/i.test((error as Error).message);
    }
    expectThat(3, refused, "a pastor approved an application with a referee's concern still open");
    expectThat(3, (await kit.hasRole(other.id, "leader")) === false, "the applicant with an open concern was given the leader role");
  }

  // -- invariant 3, the whole house: no approved application has a concern still open
  {
    const open = await sql(
      db,
      `select a.id from public.leader_applications a
         join public.leader_references r on r.application_id = a.id
         join public.leader_reference_answers ra on ra.reference_id = r.id
        where a.status in ('approved_leader', 'approved_assistant') and ra.concern and ra.concern_cleared_at is null`,
    );
    expectThat(3, open.length === 0, `${open.length} approved application(s) have a concern that was never cleared`);
  }

  // -- invariant 1: only a pastor's decision produces an approval
  for (const [who, label] of [[staff.coach.id, "a coach"], [staff.director.id, "a director"], [staff.admin.id, "an administrator"]] as const) {
    let refused = false;
    try {
      await db.asUser(who, (q) => q("select public.decide_application($1, 'leader', null)", [appId]));
    } catch (error) {
      refused = (error as { code?: string }).code === "42501";
    }
    expectThat(1, refused, `${label} could decide an application`);
  }
  expectThat(1, (await kit.appRow(appId)).status !== "approved_leader", "the application was approved before a pastor decided");
  const decided = (await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, 'leader', null) as r", [appId]))).rows[0].r as Row;
  expectThat(1, decided.ok === true && decided.status === "approved_leader", `the pastor's decision did not approve: ${JSON.stringify(decided)}`);
  const row = await kit.appRow(appId);
  expectThat(1, row.decided_by === staff.pastor.id, "the approval is not recorded against the pastor");
  const role = await kit.hasRole(user.id, "leader");
  expectThat(1, role === true, "the leader role was not given");
  {
    const stray = await sql(
      db,
      `select a.id from public.leader_applications a
        where a.status in ('approved_leader', 'approved_assistant')
          and (a.decided_by is null or not exists (select 1 from public.person_roles r where r.person_id = a.decided_by and r.role = 'pastor'))`,
    );
    expectThat(1, stray.length === 0, `${stray.length} approved application(s) were not decided by a pastor`);
  }

  // -- invariant 9: the activity funnel shows no drop at a stage that was off
  {
    await db.admin.query("select public.activity_build_people()");
    const rows = await sql(db, "select person_id, stage from public.activity_leader_rows(current_date - 1, current_date + 1) where person_id = $1", [user.id]);
    expectThat(9, rows.length === 1 && Number(rows[0].stage) === 28, `the funnel puts the approved applicant at stage ${rows[0]?.stage}, not 28`);
    const wrong = await sql(
      db,
      `select r.person_id, r.stage from public.activity_leader_rows(current_date - 1, current_date + 1) r
         join public.leader_applications a on a.person_id = r.person_id
        where (r.stage = 24 and public.leader_stage_modes(a.id) ->> 'references' <> 'required')
           or (r.stage = 25 and public.leader_stage_modes(a.id) ->> 'interview' <> 'required')`,
    );
    expectThat(9, wrong.length === 0, `the funnel shows ${wrong.length} application(s) held at a stage that is off`);
  }

  // -- invariant 11: the messages queued match the wording flags, and none is queued twice
  {
    const received = await sql(db, "select params from public.messages where person_id = $1 and template = 'application_received'", [user.id]);
    expectThat(11, received.length === 1, `the applicant has ${received.length} "application received" messages, not one`);
    const p = (received[0]?.params ?? {}) as Row;
    expectThat(11, p.refs === (refMode === "off" ? false : undefined), `"received" says refs=${p.refs} with references ${refMode}`);
    expectThat(11, p.refs_optional === (refMode === "optional" ? true : undefined), `"received" says refs_optional=${p.refs_optional} with references ${refMode}`);
    expectThat(11, p.interview === (intMode === "off" ? false : undefined), `"received" says interview=${p.interview} with the interview ${intMode}`);
    // The approval message is the one that fits the Academy and the declaration: four wordings, never two of them
    const wantTemplate = combo.academy === "required" ? "application_approved" : combo.academy === "optional" ? "application_approved_optional" : combo.declaration === "required" ? "application_approved_declaration" : "application_approved_open";
    const approved = await sql(db, "select template, params from public.messages where person_id = $1 and template like 'application_approved%'", [user.id]);
    expectThat(11, approved.length === 1 && approved[0].template === wantTemplate, `the applicant's approval messages are ${JSON.stringify(approved.map((a) => a.template))}, not just ${wantTemplate}`);
    const flags = (approved[0]?.params ?? {}) as Row;
    expectThat(11, flags.refs === (refMode === "off" ? false : undefined) && flags.interview === (intMode === "off" ? false : undefined), "the approval message carries the wrong wording flags");
    const twice = await sql(db, "select template, count(*)::int n from public.messages where person_id = $1 group by template, params::text having count(*) > 1", [user.id]);
    expectThat(11, twice.length === 0, `queued twice: ${JSON.stringify(twice)}`);
    const interviewMail = await sql(db, "select 1 from public.messages where person_id = $1 and template in ('application_interview_invited', 'application_interview_booked')", [user.id]);
    expectThat(11, hold ? interviewMail.length > 0 : interviewMail.length === 0, hold ? "no interview message was queued for the interview that was held" : "an interview message was queued for an interview that was not held");
    // a referee is asked once each
    const asked = await sql(db, "select to_email, count(*)::int n from public.messages where template = 'referee_request' and params ->> 'applicant' is not null and created_at > now() - interval '1 hour' group by to_email having count(*) > 1");
    expectThat(11, asked.length === 0, "a referee was asked twice");
  }

  // -- invariant 8: the applicant's own view
  {
    const mine = (await call(db, user.id, "my_application_modes", [appId])) as Row;
    expectThat(8, !APPLICANT_SECRET_WORDS.test(JSON.stringify(mine)), `the applicant's own view carries something the panel keeps: ${JSON.stringify(mine)}`);
    expectThat(8, JSON.stringify(Object.keys(mine).sort()) === JSON.stringify(["eligibility", "interview", "references", "sent"]), `the applicant's view has the keys ${Object.keys(mine)}`);
    let blocked = 0;
    for (const t of ["leader_application_policy", "leader_reviews", "leader_fit_runs"]) {
      try {
        await db.asUser(user.id, (q) => q(`select * from public.${t}`));
      } catch (error) {
        if ((error as { code?: string }).code === "42501") blocked += 1;
      }
    }
    expectThat(8, blocked === 3, `the applicant can read ${3 - blocked} of the panel's tables`);
    expectThat(8, !/(sensitive|judgement)/.test(fitJson), "the fit screen carried a hidden word");
  }

  // -- the certificate, the Tribe Card and who can see the tribe
  const facts = { decided, ready, role, certified: false, offered: false, held: false };
  {
    const academy = combo.academy;
    const declaration = combo.declaration;
    const state = { modules: false, practice: false, declaration: false, card: false };
    const isCertified = async () => (await sql(db, "select 1 from public.leader_certifications where person_id = $1", [user.id])).length > 0;
    const checkRule = async (when: string) => {
      const want = shouldBeCertified(state, academy, declaration);
      const got = await isCertified();
      expectThat(5, got === want, `${when}: certified is ${got} but the rule table says ${want}`);
      return got;
    };
    await checkRule("straight after the decision");

    if (academy === "required") {
      await env.academy.passModule(user.id, "the-success-picture");
      await checkRule("after the first module");
    }
    const cardId = (await db.asUser(user.id, (q) => q("select public.start_tribe_card() as id"))).rows[0].id as string;
    await db.asUser(user.id, (q) => q("select public.save_tribe_card($1, $2::jsonb)", [cardId, JSON.stringify({ ...GOOD_CARD, name: `Matrix tribe ${n}` })]));

    // invariant 8, the card: what the leader is shown of the ready-made card has no hidden data
    const behind = (await call(db, user.id, "card_template_for_tribe", [cardId])) as Row | null;
    if (behind) {
      const keys = deepKeys(behind);
      for (const secret of CARD_SECRET_KEYS) expectThat(8, !keys.has(secret), `the ready-made card shown to the leader carries "${secret}"`);
      expectThat(8, !/(sensitive|who_leads_well)/.test(JSON.stringify(behind)), "the ready-made card shown to the leader carries a hidden word");
    }

    await db.asUser(user.id, (q) => q("select public.submit_tribe_card($1)", [cardId]));
    await checkRule("with the card submitted");
    expectThat(4, !(await offeredTo(env, cardId)), "a card that is not approved was shown to members");

    await db.asUser(staff.pastor.id, (q) => q("select public.decide_tribe_card($1, 'approve', null)", [cardId]));
    state.card = true;
    await db.admin.query(
      "update public.tribes set published_at = now(), slot = 'weeknight-evening', meeting_day = 3, meeting_time = '20:00', zone = 'mainland', meeting_mode = 'in_person' where id = $1",
      [cardId],
    );
    const otherThingsAsked = academy === "required" || declaration === "required";
    const nowCertified = await checkRule("with the card approved");
    expectThat(4, nowCertified === !otherThingsAsked, `with the card approved and ${otherThingsAsked ? "other things still asked" : "nothing else asked"}, certified is ${nowCertified}`);
    expectThat(4, (await offeredTo(env, cardId)) === nowCertified, `with the card approved and certified ${nowCertified}, the tribe's visibility to members is the other way round`);

    if (otherThingsAsked) {
      if (academy === "required") {
        await env.academy.passAll(user.id);
        state.modules = true;
        await checkRule("after every module");
      }
      if (declaration === "required") {
        await env.academy.sign(user.id);
        state.declaration = true;
        await checkRule("after the declaration");
      }
      if (academy === "required") {
        await env.academy.practice(user.id);
        state.practice = true;
        await checkRule("after the practice");
      }
    }
    facts.certified = await isCertified();
    facts.offered = await offeredTo(env, cardId);
    facts.held = state.card;
    expectThat(5, facts.certified === true, "after everything that is asked, the leader is not certified");
    expectThat(4, facts.offered === true, "an approved card of a certified leader is not shown to members");
  }

  // -- invariants 10 and 12, the ones that read the whole house
  {
    const needle = env.ownerName;
    const places = await sql(
      db,
      `select 'event_log' as place, count(*)::int n from public.event_log e where e::text ilike '%' || $1 || '%'
       union all select 'leader_pipeline_log', count(*)::int from public.leader_pipeline_log l where l::text ilike '%' || $1 || '%'
       union all select 'messages', count(*)::int from public.messages m where m::text ilike '%' || $1 || '%'
       union all select 'card_templates', count(*)::int from public.tribe_card_templates t where t::text ilike '%' || $1 || '%'`,
      [needle],
    );
    for (const p of places) expectThat(10, p.n === 0, `the hidden owner's name is in ${p.place}`);
    const list = (await call(db, staff.pastor.id, "card_template_list", [])) as Row[];
    expectThat(10, !JSON.stringify(list).toLowerCase().includes(needle.toLowerCase()), "the hidden owner's name is in the card list a pastor sees");

    const after = await tableCounts(db);
    for (const [table, was] of before) {
      const now = after.get(table) ?? 0;
      expectThat(12, now >= was, `the table ${table} lost rows: ${was} before, ${now} after`);
    }
  }

  return { combo, failures, checked, facts };
}

/** The static count of the 324. */
export const TOTAL = DIMENSIONS.eligibility.length * DIMENSIONS.references.length * DIMENSIONS.interview.length * DIMENSIONS.fit.length * DIMENSIONS.academy.length * DIMENSIONS.declaration.length;


/**
 * Everything a journey needs around it: the panel and an administrator, a hidden owner who signs some cards off, cards signed off through
 * the real function (a few of the sensitive ones among them), the fit model approved, and the helpers for the Academy.
 */
export async function makeEnv(db: TestDb, kit: PipelineKit, ownerName: string): Promise<Env> {
  const panel = await kit.panel();
  const admin = await kit.person("admin", "Admin");
  const seasonId = (await sql(db, "select id from public.seasons where status in ('planning','open') order by starts_on limit 1"))[0].id as string;

  const owner = await makeOwner(db);
  await db.admin.query("update public.people set full_name = $2, preferred_name = 'Zephyrine' where id = $1", [owner.owner.id, ownerName]);

  const signOff = (slug: string, by: "pastor" | "owner") =>
    by === "owner" ? owner.run((q) => q("select public.card_template_sign_off($1)", [slug])) : db.asUser(panel.pastor.id, (q) => q("select public.card_template_sign_off($1)", [slug]));
  await signOff("step-into-a-leadership-role", "pastor");
  await signOff("grow-a-network-that-opens-doors", "pastor");
  const sensitive = (await sql(db, "select slug from public.tribe_card_templates where sensitive and track_slugs @> array['builders'] order by slug limit 2")).map((r) => r.slug as string);
  expect(sensitive.length).toBeGreaterThan(0);
  for (const [i, slug] of sensitive.entries()) await signOff(slug, i === 0 ? "owner" : "pastor");
  await db.asUser(panel.pastor.id, (q) => q("select public.leader_fit_model_activate('lf-1')"));
  expect((await sql(db, "select public.leader_fit_ready() as r"))[0].r).toBe(true);

  const answerKey = async (slug: string): Promise<number[]> =>
    (await sql(db, "select q.correct from public.academy_questions q join public.academy_modules m on m.id = q.module_id where m.slug = $1 order by q.position", [slug])).map((r) => r.correct as number);
  const passModule = async (userId: string, slug: string) => {
    const key = JSON.stringify(await answerKey(slug));
    await db.asUser(userId, (q) => q("select public.submit_quiz($1, $2::jsonb)", [slug, key]));
  };
  return {
    db,
    kit,
    staff: { ...panel, admin } as Staff,
    ownerName,
    seasonId,
    academy: {
      passModule,
      passAll: async (userId) => {
        for (const m of await sql(db, "select slug from public.academy_modules where active order by number")) await passModule(userId, m.slug as string);
      },
      sign: async (userId) => {
        await db.asUser(userId, (q) => q("select public.sign_safeguarding('2026-11-s1', 'Tola Adeyemi')"));
      },
      practice: async (personId) => {
        await db.asUser(panel.coach.id, (q) => q("select public.record_practice($1, 'co_lead', true, 'Steady and kind.')", [personId]));
      },
    },
  };
}
