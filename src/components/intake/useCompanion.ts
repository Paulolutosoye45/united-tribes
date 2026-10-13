"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  STEP_FIELDS,
  acceptOnLeaving,
  buildProfile,
  computePicks,
  fillPlan,
  secondChoice,
  starterSentences,
  traitOfAnswer,
  type AiInput,
  type FieldKey,
  type Origin,
  type Pick,
  type Picks,
  type Trait,
} from "@/lib/companion";
import type { Answers } from "@/lib/intake/answers";
import { isStepId, type StepId } from "@/lib/intake/steps";
import type { Catalogue } from "./types";
import type { KnownFacts, useHeard, useSuggestions } from "./useSuggestions";

/**
 * The Companion on the form: it listens to what the person writes, fills in what it can with a clear reason, and gets
 * sharper with every answer. It is a thin layer over the plain functions in src/lib/companion, which hold every rule
 * and are covered by unit tests. Everything here happens on the phone; the only thing that can leave it is the optional
 * request to the AI service, and only if the person agreed to that.
 *
 * Who owns an answer:
 *   picked  the Companion filled it in and the person has not touched it yet. It may change if better information arrives.
 *   person  the person tapped it or moved on. It never changes under them again, and it counts as something they told us.
 */

const FIELD_KEYS: readonly FieldKey[] = ["workStatus", "workField", "relationship", "children", "community", "secondCommunity", "goal", "meetingMode", "times", "groupRoles"];
const isFieldKey = (key: string): key is FieldKey => (FIELD_KEYS as readonly string[]).includes(key);

type Value = string | number | readonly string[] | undefined;
const isEmpty = (v: Value) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const keyOf = (v: Value) => JSON.stringify(Array.isArray(v) ? [...v].sort() : (v ?? null));

/** Answers that came with a saved draft or a finished form are the person's own. */
function originOf(answers: Answers): Origin {
  const out: Origin = {};
  for (const f of FIELD_KEYS) if (!isEmpty(answers[f] as Value)) out[f] = "person";
  return out;
}

const HEARD_FIELD_OF: Partial<Record<FieldKey, "work_status" | "work_field" | "relationship" | "children">> = {
  workStatus: "work_status",
  workField: "work_field",
  relationship: "relationship",
  children: "children",
};

type Shown = { ids: string[]; via: Pick["via"] };
const ID = /^[a-z0-9_-]{1,96}$/;

/** What each screen showed, by the name the quality log uses for the question. */
function snapshot(view: StepId, p: Picks, answers: Answers): Record<string, Shown | null> {
  const list = (picks: readonly Pick[], max = 5): Shown | null =>
    picks.length === 0 ? null : { ids: picks.slice(0, max).map((x) => x.id), via: picks[0].via };
  const one = (pick: Pick | null): Shown | null => (pick ? { ids: [pick.id], via: pick.via } : null);
  switch (view) {
    case "heard":
      return {
        work_status: list(p.heard.work_status, 3),
        work_field: list(p.heard.work_field, 3),
        relationship: list(p.heard.relationship, 3),
        children: list(p.heard.children, 3),
      };
    case "community":
      return { community: list(p.community), community_second: one(secondChoice(p.community, answers.community)) };
    case "goal":
      return { season_goal: list(p.goal) };
    case "style":
      return { group_roles: list(p.roles, 3) };
    case "faith":
      return { faith: one(p.faith) };
    case "care":
      return { serving: one(p.serving) };
    case "success":
      return { baseline: one(p.baseline) };
    default:
      return {};
  }
}

/** The answer a logged question is about, so the log can say whether the Companion filled it in. */
const LOGGED_FIELD: Record<string, FieldKey | undefined> = {
  community: "community",
  community_second: "secondCommunity",
  season_goal: "goal",
  work_status: "workStatus",
  work_field: "workField",
  relationship: "relationship",
  children: "children",
  group_roles: "groupRoles",
};

type View = StepId | "welcome" | "done";

/** Whether the person turned suggestions off. It lasts on this phone; where storage is blocked it lasts for the visit. */
const OFF_KEY = "ut-companion";
let offThisVisit = false;
const watchers = new Set<() => void>();
function watchOff(notify: () => void) {
  watchers.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    watchers.delete(notify);
    window.removeEventListener("storage", notify);
  };
}
function readOff(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) === "off";
  } catch {
    return offThisVisit;
  }
}
function writeOff(off: boolean) {
  offThisVisit = off;
  try {
    window.localStorage.setItem(OFF_KEY, off ? "off" : "on");
  } catch {
    /* the choice lasts only for this visit */
  }
  for (const notify of watchers) notify();
}

