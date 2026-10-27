/**
 * The made-up people and made-up situations the How-to Library's pictures are made with.
 *
 * Everyone who appears in a picture is invented here. The throwaway site's own seeded people are renamed first (so no real name from a
 * real person's table can come through), and a picture is refused if its page shows a name or email that is not made up.
 *
 * To add a guide for a new role, add a person for it to CAST and, when its pages need a situation (an application waiting, a tribe with a
 * leader), a named arrangement to ARRANGE. Both are kept short and plain on purpose: a person reading them should see exactly who the
 * pictures show.
 */
import crypto from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Client } from "pg";
import type { Kit } from "../../tests/db/builders";
import type { TestDb } from "../../tests/db/helpers";
import type { Cast } from "../../src/lib/guides/types";
import { PHONE_UA, DESKTOP_UA } from "./agents";
import { db, signIn } from "../lib";
import { ownerDoor } from "../owner-door";
import { kit as makeKit } from "../../tests/db/builders";
import { testDbFor } from "../dbkit";

export type Stage = {
  q: Client;
  adapter: TestDb;
  k: Kit;
  one: (sql: string, args?: unknown[]) => Promise<Record<string, unknown> | undefined>;
  all: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>;
  owner: { owner: { id: string; email: string }; call: (fn: string, ...params: unknown[]) => Promise<Record<string, unknown>> };
  /** Arrangements already made in this run. */
  flags: Set<string>;
};

export type ArrangeFn = (s: Stage) => Promise<unknown>;

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;
const DESKTOP = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 } as const;

/** A fresh browser window, phone-sized or computer-sized, that says what a person's browser says. */
export async function windowFor(browser: Browser, device: "phone" | "desktop"): Promise<{ ctx: BrowserContext; page: Page }> {
  const v = browser.version();
  const ctx = await browser.newContext({ userAgent: device === "phone" ? PHONE_UA(v) : DESKTOP_UA(v), ...(device === "phone" ? PHONE : DESKTOP) });
  return { ctx, page: await ctx.newPage() };
}

type CastDef = {
  open: (s: Stage, browser: Browser, device: "phone" | "desktop", firstPath: string) => Promise<{ ctx: BrowserContext; page: Page }>;
  /** Put this person's situation back to how it was before the picture, so each picture starts from the same place however many came before. */
  fresh?: (s: Stage) => Promise<unknown>;
};

const made = new Map<string, { id: string; email: string }>();

