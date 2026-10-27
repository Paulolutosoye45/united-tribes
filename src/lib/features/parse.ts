import { FEATURE_KEYS, POSITIONS, SCOPES, type FeatureBoard, type FeatureKey, type FeatureLogLine, type FeatureRow, type FeatureState, type FeatureStates, type FeaturesOverview, type Found, type Position, type Rule, type Scope, type Summary } from "./types";

// What the database answers is data, not a promise. Each answer is read defensively: anything that is not the shape expected becomes
// "nothing", so a screen shows "not available" rather than breaking, and a function the database does not know yet is simply Off.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

export const isFeatureKey = (v: unknown): v is FeatureKey => typeof v === "string" && (FEATURE_KEYS as readonly string[]).includes(v);
export const isPosition = (v: unknown): v is Position => typeof v === "string" && (POSITIONS as readonly string[]).includes(v);
export const isScope = (v: unknown): v is Scope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);
const SUMMARIES: readonly Summary[] = ["off", "rehearsal", "limited", "on", "optional", "required"];
const summaryOf = (v: unknown): Summary => (typeof v === "string" && (SUMMARIES as readonly string[]).includes(v) ? (v as Summary) : "off");
const keys = (v: unknown): FeatureKey[] => arr(v).filter(isFeatureKey);

/** What a screen asks once: every function this release builds, for the signed-in person. Anything unreadable is Off. */
export function parseStates(v: unknown): FeatureStates {
  const out: FeatureStates = {};
  if (!isObj(v)) return out;
  for (const k of FEATURE_KEYS) {
    const s = v[k];
    if (s === "rehearsal" || s === "on" || s === "optional" || s === "required") out[k] = s as FeatureState;
  }
  return out;
}

function parseRule(raw: unknown): Rule | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !isScope(raw.scope) || !isPosition(raw.position)) return null;
  return {
    id: raw.id,
    scope: raw.scope,
    scopeId: strOrNull(raw.scopeId),
    label: str(raw.label, "Unnamed"),
    position: raw.position,
    roles: strings(raw.roles),
    reason: strOrNull(raw.reason),
    holdoutUntil: strOrNull(raw.holdoutUntil),
    at: str(raw.at),
  };
}

export function parseBoard(v: unknown): FeatureBoard | null {
  if (!isObj(v) || typeof v.paused !== "boolean") return null;
  const features: FeatureRow[] = [];
  for (const raw of arr(v.features)) {
    if (!isObj(raw) || !isFeatureKey(raw.key)) continue;
    features.push({
      key: raw.key,
      name: str(raw.name, raw.key),
      blurb: str(raw.blurb),
      stage: num(raw.stage, 1),
      depends: keys(raw.depends),
      modes: arr(raw.modes).filter(isPosition),
      default: isPosition(raw.default) ? raw.default : "off",
      available: raw.available === true,
      summary: summaryOf(raw.summary),
      rules: arr(raw.rules).flatMap((r) => parseRule(r) ?? []),
    });
  }
  return { paused: v.paused, pausedReason: strOrNull(v.pausedReason), pausedAt: strOrNull(v.pausedAt), features };
}

export function parseLog(v: unknown): FeatureLogLine[] {
  return arr(v).flatMap((raw) => {
    if (!isObj(raw) || typeof raw.id !== "number") return [];
    return [
      {
        id: raw.id,
        at: str(raw.at),
        feature: strOrNull(raw.feature),
        name: strOrNull(raw.name),
        scope: str(raw.scope),
        label: strOrNull(raw.label),
        from: strOrNull(raw.from),
        to: strOrNull(raw.to),
        roles: strings(raw.roles),
        reason: strOrNull(raw.reason),
      },
    ];
  });
}

export function parseOverview(v: unknown): FeaturesOverview | null {
  if (!isObj(v) || typeof v.paused !== "boolean") return null;
  return {
    paused: v.paused,
    features: arr(v.features).flatMap((raw) =>
      isObj(raw) && isFeatureKey(raw.key)
        ? [{ key: raw.key, name: str(raw.name, raw.key), blurb: str(raw.blurb), stage: num(raw.stage, 1), available: raw.available === true, summary: summaryOf(raw.summary), depends: keys(raw.depends) }]
        : [],
    ),
    log: arr(v.log).flatMap((raw) =>
      isObj(raw) ? [{ at: str(raw.at), by: str(raw.by, "an administrator"), name: strOrNull(raw.name), label: strOrNull(raw.label), from: strOrNull(raw.from), to: strOrNull(raw.to), reason: strOrNull(raw.reason) }] : [],
    ),
  };
}

export function parseFound(v: unknown): Found[] {
  return arr(v).flatMap((raw) => (isObj(raw) && typeof raw.id === "string" ? [{ id: raw.id, label: str(raw.label, "Unnamed") }] : []));
}
