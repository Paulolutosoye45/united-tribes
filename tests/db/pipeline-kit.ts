import type { Row, TestDb } from "./helpers";
import { answerAs, listInDirectory, uniqueEmail } from "./referee-kit";

// Shared by the switchboard tests: set the switches, then take an application through the database exactly as the form, the panel and
// the pastor would, whatever the switches say.

export const ELIG_KEYS = ["member6", "foundation", "serving", "age21", "time", "safeguarding", "confidentiality"] as const;
export type EligKey = (typeof ELIG_KEYS)[number];
export type Pos = "required" | "optional" | "off";

export type Positions = {
  eligibility?: Partial<Record<EligKey, Pos>>;
  references?: Pos;
  interview?: Pos;
  academy?: Pos;
  declaration?: "required" | "off";
};

// The answer key: best picks rate 4, worst picks rate 1.
const BEST = { s1: "b", s2: "b", s3: "a", s4: "a", s5: "a", s6: "a" } as Record<string, string>;
const WORST = { s1: "d", s2: "c", s3: "d", s4: "c", s5: "b", s6: "c" } as Record<string, string>;
const picks = (best: Record<string, string>, worst: Record<string, string>) =>
  Object.fromEntries(Object.keys(best).map((k) => [k, { best: best[k], worst: worst[k] }]));
export const SCENARIOS_BEST = picks(BEST, WORST);
/** Picks that score zero on every situation: the best answer chosen as worst and the other way round. */
export const SCENARIOS_POOR = picks(WORST, BEST);

export const ALL_YES = Object.fromEntries(ELIG_KEYS.map((k) => [k, true])) as Record<EligKey, boolean>;

export function calling(overrides: Record<string, unknown> = {}) {
  return {
    track: "builders",
    community: "professionals",
    goal: "step-into-a-leadership-role",
    goalRelation: "pursuing",
    goalStory: "I have been stepping into leadership at work this year and I am still learning how.",
    why: "I want to help other people grow into what God has put in them, not to be seen.",
    walked: "I walked with a friend through a job loss. I listened a lot and did not give advice.",
    walkRating: 4,
    walkNote: "Steady, though I get tired in busy seasons and pray less than I want to.",
    obstacles: "Work travel in the second half of the season could get in the way.",
    ...overrides,
  };
}

/** Everything the form saves, with the eligibility answers given. */
export function answers(eligibility: Record<string, unknown> | undefined = ALL_YES, overrides: Record<string, unknown> = {}) {
  return {
    ...(eligibility ? { eligibility } : {}),
    calling: calling(),
    scenarios: SCENARIOS_BEST,
    style: { styleSocial: 1, styleStructure: -1, leadBest: "connection" },
    contact: { whatsapp: "+2348031234567" },
    ...overrides,
  };
}

const COLUMN: Record<string, string> = {
  references: "references_mode",
  interview: "interview_mode",
  academy: "academy_mode",
  declaration: "declaration_mode",
};

/** Puts the switches where the test says; anything not named goes back to today's position. */
export async function setPositions(db: TestDb, p: Positions = {}) {
  const sets: string[] = [];
  for (const k of ELIG_KEYS) sets.push(`elig_${k} = '${p.eligibility?.[k] ?? "required"}'`);
  for (const key of ["references", "interview", "academy", "declaration"] as const) {
    sets.push(`${COLUMN[key]} = '${p[key] ?? "required"}'`);
  }
  sets.push("tribe_fit = 'off'", "preset = 'empty'");
  await db.admin.query(`update public.leader_pipeline_settings set ${sets.join(", ")}`);
}

export const OPEN_DOOR: Positions = {
  eligibility: { member6: "off", foundation: "off", serving: "off" },
  references: "off",
  interview: "off",
};
export const ALL_OFF: Positions = {
  eligibility: Object.fromEntries(ELIG_KEYS.map((k) => [k, "off"])) as Record<EligKey, Pos>,
  references: "off",
  interview: "off",
};

