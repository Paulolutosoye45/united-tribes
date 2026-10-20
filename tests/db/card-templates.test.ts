import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase 4: the Tribe Card catalogue. 100 reviewed cards are loaded as drafts (23 for goals that already exist, 77 for goals that do not
// yet). Nothing here creates a goal until a pastor or director signs a card off, and every edit takes a signed card back to draft.
// The test that signs off all 100 has its own file and its own database (card-templates-all.test.ts).

let db: TestDb;
let pastor: string;
let director: string;
let admin: string;
let member: string;
let leader: string;
let leader2: string;

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0].r;
const person = async (name: string, ...roles: string[]) => {
  const u = await db.createUser();
  await db.admin.query("update public.people set full_name = $2, preferred_name = $2 where id = $1", [u.id, name]);
  for (const r of roles) await db.grant(u.id, r);
  return u.id;
};

const S = "validate-my-idea-with-real-customers"; // a new goal's card
const L = "launch-or-formalise-a-business"; // a live goal's card

beforeAll(async () => {
  db = await createTestDb();
  pastor = await person("Pastor", "pastor");
  director = await person("Director", "director");
  admin = await person("Admin", "admin");
  member = await person("Member");
  leader = await person("Leader", "leader");
  leader2 = await person("Leader2", "leader");
});

afterAll(async () => {
  await db?.close();
});

describe("after the load", () => {
  it("holds 100 draft cards, 23 of them linked to the goals that already exist", async () => {
    expect(await count("select count(*)::int c from public.tribe_card_templates")).toBe(100);
    expect(await count("select count(*)::int c from public.tribe_card_templates where season_goal_id is not null")).toBe(23);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'draft'")).toBe(100);
    expect(await count("select count(*)::int c from public.tribe_card_templates where sensitive")).toBe(19);
  });

  it("creates no goal and touches no weekly idea", async () => {
    expect(await count("select count(*)::int c from public.season_goals")).toBe(23);
    expect(await count("select count(*)::int c from public.goal_ideas")).toBe(69);
  });

  it("gives the 23 cards the weekly ideas the migrated database holds today, word for word", async () => {
    const mismatched = await sql(
      `select t.slug from public.tribe_card_templates t join public.season_goals g on g.id = t.season_goal_id
        where t.arc_1 <> (select idea from public.goal_ideas where season_goal_id = g.id and phase = 1)
           or t.arc_2 <> (select idea from public.goal_ideas where season_goal_id = g.id and phase = 2)
           or t.arc_3 <> (select idea from public.goal_ideas where season_goal_id = g.id and phase = 3)`,
    );
    expect(mismatched).toEqual([]);
  });

  it("gives every card a leadership profile that is not flat-zero, and 1 to 3 life stages that exist", async () => {
    expect(await count("select count(*)::int c from public.tribe_card_templates where demand_structure + demand_connection + demand_teaching + demand_doing = 0")).toBe(0);
    expect(await count("select count(*)::int c from public.tribe_card_templates t where exists (select 1 from unnest(t.track_slugs) s where s not in (select slug from public.tracks where active))")).toBe(0);
    // Every card has something to compare on Style
    expect(await count("select count(*)::int c from public.tribe_card_templates where demand_structure = demand_connection and demand_connection = demand_teaching and demand_teaching = demand_doing")).toBe(0);
  });
});

describe("who can reach the catalogue", () => {
  it("is closed to every client role as a table", async () => {
    await expectCode(db.asUser(member, (q) => q("select * from public.tribe_card_templates")), "42501");
    await expectCode(db.asUser(pastor, (q) => q("select * from public.tribe_card_templates")), "42501");
    await expectCode(db.asAnon((q) => q("select * from public.tribe_card_templates")), "42501");
  });

  it("is closed to members, leaders and visitors as a list", async () => {
    await expectCode(call(member, "card_template_list"), "42501");
    await expectCode(call(leader, "card_template_list"), "42501");
    await expectCode(db.asAnon((q) => q("select public.card_template_list()")), "42501");
  });

  it("keeps the internal functions out of every client's reach", async () => {
    await expectCode(db.asUser(pastor, (q) => q("select public.card_template_activate('x', $1)", [pastor])), "42501");
    await expectCode(db.asUser(pastor, (q) => q("select public.card_template_fill($1)", [pastor])), "42501");
  });

  it("lets the admin read and edit the words but not sign off, retire or sign in bulk", async () => {
    await expectCode(call(admin, "card_template_sign_off", [S]), "42501");
    await expectCode(call(admin, "card_template_retire", [S]), "42501");
    const community = (await one("select id from public.communities where slug = 'business-entrepreneurship'")).id;
    await expectCode(call(admin, "card_template_sign_off_community", [community]), "42501");
    expect((await call(admin, "card_template_list")).templates.length).toBe(100);
  });

  it("shows a pastor all 100 drafts with the hidden fields", async () => {
    const list = await call(pastor, "card_template_list");
    expect(list.templates).toHaveLength(100);
    expect(list.counts).toMatchObject({ total: 100, draft: 100, signed_off: 0, retired: 0 });
    expect(list.templates[0]).toHaveProperty("demand");
    expect(list.templates[0]).toHaveProperty("sensitive");
    expect(list.templates[0]).toHaveProperty("who_leads_well");
    // A count for the sign-off screen, community by community
    expect(list.by_community).toHaveLength(11);
    expect(list.by_community.reduce((n: number, c: Row) => n + c.total, 0)).toBe(100);
    expect(list.by_community.reduce((n: number, c: Row) => n + c.sensitive_left, 0)).toBe(19);
  });
});

