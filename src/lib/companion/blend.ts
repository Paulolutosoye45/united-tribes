import { finalize, type Pick, type Policy, type Raw } from "./rank";

/**
 * Adds an AI service's picks to the Companion's own, when the person agreed to the assistant and it answered in time.
 * The Companion's picks are already on screen, so the assistant can only strengthen, add or reword: a pick it agrees
 * with rises (and may become "sure"), one it alone found is added as "likely", and its reason, which points at the
 * person's own words, replaces ours.
 */
export type AiPick = { id: string; reason?: string };

const BOOST = [6, 4.4, 3];

export function blend(
  engine: readonly Pick[],
  ai: readonly AiPick[],
  opts: { policy: Policy; max?: number; singles?: boolean; known?: ReadonlySet<string> },
): Pick[] {
  if (ai.length === 0) return [...engine];
  const byId = new Map<string, Raw>(
    engine.map((p) => {
      const { tier, autofill, ...rest } = p;
      void tier;
      void autofill;
      return [p.id, { ...rest, real: p.tier !== "guess", gentle: p.reason === "Fits what you wrote" }];
    }),
  );
  ai.forEach((a, i) => {
    if (opts.known && !opts.known.has(a.id)) return;
    const boost = BOOST[Math.min(i, BOOST.length - 1)];
    const have = byId.get(a.id);
    const reason = a.reason?.trim();
    if (have) {
      byId.set(a.id, {
        ...have,
        score: have.score + boost,
        via: have.via === "engine" ? "both" : have.via,
        real: true,
        reason: reason || have.reason,
        why: reason ? [reason, ...have.why.filter((w) => w !== reason)].slice(0, 4) : have.why,
      });
    } else {
      byId.set(a.id, {
        id: a.id,
        score: boost,
        via: "ai",
        real: true,
        reason: reason || "Fits what you wrote",
        why: [reason || "Your assistant picked this from what you wrote"],
        from: [],
      });
    }
  });
  return finalize([...byId.values()], opts.policy, { max: opts.max, singles: opts.singles });
}