export const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
export const scoreOf = (n: number, count: number) => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i + 1}`, n])));

export function pipelineKit(db: TestDb) {
  let seq = 0;

  async function person(role?: string, name?: string) {
    const user = await db.createUser();
    if (name) await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [user.id, `${name} Test`, name]);
    if (role) await db.grant(user.id, role);
    return user;
  }

  /** The applicant starts a draft with the answers given (the form saves them as it goes). */
  async function startDraft(userId: string, ans: Record<string, unknown> = answers(), step = "welcome") {
    const { rows } = await db.asUser(userId, (q) =>
      q(
        `insert into public.leader_applications (person_id, step, answers, consent_version)
         values ($1, $2, $3::jsonb, '2026-10-v1') returning id`,
        [userId, step, JSON.stringify(ans)],
      ),
    );
    return rows[0].id as string;
  }

  /** A referee nobody else uses, as the applicant would add them. */
  const setReferee = (userId: string, appId: string, slot: number, head: boolean, name = `Referee ${slot}`) =>
    db.asUser(userId, (q) =>
      q("select public.set_referee($1, $2, $3, 'Unit head', $4, $5) as id", [appId, slot, name, uniqueEmail(`referee${slot}`), head]),
    );

  const send = (userId: string, appId: string) => db.asUser(userId, (q) => q("select public.submit_leader_application($1) as r", [appId]));

  /** A referee goes through the whole of it. One the applicant said is a pastor or unit head is on the church's list. */
  async function answerReference(appId: string, slot: number, rating = 5, concern: string | null = null) {
    const row = (await db.admin.query("select id, contact, is_pastor_or_unit_head as head from public.leader_references where application_id = $1 and slot = $2", [appId, slot])).rows[0];
    if (row.head) await listInDirectory(db, row.contact, { name: "Pastor Ife", standing: "pastor" });
    await answerAs(db, row.id as string, { rating, concern });
    return row.id as string;
  }

  const review = (reviewer: string, appId: string, stage: "calling" | "interview", n: number, notes = "") =>
    db.asUser(reviewer, (q) => q("select public.save_review($1, $2, $3::jsonb, $4)", [appId, stage, scoreOf(n, stage === "calling" ? 6 : 5), notes]));

  const readiness = async (appId: string) => (await db.admin.query("select public.application_readiness($1) as r", [appId])).rows[0].r as Row;
  const modes = async (appId: string) => (await db.admin.query("select public.leader_stage_modes($1) as r", [appId])).rows[0].r as Row;
  const appRow = async (appId: string) => (await db.admin.query("select * from public.leader_applications where id = $1", [appId])).rows[0] as Row;
  const hasRole = async (userId: string, role: string) =>
    (await db.admin.query("select 1 from public.person_roles where person_id = $1 and role = $2", [userId, role])).rows.length > 0;
  const slotRow = async (slotId: string) => (await db.admin.query("select * from public.interview_slots where id = $1", [slotId])).rows[0] as Row;

  /** The staff the panel needs: two scorers, someone who invites, and a pastor who decides. */
  async function panel() {
    return { coach: await person("coach", "Coach"), scorer: await person("pastor", "Scorer"), director: await person("director", "Director"), pastor: await person("pastor", "Pastor") };
  }

  /**
   * One whole application, run as the form, the panel and the pastor would, under the positions in force. It asks only what is asked, adds
   * the minimum referees and skips an optional interview unless told otherwise, and ends with the decision. Returns what happened.
   */
  async function walk(
    positions: Positions,
    o: { staff?: Awaited<ReturnType<typeof panel>>; optionalReferees?: number; holdOptionalInterview?: boolean; decision?: "leader" | "assistant_leader"; yesOnOptional?: boolean } = {},
  ) {
    await setPositions(db, positions);
    const staff = o.staff ?? (await panel());
    const user = await person(undefined, `Applicant${++seq}`);
    const elig: Record<string, boolean> = {};
    for (const k of ELIG_KEYS) {
      const pos = positions.eligibility?.[k] ?? "required";
      if (pos === "required") elig[k] = true;
      else if (pos === "optional") elig[k] = o.yesOnOptional ?? false; // an optional "no" must not stop anyone
      // off: not asked, so not in the answers at all
    }
    const appId = await startDraft(user.id, answers(Object.keys(elig).length ? elig : undefined));
    const anyRequired = ELIG_KEYS.some((k) => (positions.eligibility?.[k] ?? "required") === "required");
    let eligibility: Row | null = null;
    if (anyRequired) eligibility = (await db.asUser(user.id, (q) => q("select public.check_leader_eligibility($1) as r", [appId]))).rows[0].r;

    const refMode = positions.references ?? "required";
    const intMode = positions.interview ?? "required";
    const wantRefs = refMode === "required" ? 2 : refMode === "optional" ? (o.optionalReferees ?? 0) : 0;
    for (let slot = 1; slot <= wantRefs; slot++) await setReferee(user.id, appId, slot, slot === 1 && refMode === "required");
    await send(user.id, appId);
    for (let slot = 1; slot <= wantRefs; slot++) await answerReference(appId, slot, 5);

    await review(staff.coach.id, appId, "calling", 5);
    await review(staff.scorer.id, appId, "calling", 5);

    let slotId: string | null = null;
    const hold = intMode === "required" || (intMode === "optional" && (o.holdOptionalInterview ?? false));
    if (hold) {
      await db.asUser(staff.director.id, (q) => q("select public.invite_to_interview($1)", [appId]));
      slotId = (await db.asUser(staff.director.id, (q) => q("select public.add_interview_slot($1, 20, 'online', 'https://meet.example.org/x', 'Two panelists') as id", [inDays(5)]))).rows[0].id as string;
      await db.asUser(user.id, (q) => q("select public.book_interview_slot($1)", [slotId]));
      await review(staff.coach.id, appId, "interview", 5);
      await review(staff.scorer.id, appId, "interview", 5);
    }

    const ready = await readiness(appId);
    const decision = o.decision ?? "leader";
    const decided = (await db.asUser(staff.pastor.id, (q) => q("select public.decide_application($1, $2, null) as r", [appId, decision]))).rows[0].r as Row;
    return { user, appId, staff, eligibility, ready, decided, slotId, role: await hasRole(user.id, decision) };
  }

  return { person, startDraft, setReferee, send, answerReference, review, readiness, modes, appRow, hasRole, slotRow, panel, walk };
}

export type PipelineKit = ReturnType<typeof pipelineKit>;
