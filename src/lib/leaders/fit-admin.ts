/**
 * Tribe fit on the Admin page: where it stands, the versions of the model, and how a new version is proposed. The database holds the
 * rules (a version is never edited, only the pastor approves one, the five parts add to 100); this reads what it says and puts it in
 * words, and checks a proposal for the obvious slips before it is sent so the person does not wait for a refusal.
 */

export const WEIGHT_KEYS = ["calling", "judgement", "style", "need", "stage"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export const BAR_KEYS = ["care_bar", "unassessed_judgement"] as const;
export type BarKey = (typeof BAR_KEYS)[number];
export type Weights = Record<WeightKey | BarKey, number>;

export const WEIGHT_LABEL: Record<WeightKey | BarKey, string> = {
  calling: "Calling",
  judgement: "Judgement",
  style: "Leading style",
  need: "Need",
  stage: "Stage of life",
  care_bar: "Care bar",
  unassessed_judgement: "Judgement when not assessed",
};

export const WEIGHT_HELP: Record<WeightKey | BarKey, string> = {
  calling: "How close the leader’s own calling is to the tribe’s subject.",
  judgement: "How they did on the situations.",
  style: "How the way they lead best suits the tribe.",
  need: "How many members are waiting for this tribe and have no seat.",
  stage: "Whether the tribe is for their stage of life.",
  care_bar: "The care result a leader needs before a sensitive tribe is recommended to them.",
  unassessed_judgement: "The value used for judgement when a leader has no situations to score. Only for leaders who joined before the form had them.",
};

export type FitModel = {
  version: string;
  weights: Weights;
  minDegree: number;
  active: boolean;
  notes: string | null;
  parent: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
};

export type FitStatus = {
  on: boolean;
  ready: boolean;
  model: { version: string; approvedAt: string | null; approvedBy: string | null } | null;
  cardsSignedOff: number;
  cardsTotal: number;
  leaders: number;
  quietRun: number;
};

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

function weights(v: unknown): Weights | null {
  if (!isObject(v)) return null;
  const out = {} as Weights;
  for (const k of [...WEIGHT_KEYS, ...BAR_KEYS]) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100) return null;
    out[k] = n;
  }
  return out;
}

/** Reads the model list. Versions that are not in the expected shape are left out. */
export function parseFitModels(json: unknown): FitModel[] {
  if (!Array.isArray(json)) return [];
  const out: FitModel[] = [];
  for (const m of json) {
    if (!isObject(m)) continue;
    const version = str(m.version);
    const w = weights(m.weights);
    if (!version || !w) continue;
    out.push({
      version,
      weights: w,
      minDegree: int(m.min_degree),
      active: m.active === true,
      notes: str(m.notes),
      parent: str(m.parent),
      createdAt: str(m.created_at),
      approvedAt: str(m.approved_at),
      approvedBy: str(m.approved_by),
    });
  }
  return out;
}

/** Reads where Find your tribe stands. Null when it cannot be read. */
export function parseFitStatus(json: unknown): FitStatus | null {
  if (!isObject(json)) return null;
  const cards = isObject(json.cards) ? json.cards : {};
  const leaders = isObject(json.leaders) ? json.leaders : {};
  const m = isObject(json.model) ? json.model : null;
  const version = m ? str(m.version) : null;
  return {
    on: json.tribe_fit === "on",
    ready: json.ready === true,
    model: version ? { version, approvedAt: str(m?.approved_at), approvedBy: str(m?.approved_by) } : null,
    cardsSignedOff: int(cards.signed_off),
    cardsTotal: int(cards.total),
    leaders: int(leaders.total),
    quietRun: int(leaders.quiet_run),
  };
}

/** Why the switch cannot be turned on yet, in words. Empty when it can. */
export function whatIsMissing(s: FitStatus): string[] {
  const out: string[] = [];
  if (!s.model) out.push("The pastor has not approved a fit model yet.");
  if (s.cardsSignedOff === 0) out.push("No tribe card is signed off yet. Sign off at least one card on the review page for tribe cards.");
  return out;
}

export type Proposal = Record<WeightKey | BarKey, string>;

/** The values of a model as the form's text boxes hold them. */
export const proposalFrom = (m: FitModel | null): Proposal => ({
  calling: String(m?.weights.calling ?? ""),
  judgement: String(m?.weights.judgement ?? ""),
  style: String(m?.weights.style ?? ""),
  need: String(m?.weights.need ?? ""),
  stage: String(m?.weights.stage ?? ""),
  care_bar: String(m?.weights.care_bar ?? ""),
  unassessed_judgement: String(m?.weights.unassessed_judgement ?? ""),
});

const whole = (t: string): number | null => (/^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : null);

/** What is wrong with a proposal, in words, or the weights when nothing is. */
export function checkProposal(p: Proposal): { ok: true; weights: Weights; total: number } | { ok: false; message: string; total: number | null } {
  const values = {} as Weights;
  for (const k of [...WEIGHT_KEYS, ...BAR_KEYS]) {
    const n = whole(p[k]);
    if (n === null) return { ok: false, message: `${WEIGHT_LABEL[k]} must be a whole number from 0 to 100.`, total: null };
    if (n > 100) return { ok: false, message: `${WEIGHT_LABEL[k]} cannot be more than 100.`, total: null };
    values[k] = n;
  }
  const total = WEIGHT_KEYS.reduce((sum, k) => sum + values[k], 0);
  if (total !== 100) return { ok: false, message: `The five parts add up to ${total}. They must add up to 100.`, total };
  return { ok: true, weights: values, total };
}

/** Only the numbers that differ from the version it starts from are sent; the database fills in the rest from the latest version. */
export function changedWeights(from: Weights, to: Weights): Partial<Weights> {
  const out: Partial<Weights> = {};
  for (const k of [...WEIGHT_KEYS, ...BAR_KEYS]) if (from[k] !== to[k]) out[k] = to[k];
  return out;
}

/** "Calling 35, judgement 20, style 20, need 15, stage of life 10". */
export function weightsLine(w: Weights): string {
  return WEIGHT_KEYS.map((k) => `${WEIGHT_LABEL[k].toLowerCase()} ${w[k]}`).join(", ");
}

/** One sentence for what a quiet run did, from the database's counts. */
export function quietSentence(r: { ran: number; already: number; noInputs: number; noApplication: number }): string {
  const parts = [`${r.ran} ${r.ran === 1 ? "leader was" : "leaders were"} looked at`];
  if (r.already > 0) parts.push(`${r.already} had been done already`);
  if (r.noInputs > 0) parts.push(`${r.noInputs} could not be done because their saved answers are not complete`);
  if (r.noApplication > 0) parts.push(`${r.noApplication} have no application on file`);
  return `${parts.join(", ")}.`;
}

/** Reads what the quiet run gives back. */
export function parseQuiet(json: unknown): { ran: number; already: number; noInputs: number; noApplication: number } | null {
  if (!isObject(json)) return null;
  return { ran: int(json.ran), already: int(json.already), noInputs: int(json.no_inputs), noApplication: int(json.no_application) };
}