/** One made-up person, made once. `first` is the name the app greets them by. */
export async function person(s: Stage, key: string, first: string, roles: string[] = [], last = "Example"): Promise<{ id: string; email: string }> {
  const have = made.get(key);
  if (have) return have;
  const email = `${first.toLowerCase()}.${key}@example.org`;
  // A second run on the same throwaway site finds the person made by the first
  const there = await s.one("select id from auth.users where email = $1", [email]);
  const u = there ? { id: there.id as string, email } : await s.adapter.createUser({ email });
  await s.q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${first} ${last}`, first]);
  for (const r of roles) await s.adapter.grant(u.id, r);
  made.set(key, u);
  return u;
}

const signedIn =
  (key: string, first: string, roles: string[] = [], reset?: (s: Stage, personId: string) => Promise<unknown>): CastDef => ({
    async open(s, browser, device, firstPath) {
      const p = await person(s, key, first, roles);
      const w = await windowFor(browser, device);
      await signIn(w.page, p.email, firstPath);
      return w;
    },
    async fresh(s) {
      const p = made.get(key);
      if (p && reset) await reset(s, p.id);
    },
  });

/** A cast member who needs a situation made first: it is made once, then they sign in. */
const after =
  (arrangement: string, key: string, first: string, roles: string[] = [], reset?: (s: Stage, personId: string) => Promise<unknown>): CastDef => ({
    async open(s, browser, device, firstPath) {
      await arrange(s, arrangement);
      return signedIn(key, first, roles).open(s, browser, device, firstPath);
    },
    async fresh(s) {
      const p = made.get(key);
      if (p && reset) await reset(s, p.id);
    },
  });

export async function arrange(s: Stage, name: string) {
  // "application-is:<where>" puts Folake's leader application at a stated place, as often as asked, so each picture can ask for its own
  if (name.startsWith("application-is:")) return applicationIs(s, name.slice("application-is:".length));
  // "academy-is:<where>" does the same for her training, once she is approved
  if (name.startsWith("academy-is:")) return academyIs(s, name.slice("academy-is:".length));
  if (s.flags.has(name)) return;
  const fn = ARRANGE[name];
  if (!fn) throw new Error(`there is no arrangement called "${name}"`);
  s.flags.add(name);
  await fn(s);
}

export const CAST: Partial<Record<Cast, CastDef>> = {
  visitor: {
    async open(_s, browser, device) {
      return windowFor(browser, device);
    },
  },
  // A form in progress is cleared before each picture, so every screen of it is reached the way a first-time visitor reaches it
  "new-member": signedIn("new-member", "Tolu", [], async (s, id) => {
    await s.q.query("delete from public.intake_drafts where person_id = $1", [id]);
    // The ledger only grows, so "back to the start" is the person having withdrawn what they agreed to
    await s.q.query(
      "insert into public.consents (person_id, purpose, granted, version) select $1, p, false, 'pictures' from unnest(array['matching','ai_assist']::public.consent_purpose[]) p",
      [id],
    );
  }),
  // Has finished the form and is looking at the tribes that fit
  member: after("member-has-matches", "member", "Bisola"),
  // Is in a tribe, and the season has begun
  "tribe-member": after("member-has-tribe", "tribe-member", "Kemi"),
  // Has asked the church office to delete their account, and is waiting
  "member-leaving": after("member-asked-deletion", "member-leaving", "Adaeze"),
  // Folake is writing, or has sent, an application to lead. Each picture names where she is ("application-is:...").
  applicant: signedIn("applicant", "Folake"),
  // The same Folake once the pastor has approved her: a leader in training who has not yet done the training
  "leader-in-training": signedIn("applicant", "Folake"),
  // Was appointed by the church to lead, and has a draft Tribe Card
  "appointed-leader": after("appointed-leader", "appointed", "Chiamaka", ["leader"]),
  // Leads a tribe whose season has begun
  leader: after("leader-has-tribe", "leader", "Segun", ["leader"], async (s) => leaderWeekFresh(s)),
  // Is the assistant leader of that tribe, with two care tasks waiting for her
  assistant: after("assistant-has-tribe", "assistant", "Dara", ["assistant_leader"], async (s) => assistantFresh(s)),
  // People who open a private link from an email are not signed in. Each picture starts in a browser of its own (see pageFor).
  referee: { open: async (_s, browser, device) => windowFor(browser, device) },
  parent: { open: async (_s, browser, device) => windowFor(browser, device) },
  placed: { open: async (_s, browser, device) => windowFor(browser, device) },
};

const NAMES: [string, string][] = [
  ["Funmi", "Adebayo"], ["Emeka", "Nwosu"], ["Halima", "Bello"], ["Segun", "Ojo"], ["Ife", "Balogun"], ["Temi", "Coker"], ["Kunle", "Ade"], ["Zainab", "Musa"],
  ["Ruth", "Okon"], ["Dapo", "Ajayi"], ["Nkechi", "Obi"], ["Yemi", "Fashola"], ["Tayo", "Bankole"], ["Amaka", "Eze"], ["Wale", "Sanni"], ["Bukola", "Ige"],
];

export const ARRANGE: Record<string, ArrangeFn> & { __site: ArrangeFn; __realNames: (s: Stage) => Promise<string[]> } = {
  /** The throwaway site, arranged the way a real one is: signed-off cards, an approved fit model, every seeded person made up. */
  async __site(s) {
    const pastor = await s.one("select id from public.people where email = 'pastor.ife@example.org'");
    if (pastor) {
      for (const c of await s.all("select id from public.communities where active")) {
        await s.adapter.asUser(pastor.id as string, (run) => run("select public.card_template_sign_off_community($1)", [c.id]));
      }
      for (const t of await s.all("select slug from public.tribe_card_templates where status <> 'signed_off'")) {
        await s.adapter.asUser(pastor.id as string, (run) => run("select public.card_template_sign_off($1)", [t.slug]));
      }
      if (!(await s.one("select 1 as there from public.leader_fit_models where active"))) {
        await s.adapter.asUser(pastor.id as string, (run) => run("select public.leader_fit_model_activate('lf-1')"));
      }
    }
    // Every person already on the site is given a made-up name, so nothing from the site's own seed can show. Someone this program made
    // earlier ("... Example") is already made up and is left as they are.
    const rows = await s.all("select id from public.people where full_name is null or full_name not like '% Example' order by created_at, id");
    for (let i = 0; i < rows.length; i++) {
      const [first, last] = NAMES[i % NAMES.length];
      const name = `${first} ${last}`;
      await s.q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [rows[i].id, name, first]);
    }
  },
  async __realNames() {
    return [];
  },

  /** Four tribes that members can choose, each with a made-up leader. */
  async "tribes-open"(s) {
    if (await s.one("select 1 as there from public.tribes where name = 'Segun’s Builders tribe'")) return;
    const S = (await s.one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const spec: [string, string, string, Parameters<typeof s.k.tribe>[1]][] = [
      ["Segun", "Segun’s Builders tribe", "professionals", { slot: "weeknight-evening" }],
      ["Halima", "Halima’s Builders tribe", "professionals", { slot: "saturday-morning", mode: "online" }],
      ["Dapo", "Dapo’s Growers tribe", "professionals", { slot: "sunday-afternoon" }],
      ["Ruth", "Ruth’s Anchors tribe", "professionals", { slot: "weeknight-evening", mode: "online" }],
    ];
    for (const [first, name, community, opts] of spec) {
      const t = await s.k.tribe(S, { ...opts, community, name });
      await s.q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [t.leader.id, `${first} Example`, first]);
    }
  },

  /** A member who has answered the form, so the tribes that fit them are on their page. */
  async "member-has-matches"(s) {
    await arrange(s, "tribes-open");
    if (await s.one("select 1 as there from public.member_profiles m join public.people p on p.id = m.person_id where p.email like 'bisola.%'")) return;
    const S = (await s.one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const p = await person(s, "member", "Bisola");
    await s.k.profile(p.id, S, { age: "33-40", gender: "female", mode: "either", times: ["weeknight-evening", "saturday-morning"] });
  },

  /** A member seated in a tribe whose leader has been logging weeks. */
  async "member-has-tribe"(s) {
    await arrange(s, "tribes-open");
    if (await s.one("select 1 as there from public.tribe_members m join public.people p on p.id = m.person_id where p.email like 'kemi.%'")) return;
    const S = (await s.one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const p = await person(s, "tribe-member", "Kemi");
    await s.k.profile(p.id, S, { age: "33-40", gender: "female" });
    const tribe = await s.one("select id from public.tribes where name = 'Segun’s Builders tribe'");
    await s.q.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, 91, 'test', '{}'::jsonb, current_date + 14)`,
      [tribe!.id, p.id, S],
    );
  },

  /** Segun leads the tribe Kemi is in. The season is under way, a few meetings are logged, and one member has missed twice. */
  async "leader-has-tribe"(s) {
    await arrange(s, "member-has-tribe");
    const me = await person(s, "leader", "Segun", ["leader"]);
    const t = (await s.one("select id, leader_id from public.tribes where name = 'Segun’s Builders tribe'"))!;
    if (t.leader_id === me.id) return;
    const before = t.leader_id as string;
    await s.q.query("update public.tribes set leader_id = $2 where id = $1", [t.id, me.id]);
    await s.q.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'leader') on conflict do nothing", [me.id]);
    // The leader the tribe was built with is someone else now
    await s.q.query("update public.people set full_name = 'Seyi Example', preferred_name = 'Seyi' where id = $1", [before]);
  },

  /**
   * Segun's tribe in its second week: six members, the first meeting logged, one member who does not yet feel they belong (to call), and a
   * testimony waiting for him to read.
   */
  async "leader-week"(s) {
    await arrange(s, "leader-has-tribe");
    if (await s.one("select 1 as there from public.tribe_members m join public.people p on p.id = m.person_id where p.full_name = 'Amaka Example'")) return;
    const S = (await s.one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const tribe = (await s.one("select id from public.tribes where name = 'Segun’s Builders tribe'"))!.id as string;
    const leader = made.get("leader")!;
    const kemi = made.get("tribe-member")!;
    const members: Record<string, string> = {};
    for (const first of ["Amaka", "Tayo", "Zainab", "Bukola", "Emeka"]) {
      const u = await s.k.seat(tribe, S, first);
      // Seated people are made with a throwaway surname, so they are renamed the way every person in a picture is
      await s.q.query("update public.people set full_name = $2, preferred_name = $3 where id = $1", [u.id, `${first} Example`, first]);
      members[first] = u.id;
    }
    await s.k.meetings(tribe, leader.id, 1, [
      [kemi.id, 1],
      [members.Amaka, 1],
      [members.Tayo, 1],
      [members.Zainab, 1],
      [members.Bukola, 1],
      [members.Emeka, 0],
    ]);
    await s.q.query("update public.member_profiles set whatsapp = '+2348031230001' where person_id = $1", [members.Emeka]);
    for (const [i, id] of [members.Amaka, members.Tayo, kemi.id].entries()) {
      await s.q.query("update public.member_profiles set whatsapp = $2 where person_id = $1", [id, `+23480312300${i + 2}0`]);
    }
    await s.q.query("insert into public.testimonies (person_id, tribe_id, week, body, share_with, credit) values ($1, $2, 1, $3, 'tribe', 'first_name')", [
      members.Amaka,
      tribe,
      "I had been afraid to ask for a raise for two years. This week I prayed about it with my tribe, asked, and my manager said yes. I am amazed.",
    ]);
    await leaderWeekFresh(s);
  },

  /** A season that begins in two weeks, with one tribe in it: where members are placed before a season starts. */
  async "next-season"(s) {
    if (await s.one("select 1 as there from public.seasons where name = 'Season 2, 2027'")) return;
    const S2 = await s.k.season("Season 2, 2027", -14);
    const t = await s.k.tribe(S2, { name: "Funmi’s Growers tribe", community: "professionals", slot: "saturday-morning", mode: "online" });
    await s.q.query("update public.people set full_name = 'Funmi Example', preferred_name = 'Funmi' where id = $1", [t.leader.id]);
    await s.q.query("update public.tribes set place_note = null where id = $1", [t.tribe]);
  },

  /** Dara, certified as an assistant leader and named as the assistant of Segun's tribe. Two care tasks are waiting for her. */
  async "assistant-has-tribe"(s) {
    await arrange(s, "leader-week");
    const dara = await person(s, "assistant", "Dara", ["assistant_leader"]);
    await s.q.query("insert into public.leader_certifications (person_id, as_role) values ($1, 'assistant_leader') on conflict do nothing", [dara.id]);
    await s.q.query("update public.tribes set assistant_id = $1 where name = 'Segun’s Builders tribe'", [dara.id]);
    await assistantFresh(s);
  },

  /** Chiamaka, whom the church appointed to lead. A draft Tribe Card has been started for her, with the community, goal and stage of life chosen. */
  async "appointed-leader"(s) {
    const p = await person(s, "appointed", "Chiamaka", ["leader"]);
    if (await s.one("select 1 as there from public.leader_appointments where person_id = $1", [p.id])) return;
    const S = (await s.one("select id from public.seasons order by starts_on limit 1"))!.id as string;
    const t = await s.k.tribe(S, { status: "draft", name: "Chiamaka’s Builders tribe", community: "professionals", certified: false });
    await s.q.query("delete from public.leader_certifications where person_id = $1", [t.leader.id]);
    await s.q.query("update public.people set full_name = 'Seyi Example', preferred_name = 'Seyi' where id = $1", [t.leader.id]);
    await s.q.query(
      `update public.tribes set leader_id = $2, fixed = array['track', 'community', 'goal'], meeting_day = null, meeting_time = null, slot = null, meeting_mode = null, zone = null,
              place_note = null, story = null, published_at = null,
              loving_god = 'Read the week’s passage and say the confession five days a week.',
              loving_others = 'Pray for our triad weekly. Nobody misses twice without a call.',
              loving_life = 'Each of us completes ten of the twelve weekly steps and has one leadership conversation with a manager.'
        where id = $1`,
      [t.tribe, p.id],
    );
    const goal = await s.one("select season_goal_id from public.tribes where id = $1", [t.tribe]);
    await s.q.query(
      "insert into public.leader_appointments (person_id, season_id, tribe_id, season_goal_id, form, status, granted_role) values ($1, $2, $3, $4, '{}'::jsonb, 'active', true)",
      [p.id, S, t.tribe, goal!.season_goal_id],
    );
  },

  /** A member who has asked for their account to be deleted and has not yet had an answer. */
  async "member-asked-deletion"(s) {
    const p = await person(s, "member-leaving", "Adaeze");
    const centre = await s.one("select centre_id from public.people where id = $1", [p.id]);
    await s.q.query(
      `insert into public.erasure_requests (person_id, centre_id, status, note) values ($1, $2, 'open', null) on conflict (person_id) do nothing`,
      [p.id, centre!.centre_id],
    );
  },
};


