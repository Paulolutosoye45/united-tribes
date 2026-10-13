import type { Answers } from "@/lib/intake/answers";
import { settleSuggested } from "@/lib/intake/heard";
import { CHILDREN, GROUP_ROLES, RELATIONSHIPS, WORK_FIELDS, WORK_STATUSES } from "@/lib/intake/options";
import type { StepId } from "@/lib/intake/steps";
import { suggestTimes } from "@/lib/intake/times";
import { blend, type AiPick } from "./blend";
import type { Profile } from "./profile";
import {
  finalize,
  pickBaseline,
  pickFaith,
  pickHeard,
  pickMode,
  pickRoles,
  pickServing,
  pickStyle,
  rankGoals,
  rankCommunities,
  type HeardField,
  type Pick,
  type Rankable,
  type StylePick,
} from "./rank";

/**
 * Turns what the Companion knows into what each screen shows, and decides what may be filled in for the person.
 * It is all plain functions of the answers, so the same inputs always give the same screen and every rule here
 * is covered by a unit test.
 */

/** The answers the Companion can fill in. Every other answer is only ever the person's own. */
export type FieldKey = "workStatus" | "workField" | "relationship" | "children" | "community" | "secondCommunity" | "goal" | "meetingMode" | "times" | "groupRoles";

/** Who last set an answer. "picked" is the Companion's, until the person taps it or moves on; after that it is theirs. */
export type Origin = Partial<Record<FieldKey, "picked" | "person">>;

export const STEP_FIELDS: Partial<Record<StepId, FieldKey[]>> = {
  heard: ["workStatus", "workField", "relationship", "children"],
  community: ["community", "secondCommunity"],
  goal: ["goal"],
  rhythm: ["meetingMode", "times"],
  style: ["groupRoles"],
};

export type AiInput = {
  community?: readonly AiPick[];
  goal?: readonly AiPick[];
  heard?: Partial<Record<HeardField, readonly AiPick[]>>;
  roles?: readonly AiPick[];
};

export type PickContext = {
  communities: readonly Rankable[];
  /** The goals of the community the person chose (none until they have). */
  goals: readonly Rankable[];
  ai?: AiInput;
  /** "Not this one": ids the person turned down, by question. */
  rejected?: Partial<Record<"community" | "goal", readonly string[]>>;
  /** The gifts the person has chosen (or been given) on the style screen. */
  roles?: readonly string[];
};

export type Picks = {
  community: Pick[];
  goal: Pick[];
  heard: Record<HeardField, Pick[]>;
  heardNotes: Partial<Record<HeardField, string>>;
  roles: Pick[];
  faith: Pick | null;
  serving: Pick | null;
  baseline: Pick | null;
  mode: Pick | null;
  style: Partial<Record<string, StylePick>>;
};

const ids = (list: readonly { id: string }[]) => new Set(list.map((o) => o.id));
const HEARD_OPTIONS: Record<HeardField, ReadonlySet<string>> = {
  work_status: ids(WORK_STATUSES),
  work_field: ids(WORK_FIELDS),
  relationship: ids(RELATIONSHIPS),
  children: ids(CHILDREN),
};

export function computePicks(profile: Profile, ctx: PickContext): Picks {
  const turnedDown = (field: "community" | "goal") => new Set(ctx.rejected?.[field] ?? []);
  const withoutRejected = <T extends { id: string }>(list: readonly T[], field: "community" | "goal") => {
    const out = turnedDown(field);
    return list.filter((x) => !out.has(x.id));
  };

  const communityIds = new Set(ctx.communities.map((t) => t.id));
  const community = blend(
    finalize(withoutRejected(rankCommunities(profile, ctx.communities), "community"), "sure", { singles: true }),
    withoutRejected(ctx.ai?.community ?? [], "community"),
    { policy: "sure", singles: true, known: communityIds },
  );

  const goalIds = new Set(ctx.goals.map((g) => g.id));
  const goal =
    ctx.goals.length === 0
      ? []
      : blend(
          finalize(withoutRejected(rankGoals(profile, ctx.goals), "goal"), "sure", { singles: true }),
          withoutRejected(ctx.ai?.goal ?? [], "goal"),
          { policy: "sure", singles: true, known: goalIds },
        );

  const engineHeard = pickHeard(profile);
  const heard = {} as Record<HeardField, Pick[]>;
  for (const field of Object.keys(engineHeard.picks) as HeardField[]) {
    const multi = field === "children";
    const mixed = blend(engineHeard.picks[field], ctx.ai?.heard?.[field] ?? [], {
      policy: "sure",
      singles: !multi,
      max: multi ? 3 : 2,
      known: HEARD_OPTIONS[field],
    });
    if (multi) {
      // "No children" cannot sit beside any other answer; the positive statement wins.
      const keep = settleSuggested("children", mixed.map((p) => p.id));
      heard[field] = mixed.filter((p) => keep.includes(p.id));
    } else heard[field] = mixed;
  }

  const roles = blend(pickRoles(profile), ctx.ai?.roles ?? [], {
    policy: "likely",
    max: 2,
    known: ids(GROUP_ROLES),
  });
  const roleIds = ctx.roles && ctx.roles.length > 0 ? ctx.roles : roles.filter((r) => r.autofill).map((r) => r.id);

  return {
    community,
    goal,
    heard,
    heardNotes: engineHeard.notes,
    roles,
    faith: pickFaith(profile),
    serving: pickServing(profile),
    baseline: pickBaseline(profile),
    mode: pickMode(profile),
    style: pickStyle(profile, roleIds),
  };
}

