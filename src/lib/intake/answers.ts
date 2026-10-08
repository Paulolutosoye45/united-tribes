import { z } from "zod";
import {
  BASELINES,
  CIRCLE_MIXES,
  DAYS_IN_MONTH,
  FAITH_JOURNEYS,
  GENDERS,
  MEETING_MODES,
  MEETING_TIMES,
  SERVING_OPTIONS,
  ZONES,
} from "./options";

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((o) => o.id) as [T[number]["id"], ...T[number]["id"][]];

/** Letters, marks, spaces, apostrophes, hyphens and full stops cover names in any script. */
export const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;

export const TEENS = "13-17";

const lean = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

const fields = {
  ageRange: z.string().regex(/^[a-z0-9-]{1,16}$/),
  birthdayDay: z.number().int().min(1).max(31),
  birthdayMonth: z.number().int().min(1).max(12),
  preferredName: z.string().trim().min(1).max(40).regex(NAME_PATTERN),
  fullName: z.string().trim().min(1).max(80).regex(NAME_PATTERN),
  gender: z.enum(ids(GENDERS)),
  circleMix: z.enum(ids(CIRCLE_MIXES)),
  zone: z.enum(ids(ZONES)),
  areaNote: z.string().trim().max(80),
  story: z.string().trim().max(1500),
  tribe: z.string().regex(/^[a-z0-9-]{1,64}$/),
  tribeOther: z.string().trim().max(120),
  faith: z.enum(ids(FAITH_JOURNEYS)),
  goal: z.string().regex(/^[a-z0-9-]{1,96}$/),
  goalOther: z.string().trim().max(160),
  successStatement: z.string().trim().max(240),
  baseline: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  meetingMode: z.enum(ids(MEETING_MODES)),
  times: z.array(z.enum(ids(MEETING_TIMES))).max(4),
  styleSocial: lean,
  styleStructure: lean,
  styleOpenness: lean,
  styleDirectness: lean,
  styleDisclosure: lean,
  styleLearning: lean,
  openToServing: z.enum(ids(SERVING_OPTIONS)),
  supportNeeds: z.string().trim().max(600),
  whatsapp: z.string().trim().max(24),
  whatsappOk: z.boolean(),
  /** What the assistant proposed and what the person picked: ids only. */
  assist: z.record(
    z.string().regex(/^[a-z_]{1,32}$/),
    z.object({
      shown: z.array(z.string().regex(/^[a-z0-9-]{1,96}$/)).max(5),
      chosen: z.string().regex(/^[a-z0-9-]{1,96}$/).nullable().optional(),
    }),
  ),
};

type Fields = typeof fields;
export type Answers = { [K in keyof Fields]?: z.infer<Fields[K]> };

// Each field is read on its own, so one bad value never spoils the rest.
const lenientSchema = z.object(
  Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [key, (schema as z.ZodType).optional().catch(undefined)]),
  ),
);

/**
 * Reads a saved draft without trusting it. Fields that do not fit are dropped
 * one by one, so a stale or tampered draft can never break the form.
 */
export function parseDraftAnswers(value: unknown): Answers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed = lenientSchema.safeParse(value);
  if (!parsed.success) return {};
  return Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Answers;
}

/** Whether a day exists in a month (29 February is allowed). */
export function isValidBirthday(day: number, month: number): boolean {
  return Number.isInteger(day) && Number.isInteger(month) && month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/**
 * Turns the way people write Nigerian and international numbers into
 * +234… form. Returns null when it cannot be a real number.
 *   "0803 123 4567"   -> "+2348031234567"
 *   "+234 803 123 4567" -> "+2348031234567"
 *   "2348031234567"   -> "+2348031234567"
 *   "+44 7700 900123" -> "+447700900123"
 */
export function normaliseWhatsapp(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  let e164: string;
  if (digits.startsWith("+")) e164 = `+${digits.slice(1).replace(/\D/g, "")}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith("234")) e164 = `+${digits}`;
  else if (digits.startsWith("0")) e164 = `+234${digits.slice(1)}`;
  else return null;
  if (e164.startsWith("+234") && e164.length !== 14) return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export type Problem = { step: string; message: string };

/**
 * Checks a finished form. Returns the first problem, naming the step to send
 * the person back to, or null when everything needed is present.
 */
export function firstProblem(a: Answers): Problem | null {
  if (!a.ageRange) return { step: "age", message: "Choose your age range." };
  if (a.ageRange === TEENS) return { step: "age", message: "Circles for teens open in a later release." };
  if (a.birthdayDay !== undefined || a.birthdayMonth !== undefined) {
    if (a.birthdayDay === undefined || a.birthdayMonth === undefined || !isValidBirthday(a.birthdayDay, a.birthdayMonth)) {
      return { step: "age", message: "That birthday is not a real date. Check the day and month, or remove it." };
    }
  }
  if (!a.preferredName) return { step: "name", message: "Tell us what to call you." };
  if (!a.gender || !a.circleMix) return { step: "gender", message: "Answer both questions on this screen." };
  if (!a.zone) return { step: "where", message: "Choose where you are based." };
  if (!a.tribe && !a.tribeOther?.trim()) return { step: "tribe", message: "Choose the tribe that fits you best, or describe your own." };
  if (!a.faith) return { step: "faith", message: "Choose where you are on your walk with God." };
  if (!a.goal && !a.goalOther?.trim()) return { step: "goal", message: "Choose a goal, or write your own." };
  if (a.goal && !a.tribe) return { step: "tribe", message: "Choose a tribe so we can show its goals." };
  if (!a.baseline || !BASELINES.some((b) => b.value === a.baseline)) return { step: "success", message: "Say where you are on this goal today." };
  if (!a.meetingMode) return { step: "rhythm", message: "Choose how you would like to meet." };
  if (!a.times || a.times.length === 0) return { step: "rhythm", message: "Choose at least one time that could work." };
  if (a.whatsapp?.trim()) {
    if (!normaliseWhatsapp(a.whatsapp)) return { step: "extras", message: "That WhatsApp number doesn't look right. Include your network code, like 0803 123 4567." };
    if (!a.whatsappOk) return { step: "extras", message: "Tick the box to allow WhatsApp messages, or remove the number." };
  }
  return null;
}

/** A person's own words for a tribe or goal count only if they say something. */
export function hasWords(value: string | undefined, min = 3): boolean {
  return (value?.trim().length ?? 0) >= min;
}
