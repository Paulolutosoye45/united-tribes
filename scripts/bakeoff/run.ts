/**
 * Claude-versus-ChatGPT comparison for the intake assistant.
 *
 *   npm run bakeoff -- --providers anthropic,openai --runs 3
 *   npm run bakeoff -- --providers mock            (dry run, no keys needed)
 *
 * Keys and models come from the environment or .env.local:
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL, OPENAI_API_KEY, OPENAI_MODEL
 *
 * It runs the same synthetic stories through each provider, scores the
 * machine-checkable parts, and writes a blind review sheet so two people from
 * the team can rate how natural and "gets me" the suggestions feel without
 * knowing which model wrote them.
 */
import fs from "node:fs";
import path from "node:path";
import { anthropicProvider } from "../../src/lib/ai/providers/anthropic";
import { mockProvider } from "../../src/lib/ai/providers/mock";
import { openaiProvider } from "../../src/lib/ai/providers/openai";
import { suggestOptions } from "../../src/lib/ai/suggest";
import type { AiProvider } from "../../src/lib/ai/types";
import { checkBars, scoreProvider, type ProviderScore, type Run, type Story } from "./score";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function buildProviders(names: string[]): AiProvider[] {
  return names.map((name) => {
    if (name === "mock") return mockProvider();
    if (name === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      return anthropicProvider(key, process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5");
    }
    if (name === "openai") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set");
      return openaiProvider(key, process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
    }
    throw new Error(`Unknown provider "${name}". Use anthropic, openai or mock.`);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  loadEnvFile(path.resolve(".env"));

  const names = (arg("providers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) {
    console.error("Say which providers to compare, for example:\n  npm run bakeoff -- --providers anthropic,openai\n  npm run bakeoff -- --providers mock");
    process.exit(1);
  }
  const runsPer = Number(arg("runs", "1"));
  const timeoutMs = Number(arg("timeout", "10000"));
  const concurrency = Number(arg("concurrency", "4"));
  const outDir = path.resolve(arg("out", "bakeoff-results")!);

  const stories: Story[] = JSON.parse(fs.readFileSync(path.join(__dirname, "stories.json"), "utf8"));
  const providers = buildProviders(names);

  const results = new Map<string, Run[]>();
  const details = new Map<string, Map<string, { label: string; reason: string }[]>>();

  for (const provider of providers) {
    process.stdout.write(`Running ${provider.name} (${provider.model}) on ${stories.length} stories × ${runsPer}… `);
    const jobs = stories.flatMap((story) => Array.from({ length: runsPer }, () => story));
    const runs = await mapLimit(jobs, concurrency, async (story) => {
      const res = await suggestOptions(
        { field: story.field, question: story.question, options: story.options, story: story.story, max: 3 },
        { provider, timeoutMs },
      );
      const labelOf = new Map(story.options.map((o) => [o.id, o.label]));
      const d = details.get(provider.name) ?? new Map();
      if (!d.has(story.id)) {
        d.set(story.id, res.suggestions.map((s) => ({ label: labelOf.get(s.id) ?? s.id, reason: s.reason })));
      }
      details.set(provider.name, d);
      const run: Run = {
        storyId: story.id,
        provider: provider.name,
        model: provider.model,
        picks: res.suggestions.map((s) => s.id),
        reasons: res.suggestions.map((s) => s.reason),
        fallback: res.fallback,
        failureReason: res.reason,
        dropped: res.dropped,
        latencyMs: res.latencyMs,
        inputTokens: res.usage?.inputTokens,
        outputTokens: res.usage?.outputTokens,
      };
      return run;
    });
    results.set(provider.name, runs);
    console.log("done");
  }

  const scores: ProviderScore[] = providers.map((p) => scoreProvider(stories, results.get(p.name)!));

  console.log("");
  for (const score of scores) {
    console.log(`${score.provider} (${score.model}), ${score.runs} runs`);
    for (const r of checkBars(score)) {
      console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(30)} ${r.value.padStart(8)}   bar ${r.bar}`);
    }
    if (score.avgInputTokens !== null) {
      console.log(`  Tokens per call: ${Math.round(score.avgInputTokens)} in, ${Math.round(score.avgOutputTokens ?? 0)} out`);
    }
    console.log("");
  }

  // Blind review sheet: each story shows the providers as "A" and "B" in a random order.
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key: Record<string, Record<string, string>> = {};
  const rows: string[] = [
    ["story_id", "question", "member_wrote", "system", "suggestions", "natural_1to5", "grounded_1to5", "gets_me_1to5", "comment"].map(csv).join(","),
  ];
  for (const story of stories) {
    const order = [...providers].sort(() => Math.random() - 0.5);
    key[story.id] = {};
    order.forEach((p, i) => {
      const label = String.fromCharCode(65 + i);
      key[story.id][label] = p.name;
      const picks = details.get(p.name)?.get(story.id) ?? [];
      const text = picks.length ? picks.map((s) => `${s.label} (${s.reason})`).join(" | ") : "(nothing suggested)";
      rows.push([story.id, story.question, story.story, label, text, "", "", "", ""].map(csv).join(","));
    });
  }
  const resultsFile = path.join(outDir, `results-${stamp}.json`);
  const reviewFile = path.join(outDir, `review-${stamp}.csv`);
  fs.writeFileSync(resultsFile, JSON.stringify({ at: stamp, scores, runs: Object.fromEntries(results), blindKey: key }, null, 2));
  fs.writeFileSync(reviewFile, rows.join("\n"));
  console.log(`Results:      ${resultsFile}\nReview sheet: ${reviewFile}  (give this to two reviewers; keep the results file closed until they finish)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
