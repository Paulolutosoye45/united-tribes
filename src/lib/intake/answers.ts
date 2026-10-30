import { z } from "zod";
import { looksMadeUp, NUMBER_WORDS } from "@/lib/messaging/number-rule";
import {
  BASELINES,
  CHANNELS,
  CHILDREN,
  TRIBE_MIXES,
  DAYS_IN_MONTH,
  FAITH_JOURNEYS,
  GENDERS,
  GROUP_ROLES,
  MAX_GROUP_ROLES,
  MEETING_MODES,
  MEETING_TIMES,
  RELATIONSHIPS,
  SERVING_OPTIONS,
  SUPPORT_CHIPS,
  WORK_FIELDS,
  WORK_STATUSES,
  ZONES,
  type Channel,
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
  tribeMix: z.enum(ids(TRIBE_MIXES)),
  zone: z.enum(ids(ZONES)),
  areaNote: z.string().trim().max(80),
  areaSlug: z.string().regex(/^[a-z0-9-]{1,48}$/),
  openToAdjacent: z.boolean(),
  story: z.string().trim().max(1500),
  community: z.string().regex(/^[a-z0-9-]{1,64}$/),
  communityOther: z.string().trim().max(120),
  secondCommunity: z.string().regex(/^[a-z0-9-]{1,64}$/),
  relationship: z.enum(ids(RELATIONSHIPS)),
  children: z.array(z.enum(ids(CHILDREN))).max(CHILDREN.length),
  workStatus: z.enum(ids(WORK_STATUSES)),
  workField: z.enum(ids(WORK_FIELDS)),
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
  groupRoles: z.array(z.enum(ids(GROUP_ROLES))).max(MAX_GROUP_ROLES),
  openToServing: z.enum(ids(SERVING_OPTIONS)),
  /** Private. Never saved with a browser draft; sealed by the server (see sealing in src/lib/crypto). */
  supportChips: z.array(z.enum(ids(SUPPORT_CHIPS))).max(SUPPORT_CHIPS.length),
  supportNote: z.string().trim().max(600),
  leaderNote: z.string().trim().max(600),
  /** The phone number for WhatsApp and text messages, as the person typed it. */
  phone: z.string().trim().max(24),
  whatsappOk: z.boolean(),
  smsOk: z.boolean(),
  emailOk: z.boolean(),
  channel: z.enum(ids(CHANNELS)),
  /** What the assistant proposed and what the person picked: ids only. */
  assist: z.record(
    z.string().regex(/^[a-z_]{1,32}$/),
    z.object({
      shown: z.array(z.string().regex(/^[a-z0-9_-]{1,96}$/)).max(8),
      chosen: z.string().regex(/^[a-z0-9_-]{1,96}$/).nullable().optional(),
      /** For questions that take several answers: which of the suggestions were kept. */
      kept: z.array(z.string().regex(/^[a-z0-9_-]{1,96}$/)).max(5).optional(),
      /** Where the suggestions came from: the Companion's own reading, the AI service, or both agreeing. */
      via: z.enum(["engine", "ai", "both"]).optional(),
      /** The Companion filled this answer in before the person touched it. */
      auto: z.boolean().optional(),
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
export function firstProblem(a: Answers, opts: { teensOpen?: boolean; numberRequired?: boolean } = {}): Problem | null {
  if (!a.ageRange) return { step: "age", message: "Choose your age range." };
  if (a.ageRange === TEENS && opts.teensOpen !== true) return { step: "age", message: "Tribes for teens are not open yet." };
  if (a.birthdayDay !== undefined || a.birthdayMonth !== undefined) {
    if (a.birthdayDay === undefined || a.birthdayMonth === undefined || !isValidBirthday(a.birthdayDay, a.birthdayMonth)) {
      return { step: "age", message: "That birthday is not a real date. Check the day and month, or remove it." };
    }
  }
  if (!a.preferredName) return { step: "name", message: "Tell us what to call you." };
  if (!a.gender || !a.tribeMix) return { step: "gender", message: "Answer both questions on this screen." };
  if (!a.zone) return { step: "where", message: "Choose where you are based." };
  if (!a.community && !a.communityOther?.trim()) return { step: "community", message: "Choose the community that fits you best, or describe your own." };
  if (!a.faith) return { step: "faith", message: "Choose where you are on your walk with God." };
  if (!a.goal && !a.goalOther?.trim()) return { step: "goal", message: "Choose a goal, or write your own." };
  if (a.goal && !a.community) return { step: "community", message: "Choose a community so we can show its goals." };
  if (!a.baseline || !BASELINES.some((b) => b.value === a.baseline)) return { step: "success", message: "Say where you are on this goal today." };
  if (!a.meetingMode) return { step: "rhythm", message: "Choose how you would like to meet." };
  if (!a.times || a.times.length === 0) return { step: "rhythm", message: "Choose at least one time that could work." };
  if (a.secondCommunity && a.secondCommunity === a.community) return { step: "community", message: "Your second choice has to be a different community from your first." };
  if (a.groupRoles && a.groupRoles.length > MAX_GROUP_ROLES) return { step: "style", message: `Choose up to ${MAX_GROUP_ROLES} roles.` };
  const contact = contactProblem(a, { required: opts.numberRequired === true && a.ageRange !== TEENS });
  if (contact) return { step: "contact", message: contact };
  return null;
}

/** A person's own words for a community or goal count only if they say something. */
export function hasWords(value: string | undefined, min = 3): boolean {
  return (value?.trim().length ?? 0) >= min;
}

/**
 * What is wrong with how the person asked to be reached, in words they can act on, or null. `required` is true while the
 * WhatsApp number is compulsory (the Switchboard's "WhatsApp number required" is On and the person is an adult): then the
 * number must be there, and must not be made up. Off, nothing about the number is checked beyond its shape.
 */
export function contactProblem(a: Pick<Answers, "phone" | "whatsappOk" | "smsOk" | "channel" | "emailOk">, opts: { required?: boolean } = {}): string | null {
  const phone = a.phone?.trim();
  if (opts.required && !phone) return NUMBER_WORDS.missing;
  if (phone && !normaliseWhatsapp(phone)) return "That phone number doesn't look right. Include your network code, like 0803 123 4567.";
  if (opts.required && phone && looksMadeUp(normaliseWhatsapp(phone))) return NUMBER_WORDS.madeUp;
  if ((a.whatsappOk || a.smsOk) && !phone) return "Add your phone number to be reached on WhatsApp or by text message, or untick them.";
  if (a.emailOk === false && !a.whatsappOk && !a.smsOk) return "Choose at least one way for us to reach you, or we won't be able to send your meeting reminders.";
  return null;
}

/** The channels the person said yes to, best first: the one they prefer, then WhatsApp, email, text message. */
export function enabledChannels(a: Pick<Answers, "whatsappOk" | "smsOk" | "emailOk" | "phone" | "channel">): Channel[] {
  const hasPhone = Boolean(a.phone?.trim() && normaliseWhatsapp(a.phone));
  const on: Channel[] = [];
  if (a.whatsappOk && hasPhone) on.push("whatsapp");
  if (a.emailOk !== false) on.push("email");
  if (a.smsOk && hasPhone) on.push("sms");
  return a.channel && on.includes(a.channel) ? [a.channel, ...on.filter((c) => c !== a.channel)] : on;
}

/**
 * The one thing the matching engine learns about a private support note: 0 nothing, 1 something a tribe can
 * simply arrange, 2 a hard season. A tribe takes at most two members carrying a hard season.
 */
export function supportLoad(chips: readonly string[] | undefined, note: string | undefined): 0 | 1 | 2 {
  const picked = chips ?? [];
  if (picked.some((id) => SUPPORT_CHIPS.find((c) => c.id === id)?.heavy)) return 2;
  if (picked.length > 0 || hasWords(note)) return 1;
  return 0;
}

/** The answers that are sealed rather than saved as they are. They never go into a browser draft or the assistant. */
export const PRIVATE_ANSWER_KEYS = ["supportChips", "supportNote", "leaderNote"] as const;
