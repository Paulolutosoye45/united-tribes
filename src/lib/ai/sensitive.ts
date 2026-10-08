/**
 * What the assistant may see. The rule is an allow-list: a field is sent only
 * if it is named here, so a new field is private until someone decides
 * otherwise. Support needs and anything written for a leader's eyes never go.
 */
export const AI_ELIGIBLE_FIELDS = [
  "tribe",
  "season_goal",
  "life_stage_note",
  "faith_journey",
  "meeting_preference",
] as const;

/** Named so a reader can see what is deliberately kept out. */
export const NEVER_SENT_FIELDS = [
  "support_needs",
  "notes_to_leader",
  "health",
  "family_situation",
  "safeguarding",
] as const;

export function isAiEligible(field: string): boolean {
  return (AI_ELIGIBLE_FIELDS as readonly string[]).includes(field);
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Nigerian and international numbers: +234 803 123 4567, 0803 123 4567, 08031234567 …
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;

/** Removes contact details before text leaves our servers. */
export function scrubPersonalDetails(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[number]");
}
