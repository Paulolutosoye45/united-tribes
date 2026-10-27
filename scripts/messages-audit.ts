/**
 * Writes docs/MESSAGES-AUDIT.md: every message the platform can send, written out from believable details and checked.
 *
 *   npm run messages-audit            write the file
 *   npm run messages-audit -- --check exit 1 if a check fails or the file on disk is out of date
 */
import fs from "node:fs";
import path from "node:path";
import { auditMarkdown, auditMessages } from "../src/lib/messaging/audit";
import { sampleParams } from "../tests/unit/fixtures/message-params";

const root = path.resolve(__dirname, "..");
const file = path.join(root, "docs/MESSAGES-AUDIT.md");
const audit = auditMessages(root, sampleParams);
const text = auditMarkdown(audit);
const failed = audit.rows.filter((r) => r.problems.length > 0).length + audit.queuedButMissing.length;
if (process.argv.includes("--check")) {
  const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
  console.log(failed === 0 && same ? "docs/MESSAGES-AUDIT.md is up to date and every check passes" : `${failed} to look at${same ? "" : "; the file is out of date: run npm run messages-audit"}`);
  process.exit(failed === 0 && same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`Wrote ${path.relative(process.cwd(), file)}: ${audit.rows.length} messages, ${failed} to look at`);
