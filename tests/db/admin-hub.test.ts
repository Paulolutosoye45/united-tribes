import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCode, type Row, type TestDb } from "./helpers";
import { newKit, type Kit, type Person } from "./builders";

// Stage 7: the office's own controls (seasons, catalogue, weekly guides, church settings, launch checklist).
// Every function checks the caller's role itself, validates in plain words, and leaves a line in the event log.

let db: TestDb;
let k: Kit;
let admin: Person;
let director: Person;
let pastor: Person;
let dataLead: Person;
let coach: Person;
let member: Person;

const call = (who: Person, fn: string, params: unknown[] = []) => k.call(who.id, fn, params);

/** The nth Sunday from now (n = 1 is the next one that is at least a week away). */
async function sunday(n: number): Promise<string> {
  const { rows } = await db.admin.query(
    "select (public.today_lagos() + ((7 - extract(isodow from public.today_lagos())::int) % 7) + 7 * $1::int)::text as d",
    [n],
  );
  return rows[0].d as string;
}

/** The call is refused with this code, and the message says what to do (it is shown to the person as it is). */
async function refused(promise: Promise<unknown>, code: string, words: RegExp) {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    expect(e.code, e.message).toBe(code);
    expect(e.message).toMatch(words);
    return;
  }
  throw new Error(`Expected SQLSTATE ${code} but the statement succeeded`);
}

/** A member who typed their own goal (no catalogue goal chosen). */
async function writeInProfile(personId: string, seasonId: string, communityId: string, text: string) {
  await db.admin.query(
    `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey,
        goal_other, goal_baseline, meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds)
     values ($1, $2, (select id from public.age_ranges where slug = '33-40'), 'female', 'mixed', 'mainland', $3, 'growing',
             $4, 3, 'either', array['weeknight-evening'], false, 0, 250)`,
    [personId, seasonId, communityId, text],
  );
}

async function seasonsOf(who: Person): Promise<Row[]> {
  return (await call(who, "admin_seasons")).seasons;
}

beforeAll(async () => {
  ({ db, k } = await newKit());
  admin = await k.staff("Adm", "admin");
  director = await k.staff("Dir", "director");
  pastor = await k.staff("Pas", "pastor");
  dataLead = await k.staff("Dat", "data_lead");
  coach = await k.staff("Coa", "coach");
  member = await k.person("Mem");
  // Start without the provisional season so the dates in these tests are never in anyone's way
  await db.admin.query("delete from public.seasons");
});

afterAll(async () => {
  await db.close();
});

