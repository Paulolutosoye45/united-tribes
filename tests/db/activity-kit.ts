import { randomUUID } from "node:crypto";
import type { Kit } from "./builders";
import type { Q, Row, TestDb } from "./helpers";

// Shared by the Phase 5 (activity log) database tests: the owner, unlocked, and ways to plant events on chosen days.

export const PHRASE = "river-lantern-mango-cobalt";

/** Noon in Lagos, `n` days ago, as a SQL expression, so a test never sits on a day boundary. */
export const noon = (n: number) => `(((public.today_lagos() - ${n})::timestamp + interval '12 hours') at time zone 'Africa/Lagos')`;

const placeholders = (params: unknown[]) => params.map((_, i) => `$${i + 1}`).join(", ");

/** Sets the platform owner, as the installer would, and unlocks them on one sign-in session. */
export async function makeOwner(db: TestDb, email = "owner@example.org") {
  const owner = await db.createUser({ email });
  await db.admin.query("update public.people set full_name = 'The Owner', preferred_name = 'Owner' where id = $1", [owner.id]);
  await db.admin.query("select public.bootstrap_platform_owner($1, $2)", [owner.email, PHRASE]);
  const session = randomUUID();
  const run = <T>(fn: (q: Q) => Promise<T>) => db.asUser(owner.id, fn, { session });
  const call = async (name: string, ...params: unknown[]) =>
    (await run((q) => q(`select public.${name}(${placeholders(params)}) as r`, params))).rows[0]?.r;
  await call("god_unlock", PHRASE);
  return { owner, session, run, call };
}

export type OwnerKit = Awaited<ReturnType<typeof makeOwner>>;

/** A person's recorded event on a given day (bypassing the door, so the day and kind are exactly as chosen). */
export async function addEvent(db: TestDb, person: string, kind: string, daysAgo: number, meta: Record<string, unknown> = {}) {
  await db.admin.query(
    `insert into public.activity_events (at, day, person_id, kind, meta)
     values (${noon(daysAgo)}, public.today_lagos() - $2::int, $1, $3, $4::jsonb)`,
    [person, daysAgo, kind, JSON.stringify(meta)],
  );
}

/** Everyone created long ago, so that registering does not count as activity in a test that counts activity. */
export async function makeEveryoneOld(db: TestDb, days = 300) {
  await db.admin.query("update public.people set created_at = now() - make_interval(days => $1)", [days]);
  await db.admin.query("update public.member_profiles set submitted_at = now() - make_interval(days => $1)", [days - 100]);
  await db.admin.query("update public.tribe_members set agreed_at = now() - make_interval(days => $1), joined_at = now() - make_interval(days => $1)", [days - 100]);
}

/** Wipes what setup wrote to the logs, so a test counts only what it plants. */
export async function clearLogs(db: TestDb) {
  await db.admin.query("delete from public.event_log");
  await db.admin.query("delete from public.activity_events");
}

/** A member profile that puts the person in the teen track (the guard that normally stops this is skipped for the setup). */
export async function makeYoung(db: TestDb, k: Kit, person: string, season: string) {
  await k.profile(person, season);
  await db.admin.query("begin");
  try {
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      "update public.member_profiles set age_range_id = (select id from public.age_ranges where slug = '13-17') where person_id = $1",
      [person],
    );
    await db.admin.query("commit");
  } catch (error) {
    await db.admin.query("rollback");
    throw error;
  }
}

export const sqlOf = (db: TestDb) => async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
