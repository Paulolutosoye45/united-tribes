import { judgeJson } from "@/lib/ai/judge";
import type { AiProvider } from "@/lib/ai/types";
import type { WorkerRpc } from "@/lib/messaging/worker";
import { FIELD_INFO, WRITTEN_FIELDS, isWrittenField, type Flag, type WrittenField } from "./fields";
import { flagsFromReasons, instantChecks, type InstantReason } from "./instant";
import { printOf } from "./print";
import { RELEVANCE_SCHEMA, RELEVANCE_SYSTEM, SCORE_SCHEMA, SCORE_SYSTEM, relevancePrompt, relevanceResult, scorePrompt, scoreResult } from "./prompts";
import { verifyEvidence } from "./quotes";

/** One application waiting for its first reading, as the database hands it over. */
export type PendingJob = {
  job: string;
  application: string;
  origin: "submit" | "rewrite" | "batch";
  shadow: boolean;
  attempts: number;
  ai_allowed: boolean;
  min_words: number;
  forced_fields: string[];
  rewrites_used: number;
  run: number;
  track: string | null;
  track_name: string | null;
  community_name: string | null;
  goal_title: string | null;
  goal_relation: string | null;
  walk_rating: string | null;
  answers: Partial<Record<WrittenField, string | null>>;
};

/** What the database stores. It decides what the numbers mean; this only reports them. */
export type ScoreSave = {
  ai_ran: boolean;
  scores: Record<string, number> | null;
  evidence: Record<string, { field: WrittenField; quote: string }[]>;
  reasons: Record<string, unknown>;
  feedback: Partial<Record<WrittenField, string>>;
  flags: Flag[];
  confidence: number | null;
  provider: string;
  model: string;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
};

export const readJob = (value: unknown): PendingJob | null => {
  if (!value || typeof value !== "object") return null;
  const j = value as Record<string, unknown>;
  if (typeof j.job !== "string" || typeof j.application !== "string") return null;
  const answers = (j.answers && typeof j.answers === "object" ? j.answers : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : null);
  return {
    job: j.job,
    application: j.application,
    origin: j.origin === "rewrite" || j.origin === "batch" ? j.origin : "submit",
    shadow: j.shadow === true,
    attempts: typeof j.attempts === "number" ? j.attempts : 1,
    ai_allowed: j.ai_allowed === true,
    min_words: typeof j.min_words === "number" ? j.min_words : 8,
    forced_fields: Array.isArray(j.forced_fields) ? j.forced_fields.filter(isWrittenField) : [],
    rewrites_used: typeof j.rewrites_used === "number" ? j.rewrites_used : 0,
    run: typeof j.run === "number" ? j.run : 1,
    track: s(j.track),
    track_name: s(j.track_name),
    community_name: s(j.community_name),
    goal_title: s(j.goal_title),
    goal_relation: s(j.goal_relation),
    walk_rating: s(j.walk_rating),
    answers: Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, s(answers[f])])),
  };
};

// ---------------------------------------------------------------------------------------------- notes the applicant sees

/** A note may never mention how the answer was read. If it does, it is replaced by a plain one. */
const LEAKS = /\b(scor\w*|flag\w*|\bAI\b|artificial|computer|algorithm|automat\w*|model|rubric|checker|machine|bot)\b/i;

export function kindNote(field: WrittenField, note: string | undefined | null): string {
  const clean = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (clean.length >= 10 && !LEAKS.test(clean)) return clean;
  return `Tell us a little more here. ${FIELD_INFO[field].hint}`;
}

// ---------------------------------------------------------------------------------------------- the first reading

type Deps = { rpc: WorkerRpc; provider: AiProvider | null; timeoutMs?: number };

/**
 * Reads one application: the instant checks, the fingerprints, and (unless the answers are plainly not real, or the
 * applicant has not agreed to it) the AI's scores with quoted proof. Throws when something that should work did not,
 * so the job is tried again later. An answer the AI cannot be reached for is never passed on that account.
 */