describe("saving a card", () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ loving_god: "x".repeat(201) }, "a line over 200 characters"],
    [{ arc_1: "x".repeat(301) }, "a weekly idea over 300 characters"],
    [{ demand_structure: 4 }, "a demand of 4"],
    [{ demand_structure: -1 }, "a demand below 0"],
    [{ demand_doing: 1.5 }, "a demand that is not whole"],
    [{ demand_doing: "2" }, "a demand written as text"],
    [{ demand_structure: 0, demand_connection: 0, demand_teaching: 0, demand_doing: 0 }, "all four demands at zero"],
    [{ foo: 1 }, "an unknown field"],
    [{ track_slugs: ["nope"] }, "an unknown life stage"],
    [{ track_slugs: ["teens"] }, "a life stage that is switched off"],
    [{ track_slugs: [] }, "no life stage"],
    [{ rhythm_slot: "monday" }, "a meeting time that does not exist"],
    [{ rhythm_mode: "hybrid" }, "a mode that does not exist"],
    [{ sensitive: "yes" }, "a sensitive flag that is not true or false"],
    [{ who_for: "short" }, "a line that is too short"],
    [{}, "nothing at all"],
  ];
  for (const [fields, label] of bad) {
    it(`refuses ${label}`, async () => {
      await expectCode(call(pastor, "card_template_save", [S, JSON.stringify(fields)]), "22023");
    });
  }

  it("refuses a card that does not exist", async () => {
    await expectCode(call(pastor, "card_template_save", ["no-such-card", JSON.stringify({ sensitive: true })]), "P0002");
  });

  it("will not rename a card whose goal exists", async () => {
    await expectCode(call(pastor, "card_template_save", [L, JSON.stringify({ title: "Another title here" })]), "22023");
  });

  it("adds one to the version on a good save", async () => {
    const v1 = (await one("select version from public.tribe_card_templates where slug = $1", [S])).version;
    await call(pastor, "card_template_save", [S, JSON.stringify({ who_for: "Anyone with a business idea who has not yet asked the people who would pay for it, at any stage." })]);
    expect((await one("select version from public.tribe_card_templates where slug = $1", [S])).version).toBe(v1 + 1);
  });
});

