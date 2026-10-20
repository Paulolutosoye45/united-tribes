import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { startStandin } from "./server";

const ROOT = path.resolve(__dirname, "../..");

/** People who get a role the first time they sign in, by the start of their email. Everyone else is a member. */
export function personaRoles(email: string): string[] {
  const start = email.split("@")[0].split(".")[0];
  return ["admin", "pastor", "director", "coach", "care_lead", "data_lead", "community_champion"].includes(start) ? [start] : [];
}

export type Booted = {
  apiUrl: string;
  anonKey: string;
  pgPort: number;
  /** A superuser connection, for arranging situations in tests. */
  admin: Client;
  close: () => Promise<void>;
};

/**
 * Starts a throwaway Postgres (it refuses to run as root), applies the shim and
 * every migration, and puts the stand-in in front of it.
 */
export async function bootStandin(options: { apiPort?: number; pgPort?: number; jwtSecret?: string; captchaPrefix?: string; smsHook?: { url: string; secret: string } } = {}): Promise<Booted> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-standin-"));
  const pgPort = options.pgPort ?? 55000 + Math.floor(Math.random() * 2000);
  const apiPort = options.apiPort ?? 54321;
  const jwtSecret = options.jwtSecret ?? "standin-secret-not-for-real-use-0123456789abcdef";

  const pg = new EmbeddedPostgres({ databaseDir: path.join(dataDir, "data"), user: "postgres", password: "postgres", port: pgPort, persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("ut_dev");

  const admin = pg.getPgClient("ut_dev");
  await admin.connect();
  await admin.query(fs.readFileSync(path.join(ROOT, "tests/db/shim.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await admin.query(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${file}\n${(error as Error).message}`);
    }
  }

  const api = await startStandin({
    port: apiPort,
    pg: { host: "127.0.0.1", port: pgPort, user: "postgres", password: "postgres", database: "ut_dev" },
    jwtSecret,
    rolesFor: personaRoles,
    captchaPrefix: options.captchaPrefix,
    smsHook: options.smsHook,
  });

  return {
    apiUrl: api.url,
    anonKey: api.anonKey,
    pgPort,
    admin,
    async close() {
      await api.close();
      await admin.end();
      await pg.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
