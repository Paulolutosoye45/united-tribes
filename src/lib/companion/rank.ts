import { CHILDREN, GROUP_ROLES, RELATIONSHIPS, STYLE_PAIRS, WORK_FIELDS, WORK_STATUSES, type StyleKey } from "@/lib/intake/options";
import { GOAL_AFFINITY_EXTRA } from "./goal-extras";
import type { Fact, Profile } from "./profile";
import { TRAITS, isTender, type Trait } from "./traits";

/**
 * How sure the Companion is of a pick, which decides what the screen does with it:
 *   sure    clearly ahead of the rest: it is filled in for the person, marked "Picked for you", and one tap changes it
 *   likely  a good fit: shown first with its reason, filled in only where a wrong guess costs nothing
 *   guess   a starting point from the age group or a faint cue: shown, never filled in
 */
export type Tier = "sure" | "likely" | "guess";
export type Via = "engine" | "ai" | "both";

export type Pick = {
  id: string;
  score: number;
  tier: Tier;
  /** One line in the person's own words, shown under the pick. */
  reason: string;
  /** The longer list behind "Why this?". */
  why: string[];
  via: Via;
  /** Whether the screen may fill this in for the person without a tap. */
  autofill: boolean;
  /** The traits that led here, so a correction can teach the Companion what to listen to less. */
  from: Trait[];
};

export type Raw = Omit<Pick, "tier" | "autofill"> & {
  real: boolean;
  /** The pick rests on something painful or private: it may be shown, but never as "sure" and never filled in. */
  gentle?: boolean;
};

export const THRESHOLDS = { sure: 7, margin: 3.5, likely: 3, guess: 0.4, minReal: 1.6 } as const;

/** What a screen may fill in by itself for a question. */
export type Policy = "sure" | "likely" | "never";

/**
 * Sorts, drops what does not fit at all, and sets each pick's tier and whether it may be filled in.
 * Only the leader of a list can be "sure", and only when it is clearly ahead of the next.
 */