describe("church settings", () => {
  it("lets everyone read the vision and mission, but only the pastorate and office see the form address", async () => {
    await call(pastor, "save_church_settings", ["To connect every member to a tribe.", "We walk together for twelve weeks.", "https://forms.example.org/testimony"]);
    const asMember = await call(member, "church_settings");
    expect(asMember.vision).toBe("To connect every member to a tribe.");
    expect(asMember.mission).toBe("We walk together for twelve weeks.");
    expect(asMember.testimony_form_url).toBeNull();
    expect(asMember.can_edit).toBe(false);
    const asPastor = await call(pastor, "church_settings");
    expect(asPastor.testimony_form_url).toBe("https://forms.example.org/testimony");
    expect(asPastor.can_edit).toBe(true);
  });

  it("keeps changes to the people allowed to make them", async () => {
    await expectCode(call(coach, "save_church_settings", ["x", "y", null]), "42501");
    await expectCode(call(member, "save_church_settings", ["x", "y", null]), "42501");
    await expectCode(call(dataLead, "save_church_settings", ["x", "y", null]), "42501");
    await call(director, "save_church_settings", ["To connect every member to a tribe.", "We walk together for twelve weeks.", "https://forms.example.org/testimony"]);
  });

  it("refuses an address that is not https, has spaces, or words that are too long", async () => {
    await expectCode(call(admin, "save_church_settings", ["a", "b", "http://forms.example.org"]), "22023");
    await expectCode(call(admin, "save_church_settings", ["a", "b", "https://forms.example.org/a b"]), "22023");
    await expectCode(call(admin, "save_church_settings", ["a".repeat(601), "b", null]), "22023");
    await expectCode(call(admin, "save_church_settings", ["a", "b".repeat(601), null]), "22023");
  });

  it("clears a setting when it is left blank, and records only what really changed", async () => {
    const before = (await k.sql("select count(*)::int as n from public.event_log where action = 'settings.saved'"))[0].n;
    // Same words again: nothing changed, nothing logged
    await call(admin, "save_church_settings", ["To connect every member to a tribe.", "We walk together for twelve weeks.", "https://forms.example.org/testimony"]);
    expect((await k.sql("select count(*)::int as n from public.event_log where action = 'settings.saved'"))[0].n).toBe(before);
    const cleared = await call(admin, "save_church_settings", ["To connect every member to a tribe.", "We walk together for twelve weeks.", ""]);
    expect(cleared.testimony_form_url).toBeNull();
    const last = (await k.sql("select meta from public.event_log where action = 'settings.saved' order by id desc limit 1"))[0];
    expect(last.meta.changed).toEqual(["testimony_form_url"]);
    await call(admin, "save_church_settings", ["To connect every member to a tribe.", "We walk together for twelve weeks.", "https://forms.example.org/testimony"]);
  });
});

