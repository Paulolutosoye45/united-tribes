/**
 * Boots the stand-in backend on a throwaway Postgres, seeds a few people and
 * serves the already-built app. Writes .e2e/stack.json so journeys can reach the database.
 * Build first, with the same environment (see e2e/run.sh).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bootStandin } from "../scripts/standin/boot";
import { API_PORT, APP_PORT, JWT_SECRET, STATE_FILE, STUB_PORT, appEnv, intakeEnv, messagingEnv, securityEnv } from "./env";
import { seedPeople } from "./seed";
import { TURNSTILE, startStubs } from "./stubs";

const ROOT = path.resolve(__dirname, "..");

async function main() {
  const booted = await bootStandin({ apiPort: API_PORT, jwtSecret: JWT_SECRET, captchaPrefix: TURNSTILE.tokenPrefix });
  const q = (sql: string, args: unknown[] = []) => booted.admin.query(sql, args);
  await seedPeople(q);

  // The journeys must not depend on the hour they run at: pretend it is midday in Lagos (quiet hours are tested in the database tests).
  await q("create or replace function public.lagos_hour() returns integer language sql stable set search_path = '' as $$ select 12 $$");
  const worker = (await q("select public.bootstrap_worker_token('e2e') as t")).rows[0].t as string;
  const stubs = await startStubs(STUB_PORT);

  // Week 2 is the current week of the provisional season.
  await q("update public.seasons set starts_on = current_date - 9, ends_on = current_date - 9 + 84");

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ pgPort: booted.pgPort, stubUrl: stubs.url, workerToken: worker }));

  const log = fs.openSync(path.join(path.dirname(STATE_FILE), "next.log"), "w");
  const app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], { cwd: ROOT, env: { ...process.env, ...appEnv(), ...messagingEnv(worker, stubs.url), ...securityEnv(stubs.url), ...intakeEnv() }, stdio: ["ignore", log, log] });
  const stop = async () => {
    app.kill();
    await stubs.close();
    await booted.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  console.log("STACK READY");
}
void main();