/** The best other community, offered as a second choice. Only a fair fit is offered, never a guess from the age group. */
export function secondChoice(communities: readonly Pick[], first: string | undefined): Pick | null {
  return communities.find((p) => p.id !== first && p.tier !== "guess") ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// What may be filled in
// ---------------------------------------------------------------------------------------------------------------------

type Value = string | number | readonly string[] | undefined;

const read = (a: Answers, field: FieldKey): Value => a[field] as Value;
const empty = (v: Value) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const same = (x: Value, y: Value) =>
  Array.isArray(x) && Array.isArray(y) ? [...x].sort().join("|") === [...y].sort().join("|") : x === y;

export type Plan = { patch: Partial<Answers>; filled: FieldKey[]; cleared: FieldKey[] };

/**
 * What to fill in when a screen opens, or when better information arrives while it is open. An answer is the
 * Companion's to set only while it is empty and untouched, or while it is still the Companion's own pick; once the
 * person has tapped it or moved on, it is theirs and never changes under them. If a pick the Companion made earlier no
 * longer holds (the person changed their story, say), it is taken back rather than left standing.
 */
export function fillPlan(
  view: StepId,
  a: Answers,
  origin: Origin,
  picks: Picks,
  context: { zone?: string; kids?: boolean },
): Plan {
  const patch: Record<string, Value> = {};
  const filled: FieldKey[] = [];
  const cleared: FieldKey[] = [];
  const effective = (field: FieldKey): Value => (field in patch ? patch[field] : read(a, field));

  const may = (field: FieldKey) => origin[field] === "picked" || (empty(read(a, field)) && origin[field] !== "person");
  const set = (field: FieldKey, value: Value) => {
    if (!may(field)) return;
    if (empty(value)) {
      if (origin[field] === "picked" && !empty(read(a, field))) {
        patch[field] = undefined;
        cleared.push(field);
      }
      return;
    }
    if (!same(read(a, field), value)) {
      patch[field] = value;
      filled.push(field);
    }
  };

  if (view === "heard") {
    const fill = (list: Pick[]) => list.filter((p) => p.autofill).map((p) => p.id);
    set("workStatus", fill(picks.heard.work_status)[0]);
    set("workField", fill(picks.heard.work_field)[0]);
    set("relationship", fill(picks.heard.relationship)[0]);
    set("children", fill(picks.heard.children));
  }

  if (view === "community") {
    const top = picks.community.find((p) => p.autofill);
    if (!a.communityOther?.trim()) set("community", top?.id);
    // A goal belongs to its community: if the community changes, the goal is chosen again.
    if ("community" in patch && a.goal && read(a, "community") !== patch.community) {
      patch.goal = undefined;
      cleared.push("goal");
    }
    const first = effective("community") as string | undefined;
    const second = first ? secondChoice(picks.community, first) : null;
    set("secondCommunity", second?.id);
  }

  if (view === "goal" && !a.goalOther?.trim()) {
    set("goal", picks.goal.find((p) => p.autofill)?.id);
  }

  if (view === "rhythm") {
    const mode = picks.mode?.autofill ? picks.mode.id : undefined;
    set("meetingMode", mode);
    const chosenMode = effective("meetingMode") as string | undefined;
    if (chosenMode) {
      const times = suggestTimes({
        zone: context.zone as never,
        mode: chosenMode as never,
        work: a.workStatus,
        kids: context.kids,
      }).map((s) => s.id as string);
      set("times", times);
    }
  }

  if (view === "style") {
    set("groupRoles", picks.roles.filter((p) => p.autofill).map((p) => p.id));
  }

  return { patch: patch as Partial<Answers>, filled, cleared };
}

/** Which answers on a screen are still the Companion's own pick: they become the person's when they move on. */
export function acceptOnLeaving(view: StepId, origin: Origin): Origin {
  const fields = STEP_FIELDS[view] ?? [];
  const next: Origin = { ...origin };
  for (const f of fields) if (next[f] === "picked") next[f] = "person";
  return next;
}
