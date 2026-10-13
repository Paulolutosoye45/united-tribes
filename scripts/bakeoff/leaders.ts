/**
 * Try a model on the labelled leader applications before the first check is switched on.
 *
 *   npm run bakeoff:leaders -- --providers anthropic,openai --runs 3
 *   npm run bakeoff:leaders -- --providers mock         (offline, no keys needed: checks the plumbing, not the model)
 *
 * Keys and models come from the environment or .env.local (ANTHROPIC_API_KEY, ANTHROPIC_MODEL, OPENAI_API_KEY, OPENAI_MODEL).
 * It prints, for each model, what it would have done with every application next to what a pastor would accept, the
 * numbers against the starting bars, and writes the same to a file. Two things matter most: nothing that must not
 * pass is passed, and the good applications (Pidgin, Yoruba, brief, honest) are not held up.
 */
import fs from "node:fs";
import path from "node:path";
import { anthropicProvider } from "../../src/lib/ai/providers/anthropic";
import { mockProvider } from "../../src/lib/ai/providers/mock";
import { openaiProvider } from "../../src/lib/ai/providers/openai";
import type { AiProvider } from "../../src/lib/ai/types";
import { DEFAULT_THRESHOLDS } from "../../src/lib/leaders/quality/decide";
import { FLAG_LABEL, type Flag } from "../../src/lib/leaders/quality/fields";
import { GOLD, LEADER_BARS, checkLeaderBars, label, runGold, summarise } from "./leaders-lib";

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

async function main() {
  loadEnvFile(path.resolve(".env.local"));
  loadEnvFile(path.resolve(".env"));

  const names = (arg("providers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) {
    console.error("Say which models to try, for example:\n  npm run bakeoff:leaders -- --providers anthropic,openai --runs 3\n  npm run bakeoff:leaders -- --providers mock");
    process.exit(1);
  }
  const runs = Number(arg("runs", "1"));
  const timeoutMs = Number(arg("timeout", "20000"));
  const outDir = path.resolve(arg("out", "bakeoff-results")!);
  const providers = buildProviders(names);

  console.log(`${GOLD.length} applications (${GOLD.length * 5} written answers), thresholds: pass at an average of ${DEFAULT_THRESHOLDS.clearMinScore}, no written answer under ${DEFAULT_THRESHOLDS.minQuestionScore}, confidence of at least ${DEFAULT_THRESHOLDS.minConfidence * 100}%\n`);
  const report: Record<string, unknown> = {};
  let anyFailed = false;

  for (const provider of providers) {
    process.stdout.write(`Running ${provider.name} (${provider.model}) × ${runs}… `);
    const results = await runGold(provider, { runs, timeoutMs });
    console.log("done\n");
    const summary = summarise(results);

    console.log(`${provider.name} (${provider.model})`);
    for (const r of results) {
      const mark = r.falseClear ? "WRONG " : r.acceptable ? "ok    " : "differs";
      const flags = [...new Set(r.runs.flatMap((x) => x.flags))].map((f) => FLAG_LABEL[f as Flag] ?? f);
      console.log(`  ${mark} ${r.id.padEnd(24)} ${label(r.outcome).padEnd(18)} accepted: ${r.expect.map(label).join(" or ")}${r.stable ? "" : "  (changes between runs)"}`);
      if (flags.length > 0) console.log(`           flags: ${flags.join("; ")}`);
    }
    console.log("");
    for (const bar of checkLeaderBars(summary)) {
      console.log(`  ${bar.pass ? "PASS" : "FAIL"}  ${bar.name.padEnd(36)} ${bar.value.padStart(10)}   bar ${bar.bar}`);
      if (!bar.pass) {
        console.log(`        ${bar.why}`);
        anyFailed = true;
      }
    }
    if (summary.avgInputTokens !== null) console.log(`  Tokens per reading: ${Math.round(summary.avgInputTokens)} in, ${Math.round(summary.avgOutputTokens ?? 0)} out`);
    if (summary.unstable > 0) console.log(`  ${summary.unstable} application(s) got different outcomes on different runs: a sign the thresholds sit too close to the model's own noise.`);
    if (provider.name === "mock") console.log("  This is the offline stand-in. It checks the plumbing and the plain checks. It says nothing about what a real model can do: try one with a key.");
    console.log("");
    report[provider.name] = { model: provider.model, summary, results };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `leaders-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ bars: LEADER_BARS, thresholds: DEFAULT_THRESHOLDS, report }, null, 2));
  console.log(`Results: ${file}`);
  if (anyFailed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