describe("seasons", () => {
  it("shows the office the seasons and only directors and the admin may change them", async () => {
    await expectCode(call(coach, "admin_seasons"), "42501");
    await expectCode(call(member, "admin_seasons"), "42501");
    const view = await call(pastor, "admin_seasons");
    expect(view.can_edit).toBe(false);
    expect(view.seasons).toEqual([]);
    await expectCode(call(pastor, "save_season", [null, "Season X", await sunday(3), 12, null]), "42501");
    await expectCode(call(dataLead, "set_season_status", ["00000000-0000-0000-0000-000000000000", "open"]), "42501");
  });

  it("creates a season that starts on a Sunday, in the future, and works out its end", async () => {
    const monday = (await db.admin.query("select (($1::date) + 1)::text as d", [await sunday(3)])).rows[0].d;
    await refused(call(admin, "save_season", [null, "Season 2", monday, 12, null]), "22023", /starts on a Sunday/);
    const yesterdaySunday = (await db.admin.query("select (($1::date) - 28)::text as d", [await sunday(1)])).rows[0].d;
    await refused(call(admin, "save_season", [null, "Season 2", yesterdaySunday, 12, null]), "22023", /start in the future/);
    await expectCode(call(admin, "save_season", [null, "Season 2", await sunday(3), 3, null]), "22023");
    await expectCode(call(admin, "save_season", [null, "Season 2", await sunday(3), 25, null]), "22023");
    await expectCode(call(admin, "save_season", [null, "S", await sunday(3), 12, null]), "22023");
    await expectCode(call(admin, "save_season", [null, "Season 2", null, 12, null]), "22023");

    const made = await call(director, "save_season", [null, "Season 2, 2027", await sunday(3), 12, "Faith that works"]);
    const [row] = (await seasonsOf(director)).filter((s) => s.id === made.id);
    expect(row.status).toBe("planning");
    expect(row.weeks).toBe(12);
    expect(row.sermon_series).toBe("Faith that works");
    const ends = (await db.admin.query("select ($1::date + 83)::text as d", [await sunday(3)])).rows[0].d;
    expect(row.ends_on).toBe(ends);
    expect(row.can_move_dates).toBe(true);
    const logged = await k.sql("select meta from public.event_log where action = 'season.created' and entity_id = $1", [made.id]);
    expect(logged).toHaveLength(1);
  });

  it("allows one season to be prepared at a time, because Tribe Cards and the form take the one being prepared", async () => {
    await refused(call(admin, "save_season", [null, "Season 3", await sunday(20), 12, null]), "22023", /still being prepared/);
  });

  it("lets dates change before the season begins, and not once it has begun or has approved tribes", async () => {
    const [s] = await seasonsOf(admin);
    await call(admin, "save_season", [s.id, "Season 2, 2027", await sunday(4), 10, "Faith that works"]);
    const [moved] = await seasonsOf(admin);
    expect(moved.starts_on).toBe(await sunday(4));
    expect(moved.weeks).toBe(10);

    // Approved tribes pin the dates: their first meetings were set against them
    const tribe = await k.tribe(s.id, { name: "Pinned" });
    expect(tribe.tribe).toBeTruthy();
    await refused(call(admin, "save_season", [s.id, "Season 2, 2027", await sunday(5), 10, null]), "22023", /already approved/);
    // The name and the series are still free to change
    await call(admin, "save_season", [s.id, "Season 2, renamed", await sunday(4), 10, "Faith that works, again"]);
    expect((await seasonsOf(admin))[0].name).toBe("Season 2, renamed");

    // Begun: dates are fixed
    await db.admin.query("delete from public.tribes where season_id = $1", [s.id]);
    await db.admin.query("update public.seasons set starts_on = public.today_lagos() - 7, ends_on = public.today_lagos() + 62 where id = $1", [s.id]);
    await refused(call(admin, "save_season", [s.id, "Season 2, renamed", await sunday(4), 10, null]), "22023", /once the season has begun/);
    await db.admin.query("update public.seasons set starts_on = $2::date, ends_on = $2::date + 69 where id = $1", [s.id, await sunday(4)]);
  });

  it("moves forward through planning, open, running and closed, and never back", async () => {
    const [s] = await seasonsOf(admin);
    await call(admin, "set_season_status", [s.id, "open"]);
    expect((await seasonsOf(admin))[0].status).toBe("open");
    await call(admin, "set_season_status", [s.id, "planning"]); // open can step back to planning
    await call(admin, "set_season_status", [s.id, "open"]);
    await call(admin, "set_season_status", [s.id, "running"]);
    await refused(call(admin, "set_season_status", [s.id, "open"]), "22023", /only moves forward/);
    await expectCode(call(admin, "set_season_status", [s.id, "sideways"]), "22023");
    await expectCode(call(admin, "set_season_status", ["00000000-0000-0000-0000-000000000000", "open"]), "P0002");
  });

  it("refuses dates that overlap another season, and a second running season", async () => {
    const [s] = await seasonsOf(admin);
    // s runs sunday(4) for 10 weeks. A season starting inside it overlaps.
    await refused(call(admin, "save_season", [null, "Clash", await sunday(6), 12, null]), "22023", /overlap Season 2, renamed/);
    // Starting the day after it ends is fine
    const after = (await db.admin.query("select ($1::date + 1)::text as d", [s.ends_on])).rows[0].d;
    const next = await call(admin, "save_season", [null, "Season 3", after, 12, null]);
    await refused(call(admin, "set_season_status", [next.id, "running"]), "22023", /still running\. Close it first/);
    await call(admin, "set_season_status", [s.id, "closed"]);
    await call(admin, "set_season_status", [next.id, "running"]);
    await refused(call(admin, "set_season_status", [s.id, "running"]), "22023", /stays closed/);
    await refused(call(admin, "set_season_status", [s.id, "planning"]), "22023", /stays closed/);
  });
});