export type CompanionArgs = {
  view: View;
  answers: Answers;
  /** The form's own setter: it saves an answer and nothing else. */
  rawSet: (patch: Partial<Answers>) => void;
  initialAnswers: Answers;
  catalogue: Catalogue;
  sugg: ReturnType<typeof useSuggestions>;
  heard: ReturnType<typeof useHeard>;
  /** The AI service may be asked (the person agreed, it is set up, and they are not a young person). */
  assistantOn: boolean;
  isTeen: boolean;
};

export function useCompanion({ view, answers, rawSet, initialAnswers, catalogue, sugg, heard, assistantOn, isTeen }: CompanionArgs) {
  const on = !useSyncExternalStore(watchOff, readOff, () => false);
  const [origin, setOrigin] = useState<Origin>(() => originOf(initialAnswers));
  const [dismissed, setDismissed] = useState<Trait[]>([]);
  const [discount, setDiscount] = useState<Record<string, number>>({});
  const [rejected, setRejected] = useState<{ community: string[]; goal: string[] }>({ community: [], goal: [] });
  /** What the Companion filled in, as it stood when it did. Compared with the answer later to tell "kept" from "changed". */
  const [filled, setFilled] = useState<Partial<Record<FieldKey, string>>>({});
  const shown = useRef<Record<string, Shown>>({});

  // Young people's words are never read, not even on the phone: their picks come only from the answers they tap.
  const reads = on && !isTeen;
  const story = useDeferredValue(reads ? (answers.story ?? "") : "");
  const words = reads ? [answers.communityOther, answers.goalOther].filter(Boolean).join(". ") : "";

  // What the person has made their own, as opposed to what the Companion filled in.
  const own = (field: FieldKey) => (origin[field] === "person" ? answers[field] : undefined);
  const workStatus = own("workStatus") as string | undefined;
  const workField = own("workField") as string | undefined;
  const relationship = own("relationship") as string | undefined;
  const children = own("children") as readonly string[] | undefined;
  const known = useMemo<KnownFacts>(() => ({ workStatus, workField, relationship, children }), [workStatus, workField, relationship, children]);

  const ageLabel = catalogue.ageRanges.find((r) => r.slug === answers.ageRange)?.label;
  const profile = useMemo(
    () =>
      buildProfile({
        ageRange: on ? answers.ageRange : undefined,
        ageLabel,
        zone: answers.zone,
        story,
        words,
        answers: { workStatus, workField, relationship, children },
        dismissed,
        discount,
      }),
    [on, answers.ageRange, ageLabel, answers.zone, story, words, workStatus, workField, relationship, children, dismissed, discount],
  );
  const chips = useMemo(() => profile.chips(), [profile]);

  // The AI service's picks, if it was asked and has answered. They only ever add to the Companion's own.
  const storyForAi = answers.story ?? "";
  const communitySlug = answers.community;
  const ai = useMemo<AiInput | undefined>(() => {
    if (!assistantOn) return undefined;
    return {
      community: sugg.get("community", storyForAi, undefined, known)?.items,
      goal: communitySlug ? sugg.get("season_goal", storyForAi, communitySlug, known)?.items : undefined,
      heard: heard.get(storyForAi)?.fields,
      roles: sugg.get("group_roles", storyForAi)?.items,
    };
  }, [assistantOn, sugg, heard, storyForAi, known, communitySlug]);

  const communities = useMemo(() => catalogue.communities.map((t) => ({ id: t.slug, name: t.name, description: t.description })), [catalogue]);
  const goals = useMemo(
    () => (catalogue.communities.find((t) => t.slug === communitySlug)?.goals ?? []).map((g) => ({ id: g.slug, name: g.title })),
    [catalogue, communitySlug],
  );
  const gifts = answers.groupRoles;
  const picks = useMemo(
    () => computePicks(profile, { communities, goals, ai, rejected, roles: gifts }),
    [profile, communities, goals, ai, rejected, gifts],
  );

  const kids = (answers.children ?? []).some((c) => c === "under_12" || c === "expecting");
  const stepView = isStepId(view) ? view : null;
  const plan = useMemo(
    () => (on && stepView && STEP_FIELDS[stepView] ? fillPlan(stepView, answers, origin, picks, { zone: answers.zone, kids }) : null),
    [on, stepView, answers, origin, picks, kids],
  );
  const planKey = plan && plan.filled.length + plan.cleared.length > 0 ? `${stepView}|${JSON.stringify(plan.patch)}|${plan.cleared.join()}` : "";

  // Fill in what the plan says, once per change. Everything it sets stays the Companion's until the person taps it.
  const applied = useRef("");
  useEffect(() => {
    if (!planKey || !plan) {
      applied.current = "";
      return;
    }
    if (applied.current === planKey) return;
    applied.current = planKey;
    rawSet(plan.patch);
    setOrigin((o) => {
      const next = { ...o };
      for (const f of plan.filled) next[f] = "picked";
      for (const f of plan.cleared) delete next[f];
      return next;
    });
    setFilled((f) => {
      const next = { ...f };
      for (const field of plan.filled) next[field] = keyOf(plan.patch[field] as Value);
      for (const field of plan.cleared) delete next[field];
      return next;
    });
  }, [planKey, plan, rawSet]);

  // Remember what each screen showed, for the quality log.
  useEffect(() => {
    if (!on || !stepView) return;
    for (const [key, value] of Object.entries(snapshot(stepView, picks, answers))) {
      if (!value || value.ids.length === 0) continue;
      // Everything that was ever on offer counts as shown, including a pick the person then turned down.
      const have = shown.current[key];
      shown.current[key] = have ? { via: have.via, ids: [...have.ids, ...value.ids.filter((id) => !have.ids.includes(id))].slice(0, 8) } : value;
    }
  }, [on, stepView, picks, answers]);

  // The setters below read the latest state through refs, so they keep one identity and can sit in any effect's list.
  const live = useRef({ answers, origin, picks });
  useEffect(() => {
    live.current = { answers, origin, picks };
  });

  const penalise = useCallback((traits: readonly Trait[]) => {
    if (traits.length === 0) return;
    setDiscount((d) => {
      const next = { ...d };
      for (const t of traits) next[t] = Math.min(0.8, (next[t] ?? 0) + 0.35);
      return next;
    });
  }, []);
  const dismiss = useCallback((trait: Trait) => setDismissed((d) => (d.includes(trait) ? d : [...d, trait])), []);

  /** The person's own tap. It makes the answer theirs, and a correction teaches the Companion what to listen to less. */
  const set = useCallback(
    (patch: Partial<Answers>) => {
      const { answers: current, origin: owners, picks: shownPicks } = live.current;
      const touched = Object.keys(patch).filter(isFieldKey);
      for (const f of touched) {
        if (owners[f] !== "picked") continue;
        const before = current[f] as Value;
        const after = patch[f] as Value;
        if (keyOf(before) === keyOf(after)) continue;
        if (f === "community" || f === "goal") {
          const was = shownPicks[f].find((p) => p.id === before);
          penalise(was?.from ?? []);
        }
        const heardField = HEARD_FIELD_OF[f];
        if (heardField) {
          const gone = (Array.isArray(before) ? before : [before]).filter((id): id is string => typeof id === "string" && !(Array.isArray(after) ? after : [after]).includes(id));
          for (const id of gone) {
            const trait = traitOfAnswer(heardField, id);
            if (trait) dismiss(trait);
          }
        }
      }
      if (touched.length > 0) {
        setOrigin((o) => {
          const next = { ...o };
          for (const f of touched) next[f] = "person";
          return next;
        });
      }
      rawSet(patch);
    },
    [rawSet, penalise, dismiss],
  );

  /** "Not this one": the pick goes, and the Companion does not offer it again. The person chooses what comes next. */
  const reject = useCallback(
    (field: "community" | "goal" | "workStatus" | "workField" | "relationship" | "children", id?: string) => {
      const { answers: current, origin: owners, picks: shownPicks } = live.current;
      if (field === "community" || field === "goal") {
        if (id) {
          setRejected((r) => (r[field].includes(id) ? r : { ...r, [field]: [...r[field], id] }));
          penalise(shownPicks[field].find((p) => p.id === id)?.from ?? []);
        }
        const patch: Partial<Answers> = field === "community" ? { community: undefined, goal: undefined } : { goal: undefined };
        const cleared: FieldKey[] = field === "community" ? ["community", "goal"] : ["goal"];
        // A second choice the Companion made goes with the first; one the person chose stays.
        const dropSecond = field === "community" && owners.secondCommunity === "picked";
        if (dropSecond) patch.secondCommunity = undefined;
        setOrigin((o) => {
          const next = { ...o };
          for (const f of cleared) next[f] = "person";
          if (dropSecond) delete next.secondCommunity;
          return next;
        });
        // A pick the person turned down is not "kept", even if the same words are typed again later.
        setFilled((f) => {
          const next = { ...f };
          for (const k of dropSecond ? [...cleared, "secondCommunity" as const] : cleared) delete next[k];
          return next;
        });
        rawSet(patch);
        return;
      }
      const heardField = HEARD_FIELD_OF[field];
      const before = current[field] as Value;
      const ids = (Array.isArray(before) ? before : [before]).filter((x): x is string => typeof x === "string");
      const remove = id ? ids.filter((x) => x === id) : ids;
      const rest = ids.filter((x) => !remove.includes(x));
      for (const x of remove) {
        const trait = heardField ? traitOfAnswer(heardField, x) : undefined;
        if (trait) dismiss(trait);
      }
      setOrigin((o) => ({ ...o, [field]: "person" }));
      rawSet({ [field]: field === "children" ? rest : undefined } as Partial<Answers>);
    },
    [rawSet, penalise, dismiss],
  );

  /** Gives an answer back to the Companion, after a change of the person's own made it stale (a goal, once the community changes). */
  const release = useCallback((...fields: FieldKey[]) => {
    setOrigin((o) => {
      const next = { ...o };
      for (const f of fields) delete next[f];
      return next;
    });
  }, []);

  /** Moving on makes everything the Companion filled in on that screen the person's own. */
  const accept = useCallback((v: StepId) => setOrigin((o) => acceptOnLeaving(v, o)), []);

  const setOn = useCallback((value: boolean) => {
    writeOff(!value);
    // Whatever was filled in stays, and is now the person's own.
    if (!value) setOrigin((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === "picked" ? "person" : v])) as Origin);
  }, []);

  /** The answers the Companion filled in that the person left as they were. */
  const kept = useMemo(() => {
    const out = new Set<FieldKey>();
    for (const [field, value] of Object.entries(filled) as [FieldKey, string][]) {
      if (!isEmpty(answers[field] as Value) && keyOf(answers[field] as Value) === value) out.add(field);
    }
    return out;
  }, [filled, answers]);
  const filledCount = Object.keys(filled).length;

  /** What was shown and what was kept, for the quality log: ids only, never words. */
  const ledger = useCallback(
    (final: Answers): NonNullable<Answers["assist"]> => {
      const out: NonNullable<Answers["assist"]> = {};
      for (const [key, s] of Object.entries(shown.current)) {
        const ids = s.ids.filter((id) => ID.test(id)).slice(0, 8);
        if (ids.length === 0) continue;
        const field = LOGGED_FIELD[key];
        const auto = field ? filled[field] !== undefined : false;
        const entry = { shown: ids, via: s.via, auto } as NonNullable<Answers["assist"]>[string];
        const single = (value: string | number | undefined | null) => (value === undefined || value === null ? null : String(value));
        const list = (values: readonly string[] | undefined) => ids.filter((id) => (values ?? []).includes(id)).slice(0, 5);
        switch (key) {
          case "community": entry.chosen = single(final.community); break;
          case "community_second": entry.chosen = single(final.secondCommunity); break;
          case "season_goal": entry.chosen = single(final.goal); break;
          case "work_status": entry.chosen = single(final.workStatus); break;
          case "work_field": entry.chosen = single(final.workField); break;
          case "relationship": entry.chosen = single(final.relationship); break;
          case "children": entry.chosen = null; entry.kept = list(final.children); break;
          case "group_roles": entry.chosen = null; entry.kept = list(final.groupRoles); break;
          case "faith": entry.chosen = single(final.faith); break;
          case "serving": entry.chosen = single(final.openToServing); break;
          case "baseline": entry.chosen = single(final.baseline); break;
          default: continue;
        }
        out[key] = entry;
      }
      return out;
    },
    [filled],
  );

  const starters = useMemo(() => starterSentences(answers.ageRange, answers.zone), [answers.ageRange, answers.zone]);

  return {
    on,
    setOn,
    /** The Companion is reading the person's words (it never reads a young person's). */
    reads,
    profile,
    chips,
    picks,
    origin,
    known,
    starters,
    set,
    dismiss,
    reject,
    release,
    accept,
    ledger,
    kept,
    filledCount,
    /** Whether the answer is still the Companion's own pick. */
    picked: (field: FieldKey) => on && origin[field] === "picked",
  };
}

export type Companion = ReturnType<typeof useCompanion>;
