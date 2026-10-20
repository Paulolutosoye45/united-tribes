import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kit as makeKit, type Kit } from "./builders";
import { createTestDb, expectCode, type Row, type TestDb } from "./helpers";

// Phase D: the whole catalogue. Its own database, because it signs off all 100 cards, community by community, and then looks at what
// that did to the goals, the weekly ideas, and what a member or a leader can read afterwards.

let db: TestDb;
let k: Kit;
let pastor: string;
let director: string;
let seasonId: string;
let fingerprintBefore: string;
const summary: Row[] = [];

const sql = async (text: string, params: unknown[] = []): Promise<Row[]> => (await db.admin.query(text, params)).rows;
const one = async (text: string, params: unknown[] = []): Promise<Row> => (await sql(text, params))[0];
const count = async (text: string, params: unknown[] = []): Promise<number> => (await one(text, params)).c as number;
const call = async (uid: string, fn: string, args: unknown[] = []) =>
  (await db.asUser(uid, (q) => q(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args))).rows[0]?.r;

// The 23 goals that exist today, with their ideas, as one fingerprint
const FINGERPRINT = `
  select md5(string_agg(x.line, E'\\n' order by x.line)) as f, count(*)::int as n
    from (
      select g.slug || '|' || g.title || '|' || g.community_id || '|' || g.family_id || '|' || g.sort || '|' || g.active || '|' ||
             coalesce((select string_agg(i.phase || ':' || i.idea, ';' order by i.phase) from public.goal_ideas i where i.season_goal_id = g.id), '') as line
        from public.season_goals g
       where g.id = any ($1::uuid[])) x`;
let originals: string[] = [];

beforeAll(async () => {
  db = await createTestDb();
  k = await makeKit(db);
  pastor = (await k.staff("Pastor", "pastor")).id;
  director = (await k.staff("Director", "director")).id;
  seasonId = (await one("select id from public.seasons where status in ('planning','open') order by starts_on limit 1")).id;
  originals = (await sql("select id from public.season_goals")).map((r) => r.id);
  fingerprintBefore = (await one(FINGERPRINT, [originals])).f;
});

afterAll(async () => {
  await db?.close();
});

describe("signing off community by community", () => {
  it("starts from 23 goals and 100 draft cards", async () => {
    expect(originals).toHaveLength(23);
    expect(await count("select count(*)::int c from public.season_goals")).toBe(23);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'draft'")).toBe(100);
  });

  it("signs off each community in one go, leaves the sensitive cards for one by one, and says how many", async () => {
    const communities = await sql("select id, slug from public.communities order by sort, slug");
    expect(communities).toHaveLength(11);
    let left = 0;
    for (const c of communities) {
      const r = await call(pastor, "card_template_sign_off_community", [c.id]);
      summary.push({ slug: c.slug, ...r });
      left += r.left_for_one_by_one as number;
    }
    expect(left).toBe(19);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'")).toBe(81);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status <> 'signed_off' and sensitive")).toBe(19);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status <> 'signed_off' and not sensitive")).toBe(0);
  });

  it("signs off the 19 sensitive cards one at a time, a director as well as a pastor", async () => {
    const sensitive = await sql("select slug from public.tribe_card_templates where sensitive and status <> 'signed_off' order by slug");
    expect(sensitive).toHaveLength(19);
    for (const [i, s] of sensitive.entries()) await call(i % 2 === 0 ? pastor : director, "card_template_sign_off", [s.slug]);
    expect(await count("select count(*)::int c from public.tribe_card_templates where status = 'signed_off'")).toBe(100);
  });

  it("refuses a bulk sign-off by anyone who is not a pastor or director", async () => {
    const admin = (await k.staff("Admin", "admin")).id;
    const c = (await one("select id from public.communities limit 1")).id;
    await expectCode(call(admin, "card_template_sign_off_community", [c]), "42501");
  });
});

