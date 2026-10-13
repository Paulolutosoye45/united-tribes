/**
 * The comparison for the first check on leader applications: a labelled set of applications, run through the same
 * reading the heartbeat does (plain checks, fingerprints, the AI's scores with quoted proof), then through the same
 * rule that decides what happens next. No database is involved, so it can run before anything is switched on.
 */
import gold from "./leader-gold.json";
import type { AiProvider } from "../../src/lib/ai/types";
import { decide, DEFAULT_THRESHOLDS, type Outcome, type Thresholds } from "../../src/lib/leaders/quality/decide";
import { WRITTEN_FIELDS, type Flag, type WrittenField } from "../../src/lib/leaders/quality/fields";
import { readApplication, type PendingJob } from "../../src/lib/leaders/quality/scorer";
import { hamming } from "../../src/lib/leaders/quality/text";
import type { WorkerRpc } from "../../src/lib/messaging/worker";

export type GoldCase = {
  id: string;
  label: string;
  /** Outcomes a pastor would accept for this application. */
  expect: Outcome[];
  /** Must never pass the first check, whatever the model thinks. */
  mustNotClear?: boolean;
  /** Caught by the plain checks and fingerprints, so any model (or none) gets it right. */
  deterministic?: boolean;
  copiesFrom?: string;
  note?: string;
  context: { track: string; community: string; goal: string; goalRelation: string; walkRating: string };
  answers: Record<WrittenField, string>;
};

export const GOLD = (gold as { cases: GoldCase[] }).cases;

/** The database's fingerprint check, kept in memory: the same rule as worker_leader_print. */
export function memoryPrints(): WorkerRpc {
  const store: { app: string; field: string; norm: string; sim: string; words: number }[] = [];
  return async (fn, args = {}) => {
    if (fn !== "worker_leader_print") return { data: null, error: { message: `unexpected call ${fn}` } };
    const app = String(args.p_app);
    const field = String(args.p_field);
    const norm = String(args.p_norm_hash);
    const sim = String(args.p_simhash);
    const words = Number(args.p_words);
    const row = { app, field, norm, sim, words };
    const at = store.findIndex((o) => o.app === app && o.field === field);
    if (at >= 0) store[at] = row;
    else store.push(row);
    const sameInOwn = [...new Set(store.filter((o) => o.app === app && o.field !== field && o.norm === norm && words >= 8).map((o) => o.field))];
    const others = [
      ...new Set(
        store
          .filter((o) => o.app !== app && words >= 12 && o.words >= 12 && (o.norm === norm || hamming(o.sim, sim) <= 12))
          .map((o) => o.app),
      ),
    ].slice(0, 5);
    return { data: { same_in_own: sameInOwn, other_apps: others }, error: null };
  };
}

export type CaseRun = {
  outcome: Outcome;
  flags: Flag[];
  scores: Record<string, number> | null;
  confidence: number | null;
  aiRan: boolean;
  failed: boolean;
  latencyMs: number;
  quotesKept: number;
  quotesDropped: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type CaseResult = {
  id: string;
  label: string;
  expect: Outcome[];
  deterministic: boolean;
  mustNotClear: boolean;
  runs: CaseRun[];
  /** The outcome most runs gave. */
  outcome: Outcome;
  /** Every run gave the same outcome. */
  stable: boolean;
  acceptable: boolean;
  /** Cleared when it must not be. */
  falseClear: boolean;
};

function job(c: GoldCase): PendingJob {
  return {
    job: `job-${c.id}`,
    application: c.id,
    origin: "submit",
    shadow: false,
    attempts: 1,
    ai_allowed: true,
    min_words: 8,
    forced_fields: [],
    rewrites_used: 0,
    run: 1,
    track: c.context.track.toLowerCase(),
    track_name: c.context.track,
    community_name: c.context.community,
    goal_title: c.context.goal,
    goal_relation: c.context.goalRelation,
    walk_rating: c.context.walkRating,
    answers: c.answers,
  };
}

export async function runGold(
  provider: AiProvider,
  opts: { runs?: number; thresholds?: Thresholds; timeoutMs?: number; cases?: GoldCase[]; concurrency?: number } = {},
): Promise<CaseResult[]> {
  const cases = opts.cases ?? GOLD;
  const runsEach = Math.max(1, opts.runs ?? 1);
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const collected = new Map<string, CaseRun[]>();

  for (let r = 0; r < runsEach; r++) {
    // A fresh set of fingerprints for each pass, in file order, so a copy is always found after its source.
    const rpc = memoryPrints();
    for (const c of cases) {
      const started = Date.now();
      let run: CaseRun;
      try {
        const saved = await readApplication(job(c), { rpc, provider, timeoutMs: opts.timeoutMs ?? 20_000 });
        const kept = Object.values(saved.evidence).reduce((n, list) => n + list.length, 0);
        const dropped = typeof saved.reasons.dropped_quotes === "number" ? saved.reasons.dropped_quotes : 0;
        run = {
          outcome: decide(saved.scores, saved.flags, saved.confidence, 0, "submit", thresholds),
          flags: saved.flags,
          scores: saved.scores,
          confidence: saved.confidence,
          aiRan: saved.ai_ran,
          failed: false,
          latencyMs: saved.ai_ran ? saved.latency_ms : Date.now() - started,
          quotesKept: kept,
          quotesDropped: dropped,
          inputTokens: saved.input_tokens,
          outputTokens: saved.output_tokens,
        };
      } catch {
        // An AI that cannot be reached never passes anyone: the real job is tried again later and, after ten failures, held.
        run = { outcome: "unscored", flags: [], scores: null, confidence: null, aiRan: false, failed: true, latencyMs: Date.now() - started, quotesKept: 0, quotesDropped: 0 };
      }
      collected.set(c.id, [...(collected.get(c.id) ?? []), run]);
    }
  }

  return cases.map((c) => {
    const runs = collected.get(c.id) ?? [];
    const tally = new Map<Outcome, number>();
    for (const run of runs) tally.set(run.outcome, (tally.get(run.outcome) ?? 0) + 1);
    const outcome = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unscored";
    return {
      id: c.id,
      label: c.label,
      expect: c.expect,
      deterministic: c.deterministic === true,
      mustNotClear: c.mustNotClear === true,
      runs,
      outcome,
      stable: tally.size <= 1,
      acceptable: c.expect.includes(outcome),
      falseClear: c.mustNotClear === true && runs.some((run) => run.outcome === "clear"),
    };
  });
}

export type GoldSummary = {
  cases: number;
  falseClears: number;
  strongTotal: number;
  strongCleared: number;
  agreement: number;
  deterministicRight: number;
  deterministicTotal: number;
  quotesKept: number;
  quotesDropped: number;
  failureRate: number;
  p50: number | null;
  p95: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  unstable: number;
};

const pct = (values: number[], p: number) => (values.length === 0 ? null : [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]);

export function summarise(results: CaseResult[]): GoldSummary {
  const runs = results.flatMap((r) => r.runs);
  const strong = results.filter((r) => r.expect.length === 1 && r.expect[0] === "clear");
  const det = results.filter((r) => r.deterministic);
  const ai = runs.filter((r) => r.aiRan);
  const tokensIn = ai.map((r) => r.inputTokens).filter((n): n is number => typeof n === "number");
  const tokensOut = ai.map((r) => r.outputTokens).filter((n): n is number => typeof n === "number");
  const average = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    cases: results.length,
    falseClears: results.filter((r) => r.falseClear).length,
    strongTotal: strong.length,
    strongCleared: strong.filter((r) => r.outcome === "clear").length,
    agreement: results.length === 0 ? 0 : results.filter((r) => r.acceptable).length / results.length,
    deterministicRight: det.filter((r) => r.acceptable).length,
    deterministicTotal: det.length,
    quotesKept: runs.reduce((n, r) => n + r.quotesKept, 0),
    quotesDropped: runs.reduce((n, r) => n + r.quotesDropped, 0),
    failureRate: runs.length === 0 ? 0 : runs.filter((r) => r.failed).length / runs.length,
    p50: pct(ai.map((r) => r.latencyMs), 0.5),
    p95: pct(ai.map((r) => r.latencyMs), 0.95),
    avgInputTokens: average(tokensIn),
    avgOutputTokens: average(tokensOut),
    unstable: results.filter((r) => !r.stable).length,
  };
}