describe("the catalogue", () => {
  it("shows the office the communities, goals with how many chose each, the families and the tracks", async () => {
    await expectCode(call(coach, "admin_catalogue"), "42501");
    const c = await call(dataLead, "admin_catalogue");
    expect(c.can_edit).toBe(false);
    expect(c.communities.length).toBeGreaterThanOrEqual(4);
    expect(c.communities[0].goals.length).toBeGreaterThan(0);
    expect(c.communities[0].goals[0]).toMatchObject({ active: true, picked: 0, ever: 0, tribes: 0 });
    expect(c.families.length).toBeGreaterThan(0);
    expect(c.tracks.map((t: Row) => t.slug)).toContain("teens");
    expect((await call(admin, "admin_catalogue")).can_edit).toBe(true);
  });

  it("adds a community, refusing a name already taken or a very short one", async () => {
    const made = await call(admin, "save_community", [null, "Creatives", "Artists, makers and writers", true]);
    const slug = (await k.sql("select slug, sort, active from public.communities where id = $1", [made.id]))[0];
    expect(slug.slug).toBe("creatives");
    expect(slug.active).toBe(true);
    await expectCode(call(admin, "save_community", [null, "creatives", "", true]), "22023");
    await expectCode(call(admin, "save_community", [null, "Ab", "", true]), "22023");
    await expectCode(call(pastor, "save_community", [null, "Pastors only", "", true]), "42501");
    await call(admin, "save_community", [made.id, "Creatives and makers", "Artists, makers and writers", false]);
    const row = (await k.sql("select name, active from public.communities where id = $1", [made.id]))[0];
    expect(row).toMatchObject({ name: "Creatives and makers", active: false });
  });

  it("keeps at least one community and one track open", async () => {
    await db.admin.query("update public.communities set active = false where slug <> 'professionals'");
    const pro = (await k.sql("select id from public.communities where slug = 'professionals'"))[0].id;
    await expectCode(call(admin, "save_community", [pro, "Professionals", "", false]), "22023");
    await db.admin.query("update public.communities set active = true where slug <> 'creatives'");
    const open = await k.sql("select id from public.tracks where active");
    await db.admin.query("update public.tracks set active = false where id <> $1", [open[0].id]);
    await expectCode(call(admin, "set_track_active", [open[0].id, false]), "22023");
    await db.admin.query("update public.tracks set active = true where slug <> 'teens'");
  });

  it("adds, edits and retires a Season Goal, and will not duplicate a title within a community", async () => {
    const community = (await k.sql("select id from public.communities where slug = 'professionals'"))[0].id;
    const family = (await k.sql("select id from public.goal_families order by sort limit 1"))[0].id;
    const made = await call(director, "save_goal", [null, community, family, "Lead a team through change"]);
    const row = (await k.sql("select slug, title, active, sort from public.season_goals where id = $1", [made.id]))[0];
    expect(row.slug).toBe("lead-a-team-through-change");
    expect(row.active).toBe(true);
    await expectCode(call(director, "save_goal", [null, community, family, "lead a team through change"]), "22023");
    await expectCode(call(director, "save_goal", [null, community, family, "Short"]), "22023");
    await expectCode(call(director, "save_goal", [null, community, "00000000-0000-0000-0000-000000000000", "A goal with no family"]), "22023");
    await expectCode(call(pastor, "save_goal", [null, community, family, "Not for the pastor to add"]), "42501");
    // The same words under another community get their own slug
    const other = (await k.sql("select id from public.communities where slug <> 'professionals' and active limit 1"))[0].id;
    const twin = await call(director, "save_goal", [null, other, family, "Lead a team through change"]);
    expect((await k.sql("select slug from public.season_goals where id = $1", [twin.id]))[0].slug).toBe("lead-a-team-through-change-2");

    await call(director, "save_goal", [made.id, community, family, "Lead a team well through change"]);
    expect((await k.sql("select title from public.season_goals where id = $1", [made.id]))[0].title).toBe("Lead a team well through change");

    await call(director, "set_goal_active", [made.id, false]);
    expect((await k.sql("select active from public.season_goals where id = $1", [made.id]))[0].active).toBe(false);
    await call(director, "set_goal_active", [made.id, true]);
    await expectCode(call(director, "set_goal_active", ["00000000-0000-0000-0000-000000000000", false]), "P0002");
  });

  it("keeps a goal in its community once members or tribes rest on it", async () => {
    const S = await k.season("Pins", 3);
    const goal = (await k.sql("select g.id, g.community_id, g.family_id, g.title from public.season_goals g join public.communities t on t.id = g.community_id where t.slug = 'professionals' order by g.sort limit 1"))[0];
    const person = await k.person("Pinned");
    await k.profile(person.id, S, { community: "professionals" });
    const other = (await k.sql("select id from public.communities where slug <> 'professionals' and active limit 1"))[0].id;
    await expectCode(call(admin, "save_goal", [goal.id, other, goal.family_id, goal.title]), "22023");
    // Reading the counts: one member chose it in the season being run
    const c = await call(admin, "admin_catalogue");
    const listed = c.communities.flatMap((t: Row) => t.goals).find((g: Row) => g.id === goal.id);
    expect(listed.ever).toBe(1);
  });

  it("will not let a retired goal or community be chosen again", async () => {
    const S = (await k.sql("select id from public.seasons order by starts_on desc limit 1"))[0].id;
    const goal = (await k.sql("select g.id from public.season_goals g join public.communities t on t.id = g.community_id where t.slug = 'professionals' order by g.sort limit 1"))[0].id;
    await call(admin, "set_goal_active", [goal, false]);
    const late = await k.person("Late");
    await refused(k.profile(late.id, S, { community: "professionals" }), "22023", /has been retired/);
    await call(admin, "set_goal_active", [goal, true]);

    const community = (await k.sql("select id from public.communities where slug = 'creatives'"))[0].id;
    const family = (await k.sql("select id from public.goal_families order by sort limit 1"))[0].id;
    await call(admin, "save_goal", [null, community, family, "Show our work to the church"]);
    // Creatives was closed in an earlier test: nobody can join it
    await refused(writeInProfile(late.id, S, community, "something of my own"), "22023", /no longer available/);
  });

  it("leaves people who chose a goal before it was retired, even when the form is saved again", async () => {
    const S = (await k.sql("select id from public.seasons order by starts_on desc limit 1"))[0].id;
    const keeper = await k.person("Keeper");
    await k.profile(keeper.id, S, { community: "professionals" });
    const mine = (await k.sql("select season_goal_id as goal, community_id as community from public.member_profiles where person_id = $1", [keeper.id]))[0];
    const other = (await k.sql("select g.id from public.season_goals g where g.community_id = $1 and g.id <> $2 and g.active order by g.sort limit 1", [mine.community, mine.goal]))[0].id;
    await call(admin, "set_goal_active", [mine.goal, false]);
    await call(admin, "set_goal_active", [other, false]);

    // The member form saves with an upsert, which reaches the trigger as an insert. Their own goal passes…
    await db.admin.query(
      `insert into public.member_profiles (person_id, season_id, age_range_id, gender, tribe_mix, zone, community_id, faith_journey, season_goal_id,
          goal_baseline, meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds)
       select person_id, season_id, age_range_id, gender, tribe_mix, 'island-lekki', community_id, faith_journey, season_goal_id,
          goal_baseline, meeting_mode, meeting_times, open_to_adjacent, style_social, duration_seconds
         from public.member_profiles where person_id = $1
       on conflict (person_id) do update set zone = excluded.zone, season_goal_id = excluded.season_goal_id, community_id = excluded.community_id`,
      [keeper.id],
    );
    const saved = (await k.sql("select zone, season_goal_id as goal from public.member_profiles where person_id = $1", [keeper.id]))[0];
    expect(saved.zone).toBe("island-lekki");
    expect(saved.goal).toBe(mine.goal);
    // …but moving to a different retired goal does not
    await refused(db.admin.query("update public.member_profiles set season_goal_id = $2 where person_id = $1", [keeper.id, other]), "22023", /has been retired/);

    await call(admin, "set_goal_active", [mine.goal, true]);
    await call(admin, "set_goal_active", [other, true]);
  });

  it("lists goals that several members wrote in, never a single person's sentence, and lets the team adopt or dismiss them", async () => {
    const S = (await k.sql("select id from public.seasons order by starts_on desc limit 1"))[0].id;
    const community = (await k.sql("select id from public.communities where slug = 'professionals'"))[0].id;
    const family = (await k.sql("select id from public.goal_families order by sort limit 1"))[0].id;
    const writeIn = async (name: string, text: string) => writeInProfile((await k.person(name)).id, S, community, text);
    await writeIn("W1", "Learn to rest well");
    await writeIn("W2", "  learn to rest WELL ");
    await writeIn("W3", "Learn to rest well");
    await writeIn("W4", "Finish my master's degree");

    await expectCode(call(coach, "goal_write_ins"), "42501");
    const shared = await call(dataLead, "goal_write_ins");
    expect(shared).toHaveLength(1);
    expect(shared[0].count).toBe(3);
    expect(String(shared[0].text).toLowerCase()).toBe("learn to rest well");
    expect(shared[0].community).toBeTruthy();
    // Asking to see the ones written once shows the other as well
    expect(await call(dataLead, "goal_write_ins", [1])).toHaveLength(2);

    await expectCode(call(dataLead, "adopt_write_in", [shared[0].text, community, family, "Learn to rest well"]), "42501");
    const adopted = await call(admin, "adopt_write_in", [shared[0].text, community, family, "Learn to rest well"]);
    expect((await k.sql("select title from public.season_goals where id = $1", [adopted.id]))[0].title).toBe("Learn to rest well");
    expect(await call(dataLead, "goal_write_ins")).toEqual([]);

    // Dismissing takes one off the list without adding a goal
    await call(admin, "dismiss_write_in", ["Finish my master's degree"]);
    expect(await call(dataLead, "goal_write_ins", [1])).toEqual([]);
    await expectCode(call(admin, "dismiss_write_in", ["   "]), "22023");
  });

  it("opens and closes a track, with the teen track still held back by its platform switch", async () => {
    const teens = (await k.sql("select id from public.tracks where slug = 'teens'"))[0].id;
    await expectCode(call(admin, "set_track_active", [teens, true]), "22023");
    await expectCode(call(pastor, "set_track_active", [teens, true]), "42501");
    const adults = (await k.sql("select id from public.tracks where active and slug <> 'teens' order by sort limit 1"))[0].id;
    await call(admin, "set_track_active", [adults, false]);
    expect((await k.sql("select active from public.tracks where id = $1", [adults]))[0].active).toBe(false);
    await call(admin, "set_track_active", [adults, true]);
  });
});