describe("what the 100 signed-off cards made", () => {
  it("is 100 goals and exactly 3 weekly ideas for each", async () => {
    expect(await count("select count(*)::int c from public.season_goals")).toBe(100);
    expect(await count("select count(*)::int c from public.goal_ideas")).toBe(300);
    expect(await count("select count(*)::int c from public.season_goals g where (select count(*) from public.goal_ideas i where i.season_goal_id = g.id) <> 3")).toBe(0);
    expect((await sql("select distinct phase from public.goal_ideas order by phase")).map((r) => r.phase)).toEqual([1, 2, 3]);
    expect(await count("select count(*)::int c from public.tribe_card_templates where season_goal_id is null")).toBe(0);
  });

  it("has no more than ten goals in a community, and the titles and slugs are clean", async () => {
    const per = await sql("select community_id, count(*)::int n from public.season_goals group by community_id");
    expect(per).toHaveLength(11);
    expect(Math.max(...per.map((r) => r.n))).toBeLessThanOrEqual(10);
    expect(await count("select count(*)::int c from (select lower(title) from public.season_goals group by 1 having count(*) > 1) d")).toBe(0);
    expect(await count("select count(*)::int c from public.season_goals where char_length(slug) > 50 or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'")).toBe(0);
    expect(await count("select count(*)::int c from public.season_goals where active is not true")).toBe(0);
    expect(await count("select count(*)::int c from public.season_goals g join public.tribe_card_templates t on t.season_goal_id = g.id where g.title <> t.title or g.community_id <> t.community_id or g.family_id <> t.family_id")).toBe(0);
  });

  it("leaves the 23 goals that already existed exactly as they were, ideas and all", async () => {
    const after = await one(FINGERPRINT, [originals]);
    expect(after.n).toBe(23);
    expect(after.f).toBe(fingerprintBefore);
  });

  it("gives every goal a family that exists, and several goals share a family within a community", async () => {
    expect(await count("select count(*)::int c from public.season_goals g where not exists (select 1 from public.goal_families f where f.id = g.family_id)")).toBe(0);
    expect(await count("select count(*)::int c from (select community_id, family_id from public.season_goals group by 1, 2 having count(*) > 1) d")).toBeGreaterThan(0);
  });

  it("signs off again without making a second goal, and a second look changes nothing", async () => {
    const c = (await one("select id from public.communities where slug = 'consulting'")).id;
    const before = await one("select (select count(*)::int from public.season_goals) g, (select count(*)::int from public.goal_ideas) i");
    const r = await call(pastor, "card_template_sign_off_community", [c]);
    expect(r.signed).toEqual([]);
    expect(await one("select (select count(*)::int from public.season_goals) g, (select count(*)::int from public.goal_ideas) i")).toEqual(before);
  });
});

describe("every card is a real option for some leader", () => {
  it("is offered to at least one life stage, and its demand numbers make a usable score", async () => {
    expect(await count("select count(*)::int c from public.tribe_card_templates where cardinality(track_slugs) = 0")).toBe(0);
    expect(await count("select count(*)::int c from public.tribe_card_templates where demand_structure + demand_connection + demand_teaching + demand_doing = 0")).toBe(0);
    const tracks = (await sql("select slug from public.tracks where active")).map((r) => r.slug);
    for (const t of tracks) {
      const offered = await count("select count(*)::int c from public.tribe_card_templates where $1 = any (track_slugs)", [t]);
      expect(offered, `cards for ${t}`).toBeGreaterThan(10);
    }
  });

  it("reaches the engine: with a model approved, a builder is offered a long list across every community", async () => {
    await call(pastor, "leader_fit_model_activate", ["lf-1"]);
    const rows = await sql(
      "select distinct community_slug from public.leader_fit_options($1::jsonb)",
      [JSON.stringify({ track: "builders", community: "professionals", goal: null, relation: null, lead_best: "doing", judgement: 80, care: 100 })],
    );
    expect(rows).toHaveLength(11);
  });
});

