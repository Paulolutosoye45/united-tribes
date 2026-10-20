import { normaliseWhatsapp } from "@/lib/intake/answers";
import { hasWords } from "@/lib/intake/answers";
import { hasText, isBlankReferee, refereeProblem, type LeaderAnswers, type RefereeInput } from "./answers";
import { DEFAULT_MODES, askedQuestions, requiredQuestions, type StageModes } from "./modes";
import { SCENARIO_IDS } from "./scenarios";

export const STEP_IDS = [
  "eligibility",
  "contact",
  "track",
  "community",
  "goal",
  "goal-story",
  "why",
  "walked",
  "walk",
  "obstacles",
  ...SCENARIO_IDS,
  "style",
  "lead-best",
  "ref1",
  "ref2",
  "review",
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The four quarters of the shield, as on the member form. */
export const SECTIONS = [
  { id: "start", label: "Getting started", steps: ["eligibility", "contact"] },
  { id: "calling", label: "Your calling", steps: ["track", "community", "goal", "goal-story", "why", "walked", "walk", "obstacles"] },
  { id: "judgement", label: "Your judgement", steps: [...SCENARIO_IDS, "style", "lead-best"] },
  { id: "people", label: "People who know you", steps: ["ref1", "ref2", "review"] },
] as const satisfies readonly { id: string; label: string; steps: readonly StepId[] }[];

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

export function sectionOf(step: StepId): number {
  return SECTIONS.findIndex((s) => (s.steps as readonly string[]).includes(step));
}

/**
 * Whether a screen is part of this application. The eligibility screen goes when every question is off, and the two referee
 * screens go when references are off. Nothing else is ever left out, and no step is renamed or renumbered.
 */
export function stepApplies(step: StepId, modes: StageModes = DEFAULT_MODES): boolean {
  if (step === "eligibility") return askedQuestions(modes).length > 0;
  if (step === "ref1" || step === "ref2") return modes.references !== "off";
  return true;
}

/** The screens this application goes through, in order. With every step asked, this is all twenty-one. */
export function activeSteps(modes: StageModes = DEFAULT_MODES): StepId[] {
  return STEP_IDS.filter((s) => stepApplies(s, modes));
}

/** The screen to show for one that was saved: the same screen if it still applies, otherwise the next one that does. */
export function resolveStep(step: StepId, modes: StageModes = DEFAULT_MODES): StepId {
  return stepApplies(step, modes) ? step : nextStep(step, modes);
}

export function nextStep(step: StepId, modes: StageModes = DEFAULT_MODES): StepId {
  for (let i = STEP_IDS.indexOf(step) + 1; i < STEP_IDS.length; i++) if (stepApplies(STEP_IDS[i], modes)) return STEP_IDS[i];
  return STEP_IDS[STEP_IDS.length - 1];
}

export function previousStep(step: StepId, modes: StageModes = DEFAULT_MODES): StepId | null {
  for (let i = STEP_IDS.indexOf(step) - 1; i >= 0; i--) if (stepApplies(STEP_IDS[i], modes)) return STEP_IDS[i];
  return null;
}

/**
 * "Find your tribe" is a view, not a step. It sits after "how you lead best" when Tribe fit is switched on, and it is never saved as
 * the step: the saved step stays "lead-best". The activity funnel, the resume page and the pinned list of twenty-one steps all depend on
 * that, so STEP_IDS does not change.
 */
export const FIT_VIEW = "find-tribe" as const;
export type FlowView = StepId | typeof FIT_VIEW;

/** The step that is saved while a leader is on the Find your tribe screen. */
export const savedStep = (view: FlowView): StepId => (view === FIT_VIEW ? "lead-best" : view);

/** The screens whose answers the comparison reads. Changing one of them from the review sends the leader back to Find your tribe. */
export const FIT_INPUT_STEPS: readonly StepId[] = ["track", "community", "goal", ...SCENARIO_IDS, "lead-best"];

/** The screen Continue goes to. With Tribe fit on, "how you lead best" is followed by Find your tribe. */
export function viewAfter(view: FlowView, modes: StageModes = DEFAULT_MODES, fit = false): FlowView {
  if (view === FIT_VIEW) return nextStep("lead-best", modes);
  if (fit && view === "lead-best") return FIT_VIEW;
  return nextStep(view, modes);
}

/** The screen Back goes to: the exact reverse of viewAfter. */
export function viewBefore(view: FlowView, modes: StageModes = DEFAULT_MODES, fit = false): FlowView | null {
  if (view === FIT_VIEW) return "lead-best";
  const prev = previousStep(view, modes);
  return fit && prev === "lead-best" ? FIT_VIEW : prev;
}

export const HEAD_START = 0.15;

export function shieldFills(step: StepId | "welcome" | "done" | "ineligible", modes: StageModes = DEFAULT_MODES): [number, number, number, number] {
  if (step === "done" || step === "review") return [1, 1, 1, 1];
  if (step === "welcome" || step === "ineligible") return [0, 0, 0, 0];
  const at = STEP_IDS.indexOf(step);
  const fills = SECTIONS.map((section) => {
    // A quarter fills by the screens in it that this application has, so a step switched off never leaves a quarter short
    const own = (section.steps as readonly StepId[]).filter((s) => stepApplies(s, modes));
    if (own.length === 0) return 1;
    const done = own.filter((s) => STEP_IDS.indexOf(s) < at).length;
    return done / own.length;
  }) as [number, number, number, number];
  fills[0] = Math.max(fills[0], HEAD_START);
  return fills;
}

/** The shield while Find your tribe is on screen: "Your judgement" is complete and "People who know you" has not begun. */
export function fitFills(modes: StageModes = DEFAULT_MODES): [number, number, number, number] {
  const fills = shieldFills("lead-best", modes);
  fills[2] = 1;
  return fills;
}

/** Rough seconds each screen takes, so the time left is honest: writing takes longer than tapping. */
const SECONDS: Record<StepId, number> = {
  eligibility: 40,
  contact: 20,
  track: 10,
  community: 15,
  goal: 25,
  "goal-story": 90,
  why: 60,
  walked: 90,
  walk: 60,
  obstacles: 60,
  s1: 40,
  s2: 40,
  s3: 40,
  s4: 40,
  s5: 40,
  s6: 40,
  style: 30,
  "lead-best": 15,
  ref1: 45,
  ref2: 45,
  review: 30,
};

/** About a minute to read three tribes and choose one. */
export const FIT_SECONDS = 60;

export function minutesLeft(step: FlowView, modes: StageModes = DEFAULT_MODES, fit = false): number {
  const from = step === FIT_VIEW ? STEP_IDS.indexOf("lead-best") + 1 : STEP_IDS.indexOf(step);
  let seconds = STEP_IDS.slice(from).filter((s) => stepApplies(s, modes)).reduce((sum, s) => sum + SECONDS[s], 0);
  // The screen is still ahead of a leader who has not reached "how you lead best" yet, and is the one on screen when they are on it
  if (fit && (step === FIT_VIEW || STEP_IDS.indexOf(step) <= STEP_IDS.indexOf("lead-best"))) seconds += FIT_SECONDS;
  return Math.max(1, Math.ceil(seconds / 60));
}

export function timeLeftLabel(step: FlowView, modes: StageModes = DEFAULT_MODES, fit = false): string {
  const m = minutesLeft(step, modes, fit);
  return m <= 1 ? "Under a minute left" : `About ${m} minutes left`;
}

export const STEP_QUESTION_COUNT = STEP_IDS.length;
export const MAX_SECONDS_PER_STEP = 180;

export type Referees = { 1?: RefereeInput; 2?: RefereeInput };

/** Whether Continue is allowed on this step. */
export function canContinue(step: StepId, a: LeaderAnswers, referees: Referees, agreed: boolean, modes: StageModes = DEFAULT_MODES): boolean {
  const c = a.calling;
  switch (step) {
    case "eligibility":
      // Every required question needs an answer. An optional one may be answered either way, or left.
      return requiredQuestions(modes).every((id) => typeof a.eligibility[id] === "boolean");
    case "contact":
      return normaliseWhatsapp(a.contact.whatsapp ?? "") !== null;
    case "track":
      return Boolean(c.track);
    case "community":
      return Boolean(c.community);
    case "goal":
      return Boolean(c.goal || hasWords(c.goalOther)) && Boolean(c.goalRelation);
    case "goal-story":
      return hasText(c.goalStory);
    case "why":
      return hasText(c.why);
    case "walked":
      return hasText(c.walked);
    case "walk":
      return Boolean(c.walkRating) && hasText(c.walkNote);
    case "obstacles":
      return hasText(c.obstacles);
    case "s1":
    case "s2":
    case "s3":
    case "s4":
    case "s5":
    case "s6": {
      const s = a.scenarios[step];
      return Boolean(s?.best && s.worst && s.best !== s.worst);
    }
    case "style":
      return true;
    case "lead-best":
      return Boolean(a.style.leadBest);
    case "ref1":
    case "ref2": {
      const r = referees[step === "ref1" ? 1 : 2];
      if (modes.references === "off") return true;
      // Optional: leave it empty, or fill it in properly. A half-filled one is not allowed to go on.
      if (modes.references === "optional") return isBlankReferee(r) || refereeProblem(r) === null;
      return refereeProblem(r) === null;
    }
    case "review":
      return agreed;
  }
}
