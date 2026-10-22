/**
 * The list a leader picks their goal from, when the church has let them choose (tribe_goal_hints). The database decides what is on it:
 * the goals with a signed-off card, in the leader's own community unless the church let them choose the community too, without the
 * sensitive ones unless a pastor cleared the leader (the goal they were started on is always there). This file reads it and says it in words.
 */

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

export type GoalItem = { id: string; slug: string; title: string; community: string; communityName: string; waiting: number; started: boolean };

export type GoalHints = {
  /** The church let them choose the community as well. */
  communityToo: boolean;
  started: string | null;
  current: string | null;
  name: string;
  community: string | null;
  goal: string | null;
  lines: { god: string; others: string; life: string };
  goals: GoalItem[];
};

/** Reads the answer. Null when there is no list for this leader (the ordinary case) or the answer is not usable. */
export function parseGoalHints(json: unknown): GoalHints | null {
  if (!isObject(json) || !Array.isArray(json.goals)) return null;
  const goals = json.goals.flatMap((g): GoalItem[] => {
    if (!isObject(g)) return [];
    const id = strOrNull(g.id);
    const slug = strOrNull(g.slug);
    const title = strOrNull(g.title);
    if (!id || !slug || !title) return [];
    return [{ id, slug, title, community: str(g.community), communityName: str(g.community_name), waiting: int(g.waiting), started: g.started === true }];
  });
  if (goals.length === 0) return null;
  const lines = isObject(json.lines) ? json.lines : {};
  return {
    communityToo: json.community_too === true,
    started: strOrNull(json.started),
    current: strOrNull(json.current),
    name: str(json.name),
    community: strOrNull(json.community),
    goal: strOrNull(json.goal),
    lines: { god: str(lines.god), others: str(lines.others), life: str(lines.life) },
    goals,
  };
}

/** The line above the list. */
export const choiceLine = (communityToo: boolean): string =>
  communityToo
    ? "The church has let you choose your community and your goal. The one you were started on is marked."
    : "The church has let you choose your goal. The one you were started on is marked.";

export const STARTED_LABEL = "The one you were started on";

/** How many people are waiting for a goal. Never who. */
export function waitingLine(n: number): string {
  if (n <= 0) return "No one is waiting yet";
  return n === 1 ? "1 person is waiting" : `${n} people are waiting`;
}
