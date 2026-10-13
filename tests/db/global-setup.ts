import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(__dirname, "../..");
const TEMPLATE = "ut_template";
/** The database as it stood just before the tribes rename migration; tribes-naming.test.ts upgrades copies of it. */
const BEFORE_RENAME = "ut_before_tribes";
const RENAME_MIGRATION = "_tribes_naming.sql";

declare module "vitest" {
  export interface ProvidedContext {
    pgPort: number;
  }
}

function migrationFiles(): string[] {
  const dir = path.join(ROOT, "supabase/migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

export default async function setup(project: TestProject) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ut-pg-"));
  const port = 54000 + Math.floor(Math.random() * 2000);

  const pg = new EmbeddedPostgres({
    databaseDir: path.join(dataDir, "data"),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();
  // Build the schema in two stages: everything up to the rename, then the rename itself. The state between the two is kept
  // as its own template so the upgrade can be tested against it.
  const files = migrationFiles();
  const before = files.filter((f) => !f.endsWith(RENAME_MIGRATION));
  const rename = files.filter((f) => f.endsWith(RENAME_MIGRATION));

  await pg.createDatabase(BEFORE_RENAME);
  const first = pg.getPgClient(BEFORE_RENAME);
  await first.connect();
  await first.query(fs.readFileSync(path.join(__dirname, "shim.sql"), "utf8"));
  for (const file of before) {
    try {
      await first.query(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${path.basename(file)}\n${(error as Error).message}`);
    }
  }
  await first.end();

  // A template cannot be copied while anyone is connected to it; the client above is closed, so this is safe.
  const admin = pg.getPgClient("postgres");
  await admin.connect();
  await admin.query(`create database ${TEMPLATE} template ${BEFORE_RENAME}`);
  await admin.end();

  const client = pg.getPgClient(TEMPLATE);
  await client.connect();
  for (const file of rename) {
    try {
      await client.query(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`Migration failed: ${path.basename(file)}\n${(error as Error).message}`);
    }
  }
  await client.end();

  project.provide("pgPort", port);

  return async () => {
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
