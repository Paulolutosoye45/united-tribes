/**
 * Writes docs/PROFILE-READERS.md from src/lib/profile/registry.ts.
 *
 *   npm run readers            write the file
 *   npm run readers -- --check exit 1 if the file on disk is not what would be written
 */
import fs from "node:fs";
import path from "node:path";
import { readersMarkdown } from "../src/lib/profile/registry";

const file = path.resolve(__dirname, "../docs/PROFILE-READERS.md");
const text = readersMarkdown();
if (process.argv.includes("--check")) {
  const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
  console.log(same ? "docs/PROFILE-READERS.md is up to date" : "docs/PROFILE-READERS.md is out of date: run npm run readers");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
