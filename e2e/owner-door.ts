import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { testDbFor } from "./dbkit";

/**
 * The owner, set up in the throwaway database, with a way to call the owner-only database functions the way the console does (a
 * signed-in owner on an unlocked session). A journey uses it to arrange a situation (appoint a leader) before it drives the screens.
 * Journeys share one database, so any earlier owner is replaced.
 */
export async function ownerDoor(q: Client, email: string, phrase: string, name = "Platform Owner") {
  const adapter = testDbFor(q);
  if ((await q.query("select 1 from public.platform_owner")).rowCount) await q.query("select public.remove_platform_owner()");
  const owner = await adapter.createUser({ email });
  await q.query("update public.people set full_name = $2, preferred_name = 'Owner' where id = $1", [owner.id, name]);
  await q.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, phrase]);
  const session = randomUUID();

  async function call(fn: string, ...params: unknown[]): Promise<Record<string, unknown>> {
    await q.query("begin");
    try {
      await q.query("set local role authenticated");
      await q.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
      await q.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner.id, role: "authenticated", session_id: session })]);
      const r = await q.query(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params);
      await q.query("commit");
      return r.rows[0]?.r as Record<string, unknown>;
    } catch (error) {
      await q.query("rollback");
      throw error;
    }
  }
  await call("god_unlock", phrase);
  return { owner, call };
}
