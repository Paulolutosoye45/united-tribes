import { readText } from "./lexicon";
import { TRAITS, isTender, type Kind, type Trait } from "./traits";

/**
 * What the Companion knows about one person at this moment, built fresh from their answers every time
 * (nothing is stored, nothing leaves the phone). A fact is a trait plus how sure we are and where it came from:
 *
 *   answer  they told us directly, by tapping an option or choosing a zone    (strongest)
 *   story   we read it in the words they wrote or spoke
 *   words   they added it in the "tell us in a few words" box
 *   prior   a gentle starting guess from their age group; it only orders lists and never fills anything in
 */
export type Source = "answer" | "story" | "words" | "prior";
export type Fact = {
  trait: Trait;
  strength: number;
  source: Source;
  quote?: string;
  /** Facts that come from the same words or the same answer count once when scoring, so one mention is not counted three times. */
  group: string;
};

export const ANSWER_STRENGTH = 4;
const CHIP_MIN = 2.2;

export type ProfileInput = {
  ageRange?: string;
  ageLabel?: string;
  zone?: string;
  story?: string;
  words?: string;
  /** Only answers the person has made their own (not ones the Companion filled in for them). */
  answers?: {
    workStatus?: string;
    workField?: string;
    relationship?: string;
    children?: readonly string[];
  };
  /** Traits the person has said are wrong ("not me"). They stop counting at once. */
  dismissed?: readonly string[];
  /** Traits to listen to less, because the person chose something that did not rely on them. 0 to 1. */
  discount?: Readonly<Record<string, number>>;
};

const WORK: Record<string, Trait> = {
  employed: "employed",
  self_employed: "self_employed",
  student: "student",
  nysc: "nysc",
  between_jobs: "between_jobs",
  homemaker: "homemaker",
  retired: "retired",
};
const FIELD: Record<string, Trait> = {
  finance: "f_finance",
  tech: "f_tech",
  health: "f_health",
  education: "f_education",
  creative: "f_creative",
  law_public: "f_law_public",
  engineering_trades: "f_engineering_trades",
  agriculture_food: "f_agriculture_food",
  ministry_ngo: "f_ministry_ngo",
  trade_retail: "f_trade_retail",
};
const RELATION: Record<string, Trait> = { single: "single", courting: "courting", engaged: "engaged", married: "married" };
const CHILD: Record<string, Trait> = {
  none: "c_none",
  expecting: "c_expecting",
  under_12: "c_under_12",
  teens: "c_teens",
  adult: "c_adult",
};

/** The trait behind one of the "We heard…" options, so removing an option can tell the Companion "not me". */
export function traitOfAnswer(field: "work_status" | "work_field" | "relationship" | "children", id: string): Trait | undefined {
  const table = field === "work_status" ? WORK : field === "work_field" ? FIELD : field === "relationship" ? RELATION : CHILD;
  return table[id];
}

const WORK_GROUP: readonly Trait[] = [...Object.values(WORK), "consultant"];
const FIELD_GROUP: readonly Trait[] = Object.values(FIELD);
const RELATION_GROUP: readonly Trait[] = Object.values(RELATION);
const CHILD_GROUP: readonly Trait[] = Object.values(CHILD);

/**
 * A starting guess from the age group: only enough to put the likeliest communities and goals first when someone has
 * written nothing. It is weak on purpose (it can never beat a word the person wrote) and it is never used to fill in
 * who someone is. Gender is deliberately not used: it says nothing reliable about someone's work, marriage or goals.
 */
const PRIORS: Record<string, Partial<Record<Trait, number>>> = {
  "18-25": { student: 0.7, nysc: 0.5, between_jobs: 0.4, employed: 0.5, single: 0.5, t_study: 0.5, t_skills: 0.4 },
  "26-32": { employed: 0.7, t_career: 0.6, self_employed: 0.45, t_business: 0.4, courting: 0.4, married: 0.4, t_prep: 0.3 },
  "33-40": { employed: 0.7, married: 0.6, c_under_12: 0.5, t_parenting: 0.5, t_career: 0.5, self_employed: 0.5, t_leadership: 0.4 },
  "41-50": { employed: 0.6, married: 0.6, c_teens: 0.6, t_parenting: 0.4, t_leadership: 0.5, self_employed: 0.4, t_calling: 0.3 },
  "51-60": { married: 0.6, c_teens: 0.4, c_adult: 0.5, employed: 0.4, t_leadership: 0.5, t_calling: 0.5, t_health: 0.4 },
  "60-plus": { retired: 0.7, c_adult: 0.6, married: 0.4, t_calling: 0.5, t_health: 0.5 },
};

