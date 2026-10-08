/** Scoring for the Claude-versus-ChatGPT comparison. Pure functions, easy to test. */

export type Story = {
  id: string;
  field: string;
  question: string;
  options: { id: string; label: string }[];
  story: string;
  /** Ids that count as the right first suggestion. Empty when nothing should be suggested. */
  best: string[];
  /** Ids that are reasonable suggestions at all. */
  acceptable: string[];
  /** "none" means the right answer is to suggest nothing. */
  expect?: "none";
  note?: string;
};

export type Run = {
  storyId: string;
  provider: string;
  model: string;
  picks: string[];
  reasons: string[];
  fallback: boolean;
  failureReason?: string;
  dropped: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type ProviderScore = {
  provider: string;
  model: string;
  runs: number;
  top1: number | null;
  hitAt3: number | null;
  precision: number | null;
  restraint: number | null;
  invalidRate: number;
  failureRate: number;
  p50: number | null;
  p95: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
};

/** Starting bars to agree before launch. Adjust in one place. */
export const BARS = {
  top1: 0.8,
  hitAt3: 0.95,
  restraint: 0.75,
  invalidRate: 0.01,
  failureRate: 0.02,
  p95: 3000,
} as const;

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (hits: number, total: number) => (total === 0 ? null : hits / total);

export function scoreProvider(stories: Story[], runs: Run[]): ProviderScore {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const first = runs[0];

  let top1Hits = 0;
  let hit3Hits = 0;
  let judged = 0;
  let pickCount = 0;
  let pickGood = 0;
  let noneTotal = 0;
  let noneHits = 0;
  let droppedTotal = 0;
  let failed = 0;

  for (const run of runs) {
    const story = byId.get(run.storyId);
    if (!story) continue;
    droppedTotal += run.dropped;
    const didFail = run.fallback && (run.failureReason === "timeout" || run.failureReason === "error");
    if (didFail) {
      failed += 1;
      continue;
    }

    if (story.expect === "none") {
      noneTotal += 1;
      if (run.picks.length === 0) noneHits += 1;
      continue;
    }

    judged += 1;
    if (run.picks.length > 0 && story.best.includes(run.picks[0])) top1Hits += 1;
    if (run.picks.some((id) => story.acceptable.includes(id))) hit3Hits += 1;
    for (const id of run.picks) {
      pickCount += 1;
      if (story.acceptable.includes(id)) pickGood += 1;
    }
  }

  const ok = runs.filter((r) => !(r.fallback && (r.failureReason === "timeout" || r.failureReason === "error")));
  const latencies = ok.map((r) => r.latencyMs);
  const totalPicks = runs.reduce((n, r) => n + r.picks.length, 0);

  return {
    provider: first?.provider ?? "unknown",
    model: first?.model ?? "unknown",
    runs: runs.length,
    top1: ratio(top1Hits, judged),
    hitAt3: ratio(hit3Hits, judged),
    precision: ratio(pickGood, pickCount),
    restraint: ratio(noneHits, noneTotal),
    invalidRate: totalPicks + droppedTotal === 0 ? 0 : droppedTotal / (totalPicks + droppedTotal),
    failureRate: runs.length === 0 ? 0 : failed / runs.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    avgInputTokens: mean(runs.map((r) => r.inputTokens).filter((n): n is number => typeof n === "number")),
    avgOutputTokens: mean(runs.map((r) => r.outputTokens).filter((n): n is number => typeof n === "number")),
  };
}

export type BarResult = { name: string; value: string; bar: string; pass: boolean };

export function checkBars(score: ProviderScore): BarResult[] {
  const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(0)}%`);
  const ms = (n: number | null) => (n === null ? "n/a" : `${Math.round(n)} ms`);
  return [
    { name: "Right first suggestion", value: pct(score.top1), bar: `≥ ${BARS.top1 * 100}%`, pass: (score.top1 ?? 0) >= BARS.top1 },
    { name: "A right option in the list", value: pct(score.hitAt3), bar: `≥ ${BARS.hitAt3 * 100}%`, pass: (score.hitAt3 ?? 0) >= BARS.hitAt3 },
    { name: "Stays quiet when it should", value: pct(score.restraint), bar: `≥ ${BARS.restraint * 100}%`, pass: (score.restraint ?? 0) >= BARS.restraint },
    { name: "Invented options", value: pct(score.invalidRate), bar: `≤ ${BARS.invalidRate * 100}%`, pass: score.invalidRate <= BARS.invalidRate },
    { name: "Timeouts and errors", value: pct(score.failureRate), bar: `≤ ${BARS.failureRate * 100}%`, pass: score.failureRate <= BARS.failureRate },
    { name: "Slowest 1 in 20 replies", value: ms(score.p95), bar: `≤ ${BARS.p95} ms`, pass: score.p95 !== null && score.p95 <= BARS.p95 },
  ];
}