/** Dara's two care tasks as they were before any picture: both open, none done. */
async function assistantFresh(s: Stage) {
  const tribe = await s.one("select id, leader_id from public.tribes where name = 'Segun’s Builders tribe'");
  const dara = made.get("assistant");
  if (!tribe || !dara) return;
  await s.q.query("delete from public.care_tasks where tribe_id = $1", [tribe.id]);
  const who = async (first: string) =>
    (await s.one("select p.id from public.people p join public.tribe_members m on m.person_id = p.id where p.full_name = $2 and m.tribe_id = $1", [tribe.id, `${first} Example`]))!.id as string;
  const rows: [string, string, string][] = [
    ["Emeka", "practical", "Emeka said he has no way to get to the meeting on Wednesday. Could you offer a lift or find someone nearby?"],
    ["Tayo", "pastoral", "Tayo asked for prayer about a hard week at work. A short call would mean a lot."],
  ];
  for (const [first, kind, note] of rows) {
    await s.q.query(
      `insert into public.care_tasks (tribe_id, person_id, kind, week, note, assignee_role, assigned_to, raised_by, due_on, status)
       values ($1, $2, $3, 2, $4, 'assistant', $5, $6, public.today_lagos() + 2, 'open')`,
      [tribe.id, await who(first), kind, note, dara.id, tribe.leader_id],
    );
  }
}

