import { isValidBirthday, hasWords, normaliseWhatsapp, TEENS, type Answers } from "./answers";

export const STEP_IDS = [
  "age",
  "name",
  "gender",
  "where",
  "story",
  "tribe",
  "faith",
  "goal",
  "success",
  "rhythm",
  "style",
  "extras",
  "review",
] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The four quarters of the shield. Each section is one quarter. */
export const SECTIONS = [
  { id: "you", label: "About you", steps: ["age", "name", "gender", "where"] },
  { id: "season", label: "Your season", steps: ["story", "tribe", "faith"] },
  { id: "goal", label: "Your goal", steps: ["goal", "success"] },
  { id: "rhythm", label: "Your rhythm", steps: ["rhythm", "style", "extras"] },
] as const satisfies readonly { id: string; label: string; steps: readonly StepId[] }[];

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

/** Which quarter a step belongs to; the review belongs to none. */
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

/**
 * People who feel they have already begun are more likely to finish, so the
 * first quarter starts a little filled once the welcome is done.
 */
export const HEAD_START = 0.2;

/** How full each quarter of the shield is when the person is on `step`. */
export function shieldFills(step: StepId | "welcome" | "done"): [number, number, number, number] {
  if (step === "done" || step === "review") return [1, 1, 1, 1];
  if (step === "welcome") return [0, 0, 0, 0];
  const at = STEP_IDS.indexOf(step);
  const fills = SECTIONS.map((section) => {
    const done = section.steps.filter((s) => STEP_IDS.indexOf(s) < at).length;
    return done / section.steps.length;
  }) as [number, number, number, number];
  fills[0] = Math.max(fills[0], HEAD_START);
  return fills;
}

/** Steps still to answer, not counting the one on screen or the review. */
export function stepsLeft(step: StepId): number {
  const at = STEP_IDS.indexOf(step);
  return Math.max(0, STEP_IDS.length - 1 - at);
}

/** Seconds the average person takes on one screen. Used only for the estimate shown. */
export const SECONDS_PER_STEP = 18;

/** A calm estimate, shown as whole minutes. */
export function timeLeftLabel(step: StepId): string {
  const seconds = (stepsLeft(step) + 1) * SECONDS_PER_STEP;
  if (seconds <= 60) return "Under a minute left";
  return `About ${Math.ceil(seconds / 60)} minutes left`;
}

/** Whether Continue is allowed on this step. Optional steps are always allowed. */
export function canContinue(step: StepId, a: Answers): boolean {
  switch (step) {
    case "age":
      if (!a.ageRange || a.ageRange === TEENS) return false;
      if (a.birthdayDay === undefined && a.birthdayMonth === undefined) return true;
      return a.birthdayDay !== undefined && a.birthdayMonth !== undefined && isValidBirthday(a.birthdayDay, a.birthdayMonth);
    case "name":
      return Boolean(a.preferredName?.trim());
    case "gender":
      return Boolean(a.gender && a.circleMix);
    case "where":
      return Boolean(a.zone);
    case "story":
    case "style":
    case "review":
      return true;
    case "tribe":
      return Boolean(a.tribe) || hasWords(a.tribeOther);
    case "faith":
      return Boolean(a.faith);
    case "goal":
      return Boolean(a.goal) || hasWords(a.goalOther);
    case "success":
      return Boolean(a.baseline);
    case "rhythm":
      return Boolean(a.meetingMode && a.times && a.times.length > 0);
    case "extras": {
      const number = a.whatsapp?.trim();
      if (!number) return true;
      return Boolean(normaliseWhatsapp(number)) && Boolean(a.whatsappOk);
    }
  }
}

/** Steps a person can skip outright. */
export const SKIPPABLE: readonly StepId[] = ["story", "style", "extras"];

/** Seconds counted per screen at most, so a phone left open does not inflate the time. */
export const MAX_SECONDS_PER_STEP = 90;
