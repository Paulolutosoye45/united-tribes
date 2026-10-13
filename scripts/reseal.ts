/**
 * Changing the key that seals members' private notes.
 *
 *   1. Make a new key:      openssl rand -base64 32
 *   2. Put it IN FRONT of the old one in DATA_ENCRYPTION_KEYS (app settings), and deploy:
 *                           DATA_ENCRYPTION_KEYS="k2:<new>,k1:<old>"
 *      New notes are sealed with k2 from now on; k1 still opens the old ones.
 *   3. See what would change (writes nothing):
 *                           npm run reseal
 *   4. Rewrite the old notes under the new key:
 *                           npm run reseal -- --apply
 *   5. When it says "Safe to remove the old keys", take k1 out of DATA_ENCRYPTION_KEYS and deploy again.
 *
 * Needs, in the environment or .env.local:
 *   DATABASE_URL            the database's own connection string (Supabase: Project Settings → Database → Connection string,
 *                           the direct or session-pooler one; add ?sslmode=require). This is the only place a database
 *                           password is used; the app itself never has one.
 *   DATA_ENCRYPTION_KEYS    the same list the app uses, new key first
 *
 * It never prints a note or a sealed value, only counts. A note no key opens is left exactly as it is and reported.
 * Safe to run twice, and safe to run while members are using the app: a note saved at the same moment is left for the next run.
 * Run it from a person's own computer or a one-off job, never from the app.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { parseKeys } from "../src/lib/crypto/seal";
import { resealAll, safeToRetire } from "../src/lib/crypto/reseal";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnvFile(path.resolve(__dirname, "../.env.local"));
  const apply = process.argv.includes("--apply");
  const keys = process.env.DATA_ENCRYPTION_KEYS?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!keys || !url) {
    console.error("Set DATABASE_URL and DATA_ENCRYPTION_KEYS first (see the top of scripts/reseal.ts).");
    process.exit(2);
  }
  let ring;
  try {
    ring = parseKeys(keys, true);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (!ring) process.exit(2);
  console.log(`Sealing key: ${ring.current.id}   Keys that can open notes: ${[...ring.all.keys()].join(", ")}`);
  if (ring.all.size === 1) console.log("Only one key is listed, so there is nothing older to move. This will just check that every note opens.");

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const reports = await resealAll(db, keys, { apply });
    for (const r of reports) {
      const keysUsed = Object.entries(r.byKey).map(([id, n]) => `${id}: ${n}`).join(", ") || "none";
      console.log(`\n${r.place}\n  notes: ${r.total}   sealed with → ${keysUsed}`);
      console.log(`  already on the new key: ${r.current}   ${apply ? "moved to the new key" : "would be moved"}: ${r.resealed}   unreadable: ${r.unreadable}   saved meanwhile (left for next run): ${r.changedMeanwhile}`);
    }
    const unreadable = reports.reduce((n, r) => n + r.unreadable, 0);
    const meanwhile = reports.reduce((n, r) => n + r.changedMeanwhile, 0);
    console.log("");
    if (unreadable > 0) console.log(`${unreadable} note(s) cannot be opened by any key in the list. They have not been touched. If a key was lost they cannot be recovered; otherwise add the key they were sealed with and run again.`);
    if (meanwhile > 0) console.log(`${meanwhile} note(s) were saved while this ran. Run it once more.`);
    if (safeToRetire(reports, apply)) {
      console.log(apply ? "Safe to remove the old keys: every note is sealed with the new key." : "Nothing to move. Every note is already sealed with the new key.");
    } else if (!apply && unreadable === 0) {
      console.log("Run again with --apply to move them. Keep the old keys in the list until then.");
    } else {
      console.log("Keep the old keys in DATA_ENCRYPTION_KEYS for now.");
    }
    process.exitCode = unreadable > 0 ? 1 : 0;
  } finally {
    await db.end();
  }
}

void main();