/** Segun's second week as it was before any picture: nothing logged for it, the call still open, the testimony still waiting. */
async function leaderWeekFresh(s: Stage) {
  const tribe = await s.one("select id from public.tribes where name = 'Segun’s Builders tribe'");
  if (!tribe) return;
  const t = tribe.id as string;
  await s.q.query("delete from public.tribe_attendance where tribe_id = $1 and week >= 2", [t]);
  await s.q.query("delete from public.tribe_logs where tribe_id = $1 and week >= 2", [t]);
  await s.q.query("delete from public.care_flags where tribe_id = $1", [t]);
  const emeka = await s.one("select p.id from public.people p join public.tribe_members m on m.person_id = p.id where p.full_name = 'Emeka Example' and m.tribe_id = $1", [t]);
  if (emeka) {
    await s.q.query("insert into public.care_flags (tribe_id, person_id, kind, week) values ($1, $2, 'low_belonging', 1)", [t, emeka.id]);
  }
  await s.q.query("update public.testimonies set status = 'submitted', decided_by = null, decided_at = null, decline_note = null where tribe_id = $1", [t]);
}

// ---------------------------------------------------------------------------------------------------------------------
// A leader's application, at any place along the way. All of it is made up.
// ---------------------------------------------------------------------------------------------------------------------

