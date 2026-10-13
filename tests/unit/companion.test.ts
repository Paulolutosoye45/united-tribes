import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOAL_AFFINITY,
  COMMUNITY_AFFINITY,
  blend,
  buildProfile,
  finalize,
  outcomeSentences,
  pickBaseline,
  pickFaith,
  pickHeard,
  pickMode,
  pickRoles,
  pickServing,
  pickStyle,
  rankGoals,
  rankCommunities,
  starterSentences,
  type ProfileInput,
} from "@/lib/companion";
import { readText } from "@/lib/companion/lexicon";
import { suggestTimes } from "@/lib/intake/times";

const COMMUNITIES = [
  ["business-entrepreneurship", "Business & Entrepreneurship", "People starting, running or growing a business."],
  ["professionals", "Professionals", "Employed professionals shaping a career and a calling."],
  ["consulting", "Consulting", "Independent consultants, advisers and freelancers who sell their expertise."],
  ["in-between-jobs", "In-between Jobs", "People between roles who want company, structure and a next step."],
  ["global-citizens", "Global Citizens", "People living abroad, returning home or holding family together across borders."],
  ["marriage-relationships", "Marriage & Relationships", "Married couples, people preparing for marriage and people rebuilding after loss."],
  ["parents-family", "Parents & Family", "Parents and carers building a faith-filled home."],
  ["health-fitness-sports", "Health, Fitness & Sports", "People building strength, health and discipline together."],
  ["education", "Education", "Students, teachers and lecturers."],
  ["medical-healthcare", "Medical & Healthcare", "Doctors, nurses, pharmacists and health workers."],
  ["creative-economy", "Creative Economy", "Musicians, designers, writers, filmmakers and other makers."],
].map(([id, name, description]) => ({ id, name, description }));

const communitiesFor = (input: ProfileInput) => finalize(rankCommunities(buildProfile(input), COMMUNITIES), "sure", { singles: true });
const traits = (story: string) => readText(story).map((h) => h.trait);

describe("reading a story", () => {
  it("hears the four example stories the form offers", () => {
    expect(traits("I just lost my job and I'm trusting God for the next door.")).toContain("between_jobs");
    expect(traits("I run a small business and I'm tired of doing it alone.")).toEqual(expect.arrayContaining(["self_employed", "t_grow"]));
    expect(traits("We have three children and our home needs a better rhythm.")).toEqual(expect.arrayContaining(["c_some", "t_home"]));
    expect(traits("I'm a student and I want friends who love God.")).toContain("student");
  });

  it("hears a shop or business described in a few words, and not a programme run at work", () => {
    expect(traits("I run a small provisions shop in Surulere and I'm a mother of two toddlers.")).toEqual(expect.arrayContaining(["self_employed", "f_trade_retail", "c_under_12"]));
    expect(traits("We own a small online fashion boutique.")).toContain("self_employed");
    // "My company" may be the employer: only a faint hint, never enough to be filled in.
    expect(readText("I run a programme at my company for new staff.").find((h) => h.trait === "self_employed")?.weight ?? 0).toBeLessThan(2.4);
    expect(traits("I run a Sunday school class at church.")).not.toContain("self_employed");
    expect(traits("I have a cousin at the school.")).not.toContain("self_employed");
  });

  it("hears “in tech” as the technology field", () => {
    expect(traits("I work in tech in Toronto and I miss home.")).toEqual(expect.arrayContaining(["f_tech", "t_abroad"]));
  });

  it("hears Nigerian English and Pidgin", () => {
    expect(traits("Just finished NYSC, now job hunting.")).toContain("between_jobs");
    expect(traits("I dey do small small business for Surulere, sell provisions.")).toEqual(expect.arrayContaining(["self_employed", "f_trade_retail"]));
    expect(traits("My husband and I get two pikin.")).toEqual(expect.arrayContaining(["married", "c_under_12"]));
    expect(traits("I dey work for bank.")).toContain("employed");
    expect(traits("I want to japa next year")).toContain("t_abroad");
    expect(traits("I am a corper serving in Kano")).toContain("nysc");
  });

  it("treats a wish as a wish, not a fact", () => {
    const wish = traits("I want to start a business and hope to get married next year.");
    expect(wish).toContain("t_launch");
    expect(wish).not.toContain("self_employed");
    expect(wish).not.toContain("married");
    expect(traits("I'm getting married in June")).not.toContain("married");
    expect(traits("I'm getting married in June")).toContain("engaged");
    expect(traits("We got married last year")).toContain("married");
  });

  it("does not count what is said to be untrue", () => {
    expect(traits("I'm not looking for a job right now")).not.toContain("between_jobs");
    const past = buildProfile({ story: "I was married for ten years but I am not married now" });
    expect(past.fact("married")).toBeUndefined();
    expect(past.fact("single")).toBeUndefined();
    expect(traits("I do not work in a bank")).not.toContain("employed");
  });

  it("does not mistake near-misses", () => {
    expect(traits("I am a nurse at a teaching hospital")).not.toContain("f_education");
    expect(traits("My consultant doctor said")).not.toContain("consultant");
    expect(traits("I'm a software engineer")).not.toContain("f_engineering_trades");
    expect(traits("I lost my job in March")).not.toContain("employed");
    expect(traits("I finished NYSC last year")).not.toContain("nysc");
  });

  it("keeps the words that were heard, short and as the person wrote them", () => {
    const hit = readText("We live in Yaba. I work in a bank on the Island.").find((h) => h.trait === "employed");
    expect(hit?.quote).toBe("I work in a bank");
    const long = readText("I have been looking for a new job for a very long time now and it is hard").find((h) => h.trait === "between_jobs");
    expect((long?.quote.length ?? 0) <= 40).toBe(true);
  });

  it("hears nothing in nothing", () => {
    expect(readText("")).toEqual([]);
    expect(readText("ok")).toEqual([]);
    expect(readText("I want to grow in my faith and be around people who pray.").filter((h) => h.weight >= 2.4)).toEqual([]);
  });
});

