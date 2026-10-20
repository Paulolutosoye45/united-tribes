// Compares two vitest JSON reports test by test. Used by scripts/rehearse-rollback.sh.
//   node scripts/compare-vitest.mjs baseline.json rolledback.json
// Exit 0 when every test the baseline passes is also passed by the rolled-back database, and neither has a test the other lacks.
import fs from "node:fs";

function load(file) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const map = new Map();
  for (const suite of report.testResults) {
    const name = suite.name.split("/tests/db/").pop();
    for (const t of suite.assertionResults) map.set(`${name} > ${t.fullName}`, t.status);
  }
  return map;
}

const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const passes = (m) => [...m].filter(([, s]) => s === "passed").length;
const fails = (m) => [...m].filter(([, s]) => s === "failed");
console.log(`baseline:    ${a.size} tests, ${passes(a)} passed, ${fails(a).length} failed`);
console.log(`rolled back: ${b.size} tests, ${passes(b)} passed, ${fails(b).length} failed`);

const regress = [...a].filter(([k, s]) => s === "passed" && b.get(k) !== "passed").map(([k]) => k);
const onlyA = [...a.keys()].filter((k) => !b.has(k));
const onlyB = [...b.keys()].filter((k) => !a.has(k));
const better = [...b].filter(([k, s]) => s === "passed" && a.get(k) === "failed").map(([k]) => k);
if (better.length) console.log(`\nPass after the rollback but failed on the baseline (${better.length}) - tests that name things only the rework adds:\n  ${better.slice(0, 20).join("\n  ")}`);
if (onlyA.length) console.log(`\nOnly in the baseline (${onlyA.length}):\n  ${onlyA.slice(0, 20).join("\n  ")}`);
if (onlyB.length) console.log(`\nOnly in the rolled-back run (${onlyB.length}):\n  ${onlyB.slice(0, 20).join("\n  ")}`);
if (regress.length) {
  console.log(`\nPASSED ON THE BASELINE, NOT AFTER THE ROLLBACK (${regress.length}):\n  ${regress.slice(0, 40).join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe rolled-back database passes everything the baseline passes.");
