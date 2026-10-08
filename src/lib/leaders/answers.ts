import { z } from "zod";
import { hasWords, normaliseWhatsapp } from "@/lib/intake/answers";
import { STYLE_PAIRS } from "@/lib/intake/options";
import { ELIGIBILITY_IDS, GOAL_RELATIONS, LEAD_BEST, MIN_WRITTEN } from "./options";
import { OPTION_IDS, SCENARIO_IDS } from "./scenarios";

const ids = <T extends readonly { id: string }[]>(list: T) =>
  list.map((o) => o.id) as [T[number]["id"], ...T[number]["id"][]];

const slug = z.string().regex(/^[a-z0-9-]{1,96}$/);
const lean = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const loose = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/** Each section is read field by field; a bad value is dropped and the rest is kept. */
const section = (shape: Record<string, z.ZodType>): z.ZodType =>
  z.object(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, loose(v)]))).catch(() => ({}));

const eligibility = section(Object.fromEntries(ELIGIBILITY_IDS.map((id) => [id, z.boolean()])));

const calling = section({
  track: slug,
  tribe: slug,
  goal: slug,
  goalOther: z.string().max(160),
  goalRelation: z.enum(ids(GOAL_RELATIONS)),
  goalStory: z.string().max(1500),
  why: z.string().max(1000),
  walked: z.string().max(1500),
  walkRating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  walkNote: z.string().max(800),
  obstacles: z.string().max(1000),
});

const oneScenario = section({ best: z.enum(OPTION_IDS), worst: z.enum(OPTION_IDS) });
const scenarios = section(Object.fromEntries(SCENARIO_IDS.map((id) => [id, oneScenario])));

const style = section({
  ...Object.fromEntries(STYLE_PAIRS.map((p) => [p.key, lean])),
  leadBest: z.enum(ids(LEAD_BEST)),
});

const contact = section({ whatsapp: z.string().trim().max(24) });

const schema = z.object({ eligibility, calling, scenarios, style, contact });

export type LeaderAnswers = {
  eligibility: Partial<Record<(typeof ELIGIBILITY_IDS)[number], boolean>>;
  calling: {
    track?: string;
    tribe?: string;
    goal?: string;
    goalOther?: string;
    goalRelation?: (typeof GOAL_RELATIONS)[number]["id"];
    goalStory?: string;
    why?: string;
    walked?: string;
    walkRating?: 1 | 2 | 3 | 4 | 5;
    walkNote?: string;
    obstacles?: string;
  };
  scenarios: Partial<Record<(typeof SCENARIO_IDS)[number], { best?: (typeof OPTION_IDS)[number]; worst?: (typeof OPTION_IDS)[number] }>>;
  style: Partial<Record<(typeof STYLE_PAIRS)[number]["key"], -1 | 0 | 1>> & { leadBest?: (typeof LEAD_BEST)[number]["id"] };
  contact: { whatsapp?: string };
};

function compact<T>(value: T): T {
  if (Array.isArray(value)) return value as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, compact(v)]),
    ) as T;
  }
  return value;
}

export const EMPTY_ANSWERS: LeaderAnswers = { eligibility: {}, calling: {}, scenarios: {}, style: {}, contact: {} };

/**
 * Reads a saved draft without trusting it. Each section is read on its own and
 * each field inside it too, so one bad value never spoils the rest.
 */
export function parseLeaderAnswers(value: unknown): LeaderAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(EMPTY_ANSWERS);
  const parsed = schema.safeParse(value);
  if (!parsed.success) return structuredClone(EMPTY_ANSWERS);
  return compact(parsed.data) as unknown as LeaderAnswers;
}

/** A written answer counts once it says something real. The database checks the same length. */
export function hasText(value: string | undefined, min = MIN_WRITTEN): boolean {
  return (value?.trim().length ?? 0) >= min;
}

export function charsToGo(value: string | undefined, min = MIN_WRITTEN): number {
  return Math.max(0, min - (value?.trim().length ?? 0));
}

