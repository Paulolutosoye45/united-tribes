import type { Row, TestDb } from "./helpers";

// Shared building blocks for the Stage 6 database tests: people, seasons, tribes with leaders, members with
// profiles, meetings and pulses. Each test file gets its own database, so none of this leaks between files.

export type Person = { id: string; email: string };

export interface TribeOpts {
  name?: string;
  community?: string; // slug
  track?: string; // slug
  coach?: string | null;
  /** a certified leader (default true: a tribe is only offered to members when its leader is certified) */
  certified?: boolean;
  /** "certified" = an assistant with an assistant certificate, "training" = an assistant still in training */
  assistant?: "certified" | "training" | null;
  status?: string;
  capacity?: number;
  slot?: "weeknight-evening" | "sunday-afternoon" | "sunday-evening" | "saturday-morning";
  mode?: "online" | "in_person";
  zone?: string;
  type?: "mixed" | "women" | "men";
}

export interface ProfileOpts {
  age?: string; // age range slug
  gender?: "female" | "male" | "undisclosed";
  mix?: "mixed" | "same_gender" | "no_preference";
  zone?: string;
  community?: string;
  faith?: string;
  mode?: "online" | "in_person" | "either";
  times?: string[];
  adjacent?: boolean;
  /** -1 quiet one-to-one, 1 lively group chat */
  social?: number;
}

/**
 * What the kit needs of a database. The database tests pass their own; the browser journeys pass a thin wrapper
 * around their throwaway Postgres (no asUser or asAnon there, so `call` and `anon` are for the database tests only).
 */
export type KitDb = Pick<TestDb, "admin" | "createUser" | "grant"> & Partial<Pick<TestDb, "asUser" | "asAnon">>;