describe("the weekly guides", () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    title: "Begin with the end in view, again",
    passage: "Habakkuk 2:2–3",
    sermon_series: "Faith that works",
    sermon_title: "Write it down",
    big_idea: "A goal you can see is a goal you can walk toward, so write it down tonight.",
    opening_question: "What made you say yes to this tribe?",
    questions: ["Which line excites you?", "What would make this season worth it?", "What is most likely to get in the way?"],
    practice: "Write your own goal in one sentence.",
    step_hint: "When I pick up my phone in the morning, I will read my goal aloud.",
    prayer: "Pray for each person's goal, one at a time.",
    confession: "I write the vision and make it plain, and I will run with it.",
    leader_tip: "Keep the first ten minutes warm and unhurried.",
    word_how: "Read the passage aloud, then ask one person to say why God tells us to write it down.",
    talk_how: "Read the draft Success Picture together and ask which line excites people most.",
    ...over,
  });

  it("shows the office all twelve and who has read each", async () => {
    await expectCode(call(coach, "admin_guides"), "42501");
    const list = await call(dataLead, "admin_guides");
    expect(list.can_edit).toBe(false);
    expect(list.guides).toHaveLength(12);
    expect(list.guides.every((g: Row) => g.reviewed_at === null)).toBe(true);
    expect((await call(pastor, "admin_guides")).can_edit).toBe(true);
    const one = await call(dataLead, "admin_guide", [1]);
    expect(one.questions).toHaveLength(3);
    expect(typeof one.word_how).toBe("string");
    await expectCode(call(dataLead, "admin_guide", [13]), "P0002");
  });

  it("saves an edit for every tribe at once, keeps the 75-minute shape, and marks it as read", async () => {
    await expectCode(call(coach, "save_week_guide", [1, edit()]), "42501");
    await expectCode(call(dataLead, "save_week_guide", [1, edit()]), "42501");
    const saved = await call(pastor, "save_week_guide", [1, edit()]);
    expect(saved.title).toBe("Begin with the end in view, again");
    expect(saved.sermon_title).toBe("Write it down");
    expect(saved.reviewed_by).toBeTruthy();
    const row = (await k.sql("select plan, questions, prayer, confession from public.week_guides where week = 1"))[0];
    expect(row.plan).toHaveLength(5);
    expect(row.plan.map((p: Row) => p.minutes)).toEqual([10, 15, 25, 15, 10]);
    expect(row.plan[1].how).toMatch(/^Read the passage aloud/);
    expect(row.plan[2].how).toMatch(/^Read the draft Success Picture/);
    expect(row.plan[4].how).toBe("Pray for each person's goal, one at a time.");
    expect(row.questions).toHaveLength(3);
  });

  it("explains what to fix in plain words", async () => {
    await expectCode(call(pastor, "save_week_guide", [1, edit({ title: "No" })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [1, edit({ questions: ["Only one", "and two"] })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [1, edit({ questions: ["Fine question one", "Fine question two", "x"] })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [1, edit({ confession: "Too short" })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [1, edit({ confession: "c".repeat(301) })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [1, edit({ sermon_series: "s".repeat(121) })]), "22023");
    await expectCode(call(pastor, "save_week_guide", [99, edit()]), "P0002");
    await expectCode(call(pastor, "save_week_guide", [1, null]), "22023");
    // A refused save changes nothing
    expect((await k.sql("select title from public.week_guides where week = 1"))[0].title).toBe("Begin with the end in view, again");
    // The sermon fields are optional
    const bare = await call(pastor, "save_week_guide", [2, edit({ sermon_series: "", sermon_title: "" })]);
    expect(bare.sermon_series).toBeNull();
    expect(bare.sermon_title).toBeNull();
  });

  it("lets the office mark a week as read as it stands", async () => {
    await expectCode(call(coach, "mark_guide_reviewed", [3]), "42501");
    const done = await call(director, "mark_guide_reviewed", [3]);
    expect(done.reviewed_at).toBeTruthy();
    expect(done.title).toBeTruthy();
    await expectCode(call(director, "mark_guide_reviewed", [0]), "P0002");
  });

  it("edits the community layer: a skill-share prompt per community and step ideas per goal, by phase", async () => {
    const layers = await call(dataLead, "admin_layers");
    expect(layers.can_edit).toBe(false);
    const community = layers.communities.find((t: Row) => t.name && t.goals.length > 0);
    expect(community.prompts).toHaveLength(3);
    const goal = community.goals[0];
    expect(goal.ideas).toHaveLength(3);

    await expectCode(call(dataLead, "save_community_prompt", [community.id, 1, "A prompt for the skill-share."]), "42501");
    await call(pastor, "save_community_prompt", [community.id, 2, "Share one habit that keeps you steady at work."]);
    await call(pastor, "save_goal_idea", [goal.id, 3, "Ask your manager for one honest piece of feedback."]);
    const after = await call(pastor, "admin_layers");
    const t2 = after.communities.find((t: Row) => t.id === community.id);
    expect(t2.prompts[1]).toBe("Share one habit that keeps you steady at work.");
    expect(t2.goals.find((g: Row) => g.id === goal.id).ideas[2]).toBe("Ask your manager for one honest piece of feedback.");

    await expectCode(call(pastor, "save_community_prompt", [community.id, 4, "A prompt in no phase at all."]), "22023");
    await expectCode(call(pastor, "save_community_prompt", [community.id, 1, "Short"]), "22023");
    await expectCode(call(pastor, "save_goal_idea", [goal.id, 0, "An idea in no phase at all."]), "22023");

    // Blank clears
    await call(pastor, "save_community_prompt", [community.id, 2, "  "]);
    await call(pastor, "save_goal_idea", [goal.id, 3, ""]);
    const cleared = await call(pastor, "admin_layers");
    expect(cleared.communities.find((t: Row) => t.id === community.id).prompts[1]).toBeNull();
  });
});

describe("people search, platform status and the launch checklist", () => {
  it("finds a person by part of their name or email, for the admin and directors only", async () => {
    const found = await call(admin, "find_people", ["pas"]);
    expect(found.map((p: Row) => p.id)).toContain(pastor.id);
    expect(found.find((p: Row) => p.id === pastor.id).roles).toContain("pastor");
    expect(await call(admin, "find_people", ["p"])).toEqual([]);
    expect(await call(director, "find_people", [pastor.email.slice(0, 6)])).toHaveLength(1);
    await expectCode(call(pastor, "find_people", ["pas"]), "42501");
    await expectCode(call(member, "find_people", ["pas"]), "42501");
  });

  it("shows the office the platform switches", async () => {
    await expectCode(call(coach, "platform_status"), "42501");
    const status = await call(dataLead, "platform_status");
    const keys = status.flags.map((f: Row) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["multi_centre", "teen_track"]));
    expect(status.flags.every((f: Row) => f.enabled === false)).toBe(true);
    expect(status.centres).toBe(1);
  });

  it("says what is still missing before a season can open, and clears each item as it is done", async () => {
    await expectCode(call(coach, "launch_checklist"), "42501");
    const item = (list: Row, key: string) => list.items.find((i: Row) => i.key === key);

    // A season that has not ended counts, whatever its status; the guides have not all been read
    const first = await call(admin, "launch_checklist");
    expect(first.items.map((i: Row) => i.key)).toEqual(["season", "team", "words", "guides", "tribes", "messages", "champions", "testimony_form", "bi"]);
    expect(item(first, "season").ok).toBe(true); // a season that has not ended counts
    expect(item(first, "team").missing).toEqual(["care_lead"]);
    expect(item(first, "words").ok).toBe(true);
    expect(item(first, "guides")).toMatchObject({ ok: false, reviewed: 3, of: 12 });
    expect(item(first, "tribes").ok).toBe(false);
    expect(item(first, "messages")).toMatchObject({ ok: false, tokens: 0 });
    expect(item(first, "champions")).toMatchObject({ ok: false, covered: 0 });
    expect(item(first, "testimony_form").ok).toBe(true);
    expect(item(first, "bi").ok).toBe(false);

    await k.staff("Care", "care_lead");
    for (let w = 1; w <= 12; w++) await call(pastor, "mark_guide_reviewed", [w]);
    await db.admin.query("insert into public.worker_tokens (label, token_hash, last_used_at) values ('Sender', 'x', now())");
    await call(admin, "bi_refresh");
    const communities = await k.sql("select id from public.communities where active");
    for (const t of communities) await call(admin, "assign_community_champion", [member.id, t.id]);
    const picked = (await k.sql("select id from public.seasons where name = $1", [item(first, "season").name]))[0].id;
    await k.tribe(picked, { name: "Ready" });

    const done = await call(admin, "launch_checklist");
    expect(done.items.every((i: Row) => i.ok === true)).toBe(true);
    expect(item(done, "tribes").approved).toBe(1);
  });
});
