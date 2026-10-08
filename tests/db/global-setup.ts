import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(__dirname, "../..");
const TEMPLATE = "ut_template";

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
  await pg.createDatabase(TEMPLATE);

  const client = pg.getPgClient(TEMPLATE);
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, "shim.sql"), "utf8"));
  for (const file of migrationFiles()) {
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