export type Chip = { trait: Trait; label: string; kind: Kind; source: Source; quote?: string };

export type Profile = {
  readonly facts: ReadonlyMap<Trait, Fact>;
  readonly ageLabel?: string;
  readonly zone?: string;
  /** Word stems the person wrote, with the word as they wrote it, for matching items the office added. */
  readonly stems: ReadonlyMap<string, string>;
  /** How many distinct things we know from the person themselves, not from their age group. */
  readonly known: number;
  readonly depth: 0 | 1 | 2 | 3;
  strength(trait: Trait): number;
  fact(trait: Trait): Fact | undefined;
  chips(): Chip[];
};

const GENERIC = new Set(
  "people person season goal goals work works working build building help helps helping more with that this their from have into your what when where which about group groups life lives live living time year years things thing want wants need needs make makes making over some also very much many most than then they them were been being just like love good better best able".split(" "),
);

/** A word reduced to its stem, for matching what the office wrote against what the person wrote. */
export function stemOf(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function stemsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/[^A-Za-z]+/)) {
    if (raw.length < 4 || GENERIC.has(raw.toLowerCase())) continue;
    const stem = stemOf(raw);
    if (stem.length >= 4 && !out.has(stem)) out.set(stem, raw);
  }
  return out;
}

export function buildProfile(input: ProfileInput): Profile {
  const facts = new Map<Trait, Fact>();
  const dismissed = new Set(input.dismissed ?? []);
  const put = (f: Fact) => {
    const have = facts.get(f.trait);
    if (!have || f.strength > have.strength || (f.source === "answer" && have.source !== "answer")) facts.set(f.trait, f);
  };

  // 1. Gentle priors, weakest of all.
  for (const [trait, strength] of Object.entries(PRIORS[input.ageRange ?? ""] ?? {})) {
    put({ trait: trait as Trait, strength: strength as number, source: "prior", group: `prior:${trait}` });
  }

  // 2. What they wrote, then what they added in a few words.
  const sources: [string | undefined, Source][] = [
    [input.story, "story"],
    [input.words, "words"],
  ];
  for (const [text, source] of sources) {
    if (!text) continue;
    for (const hit of readText(text)) {
      if (dismissed.has(hit.trait)) continue;
      put({ trait: hit.trait, strength: hit.weight, source, quote: hit.quote, group: `${source}:${hit.quote.toLowerCase()}` });
    }
  }

  // 3. What they told us directly. These win over everything else in the same group.
  const a = input.answers ?? {};
  const answer = (trait: Trait | undefined, group: string, strength = ANSWER_STRENGTH) => {
    if (trait) put({ trait, strength, source: "answer", group: `answer:${group}` });
  };
  const clearGroup = (group: readonly Trait[], keep: readonly Trait[]) => {
    for (const trait of group) {
      const f = facts.get(trait);
      if (f && f.source !== "answer" && !keep.includes(trait)) facts.delete(trait);
    }
  };
  if (a.workStatus && WORK[a.workStatus]) {
    const t = WORK[a.workStatus];
    clearGroup(WORK_GROUP, t === "self_employed" ? [t, "consultant"] : [t]);
    answer(t, "work");
  }
  if (a.workField && FIELD[a.workField]) {
    const t = FIELD[a.workField];
    clearGroup(FIELD_GROUP, [t]);
    answer(t, "field");
  }
  if (a.relationship) {
    const t = RELATION[a.relationship];
    clearGroup(RELATION_GROUP, t ? [t] : []);
    answer(t, "relationship");
    if (t === "married") answer("t_marriage", "relationship", 1.8);
    if (t === "engaged") answer("t_prep", "relationship", 2.6);
    if (a.relationship === "widowed" || a.relationship === "separated") answer("t_rebuild", "relationship", 2);
  }
  if (a.children && a.children.length > 0) {
    const mapped = a.children.map((c) => CHILD[c]).filter(Boolean) as Trait[];
    clearGroup(CHILD_GROUP, mapped);
    for (const t of mapped) answer(t, "children");
    if (mapped.some((t) => t !== "c_none")) {
      answer("c_some", "children", 3);
      if (mapped.some((t) => t === "c_under_12" || t === "c_teens" || t === "c_expecting")) answer("t_parenting", "children", 2.2);
    }
  }
  if (input.zone === "abroad") answer("t_abroad", "zone", 3.5);

  // Grown children are not a parenting season: stop a bare mention of "our children" from pulling toward parenting.
  const grown = facts.get("c_adult");
  const younger = ["c_under_12", "c_teens", "c_expecting"].some((t) => (facts.get(t as Trait)?.strength ?? 0) >= 1.6);
  if (grown && grown.source !== "prior" && grown.strength >= 2.4 && !younger) {
    const parenting = facts.get("t_parenting");
    if (parenting && parenting.source !== "answer") facts.delete("t_parenting");
    const some = facts.get("c_some");
    if (some && some.source !== "answer") facts.set("c_some", { ...some, strength: some.strength * 0.5 });
  }

  // After a loss or a break-up, do not read "single" or "marriage" as a plain status or a happy topic.
  const loss = facts.get("t_rebuild");
  if (loss && loss.source !== "prior" && loss.strength >= 2) {
    for (const trait of ["single", "t_marriage", "t_prep"] as Trait[]) {
      const f = facts.get(trait);
      if (f && f.source !== "answer") facts.delete(trait);
    }
  }

  // 4. The person's own "not me" and "listen less to that" always have the last word on anything not told directly.
  for (const [trait, f] of [...facts]) {
    if (f.source === "answer") continue;
    if (dismissed.has(trait)) {
      facts.delete(trait);
      continue;
    }
    const cut = input.discount?.[trait];
    if (cut && cut > 0) facts.set(trait, { ...f, strength: f.strength * (1 - Math.min(cut, 0.85)) });
  }

  const stems = new Map<string, string>();
  for (const text of [input.story, input.words]) {
    if (text) for (const [stem, word] of stemsOf(text.slice(0, 1500))) if (!stems.has(stem)) stems.set(stem, word);
  }

  const real = [...facts.values()].filter((f) => f.source !== "prior" && f.strength >= 1.6 && !isTender(f.trait) && TRAITS[f.trait].kind !== "progress");
  const known = real.length;
  const depth: 0 | 1 | 2 | 3 = known === 0 ? 0 : known <= 1 ? 1 : known <= 3 ? 2 : 3;

  const self: Profile = {
    facts,
    ageLabel: input.ageLabel,
    zone: input.zone,
    stems,
    known,
    depth,
    strength: (trait) => facts.get(trait)?.strength ?? 0,
    fact: (trait) => facts.get(trait),
    chips: () => chipsOf(facts),
  };
  return self;
}