describe("what a member or a leader can read afterwards", () => {
  let member: string;
  let leader: string;
  let tribe: string;
  let hidden: string[];
  const text = (v: unknown) => JSON.stringify(v);

  beforeAll(async () => {
    // The words only the pastorate sees: who leads this well, and the demand numbers
    hidden = (await sql("select who_leads_well from public.tribe_card_templates")).map((r) => r.who_leads_well as string);
    const t = await k.tribe(seasonId, { community: "consulting" });
    const g = await one("select g.id, g.community_id from public.season_goals g join public.tribe_card_templates c on c.season_goal_id = g.id where c.slug = 'price-and-package-my-expertise'");
    await db.admin.query("update public.tribes set season_goal_id = $2, community_id = $3 where id = $1", [t.tribe, g.id, g.community_id]);
    tribe = t.tribe;
    leader = t.leader.id;
    member = (await k.seat(tribe, seasonId, "Seated", { profile: { community: "consulting" } })).id;
  });

  it("lets a member read the goals, and nothing the pastorate keeps to itself", async () => {
    const goals = (await db.asUser(member, (q) => q("select * from public.season_goals"))).rows;
    expect(goals).toHaveLength(100);
    expect(await count("select count(*)::int c from public.goal_ideas")).toBe(300);
    for (const col of ["demand", "sensitive", "who_leads_well", "status", "signed_off_by"]) {
      expect(Object.keys(goals[0]).some((c) => c.includes(col)), col).toBe(false);
    }
    await expectCode(db.asUser(member, (q) => q("select * from public.tribe_card_templates")), "42501");
    await expectCode(db.asAnon((q) => q("select * from public.tribe_card_templates")), "42501");
  });

  it("shows a member their matches, their match and their week without the hidden words", async () => {
    const seeker = await k.person("Seeker");
    await k.profile(seeker.id, seasonId, { community: "consulting" });
    await db.admin.query("update public.tribes set status = 'approved' where id = $1", [tribe]);
    const matches = text(await call(seeker.id, "match_me"));
    expect(matches.length).toBeGreaterThan(50);
    for (const h of hidden) expect(matches.includes(h), "hidden text in match_me").toBe(false);
    expect(matches).not.toMatch(/demand_|who_leads_well|sensitive/);
    for (const [who, fn] of [[member, "my_match"], [member, "my_week"], [seeker.id, "my_match"]] as const) {
      const out = text(await call(who, fn));
      for (const h of hidden) expect(out.includes(h), `hidden text in ${fn}`).toBe(false);
      expect(out).not.toMatch(/demand_|who_leads_well|sensitive/);
    }
  });

  it("shows a leader the ready-made card's public parts and not the hidden ones", async () => {
    const seen = text(await call(leader, "card_template_for_tribe", [tribe]));
    expect(seen).toContain("Price and package my expertise");
    for (const h of hidden) expect(seen.includes(h), "hidden text in the leader's card").toBe(false);
    expect(seen).not.toMatch(/demand_|who_leads_well|sensitive/);
    const mine = text(await call(leader, "my_tribe"));
    for (const h of hidden) expect(mine.includes(h), "hidden text in the leader's tribe").toBe(false);
  });

  it("never lets the leader's button overwrite what they have written", async () => {
    const d = await k.tribe(seasonId, { community: "consulting", status: "draft" });
    const g = await one("select g.id, g.community_id from public.season_goals g join public.tribe_card_templates c on c.season_goal_id = g.id where c.slug = 'price-and-package-my-expertise'");
    await db.admin.query("update public.tribes set season_goal_id = $2, community_id = $3, loving_god = 'Our own words for loving God.', loving_others = null, loving_life = null where id = $1", [d.tribe, g.id, g.community_id]);
    const r = await call(d.leader.id, "card_template_prefill", [d.tribe]);
    expect(r.filled).toBe(true);
    const t = await one("select loving_god, loving_others from public.tribes where id = $1", [d.tribe]);
    expect(t.loving_god).toBe("Our own words for loving God.");
    expect(t.loving_others).toBe((await one("select loving_others from public.tribe_card_templates where slug = 'price-and-package-my-expertise'")).loving_others);
  });

  it("lets only the pastorate read the whole card", async () => {
    const list = await call(pastor, "card_template_list");
    expect(list.templates).toHaveLength(100);
    expect(list.templates[0]).toHaveProperty("who_leads_well");
    await expectCode(call(leader, "card_template_list"), "42501");
    await expectCode(call(member, "card_template_list"), "42501");
  });
});