export type RefereeInput = { name: string; relationship: string; contact: string; head: boolean };
export const EMPTY_REFEREE: RefereeInput = { name: "", relationship: "", contact: "", head: false };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A referee must be reachable by email or phone, so the panel can follow up. */
export function contactLooksReal(value: string): boolean {
  const v = value.trim();
  return EMAIL.test(v) || normaliseWhatsapp(v) !== null || /^\+?\d[\d\s-]{6,18}$/.test(v);
}

export function refereeProblem(r: RefereeInput | undefined): string | null {
  if (!r) return "Add this referee.";
  const name = r.name.trim();
  if (name.length < 2 || name.length > 80) return "Add their name.";
  if (r.relationship.trim().length < 2) return "Say how you know them.";
  if (!contactLooksReal(r.contact)) return "Add a phone number or email so the panel can reach them.";
  return null;
}

/**
 * People type a number the way they say it (0803 123 4567). The database keeps it in
 * international form (+2348031234567), so that is what gets saved. A number that is not
 * yet complete is left as typed.
 */
export function withNormalisedContact(answers: LeaderAnswers): LeaderAnswers {
  const full = normaliseWhatsapp(answers.contact.whatsapp ?? "");
  return full && full !== answers.contact.whatsapp ? { ...answers, contact: { ...answers.contact, whatsapp: full } } : answers;
}

/** The same person cannot be both referees, or you. */
export function normalisedContact(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.includes("@")) return v;
  return normaliseWhatsapp(v) ?? v.replace(/[^\d+]/g, "");
}

export type Problem = { step: string; message: string };

/** The first thing missing from a finished application, naming the step to go back to. */
export function firstProblem(a: LeaderAnswers, referees: { 1?: RefereeInput; 2?: RefereeInput }): Problem | null {
  for (const id of ELIGIBILITY_IDS) {
    if (a.eligibility[id] !== true) return { step: "eligibility", message: "Answer yes to all seven questions to apply." };
  }
  if (!normaliseWhatsapp(a.contact.whatsapp ?? "")) return { step: "contact", message: "Add a WhatsApp number so the panel can reach you." };
  const c = a.calling;
  if (!c.track) return { step: "track", message: "Choose your stage of life." };
  if (!c.tribe) return { step: "tribe", message: "Choose your tribe." };
  if (!c.goal && !hasWords(c.goalOther)) return { step: "goal", message: "Choose the Season Goal you could lead." };
  if (!c.goalRelation) return { step: "goal", message: "Say whether you have reached this goal or are working on it." };
  if (!hasText(c.goalStory)) return { step: "goal-story", message: "Tell your story in a few sentences." };
  if (!hasText(c.why)) return { step: "why", message: "Tell us why you want to lead." };
  if (!hasText(c.walked)) return { step: "walked", message: "Describe a time you walked with someone." };
  if (!c.walkRating || !hasText(c.walkNote)) return { step: "walk", message: "Rate your walk with God and say a little about it." };
  if (!hasText(c.obstacles)) return { step: "obstacles", message: "Tell us what could get in the way." };
  for (const id of SCENARIO_IDS) {
    const s = a.scenarios[id];
    if (!s?.best || !s.worst || s.best === s.worst) return { step: id, message: "Choose one best and one different worst response." };
  }
  if (!a.style.leadBest) return { step: "lead-best", message: "Say how you lead best." };
  for (const slot of [1, 2] as const) {
    const p = refereeProblem(referees[slot]);
    if (p) return { step: `ref${slot}`, message: p };
  }
  const [r1, r2] = [referees[1]!, referees[2]!];
  if (normalisedContact(r1.contact) === normalisedContact(r2.contact)) {
    return { step: "ref2", message: "Your two referees must be different people." };
  }
  if (!r1.head && !r2.head) return { step: "ref1", message: "One referee must be a pastor or unit head." };
  return null;
}