export function finalize(raws: readonly Raw[], policy: Policy, opts: { max?: number; singles?: boolean } = {}): Pick[] {
  const sorted = [...raws].filter((r) => r.score >= THRESHOLDS.guess).sort((a, b) => b.score - a.score);
  const picks: Pick[] = sorted.map((r, i) => {
    const lead = i === 0 && r.real && r.score >= THRESHOLDS.sure && r.score - (sorted[1]?.score ?? 0) >= THRESHOLDS.margin;
    const tier: Tier = lead && !r.gentle ? "sure" : r.real && r.score >= THRESHOLDS.likely ? "likely" : "guess";
    const { real, gentle, ...rest } = r;
    void real;
    void gentle;
    return { ...rest, tier, autofill: false };
  });
  const out = picks.slice(0, opts.max ?? picks.length);
  const fillable = out.filter((p) => (policy === "sure" ? p.tier === "sure" : policy === "likely" ? p.tier !== "guess" : false));
  for (const p of opts.singles ? fillable.slice(0, 1) : fillable) p.autofill = true;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Explaining a pick in the person's own words
// ---------------------------------------------------------------------------------------------------------------------

type Contribution = { fact: Fact; amount: number };

function sayFact(f: Fact): string {
  if (isTender(f.trait)) return "You shared something that fits this";
  if ((f.source === "story" || f.source === "words") && f.quote) return `You ${f.source === "story" ? "wrote" : "added"} “${f.quote}”`;
  const phrase = "phrase" in TRAITS[f.trait] ? (TRAITS[f.trait] as { phrase?: string }).phrase : undefined;
  if (f.source === "answer" && phrase) return `You said ${phrase}`;
  return "";
}

export function explain(contribs: readonly Contribution[], profile: Profile): { reason: string; why: string[] } {
  const ranked = [...contribs].sort((a, b) => b.amount - a.amount);
  const real = ranked.filter((c) => c.fact.source !== "prior");
  const why: string[] = [];
  const seen = new Set<string>();
  for (const c of real) {
    const line = sayFact(c.fact);
    if (line && !seen.has(line)) {
      seen.add(line);
      why.push(line);
    }
    if (why.length >= 4) break;
  }
  if (real.length === 0 && ranked.length > 0) {
    why.push(profile.ageLabel ? `A natural place to start at ${profile.ageLabel}` : "A natural place to start");
  }
  const top = real[0]?.fact;
  let reason = why[0] ?? "";
  if (top && isTender(top.trait)) reason = "Fits what you wrote";
  else if (top?.source === "answer" && real[1] && real[1].fact.source === "answer") {
    const a = sayFact(top).replace(/^You said /, "");
    const b = sayFact(real[1].fact).replace(/^You said /, "");
    if (a && b) reason = `Because ${a} and ${b}`;
  } else if (top?.source === "answer") reason = reason.replace(/^You said /, "Because ");
  return { reason, why };
}

// ---------------------------------------------------------------------------------------------------------------------
// Communities and goals
// ---------------------------------------------------------------------------------------------------------------------

type Aff = Partial<Record<Trait, number>>;

/** How strongly each starter community is signalled by each trait. Communities the office adds later are matched by their own words. */
export const COMMUNITY_AFFINITY: Record<string, Aff> = {
  "business-entrepreneurship": { self_employed: 3, t_business: 3, t_launch: 2.5, t_grow: 2.5, f_trade_retail: 1.2, f_agriculture_food: 1, f_creative: 0.4, consultant: 0.6 },
  professionals: { employed: 3, t_career: 2, t_leadership: 2.5, t_switch: 1.5, f_finance: 1.5, f_tech: 1.5, f_engineering_trades: 1.5, f_law_public: 1.5, nysc: 1 },
  consulting: { consultant: 3.5, t_clients: 2.5, t_pricing: 2, self_employed: 0.7, f_finance: 0.4, f_tech: 0.4 },
  "in-between-jobs": { between_jobs: 4, t_jobsearch: 3, nysc: 0.8, t_skills: 1, student: 0.3 },
  "global-citizens": { t_abroad: 4, t_move: 3, t_distance: 3 },
  "marriage-relationships": { engaged: 3.5, t_prep: 3, t_marriage: 3, married: 2, courting: 2, t_rebuild: 3, single: 0.3 },
  "parents-family": { t_parenting: 3.5, c_under_12: 3, c_teens: 3, c_expecting: 3, c_some: 2.5, t_home: 2.5, c_adult: 1, homemaker: 1.5, married: 0.8 },
  "health-fitness-sports": { t_fitness: 3.5, t_health: 2.5, t_milestone: 2, t_habit: 1.2 },
  education: { student: 3, f_education: 3, t_study: 3, t_exam: 2, t_teach: 2.5, nysc: 0.8 },
  "medical-healthcare": { f_health: 4, t_specialise: 2, t_burnout: 1 },
  "creative-economy": { f_creative: 3.5, t_creative: 3, t_release: 2.5, t_income: 1 },
};

export const GOAL_AFFINITY: Record<string, Aff> = {
  "launch-or-formalise-a-business": { t_launch: 3.5, t_business: 1.2, self_employed: 0.8 },
  "grow-revenue-and-systems": { t_grow: 3.5, self_employed: 1.5, t_business: 1 },
  "step-into-a-leadership-role": { t_leadership: 3.5, employed: 1 },
  "change-career-direction-with-confidence": { t_switch: 3.5, t_calling: 1, t_career: 1 },
  "build-a-steady-client-pipeline": { t_clients: 3, consultant: 1.5 },
  "price-and-package-my-expertise": { t_pricing: 3, consultant: 1 },
  "land-my-next-role": { t_jobsearch: 3, between_jobs: 2 },
  "retool-with-new-skills": { t_skills: 3, t_study: 1 },
  "thrive-in-a-long-distance-family": { t_distance: 3.5, t_abroad: 1 },
  "make-a-cross-border-move-well": { t_move: 3.5, t_abroad: 1.5 },
  "strengthen-our-marriage": { married: 3, t_marriage: 2 },
  "prepare-well-for-marriage": { engaged: 3.5, t_prep: 3, courting: 1.5 },
  "rebuild-after-a-relationship-ends": { t_rebuild: 3 },
  "build-a-faith-filled-home-rhythm": { t_home: 3.5, c_under_12: 1.5, t_parenting: 1, married: 0.5 },
  "parent-teenagers-well": { c_teens: 4, t_parenting: 1.5 },
  "build-a-consistent-fitness-habit": { t_fitness: 3, t_habit: 2.5 },
  "reach-a-health-milestone": { t_milestone: 3, t_health: 1.5, t_fitness: 1 },
  "excel-in-my-studies-or-exams": { t_exam: 3.5, student: 2.5, t_study: 2 },
  "grow-as-an-educator": { f_education: 3, t_teach: 2.5 },
  "sustain-my-calling-without-burning-out": { t_burnout: 3, t_calling: 2.5, f_health: 1 },
  "advance-my-specialisation": { t_specialise: 3.5, f_health: 1 },
  "finish-and-release-a-body-of-work": { t_release: 3.5, f_creative: 1.2 },
  "turn-my-craft-into-income": { t_income: 3, f_creative: 1.2, self_employed: 1 },
};

/** The 23 goals above plus the 77 added with the 100 Tribe Cards. A goal in neither is matched by its own words, as before. */
const ALL_GOAL_AFFINITY: Record<string, Aff> = { ...GOAL_AFFINITY_EXTRA, ...GOAL_AFFINITY };

export type Rankable = { id: string; name: string; description?: string };

/** Contributions of the profile's facts to an item that has a table of affinities. */
function fromAffinity(profile: Profile, aff: Aff): Contribution[] {
  // The same words (or the same answer) can show several traits; they count once, at their strongest.
  const byGroup = new Map<string, Contribution>();
  for (const [trait, weight] of Object.entries(aff) as [Trait, number][]) {
    const f = profile.fact(trait);
    if (!f) continue;
    const amount = weight * f.strength;
    const have = byGroup.get(f.group);
    if (!have || amount > have.amount) byGroup.set(f.group, { fact: f, amount });
  }
  return [...byGroup.values()];
}

/** For communities and goals the office added: how many of their own words the person used. */
function fromWords(profile: Profile, item: Rankable): Contribution[] {
  const out: Contribution[] = [];
  const mine = new Set([...profile.stems.keys()]);
  for (const [stem, word] of stemsOfItem(item)) {
    if (mine.has(stem)) {
      const quote = profile.stems.get(stem) ?? word;
      out.push({ fact: { trait: "t_business", strength: 2, source: "story", quote, group: `story:${quote.toLowerCase()}` }, amount: 1.6 });
    }
    if (out.length >= 3) break;
  }
  return out;
}

const stemCache = new Map<string, Map<string, string>>();
function stemsOfItem(item: Rankable) {
  const key = `${item.name}|${item.description ?? ""}`;
  let cached = stemCache.get(key);
  if (!cached) {
    cached = new Map();
    for (const raw of `${item.name} ${item.description ?? ""}`.split(/[^A-Za-z]+/)) {
      if (raw.length < 5) continue;
      const lower = raw.toLowerCase();
      if (["people", "season", "starting", "running", "growing", "building"].includes(lower)) continue;
      let w = lower;
      for (const suffix of ["ing", "ed", "es", "s"]) if (w.length > suffix.length + 3 && w.endsWith(suffix)) { w = w.slice(0, -suffix.length); break; }
      if (!cached.has(w)) cached.set(w, raw);
    }
    stemCache.set(key, cached);
  }
  return cached;
}

function rawFor(profile: Profile, item: Rankable, table: Record<string, Aff>): Raw {
  const aff = table[item.id];
  const contribs = aff ? fromAffinity(profile, aff) : fromWords(profile, item);
  const score = contribs.reduce((sum, c) => sum + c.amount, 0);
  const { reason, why } = explain(contribs, profile);
  const real = contribs.some((c) => c.fact.source !== "prior" && c.fact.strength >= THRESHOLDS.minReal);
  const lead = [...contribs].sort((a, b) => b.amount - a.amount)[0];
  const gentle = Boolean(lead && isTender(lead.fact.trait) && lead.fact.source !== "prior");
  return { gentle, id: item.id, score, reason, why, via: "engine", real, from: aff ? contribs.filter((c) => c.fact.source !== "prior").map((c) => c.fact.trait) : [] };
}

export function rankCommunities(profile: Profile, communities: readonly Rankable[]): Raw[] {
  return communities.map((t) => rawFor(profile, t, COMMUNITY_AFFINITY));
}

export function rankGoals(profile: Profile, goals: readonly Rankable[]): Raw[] {
  return goals.map((g) => rawFor(profile, g, ALL_GOAL_AFFINITY));
}

// ---------------------------------------------------------------------------------------------------------------------
// The "We heard…" questions
// ---------------------------------------------------------------------------------------------------------------------

const WORK_IDS: [Trait, string][] = [
  ["employed", "employed"],
  ["self_employed", "self_employed"],
  ["consultant", "self_employed"],
  ["between_jobs", "between_jobs"],
  ["student", "student"],
  ["nysc", "nysc"],
  ["homemaker", "homemaker"],
  ["retired", "retired"],
];
const FIELD_IDS: [Trait, string][] = [
  ["f_finance", "finance"],
  ["f_tech", "tech"],
  ["f_health", "health"],
  ["f_education", "education"],
  ["f_creative", "creative"],
  ["f_law_public", "law_public"],
  ["f_engineering_trades", "engineering_trades"],
  ["f_agriculture_food", "agriculture_food"],
  ["f_ministry_ngo", "ministry_ngo"],
  ["f_trade_retail", "trade_retail"],
];
const RELATION_IDS: [Trait, string][] = [
  ["single", "single"],
  ["courting", "courting"],
  ["engaged", "engaged"],
  ["married", "married"],
];
const CHILD_IDS: [Trait, string][] = [
  ["c_none", "none"],
  ["c_expecting", "expecting"],
  ["c_under_12", "under_12"],
  ["c_teens", "teens"],
  ["c_adult", "adult"],
];

/** Things only the person's own words or taps can show: never the age group. */
const told = (profile: Profile, trait: Trait): Fact | undefined => {
  const f = profile.fact(trait);
  return f && f.source !== "prior" ? f : undefined;
};

function fromTraits(profile: Profile, map: readonly [Trait, string][], min = THRESHOLDS.minReal): Raw[] {
  const best = new Map<string, Raw>();
  for (const [trait, id] of map) {
    const f = told(profile, trait);
    if (!f || f.strength < min) continue;
    const { reason, why } = explain([{ fact: f, amount: f.strength }], profile);
    const have = best.get(id);
    if (!have || f.strength * 3 > have.score) {
      best.set(id, { id, score: f.strength * 3, reason, why, via: "engine", real: true, from: [trait] });
    }
  }
  return [...best.values()];
}

export type HeardField = "work_status" | "work_field" | "relationship" | "children";
export type HeardPicks = { picks: Record<HeardField, Pick[]>; notes: Partial<Record<HeardField, string>> };

/** Heard picks use the strength of the words directly: a clear phrase (2.4 or more) is filled in, a faint one is only suggested. */
function settleSingle(raws: Raw[]): Pick[] {
  const picks = finalizeByStrength(raws);
  const top = picks[0];
  const second = picks[1];
  if (top && second && top.score - second.score < 1.8) for (const p of picks) p.autofill = false;
  return picks;
}

function finalizeByStrength(raws: Raw[]): Pick[] {
  return raws
    .sort((a, b) => b.score - a.score)
    .map((r, i) => {
      const clear = r.score >= 2.4 * 3;
      const { real, ...rest } = r;
      void real;
      return { ...rest, tier: clear ? "sure" : "likely", autofill: clear && i === 0 } as Pick;
    });
}

export function pickHeard(profile: Profile): HeardPicks {
  const children = finalizeByStrength(fromTraits(profile, CHILD_IDS)).map((p) => ({ ...p, autofill: p.tier === "sure" }));
  // "No children" cannot sit beside any other answer; the positive statement wins.
  const positive = children.filter((p) => p.id !== "none");
  const kids = positive.length > 0 ? positive : children;
  const notes: HeardPicks["notes"] = {};
  if (positive.length === 0 && children.length === 0 && told(profile, "c_some")) {
    notes.children = "You mentioned your children. Tap the ages that fit.";
  }
  return {
    picks: {
      work_status: settleSingle(fromTraits(profile, WORK_IDS)),
      work_field: settleSingle(fromTraits(profile, FIELD_IDS)),
      relationship: settleSingle(fromTraits(profile, RELATION_IDS)),
      children: kids.slice(0, 3),
    },
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Roles, faith, serving, progress, style, meeting
// ---------------------------------------------------------------------------------------------------------------------

const ROLE_IDS: [Trait, string][] = GROUP_ROLES.map((r) => [`role_${r.id}` as Trait, r.id]);

export function pickRoles(profile: Profile): Pick[] {
  return finalizeByStrength(fromTraits(profile, ROLE_IDS))
    .slice(0, 2)
    .map((p) => ({ ...p, autofill: true }));
}

const FAITH_ORDER: [Trait, string][] = [
  ["faith_leading", "leading"],
  ["faith_established", "established"],
  ["faith_new", "new"],
  ["faith_exploring", "exploring"],
  ["faith_growing", "growing"],
];

/** Only when the person says it. Never filled in: where someone is with God is theirs to say. */
export function pickFaith(profile: Profile): Pick | null {
  for (const [trait, id] of FAITH_ORDER) {
    const f = told(profile, trait);
    if (f && f.strength >= 2.4) {
      const { reason, why } = explain([{ fact: f, amount: f.strength }], profile);
      return { id, score: f.strength * 3, tier: "likely", reason, why, via: "engine", autofill: false, from: [trait] };
    }
  }
  return null;
}

export function pickServing(profile: Profile): Pick | null {
  const no = told(profile, "serve_not_now");
  const yes = told(profile, "serve_yes") ?? told(profile, "faith_leading");
  const f = yes ?? no;
  if (!f || f.strength < 2.4) return null;
  const { reason, why } = explain([{ fact: f, amount: f.strength }], profile);
  return { id: yes ? "yes" : "not_now", score: f.strength * 3, tier: "likely", reason, why, via: "engine", autofill: false, from: [f.trait] };
}

export function pickBaseline(profile: Profile): Pick | null {
  const levels = ([1, 2, 3, 4, 5] as const).map((n) => ({ n, f: told(profile, `p_${n}` as Trait) })).filter((x) => x.f && x.f.strength >= 2.4);
  if (levels.length === 0) return null;
  const lo = Math.min(...levels.map((l) => l.n));
  const hi = Math.max(...levels.map((l) => l.n));
  if (hi - lo >= 2) return null;
  const top = levels.sort((a, b) => (b.f?.strength ?? 0) - (a.f?.strength ?? 0) || a.n - b.n)[0];
  const f = top.f as Fact;
  const { reason, why } = explain([{ fact: f, amount: f.strength }], profile);
  return { id: String(top.n), score: f.strength * 3, tier: "likely", reason, why, via: "engine", autofill: false, from: [f.trait] };
}

/** The online-or-in-person answer that people outside Lagos have no real choice about. */
export function pickMode(profile: Profile): Pick | null {
  const zone = profile.zone;
  if (zone === "abroad") {
    return { id: "online", score: 10, tier: "sure", reason: "Because you’re based outside Nigeria, your tribe meets online", why: ["You said you’re based outside Nigeria", "Tribes meet online for members abroad"], via: "engine", autofill: true, from: ["t_abroad"] };
  }
  if (zone === "other-nigeria") {
    return { id: "online", score: 5, tier: "likely", reason: "Online fits when you’re outside Lagos", why: ["You said you’re based elsewhere in Nigeria", "Most tribes meet in Lagos or online"], via: "engine", autofill: false, from: [] };
  }
  return null;
}

type Lean = -1 | 1;
export type StylePick = { lean: Lean; reason: string };

const STYLE_CUES: Record<StyleKey, { left: Trait[]; right: Trait[] }> = {
  styleSocial: { left: ["st_quiet"], right: ["st_social"] },
  styleStructure: { left: ["st_flow"], right: ["st_plan"] },
  styleOpenness: { left: ["st_steady"], right: ["st_new"] },
  styleDirectness: { left: ["st_peace"], right: ["st_direct"] },
  styleDisclosure: { left: ["st_open_slow", "st_quiet"], right: ["st_open_fast"] },
  styleLearning: { left: ["st_doing"], right: ["st_talking"] },
};

/** The gifts that lean one way on a this-or-that pair, at a lower weight than a person's own plain words. */
const ROLE_LEANS: Partial<Record<StyleKey, { left: string[]; right: string[] }>> = {
  styleSocial: { left: [], right: ["host", "connector", "encourager"] },
  styleStructure: { left: [], right: ["organiser"] },
  styleDirectness: { left: ["peacemaker"], right: ["truth_teller"] },
  styleLearning: { left: [], right: ["thinker"] },
};

/** Leans for the six this-or-that pairs, only where the person's own words or chosen gifts point clearly one way. */
export function pickStyle(profile: Profile, roles: readonly string[]): Partial<Record<StyleKey, StylePick>> {
  const out: Partial<Record<StyleKey, StylePick>> = {};
  for (const pair of STYLE_PAIRS) {
    const cues = STYLE_CUES[pair.key];
    const side = (traits: Trait[], roleIds: string[]) => {
      let score = 0;
      let reason = "";
      for (const t of traits) {
        const f = told(profile, t);
        if (f) {
          score = Math.max(score, f.strength);
          if (f.quote) reason = `You wrote “${f.quote}”`;
        }
      }
      for (const id of roleIds) {
        if (roles.includes(id)) {
          const label = GROUP_ROLES.find((r) => r.id === id)?.label ?? id;
          if (score < 2.4) {
            score = Math.max(score, 2.4);
            reason = `${/^[aeiou]/i.test(label) ? "An" : "A"} ${label} often feels this way`;
          }
        }
      }
      return { score, reason };
    };
    const left = side(cues.left, ROLE_LEANS[pair.key]?.left ?? []);
    const right = side(cues.right, ROLE_LEANS[pair.key]?.right ?? []);
    if (Math.max(left.score, right.score) < 2.4 || Math.abs(left.score - right.score) < 0.6) continue;
    out[pair.key] = left.score > right.score ? { lean: -1, reason: left.reason } : { lean: 1, reason: right.reason };
  }
  return out;
}

/** Option labels, for screens and tests that need the words behind an id. */
export const LABELS = {
  work_status: new Map<string, string>(WORK_STATUSES.map((o) => [o.id, o.label])),
  work_field: new Map<string, string>(WORK_FIELDS.map((o) => [o.id, o.label])),
  relationship: new Map<string, string>(RELATIONSHIPS.map((o) => [o.id, o.label])),
  children: new Map<string, string>(CHILDREN.map((o) => [o.id, o.label])),
};