const ORDER = ["eligibility", "contact", "track", "community", "goal", "goal-story", "why", "walked", "walk", "obstacles", "s1", "s2", "s3", "s4", "s5", "s6", "style", "lead-best", "ref1", "ref2", "review"];

const WORDS = {
  goalStory:
    "In January 2022 I was moved from analyst to team lead at a bank, with six people reporting to me and no training. For the first months I micromanaged because I was afraid of looking weak. I asked my manager for a weekly check-in and started asking my team what they needed from me. I learned that leading is mostly listening.",
  why: "When I lost my father, a small group from church came to the house every Thursday and mostly sat with us. They never tried to fix anything. I want to be that kind of presence for other people.",
  walked:
    "My neighbour lost her husband last year. I went round on Saturdays and listened, even when she told the same story many times. I did not tell her to move on, and I prayed with her when she asked.",
  walkNote: "I would say 3 out of 5. I read my Bible most mornings but I am often distracted, and I skip prayer when work gets busy.",
  obstacles: "I travel for work two weeks in November. I would tell my assistant early and ask her to lead the meetings I miss, and move one meeting online rather than cancel it.",
};
const SCENARIO_ANSWERS: Record<string, { best: string; worst: string }> = {
  s1: { best: "b", worst: "d" },
  s2: { best: "b", worst: "c" },
  s3: { best: "a", worst: "d" },
  s4: { best: "a", worst: "c" },
  s5: { best: "a", worst: "b" },
  s6: { best: "a", worst: "c" },
};

/** What a person who is on this screen has already answered: every screen before it, and nothing from it or after. */
function answersBefore(step: string) {
  const at = ORDER.indexOf(step);
  const done = (id: string) => ORDER.indexOf(id) < at;
  const calling: Record<string, unknown> = {};
  const scenarios: Record<string, unknown> = {};
  const style: Record<string, unknown> = {};
  if (done("track")) calling.track = "builders";
  if (done("community")) calling.community = "professionals";
  if (done("goal")) Object.assign(calling, { goal: "step-into-a-leadership-role", goalRelation: "pursuing" });
  if (done("goal-story")) calling.goalStory = WORDS.goalStory;
  if (done("why")) calling.why = WORDS.why;
  if (done("walked")) calling.walked = WORDS.walked;
  if (done("walk")) Object.assign(calling, { walkRating: 3, walkNote: WORDS.walkNote });
  if (done("obstacles")) calling.obstacles = WORDS.obstacles;
  for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) if (done(id)) scenarios[id] = SCENARIO_ANSWERS[id];
  if (done("style")) Object.assign(style, { styleSocial: 1, styleStructure: -1 });
  if (done("lead-best")) style.leadBest = "connection";
  return {
    eligibility: done("eligibility") ? { member6: true, foundation: true, serving: true, age21: true, time: true, safeguarding: true, confidentiality: true } : {},
    contact: done("contact") ? { whatsapp: "+2348031234567" } : {},
    calling,
    scenarios,
    style,
  };
}