describe("signing off", () => {
  let goalId: string;
  const newArc = "Write the problem your idea solves and who has it. List thirty people who fit and book eight short conversations.";

  it("makes exactly one goal and its three ideas for a new card", async () => {
    const before = { goals: await count("select count(*)::int c from public.season_goals"), ideas: await count("select count(*)::int c from public.goal_ideas") };
    const r = await call(pastor, "card_template_sign_off", [S]);
    expect(r.new_goal).toBe(true);
    const g = await one("select * from public.season_goals where slug = $1", [S]);
    goalId = g.id;
    expect(g.active).toBe(true);
    expect(g.sort).toBe(3); // the card's own position, so the first goal in each community is still the same one
    const t = await one("select * from public.tribe_card_templates where slug = $1", [S]);
    const ideas = await sql("select phase, idea from public.goal_ideas where season_goal_id = $1 order by phase", [g.id]);
    expect(ideas.map((i) => i.idea)).toEqual([t.arc_1, t.arc_2, t.arc_3]);
    expect(t.status).toBe("signed_off");
    expect(t.season_goal_id).toBe(g.id);
    expect(t.signed_off_by).toBe(pastor);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(before.goals + 1);
    expect(await count("select count(*)::int c from public.goal_ideas")).toBe(before.ideas + 3);
  });

  it("changes nothing the second time and writes no second event", async () => {
    const goals = await count("select count(*)::int c from public.season_goals");
    const r = await call(director, "card_template_sign_off", [S]);
    expect(r.already).toBe(true);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(goals);
    expect(await count("select count(*)::int c from public.event_log where action = 'card_template.signed_off' and entity_id = $1", [S])).toBe(1);
  });

  it("takes the card back to draft on any edit, keeps the goal on and leaves the ideas until the next sign-off", async () => {
    const r = await call(pastor, "card_template_save", [S, JSON.stringify({ arc_1: newArc })]);
    expect(r.status).toBe("draft");
    const t = await one("select * from public.tribe_card_templates where slug = $1", [S]);
    expect(t.signed_off_by).toBeNull();
    expect(t.signed_off_at).toBeNull();
    expect((await one("select active from public.season_goals where slug = $1", [S])).active).toBe(true);
    expect((await one("select idea from public.goal_ideas where season_goal_id = $1 and phase = 1", [goalId])).idea).not.toBe(newArc);
    await call(director, "card_template_sign_off", [S]);
    expect((await one("select idea from public.goal_ideas where season_goal_id = $1 and phase = 1", [goalId])).idea).toBe(newArc);
  });

  it("makes no goal and leaves the ideas alone for a card whose goal already exists", async () => {
    const goalCount = await count("select count(*)::int c from public.season_goals");
    const before = await sql("select idea from public.goal_ideas where season_goal_id = (select id from public.season_goals where slug = $1) order by phase", [L]);
    const r = await call(pastor, "card_template_sign_off", [L]);
    expect(r.new_goal).toBe(false);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(goalCount);
    const after = await sql("select idea from public.goal_ideas where season_goal_id = (select id from public.season_goals where slug = $1) order by phase", [L]);
    expect(after).toEqual(before);
  });

  it("switches the goal off on retire, allows retiring twice, and brings it back on the next sign-off", async () => {
    await call(director, "card_template_retire", [S]);
    expect((await one("select active from public.season_goals where slug = $1", [S])).active).toBe(false);
    expect((await one("select status from public.tribe_card_templates where slug = $1", [S])).status).toBe("retired");
    expect((await call(director, "card_template_retire", [S])).status).toBe("retired");
    await call(pastor, "card_template_sign_off", [S]);
    expect((await one("select active from public.season_goals where slug = $1", [S])).active).toBe(true);
  });

  it("leaves a goal the catalogue switched off alone and says why", async () => {
    await db.admin.query("update public.season_goals set active = false where slug = 'strengthen-our-marriage'");
    await expect(call(pastor, "card_template_sign_off", ["strengthen-our-marriage"])).rejects.toThrow(/switched off in the catalogue/);
    await db.admin.query("update public.season_goals set active = true where slug = 'strengthen-our-marriage'");
  });
});

describe("collisions", () => {
  it("refuses a title the community already uses under another web name", async () => {
    const community = (await one("select id from public.communities where slug = 'business-entrepreneurship'")).id;
    const family = (await one("select id from public.goal_families where slug = 'enterprise'")).id;
    await db.admin.query("insert into public.season_goals (community_id, family_id, slug, title, sort) values ($1, $2, 'my-own-hire-goal', 'Hire and manage my first employee', 50)", [community, family]);
    await expect(call(pastor, "card_template_sign_off", ["hire-and-manage-my-first-employee"])).rejects.toThrow(/already has a goal with that title/);
    await db.admin.query("delete from public.season_goals where slug = 'my-own-hire-goal'");
  });

  it("refuses a web name another community uses", async () => {
    const consulting = (await one("select id from public.communities where slug = 'consulting'")).id;
    const family = (await one("select id from public.goal_families where slug = 'enterprise'")).id;
    await db.admin.query("insert into public.season_goals (community_id, family_id, slug, title, sort) values ($1, $2, 'raise-capital-or-a-grant', 'Something else entirely', 50)", [consulting, family]);
    await expect(call(pastor, "card_template_sign_off", ["raise-capital-or-a-grant"])).rejects.toThrow(/another community/);
    await db.admin.query("delete from public.season_goals where slug = 'raise-capital-or-a-grant'");
  });

  it("adopts a goal with the card's own web name and community instead of making a second one", async () => {
    const community = (await one("select id from public.communities where slug = 'business-entrepreneurship'")).id;
    const family = (await one("select id from public.goal_families where slug = 'enterprise'")).id;
    await db.admin.query(
      "insert into public.season_goals (community_id, family_id, slug, title, sort) values ($1, $2, 'register-my-business-and-open-a-business-account', 'Register my business and open a business account', 7)",
      [community, family],
    );
    const goals = await count("select count(*)::int c from public.season_goals");
    const r = await call(pastor, "card_template_sign_off", ["register-my-business-and-open-a-business-account"]);
    expect(r.new_goal).toBe(false);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(goals);
    expect(await count("select count(*)::int c from public.goal_ideas where season_goal_id = $1", [r.goal_id])).toBe(3);
  });
});