const KIND_ORDER: Kind[] = ["work", "field", "relationship", "children", "place", "topic"];

/** Topic chips that would only repeat a more specific one already showing. */
const COVERED_BY: Partial<Record<Trait, readonly Trait[]>> = {
  t_business: ["self_employed", "consultant", "t_launch", "t_grow"],
  t_marriage: ["married", "engaged", "t_prep"],
  t_parenting: ["c_under_12", "c_teens", "c_expecting", "c_adult", "c_none"],
  t_study: ["student", "t_exam"],
  t_career: ["employed", "t_leadership", "t_switch"],
  t_health: ["t_fitness"],
  t_launch: ["self_employed"],
  t_clients: ["consultant"],
  t_move: ["t_abroad"],
};

function chipsOf(facts: ReadonlyMap<Trait, Fact>): Chip[] {
  const candidates = [...facts.values()].filter((f) => {
    const def = TRAITS[f.trait];
    return "chip" in def && def.chip && f.source !== "prior" && f.strength >= CHIP_MIN && !isTender(f.trait);
  });
  const shown = new Set(candidates.map((f) => f.trait));
  return candidates
    .filter((f) => !(COVERED_BY[f.trait] ?? []).some((t) => shown.has(t)))
    .sort((x, y) => KIND_ORDER.indexOf(TRAITS[x.trait].kind) - KIND_ORDER.indexOf(TRAITS[y.trait].kind) || y.strength - x.strength)
    .slice(0, 7)
    .map((f) => ({
      trait: f.trait,
      label: (TRAITS[f.trait] as { chip: string }).chip,
      kind: TRAITS[f.trait].kind,
      source: f.source,
      quote: f.quote,
    }));
}