const REFEREES: [number, string, string, string, boolean][] = [
  [1, "Pastor Ife Example", "My unit head at church", "ife.example@example.org", true],
  [2, "Bola Example", "A friend from work", "bola.example@example.org", false],
];

/**
 * Folake's application, put exactly where a picture needs it: "draft@<screen>" (writing, on that screen), or the status it holds after
 * she has sent it ("submitted", "interview_invited", "interview_booked", "approved_leader"). Anything she had before is cleared.
 */
export async function applicationIs(s: Stage, where: string) {
  const [place, ...extras] = where.split("+");
  const p = await person(s, "applicant", "Folake");
  await s.q.query("delete from public.leader_offers where person_id = $1", [p.id]);
  await s.q.query("delete from public.leader_applications where person_id = $1", [p.id]);
  await s.q.query("delete from public.person_roles where person_id = $1 and role = 'leader'", [p.id]);
  const draft = place.startsWith("draft@");
  const step = draft ? place.slice("draft@".length) : "review";
  const answers = draft ? answersBefore(step) : answersBefore("end");
  const decided = place.startsWith("approved") || place === "not_approved";
  const note = place === "not_approved" ? "Thank you for offering. We would love you to serve as a member for a season, finish Foundation of Faith, and apply again." : null;
  const row = await s.one(
    `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at, decided_at, decision_note)
     values ($1, $2, $3, $4::jsonb, '2026-10-l1', $5, $6, $7) returning id`,
    [p.id, draft ? "draft" : place, step, JSON.stringify(answers), draft ? null : new Date().toISOString(), decided ? new Date().toISOString() : null, note],
  );
  const id = row!.id as string;
  const withReferees = draft ? ORDER.indexOf(step) > ORDER.indexOf("ref1") : true;
  if (withReferees) {
    for (const [slot, name, rel, contact, head] of REFEREES) {
      if (draft && slot === 2 && ORDER.indexOf(step) <= ORDER.indexOf("ref2")) continue;
      await s.q.query(
        "insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at) values ($1, $2, $3, $4, $5, $6, md5(gen_random_uuid()::text), now() + interval '30 days')",
        [id, slot, name, rel, contact, head],
      );
    }
  }
  if (place === "approved_leader") await s.adapter.grant(p.id, "leader");
  if (place === "interview_invited" || place === "interview_booked" || place === "interviewed") await interviewSlots(s, id, place !== "interview_invited");
  if (extras.includes("offer")) await offerFor(s, p.id);
  return id;
}

/**
 * Folake once a pastor has approved her, at a place in her training: "fresh" (nothing done), "five-passed", "all-passed" (six modules, no
 * declaration yet) or "signed" (all of it). "+workshops" adds two workshops with dates the office has opened. Whatever she had is cleared.
 */
export async function academyIs(s: Stage, where: string) {
  const [place, ...extras] = where.split("+");
  await applicationIs(s, "approved_leader");
  const p = made.get("applicant")!;
  for (const t of ["academy_bookings", "academy_attempts", "academy_progress", "safeguarding_declarations", "practice_assessments"]) {
    await s.q.query(`delete from public.${t} where person_id = $1`, [p.id]);
  }
  const passed = place === "fresh" ? 0 : place === "five-passed" ? 5 : 6;
  if (passed) {
    await s.q.query(
      `insert into public.academy_progress (person_id, module_id, opened_at, attempts, best_score, passed_at)
       select $1, m.id, now() - interval '3 days', 1, (array[90, 100, 85, 90, 95, 90])[m.number], now() - interval '2 days'
         from public.academy_modules m order by m.number limit $2`,
      [p.id, passed],
    );
  }
  if (place === "signed") {
    await s.q.query("insert into public.safeguarding_declarations (person_id, version, signed_name) values ($1, '2026-11-s1', 'Folake Example')", [p.id]);
  }
  if (extras.includes("workshops")) await workshops(s);
}