describe("the hidden owner", () => {
  it("never appears as the signer, and the action goes to the owner-only log", async () => {
    const owner = await person("Owner", "pastor");
    await db.admin.query("update public.people set hidden = true where id = $1", [owner]);
    const events = await count("select count(*)::int c from public.event_log where actor_id = $1", [owner]);
    const god = await count("select count(*)::int c from public.god_log");
    await call(owner, "card_template_sign_off", ["price-my-offer-and-stop-undercharging"]);
    expect(await count("select count(*)::int c from public.event_log where actor_id = $1", [owner])).toBe(events);
    expect(await count("select count(*)::int c from public.god_log")).toBe(god + 1);
    const list = await call(pastor, "card_template_list");
    const bySlug = (slug: string) => list.templates.find((t: Row) => t.slug === slug);
    expect(bySlug("price-my-offer-and-stop-undercharging").status).toBe("signed_off");
    expect(bySlug("price-my-offer-and-stop-undercharging").signed_off_by).toBeNull();
    expect(bySlug(S).signed_off_by).toBe("Pastor");
  });
});

describe("signing off a whole community", () => {
  it("leaves the sensitive cards for one-by-one sign-off and says how many", async () => {
    const community = (await one("select id from public.communities where slug = 'marriage-relationships'")).id;
    const sensitive = await count("select count(*)::int c from public.tribe_card_templates where community_id = $1 and status <> 'signed_off' and sensitive", [community]);
    const r = await call(pastor, "card_template_sign_off_community", [community]);
    expect(sensitive).toBeGreaterThan(0);
    expect(r.left_for_one_by_one).toBe(sensitive);
    expect(await count("select count(*)::int c from public.tribe_card_templates where community_id = $1 and sensitive and status = 'signed_off'", [community])).toBe(0);
    expect(await count("select count(*)::int c from public.tribe_card_templates where community_id = $1 and not sensitive and status <> 'signed_off'", [community])).toBe(0);
  });

  it("refuses an unknown community", async () => {
    await expectCode(call(pastor, "card_template_sign_off_community", ["00000000-0000-0000-0000-000000000000"]), "22023");
  });

  it("is all or nothing, and the message names the card that failed", async () => {
    await db.admin.query("update public.tribe_card_templates set track_slugs = array['nope'] where slug = 'build-a-consistent-creative-practice'");
    const community = (await one("select id from public.communities where slug = 'creative-economy'")).id;
    const goals = await count("select count(*)::int c from public.season_goals");
    const signed = await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'");
    await expect(call(pastor, "card_template_sign_off_community", [community])).rejects.toThrow(/Build a consistent creative practice/);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(goals);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'")).toBe(signed);
    await db.admin.query("update public.tribe_card_templates set track_slugs = array['rising', 'builders', 'stewards'] where slug = 'build-a-consistent-creative-practice'");
  });
});