export async function kit(db: KitDb) {
  const lookup = async (table: string, slug: string) =>
    (await db.admin.query(`select id from public.${table} where slug = $1`, [slug])).rows[0].id as string;
  const centreId = (await db.admin.query("select id from public.centres limit 1")).rows[0].id as string;
  const goalOf = async (communitySlug: string) =>
    (
      await db.admin.query(
        "select g.id from public.season_goals g join public.communities t on t.id = g.community_id where t.slug = $1 order by g.sort limit 1",
        [communitySlug],
      )
    ).rows[0].id as string;
  let n = 0;

  const sql = async (text: string, params: unknown[] = []) => (await db.admin.query(text, params)).rows as Row[];
  const call = async (userId: string, fn: string, params: unknown[] = []) =>
    (await db.asUser!(userId, (q) => q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params))).rows[0]?.r;
  const anon = async (fn: string, params: unknown[] = []) =>
    (await db.asAnon!((q) => q(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) as r`, params))).rows[0]?.r;

  async function person(name: string): Promise<Person> {
    const u = await db.createUser();
    await db.admin.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${name} Test`, name]);
    return u;
  }

  async function staff(name: string, ...roles: string[]): Promise<Person> {
    const u = await person(name);
    for (const r of roles) await db.grant(u.id, r);
    return u;
  }

  /** A season of `weeks` weeks that began `startedDaysAgo` days ago (negative = starts in the future). */
  async function season(name: string, startedDaysAgo: number, weeks = 12) {
    const { rows } = await db.admin.query(
      `insert into public.seasons (centre_id, name, starts_on, ends_on, weeks)
       values ($1, $2, public.today_lagos() - $3::int, public.today_lagos() - $3::int + ($4::int * 7 - 1), $4) returning id`,
      [centreId, name, startedDaysAgo, weeks],
    );
    return rows[0].id as string;
  }

  /** The seeded season, moved so that it began `startedDaysAgo` days ago. */
  async function moveSeason(seasonId: string, startedDaysAgo: number, weeks = 12) {
    await db.admin.query(
      "update public.seasons set starts_on = public.today_lagos() - $2::int, ends_on = public.today_lagos() - $2::int + ($3::int * 7 - 1), weeks = $3 where id = $1",
      [seasonId, startedDaysAgo, weeks],
    );
  }

  async function tribe(seasonId: string, o: TribeOpts = {}) {
    const leader = await person(`Leader${++n}`);
    await db.grant(leader.id, "leader");
    const slot = o.slot ?? "weeknight-evening";
    const day = slot === "weeknight-evening" ? 3 : slot === "saturday-morning" ? 6 : 0;
    const time = slot === "weeknight-evening" ? "20:00" : slot === "saturday-morning" ? "09:00" : slot === "sunday-afternoon" ? "15:00" : "19:00";
    const community = o.community ?? "professionals";
    let assistant: Person | null = null;
    if (o.assistant) {
      assistant = await person(`Assistant${n}`);
      await db.grant(assistant.id, "assistant_leader");
      if (o.assistant === "certified") {
        await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'assistant_leader')", [assistant.id]);
      }
    }
    const { rows } = await db.admin.query(
      `insert into public.tribes (season_id, leader_id, assistant_id, coach_id, status, name, track_id, community_id, season_goal_id, fixed, tribe_type,
          story, meeting_day, meeting_time, slot, meeting_mode, zone, place_note, capacity, loving_god, loving_others, loving_life, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', $10, 'My story.', $11, $12, $13, $14, $15, 'Near the bridge', $16,
               'Pray daily.', 'Call each other.', 'Take one step a week.', now())
       returning id`,
      [
        seasonId, leader.id, assistant?.id ?? null, o.coach ?? null, o.status ?? "approved", o.name ?? `Tribe ${n}`,
        await lookup("tracks", o.track ?? "builders"), await lookup("communities", community), await goalOf(community),
        o.type ?? "mixed", day, time, slot, o.mode ?? "in_person", o.zone ?? "mainland", o.capacity ?? 12,
      ],
    );
    if (o.certified !== false) await db.admin.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader')", [leader.id]);
    return { leader, assistant, tribe: rows[0].id as string };
  }

  /** A profile that fits an ordinary mid-week, mainland, mixed tribe for the Builders track. */
  async function profile(personId: string, seasonId: string, o: ProfileOpts = {}) {
    const community = o.community ?? "professionals";
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
          season_goal_id, goal_baseline, meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 3, $10, $11, $12, $13, 250)`,
      [
        personId, seasonId, await lookup("age_ranges", o.age ?? "33-40"), o.gender ?? "female", o.mix ?? "mixed", o.zone ?? "mainland",
        await lookup("communities", community), o.faith ?? "growing", await goalOf(community), o.mode ?? "either",
        o.times ?? ["weeknight-evening"], o.adjacent ?? false, o.social ?? 0,
      ],
    );
  }

  /** A person with a profile, seated in a tribe the way choose_tribe would seat them (without the run). */
  async function seat(tribeId: string, seasonId: string, name: string, o: { degree?: number; profile?: ProfileOpts | false } = {}) {
    const u = await person(name);
    if (o.profile !== false) await profile(u.id, seasonId, o.profile ?? {});
    await db.admin.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, $4, 'test', '{}'::jsonb, current_date + 14)`,
      [tribeId, u.id, seasonId, o.degree ?? 90],
    );
    return u;
  }

  /** Holds `weeks` meetings; each person is present for their first `presence` weeks and away after. */
  async function meetings(tribeId: string, leaderId: string, weeks: number, presence: [string, number][], fromWeek = 1) {
    const logs: string[] = [];
    const att: string[] = [];
    for (let w = fromWeek; w < fromWeek + weeks; w++) {
      logs.push(`('${tribeId}', ${w}, true, '${leaderId}')`);
      for (const [who, count] of presence) att.push(`('${tribeId}', ${w}, '${who}', '${w <= count ? "present" : "absent"}')`);
    }
    await db.admin.query(`insert into public.tribe_logs (tribe_id, week, held, logged_by) values ${logs.join(",")}`);
    if (att.length) await db.admin.query(`insert into public.tribe_attendance (tribe_id, week, person_id, status) values ${att.join(",")}`);
  }

  async function pulse(tribeId: string, who: string, week: number, belonging: number, god = 3, others = 3, life = 3) {
    await db.admin.query(
      "insert into public.pulses (person_id, tribe_id, week, belonging, god, others, life) values ($1, $2, $3, $4, $5, $6, $7)",
      [who, tribeId, week, belonging, god, others, life],
    );
  }

  return { centreId, lookup, goalOf, sql, call, anon, person, staff, season, moveSeason, tribe, profile, seat, meetings, pulse };
}

export type Kit = Awaited<ReturnType<typeof kit>>;

export async function newKit() {
  // Loaded here so that importing the kit does not need the test runner (the browser journeys use it too)
  const { createTestDb } = await import("./helpers");
  const db = await createTestDb();
  return { db, k: await kit(db) };
}
