import { normaliseWhatsapp } from "@/lib/intake/answers";
import { hasWords } from "@/lib/intake/answers";
import { ELIGIBILITY_IDS } from "./options";
import { hasText, refereeProblem, type LeaderAnswers, type RefereeInput } from "./answers";
import { SCENARIO_IDS } from "./scenarios";

export const STEP_IDS = [
  "eligibility",
  "contact",
  "track",
  "tribe",
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
  { id: "calling", label: "Your calling", steps: ["track", "tribe", "goal", "goal-story", "why", "walked", "walk", "obstacles"] },
  { id: "judgement", label: "Your judgement", steps: [...SCENARIO_IDS, "style", "lead-best"] },
  { id: "people", label: "People who know you", steps: ["ref1", "ref2", "review"] },
] as const satisfies readonly { id: string; label: string; steps: readonly StepId[] }[];

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

export function sectionOf(step: StepId): number {
  return SECTIONS.findIndex((s) => (s.steps as readonly string[]).includes(step));
}

export function nextStep(step: StepId): StepId {
  return STEP_IDS[Math.min(STEP_IDS.indexOf(step) + 1, STEP_IDS.length - 1)];
}

export function previousStep(step: StepId): StepId | null {
  const i = STEP_IDS.indexOf(step);
  return i > 0 ? STEP_IDS[i - 1] : null;
}

export const HEAD_START = 0.15;

export function shieldFills(step: StepId | "welcome" | "done" | "ineligible"): [number, number, number, number] {
  if (step === "done" || step === "review") return [1, 1, 1, 1];
  if (step === "welcome" || step === "ineligible") return [0, 0, 0, 0];
  const at = STEP_IDS.indexOf(step);
  const fills = SECTIONS.map((section) => {
    const done = (section.steps as readonly StepId[]).filter((s) => STEP_IDS.indexOf(s) < at).length;
    return done / section.steps.length;
  }) as [number, number, number, number];
  fills[0] = Math.max(fills[0], HEAD_START);
  return fills;
}

/** Rough seconds each screen takes, so the time left is honest: writing takes longer than tapping. */
const SECONDS: Record<StepId, number> = {
  eligibility: 40,
  contact: 20,
  track: 10,
  tribe: 15,
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

export function minutesLeft(step: StepId): number {
  const at = STEP_IDS.indexOf(step);
  const seconds = STEP_IDS.slice(at).reduce((sum, s) => sum + SECONDS[s], 0);
  return Math.max(1, Math.ceil(seconds / 60));
}

export function timeLeftLabel(step: StepId): string {
  const m = minutesLeft(step);
  return m <= 1 ? "Under a minute left" : `About ${m} minutes left`;
}

export const STEP_QUESTION_COUNT = STEP_IDS.length;
export const MAX_SECONDS_PER_STEP = 180;

export type Referees = { 1?: RefereeInput; 2?: RefereeInput };

/** Whether Continue is allowed on this step. */
export function canContinue(step: StepId, a: LeaderAnswers, referees: Referees, agreed: boolean): boolean {
  const c = a.calling;
  switch (step) {
    case "eligibility":
      return ELIGIBILITY_IDS.every((id) => typeof a.eligibility[id] === "boolean");
    case "contact":
      return normaliseWhatsapp(a.contact.whatsapp ?? "") !== null;
    case "track":
      return Boolean(c.track);
    case "tribe":
      return Boolean(c.tribe);
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
      return refereeProblem(referees[1]) === null;
    case "ref2":
      return refereeProblem(referees[2]) === null;
    case "review":
      return agreed;
  }
}