describe("the leader's view and the ready-made card", () => {
  let tribe: string;
  const W = "win-my-first-ten-paying-customers";

  it("shows a leader the public fields only, never the hidden profile", async () => {
    await call(pastor, "card_template_sign_off", [W]);
    const season = (await one("select id from public.seasons order by starts_on limit 1")).id;
    const goal = (await one("select id from public.season_goals where slug = $1", [W])).id;
    const community = (await one("select id from public.communities where slug = 'business-entrepreneurship'")).id;
    tribe = (await one("insert into public.tribes (season_id, leader_id, community_id, season_goal_id, status) values ($1, $2, $3, $4, 'draft') returning id", [season, leader, community, goal])).id;
    const view = await call(leader, "card_template_for_tribe", [tribe]);
    expect(Object.keys(view)).toEqual(expect.arrayContaining(["title", "who_for", "arc", "guardrail", "rhythm_slot"]));
    expect(Object.keys(view).filter((k) => /demand|sensitive|leads|signed/.test(k))).toEqual([]);
    expect(JSON.stringify(view)).not.toMatch(/who_leads_well|demand_|sensitive/);
  });

  it("turns away another leader and a member (the empty assistant never lets anyone through)", async () => {
    await expectCode(call(leader2, "card_template_for_tribe", [tribe]), "P0002");
    await expectCode(call(member, "card_template_for_tribe", [tribe]), "P0002");
  });

  it("gives nothing for a retired card", async () => {
    await call(pastor, "card_template_retire", [W]);
    expect(await call(leader, "card_template_for_tribe", [tribe])).toBeNull();
    await call(pastor, "card_template_sign_off", [W]);
  });

  it("copies the three lines into empty lines and never overwrites the leader's words", async () => {
    const r = await call(leader, "card_template_prefill", [tribe]);
    const t = await one("select * from public.tribes where id = $1", [tribe]);
    const card = await one("select * from public.tribe_card_templates where slug = $1", [W]);
    expect(r.filled).toBe(true);
    expect([t.loving_god, t.loving_others, t.loving_life]).toEqual([card.loving_god, card.loving_others, card.loving_life]);
    await db.admin.query("update public.tribes set loving_god = 'My own words for loving God here.' where id = $1", [tribe]);
    await call(leader, "card_template_prefill", [tribe]);
    expect((await one("select loving_god from public.tribes where id = $1", [tribe])).loving_god).toBe("My own words for loving God here.");
  });

  it("refuses another leader, and a card that is closed", async () => {
    await expectCode(call(leader2, "card_template_prefill", [tribe]), "P0002");
    await db.admin.query("update public.tribes set status = 'closed' where id = $1", [tribe]);
    await expectCode(call(leader, "card_template_prefill", [tribe]), "22023");
  });
});

describe("a goal made in the catalogue", () => {
  const full = {
    who_for: "Farmers who want to run a small farm with care and keep honest books.",
    loving_god: "We thank God for the soil and ask Him for wisdom with each season.",
    loving_others: "We share tools, advice and good seed with one another.",
    loving_life: "By week 12 each of us has a written plan for the season, a simple record of costs and one new method tried.",
    week12_outcome: "A written plan for the season, a record of costs and one new method tried.",
    arc_1: "Write down what your farm grows and what it costs you each month.",
    arc_2: "Try one new method on a small plot and note what changes.",
    arc_3: "Plan the next season with what you learned and share it with the tribe.",
    guardrail: "Leaders do not give agricultural, legal or financial advice. They point to qualified people.",
    track_slugs: ["builders", "stewards"],
    rhythm_slot: "weeknight-evening",
    rhythm_mode: "online",
    who_leads_well: "Has farmed or worked the land, and is honest about hard seasons.",
    demand_structure: 2,
    demand_connection: 1,
    demand_teaching: 2,
    demand_doing: 3,
    sensitive: false,
  };
  let goalId: string;

  it("needs every field to make a card for it", async () => {
    const community = (await one("select id from public.communities where slug = 'business-entrepreneurship'")).id;
    const family = (await one("select id from public.goal_families where slug = 'enterprise'")).id;
    goalId = (await one("insert into public.season_goals (community_id, family_id, slug, title, sort) values ($1, $2, 'run-a-small-farm-well', 'Run a small farm well', 90) returning id", [community, family])).id;
    await expectCode(call(pastor, "card_template_create_for_goal", [goalId, JSON.stringify({ who_for: "Farmers" })]), "22023");
  });

  it("makes the card as a draft, once", async () => {
    expect((await call(pastor, "card_template_create_for_goal", [goalId, JSON.stringify(full)])).status).toBe("draft");
    await expectCode(call(pastor, "card_template_create_for_goal", [goalId, JSON.stringify(full)]), "22023");
  });

  it("adds no goal when signed off, and writes the three ideas", async () => {
    const goals = await count("select count(*)::int c from public.season_goals");
    await call(pastor, "card_template_sign_off", ["run-a-small-farm-well"]);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(goals);
    expect(await count("select count(*)::int c from public.goal_ideas where season_goal_id = $1", [goalId])).toBe(3);
  });

  it("will not sign off a card that still has placeholder text", async () => {
    await db.admin.query("update public.tribe_card_templates set status = 'draft', loving_god = 'To be written by the pastorate' where slug = 'run-a-small-farm-well'");
    await expect(call(pastor, "card_template_sign_off", ["run-a-small-farm-well"])).rejects.toThrow(/not been written/);
  });
});