/** Starting bars to agree before switching on. Change them in one place. */
export const LEADER_BARS = {
  falseClears: 0,
  strongCleared: 0.8,
  agreement: 0.85,
  quotesGrounded: 0.95,
  failureRate: 0.02,
  p95: 20_000,
} as const;

export function checkLeaderBars(s: GoldSummary): { name: string; value: string; bar: string; pass: boolean; why: string }[] {
  const grounded = s.quotesKept + s.quotesDropped === 0 ? 1 : s.quotesKept / (s.quotesKept + s.quotesDropped);
  const strongShare = s.strongTotal === 0 ? 1 : s.strongCleared / s.strongTotal;
  return [
    {
      name: "Cleared when it must not be",
      value: String(s.falseClears),
      bar: "0",
      pass: s.falseClears <= LEADER_BARS.falseClears,
      why: "Gibberish, instructions, pasted questions, copied answers, thin or off-topic applications. Any one is a failure.",
    },
    {
      name: "Good applications cleared",
      value: `${s.strongCleared} of ${s.strongTotal}`,
      bar: `${Math.round(LEADER_BARS.strongCleared * 100)}%`,
      pass: strongShare >= LEADER_BARS.strongCleared,
      why: "Pidgin, Yoruba, brief and honest-but-struggling applications must clear. This is the fairness bar.",
    },
    {
      name: "Outcome a pastor would accept",
      value: `${Math.round(s.agreement * 100)}%`,
      bar: `${Math.round(LEADER_BARS.agreement * 100)}%`,
      pass: s.agreement >= LEADER_BARS.agreement,
      why: "Across all labelled applications.",
    },
    {
      name: "Quotes really in the answer",
      value: `${Math.round(grounded * 100)}%`,
      bar: `${Math.round(LEADER_BARS.quotesGrounded * 100)}%`,
      pass: grounded >= LEADER_BARS.quotesGrounded,
      why: "A made-up quote is dropped and the application is held. A model that does this often is not ready.",
    },
    {
      name: "Readings that failed",
      value: `${Math.round(s.failureRate * 1000) / 10}%`,
      bar: `${LEADER_BARS.failureRate * 100}%`,
      pass: s.failureRate <= LEADER_BARS.failureRate,
      why: "Timeouts, bad replies and missing keys. Nobody passes on account of a failure, but people wait.",
    },
    {
      name: "Slowest readings (95th percentile)",
      value: s.p95 === null ? "–" : `${Math.round(s.p95)} ms`,
      bar: `${LEADER_BARS.p95} ms`,
      pass: s.p95 === null || s.p95 <= LEADER_BARS.p95,
      why: "One reading has to finish inside the heartbeat's time.",
    },
  ];
}

export const label = (o: Outcome) => (o === "clear" ? "clear" : o === "strengthen" ? "ask for more" : o === "held" ? "hold for a person" : "no score");
export const FIELDS = WRITTEN_FIELDS;
