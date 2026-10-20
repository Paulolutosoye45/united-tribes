/**
 * Find your tribe, as the application form sees it. The database does the comparing (leader_fit_run) and returns only what a leader
 * may see: tribes, a match word, a percentage and up to three plain reasons. This file reads that answer and keeps to those fields,
 * so anything else the database might ever add can never reach the screen. Nothing here works out a score.
 */

import type { LeaderAnswers } from "./answers";

export type FitLabel = "excellent" | "strong" | "good" | "stretch";
const LABELS: readonly string[] = ["excellent", "strong", "good", "stretch"];

export type FitOption = {
  goalId: string;
  title: string;
  community: string;
  label: FitLabel;
  /** The match percentage. Null for "stretch", which is shown as a word only. */
  degree: number | null;
  /** Up to three short sentences. Only the best three tribes have them. */
  reasons: string[];
  /** Set when a pastor will want to talk with the leader about this tribe. Shown before it is chosen. */
  note: string | null;
};

export type FitGroup = { slug: string; community: string; mine: boolean; options: FitOption[] };

export type FitPick = { goalId: string; title: string; community: string };
export type FitChoice = FitPick & { backups: FitPick[] };

export type FitView = {
  run: string;
  /** How many tribes were compared. */
  options: number;
  /** How many of the best three reached a good match. */
  shown: number;
  top: FitOption[];
  groups: FitGroup[];
  choice: FitChoice | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v : null);

function option(v: unknown): FitOption | null {
  if (!isObject(v)) return null;
  const goalId = typeof v.goal_id === "string" && UUID.test(v.goal_id) ? v.goal_id : null;
  const title = text(v.title);
  const label = typeof v.label === "string" && LABELS.includes(v.label) ? (v.label as FitLabel) : null;
  if (!goalId || !title || !label) return null;
  const degree = typeof v.degree === "number" && Number.isInteger(v.degree) && v.degree >= 0 && v.degree <= 100 ? v.degree : null;
  return {
    goalId,
    title,
    community: text(v.community) ?? "",
    label,
    degree: label === "stretch" ? null : degree,
    reasons: Array.isArray(v.reasons) ? v.reasons.map((r) => text(r, 80)).filter((r): r is string => r !== null).slice(0, 3) : [],
    note: text(v.note, 80),
  };
}

function pick(v: unknown): FitPick | null {
  if (!isObject(v)) return null;
  const goalId = typeof v.goal_id === "string" && UUID.test(v.goal_id) ? v.goal_id : null;
  const title = text(v.title);
  return goalId && title ? { goalId, title, community: text(v.community) ?? "" } : null;
}

/** Reads the screen's data. Returns null when it is not usable, which the form treats as "nothing to choose". Never throws. */
export function parseFitView(json: unknown): FitView | null {
  if (!isObject(json) || json.status !== "ok" || typeof json.run !== "string") return null;
  const top = Array.isArray(json.top) ? json.top.map(option).filter((o): o is FitOption => o !== null) : [];
  const groups: FitGroup[] = [];
  if (Array.isArray(json.groups)) {
    for (const g of json.groups) {
      if (!isObject(g)) continue;
      const options = Array.isArray(g.options) ? g.options.map((o) => option({ ...(isObject(o) ? o : {}), community: g.community })).filter((o): o is FitOption => o !== null) : [];
      const community = text(g.community);
      if (!community || options.length === 0) continue;
      groups.push({ slug: text(g.slug, 60) ?? community, community, mine: g.mine === true, options });
    }
  }
  const c = isObject(json.choice) ? pick(json.choice) : null;
  const backups = isObject(json.choice) && Array.isArray(json.choice.backups) ? json.choice.backups.map(pick).filter((p): p is FitPick => p !== null).slice(0, 2) : [];
  const total = top.length + groups.reduce((n, g) => n + g.options.length, 0);
  if (total === 0) return null;
  return {
    run: json.run,
    options: typeof json.options === "number" ? json.options : total,
    shown: typeof json.shown === "number" ? json.shown : top.length,
    top,
    groups,
    choice: c ? { ...c, backups } : null,
  };
}

/** Reads the values the form must take into its own state straight after a choice is saved. Null if they are not usable. */
export function parseSavedCalling(json: unknown): { community: string; goal: string } | null {
  if (!isObject(json)) return null;
  const community = text(json.community, 60);
  const goal = text(json.goal, 60);
  return community && goal ? { community, goal } : null;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const FIT_WORDS: Record<FitLabel, string> = { excellent: "Excellent match", strong: "Strong match", good: "Good match", stretch: "Stretch" };

/** "Strong match, 78%". A stretch is a word only. */
export function matchText(o: Pick<FitOption, "label" | "degree">): string {
  return o.label === "stretch" || o.degree === null ? FIT_WORDS.stretch : `${FIT_WORDS[o.label]}, ${o.degree}%`;
}

export const FIT_TITLE = "Find your tribe";
export const FIT_HINT = "Based on what you told us, these three look like your best fit.";
export const FIT_FEW = "Only these reached a good match.";
export const FIT_NONE = "None reached a good match yet. You can still choose any tribe below.";
export const FIT_CHANGE_NOTE = "You can come back and change your choice until you send your application.";
export const FIT_BACKUP_HINT = "Add up to two backups if you like. A backup is a tribe you would also be glad to lead. You can skip this.";
export const FIT_FAILED = "We couldn’t work out your tribes just now. Check your connection and try again.";

/** Every tribe in one flat list, best first, for the choice and the backups. */
export function allOptions(view: FitView): FitOption[] {
  return [...view.top, ...view.groups.flatMap((g) => g.options)];
}

/**
 * The answers the comparison reads, as one string: the stage of life, community and tribe, how the leader relates to the tribe, how they
 * lead best, and what they picked in the situations. The form keeps this from the last time the leader chose, so that changing one of
 * these from the review sends them back to the screen and changing anything else does not.
 */
export function fitInputKey(a: LeaderAnswers): string {
  const c = a.calling ?? {};
  const scenarios = Object.keys(a.scenarios ?? {})
    .sort()
    .map((k) => [k, a.scenarios[k as keyof LeaderAnswers["scenarios"]]?.best ?? null, a.scenarios[k as keyof LeaderAnswers["scenarios"]]?.worst ?? null]);
  return JSON.stringify([c.track ?? null, c.community ?? null, c.goal ?? null, (c.goalOther ?? "").trim() || null, c.goalRelation ?? null, a.style?.leadBest ?? null, scenarios]);
}

// ---------------------------------------------------------------------------
// A leader we already have: "Tribes you could lead next season"
// ---------------------------------------------------------------------------

export type FitMine = { options: FitOption[]; ranAt: string | null };

/** Reads leader_fit_mine. Null unless there is something to show: nothing is said for "off" or "none", and a failure shows nothing. */
export function parseFitMine(json: unknown): FitMine | null {
  if (!isObject(json) || json.status !== "ok" || !Array.isArray(json.options)) return null;
  const options = json.options
    .map(option)
    .filter((o): o is FitOption => o !== null && o.label !== "stretch")
    .slice(0, 3);
  return options.length > 0 ? { options, ranAt: text(json.ran_at, 40) } : null;
}

export const MINE_TITLE = "Tribes you could lead next season";
export const MINE_HINT = "Based on the answers on your application. Your tribe this season does not change, and nothing happens unless you and a pastor talk about it.";
