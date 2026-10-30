// The compulsory WhatsApp number (stage 3 of "WhatsApp that cannot fail quietly"): what the screens read from the database (my_number_rule,
// tribe_number_gaps), the rule that a number is not made up, and every sentence the rule says to a member or a leader. Off, the database answers
// four "no"s and every screen behaves exactly as it did.

export type NumberRule = {
  /** The switch is On for the church. The form asks for the number only then. */
  on: boolean;
  /** The number is compulsory for this signed-in person (an adult with a member profile). */
  required: boolean;
  /** Show the gentle prompt: required, no number saved, and not put away in the last week. */
  prompt: boolean;
  /** The number they sign in with is not the number we message: both, for the person themselves to read. */
  mismatch: { signin: string; contact: string } | null;
};

export const NUMBER_RULE_OFF: NumberRule = { on: false, required: false, prompt: false, mismatch: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Reads the database's answer defensively: anything not clearly in the shape means Off. */
export function parseNumberRule(data: unknown): NumberRule {
  if (!isObj(data) || data.on !== true) return NUMBER_RULE_OFF;
  const m = isObj(data.mismatch) ? data.mismatch : null;
  const signin = m ? text(m.signin) : null;
  const contact = m ? text(m.contact) : null;
  return {
    on: true,
    required: data.required === true,
    prompt: data.required === true && data.prompt === true,
    mismatch: signin && contact ? { signin, contact } : null,
  };
}

export type NumberGaps = { on: boolean; count: number; names: string[] };

export function parseNumberGaps(data: unknown): NumberGaps {
  if (!isObj(data) || data.on !== true) return { on: false, count: 0, names: [] };
  const names = Array.isArray(data.names) ? data.names.filter((n): n is string => typeof n === "string" && n.trim() !== "") : [];
  const count = typeof data.count === "number" && Number.isFinite(data.count) ? Math.max(0, Math.floor(data.count)) : names.length;
  return { on: true, count, names };
}

/**
 * A number whose last seven digits are one digit repeated is not a real person's number. The database applies the same rule
 * (number_looks_made_up), so a number cannot be saved by going around the form.
 */
export function looksMadeUp(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 && /^(\d)\1{6}$/.test(digits.slice(-7));
}

/** A +234 number the way people say it, "+234 803 123 4567"; any other number as it is. */
export function showNumber(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+234 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export const NUMBER_WORDS = {
  /** The label of the field when the number is compulsory. */
  label: "WhatsApp number",
  /** Under the field, while the rule is On. */
  explain:
    "We need a number to reach you about your tribe. We message you only in the ways you choose below, and your leader sees your number only if you choose WhatsApp.",
  missing: "Add your WhatsApp number. We need it to reach you with your tribe’s messages.",
  madeUp: "That number looks made up. Check the digits and write it again.",
  /** Shown as the person types a good number: the number as we will use it. */
  showBack: (e164: string) => `We’ll use ${showNumber(e164)}`,
  promptTitle: "Add your WhatsApp number",
  promptBody: "We need a number to reach you about your tribe. It takes a moment, and you choose how we use it.",
  promptAdd: "Add my number",
  promptLater: "Not now",
  mismatchTitle: "You have two numbers",
  mismatch: (signin: string, contact: string) =>
    `You sign in with ${showNumber(signin)}, but we message you on ${showNumber(contact)}. That is fine if you meant it. If not, change the one that is wrong.`,
  leaderNote: (count: number, names: string[]) => {
    if (count <= 0) return null;
    const who = names.length > 0 && names.length <= 4 ? `: ${names.join(", ")}` : "";
    return count === 1
      ? `1 person in your tribe has not added a phone number yet${who}. You can ask them in person.`
      : `${count} people in your tribe have not added a phone number yet${who}. You can ask them in person.`;
  },
} as const;