export async function readApplication(job: PendingJob, deps: Deps): Promise<ScoreSave> {
  const answers = Object.fromEntries(WRITTEN_FIELDS.map((f) => [f, job.answers[f] ?? ""])) as Record<WrittenField, string>;
  const flags = new Set<Flag>();
  const feedback: Partial<Record<WrittenField, string>> = {};
  const reasons: Record<string, unknown> = {};

  // 1. Instant checks, answer by answer
  const failing: Partial<Record<WrittenField, InstantReason[]>> = {};
  for (const f of WRITTEN_FIELDS) {
    const result = instantChecks(answers[f], f, { minWords: job.min_words });
    if (!result.ok) {
      failing[f] = result.reasons;
      for (const flag of flagsFromReasons(result.reasons)) flags.add(flag);
      if (result.note) feedback[f] = result.note;
    }
  }
  if (job.forced_fields.length > 0) flags.add("forced_through");

  // 2. Fingerprints: the same words twice here, or in someone else's application
  const others = new Set<string>();
  for (const f of WRITTEN_FIELDS) {
    if (!answers[f].trim()) continue;
    const p = printOf(answers[f]);
    const res = await deps.rpc("worker_leader_print", { p_app: job.application, p_field: f, p_norm_hash: p.normHash, p_simhash: p.simhash, p_words: p.words });
    if (res.error) throw new Error(`print: ${res.error.message}`);
    const found = res.data as { same_in_own?: string[]; other_apps?: string[] } | null;
    if ((found?.same_in_own ?? []).length > 0) flags.add("same_in_two_answers");
    for (const id of found?.other_apps ?? []) others.add(id);
  }
  if (others.size > 0) {
    flags.add("duplicate_of_other");
    reasons.duplicate_of = [...others].slice(0, 5);
  }

  // 3. Plainly not real, or the applicant has not agreed to an AI service reading it: no AI call
  const noAi = flags.has("gibberish") || flags.has("instruction_attempt") || !job.ai_allowed;
  if (noAi) {
    return {
      ai_ran: false,
      scores: null,
      evidence: {},
      reasons,
      feedback,
      flags: [...flags],
      confidence: null,
      provider: deps.provider?.name ?? "none",
      model: deps.provider?.model ?? "none",
      latency_ms: 0,
    };
  }

  // 4. The AI's scores, with proof
  const facts = {
    track: job.track_name ?? job.track,
    community: job.community_name,
    goal: job.goal_title,
    goalRelation: job.goal_relation,
    walkRating: job.walk_rating,
    answers,
  };
  const judged = await judgeJson(
    {
      system: SCORE_SYSTEM,
      user: scorePrompt(facts),
      schema: SCORE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "first_reading",
      maxTokens: 1400,
      mock: { kind: "score", data: facts },
    },
    scoreResult,
    { provider: deps.provider, timeoutMs: deps.timeoutMs },
  );
  if (!judged.ok) throw new Error(`ai: ${judged.reason}`);
  const m = judged.data;

  const proof = verifyEvidence(m.evidence, answers, m.scores);
  if (proof.ungrounded.length > 0) flags.add("unverified_evidence");
  for (const flag of m.flags) flags.add(flag);
  for (const item of m.feedback) feedback[item.field] ??= kindNote(item.field, item.note);
  for (const f of WRITTEN_FIELDS) if (feedback[f]) feedback[f] = kindNote(f, feedback[f]);
  if (proof.dropped > 0) reasons.dropped_quotes = proof.dropped;

  return {
    ai_ran: true,
    scores: m.scores,
    evidence: proof.evidence,
    reasons: { ...m.reasons, ...reasons },
    feedback,
    flags: [...flags],
    confidence: m.confidence,
    provider: judged.provider,
    model: judged.model,
    latency_ms: judged.latencyMs,
    input_tokens: judged.usage?.inputTokens,
    output_tokens: judged.usage?.outputTokens,
  };
}

// ---------------------------------------------------------------------------------------------- the quick check

export type CheckOutcome =
  | { kind: "result"; passes: boolean; forced: boolean; triesLeft: number; note: string | null }
  | { kind: "skip" }
  | { kind: "consent" }
  | { kind: "limited" }
  | { kind: "error"; message: string };

/**
 * The quick check on one saved answer: the instant checks, then (if those pass) one question to the AI, "does this
 * answer the question that was asked?". It is generous on purpose. An AI that cannot be reached means the answer
 * counts as checked by the instant checks alone: the applicant is never stuck because of an outage, and the full
 * reading after sending still happens.
 */
export async function checkAnswer(deps: Deps, input: { application: string; field: WrittenField; text: string }): Promise<CheckOutcome> {
  const state = await deps.rpc("worker_leader_check_state", { p_app: input.application, p_field: input.field, p_text: input.text });
  if (state.error) return { kind: "error", message: state.error.message };
  const s = state.data as {
    ok?: boolean;
    reason?: string;
    min_words?: number;
    rate_limited?: boolean;
    cached?: { passes: boolean; forced: boolean; note: string | null; tries_left: number } | null;
  } | null;
  if (!s?.ok) {
    if (s?.reason === "off") return { kind: "skip" };
    if (s?.reason === "consent") return { kind: "consent" };
    return { kind: "error", message: "This application is not open for changes." };
  }
  if (s.cached) return { kind: "result", passes: s.cached.passes, forced: s.cached.forced, triesLeft: s.cached.tries_left, note: s.cached.note };
  if (s.rate_limited) return { kind: "limited" };

  const instant = instantChecks(input.text, input.field, { minWords: s.min_words ?? 8 });
  let relevance: "pass" | "fail" | "skipped" = "skipped";
  let note = instant.note;
  let aiChecked = false;
  let provider = "none";
  let model = "none";
  let latency = 0;
  if (instant.ok) {
    const judged = await judgeJson(
      {
        system: RELEVANCE_SYSTEM,
        user: relevancePrompt(input.field, input.text),
        schema: RELEVANCE_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "answer_check",
        maxTokens: 200,
        mock: { kind: "relevance", data: { field: input.field, text: input.text } },
      },
      relevanceResult,
      { provider: deps.provider, timeoutMs: deps.timeoutMs },
    );
    provider = judged.provider;
    model = judged.model;
    latency = judged.latencyMs;
    if (judged.ok) {
      aiChecked = true;
      relevance = judged.data.answers_question ? "pass" : "fail";
      if (relevance === "fail") note = kindNote(input.field, judged.data.note);
    }
  }

  const saved = await deps.rpc("worker_record_answer_check", {
    p_app: input.application,
    p_field: input.field,
    p_text: input.text,
    p_instant_ok: instant.ok,
    p_reasons: instant.reasons,
    p_relevance: relevance,
    p_note: note,
    p_ai_checked: aiChecked,
    p_provider: provider,
    p_model: model,
    p_latency: latency,
  });
  if (saved.error) return { kind: "error", message: saved.error.message };
  const r = saved.data as { passes?: boolean; forced?: boolean; tries_left?: number; note?: string | null } | null;
  return { kind: "result", passes: r?.passes === true, forced: r?.forced === true, triesLeft: r?.tries_left ?? 0, note: r?.note ?? note };
}
