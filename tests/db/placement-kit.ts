import type { Kit, ProfileOpts } from "./builders";
import type { OwnerKit } from "./activity-kit";
import type { Row, TestDb } from "./helpers";

// Shared by the automatic-placement tests: members who are ready to be placed, a run planned in as many calls as it takes, and the
// handful of lookups every test needs (a private link, the sending service's token, a tribe's emails).

export const FORM_VERSION = "2026-12-v4";

export type MemberOpts = ProfileOpts & {
  /** days since the form was filled in (default 20: past the 7-day grace period; larger = filled in earlier) */
  daysAgo?: number;
  /** false = never agreed to matching */
  matching?: boolean;
  /** a WhatsApp number, with the member's consent to be contacted there (default none) */
  whatsapp?: string;
  /** the contact line on the form: true = ticked, false = unticked on purpose, undefined = never saw it */
  share?: boolean;
};

/** A member with a finished form and the consent to be matched, whose answers have settled. */
export async function readyMember(
  db: TestDb,
  k: Kit,
  seasonId: string,
  name: string,
  o: MemberOpts = {},
) {
  const u = await k.person(name);
  await k.profile(u.id, seasonId, o);
  if (o.matching !== false)
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'matching', true, 't')",
      [u.id],
    );
  if (o.whatsapp) {
    await db.admin.query(
      "update public.member_profiles set whatsapp = $2 where person_id = $1",
      [u.id, o.whatsapp],
    );
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'whatsapp', true, 't')",
      [u.id],
    );
  }
  if (o.share !== undefined)
    await db.admin.query(
      "insert into public.consents (person_id, purpose, granted, version) values ($1, 'team_contact', $2, 't')",
      [u.id, o.share],
    );
  await settle(db, u.id, o.daysAgo ?? 20);
  return u;
}

/** Makes a form look as if it was filled in `daysAgo` days ago (the triggers that stamp the time are skipped for the setup). */
export async function settle(
  db: TestDb,
  person: string | null,
  daysAgo: number,
) {
  await db.admin.query("begin");
  try {
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      `update public.member_profiles set updated_at = now() - make_interval(days => $2), submitted_at = now() - make_interval(days => $2)
        where ($1::uuid is null or person_id = $1)`,
      [person, daysAgo],
    );
    await db.admin.query("commit");
  } catch (error) {
    await db.admin.query("rollback");
    throw error;
  }
}

/** The church's seasons start in the future in the test database; this says which one and makes sure of it. */
export async function openSeason(db: TestDb) {
  const row = (
    await db.admin.query(
      "select id, starts_on > public.today_lagos() as future from public.seasons where status in ('planning','open') order by starts_on limit 1",
    )
  ).rows[0];
  if (!row.future)
    throw new Error(
      "The seeded season has already started; the placement tests need one that has not",
    );
  return row.id as string;
}

/** Plans a run, calling the step as many times as the page would, and returns its id. */
export async function planRun(
  o: OwnerKit,
  options: Record<string, unknown> = {},
) {
  const made = await o.call("placement_run_new", JSON.stringify(options));
  for (let i = 0; i < 60; i++) {
    const st = await o.call("placement_run_step", made.run);
    if (st.status !== "planning") break;
  }
  return made.run as string;
}

/** Decides every tribe the plan would leave too small the same way. */
export async function resolveAll(
  db: TestDb,
  o: OwnerKit,
  run: string,
  action: "keep" | "hold" | "retry" = "keep",
) {
  for (const t of (
    await db.admin.query(
      "select tribe_id from public.placement_teams where run_id = $1 and small and decision is null",
      [run],
    )
  ).rows) {
    await o.call("placement_resolve_small", run, t.tribe_id, action);
  }
}

export async function proposedCount(db: TestDb, run: string) {
  return (
    await db.admin.query(
      "select count(*)::int n from public.placement_items where run_id = $1 and status = 'proposed'",
      [run],
    )
  ).rows[0].n as number;
}

/** Plans, settles the small tribes, approves with the count the page would send, and places everything. */
export async function placeRun(
  db: TestDb,
  o: OwnerKit,
  options: Record<string, unknown> = {},
  small: "keep" | "hold" | "retry" = "keep",
) {
  const run = await planRun(o, options);
  await resolveAll(db, o, run, small);
  const n = await proposedCount(db, run);
  await o.call("placement_run_approve", run, n);
  for (let i = 0; i < 40; i++) {
    const r = await o.call("placement_run_place", run);
    if (r.left === 0) break;
  }
  return { run, n };
}

export async function workerToken(db: TestDb) {
  return (
    await db.admin.query(
      "select public.bootstrap_worker_token('placement-test') as t",
    )
  ).rows[0].t as string;
}

/** The private link a placed member was sent: the raw secret the email carries. */
export async function linkFor(
  db: TestDb,
  person: string,
  template = "placement_your_tribe",
) {
  return (
    await db.admin.query(
      "select reply_token as t from public.messages where template = $1 and person_id = $2 order by created_at desc, dedupe_key desc limit 1",
      [template, person],
    )
  ).rows[0]?.t as string | undefined;
}

/** Pretends the member emails have gone out, `hoursAgo` hours ago. */
export async function markSent(
  db: TestDb,
  hoursAgo: number,
  template = "placement_your_tribe",
) {
  await db.admin.query(
    "update public.messages set status = 'sent', sent_at = now() - make_interval(hours => $2) where template = $1 and status in ('queued', 'sending')",
    [template, hoursAgo],
  );
}

export const anon = (db: TestDb, fn: string, ...args: unknown[]) =>
  db
    .asAnon((q) =>
      q(
        `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`,
        args,
      ),
    )
    .then((r) => r.rows[0]?.r);

export const asUser = (
  db: TestDb,
  uid: string,
  fn: string,
  ...args: unknown[]
) =>
  db
    .asUser(uid, (q) =>
      q(
        `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`,
        args,
      ),
    )
    .then((r) => r.rows[0]?.r);

export const rows = async (
  db: TestDb,
  text: string,
  params: unknown[] = [],
): Promise<Row[]> => (await db.admin.query(text, params)).rows;