describe("what the Companion knows", () => {
  it("never lets an age-group guess beat a word the person wrote", () => {
    const p = buildProfile({ ageRange: "60-plus", story: "I just lost my job." });
    expect(p.strength("between_jobs")).toBeGreaterThan(p.strength("retired"));
    expect(p.fact("retired")?.source).toBe("prior");
  });

  it("does not show a guess from the age group as something it picked up", () => {
    const p = buildProfile({ ageRange: "33-40", ageLabel: "33–40" });
    expect(p.chips()).toEqual([]);
    expect(p.depth).toBe(0);
    expect(buildProfile({ ageRange: "33-40", story: "I'm a student and a pastor's wife" }).depth).toBeGreaterThan(0);
  });

  it("lets a tap override what was read, within the same question", () => {
    const p = buildProfile({ story: "I work in a bank.", answers: { workStatus: "self_employed", workField: "tech" } });
    expect(p.fact("employed")).toBeUndefined();
    expect(p.fact("f_finance")).toBeUndefined();
    expect(p.fact("self_employed")?.source).toBe("answer");
    expect(p.fact("f_tech")?.source).toBe("answer");
  });

  it("stops using what the person says is not them, but a direct answer still counts", () => {
    const base = { story: "I work in a bank. Married with two small kids." };
    const p = buildProfile({ ...base, dismissed: ["employed", "c_under_12"] });
    expect(p.fact("employed")).toBeUndefined();
    expect(p.fact("c_under_12")).toBeUndefined();
    expect(p.fact("married")).toBeDefined();
    expect(buildProfile({ ...base, dismissed: ["employed"], answers: { workStatus: "employed" } }).fact("employed")?.source).toBe("answer");
  });

  it("listens less to words that led to a pick the person turned down", () => {
    const base = { story: "I run a small business and I also work in a bank." };
    const before = buildProfile(base).strength("self_employed");
    const after = buildProfile({ ...base, discount: { self_employed: 0.5 } }).strength("self_employed");
    expect(after).toBeCloseTo(before * 0.5, 5);
  });

  it("treats grown children as grown, not as a parenting season", () => {
    const p = buildProfile({ story: "Our children are grown and I mentor young women." });
    expect(p.fact("t_parenting")).toBeUndefined();
    expect(p.fact("c_adult")).toBeDefined();
  });

  it("never turns something painful into a chip, a quote or a pre-selected answer", () => {
    const p = buildProfile({ story: "My marriage ended last year and I'm rebuilding after my divorce." });
    expect(p.chips().map((c) => c.label)).not.toContain("Marriage");
    expect(p.chips().some((c) => /divorc|rebuild|ended/i.test(`${c.label} ${c.quote ?? ""}`))).toBe(false);
    const ranked = finalize(rankCommunities(p, COMMUNITIES), "sure", { singles: true });
    expect(ranked[0].id).toBe("marriage-relationships");
    expect(ranked[0].tier).not.toBe("sure");
    expect(ranked[0].autofill).toBe(false);
    expect(ranked[0].reason).toBe("Fits what you wrote");
    expect(ranked[0].why.join(" ")).not.toMatch(/divorc|rebuild|ended/i);
    expect(pickHeard(p).picks.relationship).toEqual([]);
  });
});