/** Two workshops with a few dates each, the way the office opens them. Made once. */
async function workshops(s: Stage) {
  if ((await s.one("select count(*)::int as n from public.academy_sessions where starts_at > now() + interval '48 hours'"))!.n as number >= 3) return;
  const at = (days: number, hourLagos: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hourLagos - 1, 0, 0, 0);
    return d.toISOString();
  };
  const rows: [string, string, string, string][] = [
    ["practice_workshop", at(9, 17), "online", "A video link comes to you once you book"],
    ["practice_workshop", at(16, 10), "in_person", "The church hall, first floor"],
    ["commissioning_workshop", at(23, 17), "online", "A video link comes to you once you book"],
    ["commissioning_workshop", at(30, 10), "in_person", "The church hall, first floor"],
  ];
  for (const [kind, starts, mode, place] of rows) {
    await s.q.query("insert into public.academy_sessions (kind, starts_at, mode, place, capacity) values ($1::public.academy_session_kind, $2, $3, $4, 30)", [kind, starts, mode, place]);
  }
}

/** A few times the panel has opened, and, once she has chosen one, hers. */
async function interviewSlots(s: Stage, applicationId: string, booked: boolean) {
  const open = await s.one("select count(*)::int as n from public.interview_slots where application_id is null and starts_at > now() + interval '48 hours'");
  if ((open!.n as number) < 4) {
    const days = [3, 3, 4, 4, 5, 5];
    const hours = [10, 11, 10, 11, 15, 16];
    for (let i = 0; i < days.length; i++) {
      const at = new Date();
      at.setUTCDate(at.getUTCDate() + days[i]);
      at.setUTCHours(hours[i] - 1, 0, 0, 0); // Lagos is one hour ahead of UTC
      await s.q.query("insert into public.interview_slots (starts_at, minutes, mode, place, panel) values ($1, 20, $2, $3, 'Two panelists')", [
        at.toISOString(),
        i % 2 === 0 ? "online" : "in_person",
        i % 2 === 0 ? "A video link comes to you once you book" : "The church office, second floor",
      ]);
    }
  }
  if (booked) {
    await s.q.query(
      "update public.interview_slots set application_id = $1, booked_at = now() where id = (select id from public.interview_slots where application_id is null and starts_at > now() + interval '48 hours' order by starts_at limit 1)",
      [applicationId],
    );
  }
}

/** The church has a place where members are waiting, and offers it to her. */
async function offerFor(s: Stage, personId: string) {
  await arrange(s, "member-has-matches");
  const goal = await s.one(
    "select g.id, c.id as community_id from public.season_goals g join public.communities c on c.id = g.community_id where c.slug = 'professionals' and g.active order by g.id limit 1",
  );
  const season = await s.one("select id from public.seasons order by starts_on limit 1");
  await s.q.query(
    "insert into public.leader_offers (goal_id, person_id, season_id, waiting_at_offer) values ($1, $2, $3, 3)",
    [goal!.id, personId, season!.id],
  );
}

/** The throwaway site's database, the made-up people and the owner's door, ready for arranging situations. */
export async function makeStage(): Promise<{ stage: Stage; q: Client }> {
  const q = await db();
  const adapter = testDbFor(q);
  const k = await makeKit(adapter);
  const stage: Stage = {
    q,
    adapter,
    k,
    one: async (sql, args = []) => (await q.query(sql, args)).rows[0],
    all: async (sql, args = []) => (await q.query(sql, args)).rows,
    owner: null as never,
    flags: new Set(),
  };
  stage.owner = await ownerDoor(q, `pictures.owner.${Date.now()}@example.org`, "river-lantern-mango-cobalt");
  await ARRANGE.__site(stage);
  return { stage, q };
}

/**
 * A page that is not a fixed address: a name starting with "@" is worked out from the site as it is now (a link in an email, a tribe's
 * own page). An ordinary path is returned as it is.
 */
export async function pathFor(s: Stage, path: string): Promise<string> {
  if (!path.startsWith("@")) return path;
  const fn = PATHS[path];
  if (!fn) throw new Error(`there is no page called "${path}"`);
  return fn(s);
}

const secret = () => crypto.randomBytes(32).toString("hex");

/** The tribe in the season that has not begun, and that season's id. */
async function nextSeasonTribe(s: Stage) {
  await arrange(s, "next-season");
  const t = (await s.one("select t.id, t.season_id from public.tribes t join public.seasons x on x.id = t.season_id where x.name = 'Season 2, 2027' limit 1"))!;
  return { tribe: t.id as string, season: t.season_id as string };
}

