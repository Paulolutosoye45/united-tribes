import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { inject } from "vitest";

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>;

export interface TestDb {
  admin: Client;
  name: string;
  /** Run SQL as a signed-in person (role "authenticated"), in one transaction. */
  asUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T>;
  /** Run SQL as a visitor who is not signed in (role "anon"). */
  asAnon<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  createUser(opts?: { email?: string; confirmed?: boolean; meta?: Record<string, unknown> }): Promise<{ id: string; email: string }>;
  grant(userId: string, role: string): Promise<void>;
  close(): Promise<void>;
}

function connect(port: number, database: string) {
  return new Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database });
}

/** A fresh database cloned from the migrated template. Tests never share state. */
export async function createTestDb(): Promise<TestDb> {
  const port = inject("pgPort");
  const name = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const root = connect(port, "postgres");
  await root.connect();
  await root.query(`create database ${name} template ut_template`);
  await root.end();

  const admin = connect(port, name);
  await admin.connect();

  async function inTransaction<T>(role: string, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    await admin.query("begin");
    try {
      await admin.query(`set local role ${role}`);
      await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      const result = await fn((sql, params) => admin.query(sql, params));
      await admin.query("commit");
      return result;
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }
  }

  return {
    admin,
    name,
    asUser: (userId, fn) => inTransaction("authenticated", userId, fn),
    asAnon: (fn) => inTransaction("anon", null, fn),
    async createUser(opts = {}) {
      const email = (opts.email ?? `${randomUUID().slice(0, 8)}@example.org`).toLowerCase();
      const confirmed = opts.confirmed ?? true;
      const { rows } = await admin.query(
        `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
         values ($1, ${confirmed ? "now()" : "null"}, $2::jsonb) returning id`,
        [email, JSON.stringify(opts.meta ?? {})],
      );
      return { id: rows[0].id as string, email };
    },
    async grant(userId, role) {
      await admin.query(
        `insert into public.person_roles (person_id, role, centre_id)
         select $1, $2::public.app_role, centre_id from public.people where id = $1
         on conflict do nothing`,
        [userId, role],
      );
    },
    async close() {
      await admin.end();
      const cleanup = connect(port, "postgres");
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

/** Expect a database error with the given SQLSTATE code. */
export async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code) {
      throw new Error(`Expected SQLSTATE ${code} but got ${actual}: ${(error as Error).message}`);
    }
    return;
  }
  throw new Error(`Expected SQLSTATE ${code} but the statement succeeded`);
}