describe("choosing a community", () => {
  const top = (story: string, extra: Partial<ProfileInput> = {}) => communitiesFor({ ageRange: "33-40", ageLabel: "33–40", story, ...extra })[0];

  it("is sure about a clear story and says why in the person's words", () => {
    const t = top("I just lost my job and I'm trusting God for the next door.");
    expect(t).toMatchObject({ id: "in-between-jobs", tier: "sure", autofill: true });
    expect(t.reason).toBe("You wrote “lost my job”");
    expect(top("I run a small business and I'm tired of doing it alone.").id).toBe("business-entrepreneurship");
    expect(top("We have three children and our home needs a better rhythm.").id).toBe("parents-family");
    expect(top("I'm a student and I want friends who love God.").id).toBe("education");
    expect(top("I am a nurse at a teaching hospital.").id).toBe("medical-healthcare");
    expect(top("Planning to japa to the UK next year.").id).toBe("global-citizens");
  });

  it("weighs the whole story: a banker with small children and a team to lead is a professional first, a parent second", () => {
    const story = "I work in a bank on the Island. Just got promoted to lead a team of six. Married with two small kids, we live in Yaba.";
    const all = communitiesFor({ ageRange: "33-40", story });
    expect(all.map((t) => t.id).slice(0, 2)).toEqual(["professionals", "parents-family"]);
    expect(all[0].tier).toBe("sure");
    expect(all[1].tier).toBe("likely");
  });

  it("does not claim to be sure when the evidence is thin or the call is close", () => {
    const t = communitiesFor({ ageRange: "51-60", story: "I'm a pastor's wife, our children are grown, and I mentor young women in church." });
    expect(t.every((x) => !x.autofill)).toBe(true);
  });

  it("starts from the age group when nothing has been written, and never fills anything in", () => {
    const t = communitiesFor({ ageRange: "33-40", ageLabel: "33–40" });
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.tier === "guess" && !x.autofill)).toBe(true);
    expect(t[0].reason).toBe("A natural place to start at 33–40");
    expect(communitiesFor({})).toEqual([]);
  });

  it("puts Global Citizens first for anyone who lives outside Nigeria, even with no story", () => {
    const t = communitiesFor({ ageRange: "26-32", zone: "abroad" });
    expect(t[0]).toMatchObject({ id: "global-citizens", tier: "sure" });
    expect(t[0].reason).toBe("Because you’re based outside Nigeria");
  });

  it("learns from what the person confirms in 'We heard…'", () => {
    const quiet = communitiesFor({ ageRange: "33-40", story: "I'm busy with life." });
    expect(quiet[0].tier).toBe("guess");
    const told = communitiesFor({ ageRange: "33-40", story: "I'm busy with life.", answers: { workStatus: "self_employed", workField: "finance" } });
    expect(told[0].id).toBe("business-entrepreneurship");
    expect(told[0].reason).toMatch(/^Because you run your own business/);
  });

  it("changes its mind when a corrected answer points somewhere else", () => {
    const story = "I work in a bank and I also run a side hustle selling clothes.";
    const first = communitiesFor({ story, answers: {} })[0].id;
    const corrected = communitiesFor({ story, answers: { workStatus: "employed" } })[0].id;
    const other = communitiesFor({ story, answers: { workStatus: "self_employed" } })[0].id;
    expect(corrected).toBe("professionals");
    expect(other).toBe("business-entrepreneurship");
    expect(first).toBeTruthy();
  });

  it("ranks communities the office adds by the person's own words", () => {
    const extra = [...COMMUNITIES, { id: "pilots", name: "Pilots and Aviation", description: "Pilots, cabin crew and aviation engineers." }];
    const p = buildProfile({ story: "I am a cabin crew member and the schedule is hard." });
    const out = finalize(rankCommunities(p, extra), "sure");
    expect(out[0].id).toBe("pilots");
    expect(out[0].reason).toBe("You wrote “cabin”");
  });
});