/** Puts a person in the future season's tribe, placed by the church and not yet confirmed, and returns the seat. */
async function placedSeat(s: Stage, personId: string, tribe: string, season: string) {
  await s.q.query("delete from public.tribe_members where person_id = $1 and season_id = $2", [personId, season]);
  const row = await s.one(
    `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by, placement_source)
     values ($1, $2, $3, 1, 91, 'test', '{}'::jsonb, current_date + 14, 'auto') returning id`,
    [tribe, personId, season],
  );
  return row!.id as string;
}

export const PATHS: Record<string, (s: Stage) => Promise<string>> = {
  /** The private link a referee is emailed. Each call makes a new unsent reference, so every picture starts from the same place. */
  async "@referee"(s) {
    const p = await person(s, "referee-applicant", "Ngozi");
    await s.q.query("delete from public.leader_applications where person_id = $1", [p.id]);
    const app = await s.one(
      `insert into public.leader_applications (person_id, status, step, answers, consent_version, submitted_at)
       values ($1, 'submitted', 'review', '{}'::jsonb, '2026-10-l1', now()) returning id`,
      [p.id],
    );
    const token = secret();
    await s.q.query(
      `insert into public.leader_references (application_id, slot, referee_name, relationship, contact, is_pastor_or_unit_head, token_hash, token_expires_at)
       values ($1, 1, 'Pastor Ife Example', 'Your unit head at church', 'ife.example@example.org', true, public.referee_token_hash($2), now() + interval '30 days')`,
      [app!.id, token],
    );
    return `/reference/${token}`;
  },
  /** The private link a parent is emailed when a young person asks for permission. Each call starts it unanswered. */
  async "@guardian"(s) {
    const teen = await person(s, "teen", "Tolu");
    await s.q.query("delete from public.guardian_consents where person_id = $1", [teen.id]);
    const token = secret();
    await s.q.query(
      `insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, token_hash, token_expires_at)
       values ($1, 'Mrs Ada Example', 'mother', 'ada.example@example.org', public.referee_token_hash($2), now() + interval '7 days')`,
      [teen.id, token],
    );
    return `/guardian/${token}`;
  },
  /** The same parent's link after saying yes, once the young person has a tribe. */
  async "@guardian-approved"(s) {
    const teen = await person(s, "teen", "Tolu");
    const { tribe, season } = await nextSeasonTribe(s);
    await s.q.query("delete from public.guardian_consents where person_id = $1", [teen.id]);
    const token = secret();
    await s.q.query(
      `insert into public.guardian_consents (person_id, guardian_name, relationship, guardian_email, token_hash, token_expires_at, status, consent_version, answered_at, answers)
       values ($1, 'Mrs Ada Example', 'mother', 'ada.example@example.org', public.referee_token_hash($2), now() + interval '7 days', 'approved', 'g1', now(), 1)`,
      [teen.id, token],
    );
    await s.q.query("delete from public.tribe_members where person_id = $1 and season_id = $2", [teen.id, season]);
    await s.q.query(
      `insert into public.tribe_members (tribe_id, person_id, season_id, chosen_rank, degree, agreement_version, covenant, first_meeting_by)
       values ($1, $2, $3, 1, 90, 'test', '{}'::jsonb, current_date + 14)`,
      [tribe, teen.id, season],
    );
    return `/guardian/${token}`;
  },
  /** The private link a member is emailed when the church has placed them in a tribe. Each call starts it unanswered. */
  async "@placed"(s) {
    const { tribe, season } = await nextSeasonTribe(s);
    const p = await person(s, "placed", "Ruth");
    if (!(await s.one("select 1 as there from public.member_profiles where person_id = $1 and season_id = $2", [p.id, season]))) await s.k.profile(p.id, season, { age: "33-40", gender: "female" });
    const seat = await placedSeat(s, p.id, tribe, season);
    const token = secret();
    await s.q.query(
      "insert into public.placement_tokens (token_hash, placement_id, person_id, expires_at) values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), $2, $3, now() + interval '14 days')",
      [token, seat, p.id],
    );
    return `/placed/${token}`;
  },
  /** The page where a member confirms choosing one of the tribes that fit them. */
  async "@choose-tribe"(s) {
    await arrange(s, "member-has-matches");
    const t = await s.one("select id from public.tribes where name = 'Halima’s Builders tribe' limit 1");
    return `/tribe/choose/${t!.id}`;
  },
};
