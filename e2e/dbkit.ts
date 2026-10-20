import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import type { Q, TestDb } from "../tests/db/helpers";

/**
 * The database tests' helpers, pointed at the throwaway database a journey is running against. A journey uses them to arrange a
 * situation (a panel, an approved leader) the way the database tests do, then drives the screens in the browser.
 */
export function testDbFor(admin: Client): TestDb {
  async function inTransaction<T>(role: string, userId: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    await admin.query("begin");
    try {
      await admin.query(`set local role ${role}`);
      await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      await admin.query("select set_config('request.jwt.claims', $1, true)", [""]);
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
    name: "ut_dev",
    asUser: (userId, fn) => inTransaction("authenticated", userId, fn),
    asAnon: (fn) => inTransaction("anon", null, fn),
    async createUser(opts = {}) {
      const email = (opts.email ?? `${randomUUID().slice(0, 8)}@example.org`).toLowerCase();
      const { rows } = await admin.query("insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2::jsonb) returning id", [email, JSON.stringify(opts.meta ?? {})]);
      return { id: rows[0].id as string, email };
    },
    async grant(userId, role) {
      await admin.query("insert into public.person_roles (person_id, role, centre_id) select $1, $2::public.app_role, centre_id from public.people where id = $1 on conflict do nothing", [userId, role]);
    },
    async close() {
      await admin.end();
    },
  };
}