describe("choosing a goal", () => {
  const goals = (slugs: [string, string][]) => slugs.map(([id, name]) => ({ id, name }));
  const rank = (story: string, list: [string, string][], extra: Partial<ProfileInput> = {}) =>
    finalize(rankGoals(buildProfile({ story, ...extra }), goals(list)), "sure", { singles: true });

  it("puts the goal the story points at first", () => {
    const business: [string, string][] = [
      ["launch-or-formalise-a-business", "Launch or formalise a business"],
      ["grow-revenue-and-systems", "Grow revenue and systems"],
    ];
    expect(rank("I want to register my business and start properly.", business)[0].id).toBe("launch-or-formalise-a-business");
    expect(rank("I run a business but I'm doing everything myself and need systems.", business)[0].id).toBe("grow-revenue-and-systems");
    const marriage: [string, string][] = [
      ["strengthen-our-marriage", "Strengthen our marriage"],
      ["prepare-well-for-marriage", "Prepare well for marriage"],
      ["rebuild-after-a-relationship-ends", "Rebuild after a relationship ends"],
    ];
    expect(rank("We're engaged and the wedding is in June.", marriage)[0].id).toBe("prepare-well-for-marriage");
    expect(rank("", marriage, { answers: { relationship: "married" } })[0].id).toBe("strengthen-our-marriage");
    const parents: [string, string][] = [
      ["build-a-faith-filled-home-rhythm", "Build a faith-filled home rhythm"],
      ["parent-teenagers-well", "Parent teenagers well"],
    ];
    expect(rank("Our son is 15 and we argue every day.", parents)[0].id).toBe("parent-teenagers-well");
  });

  it("has an affinity table for every community and goal the church starts with", () => {
    const sql = readFileSync(path.join(__dirname, "../../supabase/migrations/20261012000200_reference_data.sql"), "utf8");
    const communitySlugs = [...sql.matchAll(/^\s*\('([a-z-]+)',\s+'[^']+',\s+'[^']+',\s+\d+\)/gm)].map((m) => m[1]);
    const goalSlugs = [...sql.matchAll(/^\s*\('[a-z-]+',\s+'[a-z-]+',\s+'([a-z-]+)',\s+'[^']+',\s+\d\)/gm)].map((m) => m[1]);
    expect(communitySlugs.length).toBe(11);
    expect(goalSlugs.length).toBe(23);
    for (const slug of communitySlugs) expect(COMMUNITY_AFFINITY[slug], slug).toBeDefined();
    for (const slug of goalSlugs) {
      expect(GOAL_AFFINITY[slug], slug).toBeDefined();
      expect(outcomeSentences(slug), slug).toHaveLength(3);
      for (const line of outcomeSentences(slug)) expect(line).toMatch(/^By week 12, /);
    }
  });
});

describe("'We heard…'", () => {
  const heard = (story: string, extra: Partial<ProfileInput> = {}) => pickHeard(buildProfile({ story, ...extra }));
  const ids = (picks: { id: string }[]) => picks.map((p) => p.id);

  it("fills in what the story states plainly", () => {
    const h = heard("I work in a bank on the Island. Married with two small kids, we live in Yaba.");
    expect(h.picks.work_status[0]).toMatchObject({ id: "employed", autofill: true });
    expect(h.picks.work_field[0]).toMatchObject({ id: "finance", autofill: true });
    expect(h.picks.relationship[0]).toMatchObject({ id: "married", autofill: true });
    expect(h.picks.children[0]).toMatchObject({ id: "under_12", autofill: true });
    expect(h.picks.relationship[0].reason).toBe("You wrote “Married with”");
  });

  it("never suggests the painful answers, whatever the story says", () => {
    for (const story of ["I'm a widow and I miss my husband.", "We separated last year.", "I lost my husband in March."]) {
      expect(ids(heard(story).picks.relationship)).not.toContain("widowed");
      expect(ids(heard(story).picks.relationship)).not.toContain("separated");
    }
  });

  it("only suggests, and does not fill in, when two answers are about equally likely", () => {
    const h = heard("I work for a firm and I also run my own business.");
    expect(ids(h.picks.work_status).sort()).toEqual(["employed", "self_employed"]);
    expect(h.picks.work_status.every((p) => !p.autofill)).toBe(true);
  });

  it("asks which ages when children are mentioned without ages", () => {
    const h = heard("We have three children and our home needs a better rhythm.");
    expect(h.picks.children).toEqual([]);
    expect(h.notes.children).toBe("You mentioned your children. Tap the ages that fit.");
  });

  it("lets 'no children' stand alone, and lets the positive statement win if both appear", () => {
    expect(ids(heard("I have no kids yet.").picks.children)).toEqual(["none"]);
    const both = heard("We have two small kids and no other children.");
    expect(ids(both.picks.children)).toContain("under_12");
    expect(ids(both.picks.children)).not.toContain("none");
  });

  it("never reads relationship, children or work from the age group", () => {
    const h = pickHeard(buildProfile({ ageRange: "33-40", ageLabel: "33–40" }));
    expect(Object.values(h.picks).every((l) => l.length === 0)).toBe(true);
  });
});

describe("roles, faith, serving, progress and this-or-that", () => {
  it("suggests a group role only when the person describes it", () => {
    expect(pickRoles(buildProfile({ story: "I'm the one who keeps the peace and I love to cook for people." })).map((p) => p.id).sort()).toEqual(["host", "peacemaker"]);
    expect(pickRoles(buildProfile({ story: "I do not want to lose my peace." }))).toEqual([]);
    expect(pickRoles(buildProfile({ story: "I pray for people, I love to organise events, I encourage everyone and I host." })).length).toBeLessThanOrEqual(2);
  });

  it("suggests where someone is with God only when they say it, and never fills it in", () => {
    expect(pickFaith(buildProfile({ story: "I gave my life to Christ recently and I'm new to church." }))).toMatchObject({ id: "new", autofill: false });
    expect(pickFaith(buildProfile({ story: "I'm a youth leader and I teach Sunday school." }))).toMatchObject({ id: "leading", autofill: false });
    expect(pickFaith(buildProfile({ story: "I have a job and two children." }))).toBeNull();
    expect(pickFaith(buildProfile({ story: "I doubt God sometimes." }))).toBeNull();
  });

  it("offers 'open to leading' only on a clear sign, and never fills it in", () => {
    expect(pickServing(buildProfile({ story: "I lead a cell and mentor younger people at church." }))).toMatchObject({ id: "yes", autofill: false });
    expect(pickServing(buildProfile({ story: "I'm too busy this year." }))).toMatchObject({ id: "not_now" });
    expect(pickServing(buildProfile({ story: "I work at a bank." }))).toBeNull();
  });

  it("reads where someone is on their goal, and stays silent when the story says two different things", () => {
    expect(pickBaseline(buildProfile({ story: "I'm just thinking about starting." }))).toMatchObject({ id: "2" });
    expect(pickBaseline(buildProfile({ story: "I'm almost there, nearly done." }))).toMatchObject({ id: "5" });
    expect(pickBaseline(buildProfile({ story: "I have not started but I'm almost there." }))).toBeNull();
    expect(pickBaseline(buildProfile({ story: "I work at a bank." }))).toBeNull();
  });

  it("leans the this-or-that pairs only on the person's words or chosen gifts", () => {
    const p = buildProfile({ story: "I'm an introvert and I like a clear plan." });
    const lean = pickStyle(p, []);
    expect(lean.styleSocial).toMatchObject({ lean: -1 });
    expect(lean.styleStructure).toMatchObject({ lean: 1 });
    expect(lean.styleLearning).toBeUndefined();
    const fromRoles = pickStyle(buildProfile({ story: "" }), ["peacemaker", "organiser"]);
    expect(fromRoles.styleDirectness).toMatchObject({ lean: -1 });
    expect(fromRoles.styleStructure).toMatchObject({ lean: 1 });
    expect(fromRoles.styleDirectness?.reason).toBe("A Peacemaker often feels this way");
    expect(pickStyle(buildProfile({ story: "" }), ["peacemaker", "truth_teller"]).styleDirectness).toBeUndefined();
  });

  it("knows people outside Nigeria meet online", () => {
    expect(pickMode(buildProfile({ zone: "abroad" }))).toMatchObject({ id: "online", autofill: true });
    expect(pickMode(buildProfile({ zone: "other-nigeria" }))).toMatchObject({ id: "online", autofill: false });
    expect(pickMode(buildProfile({ zone: "mainland" }))).toBeNull();
  });
});

describe("meeting times with young children", () => {
  it("keeps weeknights out of reach in person, and after bedtime online", () => {
    const inPerson = suggestTimes({ zone: "mainland", mode: "in_person", work: "employed", kids: true });
    expect(inPerson.map((s) => s.id)).not.toContain("weeknight-evening");
    expect(inPerson[0].reason).toMatch(/children/);
    const online = suggestTimes({ zone: "mainland", mode: "online", work: "employed", kids: true });
    expect(online.find((s) => s.id === "weeknight-evening")?.reason).toBe("After the children are in bed, from home");
    expect(suggestTimes({ zone: "mainland", mode: "online", work: "employed" })).toEqual(suggestTimes({ zone: "mainland", mode: "online", work: "employed", kids: false }));
  });
});

describe("adding an AI service's picks", () => {
  const engine = () => communitiesFor({ ageRange: "33-40", story: "I work in a bank and I mentor young people at church." });

  it("changes nothing when the service has nothing to add", () => {
    const e = engine();
    expect(blend(e, [], { policy: "sure", singles: true })).toEqual(e);
  });

  it("lifts a pick it agrees with, and uses its reason", () => {
    const e = engine();
    const target = e[1].id;
    const out = blend(e, [{ id: target, reason: "You mentor young people" }], { policy: "sure", singles: true });
    const hit = out.find((p) => p.id === target)!;
    expect(hit.via).toBe("both");
    expect(hit.reason).toBe("You mentor young people");
    expect(hit.score).toBeGreaterThan(e[1].score);
  });

  it("adds a pick only the service found, as 'likely', never as 'sure' on its own", () => {
    const out = blend([], [{ id: "education", reason: "You mention school" }], { policy: "likely" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "education", via: "ai", tier: "likely", autofill: true });
    expect(blend([], [{ id: "education" }], { policy: "sure", singles: true })[0].autofill).toBe(false);
  });

  it("ignores ids that are not options", () => {
    const out = blend([], [{ id: "made-up" }, { id: "education" }], { policy: "likely", known: new Set(["education"]) });
    expect(out.map((p) => p.id)).toEqual(["education"]);
  });
});

describe("words to start from", () => {
  it("offers four story starters for each age group and area", () => {
    for (const age of ["18-25", "26-32", "33-40", "41-50", "51-60", "60-plus", undefined, "13-17"]) {
      const s = starterSentences(age);
      expect(s).toHaveLength(4);
      expect(new Set(s).size).toBe(4);
    }
    expect(starterSentences("26-32", "abroad")[3]).toMatch(/abroad/);
    expect(starterSentences("26-32")).not.toEqual(starterSentences("51-60"));
  });

  it("writes the starters so the engine understands them", () => {
    for (const age of ["18-25", "26-32", "33-40", "41-50", "51-60", "60-plus"]) {
      for (const line of starterSentences(age)) {
        expect(readText(line).length, line).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to three general sentences for a goal the office wrote", () => {
    expect(outcomeSentences("something-new")).toHaveLength(3);
    expect(outcomeSentences(undefined)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// What is filled in, and what is left alone
// ---------------------------------------------------------------------------------------------------------------------

import { acceptOnLeaving, computePicks, fillPlan, secondChoice, type Origin } from "@/lib/companion/plan";

const GOALS: Record<string, { id: string; name: string }[]> = {
  professionals: [
    { id: "step-into-a-leadership-role", name: "Step into a leadership role" },
    { id: "change-career-direction-with-confidence", name: "Change career direction with confidence" },
  ],
};

const BANK_STORY = "I work in a bank on the Island. Just got promoted to lead a team of six. Married with two small kids, we live in Yaba. I do not want to lose my peace.";

function picksFor(input: ProfileInput, ctx: { community?: string; ai?: Parameters<typeof computePicks>[1]["ai"]; rejected?: Parameters<typeof computePicks>[1]["rejected"] } = {}) {
  return computePicks(buildProfile(input), { communities: COMMUNITIES, goals: GOALS[ctx.community ?? ""] ?? [], ai: ctx.ai, rejected: ctx.rejected });
}

describe("filling in the answers it is sure of", () => {
  const input = { ageRange: "33-40", ageLabel: "33–40", story: BANK_STORY };

  it("fills 'We heard…' from the story, and says so", () => {
    const plan = fillPlan("heard", {}, {}, picksFor(input), {});
    expect(plan.patch).toEqual({ workStatus: "employed", workField: "finance", relationship: "married", children: ["under_12"] });
    expect(plan.filled.sort()).toEqual(["children", "relationship", "workField", "workStatus"]);
  });

  it("leaves alone anything the person has touched, even if they emptied it", () => {
    const origin: Origin = { workStatus: "person", children: "person" };
    const plan = fillPlan("heard", { workStatus: undefined, children: [] }, origin, picksFor(input), {});
    expect(plan.patch.workStatus).toBeUndefined();
    expect(plan.patch.children).toBeUndefined();
    expect(plan.patch.workField).toBe("finance");
  });

  it("leaves alone an answer that is already there (a saved draft, or an edit from the review)", () => {
    const plan = fillPlan("heard", { workStatus: "self_employed" }, {}, picksFor(input), {});
    expect(plan.patch.workStatus).toBeUndefined();
  });

  it("changes its own earlier pick when the story changes, and takes it back when nothing supports it", () => {
    const first = picksFor(input);
    const filled = fillPlan("heard", {}, {}, first, {});
    const origin: Origin = { workStatus: "picked", workField: "picked", relationship: "picked", children: "picked" };
    const answers = filled.patch;
    const second = picksFor({ ...input, story: "I run a small business." });
    const plan = fillPlan("heard", answers, origin, second, {});
    expect(plan.patch.workStatus).toBe("self_employed");
    expect(plan.cleared.sort()).toEqual(["children", "relationship", "workField"]);
    expect(plan.patch).toHaveProperty("children", undefined);
  });

  it("picks the community only when it is sure, and a different second choice", () => {
    const plan = fillPlan("community", {}, {}, picksFor(input), {});
    expect(plan.patch.community).toBe("professionals");
    expect(plan.patch.secondCommunity).toBe("parents-family");
    const none = fillPlan("community", {}, {}, picksFor({ ageRange: "33-40", story: "" }), {});
    expect(none.patch.community).toBeUndefined();
    expect(none.patch.secondCommunity).toBeUndefined();
  });

  it("does not pick a community for someone who is describing their own", () => {
    const plan = fillPlan("community", { communityOther: "Pastors’ wives" }, {}, picksFor(input), {});
    expect(plan.patch.community).toBeUndefined();
  });

  it("clears the goal when the Companion changes the community under it", () => {
    const origin: Origin = { community: "picked" };
    const plan = fillPlan("community", { community: "education", goal: "excel-in-my-studies-or-exams" }, origin, picksFor(input), {});
    expect(plan.patch.community).toBe("professionals");
    expect(plan.cleared).toContain("goal");
  });

  it("picks the goal the story points at once the community is chosen", () => {
    const plan = fillPlan("goal", { community: "professionals" }, {}, picksFor(input, { community: "professionals" }), {});
    expect(plan.patch.goal).toBe("step-into-a-leadership-role");
    expect(fillPlan("goal", {}, {}, picksFor(input), {}).patch.goal).toBeUndefined();
  });

  it("puts members outside Nigeria on online, and ticks times that suit them", () => {
    const plan = fillPlan("rhythm", { workStatus: "employed" }, {}, picksFor({ ageRange: "26-32", zone: "abroad" }), { zone: "abroad" });
    expect(plan.patch.meetingMode).toBe("online");
    expect(plan.patch.times).toEqual(["sunday-evening", "saturday-morning", "sunday-afternoon"]);
  });

  it("leaves online or in person to the person when they live in Lagos, but ticks times once they choose", () => {
    const lagos = picksFor({ ageRange: "33-40", zone: "mainland" });
    const first = fillPlan("rhythm", {}, {}, lagos, { zone: "mainland" });
    expect(first.patch.meetingMode).toBeUndefined();
    expect(first.patch.times).toBeUndefined();
    const chosen = fillPlan("rhythm", { meetingMode: "online", workStatus: "employed" }, { meetingMode: "person" }, lagos, { zone: "mainland" });
    expect(chosen.patch.times).toEqual(["weeknight-evening", "sunday-evening", "sunday-afternoon"]);
  });

  it("re-suggests the times when the format changes, until the person ticks their own", () => {
    const lagos = picksFor({ ageRange: "33-40", zone: "mainland" });
    const online = fillPlan("rhythm", { meetingMode: "in_person", times: ["weeknight-evening"], workStatus: "employed" }, { meetingMode: "person", times: "picked" }, lagos, { zone: "mainland" });
    expect(online.patch.times).toEqual(["sunday-afternoon", "weeknight-evening", "saturday-morning"]);
    const theirs = fillPlan("rhythm", { meetingMode: "in_person", times: ["weeknight-evening"], workStatus: "employed" }, { meetingMode: "person", times: "person" }, lagos, { zone: "mainland" });
    expect(theirs.patch.times).toBeUndefined();
  });

  it("fills in at most two roles, and only ones the story describes", () => {
    const withRoles = picksFor({ story: "I keep the peace, I pray for people and I love to host." });
    const plan = fillPlan("style", {}, {}, withRoles, {});
    expect((plan.patch.groupRoles ?? []).length).toBeLessThanOrEqual(2);
    expect(fillPlan("style", {}, {}, picksFor(input), {}).patch.groupRoles).toBeUndefined();
  });

  it("hands over what is still the Companion's pick when the person moves on", () => {
    const next = acceptOnLeaving("heard", { workStatus: "picked", workField: "person", community: "picked" });
    expect(next).toEqual({ workStatus: "person", workField: "person", community: "picked" });
  });
});

describe("what 'Not this one' and a correction do", () => {
  const input = { ageRange: "33-40", story: "I work in a bank and I also run a side hustle selling clothes." };

  it("takes a community the person turned down out of the list, and the next best takes its place", () => {
    const before = picksFor(input);
    const top = before.community[0].id;
    const after = picksFor(input, { rejected: { community: [top] } });
    expect(after.community.map((p) => p.id)).not.toContain(top);
    expect(after.community[0].id).not.toBe(top);
  });

  it("never fills in a community the person turned down, even if an AI service suggests it", () => {
    const top = picksFor(input).community[0].id;
    const after = picksFor(input, { rejected: { community: [top] }, ai: { community: [{ id: top, reason: "x" }] } });
    expect(after.community.map((p) => p.id)).not.toContain(top);
  });

  it("offers a second choice that is a fair fit and different from the first", () => {
    const list = picksFor({ ageRange: "33-40", story: BANK_STORY }).community;
    expect(secondChoice(list, "professionals")?.id).toBe("parents-family");
    expect(secondChoice(list.filter((p) => p.tier === "guess"), undefined)).toBeNull();
  });

  it("brings in an AI service's community and goal picks, and its roles and 'We heard…' picks, only from the form's own lists", () => {
    const picks = picksFor(
      { story: "I teach and I love my students." },
      {
        community: "professionals",
        ai: {
          community: [{ id: "education", reason: "You teach" }, { id: "not-a-community" }],
          goal: [{ id: "step-into-a-leadership-role", reason: "You lead" }, { id: "made-up" }],
          heard: { work_field: [{ id: "education", reason: "You teach" }, { id: "invented" }] },
          roles: [{ id: "encourager", reason: "You encourage" }, { id: "wizard" }],
        },
      },
    );
    expect(picks.community.map((p) => p.id)).not.toContain("not-a-community");
    expect(picks.goal.map((p) => p.id)).not.toContain("made-up");
    expect(picks.heard.work_field.map((p) => p.id)).toEqual(["education"]);
    expect(picks.roles.map((p) => p.id)).toEqual(["encourager"]);
    expect(picks.roles[0].autofill).toBe(true);
  });
});

describe("a shop owner who is also a mother", () => {
  const story = "I run a small provisions shop in Surulere and I'm a mother of two toddlers. I want to grow the business and still be home for the children.";

  it("is shown both honest fits, and nothing is filled in until she confirms more", () => {
    const picks = communitiesFor({ ageRange: "33-40", ageLabel: "33–40", zone: "mainland", story });
    expect(picks.slice(0, 2).map((p) => p.id).sort()).toEqual(["business-entrepreneurship", "parents-family"]);
    expect(picks.some((p) => p.autofill)).toBe(false);
    // Running a shop is not a reason to offer Consulting as a good fit.
    expect(picks.find((p) => p.id === "consulting")?.tier ?? "guess").toBe("guess");
  });

  it("is sure once she confirms she runs her own business, and the reason says what she told us", () => {
    const picks = communitiesFor({
      ageRange: "33-40",
      ageLabel: "33–40",
      zone: "mainland",
      story,
      answers: { workStatus: "self_employed", workField: "trade_retail", children: ["under_12"] },
    });
    expect(picks[0]).toMatchObject({ id: "business-entrepreneurship", tier: "sure", autofill: true });
    expect(picks[0].reason).toMatch(/^Because you /);
  });
});
