// The compatibility test written a second time, in plain TypeScript, so a test can hold the database to it. If the two ever disagree,
// one of them has drifted. The formulas are the ones in docs/LEADER-FIT.md; the weights come from the model row, never typed here.

export type Weights = { calling: number; judgement: number; style: number; need: number; stage: number; care_bar: number; unassessed_judgement: number };
export type Model = { weights: Weights; min_degree: number };

export type Card = {
  goalId: string;
  slug: string;
  communityId: string;
  familyId: string;
  tracks: string[];
  demand: { structure: number; connection: number; teaching: number; doing: number };
  sensitive: boolean;
};

export type GoalInfo = { id: string; slug: string; communityId: string; familyId: string };

export type Inputs = {
  track: string | null;
  community: string | null;
  goal: string | null;
  relation: "achieved" | "pursuing" | null;
  lead_best: "structure" | "connection" | "teaching" | "doing" | null;
  judgement: number | null;
  care: number | null;
};

export type World = {
  cards: Card[];
  goalsBySlug: Record<string, GoalInfo>;
  communityIds: Record<string, string>;
  /** Active tracks in order: the position of a track among them is its rank. */
  trackOrder: string[];
  /** Members waiting less seats open, for each goal. */
  gap: Record<string, number>;
};

export type RefOption = {
  goal_id: string;
  closeness: number;
  calling: number;
  judgement: number;
  style: number;
  need: number;
  stage: number;
  degree: number;
  label: string;
  next_to: boolean;
  care_flag: boolean;
  recommended: boolean;
  ord: number;
  rec_rank: number | null;
};

const label = (d: number) => (d >= 85 ? "excellent" : d >= 70 ? "strong" : d >= 60 ? "good" : "low");

/** Half up for the positive numbers used here. */
const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export function referenceOptions(inputs: Inputs, world: World, model: Model): RefOption[] {
  const { weights: w } = model;
  if (!inputs.track || !inputs.lead_best) return [];
  const rank = world.trackOrder.indexOf(inputs.track);
  if (rank < 0) return [];

  let communityId = inputs.community ? (world.communityIds[inputs.community] ?? null) : null;
  let goal: GoalInfo | null = inputs.goal ? (world.goalsBySlug[inputs.goal] ?? null) : null;
  if (goal && communityId && goal.communityId !== communityId) goal = null; // a goal left over from another community is not one they named
  else if (goal && !communityId) communityId = goal.communityId;

  const judgementPart = inputs.judgement === null ? w.unassessed_judgement : Math.min(100, Math.max(0, roundHalfUp(inputs.judgement)));
  const relationPct = inputs.relation === "achieved" ? 100 : 80;

  const rows = world.cards
    .map((card) => {
      const dist = Math.min(...card.tracks.map((t) => (world.trackOrder.includes(t) ? Math.abs(world.trackOrder.indexOf(t) - rank) : Infinity)));
      if (!(dist <= 1)) return null;
      const closeness = goal && card.goalId === goal.id ? 100 : goal && card.familyId === goal.familyId ? 60 : communityId && card.communityId === communityId ? 40 : 10;
      const demandLead = card.demand[inputs.lead_best!];
      const demandMax = Math.max(card.demand.structure, card.demand.connection, card.demand.teaching, card.demand.doing);
      const gap = world.gap[card.goalId] ?? 0;
      const calling = Math.floor((closeness * relationPct) / 100);
      const style = Math.floor((200 * demandLead + demandMax) / (2 * demandMax));
      const need = Math.floor((200 * Math.min(12, Math.max(0, gap)) + 12) / 24);
      const stage = dist === 0 ? 100 : 60;
      const degree = Math.floor((w.calling * calling + w.judgement * judgementPart + w.style * style + w.need * need + w.stage * stage + 50) / 100);
      const careFlag = card.sensitive && (inputs.care === null || inputs.care < w.care_bar);
      return {
        goal_id: card.goalId, closeness, calling, judgement: judgementPart, style, need, stage, degree, label: label(degree),
        next_to: dist === 1, care_flag: careFlag, recommended: degree >= model.min_degree && !careFlag,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const byOrder = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    b.degree - a.degree || b.calling - a.calling || b.need - a.need || (a.goal_id < b.goal_id ? -1 : a.goal_id > b.goal_id ? 1 : 0);
  const sorted = [...rows].sort(byOrder);
  let recRank = 0;
  return sorted.map((r, i) => ({ ...r, ord: i + 1, rec_rank: r.recommended ? ++recRank : null }));
}

/** A small seeded generator, so a failing case can be reproduced. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
